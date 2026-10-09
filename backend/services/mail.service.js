import fs from 'fs'
import os from 'os'
import path from 'path'
import dns from 'dns'
import crypto from 'crypto'
import { execFile } from 'child_process'
import bcrypt from 'bcryptjs'
import { simpleParser } from 'mailparser'
import MailComposer from 'nodemailer/lib/mail-composer/index.js'
import { readDb, writeDb } from './db.service.js'

/**
 * Real domain email: Postfix (SMTP) + Dovecot (IMAP/POP3/LMTP/SASL) + OpenDKIM.
 * System setup lives in scripts/setup-mail-server.sh; this service manages the data:
 *   /etc/postfix/panel_{domains,mailboxes,aliases,sender_login}  (postmap'd)
 *   /etc/dovecot/panel-users                                      (passwd-file, bcrypt)
 *   /etc/opendkim/{key,signing}.table + keys/<domain>/            (DKIM)
 *   /var/vmail/<domain>/<user>/                                    (Maildir, read by the webmail)
 */

const VMAIL_ROOT = '/var/vmail'
const VMAIL_UID = 5000
const POSTFIX_DIR = '/etc/postfix'
const DOVECOT_USERS = '/etc/dovecot/panel-users'
const DOVECOT_LOCAL_CONF = '/etc/dovecot/local.conf'
const DKIM_DIR = '/etc/opendkim'
const DKIM_SELECTOR = 'mail'
const MAIL_LOG = '/var/log/mail.log'
const SENDMAIL = '/usr/sbin/sendmail'

export const DOMAIN_REGEX = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/
const USERNAME_REGEX = /^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?$/
const EMAIL_REGEX = /^[^\s@<>()",;:]+@[a-z0-9.-]+\.[a-z]{2,}$/i
const FOLDERS = { inbox: '', sent: '.Sent', drafts: '.Drafts', trash: '.Trash', junk: '.Junk' }

const httpError = (status, message) => Object.assign(new Error(message), { status })

function run(cmd, args, { input = null, timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || '').trim() || err.message))
      resolve(stdout)
    })
    if (input !== null) child.stdin.end(input)
  })
}

const isOrgScoped = (orgId) => orgId && orgId !== 'org-default'
const inOrg = (item, orgId) => !isOrgScoped(orgId) || item.organizationId === orgId

// ---------------------------------------------------------------------------------------------
// Server status & settings
// ---------------------------------------------------------------------------------------------

/** Hostname clients use for IMAP/SMTP — the name on the TLS certificate configured in Dovecot */
export function getMailHost() {
  try {
    const m = fs.readFileSync(DOVECOT_LOCAL_CONF, 'utf8').match(/ssl_cert\s*=\s*<\/etc\/letsencrypt\/live\/([^/]+)\//)
    if (m) return m[1]
  } catch { /* not set up yet */ }
  return process.env.MAIL_HOST || 'automate-deployment.yjtechnosoft.com'
}

function getHeloHost() {
  try { return fs.readFileSync('/etc/mailname', 'utf8').trim() } catch { return os.hostname() }
}

function isConfigured() {
  try {
    return fs.readFileSync(DOVECOT_LOCAL_CONF, 'utf8').includes('auto-deploy-panel')
  } catch {
    return false
  }
}

let publicIpCache = null
async function getPublicIp() {
  if (publicIpCache) return publicIpCache
  try {
    const out = await run('curl', ['-s4', '--max-time', '5', 'https://api.ipify.org'])
    if (/^\d+\.\d+\.\d+\.\d+$/.test(out.trim())) publicIpCache = out.trim()
  } catch { /* offline */ }
  if (!publicIpCache) {
    publicIpCache = Object.values(os.networkInterfaces()).flat()
      .find(i => i && i.family === 'IPv4' && !i.internal)?.address || '127.0.0.1'
  }
  return publicIpCache
}

async function serviceActive(name) {
  try {
    return (await run('systemctl', ['is-active', name])).trim() === 'active'
  } catch {
    return false
  }
}

async function listeningPorts() {
  try {
    const out = await run('ss', ['-tlnH'])
    return new Set([...out.matchAll(/:(\d+)\s+\S+:\S+/g)].map(m => Number(m[1])))
  } catch {
    return new Set()
  }
}

export async function getMailStatus() {
  const [postfix, dovecot, opendkim, ports, ip] = await Promise.all([
    serviceActive('postfix'), serviceActive('dovecot'), serviceActive('opendkim'), listeningPorts(), getPublicIp()
  ])
  const portList = { smtp: 25, submission: 587, smtps: 465, imaps: 993, imap: 143, pop3s: 995 }
  return {
    configured: isConfigured(),
    services: { postfix, dovecot, opendkim },
    ports: Object.fromEntries(Object.entries(portList).map(([k, p]) => [k, { port: p, listening: ports.has(p) }])),
    mailHost: getMailHost(),
    heloHost: getHeloHost(),
    publicIp: ip,
    setupCommand: `sudo MAIL_HOST=${getMailHost()} bash ${path.resolve(path.dirname(new URL(import.meta.url).pathname), '../scripts/setup-mail-server.sh')}`
  }
}

export function getClientSettings() {
  const host = getMailHost()
  return {
    incomingServer: host,
    imapPort: 993,
    imapSecurity: 'SSL/TLS',
    pop3Port: 995,
    pop3Security: 'SSL/TLS',
    outgoingServer: host,
    smtpPort: 587,
    smtpSecurity: 'STARTTLS',
    smtpsPort: 465,
    smtpsSecurity: 'SSL/TLS',
    username: 'Full email address',
    authentication: 'Normal password'
  }
}

// ---------------------------------------------------------------------------------------------
// Config sync (db.json -> Postfix / Dovecot / OpenDKIM)
// ---------------------------------------------------------------------------------------------

function writeFileAtomic(file, content, mode = 0o644) {
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, content, { mode })
  fs.renameSync(tmp, file)
}

