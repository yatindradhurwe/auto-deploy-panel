import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import { q } from './host.service.js'

/**
 * A Supabase-compatible API for one migrated app, on the app's own server, so a supabase-js app keeps
 * working unchanged once SUPABASE_URL points at its domain:
 *
 *   https://<domain>/auth/v1/       GoTrue (Supabase Auth), on the copied auth schema: users keep their passwords
 *   https://<domain>/rest/v1/       PostgREST, row level security enforced with the project's JWT secret
 *   https://<domain>/storage/v1/    storage-server.mjs: Storage API over the copied files and storage schema
 *   https://<domain>/functions/v1/  functions-router.ts: the repo's supabase/functions under Deno
 *
 * Each runs under PM2 (<app>-auth, -rest, -storage, -functions) on 127.0.0.1. Binaries are pinned
 * releases checked against SHA-256 sums and shared by every app under SUPABASE_HOME; each app's
 * settings live in SUPABASE_HOME/apps/<app> (0600). Realtime is not provided.
 */

export const SUPABASE_HOME = '/opt/autodeploy-supabase'
const RUNTIME_SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'supabase-runtime')
const RUNTIME_FILES = ['storage-server.mjs', 'functions-router.ts', 'std-http-server.ts', 'rewrite-build.mjs', 'package.json']
export const STACK_SERVICES = ['auth', 'rest', 'storage', 'functions']
const PORT_BASE = 54100

const gh = (repo, tag, file) => `https://github.com/${repo}/releases/download/${tag}/${file}`
const RELEASES = {
  auth: {
    version: 'v2.197.0',
    x86_64: { url: gh('supabase/auth', 'v2.197.0', 'auth-v2.197.0-amd64.tar.xz'), sha256: 'b5c2991d1df760c9b099c1c2395a94bd1c2f83ed58901934921997179dc9f7ea' },
    aarch64: { url: gh('supabase/auth', 'v2.197.0', 'auth-v2.197.0-arm64.tar.xz'), sha256: 'a9da2e668137cb280c830d900df4081b3fdd42a289469485634426a7587f9f76' }
  },
  postgrest: {
    version: 'v16.4',
    x86_64: { url: gh('PostgREST/postgrest', 'v16.4', 'postgrest-v16.4-linux-static-x86-64.tar.xz'), sha256: 'b47ecc82fce1dcebbbc4183d839e52f07f7630c9d7ad0f54db753d1939299354' },
    aarch64: { url: gh('PostgREST/postgrest', 'v16.4', 'postgrest-v16.4-linux-static-aarch64.tar.xz'), sha256: 'bf544f94f305a1ff37d82f5ef1298d584f1f98b51dfd8182d1437a02073d8731' }
  },
  deno: {
    version: 'v2.9.8',
    x86_64: { url: gh('denoland/deno', 'v2.9.8', 'deno-x86_64-unknown-linux-gnu.zip'), sha256: 'e890975bc2549807bbcc0b584ffafda72cc7c93349dd99c80483dd784f6c4609' },
    aarch64: { url: gh('denoland/deno', 'v2.9.8', 'deno-aarch64-unknown-linux-gnu.zip'), sha256: 'd49596c20b9788cf8f5d8ddf644103d4bde56ed239753f0bdb92ba9361d51905' }
  }
}

const httpErr = (status, message) => Object.assign(new Error(message), { status })
const pgIdent = (s) => `"${String(s).replace(/"/g, '""')}"`
const pgLit = (v) => `'${String(v).replace(/'/g, "''")}'`
const APP_RE = /^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/
export const REF_RE = /^[a-z0-9]{8,40}$/
export const stackDir = (app) => `${SUPABASE_HOME}/apps/${app}`
export const stackFile = (app) => `${stackDir(app)}/stack.json`
export const processName = (app, service) => `${app}-${service}`

// ------------------------------------------------------------------ JWTs (HS256, like Supabase's legacy keys)
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')

