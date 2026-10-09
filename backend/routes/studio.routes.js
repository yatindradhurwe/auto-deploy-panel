import express from 'express'
import fs from 'fs'
import path from 'path'
import http from 'http'
import https from 'https'
import { fileURLToPath } from 'url'
import { authenticateToken } from '../middleware/auth.middleware.js'
import { isSystemAdminUser } from '../config/secrets.js'
import { hostFor, getHost, publicServer, isLocalServer, forgetHost, testServerConnection, q } from '../services/host.service.js'
import { discoverProjects } from '../services/project-discovery.service.js'
import { updateProject, deleteProject } from '../services/project-ops.service.js'
import { validateResourceOwnership } from '../middleware/tenant.middleware.js'
import {
  readDb,
  getProjectsByOrgId,
  getServerById,
  getServersByOrgId,
  createServer,
  updateServer,
  deleteServer,
  getUserSettings,
  getProjectAutoUpdateConfig,
  saveProjectAutoUpdateConfig,
  getAllProjectAutoUpdateConfigs,
  getWebhookAuditLogs,
  purgeProjectAndRelatedResources
} from '../services/db.service.js'
import { executeProjectAutoUpdate } from '../services/autoupdate.service.js'
import * as mail from '../services/mail.service.js'
import * as projectAgent from '../services/project-agent.service.js'
import {
  getRealHostMetrics,
  getRealPm2Processes,
  getRealSslCertificates,
  getRealCronJobs
} from '../services/server.service.js'
import {
  discoverDatabases,
  listTables,
  getTableData,
  runQuery,
  insertRow,
  deleteRow,
  createTable,
  dropTable
} from '../services/database.service.js'

const router = express.Router()

// Hostnames only (e.g. app.example.com) — blocks path traversal and config/shell injection via the domain field
const DOMAIN_REGEX = /^(?!-)[a-zA-Z0-9-]{1,63}(?<!-)(\.(?!-)[a-zA-Z0-9-]{1,63}(?<!-))+$/
const BRANCH_REGEX = /^[a-zA-Z0-9._\/-]{1,100}$/
const PANEL_PM2_NAME = process.env.PANEL_PM2_NAME || 'auto-deploy-panel'

/**
 * Wraps a route: resolves the selected server's executor (X-Server-Id) and turns errors into JSON.
 */
const withHost = (fn) => async (req, res) => {
  try {
    await fn(req, res, hostFor(req))
  } catch (err) {
    if (!res.headersSent) res.status(err.status || 500).json({ success: false, error: err.message })
  }
}

const PANEL_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const LOCAL_SERVER_IDS = new Set(['srv-default', 'srv-001', 'srv-default-node', 'local', undefined, null, ''])

/**
 * A project directory that must exist on the selected server. Never falls back to another
 * folder (the panel runs from /var/www, the parent of every site).
 */
async function resolveProjectDir(host, projectPath) {
  if (!projectPath || typeof projectPath !== 'string') return null
  const dir = path.posix.resolve(projectPath)
  const st = await host.stat(dir)
  return st?.isDirectory ? dir : null
}

async function requireProjectDir(host, projectPath) {
  const dir = await resolveProjectDir(host, projectPath)
  if (!dir) throw Object.assign(new Error(`Project directory not found on ${host.label}: ${projectPath || '(none)'}`), { status: 400 })
  return dir
}

/**
 * Top-level and system directories that must never be deleted from the file manager.
 */
function isProtectedPath(targetPath) {
  const resolved = path.posix.resolve(targetPath)
  const depth = resolved.split('/').filter(Boolean).length
  return depth < 3 || /^\/(etc|usr|bin|sbin|lib|lib64|boot|proc|sys|dev)(\/|$)/.test(resolved)
}

/**
 * The .env file the project actually uses: first of .env, .env.production, .env.local, else .env
 */
async function findEnvFile(host, projectDir) {
  for (const f of ['.env', '.env.production', '.env.local']) {
    const p = `${projectDir}/${f}`
    if (await host.exists(p)) return p
  }
  return `${projectDir}/.env`
}

/** Projects recorded for this server in db.json (from deployments), scoped to the organization. */
function registeredProjectsFor(server, orgId, isSuper) {
  const all = Object.values(readDb().projects || {})
  return all.filter(p => {
    if (!isSuper && orgId && p.organizationId && p.organizationId !== orgId) return false
    if (!server) return LOCAL_SERVER_IDS.has(p.serverId)
    if (p.serverId === server.id) return true
    return isLocalServer(server) && LOCAL_SERVER_IDS.has(p.serverId)
  })
}

async function discoverServerProjects(req, host) {
  const server = req.tenant?.server || null
  const registered = registeredProjectsFor(server, req.tenant?.organizationId, isSuperAdminUser(req))
  return discoverProjects(host, registered, { panelRoot: host.isLocal ? PANEL_ROOT : null })
}

/**
 * Live metrics for one server, never throwing: unreachable servers are reported as offline.
 */
const metricsCache = new Map() // server id -> { at, data }
async function serverStatus(server, { fresh = false } = {}) {
  const key = server?.id || 'local'
  const cached = metricsCache.get(key)
  if (!fresh && cached && Date.now() - cached.at < 20000) return cached.data
  let data
  try {
    const host = getHost(server)
    const [metrics, procs] = await Promise.race([
      Promise.all([getRealHostMetrics(host), getRealPm2Processes(host)]),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out after 12s')), 12000))
    ])
    data = { status: 'online', cpu: metrics.cpu, ram: metrics.memory, disk: metrics.disk, os: metrics.osType, nodeVersion: metrics.nodeVersion, uptimeSeconds: metrics.uptimeSeconds, cpuCores: metrics.cpuCores, totalRamMb: metrics.totalRamMb, activeApps: procs.filter(p => p.status === 'online').length, totalApps: procs.length, lastSeen: new Date().toISOString(), error: null }
  } catch (err) {
    data = { status: 'offline', error: err.message, lastSeen: cached?.data?.lastSeen || null }
  }
  metricsCache.set(key, { at: Date.now(), data })
  return data
}

