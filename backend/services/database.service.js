import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { q } from './host.service.js'
import { discoverProjects as discoverHostProjects } from './project-discovery.service.js'
import { readDb } from './db.service.js'

export { isLocalServer } from './host.service.js'

/**
 * Real database discovery & browsing for every project on a server (the panel host or any
 * connected server — every command runs through the server's host executor).
 *
 * Databases are found two ways:
 *  1. Project .env files (DATABASE_URL, MONGODB_URI, MYSQL_*, DB_*, PG*, REDIS_URL, ...)
 *  2. Server-level listings (PostgreSQL via peer auth as `postgres`, MongoDB/Redis on localhost,
 *     MySQL through any credentials found in step 1)
 * Each database is then mapped to the project(s) that use it.
 *
 * All engine access goes through the native CLIs with quoted arguments. Credentials never
 * leave the server: the API hands out opaque connection ids.
 */

const ENV_SUBDIRS = ['', 'backend', 'server', 'api']
const ENV_FILES = ['.env', '.env.production', '.env.local']
const SYSTEM_DATABASES = {
  postgresql: ['template0', 'template1', 'postgres'],
  mysql: ['information_schema', 'performance_schema', 'mysql', 'sys'],
  mongodb: ['admin', 'config', 'local']
}
const DEFAULT_PORTS = { postgresql: 5432, mysql: 3306, mongodb: 27017, redis: 6379 }
const EXEC_TIMEOUT_MS = 20000
const MAX_CELL_LENGTH = 2000
const MAX_QUERY_ROWS = 1000
const CACHE_TTL_MS = 60 * 1000

const discoveryCache = new Map() // host id -> { at, result, entries }

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

/** Runs a CLI on the entry's server. Env vars (passwords) go into the private script, never argv. */
async function run(exec, cmd, args, { env = {}, input = null, timeout = EXEC_TIMEOUT_MS, secrets = [] } = {}) {
  const assign = Object.entries(env).map(([k, v]) => `export ${k}=${q(v)}; `).join('')
  const r = await exec.exec(assign + [cmd, ...args].map(q).join(' '), { input, timeout })
  if (r.code !== 0) {
    let msg = (r.stderr || '').trim() || `${cmd} exited with code ${r.code}`
    for (const sec of secrets) if (sec) msg = msg.split(sec).join('***')
    throw new Error(msg.split('\n').slice(0, 6).join('\n'))
  }
  return r.stdout
}

const isLocalHost = (h) => !h || ['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(h)

function parseEnvText(text) {
  const out = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    let val = m[2].trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    } else {
      val = val.replace(/\s+#.*$/, '')
    }
    out[m[1]] = val
  }
  return out
}

function engineFromScheme(scheme) {
  scheme = scheme.toLowerCase()
  if (scheme.startsWith('postgres')) return 'postgresql'
  if (scheme === 'mysql' || scheme === 'mariadb') return 'mysql'
  if (scheme.startsWith('mongodb')) return 'mongodb'
  if (scheme === 'redis' || scheme === 'rediss') return 'redis'
  if (scheme === 'file' || scheme === 'sqlite') return 'sqlite'
  return null
}

function engineFromDialect(dialect, port) {
  const d = (dialect || '').toLowerCase()
  if (d.includes('postgres') || d === 'pg' || d === 'pgsql') return 'postgresql'
  if (d.includes('mysql') || d.includes('maria')) return 'mysql'
  if (d.includes('mongo')) return 'mongodb'
  if (d.includes('sqlite')) return 'sqlite'
  const p = Number(port)
  return Object.keys(DEFAULT_PORTS).find(k => DEFAULT_PORTS[k] === p) || null
}

/**
 * Turns one project's env variables into connection specs.
 */
function connectionsFromEnv(env, envDir) {
  const specs = []

  for (const [key, value] of Object.entries(env)) {
    const m = /^([a-z+]+):\/\//i.exec(value) || /^(file):/i.exec(value)
    if (!m) continue
    const engine = engineFromScheme(m[1])
    if (!engine) continue
    // Only database-looking variables, so e.g. FRONTEND_URL=redis-dashboard... is not picked up
    if (!/(DATABASE|DB|MONGO|MYSQL|POSTGRES|PG|REDIS|SQLITE|URI|URL|DSN)/i.test(key)) continue

    if (engine === 'sqlite') {
      const file = value.replace(/^(file|sqlite):(\/\/)?/i, '')
      specs.push({ engine, file: path.resolve(envDir, file), database: path.basename(file) })
      continue
    }
    try {
      const u = new URL(value)
      const spec = {
        engine,
        host: decodeURIComponent(u.hostname || '127.0.0.1').replace(/^\[|\]$/g, ''),
        port: Number(u.port) || DEFAULT_PORTS[engine],
        user: decodeURIComponent(u.username || ''),
        password: decodeURIComponent(u.password || ''),
        database: decodeURIComponent(u.pathname.replace(/^\//, '').split('/')[0] || '')
      }
      if (engine === 'mongodb') {
        spec.uri = value
        if (env.MONGODB_DB_NAME || env.MONGO_DB_NAME) spec.database = env.MONGODB_DB_NAME || env.MONGO_DB_NAME
      }
      if (engine === 'redis') spec.database = String(Number(spec.database) || 0)
      specs.push(spec)
    } catch { /* malformed URL — skip */ }
  }

  if (env.MYSQL_HOST || env.MYSQL_DATABASE || env.MYSQL_USER) {
    specs.push({
      engine: 'mysql',
      host: env.MYSQL_HOST || '127.0.0.1',
      port: Number(env.MYSQL_PORT) || 3306,
      user: env.MYSQL_USER || 'root',
      password: env.MYSQL_PASSWORD || env.MYSQL_PASS || '',
      database: env.MYSQL_DATABASE || env.MYSQL_DB || ''
    })
  }

  if (env.PGHOST || env.PGDATABASE || env.POSTGRES_DB) {
    specs.push({
      engine: 'postgresql',
      host: env.PGHOST || env.POSTGRES_HOST || '127.0.0.1',
      port: Number(env.PGPORT || env.POSTGRES_PORT) || 5432,
      user: env.PGUSER || env.POSTGRES_USER || 'postgres',
      password: env.PGPASSWORD || env.POSTGRES_PASSWORD || '',
      database: env.PGDATABASE || env.POSTGRES_DB || ''
    })
  }

  if (env.DB_HOST || env.DB_NAME || env.DB_DATABASE || env.DB_STORAGE) {
    const engine = engineFromDialect(env.DB_DIALECT || env.DB_CLIENT || env.DB_CONNECTION || env.DB_TYPE || env.DB_ENGINE, env.DB_PORT)
    if (engine === 'sqlite') {
      const file = env.DB_STORAGE || env.DB_DATABASE || env.DB_NAME
      if (file) specs.push({ engine, file: path.resolve(envDir, file), database: path.basename(file) })
    } else if (engine && engine !== 'mongodb') {
      specs.push({
        engine,
        host: env.DB_HOST || '127.0.0.1',
        port: Number(env.DB_PORT) || DEFAULT_PORTS[engine],
        user: env.DB_USER || env.DB_USERNAME || '',
        password: env.DB_PASSWORD || env.DB_PASS || '',
        database: env.DB_NAME || env.DB_DATABASE || ''
      })
    }
  }

  if (env.SQLITE_PATH || env.SQLITE_FILE || env.SQLITE_DB) {
    const file = env.SQLITE_PATH || env.SQLITE_FILE || env.SQLITE_DB
    specs.push({ engine: 'sqlite', file: path.resolve(envDir, file), database: path.basename(file) })
  }

  return specs
}

const normHost = (h) => (isLocalHost(h) ? '127.0.0.1' : h)
const entryKey = (e) => e.engine === 'sqlite'
  ? `sqlite|${e.file}`
  : `${e.engine}|${normHost(e.host)}|${e.port}|${e.database}`
const entryId = (key) => 'dbc_' + crypto.createHash('sha1').update(key).digest('hex').slice(0, 16)
const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

function listeningPorts(exec) {
  return run(exec, 'ss', ['-tlnH']).then(out => {
    const ports = new Set()
    for (const line of out.split('\n')) {
      const m = line.match(/:(\d+)\s+\S+:\S+\s*$/) || line.match(/:(\d+)\s/)
      if (m) ports.add(Number(m[1]))
    }
    return ports
  }).catch(() => new Set())
}

/** Reads the first existing .env in each project folder (and backend/, server/, api/) in one round trip. */
async function projectEnvSpecs(exec, projects) {
  const dirs = [...new Set(projects.flatMap(p => ENV_SUBDIRS.map(sd => (sd ? `${p.path}/${sd}` : p.path))))]
  if (!dirs.length) return new Map()
  const script = `for d in ${dirs.map(q).join(' ')}; do for f in ${ENV_FILES.join(' ')}; do if [ -f "$d/$f" ]; then echo "@@ENV $d/$f"; head -c 65536 "$d/$f"; echo; break; fi; done; done`
  const { stdout } = await exec.exec(script, { timeout: 20000 })
  const byDir = new Map()
  let file = null
  let buf = []
  const flush = () => { if (file) byDir.set(file, buf.join('\n')) }
  for (const line of stdout.split('\n')) {
    if (line.startsWith('@@ENV ')) { flush(); file = line.slice(6); buf = [] } else buf.push(line)
  }
  flush()
  const specsByProject = new Map()
  for (const p of projects) {
    const specs = []
    for (const [envFile, text] of byDir) {
      if (envFile !== p.path && !envFile.startsWith(p.path + '/')) continue
      const dir = path.posix.dirname(envFile)
      for (const spec of connectionsFromEnv(parseEnvText(text), dir)) specs.push({ ...spec, source: path.posix.relative(p.path, envFile) })
    }
    specsByProject.set(p.path, specs)
  }
  return specsByProject
}

// ---------------------------------------------------------------------------------------------
// Engine runners
// ---------------------------------------------------------------------------------------------

const pgIdent = (s) => `"${String(s).replace(/"/g, '""')}"`
const pgLit = (v) => v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`
const myIdent = (s) => '`' + String(s).replace(/`/g, '``') + '`'
const myLit = (v) => v === null || v === undefined ? 'NULL'
  : `'${String(v).replace(/\\/g, '\\\\').replace(/\0/g, '\\0').replace(/'/g, "\\'")}'`
const sqliteIdent = pgIdent
const sqliteLit = pgLit

function psql(entry, sql, extraArgs = ['-At']) {
  const base = ['-X', '-q', '-v', 'ON_ERROR_STOP=1', ...extraArgs]
  if (entry.peer) {
    return run(entry._exec, 'runuser', ['-u', 'postgres', '--', 'psql', ...base, '-d', entry.database || 'postgres', '-c', sql])
  }
  return run(entry._exec, 'psql', [...base, '-h', entry.host, '-p', String(entry.port), '-U', entry.user || 'postgres', '-d', entry.database || 'postgres', '-c', sql], {
    env: { PGPASSWORD: entry.password || '', PGCONNECT_TIMEOUT: '5' },
    secrets: [entry.password]
  })
}

async function pgJson(entry, sql) {
  const out = await psql(entry, `SELECT coalesce(json_agg(t), '[]'::json) FROM (${sql}) t`)
  return JSON.parse(out.trim() || '[]')
}

const mysqlAdminCache = new Map() // host id -> { at, cmd }

/** The server's own MySQL admin login (socket auth, ~/.my.cnf, sudo or debian.cnf), or null. */
async function serverMysqlAdmin(host) {
  const hit = mysqlAdminCache.get(host.id)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.cmd
  const admin = await findMysqlAdmin(async (s) => { const r = await host.exec(s, { timeout: 15000 }); return `${r.stdout}${r.stderr}` })
    .catch(() => ({ cmd: null }))
  mysqlAdminCache.set(host.id, { at: Date.now(), cmd: admin.cmd })
  return admin.cmd
}

/** Swaps the mysql client in an admin command for another MySQL tool (e.g. mysqldump). */
const withMysqlBin = (cmd, bin) => cmd.replace(/(^|\s)mysql(?=\s|$)/, `$1${bin}`)

/**
 * The server's default admin login reads every option file, and a stray option there (e.g. a
 * server-only `skip-grant-tables` under [client]) makes mysqldump refuse to start. Only the
 * connection settings from those files are passed on, quoted for the option file format.
 */
const MYSQL_CONN_OPTS = 'user|password|host|port|socket'
const cleanDefaults = (bin) => `--defaults-file=<(echo '[client]'; my_print_defaults -s client ${bin} | grep -E '^--(${MYSQL_CONN_OPTS})=' | sed -e 's/\\\\/\\\\\\\\/g' -e 's/"/\\\\"/g' -e 's/^--\\([^=]*\\)=\\(.*\\)$/\\1="\\2"/')`