const mailDir = (email) => {
  const [user, domain] = email.split('@')
  return path.join(VMAIL_ROOT, domain, user)
}

let syncChain = Promise.resolve()

/**
 * Regenerates every panel-managed mail map from db.json and reloads the daemons.
 * Calls are serialized so concurrent requests can't interleave file writes.
 */
export function syncMailConfig() {
  syncChain = syncChain.catch(() => {}).then(doSync)
  return syncChain
}

async function doSync() {
  const db = readDb()
  const domains = db.emailDomains || []
  const accounts = (db.emailAccounts || []).filter(a => a.passwordHash && a.status === 'active')

  const header = '# Managed by auto-deploy-panel — edits are overwritten\n'
  const domainMap = domains.map(d => `${d.domain} OK`).join('\n')
  const mailboxMap = accounts.map(a => `${a.email} ${a.domain}/${a.username}/`).join('\n')
  const senderMap = accounts.map(a => `${a.email} ${a.email}`).join('\n')
  // A catch-all (@domain) in virtual_alias_maps would also capture real mailboxes,
  // so each mailbox on a catch-all domain gets an identity alias first.
  const aliasLines = []
  for (const d of domains.filter(d => d.catchAll)) {
    for (const a of accounts.filter(a => a.domain === d.domain)) aliasLines.push(`${a.email} ${a.email}`)
    aliasLines.push(`@${d.domain} ${d.catchAll}`)
  }

  writeFileAtomic(`${POSTFIX_DIR}/panel_domains`, header + domainMap + '\n')
  writeFileAtomic(`${POSTFIX_DIR}/panel_mailboxes`, header + mailboxMap + '\n')
  writeFileAtomic(`${POSTFIX_DIR}/panel_sender_login`, header + senderMap + '\n')
  writeFileAtomic(`${POSTFIX_DIR}/panel_aliases`, header + aliasLines.join('\n') + '\n')
  for (const f of ['panel_domains', 'panel_mailboxes', 'panel_sender_login', 'panel_aliases']) {
    await run('postmap', [`${POSTFIX_DIR}/${f}`])
  }

  const users = accounts.map(a =>
    `${a.email}:{BLF-CRYPT}${a.passwordHash}::::::userdb_quota_rule=*:storage=${Number(a.quotaMb) || 1000}M`
  ).join('\n')
  writeFileAtomic(DOVECOT_USERS, users + '\n', 0o640)
  try {
    const gid = Number((await run('getent', ['group', 'dovecot'])).split(':')[2])
    fs.chownSync(DOVECOT_USERS, 0, gid)
  } catch { /* dovecot not installed yet */ }

  // DKIM tables (only domains whose key exists)
  if (fs.existsSync(path.join(DKIM_DIR, 'keys'))) {
    const keyed = domains.filter(d => fs.existsSync(path.join(DKIM_DIR, 'keys', d.domain, `${d.dkimSelector || DKIM_SELECTOR}.private`)))
    writeFileAtomic(path.join(DKIM_DIR, 'key.table'), keyed.map(d => {
      const sel = d.dkimSelector || DKIM_SELECTOR
      return `${sel}._domainkey.${d.domain} ${d.domain}:${sel}:${path.join(DKIM_DIR, 'keys', d.domain, `${sel}.private`)}`
    }).join('\n') + '\n')
    writeFileAtomic(path.join(DKIM_DIR, 'signing.table'), keyed.map(d =>
      `*@${d.domain} ${d.dkimSelector || DKIM_SELECTOR}._domainkey.${d.domain}`).join('\n') + '\n')
  }

  if (isConfigured()) {
    await run('postfix', ['reload']).catch(() => {})
    await run('systemctl', ['restart', 'opendkim']).catch(() => {})
  }
}

