import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { analyzeProject, manifestPaths } from './detector.service.js'
import { getReadyUpload, validateGitUrl, withGithubToken, redactUrl } from './upload.service.js'

/**
 * 1-click deployment pipeline (GitHub or uploaded source, optional database) on the selected
 * server, through its host executor (direct on the panel host, SSH for connected servers).
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
  { id: 'source', label: 'Getting source code', weight: 12 },
  { id: 'analyze', label: 'Detecting app type', weight: 4 },
  { id: 'database', label: 'Setting up database', weight: 10 },
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
  if (source.type === 'upload') {
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
  if (dbIn.mode === 'create' || dbIn.mode === 'import') {
    const engine = dbIn.engine
    if (!['postgresql', 'mysql', 'mongodb', 'sqlite'].includes(engine)) throw httpError(400, 'Choose a database engine.')
    database = { mode: dbIn.mode, engine }
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
      if (!/^[A-Za-z0-9_.-]{1,32}$/.test(dbIn.adminUser)) throw httpError(400, 'Invalid MySQL admin user.')
      database.adminUser = dbIn.adminUser
      database.adminPassword = String(dbIn.adminPassword || '')
    }
  }

  const email = String(body.sslEmail || '').trim()
  return {
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
    githubToken: body._githubToken || null,
    server
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

/**
 * Runs the pipeline. Never throws: the outcome is reported through emit({ kind: 'result' }).
 * Returns { success, url, plan, port }.
 */