function orgServers(req) {
  const servers = isSuperAdminUser(req) && req.tenant?.organizationId === 'org-default'
    ? Object.values(readDb().servers || {}).filter(s => s.organizationId === 'org-default' || !s.organizationId)
    : getServersByOrgId(req.tenant?.organizationId)
  return servers
}

/**
 * GET & POST /api/studio/servers — every connected server with live status and load.
 */
router.all('/servers', withHost(async (req, res) => {
  const servers = orgServers(req)
  const list = await Promise.all(servers.map(async s => ({ ...publicServer(s), ...(await serverStatus(s)) })))
  res.json({ success: true, servers: list, activeServerId: req.tenant?.serverId || null })
}))

/**
 * POST /api/studio/servers/scan — fresh metrics + PM2 processes for the selected server.
 */
router.post('/servers/scan', withHost(async (req, res, host) => {
  const server = req.tenant?.server || null
  const status = await serverStatus(server, { fresh: true })
  if (status.status !== 'online') return res.status(502).json({ success: false, error: status.error })
  const processes = await getRealPm2Processes(host)
  res.json({
    success: true,
    message: `Scanned ${host.label}.`,
    server: { ...(server ? publicServer(server) : { id: 'local', name: host.label }), ...status, cpuUsage: status.cpu, ramUsage: status.ram, diskUsage: status.disk },
    processes
  })
}))

/**
 * Helper to verify if user is Super Admin
 */
const isSuperAdminUser = (req) => isSystemAdminUser(req.user) && !req.user.impersonatedBy

function serverInput(body) {
  const host = String(body.ipAddress || body.host || body.hostname || '').trim()
  if (!/^[A-Za-z0-9.:-]{1,255}$/.test(host)) throw Object.assign(new Error('Enter the server IP address or hostname.'), { status: 400 })
  const port = Number(body.port) || 22
  if (port < 1 || port > 65535) throw Object.assign(new Error('Invalid SSH port.'), { status: 400 })
  const username = String(body.username || 'root').trim()
  if (!/^[a-z_][a-z0-9_.-]{0,31}$/i.test(username)) throw Object.assign(new Error('Invalid SSH username.'), { status: 400 })
  return {
    name: String(body.name || host).trim().slice(0, 80),
    ipAddress: host,
    hostname: String(body.hostname || host).trim(),
    port,
    username,
    password: body.password || '',
    sshKey: body.sshKey || '',
    domain: String(body.domain || '').trim()
  }
}

/**
 * POST /api/studio/servers/test — checks SSH credentials without saving anything.
 */
router.post('/servers/test', withHost(async (req, res) => {
  const input = serverInput(req.body)
  if (!input.password && !input.sshKey && !isLocalServer(input)) throw Object.assign(new Error('Enter the SSH password or private key.'), { status: 400 })
  const info = await testServerConnection(input)
  res.json({ success: true, ...info, local: isLocalServer(input) })
}))

/**
 * POST /api/studio/servers/add — verifies SSH access, then saves the server.
 */
router.post('/servers/add', withHost(async (req, res) => {
  const input = serverInput(req.body)
  if (!input.password && !input.sshKey && !isLocalServer(input)) throw Object.assign(new Error('Enter the SSH password or private key.'), { status: 400 })
  const orgId = req.tenant?.organizationId || 'org-default'
  if (getServersByOrgId(orgId).some(s => s.ipAddress === input.ipAddress && Number(s.port || 22) === input.port)) {
    throw Object.assign(new Error(`${input.ipAddress} is already connected.`), { status: 409 })
  }
  const info = await testServerConnection(input)
  const created = createServer({
    ...input,
    organizationId: orgId,
    createdBy: req.user?.id || null,
    serverType: 'vps',
    authType: input.sshKey ? 'ssh_key' : 'password',
    os: info.os,
    status: 'online'
  })
  res.json({ success: true, message: `Connected to ${created.name} (${info.os}).`, server: { ...publicServer(created), ...info } })
}))

/**
 * POST /api/studio/servers/update — rename or change credentials (re-tested before saving).
 */
router.post('/servers/update', withHost(async (req, res) => {
  const server = getServerById(req.body.serverId || req.body.id)
  if (!server || !validateResourceOwnership(server, req)) throw Object.assign(new Error('Server not found.'), { status: 404 })
  const input = serverInput({ ...server, ...req.body, password: req.body.password || server.password, sshKey: req.body.sshKey || server.sshKey })
  if (req.body.password || req.body.sshKey || input.ipAddress !== server.ipAddress || input.port !== Number(server.port || 22) || input.username !== server.username) {
    await testServerConnection(input)
  }
  const updated = updateServer(server.id, input)
  forgetHost(server.id)
  metricsCache.delete(server.id)
  res.json({ success: true, message: 'Server updated.', server: publicServer(updated) })
}))

/**
 * POST /api/studio/servers/delete — disconnects a server (nothing on the server is touched).
 */
router.post('/servers/delete', withHost(async (req, res) => {
  const server = getServerById(req.body.serverId || req.body.id)
  if (!server || !validateResourceOwnership(server, req)) throw Object.assign(new Error('Server not found.'), { status: 404 })
  if (isLocalServer(server)) throw Object.assign(new Error('This is the server the panel itself runs on; it cannot be removed.'), { status: 400 })
  deleteServer(server.id)
  forgetHost(server.id)
  metricsCache.delete(server.id)
  res.json({ success: true, message: `${server.name} disconnected. Its apps keep running.` })
}))

/**
 * GET & POST /api/studio/ssl/certificates
 */
router.all('/ssl/certificates', withHost(async (req, res, host) => {
  res.json({ success: true, certificates: await getRealSslCertificates(host) })
}))

/**
 * GET & POST /api/studio/cron/list
 */
router.all('/cron/list', withHost(async (req, res, host) => {
  const jobs = await getRealCronJobs(host)
  res.json({ success: true, cronJobs: jobs, jobs })
}))