/** Shell prefix running a MySQL tool as this entry: the app's own login, or the server's admin login when that is rejected. */
function mysqlShell(entry, bin = 'mysql') {
  if (entry.useAdmin && entry.adminCmd === 'mysql' && bin !== 'mysql') return `${bin} ${cleanDefaults(bin)}`
  if (entry.useAdmin) return withMysqlBin(entry.adminCmd, bin)
  return `MYSQL_PWD=${q(entry.password || '')} ${bin} --no-defaults -h ${q(entry.host)} -P ${q(entry.port)} -u ${q(entry.user)}`
}

async function mysqlCli(entry, sql, database = entry.database) {
  const args = ['--batch', '--connect-timeout=5']
  if (database) args.push('-D', database)
  args.push('-e', sql)
  if (!entry.useAdmin) {
    try {
      // --no-defaults: option files (e.g. ~/.my.cnf) would override the project's own user/password
      return await run(entry._exec, 'mysql', ['--no-defaults', '-h', entry.host, '-P', String(entry.port), '-u', entry.user, ...args], { env: { MYSQL_PWD: entry.password || '' }, secrets: [entry.password] })
    } catch (e) {
      // The app's login is rejected (e.g. root without a password): browse through the server's admin login
      if (!entry.adminCmd || !/ERROR (1045|1698)/.test(e.message)) throw e
      entry.useAdmin = true
      entry.credsError = e.message
    }
  }
  const r = await entry._exec.exec(`${entry.adminCmd} ${args.map(q).join(' ')}`, { timeout: EXEC_TIMEOUT_MS })
  if (r.code !== 0) throw new Error(((r.stderr || '').trim() || `mysql exited with code ${r.code}`).split('\n').slice(0, 6).join('\n'))
  return r.stdout
}

function unescapeMysql(s) {
  return s.replace(/\\(.)/g, (_, c) => ({ n: '\n', t: '\t', 0: '\0', '\\': '\\' }[c] ?? c))
}

export function parseMysqlBatch(out) {
  const lines = out.replace(/\n$/, '').split('\n').filter((l, i) => i > 0 || l.length)
  if (!lines.length || !lines[0]) return { columns: [], rows: [] }
  const columns = lines[0].split('\t').map(unescapeMysql)
  const rows = lines.slice(1).map(l => {
    const vals = l.split('\t')
    const row = {}
    columns.forEach((c, i) => { row[c] = vals[i] === 'NULL' ? null : unescapeMysql(vals[i] ?? '') })
    return row
  })
  return { columns, rows }
}

async function mysqlRows(entry, sql, database) {
  return parseMysqlBatch(await mysqlCli(entry, sql, database)).rows
}

function mongoUri(entry, database = entry.database) {
  if (entry.uri) {
    const u = new URL(entry.uri)
    if (!entry.uri.startsWith('mongodb+srv')) u.pathname = '/' + (database || '')
    return u.toString()
  }
  return `mongodb://${entry.host}:${entry.port}/${database || ''}`
}

async function mongoEval(entry, script, params = {}, database) {
  // Params are injected as a JSON literal, never concatenated into code
  const code = `const P = ${JSON.stringify(params)};\nconst __out = (() => { ${script} })();\nprint(EJSON.stringify(__out, null, 0, { relaxed: true }));`
  const out = await run(entry._exec, 'mongosh', [mongoUri(entry, database), '--quiet', '--norc', '--eval', code], { secrets: [entry.password] })
  const lines = out.trim().split('\n')
  return JSON.parse(lines[lines.length - 1] || 'null')
}

function redisCli(entry, args, { json = true } = {}) {
  const base = ['-h', entry.host, '-p', String(entry.port), '-n', String(Number(entry.database) || 0)]
  if (json) base.push('--json')
  return run(entry._exec, 'redis-cli', [...base, ...args], { env: entry.password ? { REDISCLI_AUTH: entry.password } : {}, secrets: [entry.password] })
}

function sqliteJson(entry, sql) {
  return run(entry._exec, 'sqlite3', ['-json', entry.file, sql]).then(out => JSON.parse(out.trim() || '[]'))
}

// ---------------------------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------------------------

async function listServerDatabases(exec, ports, mysqlCreds, mongoBases, redisBases, mysqlAdmin) {
  const found = []
  const errors = []
  const badMysqlCreds = new Map() // host|port|user -> error

  if (mysqlAdmin) {
    try {
      const admin = { _exec: exec, engine: 'mysql', host: '127.0.0.1', port: 3306, user: null, adminCmd: mysqlAdmin, useAdmin: true }
      const rows = await mysqlRows(admin,
        'SELECT s.schema_name AS name, COALESCE(SUM(t.data_length + t.index_length), 0) AS bytes FROM information_schema.schemata s LEFT JOIN information_schema.tables t ON t.table_schema = s.schema_name GROUP BY s.schema_name', '')
      for (const r of rows) found.push({ ...admin, database: r.name, bytes: Number(r.bytes) })
    } catch (e) {
      mysqlAdmin = null
      errors.push({ engine: 'mysql', error: e.message })
    }
  }

  if (ports.has(5432)) {
    try {
      const rows = await pgJson({ _exec: exec, peer: true, database: 'postgres' },
        'SELECT datname AS name, pg_database_size(datname) AS bytes FROM pg_database WHERE NOT datistemplate')
      for (const r of rows) {
        found.push({ engine: 'postgresql', peer: true, host: '127.0.0.1', port: 5432, user: 'postgres', database: r.name, bytes: Number(r.bytes) })
      }
    } catch (e) {
      errors.push({ engine: 'postgresql', error: e.message })
    }
  }

  for (const cred of mysqlCreds) {
    try {
      const rows = await mysqlRows(cred,
        'SELECT s.schema_name AS name, COALESCE(SUM(t.data_length + t.index_length), 0) AS bytes FROM information_schema.schemata s LEFT JOIN information_schema.tables t ON t.table_schema = s.schema_name GROUP BY s.schema_name', '')
      if (!mysqlAdmin) for (const r of rows) found.push({ ...cred, database: r.name, bytes: Number(r.bytes) })
    } catch (e) {
      badMysqlCreds.set(`${normHost(cred.host)}|${cred.port}|${cred.user}`, e.message)
      // With the admin login every database is still listed; the broken login is flagged on its database
      if (!mysqlAdmin) errors.push({ engine: 'mysql', error: e.message })
    }
  }

  for (const base of mongoBases) {
    try {
      const dbs = await mongoEval(base, 'return db.adminCommand({ listDatabases: 1 }).databases', {}, 'admin')
      for (const d of dbs) found.push({ ...base, database: d.name, bytes: Number(d.sizeOnDisk) || 0 })
    } catch (e) {
      // No admin rights: the project's own database is still listed from its .env
      if (!base.uri) errors.push({ engine: 'mongodb', error: e.message })
    }
  }

  for (const base of redisBases) {
    try {
      const info = await redisCli({ ...base, database: 0 }, ['INFO', 'keyspace'], { json: false })
      const dbs = [...info.matchAll(/^db(\d+):keys=(\d+)/gm)].map(m => ({ index: m[1], keys: Number(m[2]) }))
      if (!dbs.length) dbs.push({ index: '0', keys: 0 })
      for (const d of dbs) found.push({ ...base, database: d.index, keys: d.keys })
    } catch (e) {
      errors.push({ engine: 'redis', error: e.message })
    }
  }

  return { found, errors, badMysqlCreds }
}

/**
 * Full discovery: returns projects with their databases plus databases not tied to any project.
 */
export async function discoverDatabases(host, { force = false, registered = [] } = {}) {
  const cached = discoveryCache.get(host.id)
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.result

  const [projects, ports] = await Promise.all([discoverHostProjects(host, registered), listeningPorts(host)])
  const entries = new Map() // key -> entry (with credentials)
  const sqliteFiles = new Set()
  const addEntry = (spec, project) => {
    if (spec.engine !== 'sqlite' && !spec.database && spec.engine !== 'redis') return null
    if (spec.engine === 'sqlite' && !sqliteFiles.has(spec.file)) return null
    const key = entryKey(spec)
    let entry = entries.get(key)
    if (!entry) {
      entry = { ...spec, _exec: host, key, id: entryId(`${host.id}|${key}`), projects: [] }
      entries.set(key, entry)
    }
    if (project && !entry.projects.some(p => p.path === project.path)) {
      entry.projects.push({ name: project.name, path: project.path, source: spec.source, pm2: (project.pm2Processes || []).map(x => x.name) })
    }
    return entry
  }

  // 1. Databases referenced by project .env files
  const envSpecs = await projectEnvSpecs(host, projects)
  const projectSpecs = projects.map(p => ({ project: p, specs: envSpecs.get(p.path) || [] }))
  for (const { specs } of projectSpecs) {
    for (const sp of specs) if (sp.engine === 'sqlite' && await host.exists(sp.file)) sqliteFiles.add(sp.file)
  }
  for (const { project, specs } of projectSpecs) for (const s of specs) addEntry(s, project)

  // 2. Everything else that lives on the server
  const allSpecs = projectSpecs.flatMap(p => p.specs)
  // First occurrence wins, so project credentials beat anonymous localhost defaults
  const uniq = (arr, k) => arr.filter((x, i) => arr.findIndex(y => k(y) === k(x)) === i)
  const mysqlCreds = uniq(allSpecs.filter(s => s.engine === 'mysql' && s.user), s => `${normHost(s.host)}|${s.port}|${s.user}`)
    .map(({ engine, host: h, port, user, password }) => ({ _exec: host, engine, host: h, port, user, password }))
  const mongoBases = uniq([
    ...allSpecs.filter(s => s.engine === 'mongodb').map(({ engine, host: h, port, user, password, uri }) => ({ _exec: host, engine, host: h, port, user, password, uri })),
    ...(ports.has(27017) ? [{ _exec: host, engine: 'mongodb', host: '127.0.0.1', port: 27017 }] : [])
  ], s => `${normHost(s.host)}|${s.port}`)
  const redisBases = uniq([
    ...allSpecs.filter(s => s.engine === 'redis').map(({ engine, host: h, port, password }) => ({ _exec: host, engine, host: h, port, password })),
    ...(ports.has(6379) ? [{ _exec: host, engine: 'redis', host: '127.0.0.1', port: 6379 }] : [])
  ], s => `${normHost(s.host)}|${s.port}`)

  const mysqlAdmin = ports.has(3306) ? await serverMysqlAdmin(host) : null
  const { found, errors, badMysqlCreds } = await listServerDatabases(host, ports, mysqlCreds, mongoBases, redisBases, mysqlAdmin)
  for (const spec of found) {
    if ((SYSTEM_DATABASES[spec.engine] || []).includes(spec.database)) continue
    const key = entryKey(spec)
    const existing = entries.get(key)
    if (existing) {
      // Local PostgreSQL: prefer peer auth over app credentials (works even with limited grants)
      if (spec.peer) Object.assign(existing, { peer: true, appUser: existing.appUser ?? existing.user, appPassword: existing.appPassword ?? existing.password, user: 'postgres', password: '' })
      if (spec.adminCmd) existing.adminCmd = spec.adminCmd
      if (spec.bytes !== undefined) existing.bytes = spec.bytes
      if (spec.keys !== undefined) existing.keys = spec.keys
    } else {
      addEntry(spec, null)
    }
  }

  // Project logins MySQL rejects: browse through the admin login and flag the database
  for (const entry of entries.values()) {
    if (entry.engine !== 'mysql' || !entry.user) continue
    const err = badMysqlCreds.get(`${normHost(entry.host)}|${entry.port}|${entry.user}`)
    if (!err) continue
    entry.credsError = err
    if (entry.adminCmd) entry.useAdmin = true
  }

  // 3. Map unlinked databases to projects by name (tip_crm_db -> tip-crm)
  for (const entry of entries.values()) {
    if (entry.projects.length || entry.engine === 'redis') continue
    const dbNorm = normName(entry.database)
    for (const p of projects) {
      const candidates = [normName(p.name), normName(path.basename(p.path))].filter(n => n.length >= 4)
      if (candidates.some(n => dbNorm.startsWith(n) || n.startsWith(dbNorm) && dbNorm.length >= 4)) {
        entry.projects.push({ name: p.name, path: p.path, source: 'matched by name', pm2: (p.pm2Processes || []).map(x => x.name) })
      }
    }
  }

  const publicEntry = (e) => ({
    id: e.id,
    engine: e.engine,
    database: e.engine === 'redis' ? `db${e.database}` : e.database,
    host: e.engine === 'sqlite' ? e.file : `${e.host}:${e.port}`,
    provider: e.engine === 'postgresql' && isSupabaseHost(e.host) ? 'supabase' : null,
    external: e.engine !== 'sqlite' && !isLocalHost(e.host),
    user: e.engine === 'sqlite' ? null : (e.user || null),
    appUser: e.engine === 'sqlite' ? null : (e.appUser || e.user || null),
    auth: e.peer ? 'peer (postgres)' : e.useAdmin ? 'server admin login' : (e.password ? 'password' : 'none'),
    credsError: e.credsError || null,
    bytes: e.bytes ?? null,
    keys: e.keys ?? null,
    projects: e.projects.map(p => ({ name: p.name, source: p.source }))
  })

  const list = [...entries.values()]
  const result = {
    projects: projects
      .map(p => ({
        name: p.name,
        path: p.path,
        databases: list.filter(e => e.projects.some(x => x.path === p.path)).map(publicEntry)
      }))
      .sort((a, b) => b.databases.length - a.databases.length || a.name.localeCompare(b.name)),
    unassigned: list.filter(e => !e.projects.length).map(publicEntry),
    engines: {
      postgresql: ports.has(5432),
      mysql: ports.has(3306),
      mongodb: ports.has(27017),
      redis: ports.has(6379)
    },
    errors
  }

  discoveryCache.set(host.id, { at: Date.now(), result, entries: new Map(list.map(e => [e.id, e])) })
  return result
}

