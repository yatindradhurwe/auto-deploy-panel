import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { execFile } from 'child_process'
import os from 'os'
import { fileURLToPath } from 'url'
import { PROVIDERS, getProvider } from './agent-providers.js'
import { readDb, getServerById } from './db.service.js'
import { getHost, q } from './host.service.js'

/**
 * Coding agent for a project (Claude, ChatGPT or Gemini — see agent-providers.js).
 *
 * A streaming tool-use loop with two tools every model gets:
 *   - str_replace_based_edit_tool: view / create / str_replace / insert
 *   - bash: an allowlisted, shell-less command runner
 * Every file operation is confined to the project root, every modified file is backed up
 * before its first change (so a session can be reverted), and nothing restarts the live
 * app — deploying is a separate, user-approved action.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, '../data')
const SESSIONS_DIR = path.join(DATA_DIR, 'agent-sessions')
const SETTINGS_FILE = path.join(DATA_DIR, 'agent-settings.json')
const KEY_FILES = { claude: '.anthropic_api_key', openai: '.openai_api_key', gemini: '.gemini_api_key' }

const MAX_TURNS_PER_PROMPT = 100
const MAX_TOOL_OUTPUT = 30000
const MAX_VIEW_CHARS = 60000
const PANEL_PM2_NAME = process.env.PANEL_PM2_NAME || 'auto-deploy-panel'

const httpError = (status, message) => Object.assign(new Error(message), { status })

// ---------------------------------------------------------------------------------------------
// Provider keys & models (server-side only; keys are never sent to the browser)
// ---------------------------------------------------------------------------------------------

function readSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) } catch { return { models: {} } }
}

function writeSettings(settings) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), { mode: 0o600 })
}

function getApiKey(id) {
  const p = getProvider(id)
  if (process.env[p.envKey]) return process.env[p.envKey]
  try { return fs.readFileSync(path.join(DATA_DIR, KEY_FILES[id]), 'utf8').trim() || null } catch { return null }
}

function getModel(id) {
  return readSettings().models?.[id] || getProvider(id).defaultModel
}

export function getAgentStatus() {
  const settings = readSettings()
  const providers = Object.values(PROVIDERS).map(p => {
    const key = getApiKey(p.id)
    return {
      id: p.id,
      label: p.label,
      configured: !!key,
      keySource: process.env[p.envKey] ? 'environment' : (key ? 'panel settings' : null),
      keyHint: key ? `…${key.slice(-4)}` : null,
      keyHelp: p.keyHelp,
      model: getModel(p.id),
      defaultModel: p.defaultModel
    }
  })
  const configured = providers.filter(p => p.configured)
  const preferred = settings.defaultProvider
  return {
    providers,
    defaultProvider: configured.some(p => p.id === preferred) ? preferred : (configured[0]?.id || null),
    // kept for older clients
    configured: configured.length > 0
  }
}

/** Saves a provider's key and/or model. An empty key removes the stored key. */
export function updateProviderSettings({ provider, apiKey, model, makeDefault }) {
  const p = getProvider(provider)
  if (apiKey !== undefined) {
    apiKey = String(apiKey || '').trim()
    const file = path.join(DATA_DIR, KEY_FILES[p.id])
    if (!apiKey) {
      try { fs.unlinkSync(file) } catch { /* already gone */ }
    } else {
      if (!p.keyPattern.test(apiKey)) throw httpError(400, `That does not look like a ${p.label} API key (${p.keyHelp}).`)
      fs.mkdirSync(DATA_DIR, { recursive: true })
      fs.writeFileSync(file, apiKey, { mode: 0o600 })
    }
  }
  const settings = readSettings()
  settings.models ||= {}
  if (model !== undefined) {
    model = String(model || '').trim()
    if (model && !/^[A-Za-z0-9._:\/-]{2,80}$/.test(model)) throw httpError(400, 'Invalid model name.')
    if (model && model !== p.defaultModel) settings.models[p.id] = model
    else delete settings.models[p.id]
  }
  if (makeDefault) settings.defaultProvider = p.id
  writeSettings(settings)
  return getAgentStatus()
}

// Back-compat for the earlier Claude-only endpoint
export function setApiKey(apiKey) {
  return updateProviderSettings({ provider: 'claude', apiKey })
}

// ---------------------------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------------------------

const running = new Map() // sessionId -> { controller, child }

const sessionFile = (id) => path.join(SESSIONS_DIR, `${id}.json`)
const backupDir = (id) => path.join(SESSIONS_DIR, `${id}.backups`)

function assertSessionId(id) {
  if (!/^ses_[a-f0-9]{24}$/.test(String(id || ''))) throw httpError(400, 'Invalid session id.')
}

function loadSession(id) {
  assertSessionId(id)
  try {
    return JSON.parse(fs.readFileSync(sessionFile(id), 'utf8'))
  } catch {
    throw httpError(404, 'Agent session not found.')
  }
}