/**
 * GET /api/studio/webhooks/logs
 */
router.get('/webhooks/logs', (req, res) => {
  const orgId = req.tenant?.organizationId || 'org-default'
  const isSuper = isSuperAdminUser(req)
  const logs = getWebhookAuditLogs()

  if (!isSuper && orgId !== 'org-default') {
    return res.json({ success: true, logs: logs.filter(l => l.organizationId === orgId) })
  }

  res.json({ success: true, logs })
})

/**
 * GET & POST /api/studio/logs/telemetry
 */
router.all('/logs/telemetry', (req, res) => {
  res.json({
    success: true,
    logs: [
      { timestamp: new Date().toISOString(), level: 'INFO', service: 'auto-deploy-backend', message: 'HTTP GET /api/studio/server-metrics 200 OK - 12ms' }
    ]
  })
})

/**
 * GET /api/studio/preview-proxy
 * Bypasses mixed content, HTTPS/HTTP iframe blocking, and X-Frame-Options
 */
router.get('/preview-proxy', (req, res) => {
  let targetUrl = req.query.url
  if (!targetUrl) return res.status(400).send('Target URL query parameter required')

  if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
    targetUrl = 'http://' + targetUrl
  }

  try {
    const isHttps = targetUrl.startsWith('https://')
    const clientModule = isHttps ? https : http
    const parsedUrl = new URL(targetUrl)

    const requestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AutoDeployStudioPreview/1.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      rejectUnauthorized: false
    }

    const proxyReq = clientModule.request(requestOptions, (proxyRes) => {
      res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'text/html; charset=utf-8')
      res.setHeader('Access-Control-Allow-Origin', '*')

      let rawData = ''
      proxyRes.on('data', (chunk) => {
        rawData += chunk.toString('utf-8')
      })

      proxyRes.on('end', () => {
        const contentType = (proxyRes.headers['content-type'] || '').toLowerCase()
        if (contentType.includes('text/html')) {
          const baseTag = `<base href="${targetUrl}">`
          if (rawData.includes('<head>')) {
            rawData = rawData.replace('<head>', `<head>${baseTag}`)
          } else if (rawData.includes('<html>')) {
            rawData = rawData.replace('<html>', `<html><head>${baseTag}</head>`)
          } else {
            rawData = baseTag + rawData
          }
        }
        res.send(rawData)
      })
    })

    proxyReq.on('error', (err) => {
      res.status(502).send(`
        <div style="font-family: system-ui, sans-serif; padding: 30px; background: #07090E; color: #38BDF8; height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;">
          <div style="font-size: 40px; margin-bottom: 15px;">⚡</div>
          <h2 style="color: #F43F5E; margin: 0 0 10px 0;">Live Preview Connecting</h2>
          <p style="color: #94A3B8; max-width: 480px; font-size: 13px; line-height: 1.6;">
            Target service at <strong style="color: #E2E8F0;">${targetUrl}</strong> is initiating or starting PM2 reload.
          </p>
          <a href="${targetUrl}" target="_blank" style="margin-top: 20px; padding: 10px 22px; background: linear-gradient(to right, #06B6D4, #4F46E5); color: white; border-radius: 12px; text-decoration: none; font-weight: bold; font-size: 12px; box-shadow: 0 10px 25px -5px rgba(6, 182, 212, 0.4);">
            Open Direct Website in New Tab ↗
          </a>
        </div>
      `)
    })

    proxyReq.end()
  } catch (err) {
    res.status(500).send(`Proxy error: ${err.message}`)
  }
})

function getCandidateScore(proj) {
  let score = 0
  const normP = (proj.path || '').toLowerCase()
  const folderName = path.basename(normP)
  const dom = (proj.domain || '').toLowerCase().replace(/^https?:\/\//i, '').replace(/^www\./i, '')

  if (dom && (folderName === dom || dom.includes(folderName) || folderName.includes(dom.replace(/\.[a-z]+$/, '')))) {
    score += 100
  }
  if (proj.repoName && dom && proj.repoName.toLowerCase().includes(dom.replace(/\.[a-z]+$/, ''))) {
    score += 50
  }
  if (normP.includes('-prd') || normP.includes('production') || normP.includes('/var/www/')) {
    score += 30
  }
  if (folderName === 'app' || folderName === 'html' || folderName === 'test') {
    score -= 80
  }
  return score
}

/**
 * GET & POST /api/studio/projects
 * Projects on the selected server (discovered live + recorded deployments), one per domain/folder
 */
router.all('/projects', withHost(async (req, res, host) => {
  const discovered = await discoverServerProjects(req, host)
  const server = req.tenant?.server || null
  const domainMap = new Map()
  const pathMap = new Map()

  for (const p of discovered) {
    const dom = p.domain ? p.domain.trim().toLowerCase().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '') : null
    if (!dom) {
      if (!pathMap.has(p.path)) pathMap.set(p.path, p)
      continue
    }
    const existing = domainMap.get(dom)
    if (!existing || getCandidateScore(p) > getCandidateScore(existing)) domainMap.set(dom, p)
  }

  const seen = new Set()
  const projects = []
  for (const p of [...domainMap.values(), ...pathMap.values()]) {
    if (seen.has(p.path)) continue
    seen.add(p.path)
    projects.push({ ...p, organizationId: req.tenant?.organizationId || 'org-default', serverId: server?.id || 'srv-default', serverName: server?.name || host.label })
  }
  res.json({ success: true, projects, server: server ? publicServer(server) : null })
}))

/**
 * GET & POST /api/studio/server-metrics
 */
router.all('/server-metrics', withHost(async (req, res, host) => {
  const [metrics, processes] = await Promise.all([getRealHostMetrics(host), getRealPm2Processes(host)])
  const server = req.tenant?.server
  res.json({
    success: true,
    server: { ...metrics, host: server?.ipAddress || server?.hostname || '127.0.0.1', name: server?.name || host.label, status: 'online' },
    processes
  })
}))

/**
 * GET & POST /api/studio/projects/realtime-fetch — rescan (same data as /projects, never cached)
 */