async function getEntry(host, connectionId) {
  if (!discoveryCache.get(host.id)?.entries.has(connectionId)) await discoverDatabases(host, { force: true })
  const entry = discoveryCache.get(host.id)?.entries.get(connectionId)
  if (!entry) throw Object.assign(new Error('Unknown database connection. Refresh the database list.'), { status: 404 })
  return entry
}

// ---------------------------------------------------------------------------------------------
// Browsing
// ---------------------------------------------------------------------------------------------

function clampInt(v, def, min, max) {
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def
}

function truncateCell(v) {
  if (v === null || v === undefined) return null
  if (typeof v === 'object') v = JSON.stringify(v)
  if (typeof v === 'string' && v.length > MAX_CELL_LENGTH) return v.slice(0, MAX_CELL_LENGTH) + `… (${v.length} chars)`
  return v
}

const truncateRows = (rows) => rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, truncateCell(v)])))

/**
 * Tables / collections / key summary for one database.
 */
export async function listTables(host, connectionId) {
  const entry = await getEntry(host, connectionId)

  if (entry.engine === 'postgresql') {
    const rows = await pgJson(entry, `
      SELECT n.nspname AS schema, c.relname AS name,
             CASE c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized view' ELSE 'table' END AS type,
             c.reltuples::bigint AS rows, pg_total_relation_size(c.oid) AS bytes
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r','p','v','m') AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'
      ORDER BY n.nspname = 'public' DESC, n.nspname, c.relname`)
    return rows.map(r => ({ ...r, rows: r.rows >= 0 ? Number(r.rows) : null, bytes: Number(r.bytes) }))
  }

  if (entry.engine === 'mysql') {
    const rows = await mysqlRows(entry, `
      SELECT table_name AS name, LOWER(table_type) AS type, table_rows AS \`rows\`, COALESCE(data_length + index_length, 0) AS bytes
      FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name`)
    return rows.map(r => ({ schema: null, name: r.name, type: r.type === 'base table' ? 'table' : r.type, rows: r.rows === null ? null : Number(r.rows), bytes: Number(r.bytes) }))
  }

  if (entry.engine === 'mongodb') {
    return mongoEval(entry, `
      return db.getCollectionInfos({}, { nameOnly: true }).map(c => {
        let size = null
        try { size = db.getCollection(c.name).stats().size } catch (e) {}
        let rows = null
        try { rows = db.getCollection(c.name).estimatedDocumentCount() } catch (e) {}
        return { schema: null, name: c.name, type: c.type === 'view' ? 'view' : 'collection', rows, bytes: size }
      }).sort((a, b) => a.name.localeCompare(b.name))`)
  }

  if (entry.engine === 'redis') {
    const out = await redisCli(entry, ['DBSIZE'])
    return [{ schema: null, name: 'keys', type: 'keyspace', rows: Number(JSON.parse(out)), bytes: null }]
  }

  if (entry.engine === 'sqlite') {
    const tables = await sqliteJson(entry, "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name")
    for (const t of tables) {
      try {
        const [c] = await sqliteJson(entry, `SELECT count(*) AS n FROM ${sqliteIdent(t.name)}`)
        t.rows = c.n
      } catch { t.rows = null }
      t.schema = null
      t.bytes = null
    }
    return tables
  }

  throw new Error(`Unsupported engine ${entry.engine}`)
}

async function tableColumns(entry, schema, table) {
  if (entry.engine === 'postgresql') {
    const rel = `${pgIdent(schema || 'public')}.${pgIdent(table)}`
    return pgJson(entry, `
      SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, NOT a.attnotnull AS nullable,
             EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = a.attrelid AND i.indisprimary AND a.attnum = ANY(i.indkey)) AS primary,
             pg_get_expr(d.adbin, d.adrelid) AS "default"
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = to_regclass(${pgLit(rel)}) AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attnum`)
  }
  if (entry.engine === 'mysql') {
    const rows = await mysqlRows(entry, `
      SELECT column_name AS name, column_type AS type, is_nullable AS nullable, column_key AS ckey, column_default AS dflt
      FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ${myLit(table)} ORDER BY ordinal_position`)
    return rows.map(r => ({ name: r.name, type: r.type, nullable: r.nullable === 'YES', primary: r.ckey === 'PRI', default: r.dflt }))
  }
  if (entry.engine === 'sqlite') {
    const rows = await sqliteJson(entry, `SELECT name, type, "notnull", pk, dflt_value FROM pragma_table_info(${sqliteLit(table)})`)
    return rows.map(r => ({ name: r.name, type: r.type, nullable: !r.notnull, primary: r.pk > 0, default: r.dflt_value }))
  }
  return []
}

/**
 * One page of rows for a table/collection, with columns and total count.
 */
export async function getTableData(host, connectionId, { schema, table, page = 1, pageSize = 50, search = '' } = {}) {
  const entry = await getEntry(host, connectionId)
  if (!table) throw Object.assign(new Error('Table name is required.'), { status: 400 })
  page = clampInt(page, 1, 1, 1e9)
  pageSize = clampInt(pageSize, 50, 1, 500)
  const offset = (page - 1) * pageSize
  search = String(search || '').trim()

  if (entry.engine === 'postgresql') {
    const rel = `${pgIdent(schema || 'public')}.${pgIdent(table)}`
    const columns = await tableColumns(entry, schema, table)
    const pk = columns.filter(c => c.primary).map(c => pgIdent(c.name))
    const where = search ? `WHERE t::text ILIKE ${pgLit('%' + search + '%')}` : ''
    const order = pk.length ? `ORDER BY ${pk.join(', ')}` : ''
    const [rows, [{ count }]] = await Promise.all([
      pgJson(entry, `SELECT t.* FROM ${rel} t ${where} ${order} LIMIT ${pageSize} OFFSET ${offset}`),
      pgJson(entry, `SELECT count(*) AS count FROM ${rel} t ${where}`).catch(() => [{ count: null }])
    ])
    return { columns, rows: truncateRows(rows), total: count === null ? null : Number(count), page, pageSize }
  }

  if (entry.engine === 'mysql') {
    const columns = await tableColumns(entry, null, table)
    const pk = columns.filter(c => c.primary).map(c => myIdent(c.name))
    const where = search && columns.length
      ? `WHERE CONCAT_WS(' ', ${columns.map(c => myIdent(c.name)).join(', ')}) LIKE ${myLit('%' + search + '%')}`
      : ''
    const order = pk.length ? `ORDER BY ${pk.join(', ')}` : ''
    const [data, countRows] = await Promise.all([
      mysqlCli(entry, `SELECT * FROM ${myIdent(table)} ${where} ${order} LIMIT ${pageSize} OFFSET ${offset}`).then(parseMysqlBatch),
      mysqlRows(entry, `SELECT COUNT(*) AS n FROM ${myIdent(table)} ${where}`)
    ])
    return { columns, rows: truncateRows(data.rows), total: Number(countRows[0]?.n || 0), page, pageSize }
  }

  if (entry.engine === 'sqlite') {
    const columns = await tableColumns(entry, null, table)
    const where = search && columns.length
      ? `WHERE (${columns.map(c => `COALESCE(${sqliteIdent(c.name)}, '')`).join(" || ' ' || ")}) LIKE ${sqliteLit('%' + search + '%')}`
      : ''
    const rows = await sqliteJson(entry, `SELECT * FROM ${sqliteIdent(table)} ${where} LIMIT ${pageSize} OFFSET ${offset}`)
    const [{ n }] = await sqliteJson(entry, `SELECT count(*) AS n FROM ${sqliteIdent(table)} ${where}`)
    return { columns, rows: truncateRows(rows), total: n, page, pageSize }
  }

  if (entry.engine === 'mongodb') {
    // Search is a JSON filter ({"status":"active"}) or plain text matched against _id / string fields
    let filter = null
    if (search.startsWith('{')) {
      try { filter = JSON.parse(search) } catch { throw Object.assign(new Error('Invalid JSON filter.'), { status: 400 }) }
    }
    const result = await mongoEval(entry, `
      const coll = db.getCollection(P.table)
      let filter = P.filter ? EJSON.parse(JSON.stringify(P.filter)) : {}
      if (!P.filter && P.search) {
        const sample = coll.findOne() || {}
        const re = { $regex: P.searchRegex, $options: 'i' }
        const or = Object.keys(sample).filter(k => typeof sample[k] === 'string').map(k => ({ [k]: re }))
        if (ObjectId.isValid(P.search)) or.push({ _id: new ObjectId(P.search) })
        filter = or.length ? { $or: or } : { _id: null }
      }
      const docs = coll.find(filter).sort({ _id: -1 }).skip(P.offset).limit(P.limit).toArray()
      const total = Object.keys(filter).length ? coll.countDocuments(filter) : coll.estimatedDocumentCount()
      return { docs, total }`, { table, filter, search, searchRegex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), offset, limit: pageSize })
    const keys = []
    for (const d of result.docs) for (const k of Object.keys(d)) if (!keys.includes(k)) keys.push(k)
    const columns = keys.map(k => ({ name: k, type: typeof result.docs.find(d => d[k] !== undefined && d[k] !== null)?.[k], nullable: true, primary: k === '_id' }))
    return { columns, rows: truncateRows(result.docs), rawDocs: result.docs.map(d => ({ _id: d._id })), total: result.total, page, pageSize }
  }

  if (entry.engine === 'redis') {
    // One Lua call: SCAN + type/ttl/value preview, avoiding per-key round trips
    const script = `
      local cursor, pattern, count = ARGV[1], ARGV[2], tonumber(ARGV[3])
      local res = redis.call('SCAN', cursor, 'MATCH', pattern, 'COUNT', count)
      local out = { cursor = res[1], keys = {} }
      for _, k in ipairs(res[2]) do
        local t = redis.call('TYPE', k).ok
        local v
        if t == 'string' then v = redis.call('GETRANGE', k, 0, 500)
        elseif t == 'list' then v = cjson.encode(redis.call('LRANGE', k, 0, 19))
        elseif t == 'set' then v = cjson.encode(redis.call('SRANDMEMBER', k, 20))
        elseif t == 'zset' then v = cjson.encode(redis.call('ZRANGE', k, 0, 19, 'WITHSCORES'))
        elseif t == 'hash' then v = cjson.encode(redis.call('HGETALL', k))
        else v = '' end
        table.insert(out.keys, { key = k, type = t, ttl = redis.call('TTL', k), value = v })
      end
      return cjson.encode(out)`
    const pattern = search ? (search.includes('*') ? search : `*${search}*`) : '*'
    const out = await redisCli(entry, ['EVAL', script, '0', '0', pattern, String(Math.max(pageSize * 4, 1000))])
    const parsed = JSON.parse(JSON.parse(out))
    const keys = Array.isArray(parsed.keys) ? parsed.keys : []
    const total = Number(JSON.parse(await redisCli(entry, ['DBSIZE'])))
    return {
      columns: ['key', 'type', 'ttl', 'value'].map(n => ({ name: n, type: 'string', nullable: false, primary: n === 'key' })),
      rows: truncateRows(keys.map(k => ({ ...k, ttl: k.ttl === -1 ? 'no expiry' : `${k.ttl}s` }))),
      total,
      nextCursor: parsed.cursor !== '0' ? parsed.cursor : null,
      page,
      pageSize
    }
  }

  throw new Error(`Unsupported engine ${entry.engine}`)
}

// ---------------------------------------------------------------------------------------------
// Query console
// ---------------------------------------------------------------------------------------------

export function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (ch !== '\r') field += ch
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows
}

function splitRedisArgs(cmd) {
  const args = []
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g
  let m
  while ((m = re.exec(cmd))) args.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : (m[2] ?? m[3]))
  return args
}

const COMMAND_TAG = /^(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE|GRANT|REVOKE|BEGIN|COMMIT|ROLLBACK|SET|DO|COPY|VACUUM|ANALYZE|COMMENT|REINDEX|CLUSTER)\b/