function saveSession(s) {
  s.updatedAt = new Date().toISOString()
  fs.mkdirSync(SESSIONS_DIR, { recursive: true })
  const tmp = `${sessionFile(s.id)}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(s), { mode: 0o600 })
  fs.renameSync(tmp, sessionFile(s.id))
}

/** The executor for the server a session's project lives on. */
function hostOf(session) {
  if (!session.serverId) return getHost(null)
  const server = getServerById(session.serverId)
  if (!server) throw httpError(404, 'The server this conversation belongs to was removed.')
  return getHost(server)
}

async function pm2AppsFor(host, root) {
  const { stdout } = await host.exec('pm2 jlist 2>/dev/null', { timeout: 20000 })
  try {
    const line = stdout.split('\n').find(l => l.trim().startsWith('['))
    return JSON.parse(line || '[]')
      .map(p => ({ name: p.name, cwd: p.pm2_env?.pm_cwd, status: p.pm2_env?.status }))
      .filter(p => p.cwd && (p.cwd === root || p.cwd.startsWith(root + '/')))
  } catch {
    return []
  }
}

/** Facts about the project that go into the (cached) system prompt — one round trip. */
async function describeProject(host, root) {
  const pkgFiles = ['package.json', 'frontend/package.json', 'backend/package.json', 'server/package.json', 'client/package.json']
  const markers = ['composer.json', 'requirements.txt', 'pyproject.toml', 'index.html', 'Dockerfile', '.git']
  const { stdout } = await host.exec(
    pkgFiles.map(f => `[ -f ${q(f)} ] && { echo "@@PKG ${f}"; head -c 65536 ${q(f)}; echo; }`).join('\n') + '\n' +
    markers.map(f => `[ -e ${q(f)} ] && echo "@@HAS ${f}"`).join('\n'),
    { cwd: root, timeout: 20000 }
  )
  const facts = []
  for (const block of stdout.split('@@PKG ').slice(1)) {
    const rel = block.split('\n')[0].trim()
    try {
      const pkg = JSON.parse(block.slice(block.indexOf('\n') + 1).split('@@HAS')[0])
      const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
      const notable = deps.filter(d => /^(react|next|vue|nuxt|svelte|@sveltejs\/kit|vite|express|fastify|@nestjs\/core|tailwindcss|typescript|prisma|mongoose|sequelize|pg|mysql2|astro)$/.test(d))
      facts.push(`- ${rel}: scripts ${JSON.stringify(pkg.scripts || {})}${notable.length ? `; uses ${notable.join(', ')}` : ''}`)
    } catch { /* unreadable package.json */ }
  }
  const has = new Set([...stdout.matchAll(/^@@HAS (.+)$/gm)].map(m => m[1].trim()))
  for (const f of markers.filter(m => m !== '.git')) if (has.has(f)) facts.push(`- has ${f}`)
  facts.push(has.has('.git') ? '- git repository' : '- not a git repository')
  const apps = await pm2AppsFor(host, root)
  if (apps.length) facts.push(`- runs under PM2 as: ${apps.map(a => `${a.name} (cwd ${a.cwd}, ${a.status})`).join('; ')}`)
  if (!host.isLocal) facts.push(`- server: ${host.label} (a connected remote server)`)
  return facts.join('\n')
}

function buildSystemPrompt(projectName, root, facts) {
  return `You are an expert software engineer working directly on a live project on its production server, the way a coding agent like Claude Code works in a developer's repository. The user describes what they want changed in their website or web app; you investigate the code, make the change, and verify it.

# Project
Name: ${projectName}
Root: ${root} (this is your working directory; every path you use must be inside it)
${facts}

# Tools
- str_replace_based_edit_tool: view files/directories, create files, str_replace exact text, insert lines. Always view a file before editing it, and keep str_replace edits small and unique.
- bash: runs ONE command in the project root WITHOUT a shell — no pipes, redirects, &&, ;, $(), globs or environment assignments. Allowed programs: ls, cat, head, tail, wc, grep, rg, find, tree, pwd, stat, file, diff, du, echo, git (read-only subcommands), npm (run/test/install/ci/ls/outdated/audit/view), npx (tsc, eslint, prettier, vite, next, jest, vitest, tailwindcss, astro, nuxt, svelte-check, vue-tsc), node (scripts only, no -e), php -l, python3 -m (py_compile|compileall|pytest), composer (install/dump-autoload/validate/show), curl (GET to localhost only). Commands time out (5 min for npm/npx/composer, 1 min otherwise).

# How to work
1. Explore first: find the files that actually implement what the user is talking about (grep, find, view) before changing anything. Follow the project's existing structure, framework, naming and style.
2. Make focused changes that do what was asked — no unrelated refactors, renames or reformatting. Prefer editing existing files over creating new ones.
3. Verify your work with whatever the project offers: a build, type-check, linter or tests (check package.json scripts), or node --check / php -l for single files. If verification fails because of your change, fix it. If it was already failing before your change, say so.
4. Building a frontend can update what the live site serves (static builds are served directly). That is expected — but never restart, stop or deploy server processes yourself: the user deploys with a separate button after reviewing your changes. You cannot run pm2, systemctl, git commit/push or anything that touches other projects on this server.
5. Never print or copy secrets from .env files into your replies. Edit .env only when the user asks for a configuration change.
6. If the request is ambiguous in a way that changes what you would build, ask one short question instead of guessing. Otherwise proceed without asking for permission.
7. Finish with a short summary for a non-specialist: what you changed (file by file), how you verified it, and anything the user must do next (for example, "Deploy to restart the backend").`
}

export async function createSession(projectPath, projectName, providerId, server = null) {
  const provider = getProvider(providerId || getAgentStatus().defaultProvider || 'claude')
  if (!getApiKey(provider.id)) throw httpError(400, `No ${provider.label} API key configured. Add one in the agent settings.`)
  const host = getHost(server)
  const root = await host.realpath(projectPath)
  const facts = await describeProject(host, root)
  const session = {
    id: `ses_${crypto.randomBytes(12).toString('hex')}`,
    serverId: host.isLocal ? null : server.id,
    serverName: host.label,
    provider: provider.id,
    model: getModel(provider.id),
    projectPath: root,
    projectName: projectName || path.basename(root),
    system: buildSystemPrompt(projectName || path.basename(root), root, facts),
    createdAt: new Date().toISOString(),
    messages: [],
    transcript: [],
    changes: {},
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    status: 'idle',
    title: null
  }
  saveSession(session)
  return publicSession(session)
}

// Only Claude's prices are known here; other providers show token counts only
function costOf(s) {
  const price = PROVIDERS[s.provider || 'claude']?.price
  if (!price || (s.model && s.model !== PROVIDERS[s.provider || 'claude'].defaultModel)) return null
  const u = s.usage
  return Number(((u.input * price.input + u.output * price.output + u.cacheRead * price.cacheRead + u.cacheWrite * price.cacheWrite) / 1e6).toFixed(4))
}

const providerOf = (s) => PROVIDERS[s.provider || 'claude']

function publicSession(s) {
  return {
    id: s.id,
    provider: s.provider || 'claude',
    providerLabel: providerOf(s).label,
    model: s.model || providerOf(s).defaultModel,
    projectPath: s.projectPath,
    projectName: s.projectName,
    serverId: s.serverId || null,
    serverName: s.serverName || null,
    title: s.title,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    status: running.has(s.id) ? 'running' : (s.status === 'running' ? 'interrupted' : s.status),
    transcript: s.transcript,
    changedFiles: Object.entries(s.changes).map(([file, c]) => ({ file, created: c.created })),
    usage: { ...s.usage, costUsd: costOf(s) }
  }
}

export function getSession(id) {
  return publicSession(loadSession(id))
}

export function listSessions(projectPath, serverId = null) {
  const root = path.posix.resolve(projectPath)
  let files = []
  try { files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json')) } catch { return [] }
  return files
    .map(f => { try { return JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf8')) } catch { return null } })
    .filter(s => s && s.projectPath === root && (s.serverId || null) === (serverId || null))
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    .slice(0, 30)
    .map(s => ({ id: s.id, provider: s.provider || 'claude', providerLabel: providerOf(s).label, title: s.title || 'New session', updatedAt: s.updatedAt, changedFiles: Object.keys(s.changes).length, status: running.has(s.id) ? 'running' : s.status }))
}

export function deleteSession(id) {
  const s = loadSession(id)
  if (running.has(id)) throw httpError(409, 'Stop the agent before deleting this session.')
  fs.rmSync(sessionFile(s.id), { force: true })
  fs.rmSync(backupDir(s.id), { recursive: true, force: true })
  return { message: 'Session deleted. File changes it made were kept.' }
}

// ---------------------------------------------------------------------------------------------
// Path confinement
// ---------------------------------------------------------------------------------------------

/** Resolves a model-supplied path and guarantees it stays inside root (symlinks included). */
export async function confine(host, root, p) {
  if (typeof p !== 'string' || !p.trim()) throw new Error('A path is required.')
  if (/%2e|%2f|\0/i.test(p)) throw new Error('Encoded or null characters are not allowed in paths.')
  const target = path.posix.resolve(root, p)
  // Canonicalize the deepest existing ancestor on the server so symlinks cannot point outside the root
  const { stdout } = await host.exec(`p=${q(target)}; while [ ! -e "$p" ] && [ "$p" != / ]; do p=$(dirname "$p"); done; echo "$p"; realpath -e "$p"`, { timeout: 15000 })
  const [existing, realExisting] = stdout.trim().split('\n')
  const real = path.posix.join(realExisting || existing || target, path.posix.relative(existing || target, target))
  const rel = path.posix.relative(root, real)
  if (rel === '..' || rel.startsWith('../') || path.posix.isAbsolute(rel)) {
    throw new Error(`Path is outside the project root (${root}).`)
  }
  return { abs: real, rel: rel || '.' }
}

function assertWritable(rel) {
  const parts = rel.split('/')
  if (parts.includes('.git')) throw new Error('Editing inside .git is not allowed.')
  if (parts.includes('node_modules')) throw new Error('Editing node_modules is not allowed — change the source or package.json instead.')
}

// ---------------------------------------------------------------------------------------------
// Text editor tool
// ---------------------------------------------------------------------------------------------

const SKIP_DIRS = ['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', 'vendor', '.cache', 'coverage', '__pycache__']

async function listDir(host, abs, rel) {
  const prune = SKIP_DIRS.map(n => `-name ${q(n)}`).join(' -o ')
  const { stdout } = await host.exec(`find . -mindepth 1 -maxdepth 2 \\( ${prune} -o -name '.*' \\) -prune -printf '%P/\\n' -o -type d -printf '%P/\\n' -o -printf '%P\\n' 2>/dev/null | sort | head -n 500`, { cwd: abs, timeout: 20000 })
  const out = stdout.split('\n').filter(Boolean)
  return `Directory ${rel} (2 levels; node_modules, .git, build output not expanded):\n${out.join('\n')}${out.length >= 500 ? '\n… (truncated)' : ''}`
}

async function backupBeforeWrite(host, session, abs, rel) {
  if (session.changes[rel]) return
  const existed = await host.exists(abs)
  const entry = { created: !existed, backup: null }
  if (existed) {
    const name = crypto.createHash('sha1').update(rel).digest('hex')
    fs.mkdirSync(backupDir(session.id), { recursive: true })
    fs.writeFileSync(path.join(backupDir(session.id), name), await host.readFile(abs, { encoding: null }))
    entry.backup = name
  }
  session.changes[rel] = entry
}

function snippet(content, index, length) {
  const lines = content.split('\n')
  const startLine = content.slice(0, index).split('\n').length
  const endLine = startLine + content.slice(index, index + length).split('\n').length - 1
  const from = Math.max(1, startLine - 3)
  const to = Math.min(lines.length, endLine + 3)
  return lines.slice(from - 1, to).map((l, i) => `${from + i}\t${l}`).join('\n')
}

export async function runEditor(session, input, host = hostOf(session)) {
  const root = session.projectPath
  const { command } = input || {}
  const { abs, rel } = await confine(host, root, input?.path)

  if (command === 'view') {
    const st = await host.stat(abs)
    if (!st) throw new Error(`${rel} does not exist.`)
    if (st.isDirectory) return listDir(host, abs, rel)
    if (st.size > 20 * 1024 * 1024) return `${rel} is too large to view (${Math.round(st.size / 1048576)} MB).`
    const buf = await host.readFile(abs, { encoding: null })
    if (buf.includes(0)) return `${rel} is a binary file (${buf.length} bytes).`
    const lines = buf.toString('utf8').split('\n')
    let [start, end] = Array.isArray(input.view_range) ? input.view_range : [1, lines.length]
    start = Math.max(1, Number(start) || 1)
    end = Number(end) === -1 || !end ? lines.length : Math.min(lines.length, Number(end))
    let text = lines.slice(start - 1, end).map((l, i) => `${start + i}\t${l}`).join('\n')
    if (text.length > MAX_VIEW_CHARS) text = text.slice(0, MAX_VIEW_CHARS) + `\n… (truncated — use view_range to read lines beyond this point; file has ${lines.length} lines)`
    return text
  }

  assertWritable(rel)

  if (command === 'create') {
    if (typeof input.file_text !== 'string') throw new Error('file_text is required.')
    await backupBeforeWrite(host, session, abs, rel)
    await host.mkdir(path.posix.dirname(abs))
    await host.writeFile(abs, input.file_text)
    return `Wrote ${rel} (${input.file_text.split('\n').length} lines).`
  }

  if (command === 'str_replace') {
    if (!await host.exists(abs)) throw new Error(`${rel} does not exist.`)
    if (typeof input.old_str !== 'string' || !input.old_str) throw new Error('old_str is required.')
    const content = await host.readFile(abs)
    const count = content.split(input.old_str).length - 1
    if (count === 0) throw new Error(`No match for old_str in ${rel}. View the file and copy the text exactly, including whitespace.`)
    if (count > 1) throw new Error(`old_str matches ${count} places in ${rel}; include more surrounding lines so it is unique.`)
    const idx = content.indexOf(input.old_str)
    const newStr = typeof input.new_str === 'string' ? input.new_str : ''
    await backupBeforeWrite(host, session, abs, rel)
    const updated = content.slice(0, idx) + newStr + content.slice(idx + input.old_str.length)
    await host.writeFile(abs, updated)
    return `Edited ${rel}:\n${snippet(updated, idx, newStr.length)}`
  }

  if (command === 'insert') {
    if (!await host.exists(abs)) throw new Error(`${rel} does not exist.`)
    const content = await host.readFile(abs)
    const lines = content.split('\n')
    const at = Number(input.insert_line)
    if (!Number.isInteger(at) || at < 0 || at > lines.length) throw new Error(`insert_line must be between 0 and ${lines.length}.`)
    const text = String(input.insert_text ?? input.new_str ?? '')
    await backupBeforeWrite(host, session, abs, rel)
    lines.splice(at, 0, ...text.split('\n'))
    await host.writeFile(abs, lines.join('\n'))
    return `Inserted ${text.split('\n').length} line(s) after line ${at} of ${rel}.`
  }

  throw new Error(`Unknown command '${command}'. Use view, create, str_replace or insert.`)
}

// ---------------------------------------------------------------------------------------------
// Bash tool (shell-less, allowlisted)
// ---------------------------------------------------------------------------------------------

/** Splits a command line like a shell would, but rejects every shell operator. */
export function splitCommand(cmd) {
  const args = []
  let cur = ''
  let quote = null
  let has = false
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]
    if (quote) {
      if (c === quote) quote = null
      else if (c === '\\' && quote === '"' && i + 1 < cmd.length) cur += cmd[++i]
      else cur += c
      continue
    }
    if (c === "'" || c === '"') { quote = c; has = true; continue }
    if (c === '\\' && i + 1 < cmd.length) { cur += cmd[++i]; has = true; continue }
    if (/\s/.test(c)) {
      if (c === '\n') throw new Error('Run one command at a time (no newlines).')
      if (has) { args.push(cur); cur = ''; has = false }
      continue
    }
    if ('|&;<>()$`'.includes(c)) throw new Error(`Shell operator '${c}' is not supported — commands run without a shell. Run one plain command at a time.`)
    if ('*?'.includes(c)) throw new Error(`Glob '${c}' is not expanded (no shell). Use find or grep options instead.`)
    cur += c
    has = true
  }
  if (quote) throw new Error('Unterminated quote.')
  if (has) args.push(cur)
  return args
}