router.all('/projects/realtime-fetch', withHost(async (req, res, host) => {
  const projects = (await discoverServerProjects(req, host)).map(p => ({ ...p, organizationId: req.tenant?.organizationId || 'org-default', serverId: req.tenant?.server?.id || 'srv-default' }))
  res.json({ success: true, message: `Found ${projects.length} projects on ${host.label}.`, projects })
}))

/**
 * POST /api/studio/git/status
 */
router.post('/git/status', withHost(async (req, res, host) => {
  const dir = await resolveProjectDir(host, req.body.projectPath)
  if (!dir) return res.json({ success: false, branch: 'main', modifiedCount: 0, raw: 'Project directory not found' })
  const r = await host.exec('git status --short && git branch --show-current', { cwd: dir })
  if (r.code !== 0) return res.json({ success: false, branch: 'main', modifiedCount: 0, raw: 'Not a git repo' })
  const lines = r.stdout.trim().split('\n')
  const branch = lines.pop() || 'main'
  const modifiedFiles = lines.filter(l => l.trim())
  res.json({ success: true, branch, modifiedCount: modifiedFiles.length, modifiedFiles })
}))

/**
 * POST /api/studio/git/pull
 */
router.post('/git/pull', withHost(async (req, res, host) => {
  const { branch = 'main' } = req.body
  const dir = await requireProjectDir(host, req.body.projectPath)
  if (!BRANCH_REGEX.test(branch)) return res.status(400).json({ success: false, error: 'Invalid branch name' })
  const r = await host.run('git', ['pull', 'origin', branch], { cwd: dir, timeout: 300000 })
  if (r.code !== 0) return res.status(500).json({ success: false, error: r.stderr || r.stdout })
  res.json({ success: true, message: 'Git Pull completed successfully', output: r.stdout })
}))

/**
 * POST /api/studio/git/push — add, commit (message passed as one argument), push
 */
router.post('/git/push', withHost(async (req, res, host) => {
  const { commitMessage = 'update from studio ide', branch = 'main' } = req.body
  const dir = await requireProjectDir(host, req.body.projectPath)
  if (!BRANCH_REGEX.test(branch)) return res.status(400).json({ success: false, error: 'Invalid branch name' })
  const add = await host.run('git', ['add', '.'], { cwd: dir })
  if (add.code !== 0) return res.status(500).json({ success: false, error: add.stderr })
  const commit = await host.run('git', ['commit', '-m', String(commitMessage)], { cwd: dir })
  if (commit.code !== 0 && !/nothing to commit|working tree clean/.test(commit.stdout)) return res.status(500).json({ success: false, error: commit.stdout || commit.stderr })
  const push = await host.run('git', ['push', 'origin', branch], { cwd: dir, timeout: 300000 })
  if (push.code !== 0) return res.status(500).json({ success: false, error: push.stderr || push.stdout })
  res.json({ success: true, message: 'Git Push completed successfully', output: [commit.stdout, push.stdout, push.stderr].filter(Boolean).join('\n') || 'Already up to date.' })
}))

/**
 * POST /api/studio/git/pull-and-update — pull, install/build and reload the app on the selected server
 */
router.post('/git/pull-and-update', withHost(async (req, res, host) => {
  const { projectPath, appName, branch = 'main' } = req.body
  const logs = []
  const onLog = (text, isError = false) => logs.push({ text, isError, timestamp: new Date().toISOString() })
  try {
    const result = await updateProject(host, {
      projectPath,
      appName,
      branch,
      githubToken: (getUserSettings(req.user?.id)?.githubToken || '').trim()
    }, onLog)
    res.json({ success: true, message: `${result.message}${host.isLocal ? '' : ` (${host.label})`}`, output: logs.map(l => l.text).join(''), logs })
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: `Update failed: ${err.message}`, output: logs.map(l => l.text).join(''), logs })
  }
}))

/**
 * POST /api/studio/projects/delete — removes PM2 app, nginx site, database and files on the selected server
 */
router.post('/projects/delete', withHost(async (req, res, host) => {
  const { appName, projectPath, domain, dbName, deletePm2 = true, deleteFiles = true, deleteNginx = true, deleteDb = true } = req.body
  const result = await deleteProject(host, { appName, projectPath, domain, dbName, deletePm2, deleteFiles, deleteNginx, deleteDb })
  purgeProjectAndRelatedResources(appName, projectPath, domain)
  await mail.syncMailConfig().catch(e => console.error('[MAIL SYNC]', e.message))
  res.json({ success: true, message: result.message, output: result.output })
}))

const dbHandler = (fn) => withHost(async (req, res, host) => {
  res.json({ success: true, ...(await fn(req.body || {}, req, host)) })
})

/**
 * GET & POST /api/studio/databases
 * Every project on the selected server with the databases it uses, plus databases not tied to a project
 */
router.all('/databases', dbHandler((body, req, host) =>
  discoverDatabases(host, { force: body.refresh === true || req.query.refresh === '1', registered: registeredProjectsFor(req.tenant?.server || null, req.tenant?.organizationId, isSuperAdminUser(req)) })))

router.post('/databases/tables', dbHandler(async (body, req, host) => ({ tables: await listTables(host, body.connectionId) })))
router.post('/databases/table-data', dbHandler((body, req, host) => getTableData(host, body.connectionId, body)))
router.post('/databases/query', dbHandler((body, req, host) => runQuery(host, body.connectionId, body.query)))
router.post('/databases/insert-row', dbHandler((body, req, host) => insertRow(host, body.connectionId, body)))
router.post('/databases/delete-row', dbHandler((body, req, host) => deleteRow(host, body.connectionId, body)))
router.post('/databases/create-table', dbHandler((body, req, host) => createTable(host, body.connectionId, body)))
router.post('/databases/drop-table', dbHandler((body, req, host) => dropTable(host, body.connectionId, body)))

const TREE_SKIP = ['node_modules', '.git', 'dist', '.user_uploaded', 'chunks']
const MAX_EDIT_BYTES = 10 * 1024 * 1024