export async function runQuery(host, connectionId, query) {
  const entry = await getEntry(host, connectionId)
  query = String(query || '').trim()
  if (!query) throw Object.assign(new Error('Query cannot be empty.'), { status: 400 })
  const started = Date.now()
  const done = (r) => ({ ...r, executionTime: `${Date.now() - started}ms`, engine: entry.engine })

  if (entry.engine === 'postgresql') {
    const out = (await psql(entry, query, ['--csv'])).replace(/\n$/, '')
    const lines = out.split('\n')
    if (!out) return done({ columns: [], rows: [], message: 'Query executed.' })
    if (lines.every(l => COMMAND_TAG.test(l))) return done({ columns: [], rows: [], message: lines.join('\n') })
    const [header, ...data] = parseCsv(out)
    const rows = data.slice(0, MAX_QUERY_ROWS).map(r => r.map(v => truncateCell(v)))
    return done({ columns: header, rows, message: `${data.length} row(s) returned${data.length > MAX_QUERY_ROWS ? `, showing first ${MAX_QUERY_ROWS}` : ''}.` })
  }

  if (entry.engine === 'mysql') {
    const { columns, rows } = parseMysqlBatch(await mysqlCli(entry, query))
    if (!columns.length) return done({ columns: [], rows: [], message: 'Query executed.' })
    return done({
      columns,
      rows: rows.slice(0, MAX_QUERY_ROWS).map(r => columns.map(c => truncateCell(r[c]))),
      message: `${rows.length} row(s) returned${rows.length > MAX_QUERY_ROWS ? `, showing first ${MAX_QUERY_ROWS}` : ''}.`
    })
  }

  if (entry.engine === 'sqlite') {
    const rows = await sqliteJson(entry, query)
    const columns = rows.length ? Object.keys(rows[0]) : []
    return done({ columns, rows: rows.slice(0, MAX_QUERY_ROWS).map(r => columns.map(c => truncateCell(r[c]))), message: `${rows.length} row(s) returned.` })
  }

  if (entry.engine === 'mongodb') {
    const expr = query.replace(/;+\s*$/, '')
    const result = await mongoEval(entry, `
      let r = (${expr})
      if (r && typeof r.toArray === 'function') r = r.toArray()
      if (Array.isArray(r)) r = r.slice(0, ${MAX_QUERY_ROWS})
      return r === undefined ? null : r`)
    const count = Array.isArray(result) ? result.length : 1
    return done({ jsonOutput: JSON.stringify(result, null, 2), message: `${count} document(s) / result(s) returned.` })
  }

  if (entry.engine === 'redis') {
    const out = await redisCli(entry, splitRedisArgs(query), { json: false })
    return done({ redisOutput: out.trim(), message: 'Redis command executed.' })
  }

  throw new Error(`Unsupported engine ${entry.engine}`)
}

// ---------------------------------------------------------------------------------------------
// Row / table mutations
// ---------------------------------------------------------------------------------------------

async function primaryWhere(entry, schema, table, where, ident, lit) {
  const columns = await tableColumns(entry, schema, table)
  const pk = columns.filter(c => c.primary).map(c => c.name)
  if (!pk.length) throw Object.assign(new Error('This table has no primary key; use the query console to modify it.'), { status: 400 })
  if (!where || pk.some(k => !(k in where))) throw Object.assign(new Error(`Primary key value(s) required: ${pk.join(', ')}`), { status: 400 })
  return pk.map(k => `${ident(k)} = ${lit(where[k])}`).join(' AND ')
}

export async function deleteRow(host, connectionId, { schema, table, where }) {
  const entry = await getEntry(host, connectionId)
  if (entry.engine === 'postgresql') {
    const cond = await primaryWhere(entry, schema, table, where, pgIdent, pgLit)
    await psql(entry, `DELETE FROM ${pgIdent(schema || 'public')}.${pgIdent(table)} WHERE ${cond}`)
  } else if (entry.engine === 'mysql') {
    const cond = await primaryWhere(entry, null, table, where, myIdent, myLit)
    await mysqlCli(entry, `DELETE FROM ${myIdent(table)} WHERE ${cond} LIMIT 1`)
  } else if (entry.engine === 'sqlite') {
    const cond = await primaryWhere(entry, null, table, where, sqliteIdent, sqliteLit)
    await sqliteJson(entry, `DELETE FROM ${sqliteIdent(table)} WHERE ${cond}`)
  } else if (entry.engine === 'mongodb') {
    if (!where || where._id === undefined) throw Object.assign(new Error('_id is required.'), { status: 400 })
    const r = await mongoEval(entry, 'return db.getCollection(P.table).deleteOne({ _id: EJSON.parse(JSON.stringify(P.id)) }).deletedCount', { table, id: where._id })
    if (!r) throw new Error('Document not found.')
  } else if (entry.engine === 'redis') {
    await redisCli(entry, ['DEL', String(where?.key ?? '')])
  }
  return { message: `Row deleted from '${table}'.` }
}

export async function insertRow(host, connectionId, { schema, table, row }) {
  const entry = await getEntry(host, connectionId)
  const data = Object.fromEntries(Object.entries(row || {}).filter(([, v]) => v !== '' && v !== undefined))
  if (!Object.keys(data).length) throw Object.assign(new Error('Row data is empty.'), { status: 400 })

  if (entry.engine === 'postgresql') {
    const cols = Object.keys(data)
    await psql(entry, `INSERT INTO ${pgIdent(schema || 'public')}.${pgIdent(table)} (${cols.map(pgIdent).join(', ')}) VALUES (${cols.map(c => pgLit(data[c])).join(', ')})`)
  } else if (entry.engine === 'mysql') {
    const cols = Object.keys(data)
    await mysqlCli(entry, `INSERT INTO ${myIdent(table)} (${cols.map(myIdent).join(', ')}) VALUES (${cols.map(c => myLit(data[c])).join(', ')})`)
  } else if (entry.engine === 'sqlite') {
    const cols = Object.keys(data)
    await sqliteJson(entry, `INSERT INTO ${sqliteIdent(table)} (${cols.map(sqliteIdent).join(', ')}) VALUES (${cols.map(c => sqliteLit(data[c])).join(', ')})`)
  } else if (entry.engine === 'mongodb') {
    await mongoEval(entry, 'return db.getCollection(P.table).insertOne(EJSON.parse(JSON.stringify(P.doc))).insertedId', { table, doc: data })
  } else if (entry.engine === 'redis') {
    if (!data.key) throw Object.assign(new Error('key is required.'), { status: 400 })
    await redisCli(entry, ['SET', String(data.key), String(data.value ?? '')])
  }
  return { message: `Row inserted into '${table}'.` }
}

const COLUMN_TYPE = /^[A-Za-z][A-Za-z0-9 _]*(\(\s*\d+(\s*,\s*\d+)?\s*\))?(\[\])?$/

export async function createTable(host, connectionId, { schema, table, columns }) {
  const entry = await getEntry(host, connectionId)
  if (entry.engine === 'mongodb' && table) {
    await mongoEval(entry, 'db.createCollection(P.table); return true', { table })
    return { message: `Collection '${table}' created.` }
  }
  if (!table || !Array.isArray(columns) || !columns.length) throw Object.assign(new Error('Table name and columns are required.'), { status: 400 })
  for (const c of columns) {
    if (!c.name || !COLUMN_TYPE.test(String(c.type || ''))) throw Object.assign(new Error(`Invalid column definition: ${c.name || '?'} ${c.type || ''}`), { status: 400 })
  }
  const ident = entry.engine === 'mysql' ? myIdent : pgIdent
  const pk = columns.filter(c => c.primary).map(c => ident(c.name))
  const defs = columns.map(c => `${ident(c.name)} ${c.type}${c.nullable === false || c.primary ? ' NOT NULL' : ''}`)
  if (pk.length) defs.push(`PRIMARY KEY (${pk.join(', ')})`)
  const name = entry.engine === 'postgresql' ? `${pgIdent(schema || 'public')}.${pgIdent(table)}` : ident(table)
  const sql = `CREATE TABLE ${name} (${defs.join(', ')})`

  if (entry.engine === 'postgresql') await psql(entry, sql)
  else if (entry.engine === 'mysql') await mysqlCli(entry, sql)
  else if (entry.engine === 'sqlite') await sqliteJson(entry, sql)
  else throw Object.assign(new Error(`Creating tables is not supported for ${entry.engine}.`), { status: 400 })
  return { message: `Table '${table}' created.` }
}

export async function dropTable(host, connectionId, { schema, table }) {
  const entry = await getEntry(host, connectionId)
  if (!table) throw Object.assign(new Error('Table name is required.'), { status: 400 })
  if (entry.engine === 'postgresql') await psql(entry, `DROP TABLE ${pgIdent(schema || 'public')}.${pgIdent(table)}`)
  else if (entry.engine === 'mysql') await mysqlCli(entry, `DROP TABLE ${myIdent(table)}`)
  else if (entry.engine === 'sqlite') await sqliteJson(entry, `DROP TABLE ${sqliteIdent(table)}`)
  else if (entry.engine === 'mongodb') await mongoEval(entry, 'return db.getCollection(P.table).drop()', { table })
  else throw Object.assign(new Error(`Dropping is not supported for ${entry.engine}.`), { status: 400 })
  return { message: `'${table}' dropped.` }
}

// ---------------------------------------------------------------------------------------------
// Export / import / credentials
// ---------------------------------------------------------------------------------------------

const httpErr = (status, message) => Object.assign(new Error(message), { status })
const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64')
const rand = () => crypto.randomBytes(6).toString('hex')
const BACKUP_DIR = '/var/backups/autodeploy-db'

export const RESERVED_DB_USERS = new Set(['root', 'mysql', 'mysql.sys', 'mysql.session', 'mysql.infoschema', 'debian-sys-maint', 'postgres', 'admin'])
export const DB_USER_RE = /^[A-Za-z0-9_]{1,32}$/