export function signJwt(claims, secret) {
  const body = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(claims)}`
  return `${body}.${crypto.createHmac('sha256', secret).update(body).digest('base64url')}`
}

/** The claims of an HS256 JWT signed with `secret`, or null. */
export function verifyJwt(token, secret) {
  const parts = String(token || '').split('.')
  if (parts.length !== 3 || !secret) return null
  try {
    const want = crypto.createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest()
    const got = Buffer.from(parts[2], 'base64url')
    if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString())
  } catch { return null }
}

/** anon and service_role keys for `ref`, valid for 10 years, as Supabase issues them. */
export function mintKeys(secret, ref) {
  const iat = Math.floor(Date.now() / 1000)
  const exp = iat + 10 * 365 * 24 * 3600
  return {
    anon: signJwt({ iss: 'supabase', ref, role: 'anon', iat, exp }, secret),
    service_role: signJwt({ iss: 'supabase', ref, role: 'service_role', iat, exp }, secret)
  }
}

/**
 * The keys the stack uses. With the source project's JWT secret, its own keys stay valid (and so do
 * keys already built into the app); otherwise new keys are signed with a new secret.
 */
export function stackKeys({ jwtSecret, sourceKeys, ref }) {
  const ok = (k, role) => verifyJwt(k, jwtSecret)?.role === role
  if (sourceKeys && ok(sourceKeys.anon, 'anon') && ok(sourceKeys.service_role, 'service_role')) {
    return { keys: { anon: sourceKeys.anon, service_role: sourceKeys.service_role }, reused: true }
  }
  return { keys: mintKeys(jwtSecret, ref), reused: false }
}

// ------------------------------------------------------------------ Supabase Auth settings
const OAUTH_PROVIDERS = ['apple', 'azure', 'bitbucket', 'discord', 'facebook', 'figma', 'fly', 'github', 'gitlab', 'google', 'kakao', 'keycloak', 'linkedin_oidc', 'notion', 'slack_oidc', 'spotify', 'twitch', 'twitter', 'workos', 'zoom']
const clean = (v, max = 500) => String(v ?? '').replace(/[\r\n]/g, '').trim().slice(0, max)
const bool = (v, d = false) => (v === undefined || v === null ? d : v === true || v === 'true')
const int = (v, d, min, max) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : d }

/**
 * The parts of a Supabase project's Auth settings (Management API GET /v1/projects/{ref}/config/auth,
 * or the wizard's manual fields) that GoTrue on this server uses. Unknown keys are dropped.
 */
export function normalizeAuthConfig(raw = {}) {
  raw = raw && typeof raw === 'object' ? raw : {}
  const smtpHost = clean(raw.smtp_host, 255)
  const providers = {}
  for (const p of OAUTH_PROVIDERS) {
    if (!bool(raw[`external_${p}_enabled`])) continue
    const clientId = clean(raw[`external_${p}_client_id`], 1000)
    const secret = clean(raw[`external_${p}_secret`], 4000)
    if (!clientId || !secret) continue
    providers[p] = { clientId, secret, url: clean(raw[`external_${p}_url`], 500) || null, skipNonceCheck: bool(raw[`external_${p}_skip_nonce_check`]) }
  }
  return {
    siteUrl: clean(raw.site_url, 500) || null,
    uriAllowList: String(raw.uri_allow_list || '').split(',').map(s => clean(s, 500)).filter(Boolean).slice(0, 100),
    disableSignup: bool(raw.disable_signup),
    autoconfirm: bool(raw.mailer_autoconfirm),
    emailEnabled: bool(raw.external_email_enabled, true),
    anonymousUsers: bool(raw.external_anonymous_users_enabled),
    jwtExp: int(raw.jwt_exp, 3600, 30, 604800),
    passwordMinLength: int(raw.password_min_length, 6, 6, 128),
    smtp: smtpHost ? {
      host: smtpHost,
      port: int(raw.smtp_port, 587, 1, 65535),
      user: clean(raw.smtp_user, 255),
      pass: clean(raw.smtp_pass, 1000),
      adminEmail: clean(raw.smtp_admin_email, 255),
      senderName: clean(raw.smtp_sender_name, 255)
    } : null,
    providers
  }
}

/** GoTrue's environment for the app. Returns [[key, value]]. */
export function gotrueEnv({ port, publicUrl, dbUrl, jwtSecret, migrationsPath, auth }) {
  const a = auth || normalizeAuthConfig({})
  // Without a mail server, confirmation emails cannot be sent: confirm sign-ups automatically
  const autoconfirm = a.autoconfirm || !a.smtp
  const sameApp = (u) => { try { const h = new URL(u).hostname; return /\.vercel\.app$/i.test(h) || /^(localhost|127\.0\.0\.1)$/.test(h) } catch { return true } }
  const siteUrl = a.siteUrl && !sameApp(a.siteUrl) ? a.siteUrl : publicUrl
  const allow = [...new Set([`${publicUrl}/**`, siteUrl, ...a.uriAllowList])]
  const env = [
    ['GOTRUE_API_HOST', '127.0.0.1'],
    ['PORT', String(port)],
    ['API_EXTERNAL_URL', publicUrl],
    ['GOTRUE_DB_DRIVER', 'postgres'],
    ['DATABASE_URL', dbUrl],
    ['GOTRUE_DB_NAMESPACE', 'auth'],
    ['GOTRUE_DB_MIGRATIONS_PATH', migrationsPath],
    ['GOTRUE_SITE_URL', siteUrl],
    ['GOTRUE_URI_ALLOW_LIST', allow.join(',')],
    ['GOTRUE_JWT_SECRET', jwtSecret],
    ['GOTRUE_JWT_EXP', String(a.jwtExp)],
    ['GOTRUE_JWT_AUD', 'authenticated'],
    ['GOTRUE_JWT_DEFAULT_GROUP_NAME', 'authenticated'],
    ['GOTRUE_JWT_ADMIN_ROLES', 'service_role'],
    ['GOTRUE_DISABLE_SIGNUP', String(a.disableSignup)],
    ['GOTRUE_EXTERNAL_EMAIL_ENABLED', String(a.emailEnabled)],
    ['GOTRUE_EXTERNAL_PHONE_ENABLED', 'false'],
    ['GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED', String(a.anonymousUsers)],
    ['GOTRUE_MAILER_AUTOCONFIRM', String(autoconfirm)],
    ['GOTRUE_PASSWORD_MIN_LENGTH', String(a.passwordMinLength)],
    ['GOTRUE_MAILER_URLPATHS_INVITE', '/auth/v1/verify'],
    ['GOTRUE_MAILER_URLPATHS_CONFIRMATION', '/auth/v1/verify'],
    ['GOTRUE_MAILER_URLPATHS_RECOVERY', '/auth/v1/verify'],
    ['GOTRUE_MAILER_URLPATHS_EMAIL_CHANGE', '/auth/v1/verify'],
    ['GOTRUE_LOG_LEVEL', 'info']
  ]
  if (a.smtp) {
    env.push(['GOTRUE_SMTP_HOST', a.smtp.host], ['GOTRUE_SMTP_PORT', String(a.smtp.port)], ['GOTRUE_SMTP_USER', a.smtp.user], ['GOTRUE_SMTP_PASS', a.smtp.pass],
      ['GOTRUE_SMTP_ADMIN_EMAIL', a.smtp.adminEmail], ['GOTRUE_SMTP_SENDER_NAME', a.smtp.senderName])
  }
  for (const [p, c] of Object.entries(a.providers || {})) {
    const P = `GOTRUE_EXTERNAL_${p.toUpperCase()}`
    env.push([`${P}_ENABLED`, 'true'], [`${P}_CLIENT_ID`, c.clientId], [`${P}_SECRET`, c.secret], [`${P}_REDIRECT_URI`, `${publicUrl}/auth/v1/callback`])
    if (c.url) env.push([`${P}_URL`, c.url])
    if (c.skipNonceCheck) env.push([`${P}_SKIP_NONCE_CHECK`, 'true'])
  }
  return env
}

// ------------------------------------------------------------------ the app's environment
const SUPABASE_PG_HOST_RE = /^(db\.[a-z0-9]{8,40}\.supabase\.co|[a-z0-9-]+\.pooler\.supabase\.com)$/i

/**
 * Values that point the app at its own stack instead of Supabase: every variable holding the old
 * project URL, Supabase anon/publishable and service/secret key variables, SUPABASE_JWT_SECRET,
 * and PostgreSQL URLs on Supabase hosts (DIRECT_URL, POSTGRES_PRISMA_URL, …). Applied last, so it
 * also corrects variables imported from Vercel. Returns [[key, value]].
 */
