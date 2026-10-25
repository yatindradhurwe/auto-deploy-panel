import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

/**
 * Connect a DNS provider once per organization, then the panel writes DNS itself — users never
 * edit DNS by hand: the email records (MX, SPF, DKIM, DMARC) for every mail domain, and the A
 * record of every domain or subdomain a project is deployed to.
 *
 * Providers: Hostinger (developers.hostinger.com DNS API) and Cloudflare.
 * Stored in data/dns-providers.json (mode 0600) because it holds API tokens; tokens are never
 * returned to the browser.
 *
 * Records are merged, never blindly replaced: other TXT records (site verification etc.) are
 * kept, an existing SPF record gets our server added to it, an existing DMARC policy is left
 * alone, and an MX pointing at another mail service is only replaced when asked to.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FILE = process.env.AUTODEPLOY_DNS_PROVIDERS_PATH || path.resolve(__dirname, '../data/dns-providers.json')
const TIMEOUT = 20000
const TTL = 3600

const httpError = (status, message) => Object.assign(new Error(message), { status })

export const PROVIDERS = {
  hostinger: { label: 'Hostinger', tokenHelp: 'hPanel → Account (profile icon) → API → Generate token', tokenUrl: 'https://hpanel.hostinger.com/profile/api' },
  cloudflare: { label: 'Cloudflare', tokenHelp: 'Cloudflare → My Profile → API Tokens → Create Token → "Edit zone DNS" template (all zones)', tokenUrl: 'https://dash.cloudflare.com/profile/api-tokens' }
}

// ---------------------------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------------------------

function readAll() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return {} }
}

function writeAll(all) {
  const tmp = `${FILE}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, FILE)
}

const orgKey = (orgId) => orgId || 'org-default'

export function getConnection(orgId) {
  return readAll()[orgKey(orgId)] || null
}

/** What the browser may see. */
export function publicConnection(orgId) {
  const c = getConnection(orgId)
  if (!c) return { connected: false, providers: PROVIDERS }
  return {
    connected: true,
    provider: c.provider,
    label: PROVIDERS[c.provider]?.label || c.provider,
    tokenHint: `…${String(c.token).slice(-4)}`,
    zones: c.zones || [],
    connectedAt: c.connectedAt,
    providers: PROVIDERS
  }
}

export async function connect(orgId, { provider, token }, userId) {
  if (!PROVIDERS[provider]) throw httpError(400, 'Choose Hostinger or Cloudflare.')
  token = String(token || '').trim()
  if (token.length < 20 || /\s/.test(token)) throw httpError(400, 'Paste the full API token.')
  const api = adapter(provider, token)
  const zones = await api.listZones() // proves the token works
  if (!zones.length) throw httpError(400, `The token works, but no domains were found in this ${PROVIDERS[provider].label} account.`)
  const all = readAll()
  all[orgKey(orgId)] = { provider, token, zones, connectedAt: new Date().toISOString(), connectedBy: userId }
  writeAll(all)
  return publicConnection(orgId)
}

export function disconnect(orgId) {
  const all = readAll()
  delete all[orgKey(orgId)]
  writeAll(all)
  return { connected: false, providers: PROVIDERS }
}

// ---------------------------------------------------------------------------------------------
// Provider adapters — common shape:
//   listZones() -> ['example.com', …]
//   getRecords(zone) -> [{ name: '@'|'sub', type, contents: [raw content…] }]
//   setRecords(zone, name, type, contents, ttl?)  replaces exactly that name+type set
//   deleteRecords(zone, name, type)  removes that name+type set
// MX contents are "PRIORITY HOST" everywhere.
// ---------------------------------------------------------------------------------------------

async function request(url, { method = 'GET', token, body } = {}) {
  let res
  try {
    res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT)
    })
  } catch (e) {
    throw httpError(502, `Could not reach the DNS provider: ${e.message}`)
  }
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { /* not JSON */ }
  if (res.status === 401 || res.status === 403) throw httpError(400, 'The DNS provider rejected the API token. Check it has DNS access and has not expired.')
  if (!res.ok) {
    const msg = data?.message || data?.errors?.[0]?.message || data?.error || text.slice(0, 200)
    throw httpError(502, `DNS provider error ${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`)
  }
  return data
}

const stripDot = (s) => String(s || '').replace(/\.$/, '')