/** Throws a 400 unless the password is safe to embed in SQL, shell and .env (8–128 printable, no quotes/\/`/$). */
export function checkDbPassword(password) {
  if (!/^[\x21-\x7e]{8,128}$/.test(password)) throw httpErr(400, 'Database password: 8–128 characters, no spaces.')
  if (/['"\\`$]/.test(password)) throw httpErr(400, 'Database password cannot contain quotes, backslashes, backticks or $.')
}

/**
 * Finds a working MySQL admin login on a server. `execText(script)` runs bash and resolves to its
 * output. Entered credentials go in an option file, with HOME pointed away so ~/.my.cnf cannot
 * override them, and are tried over both the socket (localhost) and TCP (127.0.0.1), since root
 * often exists for only one of those hosts. Then the server's own logins are tried.
 * Resolves to { cmd, label, entered, enteredError } or { cmd: null, enteredError }.
 */
export async function findMysqlAdmin(execText, { adminUser, adminPassword } = {}) {
  const cnf = (host) => `--defaults-extra-file=<(echo ${b64(`[client]\nuser=${adminUser}\npassword="${String(adminPassword || '').replace(/\\/g, '\\\\')}"\nhost=${host}\n`)} | base64 -d)`
  const candidates = [
    ...(adminUser ? ['localhost', '127.0.0.1'].map(h => ({ cmd: `HOME=/nonexistent mysql ${cnf(h)}`, label: `${adminUser}@${h}`, entered: true })) : []),
    { cmd: 'mysql', label: 'the server\'s default MySQL login' },
    { cmd: 'sudo -n mysql', label: 'sudo mysql' },
    { cmd: 'mysql --defaults-file=/etc/mysql/debian.cnf', label: 'debian-sys-maint' }
  ]
  let enteredError = ''
  for (const c of candidates) {
    const out = String(await execText(`${c.cmd} -N -e 'SELECT 1' 2>&1`) || '')
    if (out.trim().split('\n').pop().trim() === '1') return { ...c, enteredError }
    if (c.entered && !enteredError) enteredError = (out.split('\n').filter(l => /ERROR/.test(l)).pop() || out.trim().split('\n').pop() || '').trim()
  }
  return { cmd: null, enteredError }
}

/** Runs SQL through a MySQL admin command. The SQL goes in on stdin, so passwords never reach argv. */
async function mysqlAdminSql(host, cmd, sql, secrets = []) {
  const r = await host.exec(`echo ${b64(sql)} | base64 -d | ${cmd} -N`, { timeout: 30000 })
  if (r.code !== 0) {
    const msg = secrets.filter(Boolean).reduce((t, sec) => t.split(sec).join('***'), String(r.stderr || ''))
    throw httpErr(400, `MySQL: ${msg.trim().split('\n').pop()}`)
  }
  return r.stdout
}

const sqlHosts = (out) => out.split('\n').map(h => h.trim()).filter(h => /^[A-Za-z0-9.%_:-]+$/.test(h))

/** Shell command that writes a plain SQL dump of the database to stdout. */
function dumpCommand(entry) {
  if (entry.engine === 'mysql') {
    return `${mysqlShell(entry, 'mysqldump')} $(mysqldump --no-defaults --help 2>/dev/null | grep -q set-gtid-purged && echo --set-gtid-purged=OFF) --single-transaction --quick --routines --triggers --no-tablespaces ${q(entry.database)}`
  }
  if (entry.engine === 'postgresql') {
    if (entry.peer) return `runuser -u postgres -- pg_dump --no-owner --no-privileges -d ${q(entry.database)}`
    return `PGPASSWORD=${q(entry.password || '')} pg_dump --no-owner --no-privileges -h ${q(entry.host)} -p ${q(entry.port)} -U ${q(entry.user)} -d ${q(entry.database)}`
  }
  if (entry.engine === 'sqlite') return `sqlite3 ${q(entry.file)} .dump`
  throw httpErr(400, `Export is not supported for ${entry.engine} yet.`)
}

const scrubbed = (entry, text) => [entry.password, entry.appPassword].filter(Boolean).reduce((t, sec) => t.split(sec).join('***'), String(text || ''))

async function dumpTo(host, entry, remote) {
  const r = await host.exec(`set -o pipefail; umask 077; ${dumpCommand(entry)} | gzip > ${q(remote)}`, { timeout: 30 * 60 * 1000 })
  if (r.code !== 0) {
    await host.exec(`rm -f ${q(remote)}`).catch(() => {})
    throw httpErr(500, `Export failed: ${scrubbed(entry, r.stderr || r.stdout).trim().split('\n').slice(-4).join('\n')}`)
  }
}

/** Ids of the projects a connection belongs to, for access checks. */
export async function connectionProjectPaths(host, connectionId) {
  return (await getEntry(host, connectionId)).projects.map(p => p.path)
}

/**
 * Dumps the database to a gzipped .sql file and returns a local path to send to the browser.
 * The caller removes `cleanup` paths after sending.
 */
export async function exportDatabase(host, connectionId) {
  const entry = await getEntry(host, connectionId)
  const remote = `/tmp/autodeploy-export-${rand()}.sql.gz`
  await dumpTo(host, entry, remote)
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
  const fileName = `${String(entry.database).replace(/[^\w.-]/g, '_')}-${stamp}.sql.gz`
  if (host.isLocal) return { localPath: remote, fileName, cleanup: async () => fs.promises.rm(remote, { force: true }) }
  const localPath = path.join(os.tmpdir(), path.basename(remote))
  try { await host.fetchFile(remote, localPath) } finally { await host.exec(`rm -f ${q(remote)}`).catch(() => {}) }
  return { localPath, fileName, cleanup: async () => fs.promises.rm(localPath, { force: true }) }
}

/**
 * Imports an uploaded .sql / .sql.gz / pg .dump into the database. A gzipped backup of the
 * current contents is written to /var/backups/autodeploy-db on the server first.
 */
export async function importDatabase(host, connectionId, upload) {
  const entry = await getEntry(host, connectionId)
  if (!['mysql', 'postgresql', 'sqlite'].includes(entry.engine)) throw httpErr(400, `Import is not supported for ${entry.engine} yet.`)
  const fmt = upload.database || {}
  if (fmt.engine && fmt.engine !== entry.engine) throw httpErr(400, `This is a ${fmt.engine} dump, but ${entry.database} is a ${entry.engine} database.`)
  if (fmt.format === 'sqlite') throw httpErr(400, 'Upload an SQL dump (.sql / .sql.gz), not a raw .sqlite file.')
  if (fmt.format === 'pg_custom' && entry.engine !== 'postgresql') throw httpErr(400, 'A .dump file can only be imported into PostgreSQL.')

  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)
  const backup = `${BACKUP_DIR}/${String(entry.database).replace(/[^\w.-]/g, '_')}-${stamp}-before-import.sql.gz`
  await host.exec(`mkdir -p ${BACKUP_DIR} && chmod 700 ${BACKUP_DIR}`)
  await dumpTo(host, entry, backup)

  const remote = `/tmp/autodeploy-import-${rand()}${upload.ext}`
  await host.putFile(upload.file, remote)
  // pg_dump 17+ writes `SET transaction_timeout = 0;`, which older servers reject (0 is the default anyway)
  const cat = `${upload.ext === '.sql.gz' ? `gunzip -c ${q(remote)}` : `cat ${q(remote)}`}${entry.engine === 'postgresql' ? " | sed -e '/^SET transaction_timeout = 0;$/d'" : ''}`
  let cmd
  if (entry.engine === 'mysql') {
    cmd = `${cat} | ${mysqlShell(entry)} ${q(entry.database)}`
  } else if (entry.engine === 'sqlite') {
    cmd = `${cat} | sqlite3 -bail ${q(entry.file)}`
  } else {
    // Objects must end up owned by the app's role, not by postgres
    const own = entry.peer && entry.appPassword
      ? { ...entry, peer: false, user: entry.appUser, password: entry.appPassword } : entry
    const role = entry.peer && !entry.appPassword && entry.appUser ? entry.appUser : null
    const conn = own.peer
      ? `runuser -u postgres -- `
      : `PGPASSWORD=${q(own.password || '')} `
    const target = own.peer ? `-d ${q(entry.database)}` : `-h ${q(own.host)} -p ${q(own.port)} -U ${q(own.user)} -d ${q(entry.database)}`
    cmd = fmt.format === 'pg_custom'
      ? `${conn}pg_restore --no-owner --no-privileges --clean --if-exists ${role ? `--role=${q(role)} ` : ''}${target} ${q(remote)}`
      : `{ ${role ? `echo ${q(`SET ROLE "${role}";`)}; ` : ''}${cat}; } | ${conn}psql -X -q -v ON_ERROR_STOP=1 ${target}`
  }
  const r = await host.exec(`set -o pipefail; ${cmd}`, { timeout: 60 * 60 * 1000 })
  await host.exec(`rm -f ${q(remote)}`).catch(() => {})
  discoveryCache.delete(host.id)
  if (r.code !== 0) {
    const tail = scrubbed(entry, r.stderr || r.stdout).trim().split('\n').slice(-6).join('\n')
    throw httpErr(400, `Import stopped with an error (the database may be partly imported). A backup taken just before is at ${backup}.\n${tail}`)
  }
  return { message: `Imported ${upload.name} into ${entry.database}.`, backup }
}

const USER_KEYS = new Set(['DB_USER', 'DB_USERNAME', 'MYSQL_USER', 'PGUSER', 'POSTGRES_USER', 'DATABASE_USER'])
const PASS_KEYS = new Set(['DB_PASSWORD', 'DB_PASS', 'MYSQL_PASSWORD', 'MYSQL_PASS', 'PGPASSWORD', 'POSTGRES_PASSWORD', 'DATABASE_PASSWORD'])
const PASS_FOR_USER = { DB_USER: 'DB_PASSWORD', DB_USERNAME: 'DB_PASSWORD', MYSQL_USER: 'MYSQL_PASSWORD', PGUSER: 'PGPASSWORD', POSTGRES_USER: 'POSTGRES_PASSWORD', DATABASE_USER: 'DATABASE_PASSWORD' }

/** Rewrites the user/password of this connection in one .env text. Returns the new text or null. */
function rewriteEnv(text, dir, entry, { oldUser, oldPassword, newUser, newPassword }) {
  const sameDb = (s) => s.engine === entry.engine && s.database === entry.database && normHost(s.host) === normHost(entry.host) && Number(s.port) === Number(entry.port)
  if (!connectionsFromEnv(parseEnvText(text), dir).some(sameDb)) return null
  let changed = false
  let userAt = null
  let passDone = false
  let urlDone = false
  const lines = text.split('\n').map((line, index) => {
    const m = line.match(/^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*?)(\r?)$/)
    if (!m) return line
    const [, pre, key, eq, raw, cr] = m
    const quote = /^(["'])(.*)\1$/.exec(raw)
    const val = quote ? quote[2] : raw
    let next = val
    if (newUser && USER_KEYS.has(key) && val === oldUser) { next = newUser; userAt = { index, key, pre } }
    else if (newPassword && PASS_KEYS.has(key) && (!oldPassword || val === oldPassword)) { next = newPassword; passDone = true }
    else if (/^[a-z+]+:\/\//i.test(val) && engineFromScheme(val.split(':')[0]) === entry.engine) {
      try {
        const u = new URL(val)
        if (decodeURIComponent(u.username) === oldUser && decodeURIComponent(u.pathname.replace(/^\//, '').split('/')[0]) === entry.database) {
          if (newUser) u.username = encodeURIComponent(newUser)
          if (newPassword) u.password = encodeURIComponent(newPassword)
          next = u.toString()
          urlDone = true
        }
      } catch { /* not a URL */ }
    }
    if (next === val) return line
    changed = true
    const q2 = quote ? quote[1] : (/[#\s]/.test(next) ? '"' : '')
    return `${pre}${key}${eq}${q2}${next}${q2}${cr}`
  })
  // A passwordless login usually has no password line (and may rely on a default user): add the keys
  const envLine = (key, val) => `${key}=${/[#\s]/.test(val) ? `"${val}"` : val}`
  if (!urlDone) {
    const fam = /^\s*MYSQL_/m.test(text) ? 'MYSQL_' : /^\s*PG[A-Z]/m.test(text) ? 'PG' : 'DB_'
    const keys = text.split('\n').map(l => (l.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/) || [])[1])
    if (newUser && !userAt && !keys.some(k => USER_KEYS.has(k))) {
      const at = lines[lines.length - 1] === '' ? lines.length - 1 : lines.length // before the trailing newline
      lines.splice(at, 0, envLine(`${fam}USER`, newUser))
      userAt = { index: at, key: `${fam}USER`, pre: '' }
      changed = true
    }
    const hasPassKey = keys.some(k => PASS_KEYS.has(k))
    if (newPassword && !passDone && !hasPassKey && userAt) {
      lines.splice(userAt.index + 1, 0, userAt.pre + envLine(PASS_FOR_USER[userAt.key] || `${fam}PASSWORD`, newPassword))
      changed = true
    }
  }
  return changed ? lines.join('\n') : null
}

/**
 * Changes the database user's name and/or password, updates every linked project's .env that
 * uses this connection, and optionally restarts the projects' PM2 processes. A MySQL database
 * reached through a system account (root) or no app user gets a new dedicated user instead.
 */
export async function changeCredentials(host, connectionId, { newUser, newPassword, adminUser, adminPassword, restart = true }) {
  const entry = await getEntry(host, connectionId)
  if (!['mysql', 'postgresql'].includes(entry.engine)) throw httpErr(400, 'Changing credentials is supported for MySQL and PostgreSQL.')
  const oldUser = entry.appUser || entry.user
  const oldPassword = entry.appPassword ?? entry.password
  newUser = String(newUser || '').trim()
  newPassword = String(newPassword || '')
  if (newUser === oldUser) newUser = ''
  if (!newUser && !newPassword) throw httpErr(400, 'Enter a new username and/or a new password.')
  if (newUser && !DB_USER_RE.test(newUser)) throw httpErr(400, 'Username: up to 32 letters, numbers and underscores.')
  if (newUser && RESERVED_DB_USERS.has(newUser.toLowerCase())) throw httpErr(400, `"${newUser}" is a system account — choose another username.`)
  if (newPassword) checkDbPassword(newPassword)
  const assign = !oldUser || RESERVED_DB_USERS.has(oldUser.toLowerCase())
  if (assign && entry.engine !== 'mysql') throw httpErr(400, `This project connects as "${oldUser || 'unknown'}", a system account. Create a dedicated database user for the app instead.`)
  if (assign && (!newUser || !newPassword)) throw httpErr(400, `${oldUser ? `This database is used through the system account "${oldUser}"` : 'No app user is known for this database'}. Enter a new username and password to give it a dedicated MySQL user.`)

  const text = async (script) => { const r = await host.exec(script, { timeout: 30000 }); return `${r.stdout}${r.stderr}` }
  const finalUser = newUser || oldUser

  if (entry.engine === 'mysql') {
    if (adminUser && !/^[A-Za-z0-9_.-]{1,32}$/.test(adminUser)) throw httpErr(400, 'Invalid MySQL admin user.')
    const admin = await findMysqlAdmin(text, { adminUser, adminPassword })
    if (admin.cmd) {
      const adminSql = (sql) => mysqlAdminSql(host, admin.cmd, sql, [newPassword, adminPassword])
      if (newUser && Number((await adminSql(`SELECT COUNT(*) FROM mysql.user WHERE user = '${newUser}'`)).trim()) > 0) throw httpErr(400, `MySQL user "${newUser}" already exists.`)
      const hosts = assign ? ['localhost', '127.0.0.1'] : sqlHosts(await adminSql(`SELECT host FROM mysql.user WHERE user = '${oldUser}'`))
      if (!hosts.length) throw httpErr(404, `MySQL user "${oldUser}" was not found.`)
      const sql = assign ? hosts.map(h => `CREATE USER '${newUser}'@'${h}' IDENTIFIED BY '${newPassword}';\nGRANT ALL PRIVILEGES ON ${myIdent(entry.database)}.* TO '${newUser}'@'${h}';`).join('\n') + '\nFLUSH PRIVILEGES;' : hosts.map(h => [
        newUser ? `RENAME USER '${oldUser}'@'${h}' TO '${newUser}'@'${h}';` : '',
        newPassword ? `ALTER USER '${finalUser}'@'${h}' IDENTIFIED BY '${newPassword}';` : ''
      ].join('\n')).join('\n') + '\nFLUSH PRIVILEGES;'
      await adminSql(sql)
    } else {
      if (newUser) throw httpErr(400, `${assign ? 'Creating' : 'Renaming'} a MySQL user needs an admin login${admin.enteredError ? ` (${admin.enteredError})` : ''}. Enter a MySQL admin user (e.g. root) and its password.`)
      await mysqlCli({ ...entry, user: oldUser, password: oldPassword }, `ALTER USER CURRENT_USER() IDENTIFIED BY '${newPassword}'`, '')
    }
  } else {
    const local = isLocalHost(entry.host) && !!(await text('command -v runuser && id postgres >/dev/null 2>&1 && echo ok')).includes('ok')
    if (newUser && !newPassword && !oldPassword) throw httpErr(400, 'Renaming a PostgreSQL role clears its password — also enter a new password.')
    const pw = newPassword || (newUser ? oldPassword : '')
    const stmts = [
      newUser ? `ALTER ROLE "${oldUser}" RENAME TO "${newUser}";` : '',
      pw ? `ALTER ROLE "${finalUser}" WITH PASSWORD '${pw}';` : ''
    ].filter(Boolean).join(' ')
    if (local) {
      if (newUser && (await psql({ _exec: host, peer: true, database: 'postgres' }, `SELECT 1 FROM pg_roles WHERE rolname = '${newUser}'`)).trim() === '1') throw httpErr(400, `PostgreSQL role "${newUser}" already exists.`)
      await psql({ _exec: host, peer: true, database: 'postgres' }, stmts)
    } else {
      if (newUser) throw httpErr(400, 'Renaming a PostgreSQL role needs superuser access on the database server.')
      await psql({ ...entry, peer: false, user: oldUser, password: oldPassword }, `ALTER ROLE CURRENT_USER WITH PASSWORD '${newPassword}'`)
    }
  }

  // Point the apps at the new credentials
  const updatedFiles = []
  const restarted = []
  const pm2Names = new Set()
  for (const p of entry.projects) {
    for (const n of p.pm2 || []) pm2Names.add(n)
    for (const sd of ENV_SUBDIRS) {
      const dir = sd ? `${p.path}/${sd}` : p.path
      for (const f of ENV_FILES) {
        const file = `${dir}/${f}`
        if (!await host.exists(file)) continue
        const before = await host.readFile(file)
        const after = rewriteEnv(before, dir, entry, { oldUser, oldPassword, newUser, newPassword })
        if (after === null) continue
        await host.writeFile(`${file}.bak`, before, { mode: 0o600 })
        await host.writeFile(file, after, { mode: 0o600 })
        updatedFiles.push(file)
      }
    }
  }
  if (restart && updatedFiles.length) {
    for (const n of pm2Names) {
      const r = await host.run('pm2', ['restart', n, '--update-env'], { timeout: 60000 })
      if (r.code === 0) restarted.push(n)
    }
  }
  discoveryCache.delete(host.id)
  const what = assign ? `to a dedicated user ${newUser}` : [newUser && `username → ${newUser}`, newPassword && 'password'].filter(Boolean).join(' and ')
  return {
    message: `${assign ? 'Switched' : 'Changed'} ${what} for ${entry.database}.${updatedFiles.length ? ` Updated ${updatedFiles.length} .env file(s)${restarted.length ? ` and restarted ${restarted.join(', ')}` : ''}.` : ' No .env file referenced this database — update your app\'s config yourself.'}`,
    user: finalUser,
    updatedFiles,
    restarted
  }
}

// ---------------------------------------------------------------------------------------------
// Create / delete databases
// ---------------------------------------------------------------------------------------------

const DB_NAME_RE = /^[A-Za-z0-9_]{1,64}$/
const ENGINE_LABEL = { mysql: 'MySQL', postgresql: 'PostgreSQL' }

const hasPgPeer = async (host) => (await host.exec('command -v runuser >/dev/null && id postgres >/dev/null 2>&1 && echo ok', { timeout: 15000 })).stdout.includes('ok')

/**
 * Creates a MySQL or PostgreSQL database on the server, optionally with a user that owns it.
 * An existing user is only given access (leave the password empty); a new one needs a password.
 */
export async function createDatabase(host, { engine = 'mysql', name, user, password, adminUser, adminPassword }) {
  name = String(name || '').trim()
  user = String(user || '').trim()
  password = String(password || '')
  if (!ENGINE_LABEL[engine]) throw httpErr(400, 'New databases can be MySQL or PostgreSQL.')
  if (!DB_NAME_RE.test(name)) throw httpErr(400, 'Database name: up to 64 letters, numbers and underscores.')
  if ((SYSTEM_DATABASES[engine] || []).includes(name.toLowerCase())) throw httpErr(400, `"${name}" is a system database.`)
  if (user && !DB_USER_RE.test(user)) throw httpErr(400, 'Username: up to 32 letters, numbers and underscores.')
  if (user && RESERVED_DB_USERS.has(user.toLowerCase())) throw httpErr(400, `"${user}" is a system account — choose another username.`)
  if (password && !user) throw httpErr(400, 'Enter the username the password belongs to.')
  if (password) checkDbPassword(password)
  const checkUser = (exists) => {
    if (!exists && !password) throw httpErr(400, `Enter a password for the new user "${user}".`)
    if (exists && password) throw httpErr(400, `User "${user}" already exists — leave the password empty to give it access, or change its password under Credentials.`)
  }
  let userCreated = false

  if (engine === 'mysql') {
    if (adminUser && !/^[A-Za-z0-9_.-]{1,32}$/.test(adminUser)) throw httpErr(400, 'Invalid MySQL admin user.')
    const admin = await findMysqlAdmin(async (s) => { const r = await host.exec(s, { timeout: 30000 }); return `${r.stdout}${r.stderr}` }, { adminUser, adminPassword })
    if (!admin.cmd) throw httpErr(400, `Creating a database needs a MySQL admin login${admin.enteredError ? ` (${admin.enteredError})` : ''}. Enter a MySQL admin user (e.g. root) and its password.`)
    const adminSql = (sql) => mysqlAdminSql(host, admin.cmd, sql, [password, adminPassword])
    if (Number((await adminSql(`SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name = '${name}'`)).trim()) > 0) throw httpErr(400, `Database "${name}" already exists.`)
    const stmts = [`CREATE DATABASE ${myIdent(name)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`]
    if (user) {
      const existing = sqlHosts(await adminSql(`SELECT host FROM mysql.user WHERE user = '${user}'`))
      checkUser(existing.length > 0)
      userCreated = !existing.length
      for (const h of existing.length ? existing : ['localhost', '127.0.0.1']) {
        if (userCreated) stmts.push(`CREATE USER '${user}'@'${h}' IDENTIFIED BY '${password}';`)
        stmts.push(`GRANT ALL PRIVILEGES ON ${myIdent(name)}.* TO '${user}'@'${h}';`)
      }
      stmts.push('FLUSH PRIVILEGES;')
    }
    await adminSql(stmts.join('\n'))
  } else {
    if (!await hasPgPeer(host)) throw httpErr(400, 'Creating a PostgreSQL database needs PostgreSQL installed on this server.')
    const peer = { _exec: host, peer: true, database: 'postgres' }
    if ((await psql(peer, `SELECT 1 FROM pg_database WHERE datname = ${pgLit(name)}`)).trim() === '1') throw httpErr(400, `Database "${name}" already exists.`)
    if (user) {
      const exists = (await psql(peer, `SELECT 1 FROM pg_roles WHERE rolname = ${pgLit(user)}`)).trim() === '1'
      checkUser(exists)
      userCreated = !exists
      if (userCreated) await psql(peer, `CREATE ROLE ${pgIdent(user)} WITH LOGIN PASSWORD ${pgLit(password)}`)
    }
    // CREATE DATABASE cannot share a statement batch (it refuses to run inside a transaction)
    await psql(peer, `CREATE DATABASE ${pgIdent(name)}${user ? ` OWNER ${pgIdent(user)}` : ''}`)
  }

  discoveryCache.delete(host.id)
  const port = DEFAULT_PORTS[engine]
  return {
    message: `Created ${ENGINE_LABEL[engine]} database ${name}${user ? ` ${userCreated ? 'with new user' : 'for user'} ${user}` : ''}.`,
    connection: {
      engine,
      host: '127.0.0.1',
      port,
      database: name,
      user: user || null,
      url: user ? `${engine}://${user}:${userCreated ? encodeURIComponent(password) : '<password>'}@127.0.0.1:${port}/${name}` : null
    }
  }
}

/**
 * Deletes a SQLite file, drops a MongoDB database or flushes a Redis logical database, after a
 * backup: an SQL dump for SQLite, a mongodump archive for MongoDB and an RDB snapshot of the whole
 * Redis instance (Redis cannot snapshot a single logical database).
 */
async function dropOtherDatabase(host, entry, stamp) {
  const name = entry.engine === 'redis' ? `db${entry.database}` : entry.database
  const base = `${BACKUP_DIR}/${String(name).replace(/[^\w.-]/g, '_')}-${stamp}-before-delete`
  await host.exec(`mkdir -p ${BACKUP_DIR} && chmod 700 ${BACKUP_DIR}`)
  let backup

  if (entry.engine === 'sqlite') {
    backup = `${base}.sql.gz`
    await dumpTo(host, entry, backup)
    const files = ['', '-wal', '-shm', '-journal'].map(x => q(entry.file + x)).join(' ')
    const r = await host.exec(`rm -f ${files}`)
    if (r.code !== 0) throw httpErr(500, `Could not remove ${entry.file}: ${(r.stderr || '').trim()}`)
  } else if (entry.engine === 'mongodb') {
    if (!(await host.exec('command -v mongodump >/dev/null && echo ok')).stdout.includes('ok')) {
      throw httpErr(400, 'Deleting a MongoDB database needs mongodump for the backup (install mongodb-database-tools).')
    }
    backup = `${base}.archive.gz`
    try {
      await run(entry._exec, 'mongodump', [`--uri=${mongoUri(entry)}`, `--archive=${backup}`, '--gzip', '--quiet'], { timeout: 30 * 60 * 1000, secrets: [entry.password] })
    } catch (e) {
      await host.exec(`rm -f ${q(backup)}`).catch(() => {})
      throw httpErr(500, `Backup failed: ${e.message}`)
    }
    await mongoEval(entry, 'return db.dropDatabase()')
  } else if (entry.engine === 'redis') {
    backup = `${base}.rdb.gz`
    const rdb = `${base}.rdb`
    try {
      await run(entry._exec, 'redis-cli', ['-h', entry.host, '-p', String(entry.port), '--rdb', rdb], { env: entry.password ? { REDISCLI_AUTH: entry.password } : {}, timeout: 30 * 60 * 1000, secrets: [entry.password] })
      const r = await host.exec(`gzip -f ${q(rdb)}`)
      if (r.code !== 0) throw new Error((r.stderr || '').trim())
    } catch (e) {
      await host.exec(`rm -f ${q(rdb)} ${q(backup)}`).catch(() => {})
      throw httpErr(500, `Backup failed: ${e.message}`)
    }
    await redisCli(entry, ['FLUSHDB'], { json: false })
  } else {
    throw httpErr(400, `Deleting is not supported for ${entry.engine} databases.`)
  }

  discoveryCache.delete(host.id)
  const what = entry.engine === 'redis' ? `Flushed every key in ${name}` : `Deleted ${name}`
  return { message: `${what}. A backup is at ${backup}.`, backup }
}

/**
 * Drops a database after writing a gzipped backup to /var/backups/autodeploy-db.
 * `confirm` must repeat the database name. With `dropUser` (MySQL / PostgreSQL), the app's user is
 * removed too unless it still has access to other databases.
 */
export async function dropDatabase(host, connectionId, { confirm, dropUser = false, adminUser, adminPassword }) {
  const entry = await getEntry(host, connectionId)
  const shownName = entry.engine === 'redis' ? `db${entry.database}` : entry.database
  if (String(confirm || '') !== shownName) throw httpErr(400, `Type the database name (${shownName}) to confirm.`)
  if ((SYSTEM_DATABASES[entry.engine] || []).includes(entry.database)) throw httpErr(400, `"${entry.database}" is a system database.`)
  if (!ENGINE_LABEL[entry.engine]) return dropOtherDatabase(host, entry, new Date().toISOString().replace(/[-:]/g, '').slice(0, 15))
  if (entry.engine === 'postgresql' && !entry.peer) throw httpErr(400, 'Deleting a PostgreSQL database needs superuser access on its server.')

  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)
  const backup = `${BACKUP_DIR}/${String(entry.database).replace(/[^\w.-]/g, '_')}-${stamp}-before-delete.sql.gz`
  await host.exec(`mkdir -p ${BACKUP_DIR} && chmod 700 ${BACKUP_DIR}`)
  await dumpTo(host, entry, backup)

  const appUser = entry.appUser || entry.user
  const removable = dropUser && appUser && !RESERVED_DB_USERS.has(appUser.toLowerCase())
  const notes = []

  if (entry.engine === 'mysql') {
    if (adminUser && !/^[A-Za-z0-9_.-]{1,32}$/.test(adminUser)) throw httpErr(400, 'Invalid MySQL admin user.')
    const admin = entry.adminCmd && !adminUser
      ? { cmd: entry.adminCmd }
      : await findMysqlAdmin(async (s) => { const r = await host.exec(s, { timeout: 30000 }); return `${r.stdout}${r.stderr}` }, { adminUser, adminPassword })
    if (admin.cmd) {
      const adminSql = (sql) => mysqlAdminSql(host, admin.cmd, sql, [adminPassword])
      await adminSql(`DROP DATABASE ${myIdent(entry.database)};`)
      if (removable) {
        // Grants on other databases (mysql.db stores `_` escaped as `\_`) mean the user is still in use
        const others = Number((await adminSql(`SELECT COUNT(*) FROM mysql.db WHERE user = ${myLit(appUser)} AND db NOT IN (${myLit(entry.database)}, ${myLit(entry.database.replace(/_/g, '\\_'))})`)).trim())
        if (others > 0) notes.push(`kept user ${appUser} (it can still access other databases)`)
        else {
          const hosts = sqlHosts(await adminSql(`SELECT host FROM mysql.user WHERE user = ${myLit(appUser)}`))
          if (hosts.length) await adminSql(hosts.map(h => `DROP USER '${appUser}'@'${h}';`).join('\n'))
          notes.push(`removed user ${appUser}`)
        }
      }
    } else {
      // Without an admin login, the app's own user needs the DROP privilege
      await mysqlCli(entry, `DROP DATABASE ${myIdent(entry.database)}`, '')
      if (removable) notes.push(`kept user ${appUser} (removing it needs a MySQL admin login)`)
    }
  } else {
    const peer = { _exec: host, peer: true, database: 'postgres' }
    // WITH (FORCE) (PostgreSQL 13+) disconnects the app's open sessions first
    await psql(peer, `DROP DATABASE ${pgIdent(entry.database)} WITH (FORCE)`).catch(e => {
      if (!/syntax error/i.test(e.message)) throw e
      return psql(peer, `DROP DATABASE ${pgIdent(entry.database)}`)
    })
    if (removable) {
      const owns = Number((await psql(peer, `SELECT count(*) FROM pg_database d JOIN pg_roles r ON r.oid = d.datdba WHERE r.rolname = ${pgLit(appUser)}`)).trim())
      if (owns > 0) notes.push(`kept role ${appUser} (it owns other databases)`)
      else await psql(peer, `DROP ROLE ${pgIdent(appUser)}`)
        .then(() => notes.push(`removed role ${appUser}`))
        .catch(e => notes.push(`kept role ${appUser} (${e.message.split('\n')[0]})`))
    }
  }

  discoveryCache.delete(host.id)
  return { message: `Deleted ${entry.database}${notes.length ? `; ${notes.join('; ')}` : ''}. A backup is at ${backup}.`, backup }
}

// ---------------------------------------------------------------------------------------------
// External (Supabase) databases: connect to a project, migrate onto this server
// ---------------------------------------------------------------------------------------------

/** Supabase hosts: db.<ref>.supabase.co (direct) and *.pooler.supabase.com (Supavisor). */
export const isSupabaseHost = (h) => /(^|\.)supabase\.(co|com|net)$/i.test(String(h || ''))

// Schemas Supabase manages itself; they hold platform internals that a plain PostgreSQL can't restore
const SUPABASE_INTERNAL_SCHEMAS = ['auth', 'storage', 'realtime', '_realtime', 'supabase_functions', 'supabase_migrations',
  'extensions', 'graphql', 'graphql_public', 'pgbouncer', 'pgsodium', 'pgsodium_masks', 'vault', 'net', 'cron', '_analytics', 'pgtle', 'tiger', 'topology']
// Roles Supabase row level security policies and grants refer to
const SUPABASE_ROLES = ['anon', 'authenticated', 'service_role']
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const HOST_KEYS = new Set(['DB_HOST', 'PGHOST', 'POSTGRES_HOST', 'DATABASE_HOST'])
const PORT_KEYS = new Set(['DB_PORT', 'PGPORT', 'POSTGRES_PORT', 'DATABASE_PORT'])
const NAME_KEYS = new Set(['DB_NAME', 'DB_DATABASE', 'PGDATABASE', 'POSTGRES_DB', 'DATABASE_NAME'])

/** Parses a postgres:// connection string into an entry the psql helpers accept. */
function parsePgUrl(url) {
  url = String(url || '').trim()
  let u
  try { u = new URL(url) } catch { throw httpErr(400, 'Enter a connection string like postgresql://user:password@host:5432/postgres') }
  if (engineFromScheme(u.protocol.replace(/:$/, '')) !== 'postgresql') throw httpErr(400, 'Only PostgreSQL connection strings (postgres:// or postgresql://) are supported.')
  if (!u.hostname) throw httpErr(400, 'The connection string has no host.')
  if (/[\s'"`$\\]/.test(url)) throw httpErr(400, 'The connection string cannot contain spaces, quotes, backticks, backslashes or $ (URL-encode them).')
  return {
    engine: 'postgresql',
    host: decodeURIComponent(u.hostname).replace(/^\[|\]$/g, ''),
    port: Number(u.port) || 5432,
    user: decodeURIComponent(u.username || 'postgres'),
    password: decodeURIComponent(u.password || ''),
    database: decodeURIComponent(u.pathname.replace(/^\//, '').split('/')[0] || 'postgres'),
    url
  }
}

const pgErrorHint = (msg) => {
  if (/Network is unreachable|could not translate host|No route to host/i.test(msg)) return `${msg}\nSupabase's direct connection (db.<ref>.supabase.co) is IPv6 only. Use the Session pooler connection string (…pooler.supabase.com:5432) from Supabase → Connect.`
  if (/password authentication failed/i.test(msg)) return `${msg}\nCheck the database password (Supabase → Project Settings → Database). Pooler logins look like postgres.<project-ref>.`
  return msg
}

/** Checks that this server can log in with the connection string. Returns the server's major version. */
async function probePg(host, spec) {
  if (!(await host.exec('command -v psql >/dev/null && echo ok', { timeout: 15000 })).stdout.includes('ok')) {
    throw httpErr(400, 'The PostgreSQL client (psql) is not installed on this server. Install it with: apt-get install -y postgresql-client')
  }
  try {
    const out = await psql({ ...spec, _exec: host, peer: false }, 'SHOW server_version_num')
    return Math.floor(Number(out.trim()) / 10000)
  } catch (e) {
    throw httpErr(400, `Could not connect: ${pgErrorHint(scrubbed(spec, e.message))}`)
  }
}

/** Sets KEY=value in .env text (replacing the existing line). Returns { text, previous }. */
function upsertEnvVar(text, key, value) {
  let previous = null
  let found = false
  const lines = text.split('\n').map(line => {
    const m = line.match(/^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*?)(\r?)$/)
    if (!m || m[2] !== key || found) return line
    found = true
    previous = m[4].replace(/^(["'])(.*)\1$/, '$2')
    return `${m[1]}${key}${m[3]}${value}${m[5]}`
  })
  if (!found) {
    const at = lines[lines.length - 1] === '' ? lines.length - 1 : lines.length
    lines.splice(at, 0, `${key}=${value}`)
  }
  return { text: lines.join('\n'), previous }
}

/** The project's main .env: the first existing .env file in the project folder (or backend/, server/, api/), else <project>/.env. */
async function primaryEnvFile(host, projectPath) {
  for (const sd of ENV_SUBDIRS) {
    for (const f of ENV_FILES) {
      const file = sd ? `${projectPath}/${sd}/${f}` : `${projectPath}/${f}`
      if (await host.exists(file)) return file
    }
  }
  return `${projectPath}/.env`
}

async function writeEnvWithBackup(host, file, before, after) {
  if (before !== null) await host.writeFile(`${file}.bak`, before, { mode: 0o600 })
  await host.writeFile(file, after, { mode: 0o600 })
}

async function restartPm2(host, names) {
  const restarted = []
  for (const n of names) {
    const r = await host.run('pm2', ['restart', n, '--update-env'], { timeout: 60000 })
    if (r.code === 0) restarted.push(n)
  }
  return restarted
}

/** PM2 process names of one discovered project. */
async function projectPm2(host, projectPath) {
  const projects = await discoverHostProjects(host, [])
  return (projects.find(p => p.path === projectPath)?.pm2Processes || []).map(x => x.name)
}

/**
 * Connects an external PostgreSQL database (typically Supabase) to a project: checks that this
 * server can log in, then writes the connection string to the project's .env under `envKey`, so it
 * is discovered like any other project database. An existing different value needs `replace`.
 */
export async function connectExternalDatabase(host, { projectPath, url, envKey = 'DATABASE_URL', replace = false, restart = false }) {
  if (!projectPath) throw httpErr(400, 'Choose the project to connect the database to.')
  envKey = String(envKey || 'DATABASE_URL').trim()
  if (!ENV_KEY_RE.test(envKey)) throw httpErr(400, 'Variable name: letters, numbers and underscores.')
  const spec = parsePgUrl(url)
  await probePg(host, spec)

  const file = await primaryEnvFile(host, projectPath)
  const before = (await host.exists(file)) ? await host.readFile(file) : null
  const { text, previous } = upsertEnvVar(before ?? '', envKey, spec.url)
  if (previous === spec.url) return { message: `${envKey} in ${file} already points at this database.`, file, restarted: [] }
  if (previous !== null && previous !== '' && !replace) {
    throw httpErr(409, `${envKey} is already set in ${file}. Tick "Replace the existing value" to overwrite it (a .env.bak copy is kept), or use another variable name.`)
  }
  await writeEnvWithBackup(host, file, before, text.endsWith('\n') ? text : `${text}\n`)
  const restarted = restart ? await restartPm2(host, await projectPm2(host, projectPath)) : []
  discoveryCache.delete(host.id)
  const where = isSupabaseHost(spec.host) ? 'Supabase database' : `database on ${spec.host}`
  return {
    message: `Connected the ${where} ${spec.database} as ${envKey} in ${file}${restarted.length ? ` and restarted ${restarted.join(', ')}` : ''}.`,
    file,
    restarted
  }
}

/** pg_dump that can dump a server of `major` (pg_dump refuses servers newer than itself), or null. */
async function pgDumpFor(host, major) {
  const out = (await host.exec('for b in /usr/lib/postgresql/*/bin/pg_dump $(command -v pg_dump); do [ -x "$b" ] && echo "$($b --version | grep -oE \'[0-9]+\' | head -1) $b"; done', { timeout: 15000 })).stdout
  const bins = out.split('\n').map(l => l.trim().split(' ')).filter(([v, b]) => b && Number(v) >= major).sort((a, b) => Number(b[0]) - Number(a[0]))
  return bins[0]?.[1] || null
}

/** Rewrites .env lines that point at `source` so they point at the new local database. */
function repointEnv(text, dir, source, target) {
  const sameDb = (s) => s.engine === 'postgresql' && normHost(s.host) === normHost(source.host) && s.database === source.database
  if (!connectionsFromEnv(parseEnvText(text), dir).some(sameDb)) return null
  const hostLine = text.split('\n').some(l => { const m = l.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*["']?([^"'\s#]*)/); return m && HOST_KEYS.has(m[1]) && normHost(m[2]) === normHost(source.host) })
  let changed = false
  const out = text.split('\n').map(line => {
    const m = line.match(/^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*?)(\r?)$/)
    if (!m) return line
    const [, pre, key, eq, raw, cr] = m
    const quote = /^(["'])(.*)\1$/.exec(raw)
    const val = quote ? quote[2] : raw
    let next = val
    if (/^postgres(ql)?:\/\//i.test(val)) {
      try {
        const u = new URL(val)
        if (normHost(decodeURIComponent(u.hostname)) === normHost(source.host) && decodeURIComponent(u.pathname.replace(/^\//, '').split('/')[0] || 'postgres') === source.database) next = target.url
      } catch { /* not a URL */ }
    } else if (hostLine) {
      if (HOST_KEYS.has(key)) next = '127.0.0.1'
      else if (PORT_KEYS.has(key)) next = '5432'
      else if (NAME_KEYS.has(key)) next = target.database
      else if (USER_KEYS.has(key)) next = target.user
      else if (PASS_KEYS.has(key)) next = target.password
    }
    if (next === val) return line
    changed = true
    const q2 = quote ? quote[1] : ''
    return `${pre}${key}${eq}${q2}${next}${q2}${cr}`
  })
  return changed ? out.join('\n') : null
}

// Supabase grants also name its platform roles, which a plain PostgreSQL does not have
const IGNORED_RESTORE_ERRORS = /already exists|transaction_timeout|must be owner of (extension|schema)|COMMENT ON EXTENSION|unrecognized configuration parameter|role "(postgres|supabase_\w+|authenticator|dashboard_user|pgbouncer|pgsodium_\w+)" does not exist|permission denied to change default privileges/i

/**
 * Copies an external PostgreSQL database (typically Supabase) into a new PostgreSQL database on
 * this server: creates the database and its user, recreates Supabase's roles (anon,
 * authenticated, service_role) and extensions, dumps the source's own schemas (plus `auth` with
 * `includeAuth`, `storage` with `includeStorage`) and restores them as the new user. With
 * `keepPrivileges` the source's grants are restored too (the local Supabase API relies on the grants
 * to anon/authenticated). The source is not changed. `onLog(text)` receives progress lines.
 */
async function copyExternalPostgres(host, source, { name, user, password, includeAuth = true, includeStorage = false, keepPrivileges = false, onLog = () => {} }) {
  if (source.engine !== 'postgresql' || source.peer || isLocalHost(source.host)) throw httpErr(400, 'Only an external PostgreSQL database (such as Supabase) can be migrated onto this server.')
  if (!await hasPgPeer(host)) throw httpErr(400, 'PostgreSQL is not installed on this server. Install it first (apt-get install -y postgresql), then migrate.')
  name = String(name || '').trim()
  user = String(user || '').trim()
  if (!DB_NAME_RE.test(name)) throw httpErr(400, 'Database name: up to 64 letters, numbers and underscores.')
  if (!user) throw httpErr(400, 'Enter a username for the new database.')
  if ((await psql({ _exec: host, peer: true, database: 'postgres' }, `SELECT 1 FROM pg_database WHERE datname = ${pgLit(name)}`)).trim() === '1') throw httpErr(400, `Database "${name}" already exists on this server.`)
  const srcSpec = { ...source, _exec: host, peer: false }
  const major = await probePg(host, srcSpec)
  const pgDump = await pgDumpFor(host, major)
  if (!pgDump) throw httpErr(400, `The source runs PostgreSQL ${major}, newer than this server's pg_dump. Install a matching client first: apt-get install -y postgresql-client-${major} (from the PostgreSQL apt repository, apt.postgresql.org).`)

  // The source's own schemas, without Supabase internals
  const schemas = await sourceSchemas(srcSpec, includeAuth, includeStorage)
  if (!schemas.length) throw httpErr(400, 'The source database has no schemas of its own to copy.')
  const leftBehind = await platformFeatures(srcSpec)
  const extensions = await pgJson(srcSpec, "SELECT e.extname AS name, n.nspname AS schema FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname <> 'plpgsql'")

  // 1. Dump first: nothing is created on this server if the source can't be read
  onLog(`Dumping ${schemas.join(', ')} from ${source.database} on ${source.host} (PostgreSQL ${major})…\n`)
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)
  const dump = `${BACKUP_DIR}/${String(source.database).replace(/[^\w.-]/g, '_')}-to-${name}-${stamp}-migration.sql.gz`
  await host.exec(`mkdir -p ${BACKUP_DIR} && chmod 700 ${BACKUP_DIR}`)
  const dumpCmd = `PGPASSWORD=${q(source.password || '')} PGCONNECT_TIMEOUT=10 ${q(pgDump)} --no-owner ${keepPrivileges ? '' : '--no-privileges '}--no-publications --no-subscriptions --quote-all-identifiers -h ${q(source.host)} -p ${q(source.port)} -U ${q(source.user || 'postgres')} -d ${q(source.database)} ${schemas.map(s => `-n ${q(s)}`).join(' ')}`
  const d = await host.exec(`set -o pipefail; umask 077; ${dumpCmd} | gzip > ${q(dump)}`, { timeout: 60 * 60 * 1000 })
  if (d.code !== 0) {
    await host.exec(`rm -f ${q(dump)}`).catch(() => {})
    throw httpErr(500, `Could not dump the source database: ${pgErrorHint(scrubbed(source, d.stderr || d.stdout).trim().split('\n').slice(-4).join('\n'))}`)
  }

  // 2. The new database and its user
  onLog(`Creating database ${name} for user ${user}…\n`)
  const created = await createDatabase(host, { engine: 'postgresql', name, user, password })
  const peer = { _exec: host, peer: true, database: 'postgres' }
  const peerDb = { _exec: host, peer: true, database: name }
  for (const role of SUPABASE_ROLES) {
    await psql(peer, `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${pgLit(role)}) THEN CREATE ROLE ${pgIdent(role)} NOLOGIN; END IF; END $$`)
  }
  // The app's user can act as the Supabase roles, so policies and grants that name them restore
  await psql(peer, `GRANT ${SUPABASE_ROLES.map(pgIdent).join(', ')} TO ${pgIdent(user)}`)

  // 3. Extensions the source uses (where this server has them)
  const skippedExtensions = []
  for (const ext of extensions) {
    if (SUPABASE_INTERNAL_SCHEMAS.includes(ext.schema) && ext.schema !== 'extensions') continue
    try {
      await psql(peerDb, `CREATE SCHEMA IF NOT EXISTS ${pgIdent(ext.schema)}; GRANT USAGE ON SCHEMA ${pgIdent(ext.schema)} TO ${pgIdent(user)}, ${SUPABASE_ROLES.map(pgIdent).join(', ')}; CREATE EXTENSION IF NOT EXISTS ${pgIdent(ext.name)} WITH SCHEMA ${pgIdent(ext.schema)}`)
    } catch {
      skippedExtensions.push(ext.name)
    }
  }

  // 4. Restore as the app's user, so it owns every object. Errors are collected, not fatal:
  // Supabase dumps carry platform-specific statements that a plain PostgreSQL can't run.
  onLog(`Restoring into ${name}…\n`)
  const restore = await host.exec(`set -o pipefail; { echo ${q(`SET ROLE ${pgIdent(user)};`)}; gunzip -c ${q(dump)}; } | runuser -u postgres -- psql -X -q -v ON_ERROR_STOP=0 -d ${q(name)} 2>&1 >/dev/null`, { timeout: 60 * 60 * 1000 })
  if (restore.code !== 0) throw httpErr(500, `Restore into ${name} failed (the dump is kept at ${dump}): ${String(restore.stdout || restore.stderr).trim().split('\n').slice(-4).join('\n')}`)
  const errors = String(restore.stdout || '').split('\n').filter(l => /ERROR:/.test(l) && !IGNORED_RESTORE_ERRORS.test(l)).map(l => l.replace(/^psql:[^:]*:\d+:\s*/, ''))
  const tables = Number((await psql(peerDb, `SELECT count(*) FROM pg_tables WHERE schemaname IN (${schemas.map(pgLit).join(', ')})`)).trim())
  return { tables, schemas, errors, skippedExtensions, dump, created, leftBehind }
}

/** The source's own schemas (Supabase internals left out), plus `auth` / `storage` when asked for and present. */
async function sourceSchemas(srcSpec, includeAuth, includeStorage = false) {
  const schemas = (await pgJson(srcSpec, `SELECT nspname AS name FROM pg_namespace WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema' AND nspname NOT IN (${SUPABASE_INTERNAL_SCHEMAS.map(pgLit).join(', ')}) ORDER BY 1`)).map(r => r.name)
  for (const [want, schema] of [[includeAuth, 'auth'], [includeStorage, 'storage']]) {
    if (want && (await psql(srcSpec, `SELECT 1 FROM pg_namespace WHERE nspname = ${pgLit(schema)}`)).trim() === '1') schemas.push(schema)
  }
  return schemas
}

/**
 * Supabase platform features that live outside the copied schemas: pg_cron jobs, tables published to
 * Realtime and database webhooks. They are reported, not copied.
 */
async function platformFeatures(srcSpec) {
  const count = async (sql) => Number((await psql(srcSpec, sql).catch(() => '0')).trim()) || 0
  return {
    cronJobs: await count("SELECT CASE WHEN to_regclass('cron.job') IS NULL THEN 0 ELSE (SELECT count(*) FROM cron.job) END"),
    realtimeTables: await count("SELECT count(*) FROM pg_publication_tables WHERE pubname = 'supabase_realtime'"),
    webhooks: await count("SELECT CASE WHEN to_regclass('supabase_functions.hooks') IS NULL THEN 0 ELSE (SELECT count(DISTINCT hook_name) FROM supabase_functions.hooks) END")
  }
}

const migrationNotes = ({ errors, skippedExtensions, leftBehind }) => [
  ...(errors.length ? [`${errors.length} statement(s) could not be restored`] : []),
  ...(skippedExtensions.length ? [`extensions not available on this server: ${skippedExtensions.join(', ')}`] : []),
  ...(leftBehind?.cronJobs ? [`${leftBehind.cronJobs} pg_cron job(s) were not copied: recreate them in the panel's Cron jobs`] : []),
  ...(leftBehind?.realtimeTables ? [`${leftBehind.realtimeTables} table(s) use Supabase Realtime, which this server does not provide`] : []),
  ...(leftBehind?.webhooks ? [`${leftBehind.webhooks} database webhook(s) were not copied`] : [])
]

/**
 * Checks an external PostgreSQL connection string from this server before a migration:
 * returns what would be copied. Nothing is written.
 */
export async function inspectExternalPostgres(host, url, { includeAuth = true, includeStorage = false } = {}) {
  const spec = parsePgUrl(url)
  if (isLocalHost(spec.host)) throw httpErr(400, 'That database is already on this server — choose "Create new database" or "Upload database file" instead.')
  const srcSpec = { ...spec, _exec: host, peer: false }
  const version = await probePg(host, srcSpec)
  const schemas = await sourceSchemas(srcSpec, includeAuth, includeStorage)
  const tables = schemas.length ? Number((await psql(srcSpec, `SELECT count(*) FROM pg_tables WHERE schemaname IN (${schemas.map(pgLit).join(', ')})`)).trim()) : 0
  const size = Number((await psql(srcSpec, 'SELECT pg_database_size(current_database())')).trim()) || null
  const users = schemas.includes('auth') ? Number((await psql(srcSpec, "SELECT CASE WHEN to_regclass('auth.users') IS NULL THEN 0 ELSE (SELECT count(*) FROM auth.users) END").catch(() => '0')).trim()) || 0 : null
  const leftBehind = await platformFeatures(srcSpec)
  return { provider: isSupabaseHost(spec.host) ? 'supabase' : null, host: spec.host, database: spec.database, version, schemas, tables, size, users, leftBehind, notes: migrationNotes({ errors: [], skippedExtensions: [], leftBehind }) }
}

/**
 * Copies the external PostgreSQL database at `url` (Supabase, Neon, RDS, …) into a new database
 * on this server. Used by the deployment wizard's "Migrate existing database".
 */
export async function migrateExternalPostgres(host, url, opts) {
  const source = parsePgUrl(url)
  const result = await copyExternalPostgres(host, source, opts)
  return { ...result, source: { host: source.host, database: source.database, provider: isSupabaseHost(source.host) ? 'supabase' : null }, notes: migrationNotes(result) }
}

/**
 * Copies a discovered external PostgreSQL database onto this server (see copyExternalPostgres).
 * With `targetProjectPath`, that project's .env is pointed at the new database (lines that
 * referenced the source are rewritten; otherwise DATABASE_URL is set) and its PM2 apps can be
 * restarted.
 */
export async function migrateToLocal(host, connectionId, { name, user, password, targetProjectPath = null, includeAuth = true, restart = true }) {
  const source = await getEntry(host, connectionId)
  const { tables, schemas, errors, skippedExtensions, dump, created } = await copyExternalPostgres(host, source, { name, user, password, includeAuth })
  name = String(name).trim()
  user = String(user).trim()

  // 5. Point the project at the new database
  const target = { database: name, user, password, url: password ? `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:5432/${name}` : null }
  const updatedFiles = []
  let restarted = []
  if (targetProjectPath && target.url) {
    for (const sd of ENV_SUBDIRS) {
      const dir = sd ? `${targetProjectPath}/${sd}` : targetProjectPath
      for (const f of ENV_FILES) {
        const file = `${dir}/${f}`
        if (!await host.exists(file)) continue
        const before = await host.readFile(file)
        const after = repointEnv(before, dir, source, target)
        if (after === null) continue
        await writeEnvWithBackup(host, file, before, after)
        updatedFiles.push(file)
      }
    }
    if (!updatedFiles.length) {
      const file = await primaryEnvFile(host, targetProjectPath)
      const before = (await host.exists(file)) ? await host.readFile(file) : null
      const { text } = upsertEnvVar(before ?? '', 'DATABASE_URL', target.url)
      await writeEnvWithBackup(host, file, before, text.endsWith('\n') ? text : `${text}\n`)
      updatedFiles.push(file)
    }
    if (restart) restarted = await restartPm2(host, await projectPm2(host, targetProjectPath))
  }

  discoveryCache.delete(host.id)
  const notes = migrationNotes({ errors, skippedExtensions })
  return {
    message: `Copied ${tables} table(s) from ${source.database} on ${source.host} into ${name} on this server.${updatedFiles.length ? ` Updated ${updatedFiles.length} .env file(s)${restarted.length ? ` and restarted ${restarted.join(', ')}` : ''}.` : ''}${notes.length ? ` Note: ${notes.join('; ')}.` : ''}`,
    tables,
    schemas,
    errors: errors.slice(0, 50),
    skippedExtensions,
    dump,
    updatedFiles,
    restarted,
    connection: { ...created.connection, url: target.url || created.connection.url }
  }
}
