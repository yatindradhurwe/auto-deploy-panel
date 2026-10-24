import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import { readDb, writeDb, getUserById, getOrganizationById, getOrganizationMembers, getServerById } from './db.service.js'
import { getPlatformRole, getUserStatus, getPlatformSettings } from './admin.service.js'
import { getHost } from './host.service.js'
import { projectLevel, hasLevel, isPlatformHost, isSuperSession, isOrgAdmin, normalizeProjectPath } from './project-access.service.js'
import { runEditor, runBash, confine, splitCommand, describeProject, pm2AppsFor, childEnv } from './project-agent.service.js'

/**
 * MCP (Model Context Protocol) server for a project, so Claude Code, Claude Desktop, Cursor or any
 * other MCP client can work on it with the user's own AI.
 *
 * A user who manages a project generates an access token for it; the client then talks JSON-RPC to
 * POST /api/mcp (Streamable HTTP transport) with `Authorization: Bearer <token>`.
 *
 * The tools are the ones the panel's own AI agent uses (project-agent.service.js): every path is
 * confined to the project root, commands are allowlisted and shell-less, and each file is backed up
 * before its first change through the token. Access is re-checked on every request, so suspending the
 * user, removing them from the organization or revoking their share stops the token at once.
 *
 * Access levels:
 *  - 'read'  view files, run read-only commands (ls, grep, git log…), read app logs
 *  - 'edit'  + create/edit files, run builds, tests and installs, undo its own changes
 *  - 'full'  + restart the project's PM2 app(s)
 *
 * A token can instead cover the whole server (scope 'server'), for organization owners/admins on
 * their own servers and super admins on any server, the panel host included. Paths and PM2 apps are
 * then not confined to one project, and 'full' adds run_shell: any shell command as the SSH user
 * (root on most servers), with no allowlist.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Next to the database, so tests on a temp database (AUTODEPLOY_DB_PATH) never touch live data
const MCP_DIR = process.env.AUTODEPLOY_DB_PATH ? path.join(path.dirname(process.env.AUTODEPLOY_DB_PATH), 'mcp') : path.resolve(__dirname, '../data/mcp')
const PANEL_PM2_NAME = process.env.PANEL_PM2_NAME || 'auto-deploy-panel'

export const MCP_ACCESS = ['read', 'edit', 'full']
export const MCP_SCOPES = ['project', 'server']
const ACCESS_RANK = { read: 1, edit: 2, full: 3 }
const TOKEN_PREFIX = 'adpmcp_'
const MAX_TOKENS_PER_PROJECT = 20
const SERVER_ROOT = '/'
const isServerToken = (t) => t.scope === 'server'
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
const READ_PROGRAMS = new Set(['ls', 'cat', 'head', 'tail', 'wc', 'grep', 'rg', 'find', 'tree', 'pwd', 'stat', 'file', 'diff', 'du', 'echo', 'git'])

const httpError = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) })
const hashToken = (raw) => crypto.createHash('sha256').update(String(raw)).digest('hex')

// ---------------------------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------------------------

function publicToken(t, db = readDb()) {
  const u = (db.users || {})[t.userId]
  return {
    id: t.id,
    name: t.name,
    access: t.access,
    scope: t.scope || 'project',
    tokenPreview: `${t.tokenPrefix}…`,
    projectPath: t.projectPath,
    projectName: t.projectName,
    createdBy: u ? { id: u.id, fullName: u.fullName, email: u.email } : { id: t.userId, fullName: 'Deleted user', email: '' },
    createdAt: t.createdAt,
    expiresAt: t.expiresAt,
    lastUsedAt: t.lastUsedAt || null,
    expired: !!t.expiresAt && Date.parse(t.expiresAt) <= Date.now()
  }
}

/** The project `req` targets on its selected server, if the caller may hand it to an AI client. */
function requireManagedProject(req, projectPath) {
  if (req.user.impersonatedBy) throw httpError(403, 'MCP access tokens cannot be created while impersonating a user.')
  const dir = normalizeProjectPath(projectPath)
  if (!dir || dir.split('/').filter(Boolean).length < 2) throw httpError(400, 'A valid project path is required.')
  const level = projectLevel(req, { projectPath: dir })
  // Viewers can't read files or env in the panel, so they can't give an AI client that access either
  if (!hasLevel(level, 'manager')) throw httpError(403, level ? 'Your access to this project is read-only. Ask an organization admin for Manager access.' : 'You do not have access to this project.')
  return { dir, level }
}