const READ_ONLY = new Set(['ls', 'cat', 'head', 'tail', 'wc', 'grep', 'rg', 'tree', 'pwd', 'stat', 'file', 'diff', 'du', 'echo'])
const GIT_SUBCOMMANDS = new Set(['status', 'diff', 'log', 'show', 'ls-files', 'grep', 'blame', 'branch', 'rev-parse'])
const NPM_SUBCOMMANDS = new Set(['run', 'run-script', 'test', 't', 'install', 'i', 'ci', 'ls', 'list', 'outdated', 'audit', 'view', 'info'])
const NPX_TOOLS = new Set(['tsc', 'eslint', 'prettier', 'vite', 'next', 'jest', 'vitest', 'tailwindcss', 'astro', 'nuxt', 'svelte-check', 'vue-tsc'])
const FIND_DENY = new Set(['-exec', '-execdir', '-delete', '-ok', '-okdir', '-fprint', '-fprint0', '-fprintf', '-fls'])
const NODE_DENY = new Set(['-e', '--eval', '-p', '--print', '-i', '--interactive', '-r', '--require', '--import', '--inspect', '--inspect-brk'])

/** Returns { argv, timeoutMs } or throws with a message Claude can act on. */
export async function validateCommand(root, argv, host = getHost(null)) {
  const [prog, ...rest] = argv
  if (!prog) throw new Error('Empty command.')
  if (prog.includes('/')) throw new Error('Call programs by name (e.g. npm, git), not by path.')
  let timeoutMs = 60000

  if (READ_ONLY.has(prog)) {
    // ok
  } else if (prog === 'find') {
    const bad = rest.find(a => FIND_DENY.has(a))
    if (bad) throw new Error(`find ${bad} is not allowed.`)
  } else if (prog === 'git') {
    const sub = rest.find(a => !a.startsWith('-'))
    if (!GIT_SUBCOMMANDS.has(sub)) throw new Error(`git ${sub || ''} is not allowed. Allowed: ${[...GIT_SUBCOMMANDS].join(', ')}. Commits happen when the user deploys.`)
    if (sub === 'branch' && rest.some(a => /^-(d|D|m|M|c|C|f)$|^--(delete|move|copy|force|set-upstream)/.test(a))) throw new Error('Only listing branches is allowed.')
    if (rest.some(a => /^--output|^-o$|^--ext-diff/.test(a))) throw new Error('That git option is not allowed.')
  } else if (prog === 'npm') {
    if (!NPM_SUBCOMMANDS.has(rest[0])) throw new Error(`npm ${rest[0] || ''} is not allowed. Allowed: ${[...NPM_SUBCOMMANDS].join(', ')}.`)
    if (rest.includes('-g') || rest.includes('--global') || rest.some(a => a.startsWith('--prefix'))) throw new Error('Global installs are not allowed.')
    timeoutMs = 300000
  } else if (prog === 'npx') {
    const tool = rest.find(a => !a.startsWith('-'))
    if (!NPX_TOOLS.has(tool)) throw new Error(`npx ${tool || ''} is not allowed. Allowed: ${[...NPX_TOOLS].join(', ')} (must already be installed in the project).`)
    argv = ['npx', '--no-install', ...rest]
    timeoutMs = 300000
  } else if (prog === 'node') {
    const bad = rest.find(a => NODE_DENY.has(a) || a.startsWith('--eval=') || a.startsWith('--require=') || a.startsWith('--import='))
    if (bad) throw new Error(`node ${bad} is not allowed — write a script file in the project and run it instead.`)
  } else if (prog === 'php') {
    if (rest[0] !== '-l') throw new Error('Only php -l <file> (syntax check) is allowed.')
  } else if (prog === 'python3' || prog === 'python') {
    if (rest[0] !== '-m' || !['py_compile', 'compileall', 'pytest'].includes(rest[1])) throw new Error('Only python3 -m py_compile|compileall|pytest is allowed.')
    timeoutMs = 300000
  } else if (prog === 'composer') {
    if (!['install', 'dump-autoload', 'validate', 'show'].includes(rest[0])) throw new Error('composer install|dump-autoload|validate|show only.')
    timeoutMs = 300000
  } else if (prog === 'curl') {
    const urls = rest.filter(a => /^https?:\/\//i.test(a))
    if (!urls.length || urls.some(u => !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(u))) throw new Error('curl may only request http://localhost or http://127.0.0.1.')
    if (rest.some(a => /^-(o|O|T|d|F|K|X)$|^--(output|upload-file|data|form|config|request)/.test(a) && !/^-X$/.test(a))) throw new Error('Only plain GET requests are allowed with curl.')
    if (rest.includes('-X')) throw new Error('Only plain GET requests are allowed with curl.')
  } else {
    throw new Error(`'${prog}' is not an allowed program. See the tool rules in your instructions.`)
  }

  // Any argument naming an existing path outside the project is refused (resolved on the server)
  const candidates = []
  for (const a of rest) {
    if (prog === 'curl' && /^https?:/i.test(a)) continue
    const candidate = a.includes('=') && a.startsWith('-') ? a.split('=').slice(1).join('=') : a
    if (!(candidate.startsWith('/') || candidate.startsWith('~') || candidate.split(/[\\/]/).includes('..'))) continue
    candidates.push([a, path.posix.resolve(root, candidate.replace(/^~/, '/root'))])
  }
  if (candidates.length) {
    const { stdout } = await host.exec(candidates.map(([, p]) => `realpath -e ${q(p)} 2>/dev/null || echo -`).join('\n'), { timeout: 15000 })
    const reals = stdout.split('\n')
    candidates.forEach(([a], i) => {
      const real = (reals[i] || '-').trim()
      if (real !== '-' && real !== root && !real.startsWith(root + '/')) throw new Error(`'${a}' is outside the project root.`)
    })
  }
  return { argv, timeoutMs }
}

function truncateOutput(text) {
  if (text.length <= MAX_TOOL_OUTPUT) return text
  return text.slice(0, 10000) + `\n\n… (${text.length - MAX_TOOL_OUTPUT} characters omitted) …\n\n` + text.slice(-20000)
}

// Child processes never see the panel's own secrets (JWT secret, API keys, DB passwords)
function childEnv() {
  return {
    PATH: process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    HOME: process.env.HOME || '/root',
    LANG: 'C.UTF-8',
    TERM: 'dumb',
    CI: '1',
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    npm_config_yes: 'false',
    npm_config_audit: 'false',
    npm_config_fund: 'false'
  }
}

async function runBash(session, input, state, host = hostOf(session)) {
  if (input?.restart) return 'Shell restarted. (Each command already runs in a fresh process in the project root.)'
  const root = session.projectPath
  const { argv, timeoutMs } = await validateCommand(root, splitCommand(String(input?.command || '').trim()), host)
  // On the panel host the command gets a clean environment (no panel secrets); remote servers use their own
  const r = await host.exec(argv.map(q).join(' ') + ' 2>&1', {
    cwd: root,
    timeout: timeoutMs,
    signal: state.controller.signal,
    ...(host.isLocal ? { env: childEnv() } : {})
  })
  return `${truncateOutput((r.stdout + r.stderr).trimEnd())}\n[exit code ${r.code}]`.trim()
}

// ---------------------------------------------------------------------------------------------
// The agent loop
// ---------------------------------------------------------------------------------------------

function describeToolCall(name, input) {
  if (name === 'bash') return input?.restart ? 'restart shell' : String(input?.command || '')
  const cmd = input?.command
  const p = input?.path || ''
  if (cmd === 'view') return `view ${p}${Array.isArray(input.view_range) ? ` [${input.view_range.join('-')}]` : ''}`
  return `${cmd} ${p}`
}

/**
 * Runs one user prompt to completion. `emit` receives UI events; the conversation is
 * persisted after every model turn so a dropped connection loses nothing.
 */
export async function runPrompt(sessionId, prompt, emit = () => {}) {
  const session = loadSession(sessionId)
  if (running.has(sessionId)) throw httpError(409, 'The agent is already working in this session.')
  prompt = String(prompt || '').trim()
  if (!prompt) throw httpError(400, 'Prompt is empty.')
  const provider = providerOf(session)
  const apiKey = getApiKey(provider.id)
  if (!apiKey) throw httpError(400, `No ${provider.label} API key configured. Add one in the agent settings.`)
  const model = session.model || provider.defaultModel

  const host = hostOf(session)
  const controller = new AbortController()
  const state = { controller }
  running.set(sessionId, state)

  const push = (ev) => {
    session.transcript.push({ ...ev, at: new Date().toISOString() })
    emit(ev)
  }

  if (!session.title) session.title = prompt.slice(0, 80)
  session.status = 'running'
  session.messages.push(provider.userMessage(prompt))
  push({ type: 'user', text: prompt })
  saveSession(session)

  let turns = 0
  try {
    while (true) {
      if (++turns > MAX_TURNS_PER_PROMPT) {
        push({ type: 'error', text: `Stopped after ${MAX_TURNS_PER_PROMPT} steps. Send "continue" to keep going.` })
        break
      }

      const turn = await provider.step({ apiKey, model, system: session.system, messages: session.messages, emit, signal: controller.signal })

      for (const k of ['input', 'output', 'cacheRead', 'cacheWrite']) session.usage[k] += turn.usage[k] || 0
      for (const t of turn.thoughts) push({ type: 'thinking', text: t })
      for (const t of turn.texts) push({ type: 'assistant', text: t })

      if (turn.stop === 'refusal') {
        // Output of a declined turn is discarded, never replayed
        push({ type: 'error', text: `${provider.label} declined this request${turn.detail ? ` (${turn.detail})` : ''}. Try rephrasing it.` })
        break
      }
      if (turn.stop === 'max_tokens') {
        push({ type: 'error', text: 'The response was cut off while writing a tool call. Send "continue" and ask for smaller edits.' })
        break
      }
      if (turn.stop === 'empty') {
        push({ type: 'error', text: `${provider.label} returned an empty response${turn.detail ? ` (${turn.detail})` : ''}. Send "continue" to retry.` })
        break
      }

      // Appended exactly as returned (provider-native format)
      if (turn.assistantMessage) session.messages.push(turn.assistantMessage)
      if (turn.stop === 'pause') { saveSession(session); continue }
      if (turn.stop !== 'tool_use') break

      const results = []
      for (const call of turn.toolCalls) {
        const summary = describeToolCall(call.name, call.input)
        if (controller.signal.aborted) {
          results.push({ output: 'Interrupted by the user before this ran.', isError: true })
          continue
        }
        emit({ type: 'tool_start', id: call.id, name: call.name, summary })
        let output
        let isError = false
        try {
          if (call.parseError !== undefined) throw new Error(`Tool arguments were not valid JSON: ${String(call.parseError).slice(0, 500)}`)
          if (call.name === 'bash') output = await runBash(session, call.input, state, host)
          else if (call.name === 'str_replace_based_edit_tool') output = await runEditor(session, call.input, host)
          else throw new Error(`Unknown tool ${call.name}`)
        } catch (err) {
          output = `Error: ${err.message}`
          isError = true
        }
        results.push({ output, isError })
        const changed = call.name === 'str_replace_based_edit_tool' && call.input?.command !== 'view' && !isError
        push({ type: 'tool', id: call.id, name: call.name, summary, output: output.slice(0, 4000), isError, changed })
      }
      session.messages.push(...provider.toolResultsMessage(turn.toolCalls, results))
      saveSession(session)
      if (controller.signal.aborted) break
    }
  } catch (err) {
    if (controller.signal.aborted || provider.isAbort(err)) push({ type: 'error', text: 'Stopped by user.' })
    else push({ type: 'error', text: provider.describeError(err) || `Agent error: ${err.message}` })
  } finally {
    // The history must never end on tool calls without results
    const pending = provider.pendingToolCalls(session.messages[session.messages.length - 1])
    if (pending.length) {
      session.messages.push(...provider.toolResultsMessage(pending, pending.map(() => ({ output: 'Interrupted by the user before this ran.', isError: true }))))
    }
    running.delete(sessionId)
    session.status = 'idle'
    push({ type: 'done', usage: { ...session.usage, costUsd: costOf(session) }, changedFiles: Object.keys(session.changes) })
    saveSession(session)
  }
}

export function stopSession(id) {
  assertSessionId(id)
  const state = running.get(id)
  if (!state) return { message: 'The agent is not running.' }
  state.controller.abort()
  return { message: 'Stopping…' }
}

// ---------------------------------------------------------------------------------------------
// Review, revert, deploy
// ---------------------------------------------------------------------------------------------

export async function getChanges(id) {
  const s = loadSession(id)
  const host = hostOf(s)
  const files = []
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-diff-'))
  try {
    for (const [rel, c] of Object.entries(s.changes)) {
      const abs = path.posix.join(s.projectPath, rel)
      const exists = await host.exists(abs)
      let after = '/dev/null'
      if (exists) {
        after = path.join(tmpDir, crypto.createHash('sha1').update(rel).digest('hex'))
        fs.writeFileSync(after, await host.readFile(abs, { encoding: null }))
      }
      const before = c.backup ? path.join(backupDir(s.id), c.backup) : '/dev/null'
      const stdout = await new Promise(resolve => execFile('diff', ['-u', '--label', `a/${rel}`, '--label', `b/${rel}`, before, after], { maxBuffer: 16 * 1024 * 1024 }, (err, out) => resolve(out || '')))
      files.push({ file: rel, status: !exists ? 'deleted' : c.created ? 'added' : 'modified', diff: stdout.length > 200000 ? stdout.slice(0, 200000) + '\n… (diff truncated)' : stdout })
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
  return { files }
}

export async function revertChanges(id, file = null) {
  const s = loadSession(id)
  if (running.has(id)) throw httpError(409, 'Stop the agent before reverting.')
  const host = hostOf(s)
  const targets = file ? [file] : Object.keys(s.changes)
  for (const rel of targets) {
    const c = s.changes[rel]
    if (!c) throw httpError(404, `${rel} was not changed in this session.`)
    const { abs } = await confine(host, s.projectPath, rel)
    if (c.created) await host.rm(abs)
    else await host.writeFile(abs, fs.readFileSync(path.join(backupDir(s.id), c.backup)))
    delete s.changes[rel]
  }
  s.transcript.push({ type: 'system', text: file ? `Reverted ${file}.` : `Reverted all ${targets.length} changed file(s).`, at: new Date().toISOString() })
  // Tell the model on the next turn so its picture of the files stays accurate
  s.messages.push(providerOf(s).noticeMessage(`[Panel notice] The user reverted your changes to: ${targets.join(', ')}. Those files are back to their state before this session.`))
  saveSession(s)
  return { message: `Reverted ${targets.length} file(s).`, session: publicSession(s) }
}

/**
 * The user-approved step: optionally commit the session's files, then restart the
 * project's PM2 app(s) so backend changes go live.
 */
export async function deploySession(id, { commit = false, commitMessage = '' } = {}) {
  const s = loadSession(id)
  if (running.has(id)) throw httpError(409, 'Wait for the agent to finish before deploying.')
  const host = hostOf(s)
  const log = []
  const root = s.projectPath

  if (commit && Object.keys(s.changes).length) {
    if (!await host.exists(`${root}/.git`)) {
      log.push('Not a git repository — skipped commit.')
    } else {
      const files = Object.keys(s.changes)
      const add = await host.run('git', ['add', '-A', '--', ...files], { cwd: root })
      const msg = String(commitMessage || s.title || 'Update via AI agent').slice(0, 200)
      const res = add.code === 0 ? await host.run('git', ['-c', 'user.name=AutoDeploy AI Agent', '-c', 'user.email=agent@autodeploy.local', 'commit', '-m', msg, '--', ...files], { cwd: root }) : add
      log.push(res.code === 0 ? `Committed ${files.length} file(s): ${msg}` : `Commit failed: ${(res.stderr || res.stdout).trim()}`)
    }
  }

  const apps = await pm2AppsFor(host, root)
  if (!apps.length) {
    log.push('No PM2 process runs from this project, so nothing needed restarting (static sites are live as soon as files/builds change).')
  }
  let restartPanel = false
  for (const app of apps) {
    if (host.isLocal && app.name === PANEL_PM2_NAME) { restartPanel = true; continue }
    const res = await host.run('pm2', ['restart', app.name, '--update-env'], { timeout: 60000 })
    log.push(res.code === 0 ? `Restarted ${app.name}${host.isLocal ? '' : ` on ${host.label}`}.` : `Restart of ${app.name} failed: ${(res.stderr || res.stdout).trim().slice(0, 500)}`)
  }
  if (restartPanel) {
    // Restarting the panel kills this request — answer first, restart a moment later
    setTimeout(() => execFile('pm2', ['restart', PANEL_PM2_NAME]), 1500)
    log.push('The panel itself will restart in a few seconds — reload the page afterwards.')
  }

  s.transcript.push({ type: 'system', text: `Deploy: ${log.join(' ')}`, at: new Date().toISOString() })
  saveSession(s)
  return { message: log.join('\n'), log }
}