const resolveIn = (projectPath, p) => (path.posix.isAbsolute(p) || !projectPath ? path.posix.normalize(p) : path.posix.resolve(projectPath, p))

/**
 * POST /api/studio/files/tree — whole tree in one `find` (one round trip on remote servers)
 */
router.post('/files/tree', withHost(async (req, res, host) => {
  let root = await resolveProjectDir(host, req.body.projectPath)
  if (!root) {
    if (!host.isLocal) throw Object.assign(new Error(`Project directory not found on ${host.label}`), { status: 400 })
    root = path.resolve(process.cwd(), '..')
  }
  const prune = TREE_SKIP.map(n => `-name ${q(n)}`).join(' -o ')
  const r = await host.exec(`find . -mindepth 1 -maxdepth 12 \\( ${prune} \\) -prune -o \\( -type d -printf 'd\\t0\\t%P\\n' \\) -o \\( -printf 'f\\t%s\\t%P\\n' \\) 2>/dev/null | head -n 30000`, { cwd: root, timeout: 60000 })
  const nodes = new Map([['', { children: [] }]])
  const entries = r.stdout.split('\n').filter(Boolean).map(l => l.split('\t')).filter(e => e.length === 3 && e[2])
  entries.sort((a, b) => a[2].split('/').length - b[2].split('/').length)
  for (const [type, size, rel] of entries) {
    const name = rel.split('/').pop()
    const parent = nodes.get(path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel))
    if (!parent) continue
    const node = type === 'd'
      ? { name, path: rel, fullPath: `${root}/${rel}`, type: 'directory', children: [] }
      : { name, path: rel, fullPath: `${root}/${rel}`, type: 'file', size: Number(size), ext: path.posix.extname(name).replace('.', '') }
    parent.children.push(node)
    if (type === 'd') nodes.set(rel, node)
  }
  const sortTree = (list) => {
    list.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1))
    for (const n of list) if (n.children) sortTree(n.children)
    return list
  }
  res.json({ success: true, rootPath: root, tree: sortTree(nodes.get('').children), server: host.label })
}))

/**
 * POST /api/studio/files/read
 */
router.post('/files/read', withHost(async (req, res, host) => {
  const { filePath, projectPath } = req.body
  if (!filePath) return res.status(400).json({ error: 'filePath parameter is required' })
  const target = resolveIn(projectPath, filePath)
  const st = await host.stat(target)
  if (!st || !st.isFile) return res.status(404).json({ error: `File not found: ${filePath}` })
  if (st.size > MAX_EDIT_BYTES) return res.status(413).json({ error: `File is too large to open in the editor (${Math.round(st.size / 1048576)} MB).` })
  res.json({ success: true, filePath: target, content: await host.readFile(target) })
}))

/**
 * POST /api/studio/files/save
 */
router.post('/files/save', withHost(async (req, res, host) => {
  const { filePath, projectPath, content } = req.body
  if (!filePath || content === undefined) return res.status(400).json({ error: 'filePath and content are required' })
  const target = resolveIn(projectPath, filePath)
  await host.mkdir(path.posix.dirname(target))
  await host.writeFile(target, String(content))
  res.json({ success: true, message: 'File saved successfully', filePath: target })
}))

/**
 * POST /api/studio/files/create — file or folder inside the project
 */
router.post('/files/create', withHost(async (req, res, host) => {
  const { projectPath, relativePath, type = 'file' } = req.body
  if (!projectPath || !relativePath) return res.status(400).json({ error: 'projectPath and relativePath are required' })
  const full = path.posix.resolve(projectPath, relativePath)
  if (type === 'folder' || type === 'directory') {
    await host.mkdir(full)
    return res.json({ success: true, message: `Directory '${relativePath}' created successfully`, fullPath: full })
  }
  await host.mkdir(path.posix.dirname(full))
  if (!await host.exists(full)) await host.writeFile(full, '')
  res.json({ success: true, message: `File '${relativePath}' created successfully`, fullPath: full })
}))

/**
 * POST /api/studio/files/delete
 */
router.post('/files/delete', withHost(async (req, res, host) => {
  const { filePath } = req.body
  if (!filePath) return res.status(400).json({ error: 'filePath is required' })
  const target = path.posix.normalize(filePath)
  if (!await host.exists(target)) return res.status(404).json({ error: 'File or directory not found' })
  if (isProtectedPath(target)) return res.status(400).json({ error: `Refusing to delete protected path: ${target}` })
  await host.rm(target)
  res.json({ success: true, message: 'Item deleted successfully' })
}))

/**
 * POST /api/studio/files/upload — one or more files (base64 or text) into the project
 */
router.post('/files/upload', withHost(async (req, res, host) => {
  const { projectPath, targetDir = '', files = [] } = req.body
  if (!projectPath || !Array.isArray(files) || files.length === 0) return res.status(400).json({ error: 'projectPath and non-empty files array are required' })
  const base = targetDir ? path.posix.resolve(projectPath, targetDir) : path.posix.resolve(projectPath)
  let uploadedCount = 0
  for (const f of files) {
    if (!f.relativePath) continue
    const target = path.posix.resolve(base, f.relativePath)
    await host.mkdir(path.posix.dirname(target))
    await host.writeFile(target, f.contentBase64 ? Buffer.from(f.contentBase64, 'base64') : Buffer.from(f.content || '', 'utf-8'))
    uploadedCount++
  }
  res.json({ success: true, message: `Successfully uploaded ${uploadedCount} file(s) into project`, uploadedCount })
}))

/**
 * POST /api/studio/terminal/exec — runs a shell command in the project directory on the selected server
 */
router.post('/terminal/exec', withHost(async (req, res, host) => {
  const { projectPath, command } = req.body
  if (!command || !command.trim()) return res.status(400).json({ error: 'Command is required' })
  const dir = await resolveProjectDir(host, projectPath)
  if (!dir) return res.status(400).json({ success: false, error: `Project directory not found: ${projectPath || '(none)'}`, output: '', exitCode: 1 })
  const r = await host.exec(command.trim(), { cwd: dir, timeout: 120000 })
  res.json({
    success: r.code === 0,
    output: r.stdout + (r.stderr ? `\nSTDERR:\n${r.stderr}` : ''),
    error: r.code === 0 ? null : `Command exited with code ${r.code}`,
    exitCode: r.code,
    server: host.label
  })
}))

