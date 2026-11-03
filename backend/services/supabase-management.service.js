import path from 'path'
import crypto from 'crypto'
import {
  SUPABASE_HOME,
  STACK_SERVICES,
  stackDir,
  stackFile,
  processName,
  mintKeys,
  signJwt,
  setupSupabaseStack,
  removeStackScript,
  gatewayServer,
  stackLocations,
  supabaseEnvLayer
} from './supabase-stack.service.js'
import {
  discoverDatabases,
  runQuery,
  createDatabase,
  upsertEnvVar,
  primaryEnvFile,
  writeEnvWithBackup,
  restartPm2,
  projectPm2,
  forgetDiscovery,
  RESERVED_DB_USERS
} from './database.service.js'
import { q } from './host.service.js'

/**
 * List all self-hosted Supabase projects on the server host,
 * plus all discovered database instances (PostgreSQL, MySQL, Mongo, Redis).
 */
export async function listAllSupabaseAndDatabases(host, { force = false, registered = [] } = {}) {
  // 1. Discover all databases across the server
  const dbDiscovery = await discoverDatabases(host, { force, registered })

  // 2. Discover self-hosted Supabase stacks in /opt/autodeploy-supabase/apps
  const stacks = []
  try {
    const listCmd = `if [ -d ${q(`${SUPABASE_HOME}/apps`)} ]; then ls -1 ${q(`${SUPABASE_HOME}/apps`)}; fi`
    const { stdout: appList } = await host.exec(listCmd)
    const appNames = (appList || '').split('\n').map(s => s.trim()).filter(Boolean)

    // Get live PM2 processes
    let pm2List = []
    try {
      const { stdout: pm2Out } = await host.exec('pm2 jlist 2>/dev/null || true')
      pm2List = JSON.parse(pm2Out || '[]')
    } catch {
      pm2List = []
    }

    for (const app of appNames) {
      try {
        const stackFilePath = stackFile(app)
        const exists = await host.exists(stackFilePath)
        if (!exists) continue

        const content = await host.readFile(stackFilePath)
        const stackData = JSON.parse(content)

        // Match PM2 processes for this stack
        const servicesStatus = STACK_SERVICES.map(svc => {
          const pName = processName(app, svc)
          const pm = pm2List.find(p => p.name === pName)
          return {
            service: svc,
            processName: pName,
            status: pm ? (pm.pm2_env?.status || 'stopped') : 'inactive',
            memory: pm?.monit?.memory || 0,
            cpu: pm?.monit?.cpu || 0,
            uptime: pm?.pm2_env?.pm_uptime ? Math.floor((Date.now() - pm.pm2_env.pm_uptime) / 1000) : 0,
            restarts: pm?.pm2_env?.restart_time || 0
          }
        })

        const isHealthy = servicesStatus.some(s => s.status === 'online')

        stacks.push({
          id: `supabase-${app}`,
          appName: app,
          ref: stackData.ref || app,
          publicUrl: stackData.url || `http://127.0.0.1:${stackData.ports?.gateway || 54100}`,
          ports: stackData.ports || {},
          keys: stackData.keys || {},
          jwtSecret: stackData.jwtSecret || '',
          db: stackData.db || { name: app, user: app },
          services: servicesStatus,
          status: isHealthy ? 'online' : 'stopped',
          functions: stackData.functions || [],
          versions: stackData.versions || {},
          createdAt: stackData.createdAt || null,
          updatedAt: stackData.updatedAt || null,
          projectDir: stackData.projectDir || null,
          isSupabaseStack: true
        })
      } catch (err) {
        console.error(`Error reading stack for ${app}:`, err.message)
      }
    }
  } catch (err) {
    console.error('Error listing Supabase stacks:', err.message)
  }

  // Flatten discovered databases: one row per database, with every project that uses it
  const byId = new Map()
  for (const proj of dbDiscovery?.projects || []) {
    for (const db of proj.databases || []) {
      const row = byId.get(db.id)
      if (row) row.projectNames.push(proj.name)
      else byId.set(db.id, { ...db, projectName: proj.name, projectPath: proj.path, projectNames: [proj.name] })
    }
  }
  for (const db of dbDiscovery?.unassigned || []) {
    if (!byId.has(db.id)) byId.set(db.id, { ...db, projectName: null, projectPath: null, projectNames: [] })
  }
  const allDbs = [...byId.values()]

  // Each stack's PostgreSQL database, for the SQL console and table browser
  for (const stack of stacks) {
    stack.connectionId = allDbs.find(d => d.engine === 'postgresql' && !d.external && d.database === stack.db?.name)?.id || null
  }

  return {
    supabaseStacks: stacks,
    databases: allDbs,
    engines: dbDiscovery?.engines || {},
    counts: {
      supabase: stacks.length,
      databases: allDbs.length,
      postgresql: allDbs.filter(d => d.engine === 'postgresql').length,
      mysql: allDbs.filter(d => d.engine === 'mysql').length,
      mongodb: allDbs.filter(d => d.engine === 'mongodb').length,
      redis: allDbs.filter(d => d.engine === 'redis').length
    }
  }
}

/**
 * Get detailed Supabase Project info including tables, auth users, and storage buckets.
 */