/** Whole-server access: organization owners/admins on their own servers, super admins anywhere. */
function canManageServer(req) {
  return isSuperSession(req) || (isOrgAdmin(req) && !isPlatformHost(req.tenant?.server))
}

function requireServerManager(req) {
  if (req.user.impersonatedBy) throw httpError(403, 'MCP access tokens cannot be created while impersonating a user.')
  if (!canManageServer(req)) {
    throw httpError(403, isOrgAdmin(req)
      ? 'The platform host is managed by platform staff. Select one of your organization\'s servers.'
      : 'Only organization owners and admins can connect an AI client to the whole server.')
  }
}

const serverKey = (req) => (isPlatformHost(req.tenant?.server) ? null : req.tenant.server.id)

export function listTokens(req, projectPath, scope = 'project') {
  const server = scope === 'server'
  let dir = SERVER_ROOT
  let seeAll = true
  if (server) requireServerManager(req)
  else {
    const managed = requireManagedProject(req, projectPath)
    dir = managed.dir
    seeAll = managed.level === 'super' || managed.level === 'owner'
  }
  const db = readDb()
  return (db.mcpTokens || [])
    .filter((t) => t.organizationId === req.tenant.organizationId && (t.serverId || null) === serverKey(req) && isServerToken(t) === server && t.projectPath === dir)
    .filter((t) => seeAll || t.userId === req.user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((t) => publicToken(t, db))
}

/** Creates a token and returns it once in plain text; only its hash is stored. */
export async function createToken(req, { scope = 'project', projectPath, projectName, name, access = 'edit', expiresInDays = 90 }) {
  if (!MCP_SCOPES.includes(scope)) throw httpError(400, 'scope must be "project" or "server".')
  const server = scope === 'server'
  if (server) requireServerManager(req)
  const dir = server ? SERVER_ROOT : requireManagedProject(req, projectPath).dir
  if (!MCP_ACCESS.includes(access)) throw httpError(400, 'access must be "read", "edit" or "full".')
  const days = Number(expiresInDays)
  if (![0, 7, 30, 90, 365].includes(days)) throw httpError(400, 'expiresInDays must be 7, 30, 90, 365 or 0 (never).')
  const label = String(name || '').trim().slice(0, 60) || 'AI assistant'

  // The directory must exist on the server (and resolve to itself, not a symlink elsewhere)
  const host = getHost(serverKey(req) ? req.tenant.server : null)
  let real = dir
  if (!server) {
    try { real = await host.realpath(dir) } catch { real = null }
    if (!real) throw httpError(404, `${dir} does not exist on this server.`)
  }

  const db = readDb()
  db.mcpTokens ||= []
  const sameProject = db.mcpTokens.filter((t) => t.organizationId === req.tenant.organizationId && (t.serverId || null) === serverKey(req) && isServerToken(t) === server && t.projectPath === real)
  if (sameProject.length >= MAX_TOKENS_PER_PROJECT) throw httpError(400, `This ${server ? 'server' : 'project'} already has ${MAX_TOKENS_PER_PROJECT} MCP tokens. Revoke unused ones first.`)

  const raw = TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url')
  const user = getUserById(req.user.id)
  const now = new Date()
  const token = {
    id: `mcp-${crypto.randomBytes(8).toString('hex')}`,
    name: label,
    tokenHash: hashToken(raw),
    tokenPrefix: raw.slice(0, TOKEN_PREFIX.length + 6),
    organizationId: req.tenant.organizationId,
    serverId: serverKey(req),
    scope,
    projectPath: real,
    projectName: String(server ? host.label : (projectName || path.posix.basename(real))).slice(0, 100),
    userId: req.user.id,
    access,
    // A console (super admin) token keeps working on the platform host only while the user stays super admin
    super: isSuperSession(req),
    tv: user?.tokenVersion || 0,
    createdAt: now.toISOString(),
    expiresAt: days ? new Date(now.getTime() + days * 86400000).toISOString() : null,
    lastUsedAt: null
  }
  db.mcpTokens.push(token)
  writeDb(db)
  return { token: publicToken(token, db), secret: raw }
}

export function revokeToken(req, id) {
  const db = readDb()
  const token = (db.mcpTokens || []).find((t) => t.id === id && t.organizationId === req.tenant.organizationId)
  if (!token) throw httpError(404, 'Token not found.')
  if (isServerToken(token)) {
    if (!canManageServer(req)) throw httpError(403, 'Only organization owners and admins can revoke server tokens.')
  } else if (token.userId !== req.user.id) {
    const level = projectLevel(req, { projectPath: token.projectPath })
    if (level !== 'super' && level !== 'owner') throw httpError(403, 'Only the token\'s creator or an organization admin can revoke it.')
  }
  db.mcpTokens = db.mcpTokens.filter((t) => t.id !== id)
  writeDb(db)
  fs.rmSync(path.join(MCP_DIR, `${id}.json`), { force: true })
  fs.rmSync(path.join(MCP_DIR, `${id}.backups`), { recursive: true, force: true })
  return token
}

// ---------------------------------------------------------------------------------------------
// Authenticating a client request
// ---------------------------------------------------------------------------------------------

/**
 * Resolves a bearer token to its project and re-checks that its creator may still work on it.
 * Returns { token, host, req } where `req` is the request-shaped context the access rules use.
 */
export function authenticateMcpToken(raw) {
  const fail = (message) => httpError(401, message, 'MCP_UNAUTHORIZED')
  if (!raw || !String(raw).startsWith(TOKEN_PREFIX)) throw fail('An MCP access token is required (Authorization: Bearer adpmcp_…).')
  const hash = hashToken(raw)
  const db = readDb()
  const token = (db.mcpTokens || []).find((t) => t.tokenHash.length === hash.length && crypto.timingSafeEqual(Buffer.from(t.tokenHash), Buffer.from(hash)))
  if (!token) throw fail('This MCP token is not valid. It may have been revoked.')
  if (token.expiresAt && Date.parse(token.expiresAt) <= Date.now()) throw fail('This MCP token has expired. Generate a new one in the panel.')

  const user = getUserById(token.userId)
  if (!user) throw fail('The account that created this MCP token no longer exists.')
  if (getUserStatus(user) === 'suspended') throw httpError(403, 'The account that created this MCP token is suspended.')
  // "Sign out everywhere" bumps tokenVersion; MCP tokens go with it
  if ((user.tokenVersion || 0) !== (token.tv || 0)) throw fail('This MCP token was signed out. Generate a new one in the panel.')
  const role = getPlatformRole(user)
  if (token.super && role !== 'superadmin') throw fail('The super admin access this MCP token was created with has been removed.')
  if (getPlatformSettings().maintenanceMode && role !== 'superadmin') throw httpError(503, 'The panel is in maintenance mode.')

  const organization = getOrganizationById(token.organizationId)
  if (!organization) throw fail('The organization this MCP token belongs to no longer exists.')
  if (organization.status === 'suspended' && role !== 'superadmin') throw httpError(403, 'This organization has been suspended.')
  const member = getOrganizationMembers(token.organizationId).find((m) => m.userId === user.id)
  if (!member && role !== 'superadmin') throw httpError(403, 'The token\'s creator is no longer a member of this organization.')

  let server = null
  if (token.serverId) {
    server = getServerById(token.serverId)
    if (!server) throw httpError(404, 'The server this project was on has been removed.')
    if (server.organizationId && server.organizationId !== token.organizationId) throw httpError(403, 'This server now belongs to another organization.')
  }

  const req = {
    user: { id: user.id, email: user.email, role, portal: token.super ? 'console' : 'panel' },
    tenant: { organizationId: token.organizationId, server, memberRole: member ? member.role : 'OWNER' }
  }
  if (isServerToken(token)) {
    if (!canManageServer(req)) throw httpError(403, 'The token\'s creator can no longer manage this server.')
  } else if (!hasLevel(projectLevel(req, { projectPath: token.projectPath }), 'manager')) {
    throw httpError(403, 'The token\'s creator no longer manages this project.')
  }

  if (!token.lastUsedAt || Date.now() - Date.parse(token.lastUsedAt) > 60000) {
    const saved = (db.mcpTokens || []).find((t) => t.id === token.id)
    saved.lastUsedAt = new Date().toISOString()
    writeDb(db)
  }
  return { token, host: getHost(server), req }
}

// ---------------------------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------------------------

const PATH_PROP = { type: 'string', description: 'Path relative to the project root (absolute paths inside the project also work).' }

const SERVER_PATH_PROP = { type: 'string', description: 'Absolute path on the server (relative paths resolve from /).' }

/**
 * `scope` limits a tool to project or server tokens; `server` overrides parts of its definition for
 * server tokens.
 */
const TOOLS = [
  {
    access: 'read',
    scope: 'server',
    def: {
      name: 'get_server_info',
      description: 'Hostname, OS, uptime, CPU, memory and disk usage, every PM2 process with its folder, and the folders in /var/www. Call this first.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true }
    }
  },
  {
    access: 'read',
    scope: 'project',
    def: {
      name: 'get_project_info',
      description: 'Name, root directory, stack (package.json scripts, frameworks), git status and PM2 processes of this project. Call this first.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true }
    }
  },
  {
    access: 'read',
    def: {
      name: 'view',
      description: 'Read a file with line numbers, or list a directory two levels deep (node_modules, .git and build output are not expanded).',
      inputSchema: {
        type: 'object',
        properties: {
          path: PATH_PROP,
          view_range: { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 2, description: 'Optional [start, end] line numbers (1-based, end -1 = to the end of the file).' }
        },
        required: ['path']
      },
      annotations: { readOnlyHint: true }
    },
    server: { path: SERVER_PATH_PROP }
  },
  {
    access: 'read',
    def: {
      name: 'run_command',
      description: 'Run ONE command in the project root without a shell (no pipes, redirects, &&, ;, $(), globs). Read-only tokens: ls, cat, head, tail, wc, grep, rg, find, tree, pwd, stat, file, diff, du, echo, git (status, diff, log, show, ls-files, grep, blame, branch, rev-parse). Edit tokens also: npm (run/test/install/ci/ls/outdated/audit/view), npx (tsc, eslint, prettier, vite, next, jest, vitest, tailwindcss, astro, nuxt, svelte-check, vue-tsc), node <script>, php -l, python3 -m py_compile|compileall|pytest, composer (install/dump-autoload/validate/show), curl GET to localhost.',
      inputSchema: { type: 'object', properties: { command: { type: 'string', description: 'For example: git log --oneline -20' } }, required: ['command'] }
    },
    server: {
      description: 'Run ONE allowlisted command without a shell (no pipes, redirects, &&, ;, $(), globs) in the given folder. Read-only tokens: ls, cat, head, tail, wc, grep, rg, find, tree, pwd, stat, file, diff, du, echo, git (read-only subcommands). Edit tokens also: npm, npx (installed tools), node <script>, php -l, python3 -m py_compile|compileall|pytest, composer, curl GET to localhost. Full-access tokens can use run_shell for anything else.',
      properties: { cwd: { type: 'string', description: 'Absolute folder to run in (default /root).' } }
    }
  },
  {
    access: 'full',
    scope: 'server',
    def: {
      name: 'run_shell',
      description: 'Run a bash script on the server as the panel\'s SSH user (usually root): pipes, &&, sudo, apt, systemctl, nginx, pm2, docker, databases, anything. Nothing is allowlisted or backed up, so check what a command does before running it and never run destructive commands the user did not ask for.',
      inputSchema: {
        type: 'object',
        properties: {
          script: { type: 'string', description: 'For example: nginx -t && systemctl reload nginx' },
          cwd: { type: 'string', description: 'Absolute folder to run in (default /root).' },
          timeout_seconds: { type: 'integer', minimum: 1, maximum: 600, description: 'Default 120.' }
        },
        required: ['script']
      },
      annotations: { destructiveHint: true, openWorldHint: true }
    }
  },
  {
    access: 'read',
    def: {
      name: 'get_app_logs',
      description: 'Recent output and error logs of the project\'s PM2 process(es).',
      inputSchema: {
        type: 'object',
        properties: {
          app_name: { type: 'string', description: 'PM2 app name; defaults to every app running from this project.' },
          lines: { type: 'integer', minimum: 10, maximum: 1000, description: 'Lines per log (default 100).' }
        }
      },
      annotations: { readOnlyHint: true }
    },
    server: {
      description: 'Recent output and error logs of a PM2 process on the server.',
      properties: { app_name: { type: 'string', description: 'PM2 app name (see get_server_info).' } },
      required: ['app_name']
    }
  },
  {
    access: 'edit',
    def: {
      name: 'create_file',
      description: 'Create a file, or overwrite an existing one, with the given content. Parent directories are created.',
      inputSchema: { type: 'object', properties: { path: PATH_PROP, content: { type: 'string' } }, required: ['path', 'content'] }
    },
    server: { path: SERVER_PATH_PROP }
  },
  {
    access: 'edit',
    def: {
      name: 'str_replace',
      description: 'Replace one exact, unique occurrence of old_str in a file with new_str. View the file first and copy the text exactly, including whitespace.',
      inputSchema: { type: 'object', properties: { path: PATH_PROP, old_str: { type: 'string' }, new_str: { type: 'string' } }, required: ['path', 'old_str', 'new_str'] }
    },
    server: { path: SERVER_PATH_PROP }
  },
  {
    access: 'edit',
    def: {
      name: 'insert',
      description: 'Insert text after the given line of a file (0 = at the top).',
      inputSchema: { type: 'object', properties: { path: PATH_PROP, insert_line: { type: 'integer', minimum: 0 }, text: { type: 'string' } }, required: ['path', 'insert_line', 'text'] }
    },
    server: { path: SERVER_PATH_PROP }
  },
  {
    access: 'edit',
    def: {
      name: 'list_changes',
      description: 'Files changed through this MCP token, which undo_changes can restore.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true }
    }
  },
  {
    access: 'edit',
    def: {
      name: 'undo_changes',
      description: 'Restore a file (or every file) changed through this MCP token to its content before the first change. Files the token created are deleted.',
      inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'One changed file (as listed by list_changes); omit to undo everything.' } } },
      annotations: { destructiveHint: true }
    }
  },
  {
    access: 'full',
    def: {
      name: 'restart_app',
      description: 'Restart the project\'s PM2 process(es) so backend changes go live.',
      inputSchema: { type: 'object', properties: { app_name: { type: 'string', description: 'PM2 app name; defaults to every app running from this project.' } } },
      annotations: { destructiveHint: true }
    },
    server: {
      description: 'Restart a PM2 process on the server.',
      properties: { app_name: { type: 'string', description: 'PM2 app name (see get_server_info).' } },
      required: ['app_name']
    }
  }
]

