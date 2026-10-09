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

function mysqlCli(entry, sql, database = entry.database) {
  const args = ['--batch', '-h', entry.host, '-P', String(entry.port), '-u', entry.user, '--connect-timeout=5']
  if (database) args.push('-D', database)
  args.push('-e', sql)
  return run(entry._exec, 'mysql', args, { env: { MYSQL_PWD: entry.password || '' }, secrets: [entry.password] })
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

async function listServerDatabases(exec, ports, mysqlCreds, mongoBases, redisBases) {
  const found = []
  const errors = []

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
      for (const r of rows) found.push({ ...cred, database: r.name, bytes: Number(r.bytes) })
    } catch (e) {
      errors.push({ engine: 'mysql', error: e.message })
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

  return { found, errors }
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
      entry.projects.push({ name: project.name, path: project.path, source: spec.source })
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

  const { found, errors } = await listServerDatabases(host, ports, mysqlCreds, mongoBases, redisBases)
  for (const spec of found) {
    if ((SYSTEM_DATABASES[spec.engine] || []).includes(spec.database)) continue
    const key = entryKey(spec)
    const existing = entries.get(key)
    if (existing) {
      // Local PostgreSQL: prefer peer auth over app credentials (works even with limited grants)
      if (spec.peer) Object.assign(existing, { peer: true, user: 'postgres', password: '' })
      if (spec.bytes !== undefined) existing.bytes = spec.bytes
      if (spec.keys !== undefined) existing.keys = spec.keys
    } else {
      addEntry(spec, null)
    }
  }

  // 3. Map unlinked databases to projects by name (tip_crm_db -> tip-crm)
  for (const entry of entries.values()) {
    if (entry.projects.length || entry.engine === 'redis') continue
    const dbNorm = normName(entry.database)
    for (const p of projects) {
      const candidates = [normName(p.name), normName(path.basename(p.path))].filter(n => n.length >= 4)
      if (candidates.some(n => dbNorm.startsWith(n) || n.startsWith(dbNorm) && dbNorm.length >= 4)) {
        entry.projects.push({ name: p.name, path: p.path, source: 'matched by name' })
      }
    }
  }

  const publicEntry = (e) => ({
    id: e.id,
    engine: e.engine,
    database: e.engine === 'redis' ? `db${e.database}` : e.database,
    host: e.engine === 'sqlite' ? e.file : `${e.host}:${e.port}`,
    user: e.engine === 'sqlite' ? null : (e.user || null),
    auth: e.peer ? 'peer (postgres)' : (e.password ? 'password' : 'none'),
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