/**
 * POST /api/studio/env/get
 */
router.post('/env/get', withHost(async (req, res, host) => {
  const dir = await resolveProjectDir(host, req.body.projectPath)
  if (!dir) return res.status(400).json({ error: 'Invalid or missing project directory' })
  const envPath = await findEnvFile(host, dir)
  const rawContent = (await host.exists(envPath)) ? await host.readFile(envPath) : ''
  const envVars = []
  for (const line of rawContent.split('\n')) {
    const t = line.trim()
    if (t && !t.startsWith('#') && t.includes('=')) {
      const i = t.indexOf('=')
      envVars.push({ key: t.slice(0, i).trim(), value: t.slice(i + 1).trim() })
    }
  }
  res.json({ success: true, envPath, rawContent, envVars })
}))

/**
 * POST /api/studio/env/save — writes back to the same file env/get loaded
 */
router.post('/env/save', withHost(async (req, res, host) => {
  const { rawContent, envVars } = req.body
  const dir = await resolveProjectDir(host, req.body.projectPath)
  if (!dir) return res.status(400).json({ error: 'Invalid project directory' })
  const envPath = await findEnvFile(host, dir)
  const content = rawContent || (Array.isArray(envVars) ? envVars.map(v => `${v.key}=${v.value}`).join('\n') : '')
  await host.writeFile(envPath, content, { mode: 0o600 })
  res.json({ success: true, message: '.env file saved successfully', envPath })
}))

/**
 * POST /api/studio/git/history
 */
router.post('/git/history', withHost(async (req, res, host) => {
  const dir = await resolveProjectDir(host, req.body.projectPath)
  if (!dir) return res.status(400).json({ error: 'Invalid project directory' })
  const r = await host.run('git', ['log', '-n', '12', '--pretty=format:%h|%s|%an|%cr'], { cwd: dir })
  if (r.code !== 0) return res.json({ success: true, commits: [] })
  const commits = r.stdout.split('\n').filter(l => l.trim()).map(line => {
    const [hash, subject, author, relativeTime] = line.split('|')
    return { hash, subject, author, relativeTime }
  })
  res.json({ success: true, commits })
}))

/**
 * POST /api/studio/git/rollback
 */
router.post('/git/rollback', withHost(async (req, res, host) => {
  const { commitHash } = req.body
  const dir = await resolveProjectDir(host, req.body.projectPath)
  if (!dir || !commitHash) return res.status(400).json({ error: 'Invalid rollback parameters' })
  if (!/^[0-9a-fA-F]{4,40}$/.test(commitHash)) return res.status(400).json({ error: 'Invalid commit hash' })
  const r = await host.run('git', ['reset', '--hard', commitHash], { cwd: dir })
  if (r.code !== 0) return res.status(500).json({ error: r.stderr || r.stdout })
  res.json({ success: true, message: `Successfully rolled back to commit ${commitHash}`, output: r.stdout })
}))

/**
 * POST /api/studio/pm2/control — restart, stop, reload, delete
 */
router.post('/pm2/control', withHost(async (req, res, host) => {
  const { action, processId, appName } = req.body
  const target = processId !== undefined && processId !== null ? processId : appName
  if (target === undefined || target === null || target === '' || !['restart', 'stop', 'reload', 'delete', 'start'].includes(action)) {
    return res.status(400).json({ error: 'Valid action and processId/appName are required' })
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(String(target))) return res.status(400).json({ error: 'Invalid process name' })
  if (host.isLocal && (action === 'stop' || action === 'delete') && (String(target) === PANEL_PM2_NAME || String(target) === 'all')) {
    return res.status(400).json({ error: `Refusing to ${action} '${target}': it would shut down this control panel. Use SSH instead.` })
  }
  const r = await host.run('pm2', [action, String(target)], { timeout: 60000 })
  if (r.code !== 0) return res.status(500).json({ success: false, error: r.stderr || r.stdout })
  await host.run('pm2', ['save'])
  res.json({ success: true, message: `PM2 process '${target}' executed action: ${action}`, output: r.stdout })
}))

/**
 * POST /api/studio/pm2/logs
 */
router.post('/pm2/logs', withHost(async (req, res, host) => {
  const { appName, lines = 80 } = req.body
  if (!appName) return res.status(400).json({ error: 'appName parameter is required' })
  const app = String(appName).replace(/[^a-zA-Z0-9_.-]/g, '')
  const n = Math.min(Math.max(parseInt(lines, 10) || 80, 1), 5000)
  const r = await host.run('pm2', ['logs', app, '--lines', String(n), '--nostream'], { timeout: 30000 })
  let output = r.stdout || r.stderr
  if (!output || r.code !== 0) {
    const f = await host.exec(`L="$HOME/.pm2/logs"; [ -f "$L/${app}-error.log" ] && { echo "=== ERROR LOG ==="; tail -c 2000 "$L/${app}-error.log"; }; [ -f "$L/${app}-out.log" ] && { echo "=== STDOUT LOG ==="; tail -c 3000 "$L/${app}-out.log"; }`)
    output = f.stdout || `No logs found for process ${app}`
  }
  res.json({ success: true, appName: app, logs: output.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '') })
}))

/**
 * POST /api/studio/ssl/issue — certbot --nginx -d <domain> on the selected server
 */