function hostinger(token) {
  const base = 'https://developers.hostinger.com/api'
  return {
    async listZones() {
      const list = await request(`${base}/domains/v1/portfolio`, { token })
      return (Array.isArray(list) ? list : []).filter(d => d.domain && d.status === 'active').map(d => d.domain.toLowerCase())
    },
    async getRecords(zone) {
      const list = await request(`${base}/dns/v1/zones/${encodeURIComponent(zone)}`, { token })
      return (Array.isArray(list) ? list : []).map(r => ({
        name: r.name || '@',
        type: r.type,
        contents: (r.records || []).filter(x => !x.is_disabled).map(x => x.content)
      }))
    },
    async setRecords(zone, name, type, contents, ttl = TTL) {
      const body = { overwrite: true, zone: [{ name, type, ttl, records: contents.map(content => ({ content })) }] }
      await request(`${base}/dns/v1/zones/${encodeURIComponent(zone)}/validate`, { method: 'POST', token, body })
      await request(`${base}/dns/v1/zones/${encodeURIComponent(zone)}`, { method: 'PUT', token, body })
    },
    async deleteRecords(zone, name, type) {
      await request(`${base}/dns/v1/zones/${encodeURIComponent(zone)}`, { method: 'DELETE', token, body: { filters: [{ name, type }] } })
    }
  }
}

function cloudflare(token) {
  const base = 'https://api.cloudflare.com/client/v4'
  const ids = new Map()
  const zoneId = async (zone) => {
    if (!ids.has(zone)) {
      const r = await request(`${base}/zones?name=${encodeURIComponent(zone)}`, { token })
      const id = r?.result?.[0]?.id
      if (!id) throw httpError(404, `${zone} is not in this Cloudflare account.`)
      ids.set(zone, id)
    }
    return ids.get(zone)
  }
  const fqdn = (zone, name) => (name === '@' ? zone : `${name}.${zone}`)
  const rel = (zone, full) => (full === zone ? '@' : full.slice(0, -(zone.length + 1)))
  const listRaw = async (zone, name, type) => {
    const r = await request(`${base}/zones/${await zoneId(zone)}/dns_records?per_page=500${name ? `&name=${encodeURIComponent(fqdn(zone, name))}&type=${type}` : ''}`, { token })
    return r?.result || []
  }
  const content = (r) => (r.type === 'MX' ? `${r.priority} ${r.content}` : r.content)
  return {
    async listZones() {
      const r = await request(`${base}/zones?per_page=50&status=active`, { token })
      return (r?.result || []).map(z => z.name.toLowerCase())
    },
    async getRecords(zone) {
      const groups = new Map()
      for (const r of await listRaw(zone)) {
        const key = `${r.name} ${r.type}`
        if (!groups.has(key)) groups.set(key, { name: rel(zone, r.name), type: r.type, contents: [] })
        groups.get(key).contents.push(content(r))
      }
      return [...groups.values()]
    },
    async setRecords(zone, name, type, contents, ttl = TTL) {
      const id = await zoneId(zone)
      const existing = await listRaw(zone, name, type)
      const want = new Set(contents)
      for (const r of existing) {
        if (!want.has(content(r))) await request(`${base}/zones/${id}/dns_records/${r.id}`, { method: 'DELETE', token })
        else want.delete(content(r))
      }
      for (const c of want) {
        const rec = { type, name: fqdn(zone, name), ttl }
        if (type === 'MX') { const [p, h] = c.split(/\s+/); Object.assign(rec, { priority: Number(p), content: stripDot(h) }) } else rec.content = c
        await request(`${base}/zones/${id}/dns_records`, { method: 'POST', token, body: rec })
      }
    },
    async deleteRecords(zone, name, type) {
      const id = await zoneId(zone)
      for (const r of await listRaw(zone, name, type)) await request(`${base}/zones/${id}/dns_records/${r.id}`, { method: 'DELETE', token })
    }
  }
}

function adapter(provider, token) {
  return provider === 'cloudflare' ? cloudflare(token) : hostinger(token)
}

// ---------------------------------------------------------------------------------------------
// Email DNS for one domain
// ---------------------------------------------------------------------------------------------

const unquote = (s) => String(s || '').trim().replace(/^"([\s\S]*)"$/, '$1').replace(/"\s*"/g, '')
const isSpf = (c) => /^v=spf1\b/i.test(unquote(c))
const isDmarc = (c) => /^v=dmarc1\b/i.test(unquote(c))
const mxHost = (c) => stripDot(String(c).trim().split(/\s+/).pop()).toLowerCase()