/** The tool definition as a token of this scope sees it. */
function defFor(tool, scope) {
  if (scope !== 'server' || !tool.server) return tool.def
  const { description, path: pathProp, properties = {}, required } = tool.server
  const schema = tool.def.inputSchema
  return {
    ...tool.def,
    description: description || tool.def.description,
    inputSchema: {
      ...schema,
      properties: { ...schema.properties, ...(pathProp ? { path: pathProp } : {}), ...properties },
      ...(required ? { required } : {})
    }
  }
}

const tokenScope = (token) => (isServerToken(token) ? 'server' : 'project')
const toolsFor = (token) => TOOLS
  .filter((t) => ACCESS_RANK[t.access] <= ACCESS_RANK[token.access] && (!t.scope || t.scope === tokenScope(token)))
  .map((t) => defFor(t, tokenScope(token)))

// The per-token change log (which files were changed and where their backups are)
const stateFile = (id) => path.join(MCP_DIR, `${id}.json`)

function loadChanges(token) {
  try { return JSON.parse(fs.readFileSync(stateFile(token.id), 'utf8')).changes || {} } catch { return {} }
}

function saveChanges(token, changes) {
  fs.mkdirSync(MCP_DIR, { recursive: true, mode: 0o700 })
  const tmp = `${stateFile(token.id)}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ changes }), { mode: 0o600 })
  fs.renameSync(tmp, stateFile(token.id))
}

// Edits through one token run one at a time so the change log stays consistent
const queues = new Map()
function serialize(id, fn) {
  const run = (queues.get(id) || Promise.resolve()).then(fn, fn)
  queues.set(id, run.catch(() => {}))
  return run
}

async function projectApps(host, token, appName) {
  if (isServerToken(token) && !appName) throw new Error('app_name is required. See get_server_info for the PM2 apps on this server.')
  const apps = await pm2AppsFor(host, token.projectPath)
  if (!appName) return apps
  const app = apps.find((a) => a.name === String(appName))
  if (!app) throw new Error(`No PM2 app named '${appName}' runs ${isServerToken(token) ? 'on this server' : 'from this project'}. Apps: ${apps.map((a) => a.name).join(', ') || 'none'}.`)
  return [app]
}

async function callTool(ctx, name, args = {}) {
  const { token, host } = ctx
  const tool = TOOLS.find((t) => t.def.name === name && (!t.scope || t.scope === tokenScope(token)))
  if (!tool) throw new Error(`Unknown tool '${name}'.`)
  if (ACCESS_RANK[tool.access] > ACCESS_RANK[token.access]) throw new Error(`'${name}' needs a token with ${tool.access === 'full' ? 'full' : 'edit'} access. This token is ${token.access}.`)
  const root = token.projectPath
  const session = { id: token.id, projectPath: root, changes: {}, backupDir: path.join(MCP_DIR, `${token.id}.backups`) }
  const workDir = async () => {
    const { abs } = await confine(host, root, args.cwd ? String(args.cwd) : '/root')
    const st = await host.stat(abs)
    if (!st?.isDirectory) throw new Error(`${abs} is not a folder on this server.`)
    return abs
  }

  switch (name) {
    case 'get_project_info': {
      const facts = await describeProject(host, root)
      const git = await host.exec('git status --short --branch 2>/dev/null | head -n 40', { cwd: root, timeout: 20000 })
      return `Project: ${token.projectName}\nRoot: ${root}\nServer: ${host.label}\nAccess: ${token.access}\n${facts}${git.stdout.trim() ? `\n\ngit status:\n${git.stdout.trim()}` : ''}`
    }
    case 'get_server_info': {
      const r = await host.exec([
        'echo "Host: $(hostname) ($(. /etc/os-release 2>/dev/null; echo "$PRETTY_NAME"), $(uname -m))"',
        'echo "User: $(id -un)"',
        'echo "Uptime: $(uptime -p 2>/dev/null) · load $(cut -d" " -f1-3 /proc/loadavg) · $(nproc) CPU"',
        'free -h 2>/dev/null | sed -n 1,2p',
        'df -h -x tmpfs -x devtmpfs -x overlay 2>/dev/null',
        'echo; echo "/var/www:"; ls -1 /var/www 2>/dev/null'
      ].join('\n'), { timeout: 20000 })
      const apps = await pm2AppsFor(host, SERVER_ROOT)
      const pm2 = apps.length ? apps.map((a) => `- ${a.name} (${a.status}) ${a.cwd}`).join('\n') : 'none'
      return `Server: ${host.label}\nAccess: ${token.access}\n${r.stdout.trim()}\n\nPM2 processes:\n${pm2}`
    }
    case 'run_shell': {
      const script = String(args.script || '')
      if (!script.trim()) throw new Error('script is required.')
      const timeout = Math.min(600, Math.max(1, Number(args.timeout_seconds) || 120)) * 1000
      const r = await host.exec(`${script}\n`, { cwd: await workDir(), timeout, ...(host.isLocal ? { env: childEnv() } : {}) })
      const out = (r.stdout + (r.stderr ? `\n${r.stderr}` : '')).trim()
      return `${out.length > 30000 ? `${out.slice(0, 10000)}\n… (output truncated) …\n${out.slice(-20000)}` : out}\n[exit code ${r.code}]`.trim()
    }
    case 'view':
      return runEditor(session, { command: 'view', path: args.path, view_range: args.view_range }, host)
    case 'run_command': {
      const command = String(args.command || '').trim()
      if (token.access === 'read') {
        const [prog] = splitCommand(command)
        if (!READ_PROGRAMS.has(prog)) throw new Error(`'${prog || ''}' is not available with a read-only token. Allowed: ${[...READ_PROGRAMS].join(', ')}.`)
      }
      const cwd = isServerToken(token) ? await workDir() : undefined
      return runBash(session, { command, cwd }, { controller: new AbortController() }, host)
    }
    case 'get_app_logs': {
      const apps = await projectApps(host, token, args.app_name)
      if (!apps.length) return 'No PM2 process runs from this project.'
      const lines = Math.min(1000, Math.max(10, Number(args.lines) || 100))
      const out = []
      for (const app of apps) {
        const r = await host.run('pm2', ['logs', app.name, '--lines', String(lines), '--nostream', '--raw'], { timeout: 30000 })
        out.push(`=== ${app.name} (${app.status}) ===\n${(r.stdout + r.stderr).trim().slice(-30000)}`)
      }
      return out.join('\n\n')
    }
    case 'create_file':
    case 'str_replace':
    case 'insert':
      return serialize(token.id, async () => {
        session.changes = loadChanges(token)
        const input = name === 'create_file'
          ? { command: 'create', path: args.path, file_text: args.content }
          : name === 'insert'
            ? { command: 'insert', path: args.path, insert_line: args.insert_line, insert_text: args.text }
            : { command: 'str_replace', path: args.path, old_str: args.old_str, new_str: args.new_str }
        try {
          return await runEditor(session, input, host)
        } finally {
          saveChanges(token, session.changes)
        }
      })
    case 'list_changes': {
      const files = Object.entries(loadChanges(token))
      return files.length ? files.map(([f, c]) => `${c.created ? 'added   ' : 'modified'} ${f}`).join('\n') : 'No files have been changed through this token.'
    }
    case 'undo_changes':
      return serialize(token.id, async () => {
        const changes = loadChanges(token)
        const targets = args.path ? [String(args.path)] : Object.keys(changes)
        if (!targets.length) return 'Nothing to undo.'
        try {
          for (const rel of targets) {
            const c = changes[rel]
            if (!c) throw new Error(`${rel} was not changed through this token. See list_changes.`)
            const { abs } = await confine(host, root, rel)
            if (c.created) await host.rm(abs)
            else await host.writeFile(abs, fs.readFileSync(path.join(session.backupDir, c.backup)))
            delete changes[rel]
          }
        } finally {
          saveChanges(token, changes)
        }
        return `Restored ${targets.length} file(s): ${targets.join(', ')}`
      })
    case 'restart_app': {
      const apps = await projectApps(host, token, args.app_name)
      if (!apps.length) return 'No PM2 process runs from this project, so nothing needs restarting.'
      const log = []
      for (const app of apps) {
        // The panel can't restart itself from inside a request it is answering
        if (host.isLocal && app.name === PANEL_PM2_NAME) { log.push(`Skipped ${app.name}: the panel itself is restarted from the panel.`); continue }
        const r = await host.run('pm2', ['restart', app.name, '--update-env'], { timeout: 60000 })
        log.push(r.code === 0 ? `Restarted ${app.name}.` : `Restart of ${app.name} failed: ${(r.stderr || r.stdout).trim().slice(0, 500)}`)
      }
      return log.join('\n')
    }
  }
  throw new Error(`Unknown tool '${name}'.`)
}

// ---------------------------------------------------------------------------------------------
// JSON-RPC
// ---------------------------------------------------------------------------------------------

const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

function instructions(token, host) {
  if (isServerToken(token)) {
    return `This MCP server gives you access to a whole live server managed by AutoDeploy Panel: ${host.label} (access: ${token.access}). Every website and app hosted on it is reachable, usually under /var/www, and runs under PM2.
Start with get_server_info. Paths are absolute. Explore before changing anything and keep changes to what the user asked for: other sites on this server are live too. ${token.access === 'full' ? 'run_shell runs any command as the server user, usually root, with no undo, so never run destructive commands (deleting data, dropping databases, stopping services) unless the user explicitly asks.' : 'Commands are allowlisted and run without a shell.'} Never print secrets from .env files or credentials.`
  }
  return `This MCP server gives you access to one project on a live server managed by AutoDeploy Panel: "${token.projectName}" at ${token.projectPath} on ${host.label} (access: ${token.access}).
Start with get_project_info. Explore before editing, keep changes focused and follow the project's style, and verify with the project's build/tests via run_command. Commands run without a shell, one at a time. Files and builds change what the live site serves; ${token.access === 'full' ? 'restart_app restarts the backend, so only use it when the user asks or a backend change needs it.' : 'restarting the backend is done by the user from the panel.'} Never print secrets from .env files.`
}

/** Handles one JSON-RPC message; returns the response, or null for notifications. */
export async function handleRpc(ctx, msg, onToolCall = () => {}) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return rpcError(msg?.id, -32600, 'Invalid JSON-RPC request.')
  }
  const { id, method, params = {} } = msg
  const isNotification = id === undefined || id === null
  if (isNotification) return null

  const result = (value) => ({ jsonrpc: '2.0', id, result: value })
  switch (method) {
    case 'initialize': {
      const requested = params.protocolVersion
      return result({
        protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'autodeploy-panel', title: `AutoDeploy · ${isServerToken(ctx.token) ? `server ${ctx.token.projectName}` : ctx.token.projectName}`, version: '1.0.0' },
        instructions: instructions(ctx.token, ctx.host)
      })
    }
    case 'ping':
      return result({})
    case 'tools/list':
      return result({ tools: toolsFor(ctx.token) })
    case 'tools/call': {
      const name = String(params.name || '')
      try {
        const text = await callTool(ctx, name, params.arguments || {})
        onToolCall(name, params.arguments || {}, false)
        return result({ content: [{ type: 'text', text: String(text) }], isError: false })
      } catch (err) {
        onToolCall(name, params.arguments || {}, true)
        // Tool failures go back to the model as results it can act on, not protocol errors
        return result({ content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true })
      }
    }
    case 'resources/list':
      return result({ resources: [] })
    case 'prompts/list':
      return result({ prompts: [] })
    default:
      return rpcError(id, -32601, `Method not found: ${method}`)
  }
}

export const isWriteTool = (name) => ['create_file', 'str_replace', 'insert', 'undo_changes', 'restart_app', 'run_shell'].includes(name)
