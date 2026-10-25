import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { analyzeProject, manifestPaths } from './detector.service.js'
import { getReadyUpload, validateGitUrl, withGithubToken, redactUrl } from './upload.service.js'
import { templateDeploySource } from './template.service.js'
import { findMysqlAdmin, checkDbPassword, RESERVED_DB_USERS, migrateExternalPostgres } from './database.service.js'
import { migrateSupabaseStorage, publicBucketLocations, supabaseProjectUrl } from './supabase-storage.service.js'
import { setupSupabaseStack, normalizeAuthConfig, supabaseEnvLayer, rewriteBuildScript, REF_RE } from './supabase-stack.service.js'

/**
 * 1-click deployment pipeline (GitHub or uploaded source, optional database — new, uploaded or
 * migrated from Supabase / another PostgreSQL, with Supabase Storage files and, optionally, the
 * project's Auth, REST, Storage and Edge Functions APIs run on the server) on the selected server,
 * through its host executor (direct on the panel host, SSH for connected servers).
 *
 * Progress is reported as weighted stages so the UI can show an honest percentage:
 *   emit({ kind: 'stage', id, status: 'running'|'done'|'skipped'|'failed'|'warning', label, detail })
 *   emit({ kind: 'log', stage, text, isError })
 *   emit({ kind: 'progress', percent })
 *   emit({ kind: 'result', status: 'success'|'failed', url, summary })
 * Every value that reaches a shell is validated and single-quoted; file contents are sent base64-encoded.
 */

export const STAGES = [
  { id: 'connect', label: 'Connecting to server', weight: 4 },
  { id: 'dns', label: 'Pointing the domain', weight: 2 },
  { id: 'source', label: 'Getting source code', weight: 12 },
  { id: 'analyze', label: 'Detecting app type', weight: 4 },
  { id: 'database', label: 'Setting up database', weight: 10 },
  { id: 'storage', label: 'Copying storage files', weight: 6 },
  { id: 'supabase', label: 'Starting Supabase services', weight: 8 },
  { id: 'env', label: 'Writing configuration', weight: 3 },
  { id: 'install', label: 'Installing dependencies', weight: 26 },
  { id: 'build', label: 'Building app', weight: 18 },
  { id: 'service', label: 'Starting app', weight: 8 },
  { id: 'webserver', label: 'Configuring web server', weight: 6 },
  { id: 'ssl', label: 'Securing with HTTPS', weight: 6 },
  { id: 'verify', label: 'Checking the live site', weight: 3 }
]

const SYSTEM_PATH = 'export PATH="$PATH:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"; [ -d "$HOME/.nvm/versions/node" ] && export PATH="$PATH:$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node | tail -n 1)/bin"'
const DOMAIN_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/
const APP_RE = /^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/
const TYPES = ['static', 'spa', 'node-ssr', 'node-server', 'fullstack', 'php', 'python', 'go', 'java', 'ruby']

const httpError = (status, message) => Object.assign(new Error(message), { status })
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`
const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64')
// Loads .env literally (values are never executed); used by the PM2 runner and one-off app commands
export const loadEnv = `if [ -f .env ]; then while IFS= read -r line || [ -n "$line" ]; do case "$line" in ''|'#'*) continue;; esac; k="\${line%%=*}"; v="\${line#*=}"; v="\${v%\\"}"; v="\${v#\\"}"; export "$k=$v"; done < .env; fi`
// Prints pip requirement lines from pyproject.toml (PEP 621 or Poetry) or a Pipfile, so apps that
// are not installable packages still get their dependencies. Exit 3: no TOML parser (Python < 3.11).
const PY_DEPS = `import sys
try:
    import tomllib
except ImportError:
    try:
        import tomli as tomllib
    except ImportError:
        sys.exit(3)

def spec(v):
    v = (v or '').strip()
    if v in ('', '*'):
        return ''
    if v[0] in '^~' and v[1:2] != '=':
        return '>=' + v[1:]
    return '==' + v if v[0].isdigit() else v

def entry(name, v):
    if isinstance(v, dict):
        if v.get('git'):
            ref = v.get('rev') or v.get('tag') or v.get('branch')
            return name + ' @ git+' + v['git'] + ('@' + ref if ref else '')
        if v.get('path') or v.get('url') or v.get('file'):
            return None
        if v.get('extras'):
            name += '[' + ','.join(v['extras']) + ']'
        v = v.get('version', '')
    return name + spec(v)

reqs = []
if sys.argv[1] == 'Pipfile':
    d = tomllib.load(open('Pipfile', 'rb'))
    reqs += [entry(n, v) for n, v in d.get('packages', {}).items()]
else:
    d = tomllib.load(open('pyproject.toml', 'rb'))
    reqs += d.get('project', {}).get('dependencies', [])
    reqs += [entry(n, v) for n, v in d.get('tool', {}).get('poetry', {}).get('dependencies', {}).items() if n.lower() != 'python']
print('\\n'.join(r for r in reqs if r))
`

// Prints the PHP-FPM address nginx should use: a unix socket, or a TCP pool (control panels such as
// CloudPanel run their default pools on 127.0.0.1:<port>). Prefers the PHP version of the php CLI.
const FIND_PHP_FPM = `v=$(php -r 'echo PHP_MAJOR_VERSION.".".PHP_MINOR_VERSION;' 2>/dev/null)
for s in /run/php/php$v-fpm.sock $(ls /run/php/php*-fpm.sock /var/run/php/php*-fpm.sock /run/php-fpm/www.sock 2>/dev/null | sort -rV); do [ -S "$s" ] && echo "unix:$s" && exit 0; done
LISTENING=$(ss -ltnH 2>/dev/null | awk '{print $4}')
for f in /etc/php/$v/fpm/pool.d/www.conf /etc/php/$v/fpm/pool.d/default.conf $(ls /etc/php/*/fpm/pool.d/www.conf /etc/php/*/fpm/pool.d/default.conf /etc/php-fpm.d/www.conf 2>/dev/null | sort -rV); do
  [ -f "$f" ] || continue
  l=$(sed -n 's/^[[:space:]]*listen[[:space:]]*=[[:space:]]*//p' "$f" | head -1 | tr -d ' "')
  case "$l" in
    /*) [ -S "$l" ] && echo "unix:$l" && exit 0 ;;
    *:*) echo "$LISTENING" | grep -qx "$l" && echo "$l" && exit 0 ;;
    [0-9]*) echo "$LISTENING" | grep -qE "(^|:)$l$" && echo "127.0.0.1:$l" && exit 0 ;;
  esac
done
exit 0`

const randomPassword = () => crypto.randomBytes(18).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 24)