/** Adds our sending IPs to an SPF record, keeping everything else in it. */
export function mergeSpf(existing, ips) {
  const tokens = existing ? unquote(existing).split(/\s+/).filter(Boolean) : ['v=spf1', '~all']
  const allIdx = tokens.findIndex(t => /^[~?+-]?all$/i.test(t) || /^redirect=/i.test(t))
  const missing = ips.filter(m => !tokens.some(t => t.toLowerCase() === m.toLowerCase()))
  if (!missing.length) return null
  tokens.splice(allIdx === -1 ? tokens.length : allIdx, 0, ...missing)
  if (allIdx === -1 && !tokens.some(t => /^redirect=/i.test(t))) tokens.push('~all')
  return tokens.join(' ')
}

function findZone(zones, domain) {
  return [...zones].sort((a, b) => b.length - a.length).find(z => domain === z || domain.endsWith(`.${z}`)) || null
}

/** The connected account's domains, re-read from the provider when asked (it may have gained some). */
export async function listZones(orgId, { refresh = false } = {}) {
  const conn = getConnection(orgId)
  if (!conn) return []
  if (!refresh) return conn.zones || []
  const zones = await adapter(conn.provider, conn.token).listZones()
  const all = readAll(); if (all[orgKey(orgId)]) { all[orgKey(orgId)].zones = zones; writeAll(all) }
  return zones
}

/** { conn, api, zone, name } for a domain in the connected account; throws when it isn't there. */
async function locate(orgId, domain) {
  const conn = getConnection(orgId)
  if (!conn) throw httpError(400, 'Connect your DNS provider first.')
  let zone = findZone(conn.zones || [], domain)
  if (!zone) zone = findZone(await listZones(orgId, { refresh: true }), domain)
  if (!zone) throw httpError(404, `${domain} is not managed in the connected ${PROVIDERS[conn.provider].label} account, so its DNS can't be set automatically.`)
  return { conn, api: adapter(conn.provider, conn.token), zone, name: domain === zone ? '@' : domain.slice(0, -(zone.length + 1)) }
}

// ---------------------------------------------------------------------------------------------
// Website DNS: point a domain or subdomain at a server (like Vercel's "add domain")
// ---------------------------------------------------------------------------------------------

const SITE_TTL = 300 // short, so a moved site follows quickly

/**
 * What the domain points to now: { zone, name, a, aaaa, cname, status, detail }
 * status: 'free' (no records) | 'here' (already this server) | 'taken' (points elsewhere)
 */
export async function inspectHost(orgId, domain, ipv4 = null) {
  const { zone, name, api } = await locate(orgId, domain)
  const records = await api.getRecords(zone)
  const get = (t) => records.find(r => r.name === name && r.type === t)?.contents || []
  const a = get('A')
  const aaaa = get('AAAA')
  const cname = get('CNAME').map(stripDot)
  let status = 'free'
  let detail = `${domain} is free — it will be pointed at your server.`
  if (ipv4 && a.length && a.every(ip => ip === ipv4) && !cname.length) {
    status = 'here'
    detail = `${domain} already points to this server.`
  } else if (a.length || aaaa.length || cname.length) {
    status = 'taken'
    detail = `${domain} already points to ${[...a, ...aaaa, ...cname].join(', ')}.`
  }
  return { zone, name, a, aaaa, cname, status, detail }
}

/**
 * Creates/updates the A record of `domain` so it points at `ipv4`.
 * A domain already pointing elsewhere is only taken over with { replace: true }; then its old
 * A/AAAA/CNAME records are replaced (a leftover AAAA would send IPv6 visitors and Let's Encrypt
 * to the old host).
 * Returns { zone, action: 'added'|'updated'|'ok', detail }
 */