export function supabaseEnvLayer(pairs, { ref, url, keys, jwtSecret, dbUrl }) {
  const unq = (v) => String(v ?? '').trim().replace(/^(['"])(.*)\1$/, '$2')
  const out = new Map([['SUPABASE_URL', url], ['SUPABASE_ANON_KEY', keys.anon], ['SUPABASE_SERVICE_ROLE_KEY', keys.service_role]])
  const host = new URL(url).host
  for (const [k, raw] of pairs) {
    const v = unq(raw)
    if (/SUPABASE/.test(k) && /JWT_SECRET/.test(k)) out.set(k, jwtSecret)
    else if (/SUPABASE/.test(k) && /(ANON|PUBLISHABLE)/.test(k) && /KEY/.test(k)) out.set(k, keys.anon)
    else if (/SUPABASE/.test(k) && /(SERVICE|SECRET)/.test(k) && /KEY/.test(k)) out.set(k, keys.service_role)
    else if (/^postgres(ql)?:\/\//i.test(v)) {
      try { if (SUPABASE_PG_HOST_RE.test(new URL(v).hostname)) out.set(k, dbUrl) } catch { /* not a URL */ }
    } else if (ref && v.includes(`${ref}.supabase.co`)) {
      out.set(k, v.split(`https://${ref}.supabase.co`).join(url).split(`${ref}.supabase.co`).join(host))
    } else if (/^(NEXT_PUBLIC_|VITE_|REACT_APP_|EXPO_PUBLIC_|PUBLIC_|NUXT_PUBLIC_|GATSBY_)?SUPABASE_URL$/.test(k)) {
      out.set(k, url)
    }
  }
  return [...out.entries()]
}

// ------------------------------------------------------------------ nginx
const proxyTo = (port) => `proxy_pass http://127.0.0.1:${port}/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;`

/** Locations for the app's server block: Supabase's URL layout on the app's own domain. */
export function stackLocations(ports, { functions = true } = {}) {
  return [
    `    location /auth/v1/ {\n        ${proxyTo(ports.auth)}\n    }`,
    `    location /rest/v1/ {\n        ${proxyTo(ports.rest)}\n    }`,
    `    location /storage/v1/ {\n        ${proxyTo(ports.storage)}\n        proxy_request_buffering off;\n        proxy_read_timeout 300;\n    }`,
    ...(functions ? [`    location /functions/v1/ {\n        ${proxyTo(ports.functions)}\n        proxy_read_timeout 150;\n    }`] : [])
  ].join('\n')
}

/** A server block on 127.0.0.1 with the same routes, used as SUPABASE_URL by the edge functions. */
export function gatewayServer(ports, opts) {
  return `server {\n    listen 127.0.0.1:${ports.gateway};\n    server_name _;\n    client_max_body_size 64m;\n${stackLocations(ports, opts)}\n}\n`
}

// ------------------------------------------------------------------ install
const envFileLines = (pairs) => `${pairs.map(([k, v]) => `${k}=${String(v ?? '').replace(/[\r\n]/g, '')}`).join('\n')}\n`
// Reads KEY=value lines literally (nothing is executed), like the deploy pipeline's loadEnv
const loadEnvFile = (file) => `while IFS= read -r line || [ -n "$line" ]; do case "$line" in ''|'#'*) continue;; esac; export "\${line%%=*}=\${line#*=}"; done < ${q(file)}`
const tomlStr = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

async function serverArch(host) {
  const m = (await host.exec('uname -m')).stdout.trim()
  if (m === 'x86_64' || m === 'amd64') return 'x86_64'
  if (m === 'aarch64' || m === 'arm64') return 'aarch64'
  throw httpErr(400, `The Supabase services need an x86_64 or arm64 server (this one is ${m || 'unknown'}).`)
}

/** Installs one pinned release under SUPABASE_HOME/bin/<name>-<version> (checked against its SHA-256). */
async function installRelease(host, name, arch, onLog) {
  const rel = RELEASES[name]
  const dir = `${SUPABASE_HOME}/bin/${name}-${rel.version}`
  if (await host.exists(`${dir}/.installed`)) return dir
  const { url, sha256 } = rel[arch]
  onLog(`Installing ${name} ${rel.version}…\n`)
  const zip = url.endsWith('.zip')
  const r = await host.exec(`set -e
${zip ? 'command -v unzip >/dev/null || DEBIAN_FRONTEND=noninteractive apt-get install -y unzip >/dev/null 2>&1' : 'command -v xz >/dev/null || DEBIAN_FRONTEND=noninteractive apt-get install -y xz-utils >/dev/null 2>&1'}
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
curl -fsSL --retry 3 --connect-timeout 20 -o "$T/pkg" ${q(url)}
echo ${q(`${sha256}  `)}"$T/pkg" | sha256sum -c - >/dev/null
rm -rf ${q(dir)} && mkdir -p ${q(dir)}
${zip ? `unzip -q "$T/pkg" -d ${q(dir)}` : `tar -xJf "$T/pkg" -C ${q(dir)} --no-same-owner`}
touch ${q(`${dir}/.installed`)}`, { timeout: 15 * 60 * 1000 })
  if (r.code !== 0) throw httpErr(500, `Could not install ${name} ${rel.version}: ${(r.stderr || r.stdout).trim().split('\n').slice(-3).join(' ')}`)
  return dir
}

/** The shared binaries and runtime scripts. Returns their paths. */
export async function ensureSupabaseRuntime(host, { functions = false, onLog = () => {} } = {}) {
  if (!(await host.exec('command -v curl >/dev/null && command -v node >/dev/null && command -v npm >/dev/null && echo ok')).stdout.includes('ok')) {
    throw httpErr(400, 'The Supabase services need curl and Node.js (with npm) on the server.')
  }
  const arch = await serverArch(host)
  const authDir = await installRelease(host, 'auth', arch, onLog)
  const restDir = await installRelease(host, 'postgrest', arch, onLog)
  const denoDir = functions ? await installRelease(host, 'deno', arch, onLog) : null

  const runtime = `${SUPABASE_HOME}/runtime`
  await host.exec(`mkdir -p ${q(runtime)} && chmod 755 ${q(SUPABASE_HOME)}`)
  let pkgChanged = false
  for (const f of RUNTIME_FILES) {
    const content = fs.readFileSync(path.join(RUNTIME_SRC, f), 'utf8')
    const target = `${runtime}/${f}`
    const current = (await host.exists(target)) ? await host.readFile(target) : null
    if (current === content) continue
    await host.writeFile(target, content, { mode: 0o644 })
    if (f === 'package.json') pkgChanged = true
  }
  if (pkgChanged || !await host.exists(`${runtime}/node_modules/pg`)) {
    onLog('Installing the Storage API\'s packages…\n')
    const r = await host.exec(`cd ${q(runtime)} && npm install --omit=dev --no-audit --no-fund 2>&1 | tail -n 3`, { timeout: 10 * 60 * 1000 })
    if (r.code !== 0 || !await host.exists(`${runtime}/node_modules/pg`)) throw httpErr(500, `Could not install the Storage API's packages: ${r.stdout.trim()}`)
  }
  return {
    auth: `${authDir}/auth`,
    authMigrations: `${authDir}/migrations`,
    postgrest: `${restDir}/postgrest`,
    deno: denoDir ? `${denoDir}/deno` : null,
    runtime
  }
}

async function readStack(host, app) {
  try { return JSON.parse(await host.readFile(stackFile(app))) } catch { return null }
}

/** Five free local ports for auth, rest, storage, functions and the internal gateway, kept on redeploy. */
async function pickPorts(host, existing) {
  if (existing?.ports && STACK_SERVICES.every(s => existing.ports[s]) && existing.ports.gateway) return existing.ports
  const used = new Set((await host.exec("ss -ltnH | awk '{print $4}' | sed 's/.*://'")).stdout.split('\n').map(Number))
  // Ports reserved by other apps' stacks, even while stopped
  const others = (await host.exec(`cat ${q(SUPABASE_HOME)}/apps/*/stack.json 2>/dev/null | grep -oE '"(auth|rest|storage|functions|gateway)":[0-9]+' | grep -oE '[0-9]+$'`)).stdout
  for (const p of others.split('\n')) used.add(Number(p))
  const ports = {}
  let p = PORT_BASE
  for (const s of [...STACK_SERVICES, 'gateway']) {
    while (used.has(p)) p++
    ports[s] = p++
  }
  return ports
}

const psqlAs = (host, database, sql) => host.exec(`runuser -u postgres -- psql -X -q -v ON_ERROR_STOP=1 -d ${q(database)}`, { input: sql, timeout: 120000 })

/** Roles, grants and schemas the stack needs in the app's database (as Supabase sets them up). */
function databaseSql({ db, authenticator, password }) {
  const roles = ['anon', 'authenticated', 'service_role']
  const R = roles.map(pgIdent).join(', ')
  return {
    cluster: `DO $$ BEGIN
${roles.map(r => `  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${pgLit(r)}) THEN CREATE ROLE ${pgIdent(r)} NOLOGIN; END IF;`).join('\n')}
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${pgLit(authenticator)}) THEN CREATE ROLE ${pgIdent(authenticator)} LOGIN NOINHERIT; END IF;
END $$;
ALTER ROLE "service_role" BYPASSRLS;
ALTER ROLE ${pgIdent(authenticator)} WITH LOGIN NOINHERIT PASSWORD ${pgLit(password)};
GRANT ${R} TO ${pgIdent(authenticator)};
GRANT ${R} TO ${pgIdent(db.user)};
`,
    database: `SET ROLE ${pgIdent(db.user)};
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA public, auth, extensions TO ${R};
-- A copy without Supabase's grants (another provider, or an old dump) gets Supabase's defaults; RLS still applies
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')) THEN
    GRANT ALL ON ALL TABLES IN SCHEMA public TO ${R};
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO ${R};
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${R};
  END IF;
END $$;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${R};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ${R};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO ${R};
-- Storage tables when the copy has none (Supabase's own storage schema is copied with the database)
DO $$ BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    CREATE SCHEMA IF NOT EXISTS storage;
    CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, owner uuid, owner_id text, public boolean DEFAULT false, file_size_limit bigint, allowed_mime_types text[], created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
    CREATE UNIQUE INDEX bname ON storage.buckets (name);
    CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets (id), name text, owner uuid, owner_id text, metadata jsonb, user_metadata jsonb, version text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), last_accessed_at timestamptz DEFAULT now());
    CREATE UNIQUE INDEX bucketid_objname ON storage.objects (bucket_id, name);
    ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS 'SELECT (string_to_array(name, ''/''))[1:array_length(string_to_array(name, ''/''), 1) - 1]';
    CREATE FUNCTION storage.filename(name text) RETURNS text LANGUAGE sql IMMUTABLE AS 'SELECT (string_to_array(name, ''/''))[array_length(string_to_array(name, ''/''), 1)]';
    CREATE FUNCTION storage.extension(name text) RETURNS text LANGUAGE sql IMMUTABLE AS 'SELECT reverse(split_part(reverse(name), ''.'', 1))';
    GRANT ALL ON storage.buckets, storage.objects TO ${R};
  END IF;
END $$;
GRANT USAGE ON SCHEMA storage TO ${R};
NOTIFY pgrst, 'reload schema';
`
  }
}

async function waitFor(host, url, seconds) {
  const r = await host.exec(`for i in $(seq 1 ${seconds}); do code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 ${q(url)}); case "$code" in 2*|401|404) echo "$code"; exit 0;; esac; sleep 1; done; echo "\${code:-000}"; exit 1`, { timeout: (seconds + 30) * 1000 })
  return r.code === 0
}

async function startPm2(host, name, cwd, runner) {
  const r = await host.exec(`pm2 delete ${q(name)} >/dev/null 2>&1; pm2 start bash --name ${q(name)} --cwd ${q(cwd)} --max-memory-restart 300M -- -c ${q(runner)} >/dev/null && pm2 save >/dev/null && echo started`, { timeout: 60000 })
  if (!r.stdout.includes('started')) throw httpErr(500, `Could not start ${name} with PM2: ${(r.stderr || r.stdout).trim()}`)
}

const pm2Tail = async (host, name) => (await host.exec(`pm2 logs ${q(name)} --lines 25 --nostream 2>&1 | tail -n 25`)).stdout

/** Names of the functions in <project>/supabase/functions (folders with an index file). */
async function functionNames(host, dir) {
  const out = (await host.exec(`cd ${q(dir)} 2>/dev/null && for d in */; do d="\${d%/}"; case "$d" in _*|.*) continue;; esac; for f in index.ts index.js index.tsx index.mjs index.jsx; do [ -f "$d/$f" ] && echo "$d" && break; done; done`)).stdout
  return out.split('\n').map(s => s.trim()).filter(s => /^[A-Za-z0-9_-]{1,100}$/.test(s))
}

/** verify_jwt = false entries in supabase/config.toml. */
export function noVerifyFromConfigToml(text) {
  const out = []
  const re = /^\[functions\.("?)([A-Za-z0-9_-]+)\1\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/gm
  let m
  while ((m = re.exec(String(text || '')))) if (/^\s*verify_jwt\s*=\s*false\b/m.test(m[3])) out.push(m[2])
  return out
}

/**
 * The import map for the functions process: the functions' own import maps / deno.json "imports"
 * merged, plus deno.land/std http/server.ts redirected to a Deno 2 compatible serve().
 */
async function functionsImportMap(host, dir, runtime) {
  const imports = {}
  const scopes = {}
  const files = (await host.exec(`cd ${q(dir)} 2>/dev/null && ls -1 import_map.json deno.json deno.jsonc */deno.json */deno.jsonc */import_map.json 2>/dev/null`)).stdout.split('\n').filter(Boolean)
  for (const f of files) {
    try {
      const j = JSON.parse((await host.readFile(`${dir}/${f}`)).replace(/^\s*\/\/.*$/gm, ''))
      const base = f.includes('/') ? `${dir}/${path.dirname(f)}/` : `${dir}/`
      const resolve = (v) => (/^\.\.?\//.test(v) ? new URL(v, `file://${base}`).href : v)
      for (const [k, v] of Object.entries(j.imports || {})) if (typeof v === 'string') imports[k] = resolve(v)
      for (const [s, map] of Object.entries(j.scopes || {})) scopes[s] = { ...scopes[s], ...map }
    } catch { /* not JSON */ }
  }
  const std = (await host.exec(`grep -rhoE 'https://deno\\.land/std@[0-9.]+/http/server\\.ts' ${q(dir)} 2>/dev/null | sort -u`)).stdout.split('\n').filter(Boolean)
  for (const u of std) imports[u] = `file://${runtime}/std-http-server.ts`
  return { imports, ...(Object.keys(scopes).length ? { scopes } : {}) }
}

/**
 * Sets up (or, on a redeploy, updates) the app's Supabase services. Returns
 * { url, keys, jwtSecret, keysChanged, ports, processes, functions, notes, locations, gateway }.
 *
 * cfg: { appName, publicUrl, projectDir, db: { name, user, password }, ref, jwtSecret?, sourceKeys?,
 *        auth (normalizeAuthConfig), storage: { dir, buckets } | null, functionSecrets: [[k, v]],
 *        noVerifyJwt: [names], onLog }
 */
export async function setupSupabaseStack(host, cfg) {
  const { appName, publicUrl, projectDir, db, onLog = () => {} } = cfg
  if (!APP_RE.test(appName)) throw httpErr(400, 'Invalid app name.')
  if (!db?.name || !db?.user || !db?.password) throw httpErr(400, 'The Supabase services need the app\'s PostgreSQL database.')
  const notes = []
  const dir = stackDir(appName)
  const existing = await readStack(host, appName)
  const ref = REF_RE.test(cfg.ref || '') ? cfg.ref : (existing?.ref || appName.replace(/[^a-z0-9]/g, '').slice(0, 20).padEnd(8, '0'))

  // The source project's JWT secret keeps its keys and users' sessions valid; otherwise a new one
  const jwtSecret = cfg.jwtSecret || existing?.jwtSecret || crypto.randomBytes(32).toString('hex')
  if (jwtSecret.length < 32) throw httpErr(400, 'The JWT secret must be at least 32 characters.')
  const { keys, reused } = existing?.jwtSecret === jwtSecret && existing?.keys
    ? { keys: existing.keys, reused: !!existing.keysReused }
    : stackKeys({ jwtSecret, sourceKeys: cfg.sourceKeys, ref })
  if (!reused) notes.push(cfg.jwtSecret ? 'New anon and service keys were signed with the project\'s JWT secret.' : 'The stack signs with a new JWT secret: new anon and service keys are in the app\'s .env, and the built app is updated to use them. Users sign in again once.')

  const functionsDir = `${projectDir}/supabase/functions`
  const functions = await functionNames(host, functionsDir)
  const bins = await ensureSupabaseRuntime(host, { functions: functions.length > 0, onLog })
  const ports = await pickPorts(host, existing)
  const authenticator = `${db.name.slice(0, 48)}_authenticator`
  const authPassword = existing?.authenticatorPassword || crypto.randomBytes(18).toString('base64url')
  const dbUrl = (user, pass) => `postgres://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@127.0.0.1:5432/${db.name}`

  // 1. Database: roles and grants
  onLog('Preparing the database for Auth, REST and Storage…\n')
  const sql = databaseSql({ db, authenticator, password: authPassword })
  for (const [label, database, text] of [['roles', 'postgres', sql.cluster], ['grants', db.name, sql.database]]) {
    const r = await psqlAs(host, database, text)
    if (r.code !== 0) throw httpErr(500, `Could not prepare the database (${label}): ${(r.stderr || r.stdout).trim().split('\n').slice(-3).join(' ')}`)
  }

  // 2. Settings (0600: they hold the JWT secret and database logins)
  await host.exec(`mkdir -p ${q(dir)} && chmod 700 ${q(dir)}`)
  const write = (f, text) => host.writeFile(`${dir}/${f}`, text, { mode: 0o600 })
  await write('auth.env', envFileLines(gotrueEnv({ port: ports.auth, publicUrl, dbUrl: `${dbUrl(db.user, db.password)}?search_path=auth`, jwtSecret, migrationsPath: bins.authMigrations, auth: cfg.auth })))
  await write('rest.conf', [
    `db-uri = ${tomlStr(dbUrl(authenticator, authPassword))}`,
    'db-schemas = "public"',
    'db-anon-role = "anon"',
    'db-extra-search-path = "public, extensions"',
    'db-pool = 4',
    'db-max-rows = 1000',
    'db-channel-enabled = true',
    `jwt-secret = ${tomlStr(jwtSecret)}`,
    'server-host = "127.0.0.1"',
    `server-port = ${ports.rest}`,
    'log-level = "warn"',
    ''
  ].join('\n'))
  const storageDir = cfg.storage?.dir || `/var/lib/autodeploy-storage/${appName}`
  await host.exec(`mkdir -p ${q(storageDir)} && chmod 755 /var/lib/autodeploy-storage ${q(storageDir)}`)
  await write('buckets.json', JSON.stringify((cfg.storage?.buckets || []).map(b => ({ name: b.name, public: !!b.public }))))
  await write('storage.env', envFileLines([
    ['PORT', ports.storage], ['DATABASE_URL', dbUrl(authenticator, authPassword)], ['JWT_SECRET', jwtSecret],
    ['STORAGE_DIR', storageDir], ['FILE_SIZE_LIMIT', 52428800], ['BUCKETS_FILE', `${dir}/buckets.json`]
  ]))

  // 3. Files already on disk (copied from Supabase) get storage rows when the copy has none
  const sync = await host.exec(`cd ${q(bins.runtime)} && ${loadEnvFile(`${dir}/storage.env`)}; node storage-server.mjs --sync 2>&1`, { timeout: 30 * 60 * 1000 })
  onLog(`${sync.stdout.trim()}\n`)
  if (sync.code !== 0) throw httpErr(500, `Could not register the storage files: ${sync.stdout.trim().split('\n').slice(-2).join(' ')}`)

  // 4. Services
  const processes = []
  const start = async (service, cwd, runner) => { await startPm2(host, processName(appName, service), cwd, runner); processes.push(processName(appName, service)) }
  await start('auth', dir, `${loadEnvFile(`${dir}/auth.env`)}; exec ${q(bins.auth)} serve`)
  await start('rest', dir, `exec ${q(bins.postgrest)} ${q(`${dir}/rest.conf`)}`)
  await start('storage', bins.runtime, `${loadEnvFile(`${dir}/storage.env`)}; exec node storage-server.mjs`)

  if (functions.length) {
    const toml = (await host.exists(`${projectDir}/supabase/config.toml`)) ? await host.readFile(`${projectDir}/supabase/config.toml`) : ''
    const noVerify = [...new Set([...(cfg.noVerifyJwt || []), ...noVerifyFromConfigToml(toml)])].filter(n => functions.includes(n))
    await write('functions-import-map.json', JSON.stringify(await functionsImportMap(host, functionsDir, bins.runtime), null, 2))
    const reserved = new Set(['FUNCTIONS_PORT', 'FUNCTIONS_DIR', 'FUNCTIONS_JWT_SECRET', 'FUNCTIONS_NO_VERIFY_JWT', 'DENO_DIR'])
    await write('functions.env', envFileLines([
      ...(cfg.functionSecrets || []).filter(([k]) => !reserved.has(k)),
      ['SUPABASE_URL', `http://127.0.0.1:${ports.gateway}`], ['SUPABASE_ANON_KEY', keys.anon], ['SUPABASE_SERVICE_ROLE_KEY', keys.service_role],
      ['SUPABASE_DB_URL', dbUrl(db.user, db.password)], ['SUPABASE_PUBLIC_URL', publicUrl],
      ['FUNCTIONS_PORT', ports.functions], ['FUNCTIONS_DIR', functionsDir], ['FUNCTIONS_JWT_SECRET', jwtSecret], ['FUNCTIONS_NO_VERIFY_JWT', noVerify.join(',')],
      ['DENO_DIR', `${SUPABASE_HOME}/deno-cache`]
    ]))
    // Runs from the project's functions folder, so "Pull & Update" reloads it with the new code
    await start('functions', functionsDir, `${loadEnvFile(`${dir}/functions.env`)}; exec ${q(bins.deno)} run -A --no-config --no-prompt --import-map=${q(`${dir}/functions-import-map.json`)} ${q(`${bins.runtime}/functions-router.ts`)}`)
  } else {
    await host.exec(`pm2 delete ${q(processName(appName, 'functions'))} >/dev/null 2>&1; pm2 save >/dev/null 2>&1; true`)
  }

  // 5. Up? Auth applies its schema migrations on first start, the functions download their imports
  onLog('Waiting for Auth to finish its schema migrations…\n')
  for (const [service, url, seconds] of [['auth', `http://127.0.0.1:${ports.auth}/health`, 150], ['rest', `http://127.0.0.1:${ports.rest}/`, 60], ['storage', `http://127.0.0.1:${ports.storage}/status`, 30]]) {
    if (!await waitFor(host, url, seconds)) {
      onLog(await pm2Tail(host, processName(appName, service)), true)
      throw httpErr(500, `${processName(appName, service)} did not start (see the log above).`)
    }
  }
  if (functions.length && !await waitFor(host, `http://127.0.0.1:${ports.functions}/`, 180)) {
    onLog(await pm2Tail(host, processName(appName, 'functions')), true)
    notes.push(`The edge functions did not answer yet (${processName(appName, 'functions')}): check its log with pm2 logs.`)
  }

  const stack = {
    app: appName, ref, url: publicUrl, ports, keys, keysReused: reused, keysChanged: !cfg.jwtSecret && !reused, jwtSecret,
    authenticator, authenticatorPassword: authPassword, db: { name: db.name, user: db.user }, functions, processes,
    versions: Object.fromEntries(Object.entries(RELEASES).map(([k, v]) => [k, v.version])), updatedAt: new Date().toISOString(), createdAt: existing?.createdAt || new Date().toISOString()
  }
  await write('stack.json', JSON.stringify(stack, null, 2))
  return {
    url: publicUrl, keys, jwtSecret, keysChanged: stack.keysChanged, ports, processes, functions, notes,
    locations: stackLocations(ports, { functions: functions.length > 0 }),
    gateway: gatewayServer(ports, { functions: functions.length > 0 })
  }
}

/** Shell lines that point the app's built files at its stack (after a build); a no-op without a stack. */
export function rewriteBuildScript(appName, projectDir) {
  const f = stackFile(appName)
  return `if [ -f ${q(f)} ] && [ -f ${q(`${SUPABASE_HOME}/runtime/rewrite-build.mjs`)} ]; then node ${q(`${SUPABASE_HOME}/runtime/rewrite-build.mjs`)} ${q(f)} ${q(projectDir)} || echo "Could not update the built files for the local Supabase services"; fi`
}

/** Shell lines that remove the app's Supabase services and settings (the database is handled separately). */
export function removeStackScript(appName) {
  if (!APP_RE.test(appName)) return 'true'
  const dir = stackDir(appName)
  return `if [ -d ${q(dir)} ]; then
  echo "Removing the Supabase services of ${appName}"
  for s in ${STACK_SERVICES.join(' ')}; do pm2 delete ${q(appName)}-$s >/dev/null 2>&1 || true; done
  pm2 save >/dev/null 2>&1 || true
  A=$(grep -oE '"authenticator": *"[A-Za-z0-9_]+"' ${q(`${dir}/stack.json`)} 2>/dev/null | grep -oE '[A-Za-z0-9_]+"$' | tr -d '"')
  [ -n "$A" ] && runuser -u postgres -- psql -X -q -c "DROP ROLE IF EXISTS \\"$A\\"" 2>/dev/null || true
  rm -rf -- ${q(dir)}
fi`
}