export async function runDeployPipeline(cfg, emit, { host }) {
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
  const secrets = [cfg.server?.password, cfg.database.adminPassword].filter(Boolean)
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
  const warnings = []

  try {
    // ------------------------------------------------------------------ connect
    stage('connect', 'running', host.label)
    const osInfo = await query('. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME"; uname -m')
    log(`Connected. ${osInfo.replace(/\n/g, ' · ')}\n`)
    stage('connect', 'done', osInfo.split('\n')[0] || null)

    // ------------------------------------------------------------------ source
    stage('source', 'running', cfg.source.type === 'git' ? `${redactUrl(cfg.source.gitUrl)} (${cfg.source.branch})` : cfg.source.name)
    const backup = `${dir}.previous-${Date.now()}`
    if (cfg.source.type === 'git') {
      const url = withGithubToken(cfg.source.gitUrl, cfg.githubToken)
      await sh(`
set -e
export GIT_TERMINAL_PROMPT=0
if [ -d ${q(dir)}/.git ]; then
  echo "Updating existing checkout in ${dir}"
  cd ${q(dir)}
  git remote set-url origin ${q(url)}
  git fetch --prune origin ${q(cfg.source.branch)}
  git checkout -B ${q(cfg.source.branch)} FETCH_HEAD
  git reset --hard FETCH_HEAD
else
  if [ -e ${q(dir)} ]; then echo "Keeping the existing folder as ${backup}"; mv ${q(dir)} ${q(backup)}; fi
  mkdir -p /var/www
  git -c protocol.ext.allow=never clone --branch ${q(cfg.source.branch)} ${q(url)} ${q(dir)}
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
    const missing = (await query(tools.map(t => `command -v ${t} >/dev/null || echo ${t}`).join('\n'))).split('\n').filter(Boolean)
    if (missing.length) throw new Error(`The server is missing: ${missing.join(', ')}. Install ${missing.join(' and ')} on the server (e.g. apt install ${missing.map(m => ({ node: 'nodejs', npm: 'npm', python3: 'python3 python3-venv', go: 'golang', java: 'default-jdk maven', bundle: 'ruby-bundler' }[m] || m)).join(' ')}) and deploy again.`)
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
      const db = { engine, name: base, user: `${base.slice(0, 26)}_app`, password: randomPassword() }
      secrets.push(db.password)
      let remoteDump = null
      if (cfg.database.mode === 'import' && engine !== 'sqlite') {
        remoteDump = `/tmp/autodeploy-db-${crypto.randomBytes(6).toString('hex')}${cfg.database.ext}`
        log(`Uploading ${cfg.database.fileName}…\n`)
        await putFile(cfg.database.file, remoteDump)
      }
      const cat = cfg.database.ext === '.sql.gz' ? `gunzip -c ${q(remoteDump || '')}` : `cat ${q(remoteDump || '')}`

      if (engine === 'postgresql') {
        if (!await query('command -v psql')) throw new Error('PostgreSQL is not installed on the server (apt install postgresql).')
        const pg = (sql) => `runuser -u postgres -- psql -v ON_ERROR_STOP=1 -tAc ${q(sql)}`
        const exists = (await query(pg(`SELECT 1 FROM pg_database WHERE datname='${db.name}'`))).trim() === '1'
        await sh(`
set -e
${pg(`DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='${db.user}') THEN CREATE ROLE "${db.user}" LOGIN PASSWORD '${db.password}'; ELSE ALTER ROLE "${db.user}" WITH LOGIN PASSWORD '${db.password}'; END IF; END $$;`)}
${exists ? `echo "Database ${db.name} already exists — keeping its data"` : `runuser -u postgres -- createdb -O ${q(db.user)} ${q(db.name)} && echo "Created database ${db.name}"`}
`)
        if (remoteDump) {
          if (exists) { warnings.push(`Database ${db.name} already existed, so the uploaded dump was not imported (to protect existing data).`); log('Skipping import: database already has data.\n', true) }
          else if (cfg.database.format === 'pg_custom') await sh(`PGPASSWORD=${q(db.password)} pg_restore --no-owner --role=${q(db.user)} -h 127.0.0.1 -U ${q(db.user)} -d ${q(db.name)} ${q(remoteDump)} || echo "pg_restore reported warnings (see above)"`)
          else await sh(`${cat} | PGPASSWORD=${q(db.password)} psql -q -h 127.0.0.1 -U ${q(db.user)} -d ${q(db.name)} 2>&1 | grep -v '^SET$' | tail -n 50; echo "Import finished"`)
        }
        db.host = '127.0.0.1'; db.port = 5432
        db.url = `postgresql://${db.user}:${db.password}@127.0.0.1:5432/${db.name}`
      } else if (engine === 'mysql') {
        if (!await query('command -v mysql')) throw new Error('MySQL/MariaDB is not installed on the server (apt install mysql-server).')
        const admin = cfg.database.adminUser
          ? `MYSQL_PWD=${q(cfg.database.adminPassword)} mysql -u ${q(cfg.database.adminUser)}`
          : 'mysql'
        const ok = await query(`${admin} -N -e 'SELECT 1' 2>&1`)
        if (ok.trim() !== '1') throw new Error('Could not log in to MySQL as an administrator. Enter a MySQL admin user and password in the Database step (Advanced).')
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
      stage('database', 'done', `${engine} · ${db.name}`)
    }

    // ------------------------------------------------------------------ env
    stage('env', 'running')
    const envDirs = new Set([serverDir])
    if (plan.type === 'fullstack') envDirs.add(dir)
    const userEnv = parseEnv(cfg.envVars)
    const autoEnv = []
    if (port) autoEnv.push(['PORT', String(port)])
    if (['node-ssr', 'node-server', 'fullstack'].includes(plan.type)) autoEnv.push(['NODE_ENV', 'production'])
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
    for (const d of envDirs) {
      const existing = parseEnv(await query(`cat ${q(`${d}/.env`)} 2>/dev/null || cat ${q(`${d}/.env.example`)} 2>/dev/null`))
      // Order: existing/.env.example < generated values < what the user typed
      const content = mergeEnv(existing, autoEnv, userEnv)
      await sh(`echo ${b64(content)} | base64 -d > ${q(`${d}/.env`)} && chmod 600 ${q(`${d}/.env`)}`, { quiet: true })
      log(`Wrote ${d}/.env (${content.trim().split('\n').length} variables)\n`)
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
    const nodeInstall = (d) => `cd ${q(d)} && if [ -f package-lock.json ]; then npm ci --include=dev --no-audit --no-fund || npm install --include=dev --no-audit --no-fund --legacy-peer-deps; else npm install --include=dev --no-audit --no-fund --legacy-peer-deps; fi`
    const units = plan.type === 'fullstack' ? [plan.frontend, plan.backend] : [plan]
    if (['spa', 'node-ssr', 'node-server', 'fullstack'].includes(plan.type)) {
      for (const u of units) {
        log(`npm install in ${u.dir || '.'}\n`)
        await sh(nodeInstall(appDirOf(u)))
      }
    } else if (plan.type === 'php') {
      if (plan.composer) await sh(`cd ${q(dir)} && COMPOSER_ALLOW_SUPERUSER=1 composer install --no-dev --optimize-autoloader --no-interaction --no-progress`)
      if (await query(`[ -f ${q(`${dir}/package.json`)} ] && grep -q '"build"' ${q(`${dir}/package.json`)} && echo yes`)) await sh(nodeInstall(dir), { allowFailure: true })
    } else if (plan.type === 'python') {
      await sh(`
set -e
cd ${q(serverDir)}
[ -d venv ] || python3 -m venv venv
venv/bin/pip install --upgrade pip -q
if [ -f requirements.txt ]; then venv/bin/pip install -r requirements.txt; elif [ -f pyproject.toml ]; then venv/bin/pip install .; fi
venv/bin/pip install -q ${plan.uvicorn ? 'uvicorn' : 'gunicorn'}`)
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
    } else if (plan.type === 'python' && plan.django) {
      await sh(`cd ${q(serverDir)} && venv/bin/python manage.py migrate --noinput && venv/bin/python manage.py collectstatic --noinput || true`)
      built = true
    } else if (plan.type === 'go') {
      await sh(`cd ${q(serverDir)} && go build -o app .`)
      built = true
    } else if (plan.type === 'java') {
      await sh(`cd ${q(serverDir)} && ${plan.build}`)
      built = true
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
    stage('build', built ? 'done' : 'skipped', built ? null : 'No build step')

    // ------------------------------------------------------------------ service
    stage('service', 'running')
    if (needsPort) {
      let startCmd = serverUnit.start || 'npm run start'
      const sd = serverDir
      if (plan.type === 'python') {
        startCmd = plan.uvicorn
          ? `venv/bin/${startCmd.replace(/--host\s+\S+/, '').trim()} --host 127.0.0.1 --port ${port}`
          : `venv/bin/${startCmd} --bind 127.0.0.1:${port} --workers 2 --timeout 120`
      } else if (plan.type === 'java') {
        startCmd = `java -jar "$(ls -S target/*.jar build/libs/*.jar 2>/dev/null | grep -v plain | head -1)" --server.port=${port}`
      } else if (plan.type === 'ruby') {
        startCmd = `${startCmd} -p ${port}`
      }
      // Loads .env literally (values are never executed), then hands over to the app
      const runner = `cd ${sd} && if [ -f .env ]; then while IFS= read -r line || [ -n "$line" ]; do case "$line" in ''|'#'*) continue;; esac; k="\${line%%=*}"; v="\${line#*=}"; v="\${v%\\"}"; v="\${v#\\"}"; export "$k=$v"; done < .env; fi; export PORT=${port}; exec ${startCmd}`
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
    let body
    if (plan.type === 'static') {
      body = `    root ${dir}${plan.dir ? `/${plan.dir}` : ''};\n    index index.html;\n    location / { try_files $uri $uri/ =404; }`
    } else if (plan.type === 'spa') {
      body = `    root ${appDirOf(plan)}/${plan.outputDir};\n    index index.html;\n    location / { try_files $uri $uri/ /index.html; }`
    } else if (plan.type === 'fullstack') {
      body = `    root ${appDirOf(plan.frontend)}/${plan.frontend.outputDir};\n    index index.html;\n    location /api/ {\n        ${proxy(port)}\n    }\n    location /socket.io/ {\n        ${proxy(port)}\n    }\n    location / { try_files $uri $uri/ /index.html; }`
    } else if (plan.type === 'php') {
      const sock = (await query('ls /run/php/php*-fpm.sock /var/run/php/php*-fpm.sock 2>/dev/null | sort -V | tail -1')) || '/run/php/php-fpm.sock'
      if (!await query(`[ -S ${q(sock)} ] && echo yes`)) throw new Error('PHP-FPM is not running on the server (apt install php-fpm).')
      body = `    root ${dir}${plan.webRoot ? `/${plan.webRoot}` : ''};\n    index index.php index.html;\n    location / { try_files $uri $uri/ /index.php?$query_string; }\n    location ~ \\.php$ {\n        include snippets/fastcgi-php.conf;\n        fastcgi_pass unix:${sock};\n    }\n    location ~ /\\.(?!well-known) { deny all; }`
      await sh(`chown -R www-data:www-data ${q(dir)}`, { allowFailure: true, quiet: true })
    } else {
      body = `    location / {\n        ${proxy(port)}\n    }`
    }
    const conf = `${marker}\nserver {\n    listen 80;\n    listen [::]:80;\n    server_name ${cfg.domain};\n    client_max_body_size 64m;\n${body}\n}\n`
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
      const serverIp = await query(`curl -s4 --max-time 5 https://api.ipify.org || hostname -I | awk '{print $1}'`)
      const resolved = await query(`getent ahostsv4 ${q(cfg.domain)} | awk '{print $1}' | sort -u | tr '\\n' ' '`)
      if (!resolved.split(' ').includes(serverIp.trim())) {
        const msg = `${cfg.domain} does not point to this server yet (DNS: ${resolved.trim() || 'not found'}, server: ${serverIp.trim()}). Add an A record, then redeploy to get HTTPS.`
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
        database: dbInfo ? { engine: dbInfo.engine, name: dbInfo.name, user: dbInfo.user, password: dbInfo.password, url: dbInfo.url } : null,
        warnings
      }
    })
    return { success: true, url, plan, port }
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