export async function pointHost(orgId, domain, ipv4, { replace = false } = {}) {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(String(ipv4 || ''))) throw httpError(400, `Could not determine the server's public IPv4 address (got "${ipv4 || 'nothing'}").`)
  const { conn, api, zone, name } = await locate(orgId, domain)
  const now = await inspectHost(orgId, domain, ipv4)
  const label = PROVIDERS[conn.provider].label
  if (now.status === 'here') return { zone, provider: label, action: 'ok', detail: now.detail }
  if (now.status === 'taken' && !replace) {
    throw httpError(409, `${now.detail} Choose another subdomain, or tick "Replace an existing site" to point it at this server.`)
  }
  if (now.cname.length) await api.deleteRecords(zone, name, 'CNAME')
  if (now.aaaa.length) await api.deleteRecords(zone, name, 'AAAA')
  await api.setRecords(zone, name, 'A', [ipv4], SITE_TTL)
  return {
    zone,
    provider: label,
    action: now.status === 'free' ? 'added' : 'updated',
    detail: now.status === 'free' ? `${domain} → ${ipv4} (A record added in ${label})` : `${domain} moved from ${[...now.a, ...now.aaaa, ...now.cname].join(', ')} to ${ipv4}`
  }
}

/**
 * Writes MX/SPF/DKIM/DMARC for `domain` through the connected provider.
 * plan = { mailHost, ipv4, ipv6, dkim, selector, dmarc }
 * Returns [{ record, action: 'added'|'updated'|'ok'|'skipped', detail }]
 */
export async function applyEmailDns(orgId, domain, plan, { takeOverMx = false } = {}) {
  if (!getConnection(orgId)) throw httpError(400, 'Connect your DNS provider first (Email → Domains & DNS → Connect DNS provider).')
  const { conn, api, zone, name } = await locate(orgId, domain)
  const sub = (prefix) => (name === '@' ? prefix : `${prefix}.${name}`)
  const records = await api.getRecords(zone)
  const get = (n, t) => records.find(r => r.name === n && r.type === t)?.contents || []
  const results = []
  const write = async (record, n, type, contents, action, detail) => {
    await api.setRecords(zone, n, type, contents)
    results.push({ record, action, detail })
  }

  // MX — receive mail on this server
  const mx = get(name, 'MX')
  const ourMx = `10 ${plan.mailHost}`
  if (mx.some(c => mxHost(c) === plan.mailHost.toLowerCase())) results.push({ record: 'MX', action: 'ok', detail: `Mail is received by ${plan.mailHost}` })
  else if (!mx.length) await write('MX', name, 'MX', [ourMx], 'added', `Mail for ${domain} is received by ${plan.mailHost}`)
  else if (takeOverMx) await write('MX', name, 'MX', [ourMx], 'updated', `Moved receiving from ${mx.map(mxHost).join(', ')} to ${plan.mailHost}`)
  else results.push({ record: 'MX', action: 'skipped', detail: `Mail for ${domain} is received by ${mx.map(mxHost).join(', ')}; left unchanged` })

  // SPF — allow this server to send (merged into the one SPF record a domain may have)
  const txt = get(name, 'TXT')
  const spf = txt.find(isSpf)
  const ips = [`ip4:${plan.ipv4}`, ...(plan.ipv6 ? [`ip6:${plan.ipv6}`] : [])]
  const merged = mergeSpf(spf, ips)
  if (!merged) results.push({ record: 'SPF', action: 'ok', detail: 'This server is already allowed to send' })
  else await write('SPF', name, 'TXT', [...txt.filter(c => !isSpf(c)), merged], spf ? 'updated' : 'added', merged)

  // DKIM — this server's signing key
  if (!plan.dkim) results.push({ record: 'DKIM', action: 'skipped', detail: 'No DKIM key on the server yet — set up the mail server first' })
  else {
    const dkimName = sub(`${plan.selector}._domainkey`)
    const key = (s) => unquote(s).replace(/\s+/g, '').match(/p=([^;]+)/)?.[1]
    if (get(dkimName, 'TXT').some(c => key(c) === key(plan.dkim))) results.push({ record: 'DKIM', action: 'ok', detail: 'Signing key published' })
    else await write('DKIM', dkimName, 'TXT', [plan.dkim], get(dkimName, 'TXT').length ? 'updated' : 'added', `${dkimName}.${zone}`)
  }

  // DMARC — only where none exists; a subdomain inherits the main domain's policy
  const dmarcHere = get(sub('_dmarc'), 'TXT').some(isDmarc)
  const dmarcApex = get('_dmarc', 'TXT').some(isDmarc)
  if (dmarcHere || (name !== '@' && dmarcApex)) results.push({ record: 'DMARC', action: 'ok', detail: dmarcHere ? 'Policy already published' : `Covered by _dmarc.${zone}` })
  else await write('DMARC', sub('_dmarc'), 'TXT', [plan.dmarc], 'added', plan.dmarc)

  return { domain, zone, provider: PROVIDERS[conn.provider].label, results }
}