router.post('/ssl/issue', withHost(async (req, res, host) => {
  const { domain, email = 'admin@yjtechnosoft.com' } = req.body
  if (!domain || !DOMAIN_REGEX.test(domain)) return res.status(400).json({ error: 'Invalid domain name' })
  if (!/^[^\s@'"`$;|&<>]+@[^\s@'"`$;|&<>]+\.[a-zA-Z]{2,}$/.test(email)) return res.status(400).json({ error: 'Invalid email address' })
  const r = await host.run('certbot', ['--nginx', '-d', domain, '--non-interactive', '--agree-tos', '-m', email, '--redirect'], { timeout: 300000 })
  if (r.code !== 0) return res.status(500).json({ success: false, error: r.stderr || r.stdout })
  res.json({ success: true, message: `SSL Certificate issued successfully for ${domain}`, output: r.stdout })
}))

/**
 * POST /api/studio/nginx/config — reverse proxy site; rolled back if nginx -t rejects it
 */
router.post('/nginx/config', withHost(async (req, res, host) => {
  const { domain, proxyPort } = req.body
  const port = parseInt(proxyPort, 10)
  if (!domain || !DOMAIN_REGEX.test(domain)) return res.status(400).json({ error: 'Invalid domain name' })
  if (!Number.isInteger(port) || port < 1 || port > 65535) return res.status(400).json({ error: 'proxyPort must be a number between 1 and 65535' })

  const nginxConfig = `server {
    listen 80;
    server_name ${domain};

    location / {
        proxy_pass http://127.0.0.1:${port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
`
  if (!await host.exists('/etc/nginx')) return res.status(400).json({ success: false, error: `nginx is not installed on ${host.label}.`, config: nginxConfig })
  const conf = `/etc/nginx/sites-available/${domain}.conf`
  const link = `/etc/nginx/sites-enabled/${domain}.conf`
  const previous = (await host.exists(conf)) ? await host.readFile(conf) : null
  const hadLink = await host.exists(link)
  await host.writeFile(conf, nginxConfig)
  if (!hadLink) await host.run('ln', ['-sf', conf, link])
  const test = await host.run('nginx', ['-t'])
  if (test.code !== 0) {
    // Never leave a broken config in place: one bad file stops nginx reloading for every site
    if (previous !== null) await host.writeFile(conf, previous)
    else await host.rm(conf)
    if (!hadLink) await host.rm(link)
    return res.status(500).json({ success: false, error: `nginx -t failed, changes rolled back:\n${test.stderr || test.stdout}`, config: nginxConfig })
  }
  const reload = await host.run('systemctl', ['reload', 'nginx'])
  if (reload.code !== 0) return res.status(500).json({ success: false, error: reload.stderr })
  const sslNote = previous && previous.includes('ssl_certificate') ? ' Re-run "Issue SSL" to restore HTTPS for this domain.' : ''
  res.json({ success: true, message: `Nginx reverse proxy for ${domain} -> http://127.0.0.1:${port} active!${sslNote}`, config: nginxConfig })
}))

/**
 * POST /api/studio/cron/save — appends a crontab entry on the selected server
 */
router.post('/cron/save', withHost(async (req, res, host) => {
  const { schedule, command } = req.body
  if (!schedule || !command) return res.status(400).json({ error: 'Schedule and command are required' })
  if (/[\r\n]/.test(schedule) || /[\r\n]/.test(command) || schedule.trim().split(/\s+/).length !== 5) {
    return res.status(400).json({ error: 'Schedule must have 5 cron fields and neither field may contain line breaks' })
  }
  const entry = `${schedule.trim()} ${command.trim()}`
  const current = await host.exec('crontab -l 2>/dev/null')
  const existing = current.code === 0 ? current.stdout : ''
  const r = await host.exec('crontab -', { input: (existing && !existing.endsWith('\n') ? existing + '\n' : existing) + entry + '\n' })
  if (r.code !== 0) return res.status(500).json({ success: false, error: r.stderr })
  res.json({ success: true, message: `Cron job added: "${entry}"`, schedule, command })
}))

/**
 * GET /api/studio/autoupdate/config/:appName
 * Get Antigravity Auto-Update configuration for a project
 */
router.get('/autoupdate/config/:appName', authenticateToken, (req, res) => {
  const { appName } = req.params
  const config = getProjectAutoUpdateConfig(appName)
  res.json({ success: true, config })
})

/**
 * POST /api/studio/autoupdate/config
 * Save Antigravity Auto-Update configuration for a project
 */
router.post('/autoupdate/config', authenticateToken, (req, res) => {
  const { appName, enabled, autoSyncInterval, branch, gitRepoUrl, projectPath, host } = req.body
  if (!appName) {
    return res.status(400).json({ error: 'appName is required' })
  }

  const updated = saveProjectAutoUpdateConfig(appName, {
    enabled: Boolean(enabled),
    autoSyncInterval: Number(autoSyncInterval) || 5,
    branch: branch || 'main',
    gitRepoUrl: gitRepoUrl || '',
    projectPath: projectPath || `/var/www/${appName}`,
    host: host || '187.127.165.128'
  })

  res.json({ success: true, config: updated, message: `Antigravity Auto-Update config saved for project '${appName}'` })
})

/**
 * POST /api/studio/autoupdate/trigger-now
 * Manually trigger instant Antigravity Auto-Update for a project
 */
router.post('/autoupdate/trigger-now', authenticateToken, async (req, res) => {
  const { appName } = req.body
  if (!appName) {
    return res.status(400).json({ error: 'appName is required' })
  }

  try {
    const result = await executeProjectAutoUpdate(appName, 'manual', { pusher: 'Studio Admin' })
    res.json(result)
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
})

/**
 * GET /api/studio/autoupdate/list
 * List all configured project auto-updaters
 */
router.get('/autoupdate/list', authenticateToken, (req, res) => {
  const configs = getAllProjectAutoUpdateConfigs()
  res.json({ success: true, configs })
})

/**
 * GET /api/studio/autoupdate/history
 * Fetch audit trail logs for auto-updates and webhooks
 */
router.get('/autoupdate/history', authenticateToken, (req, res) => {
  const history = getWebhookAuditLogs()
  res.json({ success: true, history })
})

/**
 * Domain email (Postfix + Dovecot + OpenDKIM) — see services/mail.service.js
 */
const mailHandler = (fn) => async (req, res) => {
  try {
    res.json({ success: true, ...(await fn(req, req.tenant?.organizationId)) })
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message })
  }
}

router.get('/email/status', mailHandler(async () => ({ status: await mail.getMailStatus() })))

router.get('/email/client-config', mailHandler(async () => ({ settings: mail.getClientSettings() })))

router.get('/email/domains', mailHandler(async (req, orgId) => ({ domains: mail.listDomains(orgId) })))

router.post('/email/domains', mailHandler(async (req, orgId) =>
  ({ domain: await mail.addDomain(req.body.domain, orgId), message: `Domain ${req.body.domain} added.` })))

router.post('/email/domains/update', mailHandler(async (req, orgId) =>
  ({ domain: await mail.updateDomain(req.body.domain, req.body, orgId), message: 'Domain updated.' })))

router.post('/email/domains/delete', mailHandler((req, orgId) => mail.removeDomain(req.body.domain, orgId)))

router.get('/email/domains/dns', mailHandler((req, orgId) => mail.getDnsRecords(req.query.domain, orgId)))

router.get('/email/accounts', mailHandler(async (req, orgId) => ({ accounts: await mail.listAccounts(orgId) })))

router.post('/email/accounts/create', mailHandler(async (req, orgId) => {
  const account = await mail.createAccount(req.body, orgId)
  return { account, message: `Mailbox ${account.email} created.` }
}))

router.post('/email/accounts/update', mailHandler(async (req, orgId) =>
  ({ account: await mail.updateAccount(req.body.emailId, req.body, orgId), message: 'Mailbox updated.' })))

router.post('/email/accounts/delete', mailHandler((req, orgId) => mail.deleteAccount(req.body.emailId, orgId)))

router.get('/email/messages', mailHandler((req, orgId) =>
  mail.listMessages(req.query.mailbox, req.query, orgId)))

router.get('/email/message', mailHandler(async (req, orgId) =>
  ({ message: await mail.getMessage(req.query.mailbox, req.query.folder || 'inbox', req.query.id, orgId) })))

router.get('/email/attachment', async (req, res) => {
  try {
    const a = await mail.getAttachment(req.query.mailbox, req.query.folder || 'inbox', req.query.id, req.query.index, req.tenant?.organizationId)
    res.setHeader('Content-Type', a.contentType)
    res.setHeader('Content-Disposition', `attachment; filename="${a.filename.replace(/["\\\r\n]/g, '_')}"`)
    res.send(a.content)
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message })
  }
})