export async function getSupabaseProjectDetails(host, appName) {
  appName = stackAppName(appName)
  const stackFilePath = stackFile(appName)
  const exists = await host.exists(stackFilePath)
  if (!exists) {
    throw Object.assign(new Error(`Supabase project '${appName}' not found.`), { status: 404 })
  }

  const stackContent = await host.readFile(stackFilePath)
  const stack = JSON.parse(stackContent)

  // Live PM2 status
  let pm2List = []
  try {
    const { stdout: pm2Out } = await host.exec('pm2 jlist 2>/dev/null || true')
    pm2List = JSON.parse(pm2Out || '[]')
  } catch {
    pm2List = []
  }

  const services = STACK_SERVICES.map(svc => {
    const pName = processName(appName, svc)
    const pm = pm2List.find(p => p.name === pName)
    return {
      service: svc,
      processName: pName,
      status: pm ? (pm.pm2_env?.status || 'stopped') : 'inactive',
      memory: pm?.monit?.memory || 0,
      cpu: pm?.monit?.cpu || 0,
      uptime: pm?.pm2_env?.pm_uptime ? Math.floor((Date.now() - pm.pm2_env.pm_uptime) / 1000) : 0,
      restarts: pm?.pm2_env?.restart_time || 0
    }
  })

  // Read tables from PostgreSQL
  let tables = []
  let authUsers = []
  let storageBuckets = []

  const dbName = stack.db?.name || appName
  try {
    // List tables via psql peer
    const psqlTablesCmd = `runuser -u postgres -- psql -X -q -d ${q(dbName)} -t -A -c "
      SELECT table_schema, table_name,
        pg_total_relation_size(quote_ident(table_schema) || '.' || quote_ident(table_name)) AS bytes
      FROM information_schema.tables
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY table_schema, table_name;
    " 2>/dev/null || true`
    const { stdout: tOut } = await host.exec(psqlTablesCmd)
    if (tOut) {
      tables = tOut.trim().split('\n').filter(Boolean).map(line => {
        const [schema, name, bytes] = line.split('|')
        return {
          schema: schema || 'public',
          name: name || '',
          bytes: Number(bytes || 0)
        }
      })
    }

    // Try reading auth.users if GoTrue is present
    const psqlUsersCmd = `runuser -u postgres -- psql -X -q -d ${q(dbName)} -t -A -c "
      SELECT id, email, role, created_at, last_sign_in_at, email_confirmed_at
      FROM auth.users ORDER BY created_at DESC LIMIT 50;
    " 2>/dev/null || true`
    const { stdout: uOut } = await host.exec(psqlUsersCmd)
    if (uOut && !uOut.includes('does not exist')) {
      authUsers = uOut.trim().split('\n').filter(Boolean).map(line => {
        const [id, email, role, created_at, last_sign_in_at, email_confirmed_at] = line.split('|')
        return { id, email, role, created_at, last_sign_in_at, email_confirmed_at }
      })
    }

    // Try reading storage.buckets if storage is present
    const psqlBucketsCmd = `runuser -u postgres -- psql -X -q -d ${q(dbName)} -t -A -c "
      SELECT id, name, public, created_at
      FROM storage.buckets ORDER BY created_at DESC LIMIT 50;
    " 2>/dev/null || true`
    const { stdout: bOut } = await host.exec(psqlBucketsCmd)
    if (bOut && !bOut.includes('does not exist')) {
      storageBuckets = bOut.trim().split('\n').filter(Boolean).map(line => {
        const [id, name, isPublic, created_at] = line.split('|')
        return { id, name, public: isPublic === 't' || isPublic === 'true', created_at }
      })
    }
  } catch (err) {
    console.error(`Error querying database for ${appName}:`, err.message)
  }

  // Host address for connection string
  const hostIp = host.ipAddress || host.host || '127.0.0.1'
  const dbUser = stack.db?.user || appName
  const pgPort = 5432
  const poolerPort = 6543
  const directConnectionString = `postgresql://${dbUser}:[PASSWORD]@${hostIp}:${pgPort}/${dbName}`
  const poolerConnectionString = `postgresql://${dbUser}:[PASSWORD]@${hostIp}:${poolerPort}/${dbName}?pgbouncer=true`

  return {
    appName,
    ref: stack.ref || appName,
    publicUrl: stack.url,
    ports: stack.ports || {},
    keys: stack.keys || {},
    jwtSecret: stack.jwtSecret || '',
    db: stack.db || { name: dbName, user: dbUser },
    directConnectionString,
    poolerConnectionString,
    services,
    tables,
    authUsers,
    storageBuckets,
    functions: stack.functions || [],
    versions: stack.versions || {},
    createdAt: stack.createdAt,
    updatedAt: stack.updatedAt
  }
}

// ------------------------------------------------------------------ helpers