/** Commands from the wizard's "advanced" overrides: a single line without shell control chars. */
function safeCommand(cmd, label) {
  if (cmd === undefined || cmd === null || cmd === '') return null
  cmd = String(cmd).trim()
  if (cmd.length > 300 || /[\n\r`$;|&<>]/.test(cmd)) throw httpError(400, `${label} may not contain ; | & $ < > or backticks (one plain command).`)
  return cmd
}

function safeRelDir(dir, label) {
  if (!dir) return ''
  dir = String(dir).trim().replace(/^\.\/|\/+$/g, '')
  if (!/^[A-Za-z0-9._\/-]{1,120}$/.test(dir) || dir.split('/').includes('..') || dir.startsWith('/')) throw httpError(400, `Invalid ${label}.`)
  return dir
}

/**
 * Validates and normalises the wizard payload. Throws 400 with a readable message.
 */
export function validateDeployConfig(body, userId, server = null) {
  const appName = String(body.appName || '').trim().toLowerCase()
  if (!APP_RE.test(appName)) throw httpError(400, 'App name: 2–50 lowercase letters, numbers and dashes.')
  const domain = String(body.domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  if (!DOMAIN_RE.test(domain)) throw httpError(400, 'Enter a valid domain, e.g. app.example.com.')

  const source = body.source || {}
  let src
  let templateId = null
  if (source.type === 'template') {
    // Marketplace template (Git repo or archive uploaded by the platform team)
    const resolved = templateDeploySource(source.templateId, { allowDraft: !!body._allowDraftTemplate })
    src = resolved.src
    templateId = resolved.templateId
  } else if (source.type === 'upload') {
    const up = getReadyUpload(source.uploadId, userId, 'source')
    src = { type: 'upload', file: up.file, ext: up.ext, name: up.name }
  } else if (source.type === 'github' || source.type === 'git') {
    const branch = String(source.branch || 'main').trim()
    if (!/^[A-Za-z0-9._\/-]{1,100}$/.test(branch)) throw httpError(400, 'Invalid branch name.')
    src = { type: 'git', gitUrl: validateGitUrl(source.gitUrl), branch }
  } else {
    throw httpError(400, 'Choose a source: GitHub or an uploaded archive.')
  }

  const o = body.overrides || {}
  const overrides = {
    type: o.type && o.type !== 'auto' ? (TYPES.includes(o.type) ? o.type : (() => { throw httpError(400, 'Unknown app type.') })()) : null,
    buildCommand: safeCommand(o.buildCommand, 'Build command'),
    startCommand: safeCommand(o.startCommand, 'Start command'),
    outputDir: o.outputDir ? safeRelDir(o.outputDir, 'output folder') : null,
    appDir: o.appDir ? safeRelDir(o.appDir, 'app folder') : null
  }

  const port = body.port ? Number(body.port) : null
  if (port !== null && (!Number.isInteger(port) || port < 1024 || port > 65000)) throw httpError(400, 'Port must be between 1024 and 65000.')

  const envVars = String(body.envVars || '')
  if (envVars.length > 50000) throw httpError(400, 'Environment variables are too long.')

  const dbIn = body.database || {}
  let database = { mode: 'none' }
  if (dbIn.mode === 'migrate') {
    // An existing PostgreSQL database (Supabase, Neon, RDS, …) copied onto the server, and optionally
    // the Supabase project's Storage files. The source URL and key are used for this deploy only.
    const url = String(dbIn.sourceUrl || '').trim()
    if (!/^postgres(ql)?:\/\/./i.test(url)) throw httpError(400, 'Paste the connection string of the database to migrate (postgresql://user:password@host:5432/postgres).')
    if (url.length > 2000) throw httpError(400, 'The connection string is too long.')
    database = { mode: 'migrate', engine: 'postgresql', sourceUrl: url, includeAuth: dbIn.includeAuth !== false }
    if (dbIn.storage?.url || dbIn.storage?.key) {
      database.storage = { url: supabaseProjectUrl(dbIn.storage.url), key: String(dbIn.storage.key || '').trim() }
      if (!database.storage.key) throw httpError(400, 'Enter the Supabase service_role (secret) key to copy Storage files, or clear the project URL.')
    }
    if (dbIn.supabase?.enabled) database.supabase = validateSupabaseStack(dbIn.supabase, url, database.storage)
  }
  if (dbIn.mode === 'create' || dbIn.mode === 'import' || dbIn.mode === 'migrate') {
    const engine = dbIn.mode === 'migrate' ? 'postgresql' : dbIn.engine
    if (!['postgresql', 'mysql', 'mongodb', 'sqlite'].includes(engine)) throw httpError(400, 'Choose a database engine.')
    if (dbIn.mode !== 'migrate') database = { mode: dbIn.mode, engine }
    if (dbIn.mode === 'import') {
      const up = getReadyUpload(dbIn.uploadId, userId, 'database')
      database.file = up.file
      database.ext = up.ext
      database.fileName = up.name
      database.format = up.database?.format
      if (up.database?.engine && up.database.engine !== engine) throw httpError(400, `The uploaded file is a ${up.database.engine} dump, but ${engine} was selected.`)
      if (engine === 'mongodb') throw httpError(400, 'Importing into MongoDB is not supported yet — choose "Create empty database" and restore with mongorestore.')
    }
    if (engine === 'mysql' && dbIn.adminUser) {
      const adminUser = String(dbIn.adminUser).trim()
      if (!/^[A-Za-z0-9_.-]{1,32}$/.test(adminUser)) throw httpError(400, 'Invalid MySQL admin user.')
      database.adminUser = adminUser
      database.adminPassword = String(dbIn.adminPassword || '')
    }
    // Optional name/user/password for the new database (generated when left empty)
    if (engine === 'mysql' || engine === 'postgresql') {
      const name = String(dbIn.name || '').trim()
      const user = String(dbIn.user || '').trim()
      const password = String(dbIn.password || '')
      if (name && !/^[A-Za-z0-9_]{1,64}$/.test(name)) throw httpError(400, 'Database name: up to 64 letters, numbers and underscores.')
      if (user && !/^[A-Za-z0-9_]{1,32}$/.test(user)) throw httpError(400, 'Database user: up to 32 letters, numbers and underscores.')
      if (user && (RESERVED_DB_USERS.has(user.toLowerCase()) || user === database.adminUser)) throw httpError(400, `"${user}" is a system/admin account — choose a separate user for the app.`)
      if (password) checkDbPassword(password)
      if (name) database.name = name
      if (user) database.user = user
      if (password) database.password = password
    }
  }

  const email = String(body.sslEmail || '').trim()
  return {
    templateId,
    appName,
    domain,
    remoteDir: `/var/www/${appName}`,
    source: src,
    overrides,
    port,
    envVars,
    database,
    ssl: body.ssl !== false,
    sslEmail: /^[^\s@'"]+@[^\s@'"]+\.[a-z]{2,}$/i.test(email) ? email : null,
    replaceDomain: !!body.replaceDomain,
    // Create the domain's A record through the organization's connected DNS provider
    autoDns: body.autoDns === true,
    githubToken: body._githubToken || null,
    server
  }
}

const JWT_RE = /^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/

/**
 * "Run Supabase on this server" options of a migration: the project ref (from the form, the Storage
 * URL or the pooler login), the project's JWT secret and keys (to keep them valid), its Auth
 * settings, the Edge Functions' secrets and the functions deployed with verify_jwt = false.
 */
function validateSupabaseStack(sb, sourceUrl, storage) {
  let ref = String(sb.ref || '').trim().toLowerCase()
  if (!ref && storage?.url) ref = /^https:\/\/([a-z0-9]+)\.supabase\.co$/.exec(storage.url)?.[1] || ''
  if (!ref) {
    try {
      const u = new URL(sourceUrl)
      ref = (/^postgres\.([a-z0-9]{8,40})$/.exec(decodeURIComponent(u.username)) || /^db\.([a-z0-9]{8,40})\.supabase\.co$/.exec(u.hostname) || [])[1] || ''
    } catch { /* checked elsewhere */ }
  }
  if (ref && !REF_RE.test(ref)) throw httpError(400, 'Invalid Supabase project reference.')
  const jwtSecret = String(sb.jwtSecret || '').trim()
  if (jwtSecret && (!/^\S{32,512}$/.test(jwtSecret))) throw httpError(400, 'The JWT secret must be 32 or more characters without spaces (Supabase → Project Settings → JWT Keys → Legacy JWT secret).')
  const keys = sb.keys && JWT_RE.test(sb.keys.anon || '') && JWT_RE.test(sb.keys.service_role || '') ? { anon: sb.keys.anon, service_role: sb.keys.service_role } : null
  const secretsText = String(sb.functionSecrets || '')
  if (secretsText.length > 50000) throw httpError(400, 'The Edge Function secrets are too long.')
  const noVerifyJwt = (Array.isArray(sb.noVerifyJwt) ? sb.noVerifyJwt : []).map(String).filter(n => /^[A-Za-z0-9_-]{1,100}$/.test(n)).slice(0, 200)
  return {
    ref: ref || null,
    jwtSecret: jwtSecret || null,
    sourceKeys: keys,
    auth: normalizeAuthConfig(sb.auth || {}),
    functionSecrets: parseEnv(secretsText).map(([k, v]) => [k, envValue(v)]),
    noVerifyJwt
  }
}

function parseEnv(text) {
  const out = []
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (m) out.push([m[1], m[2]])
  }
  return out
}

function mergeEnv(...layers) {
  const map = new Map()
  for (const layer of layers) for (const [k, v] of layer) map.set(k, v)
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('\n') + '\n'
}

const envQuote = (v) => (/^[A-Za-z0-9_.:/@+-]*$/.test(v) ? v : `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
const envValue = (v) => String(v ?? '').trim().replace(/^(['"])(.*)\1$/, '$2')

// The app's own secrets (signing, sessions, encryption). Third-party credentials are left alone:
// a made-up Stripe or SMTP key would make the app think the provider is configured.
const APP_SECRET_RE = /(SECRET|_KEY$|^KEY$|SALT|PEPPER)/
const APP_SECRET_HINT_RE = /(JWT|SESSION|COOKIE|AUTH|SIGNING|SIGN|ENCRYPTION|ENCRYPT|CRYPT|HASH|SALT|PEPPER|TOKEN|REFRESH|ACCESS|MEDIA|APP_SECRET|SECRET_KEY_BASE|^SECRET|CSRF|HMAC|MASTER)/
const PROVIDER_RE = /(STRIPE|RAZORPAY|PAYPAL|PAYU|CASHFREE|GOOGLE|GITHUB|FACEBOOK|META_|TWITTER|LINKEDIN|APPLE|MICROSOFT|AZURE|AWS|S3_|R2_|GCS|SMTP|MAIL|SES_|SENDGRID|RESEND|POSTMARK|OPENAI|ANTHROPIC|GEMINI|TWILIO|FIREBASE|SUPABASE|CLOUDINARY|SENTRY|PUSHER|ALGOLIA|MAPBOX|RECAPTCHA|HCAPTCHA|API_KEY|WEBHOOK|CLIENT_SECRET|CLIENT_ID|PUBLISHABLE|PUBLIC|VITE_|NEXT_PUBLIC_|REACT_APP_)/
const PLACEHOLDER_RE = /^$|change.?me|changeme|^your[-_ ]|replace|example|placeholder|^dev[-_]|^test[-_]?secret|^secret$|^password$|^x{3,}|^<.*>$|^todo|^null$/i
// Public-origin settings that templates ship pointing at localhost
const URL_KEY_RE = /^((APP|API|SITE|PUBLIC|FRONTEND|CLIENT|BASE|WEB|SERVER|BACKEND|HOST|NEXTAUTH|AUTH|ORIGIN)_?URL|(NEXT_PUBLIC|VITE|REACT_APP)_(APP|SITE|API|BASE|PUBLIC)_?URL|CORS_ORIGINS?|ALLOWED_ORIGINS|FRONTEND_ORIGIN|CLIENT_ORIGIN)$/
const LOCAL_ORIGIN_RE = /https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?/

/**
 * Fills what a copied .env.example leaves unusable in production: generates the app's own secrets
 * when empty or still a placeholder, an admin login for seed scripts, and points localhost origins
 * at the public URL. Values the user typed in the wizard are applied afterwards and always win.
 * Returns { pairs, generated: [keys], admin: { email, passwordKey } | null }.
 */
function fillEnvDefaults(pairs, { publicUrl, adminEmail, skip }) {
  const generated = []
  let admin = null
  const out = pairs.map(([k, v]) => {
    if (skip.has(k)) return [k, v]
    const val = envValue(v)
    if (/^(SUPER_)?ADMIN_EMAIL$/.test(k) && !val && adminEmail) {
      admin = { ...admin, email: adminEmail }
      return [k, adminEmail]
    }
    if (/^(SUPER_)?ADMIN_PASSWORD$/.test(k) && PLACEHOLDER_RE.test(val)) {
      admin = { ...admin, passwordKey: k }
      generated.push(k)
      return [k, randomPassword()]
    }
    if (k !== 'APP_KEY' && APP_SECRET_RE.test(k) && APP_SECRET_HINT_RE.test(k) && !PROVIDER_RE.test(k) && PLACEHOLDER_RE.test(val)) {
      generated.push(k)
      // 32 random bytes as hex: valid for JWT/session secrets and for "32-byte key" encryption settings
      return [k, crypto.randomBytes(32).toString('hex')]
    }
    if (URL_KEY_RE.test(k) && LOCAL_ORIGIN_RE.test(val)) {
      return [k, envQuote(val.replace(new RegExp(LOCAL_ORIGIN_RE.source, 'g'), publicUrl))]
    }
    return [k, v]
  })
  if (admin && !admin.passwordKey) admin = null
  if (admin) {
    const emailKey = out.find(([k]) => /^(SUPER_)?ADMIN_EMAIL$/.test(k))
    admin.email = emailKey ? envValue(emailKey[1]) : null
    if (!admin.email) admin = null
  }
  return { pairs: out, generated, admin }
}

/**
 * Runs the pipeline. Never throws: the outcome is reported through emit({ kind: 'result' }).
 * pointDomain(ipv4) (optional, used when cfg.autoDns) writes the domain's A record through the
 * organization's DNS provider and returns { zone, provider, action, detail }.
 * Returns { success, url, plan, port, dns }.
 */
export async function runDeployPipeline(cfg, emit, { host, pointDomain = null }) {
  const done = new Set()
  let current = null
  let stageFraction = 0

  const percent = () => {
    const total = STAGES.reduce((a, s) => a + s.weight, 0)
    let p = 0
    for (const s of STAGES) if (done.has(s.id)) p += s.weight
    if (current) p += (STAGES.find(s => s.id === current).weight * stageFraction)
    return Math.min(99, Math.round((p / total) * 100))
  }
  const progress = () => emit({ kind: 'progress', percent: percent() })
  const stage = (id, status, detail) => {
    const s = STAGES.find(x => x.id === id)
    if (status === 'running') { current = id; stageFraction = 0 }
    if (['done', 'skipped', 'warning'].includes(status)) { done.add(id); if (current === id) current = null }
    emit({ kind: 'stage', id, status, label: s.label, detail: detail || null })
    progress()
  }
  const log = (text, isError = false) => emit({ kind: 'log', stage: current, text: redactUrl(text), isError })
  const sourcePassword = (() => { try { return decodeURIComponent(new URL(cfg.database.sourceUrl).password) } catch { return null } })()
  const sb = cfg.database.supabase
  const secrets = [cfg.server?.password, cfg.database.adminPassword, cfg.database.password, cfg.database.sourceUrl, sourcePassword, cfg.database.storage?.key,
    sb?.jwtSecret, sb?.sourceKeys?.service_role, sb?.auth?.smtp?.pass, ...Object.values(sb?.auth?.providers || {}).map(p => p.secret), ...(sb?.functionSecrets || []).map(([, v]) => v)]
    .filter(v => v && String(v).length >= 6)
  const scrub = (t) => secrets.reduce((acc, s) => acc.split(s).join('***'), t)

  let lines = 0

  /** Runs a bash script on the target server, streaming its output into the log. */
  const sh = async (script, { allowFailure = false, quiet = false, timeoutMs = 20 * 60 * 1000 } = {}) => {
    const r = await host.exec(script, {
      timeout: timeoutMs,
      onData: quiet ? null : (text, isErr) => {
        log(scrub(text), isErr)
        lines += text.split('\n').length - 1
        // Long stages creep toward (not past) completion as output arrives
        stageFraction = Math.min(0.92, 1 - Math.exp(-lines / 120))
        progress()
      }
    })
    const out = (r.stdout + (quiet ? '' : '')).trim()
    if (r.code === 0 || allowFailure) return { code: r.code, out: quiet ? (r.stdout || '').trim() : out }
    throw Object.assign(new Error(`Command failed (exit ${r.code})`), { output: r.stdout + r.stderr })
  }
  const query = async (script) => (await sh(script, { allowFailure: true, quiet: true })).out

  const putFile = async (local, remote) => {
    await host.putFile(local, remote, { onProgress: (f) => { stageFraction = Math.min(0.9, f); progress() } })
  }

  const dir = cfg.remoteDir
  let plan
  let port = cfg.port
  let dbInfo = null
  let storageInfo = null
  let stackInfo = null
  let adminInfo = null
  let dns = null
  const warnings = []

  try {
    // ------------------------------------------------------------------ connect
    stage('connect', 'running', host.label)
    const osInfo = await query('. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME"; uname -m')
    log(`Connected. ${osInfo.replace(/\n/g, ' · ')}\n`)
    stage('connect', 'done', osInfo.split('\n')[0] || null)

    // An app name owns one folder, PM2 process and database. If it already serves another
    // domain, deploying here would overwrite that site — refuse before touching anything.
    const owners = (await query(`grep -lx ${q(`# autodeploy:${cfg.appName}`)} /etc/nginx/sites-available/*.conf 2>/dev/null`))
      .split('\n').filter(Boolean).map(f => path.basename(f, '.conf')).filter(d => d !== cfg.domain)
    if (owners.length) {
      throw new Error(`The app name "${cfg.appName}" is already used by ${owners.join(', ')}. Deploying ${cfg.domain} with the same name would overwrite that site — go back and choose a different app name (e.g. "${cfg.domain.split('.')[0].replace(/[^a-z0-9-]/g, '')}").`)
    }
    const serverIp = (await query(`curl -s4 --max-time 5 https://api.ipify.org || hostname -I | awk '{print $1}'`)).trim()

    // ------------------------------------------------------------------ dns
    // Done first so the record propagates while the app installs and builds. A domain that
    // already points elsewhere stops the deploy here, before anything on the server changes.
    if (!cfg.autoDns || !pointDomain) {
      stage('dns', 'skipped', 'DNS managed by you')
    } else {
      stage('dns', 'running', cfg.domain)
      try {
        dns = await pointDomain(serverIp)
        log(`${dns.detail}\n`)
        stage('dns', 'done', dns.action === 'ok' ? 'Already points here' : `${dns.provider} · A → ${serverIp}`)
      } catch (e) {
        if (e.status === 409) throw e
        const msg = `Could not set DNS automatically: ${e.message} Point an A record for ${cfg.domain} to ${serverIp} yourself.`
        warnings.push(msg)
        log(`${msg}\n`, true)
        stage('dns', 'warning', 'Set the A record yourself')
      }
    }

    // ------------------------------------------------------------------ source
    stage('source', 'running', cfg.source.type === 'git' ? `${redactUrl(cfg.source.gitUrl)} (${cfg.source.branch})` : cfg.source.name)
    const backup = `${dir}.previous-${Date.now()}`
    if (cfg.source.type === 'git') {
      // The deployer's GitHub token is only used for this fetch; origin is saved without credentials,
      // so every later pull uses the GitHub account of whoever runs it
      const url = withGithubToken(cfg.source.gitUrl, cfg.githubToken)
      const cleanUrl = cfg.source.gitUrl.replace(/^https:\/\/[^@/]+@/, 'https://')
      await sh(`
set -e
export GIT_TERMINAL_PROMPT=0
if [ -d ${q(dir)}/.git ]; then
  echo "Updating existing checkout in ${dir}"
  cd ${q(dir)}
  git remote set-url origin ${q(cleanUrl)}
  git -c credential.helper= fetch --prune ${q(url)} ${q(cfg.source.branch)}
  git checkout -B ${q(cfg.source.branch)} FETCH_HEAD
  git reset --hard FETCH_HEAD
else
  if [ -e ${q(dir)} ]; then echo "Keeping the existing folder as ${backup}"; mv ${q(dir)} ${q(backup)}; fi
  mkdir -p /var/www
  git -c protocol.ext.allow=never clone --branch ${q(cfg.source.branch)} ${q(url)} ${q(dir)}
  git -C ${q(dir)} remote set-url origin ${q(cleanUrl)}
  if [ -f ${q(backup)}/.env ] && [ ! -f ${q(dir)}/.env ]; then cp ${q(backup)}/.env ${q(dir)}/.env; echo "Kept the previous .env"; fi
fi
git -C ${q(dir)} log -1 --format='Deploying commit %h — %s (%an)'
`)
    } else {
      const remoteArchive = `/tmp/autodeploy-${crypto.randomBytes(6).toString('hex')}${cfg.source.ext}`
      log(`Uploading ${cfg.source.name} to the server…\n`)
      await putFile(cfg.source.file, remoteArchive)
      const extract = cfg.source.ext === '.zip'
        ? `unzip -q -o ${q(remoteArchive)} -d "$TMPX"`
        : `tar ${cfg.source.ext === '.tar' ? '-xf' : '-xzf'} ${q(remoteArchive)} -C "$TMPX" --no-same-owner`
      await sh(`
set -e
command -v ${cfg.source.ext === '.zip' ? 'unzip' : 'tar'} >/dev/null || { echo "Installing unzip"; apt-get install -y unzip >/dev/null 2>&1 || yum install -y unzip >/dev/null 2>&1; }
TMPX=$(mktemp -d)
${extract}
rm -rf "$TMPX/__MACOSX"
ROOT="$TMPX"
for i in 1 2; do
  set -- "$ROOT"/* "$ROOT"/.[!.]*
  COUNT=0; ONLY=""
  for f in "$@"; do [ -e "$f" ] || continue; COUNT=$((COUNT+1)); ONLY="$f"; done
  if [ "$COUNT" = 1 ] && [ -d "$ONLY" ]; then ROOT="$ONLY"; else break; fi
done
if [ -e ${q(dir)} ]; then echo "Keeping the previous version as ${backup}"; mv ${q(dir)} ${q(backup)}; fi
mkdir -p /var/www
mv "$ROOT" ${q(dir)}
[ "$ROOT" != "$TMPX" ] && rm -rf "$TMPX"
rm -f ${q(remoteArchive)}
if [ -f ${q(backup)}/.env ] && [ ! -f ${q(dir)}/.env ]; then cp ${q(backup)}/.env ${q(dir)}/.env; echo "Kept the previous .env"; fi
echo "Extracted $(find ${q(dir)} -type f | wc -l) files into ${dir}"
`)
    }
    stage('source', 'done')

    // ------------------------------------------------------------------ analyze
    stage('analyze', 'running')
    const listing = await query(`cd ${q(dir)} && find . -maxdepth 5 \\( -name node_modules -o -name .git -o -name vendor -o -name dist -o -name build -o -name .next -o -name venv -o -name __pycache__ -o -name target \\) -prune -o -type f -print | head -8000`)
    const files = listing.split('\n').map(f => f.replace(/^\.\//, '')).filter(Boolean)
    const contents = {}
    for (const p of manifestPaths(files)) {
      contents[p] = await query(`head -c 524288 ${q(`${dir}/${p}`)}`)
    }
    plan = analyzeProject(files, (rel) => contents[rel] ?? null)
    if (cfg.overrides.type && cfg.overrides.type !== plan.type) {
      log(`Detected ${plan.framework}; using your choice: ${cfg.overrides.type}\n`)
      plan = { ...plan, type: cfg.overrides.type, framework: `${cfg.overrides.type} (manual)`, dir: cfg.overrides.appDir ?? plan.dir ?? '' }
    }
    if (cfg.overrides.appDir !== null && cfg.overrides.appDir !== undefined && plan.type !== 'fullstack') plan.dir = cfg.overrides.appDir
    if (cfg.overrides.buildCommand) plan.build = cfg.overrides.buildCommand
    if (cfg.overrides.startCommand) plan.start = cfg.overrides.startCommand
    if (cfg.overrides.outputDir) plan.outputDir = cfg.overrides.outputDir
    // Values derived from repository contents end up in shell commands: keep them plain
    const SAFE = /^[A-Za-z0-9 ._:\/=+,@-]*$/
    for (const u of plan.type === 'fullstack' ? [plan.frontend, plan.backend] : [plan]) {
      for (const k of ['dir', 'outputDir', 'start', 'build', 'webRoot']) {
        if (u[k] && !SAFE.test(u[k])) throw new Error(`The detected ${k} "${u[k]}" contains unsupported characters. Set it manually in Advanced.`)
      }
    }
    for (const e of plan.evidence) log(`• ${e}\n`)
    for (const w of plan.warnings) { log(`⚠ ${w}\n`, true); warnings.push(w) }
    if (plan.type === 'unknown') throw new Error('Could not tell what kind of app this is. Choose the app type manually in the wizard (Advanced).')

    const needsPort = ['node-ssr', 'node-server', 'fullstack', 'python', 'go', 'java', 'ruby'].includes(plan.type)
    if (needsPort) {
      // Keep the port the app already uses on redeploy; otherwise pick a free one
      const existing = await query(`pm2 jlist 2>/dev/null | grep -o '"name":"${cfg.appName}"[^}]*' >/dev/null && cat ${q(`${dir}/.autodeploy-port`)} 2>/dev/null`)
      const used = new Set((await query(`ss -ltnH | awk '{print $4}' | sed 's/.*://'`)).split('\n').map(Number))
      if (!port && /^\d+$/.test(existing)) port = Number(existing)
      if (!port || (used.has(port) && String(port) !== existing)) {
        if (port) log(`Port ${port} is in use; choosing another.\n`)
        port = 5100
        while (used.has(port)) port++
      }
      log(`App port: ${port}\n`)
    }

    // Toolchain check: fail early with an actionable message
    const tools = {
      static: [], spa: ['node', 'npm'], 'node-ssr': ['node', 'npm'], 'node-server': ['node', 'npm'], fullstack: ['node', 'npm'],
      php: ['php'], python: ['python3'], go: ['go'], java: ['java'], ruby: ['ruby', 'bundle']
    }[plan.type] || []
    if (plan.type === 'php' && plan.composer) tools.push('composer')
    const isPython = (u) => u?.type === 'python'
    const appUnits = plan.type === 'fullstack' ? [plan.frontend, plan.backend] : [plan]
    if (plan.type === 'fullstack' && isPython(plan.backend)) tools.push('python3')
    const missing = (await query(tools.map(t => `command -v ${t} >/dev/null || echo ${t}`).join('\n'))).split('\n').filter(Boolean)
    if (missing.length) throw new Error(`The server is missing: ${missing.join(', ')}. Install ${missing.join(' and ')} on the server (e.g. apt install ${missing.map(m => ({ node: 'nodejs', npm: 'npm', python3: 'python3 python3-venv', go: 'golang', java: 'default-jdk maven', bundle: 'ruby-bundler' }[m] || m)).join(' ')}) and deploy again.`)
    if (appUnits.some(isPython)) {
      // Ubuntu/Debian ship python3 without venv/ensurepip; without it every Python deploy fails
      const venvOk = async () => (await query(`python3 -c 'import ensurepip, venv' >/dev/null 2>&1 && echo ok`)) === 'ok'
      if (!await venvOk()) {
        log('Installing python3-venv (needed for the app\'s virtual environment)…\n')
        await sh(`export DEBIAN_FRONTEND=noninteractive
PKGS="python3-venv python3-pip python3.$(python3 -c 'import sys; print(sys.version_info[1])')-venv"
apt-get install -y $PKGS >/dev/null 2>&1 || { apt-get update -qq >/dev/null 2>&1; apt-get install -y $PKGS 2>&1 | tail -n 5; } || yum install -y python3-pip 2>&1 | tail -n 5`, { allowFailure: true })
        if (!await venvOk()) throw new Error('Python virtual environments are not available on the server. Install them (apt install python3-venv) and deploy again.')
      }
    }
    const pm2 = await query('command -v pm2')
    if (needsPort && !pm2 && !await query('command -v npm')) throw new Error('PM2 (which keeps the app running) needs Node.js. Install Node.js on the server (apt install nodejs npm) and deploy again.')
    if (needsPort && !pm2) {
      log('Installing PM2 process manager…\n')
      await sh('npm install -g pm2')
    }
    stage('analyze', 'done', `${plan.framework}${port ? ` · port ${port}` : ''}`)
    emit({ kind: 'plan', plan: { type: plan.type, framework: plan.framework, label: plan.label, port } })

    // ------------------------------------------------------------------ database
    const appDirOf = (unit) => (unit?.dir ? `${dir}/${unit.dir}` : dir)
    const serverUnit = plan.type === 'fullstack' ? plan.backend : plan
    const serverDir = appDirOf(serverUnit)

    if (cfg.database.mode === 'none') {
      stage('database', 'skipped', 'No database requested')
    } else {
      stage('database', 'running', cfg.database.engine)
      const engine = cfg.database.engine
      const base = cfg.appName.replace(/-/g, '_').slice(0, 40)
      const db = { engine, name: cfg.database.name || base, user: cfg.database.user || `${base.slice(0, 26)}_app`, password: cfg.database.password || randomPassword() }
      secrets.push(db.password)
      let remoteDump = null
      if (cfg.database.mode === 'import' && engine !== 'sqlite') {
        remoteDump = `/tmp/autodeploy-db-${crypto.randomBytes(6).toString('hex')}${cfg.database.ext}`
        log(`Uploading ${cfg.database.fileName}…\n`)
        await putFile(cfg.database.file, remoteDump)
      }
      const cat = cfg.database.ext === '.sql.gz' ? `gunzip -c ${q(remoteDump || '')}` : `cat ${q(remoteDump || '')}`

      if (cfg.database.mode === 'migrate') {
        if (!await query('command -v psql')) throw new Error('PostgreSQL is not installed on the server (apt install postgresql).')
        const m = await migrateExternalPostgres(host, cfg.database.sourceUrl, {
          name: db.name, user: db.user, password: db.password, includeAuth: cfg.database.includeAuth || !!sb,
          // The local Supabase API needs the storage schema and the grants to anon/authenticated
          includeStorage: !!sb, keepPrivileges: !!sb, onLog: (t) => log(scrub(t))
        })
        log(`Copied ${m.tables} table(s) from ${m.source.database} on ${m.source.host} (${m.schemas.join(', ')}). The source was not changed; a copy of the dump is at ${m.dump}.\n`)
        for (const e of m.errors.slice(0, 20)) log(`${scrub(e)}\n`, true)
        if (m.notes.length) warnings.push(`Database migration: ${m.notes.join('; ')}. See the deployment log.`)
        db.host = '127.0.0.1'; db.port = 5432
        db.url = `postgresql://${db.user}:${db.password}@127.0.0.1:5432/${db.name}`
        db.migratedFrom = m.source
      } else if (engine === 'postgresql') {
        if (!await query('command -v psql')) throw new Error('PostgreSQL is not installed on the server (apt install postgresql).')
        const pg = (sql) => `runuser -u postgres -- psql -v ON_ERROR_STOP=1 -tAc ${q(sql)}`
        const exists = (await query(pg(`SELECT 1 FROM pg_database WHERE datname='${db.name}'`))).trim() === '1'
        await sh(`
set -e
${pg(`DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='${db.user}') THEN CREATE ROLE "${db.user}" LOGIN PASSWORD '${db.password}'; ELSE ALTER ROLE "${db.user}" WITH LOGIN PASSWORD '${db.password}'; END IF; END $$;`)}
${exists ? `echo "Database ${db.name} already exists — keeping its data"` : `runuser -u postgres -- createdb -O ${q(db.user)} ${q(db.name)} && echo "Created database ${db.name}"`}
`)
        // An existing database with no tables yet (e.g. left by an earlier failed deploy) still needs seeding
        db.fresh = !remoteDump && (!exists || (await query(`runuser -u postgres -- psql -d ${q(db.name)} -tAc ${q("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")}`)).trim() === '0')
        if (remoteDump) {
          if (exists) { warnings.push(`Database ${db.name} already existed, so the uploaded dump was not imported (to protect existing data).`); log('Skipping import: database already has data.\n', true) }
          else if (cfg.database.format === 'pg_custom') await sh(`PGPASSWORD=${q(db.password)} pg_restore --no-owner --role=${q(db.user)} -h 127.0.0.1 -U ${q(db.user)} -d ${q(db.name)} ${q(remoteDump)} || echo "pg_restore reported warnings (see above)"`)
          else await sh(`${cat} | PGPASSWORD=${q(db.password)} psql -q -h 127.0.0.1 -U ${q(db.user)} -d ${q(db.name)} 2>&1 | grep -v '^SET$' | tail -n 50; echo "Import finished"`)
        }
        db.host = '127.0.0.1'; db.port = 5432
        db.url = `postgresql://${db.user}:${db.password}@127.0.0.1:5432/${db.name}`
      } else if (engine === 'mysql') {
        if (!await query('command -v mysql')) throw new Error('MySQL/MariaDB is not installed on the server (apt install mysql-server).')
        const { adminUser } = cfg.database
        const found = await findMysqlAdmin(query, cfg.database)
        const enteredError = scrub(found.enteredError)
        if (!found.cmd) {
          throw new Error(adminUser
            ? `Could not log in to MySQL as "${adminUser}"${enteredError ? ` (${enteredError})` : ''}. The admin login must be an existing MySQL administrator such as root — not the new database's user.`
            : 'Could not log in to MySQL as an administrator. Enter a MySQL admin user (e.g. root) and its password under "MySQL admin login" in the Database step.')
        }
        if (adminUser && !found.entered) log(`The MySQL admin login "${adminUser}" did not work${enteredError ? ` (${enteredError})` : ''}; using ${found.label} instead.\n`, true)
        else log(`Logged in to MySQL as ${found.label}.\n`)
        const admin = found.cmd
        const exists = (await query(`${admin} -N -e ${q(`SHOW DATABASES LIKE '${db.name}'`)}`)).trim() === db.name
        const sql = `CREATE DATABASE IF NOT EXISTS \`${db.name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${db.user}'@'localhost' IDENTIFIED BY '${db.password}';
CREATE USER IF NOT EXISTS '${db.user}'@'127.0.0.1' IDENTIFIED BY '${db.password}';
ALTER USER '${db.user}'@'localhost' IDENTIFIED BY '${db.password}';
ALTER USER '${db.user}'@'127.0.0.1' IDENTIFIED BY '${db.password}';
GRANT ALL PRIVILEGES ON \`${db.name}\`.* TO '${db.user}'@'localhost';
GRANT ALL PRIVILEGES ON \`${db.name}\`.* TO '${db.user}'@'127.0.0.1';
FLUSH PRIVILEGES;`
        await sh(`set -e\necho ${b64(sql)} | base64 -d | ${admin}\necho "${exists ? 'Database exists — kept its data' : `Created database ${db.name}`}"`)
        db.fresh = !exists && !remoteDump
        if (remoteDump) {
          if (exists) { warnings.push(`Database ${db.name} already existed, so the uploaded dump was not imported.`); log('Skipping import: database already exists.\n', true) }
          else await sh(`set -o pipefail\n${cat} | MYSQL_PWD=${q(db.password)} mysql -u ${q(db.user)} -h 127.0.0.1 ${q(db.name)}\necho "Import finished"`)
        }
        db.host = '127.0.0.1'; db.port = 3306
        db.url = `mysql://${db.user}:${encodeURIComponent(db.password)}@127.0.0.1:3306/${db.name}`
      } else if (engine === 'mongodb') {
        if (!await query('command -v mongod || command -v mongosh || ss -ltn | grep -q :27017 && echo yes')) throw new Error('MongoDB is not installed on the server.')
        db.host = '127.0.0.1'; db.port = 27017; db.user = null; db.password = null
        db.url = `mongodb://127.0.0.1:27017/${db.name}`
        log(`MongoDB creates ${db.name} automatically on first write.\n`)
      } else if (engine === 'sqlite') {
        const fileName = cfg.database.mode === 'import' ? path.basename(cfg.database.fileName).replace(/[^\w.-]/g, '_') : 'database.sqlite'
        const target = `${serverDir}/${fileName}`
        if (cfg.database.mode === 'import') {
          const existsFile = await query(`[ -f ${q(target)} ] && echo yes`)
          if (existsFile) log(`${fileName} already exists in the app — keeping the existing file.\n`, true)
          else await putFile(cfg.database.file, target)
        } else {
          await sh(`[ -f ${q(target)} ] || sqlite3 ${q(target)} 'VACUUM;' 2>/dev/null || touch ${q(target)}`)
        }
        await sh(`chmod 660 ${q(target)}; chown www-data:www-data ${q(target)} 2>/dev/null || true`, { allowFailure: true })
        db.file = target
        db.url = `file:./${fileName}`
        db.user = null; db.password = null
      }
      if (remoteDump) await sh(`rm -f ${q(remoteDump)}`, { allowFailure: true, quiet: true })
      dbInfo = db
      stage('database', 'done', `${engine} · ${db.name}${db.migratedFrom ? ` · from ${db.migratedFrom.provider === 'supabase' ? 'Supabase' : db.migratedFrom.host}` : ''}`)
    }

    // ------------------------------------------------------------------ storage
    if (!cfg.database.storage) {
      stage('storage', 'skipped', 'No storage to copy')
    } else {
      stage('storage', 'running', cfg.database.storage.url)
      storageInfo = await migrateSupabaseStorage(host, { ...cfg.database.storage, appName: cfg.appName, onLog: (t) => log(scrub(t)) })
      log(`Copied ${storageInfo.files} file(s) from ${storageInfo.buckets.length} bucket(s) into ${storageInfo.dir}\n`)
      if (storageInfo.failed) warnings.push(`${storageInfo.failed} storage file(s) could not be downloaded. Redeploy to retry, or copy them by hand into ${storageInfo.dir}.`)
      if (storageInfo.skipped.length) warnings.push(`Skipped in storage: ${storageInfo.skipped.slice(0, 5).join(', ')}${storageInfo.skipped.length > 5 ? ` and ${storageInfo.skipped.length - 5} more` : ''}.`)
      stage('storage', storageInfo.failed ? 'warning' : 'done', `${storageInfo.files} file(s) · ${storageInfo.buckets.length} bucket(s)`)
    }

    // ------------------------------------------------------------------ supabase
    if (!sb) {
      stage('supabase', 'skipped', 'Not requested')
    } else {
      stage('supabase', 'running', 'Auth · REST · Storage · Functions')
      stackInfo = await setupSupabaseStack(host, {
        appName: cfg.appName,
        publicUrl: `${cfg.ssl ? 'https' : 'http'}://${cfg.domain}`,
        projectDir: dir,
        db: { name: dbInfo.name, user: dbInfo.user, password: dbInfo.password },
        ref: sb.ref,
        jwtSecret: sb.jwtSecret,
        sourceKeys: sb.sourceKeys,
        auth: sb.auth,
        storage: storageInfo ? { dir: storageInfo.dir, buckets: storageInfo.buckets } : null,
        functionSecrets: sb.functionSecrets,
        noVerifyJwt: sb.noVerifyJwt,
        onLog: (t, isErr) => log(scrub(t), isErr)
      })
      secrets.push(stackInfo.jwtSecret, stackInfo.keys.service_role)
      for (const n of stackInfo.notes) { log(`${n}\n`); if (/did not answer/.test(n)) warnings.push(n) }
      if (!sb.auth.smtp) warnings.push('Supabase Auth has no mail server here, so new sign-ups are confirmed automatically and password-reset emails are not sent. Add SMTP settings (Supabase → Authentication → SMTP) and redeploy to send emails.')
      if (Object.keys(sb.auth.providers).length) warnings.push(`Add ${stackInfo.url}/auth/v1/callback as an authorized redirect URL with each sign-in provider (${Object.keys(sb.auth.providers).join(', ')}).`)
      log(`Supabase API for this app: ${stackInfo.url} (PM2: ${stackInfo.processes.join(', ')})\n`)
      stage('supabase', 'done', `${stackInfo.processes.length} services${stackInfo.functions.length ? ` · ${stackInfo.functions.length} function(s)` : ''}`)
    }

    // ------------------------------------------------------------------ env
    stage('env', 'running')
    const envDirs = new Set([serverDir])
    if (plan.type === 'fullstack') envDirs.add(dir)
    const userEnv = parseEnv(cfg.envVars)
    const autoEnv = []
    if (port) autoEnv.push(['PORT', String(port)])
    if (['node-ssr', 'node-server', 'fullstack'].includes(plan.type)) autoEnv.push(['NODE_ENV', 'production'])
    if (isPython(serverUnit)) autoEnv.push(['PYTHONUNBUFFERED', '1'])
    if (serverUnit.django) autoEnv.push(['ALLOWED_HOSTS', `${cfg.domain},127.0.0.1,localhost`], ['DJANGO_ALLOWED_HOSTS', `${cfg.domain},127.0.0.1,localhost`], ['CSRF_TRUSTED_ORIGINS', `${cfg.ssl ? 'https' : 'http'}://${cfg.domain}`])
    if (dbInfo) {
      autoEnv.push(['DATABASE_URL', envQuote(dbInfo.url)])
      if (dbInfo.engine === 'mongodb') autoEnv.push(['MONGODB_URI', dbInfo.url])
      if (dbInfo.engine === 'postgresql' || dbInfo.engine === 'mysql') {
        autoEnv.push(
          ['DB_CONNECTION', dbInfo.engine === 'postgresql' ? 'pgsql' : 'mysql'], ['DB_HOST', dbInfo.host], ['DB_PORT', String(dbInfo.port)],
          ['DB_DATABASE', dbInfo.name], ['DB_NAME', dbInfo.name], ['DB_USERNAME', dbInfo.user], ['DB_USER', dbInfo.user], ['DB_PASSWORD', envQuote(dbInfo.password)]
        )
      }
      if (dbInfo.engine === 'sqlite') autoEnv.push(['DB_CONNECTION', 'sqlite'], ['DB_DATABASE', dbInfo.file])
    }
    if (storageInfo) {
      autoEnv.push(['STORAGE_DIR', storageInfo.dir], ['STORAGE_PUBLIC_URL', `${cfg.ssl ? 'https' : 'http'}://${cfg.domain}/storage/v1/object/public`])
    }
    const publicUrl = `${cfg.ssl ? 'https' : 'http'}://${cfg.domain}`
    const skipKeys = new Set([...autoEnv, ...userEnv].map(([k]) => k))
    let serverEnv = []
    for (const d of envDirs) {
      const existing = parseEnv(await query(`cat ${q(`${d}/.env`)} 2>/dev/null || cat ${q(`${d}/.env.example`)} 2>/dev/null || cat ${q(`${d}/.env.sample`)} 2>/dev/null`))
      const filled = fillEnvDefaults(existing, { publicUrl, adminEmail: cfg.sslEmail, skip: skipKeys })
      if (filled.generated.length) log(`Generated ${filled.generated.join(', ')} (the template had empty or example values)\n`)
      if (d === serverDir && filled.admin) adminInfo = { ...filled.admin, envFile: `${d}/.env` }
      // Order: existing/.env.example (placeholders filled) < panel values < what the user typed
      let merged = mergeEnv(filled.pairs, autoEnv, userEnv)
      // Supabase variables (also ones imported from Vercel) point at the app's own stack
      if (stackInfo) merged = mergeEnv(parseEnv(merged), supabaseEnvLayer(parseEnv(merged), { ref: sb.ref, url: stackInfo.url, keys: stackInfo.keys, jwtSecret: stackInfo.jwtSecret, dbUrl: dbInfo.url }))
      if (d === serverDir) serverEnv = parseEnv(merged)
      await sh(`echo ${b64(merged)} | base64 -d > ${q(`${d}/.env`)} && chmod 600 ${q(`${d}/.env`)}`, { quiet: true })
      log(`Wrote ${d}/.env (${merged.trim().split('\n').length} variables)\n`)
    }
    // A separate frontend folder builds with its own .env: give it the Supabase values too
    if (stackInfo && plan.type === 'fullstack' && !envDirs.has(appDirOf(plan.frontend))) {
      const fd = appDirOf(plan.frontend)
      const existing = parseEnv(await query(`cat ${q(`${fd}/.env`)} 2>/dev/null`))
      const merged = mergeEnv(existing, supabaseEnvLayer([...existing, ...userEnv], { ref: sb.ref, url: stackInfo.url, keys: stackInfo.keys, jwtSecret: stackInfo.jwtSecret, dbUrl: dbInfo.url }).filter(([k]) => !/SERVICE|SECRET|DATABASE|_DB_|POSTGRES/.test(k)))
      await sh(`echo ${b64(merged)} | base64 -d > ${q(`${fd}/.env`)} && chmod 600 ${q(`${fd}/.env`)}`, { quiet: true })
      log(`Wrote ${fd}/.env (Supabase settings for the frontend build)\n`)
    }
    if (port) await sh(`echo ${port} > ${q(`${dir}/.autodeploy-port`)}`, { quiet: true })

    if (plan.type === 'php' && plan.wordpress && dbInfo?.engine === 'mysql') {
      const hasConfig = await query(`[ -f ${q(`${dir}/wp-config.php`)} ] && echo yes`)
      if (!hasConfig && await query(`[ -f ${q(`${dir}/wp-config-sample.php`)} ] && echo yes`)) {
        const salts = Array.from({ length: 8 }, () => crypto.randomBytes(32).toString('base64').replace(/[^A-Za-z0-9]/g, ''))
        await sh(`
cd ${q(dir)}
cp wp-config-sample.php wp-config.php
sed -i "s/database_name_here/${db_escape(dbInfo.name)}/; s/username_here/${db_escape(dbInfo.user)}/; s/password_here/${db_escape(dbInfo.password)}/; s/'localhost'/'127.0.0.1'/" wp-config.php
${salts.map(s => `sed -i "0,/put your unique phrase here/s//${s}/" wp-config.php`).join('\n')}
echo "Created wp-config.php"`)
      }
    }
    stage('env', 'done')

    // ------------------------------------------------------------------ install
    stage('install', 'running')
    lines = 0
    // pnpm workspaces link packages with workspace:* (npm cannot): install once at the workspace root
    const pnpmInstall = `cd ${q(dir)} && export CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0 && PNPM=$(command -v pnpm || echo 'corepack pnpm') && $PNPM install --frozen-lockfile --prod=false || $PNPM install --no-frozen-lockfile --prod=false`
    const pnpmWorkspace = !!await query(`[ -f ${q(`${dir}/pnpm-workspace.yaml`)} ] || [ -f ${q(`${dir}/pnpm-lock.yaml`)} ] && echo yes`)
    const nodeInstall = (d) => `cd ${q(d)} && if [ -f package-lock.json ]; then npm ci --include=dev --no-audit --no-fund || npm install --include=dev --no-audit --no-fund --legacy-peer-deps; else npm install --include=dev --no-audit --no-fund --legacy-peer-deps; fi`
    const pyInstall = (d, u) => {
      const server = (/^(\S*\/)?(gunicorn|uvicorn)\b/.exec(u.start || '') || [])[2]
      return `
set -e
cd ${q(d)}
# Recreate a venv that is missing, half-created by an earlier failed deploy, or committed from another machine
if ! venv/bin/python -c 'import sys' >/dev/null 2>&1 || [ ! -x venv/bin/pip ]; then rm -rf venv; python3 -m venv venv; echo "Created virtual environment ($(venv/bin/python --version))"; fi
venv/bin/pip install --upgrade pip -q
pydeps() {
  if [ -f requirements.txt ]; then venv/bin/pip install -r requirements.txt; return; fi
  for m in pyproject.toml Pipfile; do
    [ -f "$m" ] || continue
    T=$(mktemp -d)
    echo ${b64(PY_DEPS)} | base64 -d > "$T/deps.py"
    set +e; venv/bin/python "$T/deps.py" "$m" > "$T/requirements.txt"; rc=$?; set -e
    if [ $rc = 0 ]; then
      echo "Installing dependencies from $m"
      [ -s "$T/requirements.txt" ] && venv/bin/pip install -r "$T/requirements.txt"
      [ "$m" = pyproject.toml ] && grep -q '^\[build-system\]' pyproject.toml && { venv/bin/pip install --no-deps . || echo "The project itself could not be installed as a package; running it from its folder"; }
    else
      venv/bin/pip install .
    fi
    rm -rf "$T"
    return
  done
}
# Packages such as psycopg2 or mysqlclient compile against system libraries: install them once and retry
pydeps || { echo "Installing build tools and database client libraries, then retrying"; DEBIAN_FRONTEND=noninteractive apt-get install -y build-essential python3-dev libpq-dev default-libmysqlclient-dev pkg-config >/dev/null 2>&1 || true; pydeps; }
${server ? `[ -x venv/bin/${server} ] || venv/bin/pip install -q ${server}` : ''}`
    }
    const units = appUnits
    if (['spa', 'node-ssr', 'node-server', 'fullstack'].includes(plan.type)) {
      if (pnpmWorkspace && units.some(u => !isPython(u))) {
        log('pnpm install (workspace)\n')
        await sh(pnpmInstall)
      }
      for (const u of units) {
        if (isPython(u)) {
          log(`pip install in ${u.dir || '.'}\n`)
          await sh(pyInstall(appDirOf(u), u))
        } else if (!pnpmWorkspace) {
          log(`npm install in ${u.dir || '.'}\n`)
          await sh(nodeInstall(appDirOf(u)))
        }
      }
    } else if (plan.type === 'php') {
      if (plan.composer) await sh(`cd ${q(dir)} && COMPOSER_ALLOW_SUPERUSER=1 composer install --no-dev --optimize-autoloader --no-interaction --no-progress`)
      if (await query(`[ -f ${q(`${dir}/package.json`)} ] && grep -q '"build"' ${q(`${dir}/package.json`)} && echo yes`)) await sh(nodeInstall(dir), { allowFailure: true })
    } else if (plan.type === 'python') {
      if (!plan.start) plan.start = 'gunicorn app:app'
      await sh(pyInstall(serverDir, plan))
    } else if (plan.type === 'ruby') {
      await sh(`cd ${q(serverDir)} && bundle config set --local without 'development test' && bundle install`)
    } else if (plan.type === 'go') {
      await sh(`cd ${q(serverDir)} && go mod download`)
    } else {
      stage('install', 'skipped', 'Nothing to install')
    }
    if (!done.has('install')) stage('install', 'done')

    // ------------------------------------------------------------------ build
    stage('build', 'running')
    lines = 0
    let built = false
    for (const u of units) {
      if (!['spa', 'node-ssr', 'node-server'].includes(u.type) || !u.build) continue
      log(`${u.build} in ${u.dir || '.'}\n`)
      // Install already ran with dev deps; build in production mode
      await sh(`cd ${q(appDirOf(u))} && NODE_ENV=production ${u.build}`)
      built = true
    }
    if (plan.type === 'php' && plan.laravel) {
      await sh(`
cd ${q(dir)}
grep -q '^APP_KEY=base64' .env || php artisan key:generate --force
${dbInfo && cfg.database.mode === 'create' ? 'php artisan migrate --force || echo "Migrations reported an error (see above)"' : ''}
php artisan storage:link 2>/dev/null || true
php artisan config:cache && php artisan route:cache || true
[ -f package.json ] && grep -q '"build"' package.json && npm run build || true
chown -R www-data:www-data storage bootstrap/cache`)
      built = true
    } else if (isPython(serverUnit) && serverUnit.django) {
      await sh(`cd ${q(serverDir)} && ${loadEnv}; venv/bin/python manage.py migrate --noinput || echo "Migrations reported an error (see above)"; venv/bin/python manage.py collectstatic --noinput || true`)
      built = true
    } else if (plan.type === 'go') {
      await sh(`cd ${q(serverDir)} && go build -o app .`)
      built = true
    } else if (plan.type === 'java') {
      await sh(`cd ${q(serverDir)} && ${plan.build}`)
      built = true
    }
    if (isPython(serverUnit) && !serverUnit.django && await query(`[ -f ${q(`${serverDir}/alembic.ini`)} ] && echo yes`)) {
      log('Applying database migrations (alembic upgrade head)\n')
      const r = await sh(`cd ${q(serverDir)} && ${loadEnv}; venv/bin/alembic upgrade head 2>&1`, { allowFailure: true })
      if (r.code !== 0) warnings.push('Database migrations failed (see the log). The app may not work until `alembic upgrade head` succeeds.')
      built = true
    }
    if (isPython(serverUnit) && serverUnit.factory) {
      // gunicorn needs a module-level app; the project only has create_app()
      const shim = `from ${serverUnit.factory.module} import ${serverUnit.factory.fn}\n\napp = ${serverUnit.factory.fn}()\n`
      await sh(`echo ${b64(shim)} | base64 -d > ${q(`${serverDir}/autodeploy_wsgi.py`)}`, { quiet: true })
    }
    // Static output must exist before nginx points at it
    for (const u of units) {
      if (u.type !== 'spa') continue
      const out = `${appDirOf(u)}/${u.outputDir || 'dist'}`
      if (!await query(`[ -f ${q(`${out}/index.html`)} ] && echo yes`)) {
        const found = await query(`cd ${q(appDirOf(u))} && for d in dist build out public dist/*/browser; do [ -f "$d/index.html" ] && echo "$d" && break; done`)
        if (!found) throw new Error(`The build finished but no index.html was found in ${u.dir ? `${u.dir}/` : ''}${u.outputDir || 'dist'}. Set the output folder in Advanced.`)
        log(`Build output found in ${found} (expected ${u.outputDir})\n`)
        u.outputDir = found
      }
    }
    // Hardcoded https://<ref>.supabase.co URLs (and old keys) in the built app → the app's own stack
    if (stackInfo) await sh(rewriteBuildScript(cfg.appName, dir), { allowFailure: true })
    stage('build', built ? 'done' : 'skipped', built ? null : 'No build step')

    // Prisma apps: create/upgrade the tables before the app starts (they usually crash without them),
    // then run the seed script once on a fresh database (plans, settings, first admin)
    const dbUrl = envValue(serverEnv.find(([k]) => k === 'DATABASE_URL')?.[1])
    const prismaSchema = ['node-server', 'node-ssr', 'fullstack'].includes(plan.type) && dbUrl && !PLACEHOLDER_RE.test(dbUrl) &&
      await query(`cd ${q(serverDir)} && for f in prisma/schema.prisma prisma/schema schema.prisma; do [ -e "$f" ] && echo "$f" && break; done`)
    if (prismaSchema) {
      const inEnv = (cmd) => `cd ${q(serverDir)} && ${loadEnv}; ${cmd}`
      const hasMigrations = await query(`ls -d ${q(serverDir)}/prisma/migrations/*/ 2>/dev/null | head -1`)
      if (hasMigrations) {
        log('Applying database migrations (prisma migrate deploy)\n')
        const r = await sh(inEnv('npx --no-install prisma migrate deploy 2>&1'), { allowFailure: true })
        if (r.code !== 0) warnings.push('Database migrations failed (see the log). The app may not work until `npx prisma migrate deploy` succeeds.')
      } else if (dbInfo?.fresh) {
        log('Creating database tables (prisma db push)\n')
        const r = await sh(inEnv('npx --no-install prisma db push --skip-generate 2>&1'), { allowFailure: true })
        if (r.code !== 0) warnings.push('Creating the database tables failed (see the log).')
      }
      if (dbInfo?.fresh) {
        const pkg = await query(`cat ${q(`${serverDir}/package.json`)} 2>/dev/null`)
        let seed = null
        try {
          const j = JSON.parse(pkg)
          if (j.prisma?.seed) seed = 'npx --no-install prisma db seed'
          else if (j.scripts?.['db:seed']) seed = 'npm run db:seed'
          else if (j.scripts?.seed) seed = 'npm run seed'
        } catch {}
        if (seed) {
          log(`Seeding the new database (${seed})\n`)
          const r = await sh(inEnv(`${seed} 2>&1`), { allowFailure: true })
          if (r.code !== 0) warnings.push(`The seed script (${seed}) failed (see the log). Run it from the app folder once the issue is fixed.`)
        }
      }
    }

    // ------------------------------------------------------------------ service
    stage('service', 'running')
    if (needsPort) {
      let startCmd = serverUnit.start || 'npm run start'
      const sd = serverDir
      let pyEnv = ''
      if (isPython(serverUnit)) {
        // The venv's bin comes first on PATH, so gunicorn, uvicorn, python, flask … are the app's own
        pyEnv = `export VIRTUAL_ENV=${sd}/venv PATH="${sd}/venv/bin:$PATH"; `
        startCmd = startCmd.replace(/^venv\/bin\//, '')
        if (/^gunicorn\b/.test(startCmd) && !/(\s-b|--bind)\b/.test(startCmd)) startCmd = `${startCmd} --bind 127.0.0.1:${port} --workers 2 --timeout 120`
        else if (/^uvicorn\b/.test(startCmd)) startCmd = `${startCmd.replace(/--(host|port)[\s=]+\S+/g, '').replace(/\s+/g, ' ').trim()} --host 127.0.0.1 --port ${port}`
      } else if (plan.type === 'java') {
        startCmd = `java -jar "$(ls -S target/*.jar build/libs/*.jar 2>/dev/null | grep -v plain | head -1)" --server.port=${port}`
      } else if (plan.type === 'ruby') {
        startCmd = `${startCmd} -p ${port}`
      }
      const runner = `cd ${sd} && ${loadEnv}; ${pyEnv}export PORT=${port}; exec ${startCmd}`
      await sh(`
pm2 delete ${q(cfg.appName)} >/dev/null 2>&1 || true
cd ${q(sd)}
pm2 start bash --name ${q(cfg.appName)} --cwd ${q(sd)} -- -c ${q(runner)}
pm2 save >/dev/null
echo "Started ${cfg.appName} with PM2"`)
      // Give it a moment, then confirm it stayed up
      await sh('sleep 4', { quiet: true })
      const status = await query(`pm2 jlist 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s.slice(s.indexOf("[")));const p=a.find(x=>x.name===${JSON.stringify(cfg.appName)});console.log(p?p.pm2_env.status+" "+p.pm2_env.restart_time:"missing")}catch(e){console.log("unknown")}})'`)
      log(`PM2 status: ${status}\n`)
      if (/^(errored|stopped|missing)/.test(status) || Number(status.split(' ')[1]) > 3) {
        const tail = await query(`pm2 logs ${q(cfg.appName)} --lines 40 --nostream 2>&1 | tail -n 40`)
        log(`${tail}\n`, true)
        throw new Error('The app crashed right after starting. Check the log above (often a missing environment variable or database connection).')
      }
    }
    stage('service', needsPort ? 'done' : 'skipped', needsPort ? `PM2 · ${cfg.appName}` : 'Served directly by nginx')

    // ------------------------------------------------------------------ webserver
    stage('webserver', 'running', cfg.domain)
    const confPath = `/etc/nginx/sites-available/${cfg.domain}.conf`
    const marker = `# autodeploy:${cfg.appName}`
    const existingConf = await query(`cat ${q(confPath)} 2>/dev/null`)
    if (existingConf && !existingConf.includes(marker) && !cfg.replaceDomain) {
      throw new Error(`${cfg.domain} is already configured on this server for another site. Use a different domain, or tick "Replace existing site for this domain".`)
    }
    const proxy = (p) => `proxy_pass http://127.0.0.1:${p};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300;`
    // Django serves no static files once DEBUG is off: let nginx serve what collectstatic gathered
    let djangoLocations = ''
    if (isPython(serverUnit) && serverUnit.django) {
      const [staticUrl, staticRoot] = (await query(`cd ${q(serverDir)} && ${loadEnv}; venv/bin/python manage.py shell -c 'from django.conf import settings as s; print(s.STATIC_URL or ""); print(s.STATIC_ROOT or "")' 2>/dev/null | tail -n 2`)).split('\n')
      if (/^\/[\w\/.-]*\/$/.test(staticUrl || '') && /^\/[\w\/.-]+$/.test(staticRoot || '')) djangoLocations += `    location ${staticUrl} { alias ${staticRoot.replace(/\/$/, '')}/; expires 7d; }\n`
      if (plan.type === 'fullstack') djangoLocations += `    location /admin/ {\n        ${proxy(port)}\n    }\n`
    }
    let body
    if (plan.type === 'static') {
      body = `    root ${dir}${plan.dir ? `/${plan.dir}` : ''};\n    index index.html;\n    location / { try_files $uri $uri/ =404; }`
    } else if (plan.type === 'spa') {
      body = `    root ${appDirOf(plan)}/${plan.outputDir};\n    index index.html;\n    location / { try_files $uri $uri/ /index.html; }`
    } else if (plan.type === 'fullstack') {
      body = `${djangoLocations}    root ${appDirOf(plan.frontend)}/${plan.frontend.outputDir};\n    index index.html;\n    location /api/ {\n        ${proxy(port)}\n    }\n    location /socket.io/ {\n        ${proxy(port)}\n    }\n    location / { try_files $uri $uri/ /index.html; }`
    } else if (plan.type === 'php') {
      let fpm = await query(FIND_PHP_FPM)
      if (!fpm) {
        log('PHP-FPM is not running; installing it…\n')
        await sh('DEBIAN_FRONTEND=noninteractive apt-get install -y php-fpm 2>&1 | tail -n 3; systemctl enable --now "$(systemctl list-unit-files "php*-fpm.service" --no-legend | awk \'{print $1}\' | sort -V | tail -1)" 2>&1 || true', { allowFailure: true })
        fpm = await query(FIND_PHP_FPM)
      }
      if (!/^(unix:\/[\w\/.-]+|[\w.-]+:\d+)$/.test(fpm)) throw new Error('PHP-FPM is not running on the server (apt install php-fpm).')
      log(`PHP-FPM: ${fpm}\n`)
      // Inline fastcgi settings: snippets/fastcgi-php.conf only exists on Debian's nginx package
      body = `    root ${dir}${plan.webRoot ? `/${plan.webRoot}` : ''};\n    index index.php index.html;\n    location / { try_files $uri $uri/ /index.php?$query_string; }\n    location ~ \\.php$ {\n        try_files $fastcgi_script_name =404;\n        fastcgi_split_path_info ^(.+\\.php)(/.+)$;\n        include fastcgi_params;\n        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;\n        fastcgi_param PATH_INFO $fastcgi_path_info;\n        fastcgi_index index.php;\n        fastcgi_read_timeout 300;\n        fastcgi_pass ${fpm};\n    }\n    location ~ /\\.(?!well-known) { deny all; }`
      await sh(`chown -R www-data:www-data ${q(dir)}`, { allowFailure: true, quiet: true })
    } else {
      body = `${djangoLocations}    location / {\n        ${proxy(port)}\n    }`
    }
    // Migrated public Supabase buckets keep their URL paths on the app's domain
    const storageLocations = storageInfo ? publicBucketLocations(storageInfo.dir, storageInfo.buckets) : ''
    // The app's Supabase API at Supabase's paths, plus a local-only copy for its edge functions
    const supabaseLocations = stackInfo ? `${stackInfo.locations}\n` : ''
    const conf = `${marker}\nserver {\n    listen 80;\n    listen [::]:80;\n    server_name ${cfg.domain};\n    client_max_body_size 64m;\n${storageLocations ? `${storageLocations}\n` : ''}${supabaseLocations}${body}\n}\n${stackInfo ? `\n${stackInfo.gateway}` : ''}`
    await sh(`
set -e
[ -f ${q(confPath)} ] && cp ${q(confPath)} ${q(`${confPath}.bak`)}
echo ${b64(conf)} | base64 -d > ${q(confPath)}
ln -sf ${q(confPath)} ${q(`/etc/nginx/sites-enabled/${cfg.domain}.conf`)}
if ! nginx -t 2>&1; then
  echo "nginx rejected the configuration — restoring the previous one" >&2
  if [ -f ${q(`${confPath}.bak`)} ]; then mv ${q(`${confPath}.bak`)} ${q(confPath)}; else rm -f ${q(confPath)} ${q(`/etc/nginx/sites-enabled/${cfg.domain}.conf`)}; fi
  exit 1
fi
systemctl reload nginx
echo "nginx is serving ${cfg.domain}"`)
    stage('webserver', 'done')

    // ------------------------------------------------------------------ ssl
    let https = false
    if (!cfg.ssl) {
      stage('ssl', 'skipped', 'HTTPS disabled')
    } else {
      stage('ssl', 'running')
      // A record we just wrote: ask the zone's own nameserver (what Let's Encrypt sees) and give it
      // a couple of minutes, since the server's resolver may not have it yet
      const lookup = dns
        ? `if command -v dig >/dev/null 2>&1; then ns=$(dig +short NS ${q(dns.zone)} | head -1); dig +short A ${q(cfg.domain)} \${ns:+@$ns}; else getent ahostsv4 ${q(cfg.domain)} | awk '{print $1}'; fi | sort -u | tr '\\n' ' '`
        : `getent ahostsv4 ${q(cfg.domain)} | awk '{print $1}' | sort -u | tr '\\n' ' '`
      let resolved = await query(lookup)
      for (let i = 0; dns && i < 24 && !resolved.split(' ').includes(serverIp); i++) {
        if (i === 0) log(`Waiting for ${cfg.domain} to resolve to ${serverIp}…\n`)
        await sh('sleep 5', { quiet: true })
        resolved = await query(lookup)
      }
      if (!resolved.split(' ').includes(serverIp)) {
        const msg = `${cfg.domain} does not point to this server yet (DNS: ${resolved.trim() || 'not found'}, server: ${serverIp}). ${dns ? 'The record was saved but has not propagated yet — redeploy in a few minutes' : 'Add an A record, then redeploy'} to get HTTPS.`
        warnings.push(msg)
        log(`${msg}\n`, true)
        stage('ssl', 'warning', 'Domain does not point here yet')
      } else {
        if (!await query('command -v certbot')) await sh('apt-get install -y certbot python3-certbot-nginx >/dev/null 2>&1 || true', { allowFailure: true })
        const r = await sh(`certbot --nginx -d ${q(cfg.domain)} --non-interactive --agree-tos ${cfg.sslEmail ? `-m ${q(cfg.sslEmail)}` : '--register-unsafely-without-email'} --redirect --keep-until-expiring 2>&1`, { allowFailure: true })
        if (r.code === 0) { https = true; stage('ssl', 'done', 'Certificate installed') } else {
          warnings.push('Let\'s Encrypt could not issue a certificate (see the log). The site works over http.')
          stage('ssl', 'warning', 'Certificate not issued')
        }
      }
    }

    // ------------------------------------------------------------------ verify
    stage('verify', 'running')
    const target = needsPort && plan.type !== 'fullstack' ? `http://127.0.0.1:${port}/` : 'http://127.0.0.1/'
    let code = ''
    for (let i = 0; i < 10; i++) {
      code = await query(`curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H ${q(`Host: ${cfg.domain}`)} ${q(target)}`)
      if (/^[234]\d\d$/.test(code)) break
      await sh('sleep 3', { quiet: true })
    }
    if (needsPort && plan.type === 'fullstack') {
      const apiCode = await query(`curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:${port}/`)
      log(`Backend responded with HTTP ${apiCode || 'nothing'}\n`, !apiCode || apiCode === '000')
    }
    log(`Site responded with HTTP ${code || 'nothing'}\n`, !/^[234]\d\d$/.test(code))
    if (!/^[234]\d\d$/.test(code)) {
      warnings.push(`The site answered with HTTP ${code || '000'} on the first check. It may still be starting — open it in a minute, or check the app logs.`)
      stage('verify', 'warning', `HTTP ${code || 'no response'}`)
    } else {
      stage('verify', 'done', `HTTP ${code}`)
    }

    const url = `${https ? 'https' : 'http'}://${cfg.domain}`
    emit({ kind: 'progress', percent: 100 })
    emit({
      kind: 'result',
      status: 'success',
      url,
      summary: {
        framework: plan.framework,
        type: plan.type,
        port,
        directory: dir,
        database: dbInfo ? { engine: dbInfo.engine, name: dbInfo.name, user: dbInfo.user, password: dbInfo.password, url: dbInfo.url, migratedFrom: dbInfo.migratedFrom || null } : null,
        storage: storageInfo ? {
          directory: storageInfo.dir,
          files: storageInfo.files,
          buckets: storageInfo.buckets,
          publicUrl: `${https ? 'https' : 'http'}://${cfg.domain}/storage/v1/object/public`,
          supabaseUrl: `${storageInfo.base}/storage/v1/object/public`
        } : null,
        supabase: stackInfo ? {
          url: `${https ? 'https' : 'http'}://${cfg.domain}`,
          anonKey: stackInfo.keys.anon,
          serviceKey: stackInfo.keys.service_role,
          keysChanged: stackInfo.keysChanged,
          functions: stackInfo.functions,
          processes: stackInfo.processes,
          replaces: sb.ref ? `https://${sb.ref}.supabase.co` : null
        } : null,
        dns: dns ? { zone: dns.zone, provider: dns.provider, action: dns.action } : null,
        admin: adminInfo && dbInfo?.fresh ? { email: adminInfo.email, password: envValue(serverEnv.find(([k]) => k === adminInfo.passwordKey)?.[1]), url } : null,
        warnings
      }
    })
    return { success: true, url, plan, port, dns }
  } catch (err) {
    const failed = current || 'connect'
    const message = redactUrl(scrub(err.message || String(err)))
    log(`\n${message}\n`, true)
    emit({ kind: 'stage', id: failed, status: 'failed', label: STAGES.find(s => s.id === failed)?.label, detail: message })
    emit({ kind: 'result', status: 'failed', error: message, stage: failed, summary: { warnings } })
    return { success: false, error: message, plan, port }
  }
}

function db_escape(s) {
  return String(s).replace(/[\\/&"$`]/g, '\\$&')
}