router.post('/email/read-mark', mailHandler((req, orgId) =>
  mail.markMessage(req.body.mailbox, req.body.folder || 'inbox', req.body.messageId, { read: req.body.read }, orgId)))

router.post('/email/messages/delete', mailHandler((req, orgId) =>
  mail.deleteMessage(req.body.mailbox, req.body.folder || 'inbox', req.body.messageId, orgId)))

router.post('/email/send', mailHandler((req, orgId) => mail.sendMessage(req.body, orgId)))

router.get('/email/delivery-log', mailHandler((req, orgId) => mail.getDeliveryLog(req.query, orgId)))

/**
 * Project coding agent — Claude, ChatGPT or Gemini (services/project-agent.service.js)
 */
const agentHandler = (fn) => async (req, res) => {
  try {
    res.json({ success: true, ...(await fn(req)) })
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message })
  }
}

router.get('/ai/agent/status', agentHandler(async () => ({ status: projectAgent.getAgentStatus() })))

router.post('/ai/agent/settings', agentHandler(async (req) => ({ status: projectAgent.updateProviderSettings(req.body) })))

router.get('/ai/agent/sessions', agentHandler(async (req) => {
  const host = hostFor(req)
  const dir = await resolveProjectDir(host, req.query.projectPath)
  if (!dir) throw Object.assign(new Error('Project directory not found.'), { status: 404 })
  return { sessions: projectAgent.listSessions(dir, host.isLocal ? null : req.tenant.server.id) }
}))

router.post('/ai/agent/sessions', agentHandler(async (req) => {
  const host = hostFor(req)
  const dir = await resolveProjectDir(host, req.body.projectPath)
  if (!dir) throw Object.assign(new Error('Project directory not found.'), { status: 404 })
  if (isProtectedPath(dir)) throw Object.assign(new Error('The agent can only work inside a project directory.'), { status: 400 })
  return { session: await projectAgent.createSession(dir, req.body.projectName, req.body.provider, host.isLocal ? null : req.tenant.server) }
}))

router.get('/ai/agent/sessions/:id', agentHandler(async (req) => ({ session: projectAgent.getSession(req.params.id) })))

router.post('/ai/agent/sessions/:id/delete', agentHandler(async (req) => projectAgent.deleteSession(req.params.id)))

/**
 * Runs one prompt and streams progress as Server-Sent Events.
 * The run continues if the browser disconnects; reopening the session shows the transcript.
 */
router.post('/ai/agent/sessions/:id/message', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  })
  let open = true
  res.on('close', () => { open = false })
  const emit = (ev) => { if (open) res.write(`data: ${JSON.stringify(ev)}\n\n`) }
  const heartbeat = setInterval(() => { if (open) res.write(': ping\n\n') }, 15000)
  try {
    await projectAgent.runPrompt(req.params.id, req.body.prompt, emit)
  } catch (err) {
    emit({ type: 'error', text: err.message })
    emit({ type: 'done' })
  } finally {
    clearInterval(heartbeat)
    if (open) res.end()
  }
})

router.post('/ai/agent/sessions/:id/stop', agentHandler(async (req) => projectAgent.stopSession(req.params.id)))

router.get('/ai/agent/sessions/:id/changes', agentHandler(async (req) => projectAgent.getChanges(req.params.id)))

router.post('/ai/agent/sessions/:id/revert', agentHandler(async (req) => projectAgent.revertChanges(req.params.id, req.body.file || null)))

router.post('/ai/agent/sessions/:id/deploy', agentHandler(async (req) => projectAgent.deploySession(req.params.id, req.body)))

export default router