async function ensureDkimKey(domain, selector = DKIM_SELECTOR) {
  const dir = path.join(DKIM_DIR, 'keys', domain)
  if (fs.existsSync(path.join(dir, `${selector}.private`))) return
  if (!fs.existsSync('/usr/sbin/opendkim-genkey') && !fs.existsSync('/usr/bin/opendkim-genkey')) return // opendkim-tools missing
  fs.mkdirSync(dir, { recursive: true })
  await run('opendkim-genkey', ['-b', '2048', '-d', domain, '-s', selector, '-D', dir])
  await run('chown', ['-R', 'opendkim:opendkim', dir]).catch(() => {})
}

function readDkimPublicKey(domain, selector = DKIM_SELECTOR) {
  try {
    const txt = fs.readFileSync(path.join(DKIM_DIR, 'keys', domain, `${selector}.txt`), 'utf8')
    const joined = [...txt.matchAll(/"([^"]*)"/g)].map(m => m[1]).join('')
    return joined || null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------------------------
// Domains
// ---------------------------------------------------------------------------------------------

export function listDomains(orgId) {
  const db = readDb()
  const accounts = db.emailAccounts || []
  return (db.emailDomains || []).filter(d => inOrg(d, orgId)).map(d => ({
    ...d,
    mailboxes: accounts.filter(a => a.domain === d.domain).length,
    dkimReady: !!readDkimPublicKey(d.domain, d.dkimSelector)
  }))
}

export async function addDomain(domain, orgId) {
  domain = String(domain || '').trim().toLowerCase()
  if (!DOMAIN_REGEX.test(domain)) throw httpError(400, 'Enter a valid domain name, e.g. example.com')
  const db = readDb()
  db.emailDomains ||= []
  let record = db.emailDomains.find(d => d.domain === domain)
  if (record && !inOrg(record, orgId)) throw httpError(409, 'This domain is registered to another organization.')
  if (!record) {
    record = { domain, organizationId: orgId || 'org-default', dkimSelector: DKIM_SELECTOR, catchAll: null, createdAt: new Date().toISOString() }
    db.emailDomains.push(record)
    writeDb(db)
  }
  await ensureDkimKey(domain, record.dkimSelector)
  await syncMailConfig()
  return record
}

export async function updateDomain(domain, { catchAll }, orgId) {
  const db = readDb()
  const record = (db.emailDomains || []).find(d => d.domain === domain && inOrg(d, orgId))
  if (!record) throw httpError(404, 'Domain not found.')
  if (catchAll) {
    catchAll = String(catchAll).trim().toLowerCase()
    if (!EMAIL_REGEX.test(catchAll)) throw httpError(400, 'Catch-all destination must be an email address.')
  }
  record.catchAll = catchAll || null
  writeDb(db)
  await syncMailConfig()
  return record
}

export async function removeDomain(domain, orgId) {
  const db = readDb()
  const record = (db.emailDomains || []).find(d => d.domain === domain && inOrg(d, orgId))
  if (!record) throw httpError(404, 'Domain not found.')
  if ((db.emailAccounts || []).some(a => a.domain === domain)) throw httpError(409, 'Delete the mailboxes on this domain first.')
  db.emailDomains = db.emailDomains.filter(d => d !== record && d.domain !== domain)
  writeDb(db)
  await syncMailConfig()
  return { message: `Domain ${domain} removed.` }
}

const resolver = new dns.promises.Resolver({ timeout: 4000, tries: 2 })
resolver.setServers(['1.1.1.1', '8.8.8.8'])

const safeResolve = (fn) => fn.catch(() => [])

/**
 * DNS records required for the domain, compared against what public DNS currently returns.
 */
export async function getDnsRecords(domain, orgId) {
  const record = listDomains(orgId).find(d => d.domain === domain)
  if (!record) throw httpError(404, 'Domain not found.')
  const mailHost = getMailHost()
  const ip = await getPublicIp()
  const dkim = readDkimPublicKey(domain, record.dkimSelector)
  const selector = record.dkimSelector || DKIM_SELECTOR

  const [mx, txt, dmarc, dkimTxt, hostA, ptr] = await Promise.all([
    safeResolve(resolver.resolveMx(domain)),
    safeResolve(resolver.resolveTxt(domain)),
    safeResolve(resolver.resolveTxt(`_dmarc.${domain}`)),
    safeResolve(resolver.resolveTxt(`${selector}._domainkey.${domain}`)),
    safeResolve(resolver.resolve4(mailHost)),
    safeResolve(resolver.reverse(ip))
  ])
  const flat = (rows) => rows.map(r => r.join(''))
  const spf = flat(txt).find(t => t.toLowerCase().startsWith('v=spf1'))
  const dmarcVal = flat(dmarc).find(t => t.toLowerCase().startsWith('v=dmarc1'))
  const dkimVal = flat(dkimTxt).join('')
  const normKey = (s) => (s || '').replace(/\s+/g, '').match(/p=([^;]+)/)?.[1]

  return {
    domain,
    mailHost,
    publicIp: ip,
    records: [
      {
        purpose: 'Mail server address',
        type: 'A', host: mailHost, value: ip,
        current: hostA.join(', ') || null,
        ok: hostA.includes(ip)
      },
      {
        purpose: 'Receive mail (MX)',
        type: 'MX', host: domain, value: mailHost, priority: 10,
        current: mx.map(m => `${m.priority} ${m.exchange}`).join(', ') || null,
        ok: mx.some(m => m.exchange.toLowerCase() === mailHost.toLowerCase())
      },
      {
        purpose: 'SPF — authorize this server to send',
        type: 'TXT', host: domain, value: `v=spf1 mx a ip4:${ip} ~all`,
        current: spf || null,
        ok: !!spf && (spf.includes(ip) || /\bmx\b/.test(spf) || /\ba\b/.test(spf)),
        note: spf && !spf.includes(ip) ? 'Merge ip4:' + ip + ' into your existing SPF record — a domain may only have one.' : undefined
      },
      {
        purpose: 'DKIM — signature public key',
        type: 'TXT', host: `${selector}._domainkey.${domain}`, value: dkim || '(key not generated yet — run the mail server setup)',
        current: dkimVal || null,
        ok: !!dkim && normKey(dkimVal) === normKey(dkim)
      },
      {
        purpose: 'DMARC — policy for failed checks',
        type: 'TXT', host: `_dmarc.${domain}`, value: `v=DMARC1; p=quarantine; rua=mailto:postmaster@${domain}; adkim=r; aspf=r`,
        current: dmarcVal || null,
        ok: !!dmarcVal
      },
      {
        purpose: 'Reverse DNS (PTR) — set at your VPS provider',
        type: 'PTR', host: ip, value: getHeloHost(),
        current: ptr.join(', ') || null,
        ok: ptr.some(p => p.toLowerCase() === getHeloHost().toLowerCase())
      }
    ]
  }
}

// ---------------------------------------------------------------------------------------------
// Mailboxes
// ---------------------------------------------------------------------------------------------

async function dirSizeMb(dir) {
  try {
    const out = await run('du', ['-sk', dir], { timeout: 10000 })
    return Math.round(Number(out.split('\t')[0]) / 1024 * 10) / 10
  } catch {
    return 0
  }
}

const publicAccount = (a) => {
  const { passwordHash, ...rest } = a
  return { ...rest, hasPassword: !!passwordHash }
}

export async function listAccounts(orgId) {
  const accounts = (readDb().emailAccounts || []).filter(a => inOrg(a, orgId))
  return Promise.all(accounts.map(async a => ({ ...publicAccount(a), usedMb: await dirSizeMb(mailDir(a.email)) })))
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8) throw httpError(400, 'Password must be at least 8 characters.')
  if (password.length > 128 || /[\s:]/.test(password)) throw httpError(400, 'Password may not contain spaces or colons and must be at most 128 characters.')
}

export async function createAccount({ username, domain, password, quotaMb }, orgId) {
  username = String(username || '').trim().toLowerCase()
  domain = String(domain || '').trim().toLowerCase()
  if (!USERNAME_REGEX.test(username)) throw httpError(400, 'Username may contain letters, digits, dots, dashes, underscores and plus signs.')
  validatePassword(password)
  const quota = Math.min(Math.max(Number(quotaMb) || 1000, 50), 102400)

  await addDomain(domain, orgId) // registers the domain + DKIM key on first use
  const email = `${username}@${domain}`
  const db = readDb()
  db.emailAccounts ||= []
  const existing = db.emailAccounts.find(a => a.email === email)
  if (existing && existing.passwordHash) throw httpError(409, `${email} already exists.`)

  const account = existing || { id: `mail-${crypto.randomUUID()}`, email, username, domain, createdAt: new Date().toISOString() }
  Object.assign(account, {
    organizationId: account.organizationId || orgId || 'org-default',
    quotaMb: quota,
    passwordHash: bcrypt.hashSync(password, 10),
    status: 'active'
  })
  if (!existing) db.emailAccounts.push(account)
  writeDb(db)
  await syncMailConfig()
  return publicAccount(account)
}

function findAccount(db, idOrEmail, orgId) {
  const a = (db.emailAccounts || []).find(x => (x.id === idOrEmail || x.email === idOrEmail) && inOrg(x, orgId))
  if (!a) throw httpError(404, 'Mailbox not found.')
  return a
}

export async function updateAccount(idOrEmail, { password, quotaMb, status }, orgId) {
  const db = readDb()
  const account = findAccount(db, idOrEmail, orgId)
  if (password !== undefined && password !== '') {
    validatePassword(password)
    account.passwordHash = bcrypt.hashSync(password, 10)
    if (account.status !== 'suspended') account.status = 'active'
  }
  if (quotaMb !== undefined) account.quotaMb = Math.min(Math.max(Number(quotaMb) || 1000, 50), 102400)
  if (status === 'active' || status === 'suspended') {
    if (status === 'active' && !account.passwordHash) throw httpError(400, 'Set a password before activating this mailbox.')
    account.status = status
  }
  writeDb(db)
  await syncMailConfig()
  return publicAccount(account)
}

export async function deleteAccount(idOrEmail, orgId) {
  const db = readDb()
  const account = findAccount(db, idOrEmail, orgId)
  db.emailAccounts = db.emailAccounts.filter(a => a !== account)
  for (const d of db.emailDomains || []) if (d.catchAll === account.email) d.catchAll = null
  writeDb(db)
  await syncMailConfig()

  // Keep the mail data recoverable instead of deleting it outright
  const dir = mailDir(account.email)
  let archivedTo = null
  if (fs.existsSync(dir)) {
    archivedTo = path.join(VMAIL_ROOT, '.deleted', `${account.email}-${Date.now()}`)
    fs.mkdirSync(path.dirname(archivedTo), { recursive: true })
    fs.renameSync(dir, archivedTo)
  }
  return { message: `Mailbox ${account.email} deleted.${archivedTo ? ` Its mail was archived to ${archivedTo}.` : ''}` }
}

// ---------------------------------------------------------------------------------------------
// Webmail (reads the Maildir directly; the panel runs as root)
// ---------------------------------------------------------------------------------------------

function assertMailbox(email, orgId) {
  const account = findAccount(readDb(), email, orgId)
  return account
}

function ensureMaildir(dir) {
  for (const sub of ['cur', 'new', 'tmp']) fs.mkdirSync(path.join(dir, sub), { recursive: true })
  // Dovecot runs as vmail: hand over every directory from /var/vmail/<domain> downwards
  const owned = []
  for (let p = dir; p.startsWith(VMAIL_ROOT + '/'); p = path.dirname(p)) owned.push(p)
  for (const p of [...owned, ...['cur', 'new', 'tmp'].map(s => path.join(dir, s))]) {
    try { fs.chownSync(p, VMAIL_UID, VMAIL_UID) } catch { /* ignore */ }
  }
}

function folderDir(email, folder) {
  if (!(folder in FOLDERS)) throw httpError(400, 'Unknown folder.')
  return path.join(mailDir(email), FOLDERS[folder])
}

function listFolderFiles(dir) {
  const files = []
  for (const sub of ['new', 'cur']) {
    let names = []
    try { names = fs.readdirSync(path.join(dir, sub)) } catch { continue }
    for (const name of names) {
      const full = path.join(dir, sub, name)
      let st
      try { st = fs.statSync(full) } catch { continue }
      const flags = name.includes(':2,') ? name.split(':2,')[1] : ''
      files.push({ id: name.split(':')[0], sub, name, full, mtime: st.mtimeMs, size: st.size, seen: flags.includes('S'), flagged: flags.includes('F') })
    }
  }
  return files.sort((a, b) => b.mtime - a.mtime)
}

function findMessageFile(dir, id) {
  if (!/^[\w.,=-]+$/.test(id)) throw httpError(400, 'Invalid message id.')
  const f = listFolderFiles(dir).find(x => x.id === id)
  if (!f) throw httpError(404, 'Message not found.')
  return f
}

async function parseHeadersOnly(file) {
  const fd = fs.openSync(file, 'r')
  try {
    const buf = Buffer.alloc(Math.min(65536, fs.fstatSync(fd).size))
    fs.readSync(fd, buf, 0, buf.length, 0)
    const text = buf.toString('utf8')
    const end = text.search(/\r?\n\r?\n/)
    return simpleParser(end > 0 ? text.slice(0, end) + '\n\n' : text)
  } finally {
    fs.closeSync(fd)
  }
}

const addrText = (a) => a?.text || ''

export async function listMessages(email, { folder = 'inbox', page = 1, pageSize = 50, search = '' } = {}, orgId) {
  assertMailbox(email, orgId)
  const dir = folderDir(email, folder)
  let files = listFolderFiles(dir)
  const unread = files.filter(f => !f.seen).length
  page = Math.max(1, Number(page) || 1)
  pageSize = Math.min(100, Math.max(1, Number(pageSize) || 50))
  search = String(search || '').trim().toLowerCase()

  const summarize = async (f) => {
    const h = await parseHeadersOnly(f.full)
    return {
      id: f.id,
      from: addrText(h.from),
      to: addrText(h.to),
      subject: h.subject || '(No Subject)',
      date: (h.date || new Date(f.mtime)).toISOString(),
      size: f.size,
      read: f.seen,
      flagged: f.flagged
    }
  }

  let messages
  let total = files.length
  if (search) {
    const all = await Promise.all(files.slice(0, 2000).map(summarize))
    const matched = all.filter(m => `${m.from} ${m.to} ${m.subject}`.toLowerCase().includes(search))
    total = matched.length
    messages = matched.slice((page - 1) * pageSize, page * pageSize)
  } else {
    messages = await Promise.all(files.slice((page - 1) * pageSize, page * pageSize).map(summarize))
  }
  return { messages, total, unread, page, pageSize }
}

function setFlag(f, flag, on = true) {
  const flags = new Set((f.name.split(':2,')[1] || '').split(''))
  on ? flags.add(flag) : flags.delete(flag)
  const newName = `${f.id}:2,${[...flags].filter(Boolean).sort().join('')}`
  const target = path.join(path.dirname(path.dirname(f.full)), 'cur', newName)
  if (target !== f.full) fs.renameSync(f.full, target)
  return target
}

export async function getMessage(email, folder, id, orgId) {
  assertMailbox(email, orgId)
  const f = findMessageFile(folderDir(email, folder), id)
  const parsed = await simpleParser(fs.readFileSync(f.full))
  if (!f.seen) setFlag(f, 'S')
  return {
    id,
    folder,
    from: addrText(parsed.from),
    to: addrText(parsed.to),
    cc: addrText(parsed.cc),
    replyTo: addrText(parsed.replyTo),
    subject: parsed.subject || '(No Subject)',
    date: (parsed.date || new Date(f.mtime)).toISOString(),
    messageId: parsed.messageId || null,
    text: parsed.text || '',
    html: parsed.html || null,
    attachments: (parsed.attachments || []).map((a, i) => ({ index: i, filename: a.filename || `attachment-${i + 1}`, contentType: a.contentType, size: a.size })),
    authResults: parsed.headers.get('authentication-results') || null
  }
}

export async function getAttachment(email, folder, id, index, orgId) {
  assertMailbox(email, orgId)
  const f = findMessageFile(folderDir(email, folder), id)
  const parsed = await simpleParser(fs.readFileSync(f.full))
  const a = parsed.attachments?.[Number(index)]
  if (!a) throw httpError(404, 'Attachment not found.')
  return { filename: a.filename || 'attachment', contentType: a.contentType || 'application/octet-stream', content: a.content }
}

export async function markMessage(email, folder, id, { read }, orgId) {
  assertMailbox(email, orgId)
  const f = findMessageFile(folderDir(email, folder), id)
  setFlag(f, 'S', read !== false)
  return { message: 'Updated.' }
}

export async function deleteMessage(email, folder, id, orgId) {
  assertMailbox(email, orgId)
  const f = findMessageFile(folderDir(email, folder), id)
  if (folder === 'trash') {
    fs.unlinkSync(f.full)
    return { message: 'Message permanently deleted.' }
  }
  const trash = folderDir(email, 'trash')
  ensureMaildir(trash)
  fs.writeFileSync(path.join(trash, 'maildirfolder'), '')
  fs.renameSync(f.full, path.join(trash, 'cur', f.name.includes(':2,') ? f.name : `${f.name}:2,S`))
  return { message: 'Moved to Trash.' }
}

function storeInFolder(email, folder, raw, flags = 'S') {
  const dir = folderDir(email, folder)
  ensureMaildir(dir)
  if (folder !== 'inbox') {
    const marker = path.join(dir, 'maildirfolder')
    if (!fs.existsSync(marker)) fs.writeFileSync(marker, '')
  }
  const now = Date.now()
  const name = `${Math.floor(now / 1000)}.M${(now % 1000) * 1000}P${process.pid}R${crypto.randomBytes(4).toString('hex')}.${os.hostname()},S=${raw.length}:2,${flags}`
  const tmp = path.join(dir, 'tmp', name)
  fs.writeFileSync(tmp, raw)
  const final = path.join(dir, 'cur', name)
  fs.renameSync(tmp, final)
  try { fs.chownSync(final, VMAIL_UID, VMAIL_UID) } catch { /* ignore */ }
}

const splitAddresses = (v) => String(v || '').split(/[,;]/).map(s => s.trim()).filter(Boolean)
const bareAddress = (s) => (s.match(/<([^>]+)>/)?.[1] || s).trim()

/**
 * Sends through the local Postfix (DKIM-signed by the milter) and files a copy in Sent.
 */
export async function sendMessage({ from, fromName, to, cc, bcc, subject, text, html, inReplyTo, attachments }, orgId) {
  const account = assertMailbox(from, orgId)
  if (account.status !== 'active') throw httpError(400, 'This mailbox is not active.')
  const toList = splitAddresses(to)
  const ccList = splitAddresses(cc)
  const bccList = splitAddresses(bcc)
  const recipients = [...toList, ...ccList, ...bccList].map(bareAddress)
  if (!recipients.length) throw httpError(400, 'At least one recipient is required.')
  const bad = recipients.find(r => !EMAIL_REGEX.test(r))
  if (bad) throw httpError(400, `Invalid recipient address: ${bad}`)

  const mail = new MailComposer({
    from: fromName ? { name: fromName, address: account.email } : account.email,
    to: toList,
    cc: ccList.length ? ccList : undefined,
    subject: subject || '(No Subject)',
    text: text || '',
    html: html || undefined,
    inReplyTo: inReplyTo || undefined,
    references: inReplyTo || undefined,
    messageId: `<${crypto.randomUUID()}@${account.domain}>`,
    date: new Date(),
    attachments: (attachments || []).slice(0, 10).map(a => ({
      filename: String(a.filename || 'attachment'),
      content: Buffer.from(String(a.contentBase64 || ''), 'base64'),
      contentType: a.contentType || undefined
    }))
  })
  const raw = await new Promise((resolve, reject) => mail.compile().build((err, msg) => err ? reject(err) : resolve(msg)))

  await run(SENDMAIL, ['-i', '-f', account.email, '--', ...recipients], { input: raw })
  storeInFolder(account.email, 'sent', raw)
  return { message: `Message queued for delivery to ${recipients.join(', ')}. Check the delivery log for the result.` }
}

// ---------------------------------------------------------------------------------------------
// Delivery log
// ---------------------------------------------------------------------------------------------

export async function getDeliveryLog({ limit = 100, address = '' } = {}, orgId) {
  let lines = []
  try {
    lines = (await run('tail', ['-n', '5000', MAIL_LOG])).split('\n')
  } catch {
    return { entries: [], error: `Cannot read ${MAIL_LOG}` }
  }
  const fromById = new Map()
  const entries = []
  for (const line of lines) {
    const m = line.match(/^(\S+)\s+\S+\s+postfix\/[\w/-]+\[\d+\]:\s+([0-9A-F]{6,}|[0-9A-Za-z]{10,}):\s+(.*)$/)
    if (!m) continue
    const [, time, qid, rest] = m
    const from = rest.match(/^from=<([^>]*)>/)
    if (from) { fromById.set(qid, from[1]); continue }
    const st = rest.match(/^to=<([^>]*)>.*?relay=([^,]+),.*?status=(\w+)\s*(.*)$/)
    if (!st) continue
    entries.push({ time, queueId: qid, from: fromById.get(qid) || '', to: st[1], relay: st[2], status: st[3], detail: st[4].replace(/^\(|\)$/g, '') })
  }

  // Limit to addresses the caller's organization owns
  const db = readDb()
  const own = new Set((db.emailAccounts || []).filter(a => inOrg(a, orgId)).map(a => a.email))
  const ownDomains = new Set((db.emailDomains || []).filter(d => inOrg(d, orgId)).map(d => d.domain))
  const visible = (addr) => own.has(addr) || ownDomains.has(addr.split('@')[1])
  const needle = String(address || '').toLowerCase()
  const filtered = entries
    .filter(e => !isOrgScoped(orgId) || visible(e.from) || visible(e.to))
    .filter(e => !needle || e.from.toLowerCase().includes(needle) || e.to.toLowerCase().includes(needle))
  return { entries: filtered.slice(-Math.min(Number(limit) || 100, 500)).reverse() }
}

/**
 * One-time migration of the old JSON "webmail": registers the domains Postfix already
 * accepted mail for and marks old password-less accounts as needing a password.
 */
export function migrateLegacyEmail() {
  const db = readDb()
  if (db.emailMigratedAt) return
  db.emailDomains ||= []
  const legacyDomains = new Set((db.emailAccounts || []).map(a => a.domain))
  try {
    const m = fs.readFileSync(path.join(POSTFIX_DIR, 'main.cf'), 'utf8').match(/^virtual_alias_domains\s*=\s*(.+)$/m)
    if (m) m[1].split(/[\s,]+/).filter(Boolean).forEach(d => legacyDomains.add(d))
  } catch { /* ignore */ }
  for (const d of legacyDomains) {
    if (DOMAIN_REGEX.test(d) && !db.emailDomains.some(x => x.domain === d)) {
      db.emailDomains.push({ domain: d, organizationId: 'org-default', dkimSelector: DKIM_SELECTOR, catchAll: null, createdAt: new Date().toISOString() })
    }
  }
  for (const a of db.emailAccounts || []) {
    if (!a.passwordHash) a.status = 'needs_password'
    delete a.usedMb
  }
  delete db.emailMessages
  db.emailMigratedAt = new Date().toISOString()
  writeDb(db)
}

/**
 * Startup: migrate old data, make sure every domain has a DKIM key, regenerate the maps.
 */
export async function initMailService() {
  try {
    migrateLegacyEmail()
    for (const d of readDb().emailDomains || []) await ensureDkimKey(d.domain, d.dkimSelector || DKIM_SELECTOR)
    await syncMailConfig()
  } catch (err) {
    console.error('[MAIL SERVICE INIT]', err.message)
  }
}