const APP_RE = /^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/
const DOMAIN_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BUCKET_RE = /^[a-z0-9][a-z0-9._-]{0,62}$/
const httpErr = (status, message) => Object.assign(new Error(message), { status })
const sqlLit = (s) => `'${String(s).replace(/'/g, "''")}'`
const sqlIdent = (s) => `"${String(s).replace(/"/g, '""')}"`
// .env values: quoted when they hold characters dotenv would read as a comment or a break
const envVal = (v) => (/[\s#]/.test(String(v)) ? `"${v}"` : String(v))

/** A stack's app name, checked: it becomes part of file paths, PM2 names and nginx files. */
export function stackAppName(raw) {
  const app = String(raw || '').trim()
  if (!APP_RE.test(app)) throw httpErr(400, 'Invalid Supabase app name (lowercase letters, numbers and hyphens).')
  return app
}

/** A bare host name (no scheme, path or www.), or '' when none was given. */
export function cleanDomain(raw) {
  const d = String(raw || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  if (!d) return ''
  if (!DOMAIN_RE.test(d)) throw httpErr(400, `"${raw}" is not a valid domain name.`)
  return d
}

async function readStackJson(host, appName) {
  const file = stackFile(appName)
  if (!(await host.exists(file))) throw httpErr(404, `Supabase project '${appName}' not found.`)
  return JSON.parse(await host.readFile(file))
}

const writeStackJson = (host, appName, stack) => host.writeFile(stackFile(appName), JSON.stringify(stack, null, 2), { mode: 0o600 })

/** Runs SQL as the postgres superuser. The SQL goes in on stdin, never through the shell. */
async function psqlStdin(host, database, sql, { strict = true } = {}) {
  const r = await host.exec(`runuser -u postgres -- psql -X -q ${strict ? '-v ON_ERROR_STOP=1 ' : ''}-d ${q(database)}`, { input: sql, timeout: 60000 })
  if (strict && r.code !== 0) throw httpErr(500, (r.stderr || r.stdout || 'psql failed').trim().split('\n').slice(-2).join(' '))
  return r
}

/** KEY=value pairs of a .env text. */
function envPairs(text) {
  const pairs = []
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\r?$/)
    if (m) pairs.push([m[1], m[2].replace(/^(["'])(.*)\1$/, '$2')])
  }
  return pairs
}

// Calls Supabase Auth's admin API on the server: the service key and the body go in on stdin,
// so neither shows up in a command line
const GOTRUE_ADMIN_SCRIPT = "let s='';process.stdin.on('data',d=>s+=d).on('end',async()=>{const r=JSON.parse(s);try{const res=await fetch(r.url,{method:r.method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+r.key,apikey:r.key},body:r.body?JSON.stringify(r.body):undefined});process.stdout.write(JSON.stringify({status:res.status,body:await res.text()}))}catch(e){process.stdout.write(JSON.stringify({status:0,body:String(e.message)}))}})"

async function gotrueAdmin(host, stack, method, apiPath, body) {
  if (!stack.ports?.auth || !stack.keys?.service_role) throw httpErr(500, 'This Supabase stack has no Auth service configured.')
  const r = await host.exec(`node -e ${q(GOTRUE_ADMIN_SCRIPT)}`, {
    input: JSON.stringify({ url: `http://127.0.0.1:${stack.ports.auth}${apiPath}`, method, key: stack.keys.service_role, body: body || null }),
    timeout: 30000
  })
  let out
  try { out = JSON.parse(r.stdout) } catch { throw httpErr(500, `Could not call Supabase Auth: ${(r.stderr || r.stdout || '').trim().slice(0, 200)}`) }
  if (out.status === 0) throw httpErr(502, `Supabase Auth is not answering (${out.body}). Restart its auth service.`)
  let json = null
  try { json = JSON.parse(out.body) } catch { /* empty body */ }
  if (out.status >= 400) throw httpErr(out.status === 404 ? 404 : 400, json?.msg || json?.message || json?.error_description || json?.error || `Supabase Auth answered ${out.status}.`)
  return json
}

// ------------------------------------------------------------------ nginx

const nginxSite = (app) => `/etc/nginx/sites-available/supabase-${app}.conf`
const nginxSiteOn = (app) => `/etc/nginx/sites-enabled/supabase-${app}.conf`
const nginxSnippet = (app) => `/etc/nginx/snippets/supabase-${app}.conf`
const NGINX_CONFS = '/etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf'
const serverNameRe = (domain) => `server_name[^;]*[[:space:]]${domain.replace(/\./g, '\\.')}([[:space:];]|$)`

/** nginx files (resolved, without our own) whose server blocks answer for `domain`. */
async function nginxFilesFor(host, domain) {
  const { stdout } = await host.exec(`for f in $(grep -lsE ${q(serverNameRe(domain))} ${NGINX_CONFS}); do readlink -f "$f"; done | sort -u`)
  return stdout.split('\n').map(s => s.trim()).filter(f => f && !/\/supabase-[a-z0-9-]+\.conf$/.test(f))
}

/** https when the domain's nginx config already has a certificate, else http. */
export async function domainScheme(host, domain) {
  const files = await nginxFilesFor(host, domain)
  if (!files.length) return 'http'
  const { stdout } = await host.exec(`grep -lsE 'listen[^;]*443|ssl_certificate' ${files.map(q).join(' ')} || true`)
  return stdout.trim() ? 'https' : 'http'
}

/**
 * Serves a stack through nginx: the local gateway (SUPABASE_URL for code on this server) and,
 * with a domain, Supabase's /auth/v1, /rest/v1, /storage/v1 and /functions/v1 on that domain —
 * added to the domain's existing server blocks, or in a new server block for a new domain.
 * Any nginx error rolls every file back.
 */
export async function publishStackNginx(host, appName, ports, { domain = '', functions = false } = {}) {
  appName = stackAppName(appName)
  if (!(await host.exec('command -v nginx >/dev/null 2>&1 && echo ok')).stdout.includes('ok')) {
    throw httpErr(400, 'nginx is not installed on this server, so the Supabase API cannot be published.')
  }
  const snippet = nginxSnippet(appName)
  const ownSite = nginxSiteOn(appName)
  const gatewayTaken = (await host.exec(`grep -lsE ${q(`listen[[:space:]]+127\\.0\\.0\\.1:${ports.gateway}[;[:space:]]`)} ${NGINX_CONFS} | grep -vxF ${q(ownSite)} || true`)).stdout.trim()
  let site = gatewayTaken ? '' : gatewayServer(ports, { functions })
  let inject = []
  const notes = []
  if (domain) {
    const files = await nginxFilesFor(host, domain)
    for (const f of files) {
      const text = await host.readFile(f).catch(() => '')
      if (/location\s+\/auth\/v1\//.test(text) && !text.includes(`include ${snippet};`)) notes.push(`${f} already routes /auth/v1/ to another Supabase stack, so it was left unchanged.`)
      else inject.push(f)
    }
    if (!files.length) site += `\nserver {\n    listen 80;\n    listen [::]:80;\n    server_name ${domain};\n    client_max_body_size 64m;\n    include ${snippet};\n}\n`
  }
  const b64 = (t) => Buffer.from(t).toString('base64')
  const script = `
set -e
mkdir -p /etc/nginx/snippets
echo ${b64(`${stackLocations(ports, { functions })}\n`)} | base64 -d > ${q(snippet)}
${site ? `echo ${b64(site)} | base64 -d > ${q(nginxSite(appName))}; ln -sf ${q(nginxSite(appName))} ${q(ownSite)}` : `rm -f ${q(nginxSite(appName))} ${q(ownSite)}`}
for f in ${inject.map(q).join(' ')}; do
  cp "$f" "$f.supabase-bak"
  grep -qF ${q(`include ${snippet};`)} "$f" || sed -i -E ${q(`/${serverNameRe(domain)}/a\\    include ${snippet};`)} "$f"
done
if ! nginx -t 2>&1; then
  for f in ${inject.map(q).join(' ')}; do mv "$f.supabase-bak" "$f"; done
  rm -f ${q(nginxSite(appName))} ${q(ownSite)} ${q(snippet)}
  echo "nginx rejected the configuration; it was rolled back" >&2
  exit 1
fi
for f in ${inject.map(q).join(' ')}; do rm -f "$f.supabase-bak"; done
systemctl reload nginx 2>/dev/null || nginx -s reload`
  const r = await host.exec(script, { timeout: 60000 })
  if (r.code !== 0) throw httpErr(500, `Could not publish the Supabase API in nginx: ${(r.stderr || r.stdout).trim().split('\n').slice(-3).join(' ')}`)
  if (domain && !inject.length && !notes.length) notes.push(`${domain} now serves the Supabase API over http. Point its DNS at this server and add HTTPS (certbot --nginx -d ${domain}).`)
  return { notes }
}

/** Removes what publishStackNginx added. */
async function removeStackNginx(host, appName) {
  const snippet = nginxSnippet(appName)
  await host.exec(`
for f in $(grep -lsF ${q(`include ${snippet};`)} ${NGINX_CONFS}); do r=$(readlink -f "$f"); sed -i ${q(`\\#include ${snippet};#d`)} "$r"; done
rm -f ${q(nginxSite(appName))} ${q(nginxSiteOn(appName))} ${q(snippet)}
if command -v nginx >/dev/null 2>&1 && nginx -t >/dev/null 2>&1; then systemctl reload nginx 2>/dev/null || nginx -s reload 2>/dev/null; fi
true`, { timeout: 60000 })
}

// ------------------------------------------------------------------ stack operations

/**
 * Restart a specific service (or all services) of a Supabase stack.
 */
export async function restartSupabaseService(host, appName, serviceName = 'all') {
  appName = stackAppName(appName)
  if (serviceName !== 'all' && !STACK_SERVICES.includes(serviceName)) throw httpErr(400, `Unknown service "${serviceName}".`)
  const restarted = []
  for (const svc of serviceName === 'all' ? STACK_SERVICES : [serviceName]) {
    const r = await host.exec(`pm2 restart ${q(processName(appName, svc))} --update-env >/dev/null 2>&1`)
    if (r.code === 0) restarted.push(processName(appName, svc))
  }
  if (!restarted.length) throw httpErr(404, `No running PM2 service found for ${appName}${serviceName === 'all' ? '' : ` (${serviceName})`}.`)
  return { success: true, restarted, message: `Restarted ${restarted.join(', ')}` }
}

/**
 * Rotate the JWT secret and mint new anon and service_role keys: every service of the stack
 * gets the new secret, and app .env files that held the old keys get the new ones.
 */
export async function rotateSupabaseKeys(host, appName) {
  appName = stackAppName(appName)
  const stack = await readStackJson(host, appName)
  const old = { jwtSecret: stack.jwtSecret, anon: stack.keys?.anon, service_role: stack.keys?.service_role }
  const jwtSecret = crypto.randomBytes(32).toString('hex')
  const keys = mintKeys(jwtSecret, stack.ref || appName)
  const dir = stackDir(appName)

  const updates = {
    'auth.env': { GOTRUE_JWT_SECRET: jwtSecret },
    'storage.env': { JWT_SECRET: jwtSecret },
    'functions.env': { FUNCTIONS_JWT_SECRET: jwtSecret, SUPABASE_ANON_KEY: keys.anon, SUPABASE_SERVICE_ROLE_KEY: keys.service_role }
  }
  for (const [f, vars] of Object.entries(updates)) {
    const file = `${dir}/${f}`
    if (!(await host.exists(file))) continue
    let text = await host.readFile(file)
    for (const [k, v] of Object.entries(vars)) text = upsertEnvVar(text, k, v).text
    await host.writeFile(file, text, { mode: 0o600 })
  }
  if (await host.exists(`${dir}/rest.conf`)) {
    const conf = await host.readFile(`${dir}/rest.conf`)
    await host.writeFile(`${dir}/rest.conf`, conf.replace(/^jwt-secret\s*=.*$/m, `jwt-secret = "${jwtSecret}"`), { mode: 0o600 })
  }

  Object.assign(stack, { jwtSecret, keys, keysReused: false, keysChanged: true, updatedAt: new Date().toISOString() })
  await writeStackJson(host, appName, stack)
  await restartSupabaseService(host, appName, 'all').catch(() => {})

  // App .env files that use the old keys (the linked project, or found by the old key itself)
  const oldValues = [old.anon, old.service_role, old.jwtSecret].filter(v => v && v.length >= 32)
  const updatedFiles = []
  if (oldValues.length) {
    const roots = [...new Set([stack.projectDir, '/var/www/*'].filter(Boolean))]
    const globs = roots.flatMap(r => ['', '/backend', '/server', '/api'].flatMap(sd => ['.env', '.env.production', '.env.local'].map(f => `${r === '/var/www/*' ? r : q(r)}${sd}/${f}`)))
    const { stdout } = await host.exec(`grep -lsF -f - ${globs.join(' ')} 2>/dev/null | sort -u || true`, { input: `${oldValues.join('\n')}\n` })
    for (const file of stdout.split('\n').map(s => s.trim()).filter(Boolean)) {
      const before = await host.readFile(file)
      let after = before
      if (old.anon) after = after.split(old.anon).join(keys.anon)
      if (old.service_role) after = after.split(old.service_role).join(keys.service_role)
      if (old.jwtSecret) after = after.split(old.jwtSecret).join(jwtSecret)
      if (after !== before) { await writeEnvWithBackup(host, file, before, after); updatedFiles.push(file) }
    }
  }
  const restarted = []
  for (const projectDir of [...new Set(updatedFiles.map(f => f.replace(/\/(backend|server|api)?\/?\.env[^/]*$/, '')))]) {
    restarted.push(...await restartPm2(host, await projectPm2(host, projectDir)))
  }
  forgetDiscovery(host)

  const notes = ['Signed-in users have to sign in again.']
  if (updatedFiles.length) notes.push(`Updated ${updatedFiles.join(', ')}${restarted.length ? ` and restarted ${restarted.join(', ')}` : ''}. Rebuild the app (Pull & Update) so its built frontend uses the new anon key.`)
  else notes.push('No app .env file held the old keys: put the new keys in your app yourself.')
  return { jwtSecret, keys, updatedFiles, restarted, notes }
}

/**
 * Create, delete or change the password of a Supabase Auth user, through Auth's admin API
 * (so users get the identities and fields Auth needs to sign them in).
 */
export async function manageGoTrueUser(host, appName, action, payload = {}) {
  appName = stackAppName(appName)
  const stack = await readStackJson(host, appName)

  if (action === 'create') {
    const email = String(payload.email || '').trim().toLowerCase()
    const password = String(payload.password || '')
    const role = String(payload.role || 'authenticated').trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpErr(400, 'Enter a valid email address.')
    if (password.length < 6) throw httpErr(400, 'The password needs at least 6 characters.')
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) throw httpErr(400, 'Invalid role name.')
    const user = await gotrueAdmin(host, stack, 'POST', '/admin/users', { email, password, email_confirm: true, ...(role !== 'authenticated' ? { role } : {}) })
    return { success: true, user: user ? { id: user.id, email: user.email } : null, message: `Created user ${email}` }
  }

  const userId = String(payload.userId || '').trim()
  if (!UUID_RE.test(userId)) throw httpErr(400, 'A valid user ID is required.')

  if (action === 'delete') {
    await gotrueAdmin(host, stack, 'DELETE', `/admin/users/${userId}`)
    return { success: true, message: `Deleted user ${userId}` }
  }

  if (action === 'update_password') {
    const newPassword = String(payload.newPassword || '')
    if (newPassword.length < 6) throw httpErr(400, 'The new password needs at least 6 characters.')
    await gotrueAdmin(host, stack, 'PUT', `/admin/users/${userId}`, { password: newPassword })
    return { success: true, message: `Password updated for user ${userId}` }
  }

  throw httpErr(400, `Unknown auth action: ${action}`)
}

/**
 * Create or delete Supabase storage buckets.
 */
export async function manageStorageBucket(host, appName, action, payload = {}) {
  appName = stackAppName(appName)
  const stack = await readStackJson(host, appName)
  const dbName = stack.db?.name || appName

  if (action === 'create') {
    const bucketName = String(payload.name || '').trim().toLowerCase()
    const isPublic = payload.public === true || payload.public === 'true'
    if (!BUCKET_RE.test(bucketName)) throw httpErr(400, 'Bucket name: lowercase letters, numbers, dots, hyphens and underscores.')
    await psqlStdin(host, dbName, `INSERT INTO storage.buckets (id, name, public) VALUES (${sqlLit(bucketName)}, ${sqlLit(bucketName)}, ${isPublic}) ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;\n`)
    return { success: true, message: `Created bucket ${bucketName}` }
  }

  if (action === 'delete') {
    const bucketId = String(payload.bucketId || '').trim()
    if (!BUCKET_RE.test(bucketId)) throw httpErr(400, 'A valid bucket ID is required.')
    await psqlStdin(host, dbName, `BEGIN;\nDELETE FROM storage.objects WHERE bucket_id = ${sqlLit(bucketId)};\nDELETE FROM storage.buckets WHERE id = ${sqlLit(bucketId)};\nCOMMIT;\n`)
    // The files themselves live on disk under the storage service's STORAGE_DIR
    const storageEnv = await host.readFile(`${stackDir(appName)}/storage.env`).catch(() => '')
    const root = envPairs(storageEnv).find(([k]) => k === 'STORAGE_DIR')?.[1] || `/var/lib/autodeploy-storage/${appName}`
    if (path.posix.isAbsolute(root) && root.split('/').filter(Boolean).length >= 2) await host.exec(`rm -rf -- ${q(`${root}/${bucketId}`)}`)
    return { success: true, message: `Deleted bucket ${bucketId}` }
  }

  throw httpErr(400, `Unknown bucket action: ${action}`)
}

/**
 * Delete a self-hosted Supabase stack and clean up its services and nginx routes.
 */
export async function deleteSupabaseStack(host, appName, dropDb = false) {
  appName = stackAppName(appName)
  let stack = null
  try { stack = await readStackJson(host, appName) } catch { /* already gone: still clean up */ }
  await removeStackNginx(host, appName)
  await host.exec(removeStackScript(appName))

  let dropped = false
  const dbName = stack?.db?.name
  if (dropDb && dbName && !['postgres', 'template0', 'template1'].includes(dbName)) {
    await psqlStdin(host, 'postgres', `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${sqlLit(dbName)} AND pid <> pg_backend_pid();\nDROP DATABASE IF EXISTS ${sqlIdent(dbName)};\n`)
    const dbUser = stack.db?.user
    if (dbUser && !RESERVED_DB_USERS.has(dbUser.toLowerCase())) {
      // Fails harmlessly when the user still owns objects in another database
      await psqlStdin(host, 'postgres', `DROP ROLE IF EXISTS ${sqlIdent(dbUser)};\n`, { strict: false })
    }
    dropped = true
  }
  forgetDiscovery(host)

  return { success: true, message: `Removed Supabase stack for ${appName}${dropped ? ` and dropped database ${dbName}` : ''}` }
}

// ------------------------------------------------------------------ projects

const SUPABASE_URL_KEY_RE = /^(NEXT_PUBLIC_|VITE_|REACT_APP_|EXPO_PUBLIC_|PUBLIC_|NUXT_PUBLIC_|GATSBY_)?SUPABASE_URL$/
const isLocalUrl = (u) => /(^|[/@])(127\.0\.0\.1|localhost|\[::1\])([:/]|$)/i.test(u)

/**
 * Detect database configuration for a list of projects:
 * Whether each project uses a Self-Hosted Supabase stack, a Self-Hosted Local Database,
 * an External/Cloud Supabase, or has No Database.
 */
export async function enrichProjectsWithDatabaseInfo(host, projects = []) {
  if (!projects || !projects.length) return projects

  // 1. Self-hosted Supabase stacks, by app name, linked project folder and public host
  const stackMap = new Map()
  const stackByDir = new Map()
  const stackHosts = new Map()
  try {
    const { stdout: appList } = await host.exec(`if [ -d ${q(`${SUPABASE_HOME}/apps`)} ]; then ls -1 ${q(`${SUPABASE_HOME}/apps`)}; fi`)
    for (const app of (appList || '').split('\n').map(s => s.trim()).filter(a => APP_RE.test(a))) {
      try {
        const stack = JSON.parse(await host.readFile(stackFile(app)))
        stackMap.set(app, stack)
        if (stack.projectDir) stackByDir.set(stack.projectDir, stack)
        try { stackHosts.set(new URL(stack.url).host, stack) } catch { /* no url */ }
      } catch { /* not a stack */ }
    }
  } catch { /* no stacks */ }

  // 2. Database variables from each project's .env files, in one shell round trip
  const paths = projects.map(p => p.path).filter(Boolean)
  const envMap = new Map()
  if (paths.length) {
    try {
      const re = '^[[:space:]]*(export[[:space:]]+)?([A-Z_]*SUPABASE_URL|DATABASE_URL|MONGODB_URI|DB_HOST|DB_CONNECTION|DB_DATABASE)[[:space:]]*='
      const files = ['.env', '.env.production', '.env.local', 'backend/.env', 'server/.env', 'api/.env']
      const scanScript = paths.map(p => `echo ${q(`@@PROJ ${p}`)}; grep -hsE ${q(re)} ${files.map(f => q(`${p}/${f}`)).join(' ')} || true`).join('\n')
      const { stdout: scanOut } = await host.exec(scanScript, { timeout: 15000 })
      let curPath = null
      let lines = []
      for (const line of (scanOut || '').split('\n')) {
        if (line.startsWith('@@PROJ ')) {
          if (curPath) envMap.set(curPath, lines)
          curPath = line.slice(7).trim()
          lines = []
        } else if (line.trim()) {
          lines.push(line.trim())
        }
      }
      if (curPath) envMap.set(curPath, lines)
    } catch { /* no .env scan */ }
  }

  const selfHostedStack = (stack, name) => ({
    type: 'self-hosted-supabase',
    label: 'Self-Hosted Supabase',
    engine: 'postgresql',
    isSelfHosted: true,
    stackApp: stack.app || name,
    database: stack.db?.name || name,
    url: stack.url
  })

  // 3. Enrich each project
  return projects.map(p => {
    const candidates = [path.basename(p.path || ''), p.name, p.repoName].map(c => String(c || '').toLowerCase()).filter(Boolean)
    const linked = stackByDir.get(p.path) || stackMap.get(candidates.find(c => stackMap.has(c)))
    if (linked) return { ...p, dbInfo: selfHostedStack(linked, linked.app) }

    // First value of each variable wins (.env before .env.production …)
    const envVars = {}
    for (const [k, v] of envPairs((envMap.get(p.path) || []).join('\n'))) if (!(k in envVars)) envVars[k] = v

    const sbUrl = Object.entries(envVars).find(([k]) => SUPABASE_URL_KEY_RE.test(k))?.[1] || ''
    const dbUrl = envVars.DATABASE_URL || envVars.MONGODB_URI || ''
    const dbHost = envVars.DB_HOST || ''

    if (sbUrl) {
      let sbHost = ''
      try { sbHost = new URL(sbUrl).host } catch { /* not a URL */ }
      const stack = stackHosts.get(sbHost)
      if (stack) return { ...p, dbInfo: selfHostedStack(stack, stack.app) }
      if (isLocalUrl(sbUrl) || (host.ipAddress && sbHost.startsWith(host.ipAddress))) {
        return { ...p, dbInfo: { type: 'self-hosted-supabase', label: 'Self-Hosted Supabase', engine: 'postgresql', isSelfHosted: true, url: sbUrl } }
      }
      return { ...p, dbInfo: { type: 'cloud-supabase', label: 'Supabase Cloud', engine: 'postgresql', isSelfHosted: false, url: sbUrl } }
    }

    if (dbUrl) {
      const engine = /^mysql/i.test(dbUrl) ? 'mysql' : /^mongodb/i.test(dbUrl) ? 'mongodb' : 'postgresql'
      const isLocal = isLocalUrl(dbUrl) || /@\//.test(dbUrl)
      const dbName = dbUrl.match(/\/([a-zA-Z0-9_-]+)(?:\?|$)/)?.[1] || 'database'
      const engineLabel = { mysql: 'MySQL', mongodb: 'MongoDB', postgresql: 'PostgreSQL' }[engine]
      return {
        ...p,
        dbInfo: {
          type: isLocal ? 'self-hosted-db' : 'external-db',
          label: isLocal ? `Self-Hosted ${engineLabel}` : /supabase\.(co|com)/.test(dbUrl) ? 'Supabase Cloud DB' : `External ${engineLabel}`,
          engine,
          isSelfHosted: isLocal,
          database: dbName
        }
      }
    }

    if (dbHost) {
      const isLocal = isLocalUrl(`//${dbHost}/`)
      const engine = /mysql|mariadb/i.test(envVars.DB_CONNECTION || '') ? 'mysql' : 'postgresql'
      return {
        ...p,
        dbInfo: {
          type: isLocal ? 'self-hosted-db' : 'external-db',
          label: isLocal ? (engine === 'mysql' ? 'Self-Hosted MySQL' : 'Self-Hosted PostgreSQL') : 'External Database',
          engine,
          isSelfHosted: isLocal,
          database: envVars.DB_DATABASE || 'database'
        }
      }
    }

    return { ...p, dbInfo: { type: 'none', label: 'No Database', isSelfHosted: false } }
  })
}

/**
 * Provision a self-hosted database or Supabase stack for an existing project (or link it to an
 * existing stack), then point the project's .env at it (a .env.bak copy is kept).
 * `projectPath` must already be checked as a project the caller manages.
 */
export async function attachSelfHostedDatabase(host, {
  projectPath,
  appName,
  mode = 'supabase', // 'supabase' | 'postgresql' | 'mysql' | 'existing'
  dbName,
  dbUser,
  dbPassword,
  domain = '',
  existingApp = '',
  restart = true
}) {
  if (!['supabase', 'postgresql', 'mysql', 'existing'].includes(mode)) throw httpErr(400, `Unknown database mode "${mode}".`)
  const dir = path.posix.resolve(String(projectPath || ''))
  if (!(await host.exists(dir))) throw httpErr(404, `Project directory not found: ${dir}`)
  const folder = path.basename(dir)

  const ident = (s, max) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '').slice(0, max)
  const name = ident(dbName || appName || folder, 63)
  const user = ident(dbUser || name, 32)
  const password = String(dbPassword || crypto.randomBytes(18).toString('base64url'))
  const notes = []
  let env = []
  let summary = {}

  const envFile = await primaryEnvFile(host, dir)
  const before = (await host.exists(envFile)) ? await host.readFile(envFile) : null
  const pairs = envPairs(before || '')
  const current = Object.fromEntries(pairs)

  if (mode === 'postgresql' || mode === 'mysql') {
    if (!name || !user) throw httpErr(400, 'Enter a database name and user.')
    await createDatabase(host, { engine: mode, name, user, password })
    const port = mode === 'postgresql' ? 5432 : 3306
    const url = `${mode}://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${port}/${name}`
    env = [
      ['DATABASE_URL', url], ['DB_CONNECTION', mode === 'postgresql' ? 'pgsql' : 'mysql'], ['DB_HOST', '127.0.0.1'], ['DB_PORT', String(port)],
      ['DB_DATABASE', name], ['DB_NAME', name], ['DB_USERNAME', user], ['DB_USER', user], ['DB_PASSWORD', password]
    ]
    summary = { type: 'self-hosted-db', engine: mode, database: name, message: `Created ${mode === 'postgresql' ? 'PostgreSQL' : 'MySQL'} database ${name} on this server for ${folder}.` }
  } else {
    let stack
    let sbApp
    let pgUrl
    if (mode === 'supabase') {
      if (!name || !user) throw httpErr(400, 'Enter a database name and user.')
      sbApp = stackAppName(String(appName || folder).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50))
      if (await host.exists(stackFile(sbApp))) throw httpErr(409, `A Supabase stack named "${sbApp}" already exists. Choose "Link existing stack" to use it.`)
      const gatewayDomain = cleanDomain(domain)
      if (!gatewayDomain) throw httpErr(400, 'Enter the domain the Supabase API will be served on (the app\'s own domain, or e.g. api.example.com).')
      await createDatabase(host, { engine: 'postgresql', name, user, password })
      const scheme = await domainScheme(host, gatewayDomain)
      const result = await setupSupabaseStack(host, {
        appName: sbApp,
        publicUrl: `${scheme}://${gatewayDomain}`,
        projectDir: dir,
        db: { name, user, password },
        ref: crypto.randomBytes(8).toString('hex'),
        onLog: (msg) => console.log(`[Attach Supabase to ${sbApp}] ${String(msg).trim()}`)
      })
      notes.push(...(result.notes || []))
      const published = await publishStackNginx(host, sbApp, result.ports, { domain: gatewayDomain, functions: (result.functions || []).length > 0 })
      notes.push(...published.notes)
      stack = await readStackJson(host, sbApp)
      pgUrl = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:5432/${name}`
      notes.push('The new database is empty: copy your data in with Databases → Migrate, or run your app\'s migrations.')
      summary = { type: 'self-hosted-supabase', stackApp: sbApp, message: `Deployed a self-hosted Supabase stack (${sbApp}) for ${folder} at ${stack.url}.` }
    } else {
      sbApp = stackAppName(existingApp)
      stack = await readStackJson(host, sbApp)
      if (!stack.url || !stack.keys?.anon) throw httpErr(400, `The Supabase stack "${sbApp}" has no URL or keys.`)
      // The stack's own database login is in its Auth settings
      const authEnv = await host.readFile(`${stackDir(sbApp)}/auth.env`).catch(() => '')
      const authDbUrl = envPairs(authEnv).find(([k]) => k === 'DATABASE_URL')?.[1] || ''
      pgUrl = authDbUrl ? authDbUrl.replace(/\?.*$/, '').replace(/^postgres:\/\//, 'postgresql://') : ''
      summary = { type: 'linked-existing', stackApp: sbApp, message: `Linked ${folder} to the Supabase stack ${sbApp} (${stack.url}).` }
    }

    env = supabaseEnvLayer(pairs, { ref: null, url: stack.url, keys: stack.keys, jwtSecret: stack.jwtSecret, dbUrl: pgUrl }).filter(([, v]) => v)
    if (pgUrl) env.push(['DATABASE_URL', pgUrl])
    if (current.SUPABASE_URL && current.SUPABASE_URL !== stack.url) notes.push(`SUPABASE_URL was ${current.SUPABASE_URL}.`)
    notes.push('Rebuild the app (Pull & Update) so its built frontend uses the new Supabase URL and anon key.')
    stack.projectDir = dir
    await writeStackJson(host, sbApp, stack)
    summary.supabaseUrl = stack.url
    summary.anonKey = stack.keys.anon
  }

  if (current.DATABASE_URL && env.some(([k, v]) => k === 'DATABASE_URL' && v !== current.DATABASE_URL)) {
    notes.push('DATABASE_URL pointed at another database before; the old value is kept in the .env.bak copy.')
  }

  let text = before ?? ''
  for (const [k, v] of env) text = upsertEnvVar(text, k, envVal(v)).text
  await writeEnvWithBackup(host, envFile, before, text.endsWith('\n') ? text : `${text}\n`)
  forgetDiscovery(host)

  const restarted = restart ? await restartPm2(host, await projectPm2(host, dir)) : []

  return {
    success: true,
    ...summary,
    envFile,
    restarted,
    notes
  }
}
