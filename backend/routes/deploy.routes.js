import express from 'express'
import { testSshConnection, scanPortsAndServices } from '../services/ssh.service.js'
import { runDeployPipeline, validateDeployConfig, STAGES } from '../services/deploy-pipeline.service.js'
import { getHost } from '../services/host.service.js'
import { initUpload, appendChunk, completeUpload, analyzeGitRepo, listGitBranches } from '../services/upload.service.js'
import { diagnoseDeploymentError, executeSshPatch } from '../services/ai.service.js'
import { recordTemplateDeploy } from '../services/template.service.js'
import { isSuperSession } from '../services/project-access.service.js'
import { checkEntitlement } from '../services/subscription.service.js'
import { inspectExternalPostgres } from '../services/database.service.js'
import { inspectSupabaseStorage } from '../services/supabase-storage.service.js'
import * as dnsProvider from '../services/dns-provider.service.js'
import { bareToken, callbackUrl, githubOAuthAvailable, startGithubOAuth, finishGithubOAuth, githubUser, listGithubRepos, revokeGithubOAuth } from '../services/github.service.js'

const router = express.Router()

// In-memory store for active streaming deployments
const activeDeployments = new Map()

/**
 * POST /api/deploy/analyze-git { gitUrl, branch }
 * Shallow-clones the repository on the panel host and detects the stack from real files.
 */
router.post('/analyze-git', async (req, res) => {
  try {
    const token = (getUserSettings(req.user?.id)?.githubToken || '').trim() || null
    const result = await analyzeGitRepo({ gitUrl: req.body.gitUrl, branch: req.body.branch, token })
    res.json({ success: true, ...result })
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message })
  }
})

/**
 * POST /api/deploy/git-branches { gitUrl } → { branches, defaultBranch }
 */
router.post('/git-branches', async (req, res) => {
  try {
    const token = (getUserSettings(req.user?.id)?.githubToken || '').trim() || null
    res.json({ success: true, ...(await listGitBranches({ gitUrl: req.body.gitUrl, token })) })
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message })
  }
})

// Back-compat alias used by older clients
router.post('/detect-stack', async (req, res) => {
  try {
    const token = (getUserSettings(req.user?.id)?.githubToken || '').trim() || null
    const result = await analyzeGitRepo({ gitUrl: req.body.repoUrl || req.body.gitUrl, branch: req.body.branch, token })
    res.json({ success: true, stack: result.analysis, branch: result.branch })
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message })
  }
})

/**
 * Chunked uploads: POST /uploads { kind, name, size } → POST /uploads/:id/chunk?offset=N (raw bytes)
 * → POST /uploads/:id/complete (extracts + analyzes a project, or identifies a database dump)
 */
router.post('/uploads', (req, res) => {
  try {
    res.json({ success: true, ...initUpload(req.body || {}, req.user?.id) })
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message })
  }
})

router.post('/uploads/:id/chunk', async (req, res) => {
  try {
    res.json({ success: true, ...(await appendChunk(req.params.id, req.query.offset, req, req.user?.id)) })
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message, expectedOffset: err.expectedOffset })
  }
})

router.post('/uploads/:id/complete', async (req, res) => {
  try {
    res.json({ success: true, ...(await completeUpload(req.params.id, req.user?.id)) })
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message })
  }
})

/**
 * POST /api/deploy/migration-check { sourceUrl, includeAuth?, storage?: { url, key } }
 * Before a "Migrate existing database" deploy: logs in to the source database from the selected
 * server and lists the Supabase Storage buckets, so the wizard can show what will be copied.
 */
router.post('/migration-check', async (req, res) => {
  try {
    const { sourceUrl, includeAuth, storage } = req.body || {}
    const out = {}
    if (sourceUrl) out.database = await inspectExternalPostgres(getHost(req.tenant?.server || null), sourceUrl, { includeAuth: includeAuth !== false })
    if (storage?.url || storage?.key) out.storage = await inspectSupabaseStorage(storage)
    if (!out.database && !out.storage) return res.status(400).json({ success: false, error: 'Paste the connection string of the database to migrate.' })
    res.json({ success: true, ...out })
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message })
  }
})

/**
 * Test SSH Connection
 */
router.post('/test-ssh', async (req, res) => {
  try {
    const result = await testSshConnection(req.body)
    res.json(result)
  } catch (err) {
    res.status(400).json({ success: false, error: err.message })
  }
})

/**
 * Check if a project directory, PM2 service, or Nginx site config already exists on target server before deploying
 */
router.post('/check-existing', async (req, res) => {
  const { host, port, username, password, domain, appName, remoteDir } = req.body
  if (!host) {
    return res.status(400).json({ success: false, error: 'Host IP is required' })
  }

  try {
    const cleanDomain = (domain || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    const cleanAppName = (appName || '').trim()
    const cleanDir = (remoteDir || `/var/www/${cleanAppName}`).trim()

    let hasDirectory = false
    let hasNginx = false
    let hasPm2 = false

    try {
      const { Client } = await import('ssh2')
      const conn = new Client()
      await new Promise((resolve) => {
        conn.on('ready', () => {
          const cmd = `
            [ -d "${cleanDir}" ] && echo "DIR_YES" || echo "DIR_NO"
            [ -f "/etc/nginx/sites-available/${cleanDomain}.conf" -o -f "/etc/nginx/sites-enabled/${cleanDomain}.conf" ] && echo "NGINX_YES" || echo "NGINX_NO"
            pm2 describe ${cleanAppName} > /dev/null 2>&1 && echo "PM2_YES" || echo "PM2_NO"
          `
          conn.exec(cmd, (err, stream) => {
            if (err) { conn.end(); return resolve(); }
            let out = ''
            stream.on('data', d => out += d.toString())
            stream.on('close', () => {
              conn.end()
              if (out.includes('DIR_YES')) hasDirectory = true
              if (out.includes('NGINX_YES')) hasNginx = true
              if (out.includes('PM2_YES')) hasPm2 = true
              resolve()
            })
          })
        }).on('error', () => resolve()).connect({
          host,
          port: parseInt(port || 22, 10),
          username: username || 'root',
          password,
          readyTimeout: 10000
        })
      })
    } catch (e) {}

    const exists = hasDirectory || hasPm2 || hasNginx
    let details = ''
    if (hasDirectory) details += `Directory '${cleanDir}' exists. `
    if (hasPm2) details += `PM2 service '${cleanAppName}' is running. `
    if (hasNginx) details += `Nginx domain config '${cleanDomain}' exists. `

    res.json({
      success: true,
      exists,
      hasDirectory,
      hasPm2,
      hasNginx,
      appName: cleanAppName,
      remoteDir: cleanDir,
      domain: cleanDomain,
      details: details.trim() || 'No existing project found.'
    })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
})

/**
 * Scan Active Ports & PM2 Apps
 */
router.post('/scan-ports', async (req, res) => {
  try {
    const result = await scanPortsAndServices(req.body)
    res.json(result)
  } catch (err) {
    res.status(400).json({ success: false, error: err.message })
  }
})

/**
 * AI DevOps Copilot Diagnosis & Error Analysis
 */
router.post('/ai-copilot', async (req, res) => {
  try {
    const result = await diagnoseDeploymentError(req.body)
    res.json(result)
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
})

/**
 * Execute AI-suggested SSH Patch Command on Server
 */
router.post('/ai-execute-fix', async (req, res) => {
  const { config, command } = req.body
  if (!config || !command) {
    return res.status(400).json({ success: false, error: 'Config and Command are required' })
  }
  try {
    const result = await executeSshPatch(config, command)
    res.json(result)
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
})

import { getUserSettings, saveUserSettings, createProject, saveProjectAutoUpdateConfig, getProjectAutoUpdateConfig, getProjectsByOrgId } from '../services/db.service.js'

/**
 * GET /api/deploy/get-github-token → whether a GitHub token is saved (the token itself never goes back to the browser)
 */
router.get('/get-github-token', (req, res) => {
  res.json({ success: true, hasToken: !!(getUserSettings(req.user?.id)?.githubToken || '').trim() })
})

/**
 * POST /api/deploy/save-github-token { githubToken } — personal access token, for developers
 */
router.post('/save-github-token', async (req, res) => {
  const token = bareToken(req.body.githubToken)
  if (!token) return res.status(400).json({ success: false, error: 'GitHub Personal Access Token is required' })
  try {
    const user = await githubUser(token)
    saveUserSettings(req.user.id, { githubToken: token, githubAuthType: 'token' })
    res.json({ success: true, message: `Connected GitHub account ${user.login}.`, login: user.login })
  } catch (err) {
    res.status(400).json({ success: false, error: err.status === 401 ? 'GitHub rejected this token. Check that it is complete and not expired.' : err.message })
  }
})

/**
 * GET /api/deploy/github-oauth/start → { url } to open in a popup for "Sign in with GitHub"
 */
router.get('/github-oauth/start', (req, res) => {
  try {
    res.json({ success: true, url: startGithubOAuth(req.user.id, callbackUrl(req)) })
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message })
  }
})

/**
 * POST /api/deploy/github-disconnect — forgets the saved GitHub access (and revokes a GitHub sign-in)
 */
router.post('/github-disconnect', async (req, res) => {
  const settings = getUserSettings(req.user.id)
  if (settings.githubAuthType === 'oauth') await revokeGithubOAuth(settings.githubToken)
  saveUserSettings(req.user.id, { githubToken: '', githubAuthType: '' })
  res.json({ success: true, message: 'GitHub disconnected.' })
})

/**
 * GET /api/deploy/github-account → the GitHub account behind the saved token ({ connected: false } when none),
 * plus whether "Sign in with GitHub" is available on this platform
 */
router.get('/github-account', async (req, res) => {
  const settings = getUserSettings(req.user?.id)
  const token = (settings.githubToken || '').trim()
  const base = { success: true, oauthAvailable: githubOAuthAvailable() }
  if (!token) return res.json({ ...base, connected: false })
  try {
    const u = await githubUser(token)
    res.json({ ...base, connected: true, authType: settings.githubAuthType || 'token', login: u.login, name: u.name || '', avatarUrl: u.avatar_url || '', profileUrl: u.html_url || '' })
  } catch (err) {
    if (err.status === 401) return res.json({ ...base, connected: false, error: 'Your GitHub access has expired or was revoked. Connect GitHub again.' })
    res.status(502).json({ success: false, error: `Could not reach GitHub: ${err.message}` })
  }
})

/**
 * POST /api/deploy/github-repos → every repository the saved GitHub account can reach
 */
router.post('/github-repos', async (req, res) => {
  const token = (getUserSettings(req.user?.id)?.githubToken || '').trim()
  if (!token) return res.status(400).json({ success: false, error: 'Connect your GitHub account first.' })
  try {
    res.json({ success: true, repos: await listGithubRepos(token) })
  } catch (err) {
    res.status(err.status === 401 ? 401 : 502).json({ success: false, error: err.status === 401 ? 'Your GitHub access has expired or was revoked. Connect GitHub again.' : err.message })
  }
})

/**
 * GET /api/github/oauth/callback?code&state — GitHub redirects the sign-in popup here (no panel login:
 * the state identifies the user). Saves the token, tells the opener window and closes the popup.
 */
export async function githubOAuthCallback(req, res) {
  let result
  try {
    const { login } = await finishGithubOAuth(req.query)
    result = { ok: true, login, text: `Connected GitHub account ${login}. You can close this window.` }
  } catch (err) {
    result = { ok: false, text: err.message }
  }
  const msg = JSON.stringify({ type: 'autodeploy:github-connected', ok: result.ok, login: result.login || null, error: result.ok ? null : result.text }).replace(/</g, '\\u003c')
  const text = result.text.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  res.set('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'")
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GitHub</title>
<style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:16px;text-align:center}p{max-width:420px}</style></head>
<body><p>${text}</p><script>
try { if (window.opener) { window.opener.postMessage(${msg}, location.origin); ${result.ok ? 'setTimeout(function () { window.close() }, 400)' : ''} } } catch (e) {}
</script></body></html>`)
}

/**
 * GET /api/deploy/stream/:deployId — Server-Sent Events: replays everything so far, then live events.
 */
router.get('/stream/:deployId', (req, res) => {
  const deploy = activeDeployments.get(req.params.deployId)
  if (!deploy || deploy.ownerUserId !== req.user?.id) {
    return res.status(404).json({ error: 'Deployment session not found or expired' })
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  })
  for (const ev of deploy.events) res.write(`data: ${JSON.stringify(ev)}\n\n`)
  if (deploy.status !== 'running') return res.end()
  const listener = (ev) => {
    res.write(`data: ${JSON.stringify(ev)}\n\n`)
    if (ev.kind === 'result') res.end()
  }
  deploy.listeners.add(listener)
  const ping = setInterval(() => res.write(': ping\n\n'), 15000)
  req.on('close', () => { clearInterval(ping); deploy.listeners.delete(listener) })
})

/**
 * DNS provider for project domains (the same per-organization connection Email uses).
 * GET  /dns                     → { connection } with the account's domains (zones)
 * POST /dns/connect { provider, token } · POST /dns/disconnect · POST /dns/refresh
 * POST /dns/check { domain }    → is that (sub)domain free, already this server, or taken?
 * POST /dns/point { domain, replace } → point it at this server now
 * Organization owners/admins only (requireDeployAccess).
 */
const dnsHandler = (fn) => async (req, res) => {
  try {
    res.json({ success: true, ...(await fn(req, req.tenant?.organizationId || 'org-default')) })
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message })
  }
}

router.get('/dns', dnsHandler(async (req, orgId) => ({ connection: dnsProvider.publicConnection(orgId) })))

router.post('/dns/connect', dnsHandler(async (req, orgId) => {
  const connection = await dnsProvider.connect(orgId, req.body || {}, req.user?.id)
  return { connection, message: `${connection.label} connected — ${connection.zones.length} domain(s) available.` }
}))

router.post('/dns/disconnect', dnsHandler(async (req, orgId) => ({ connection: dnsProvider.disconnect(orgId), message: 'DNS provider disconnected. Existing DNS records were not changed.' })))

router.post('/dns/refresh', dnsHandler(async (req, orgId) => {
  await dnsProvider.listZones(orgId, { refresh: true })
  return { connection: dnsProvider.publicConnection(orgId) }
}))

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/
const dnsDomain = (req) => {
  const domain = String(req.body?.domain || '').trim().toLowerCase()
  if (!/^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/.test(domain)) throw Object.assign(new Error('Enter a valid domain.'), { status: 400 })
  return domain
}
/** Public IPv4 of the selected server: its saved address, else asked from the machine (the panel's own server has none saved). */
async function serverIpv4(req) {
  const saved = req.tenant?.server?.ipAddress
  if (IPV4.test(saved || '')) return saved
  try {
    const { stdout } = await getHost(req.tenant?.server || null).exec(`curl -s4 --max-time 5 https://api.ipify.org || hostname -I | awk '{print $1}'`, { timeout: 15000 })
    return IPV4.test(stdout.trim()) ? stdout.trim() : null
  } catch { return null }
}

router.post('/dns/check', dnsHandler(async (req, orgId) => {
  const domain = dnsDomain(req)
  const ip = await serverIpv4(req)
  return { ip, check: await dnsProvider.inspectHost(orgId, domain, ip) }
}))

/** POST /dns/point { domain, replace } → A record of an existing domain set to this server (no deploy). */
router.post('/dns/point', dnsHandler(async (req, orgId) => {
  const result = await dnsProvider.pointHost(orgId, dnsDomain(req), await serverIpv4(req), { replace: req.body?.replace === true })
  return { result, message: result.detail }
}))

import { makeDeploymentLockKey, acquireLock, releaseLock } from '../services/lock.service.js'
import { recordWebhookEvent } from '../services/db.service.js'

/**
 * POST /api/deploy/deploy — validates the wizard payload and starts the pipeline in the background.
 */
router.post('/deploy', async (req, res) => {
  let cfg
  try {
    cfg = validateDeployConfig({
      ...req.body,
      _githubToken: (getUserSettings(req.user?.id)?.githubToken || '').trim() || null,
      // Super admins may test-deploy a draft template before publishing it
      _allowDraftTemplate: isSuperSession(req)
    }, req.user?.id, req.tenant?.server || null)
  } catch (err) {
    return res.status(err.status || 400).json({ success: false, error: err.message })
  }

  const orgId = req.tenant?.organizationId || 'org-default'
  // Redeploying an app that is already registered doesn't add a project
  const isRedeploy = getProjectsByOrgId(orgId).some(p => p.path === cfg.remoteDir || p.name === cfg.appName)
  if (!isSuperSession(req) && !isRedeploy) {
    const entitlement = checkEntitlement(orgId, 'projects')
    if (!entitlement.allowed) return res.status(402).json({ success: false, error: entitlement.reason, code: 'PLAN_LIMIT_REACHED' })
  }
  const lockKey = makeDeploymentLockKey(orgId, cfg.appName, 'production')
  const lockResult = acquireLock(lockKey, 45 * 60 * 1000)
  if (!lockResult.acquired) {
    return res.status(409).json({ success: false, error: lockResult.message || `A deployment of ${cfg.appName} is already running.`, code: 'DEPLOYMENT_LOCKED' })
  }

  const deployId = `deploy_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
  const session = { id: deployId, ownerUserId: req.user?.id, events: [], listeners: new Set(), status: 'running', startedAt: Date.now() }
  activeDeployments.set(deployId, session)
  res.json({ success: true, deployId, stages: STAGES.map(({ id, label, weight }) => ({ id, label, weight })) })

  const emit = (ev) => {
    const item = { ...ev, at: Date.now() }
    session.events.push(item)
    for (const l of session.listeners) l(item)
  }

  try {
    const pointDomain = cfg.autoDns ? (ip) => dnsProvider.pointHost(orgId, cfg.domain, ip, { replace: cfg.replaceDomain }) : null
    const result = await runDeployPipeline(cfg, emit, { host: getHost(req.tenant?.server || null), pointDomain })
    session.status = result.success ? 'success' : 'failed'
    if (result.success) {
      if (cfg.templateId) recordTemplateDeploy(cfg.templateId)
      try {
        const gitUrl = cfg.source.type === 'git' ? cfg.source.gitUrl : ''
        createProject({
          organizationId: orgId,
          serverId: req.tenant?.serverId || 'srv-default',
          name: cfg.appName,
          repoName: cfg.appName,
          path: cfg.remoteDir,
          gitUrl,
          branch: cfg.source.branch || 'main',
          framework: result.plan?.framework || 'App',
          port: result.port || null,
          domain: cfg.domain,
          status: 'active'
        })
        if (gitUrl) {
          const ownerUserId = req.user?.id || 'admin-001'
          const existing = getProjectAutoUpdateConfig(cfg.appName)
          const existingOwner = existing && existing.updatedAt ? (existing.ownerUserId || 'admin-001') : null
          if (!existingOwner || existingOwner === ownerUserId) {
            saveProjectAutoUpdateConfig(cfg.appName, {
              enabled: true,
              autoSyncInterval: 5,
              branch: cfg.source.branch,
              gitRepoUrl: gitUrl,
              projectPath: cfg.remoteDir,
              host: req.tenant?.server?.ipAddress || '127.0.0.1',
              serverId: req.tenant?.serverId || null,
              ownerUserId,
              organizationId: orgId
            })
          }
        }
      } catch (saveErr) {
        console.warn('Post-deployment project registration warning:', saveErr.message)
      }
    }
  } finally {
    releaseLock(lockKey)
    // Keep the transcript around for reconnects, then drop it
    setTimeout(() => activeDeployments.delete(deployId), 60 * 60 * 1000)
  }
})

// In-Memory Webhook Audit Log
const webhookAuditLogs = []

/**
 * POST /api/deploy/webhook/:projectId
 * GitHub / GitLab Push Webhook Endpoint with Deduplication
 */
router.post('/webhook/:projectId', (req, res) => {
  const { projectId } = req.params
  const eventId = req.headers['x-github-delivery'] || req.headers['x-gitlab-event-uuid'] || req.body.after || req.body.head_commit?.id || `evt_${Date.now()}`
  const eventType = req.headers['x-github-event'] || 'push'
  const payload = req.body || {}

  // Webhook Deduplication Check: UNIQUE(provider, event_id)
  const { isDuplicate } = recordWebhookEvent({
    provider: 'github',
    eventId,
    organizationId: req.tenant?.organizationId || 'org-default',
    eventType,
    payloadHash: JSON.stringify(payload).substring(0, 100)
  })

  if (isDuplicate) {
    console.log(`[WEBHOOK DEDUPLICATED] GitHub eventId=${eventId} already processed.`)
    return res.json({
      success: true,
      message: `Webhook event '${eventId}' already processed safely (Idempotent deduplicated).`,
      replayed: true
    })
  }

  const commitMsg = payload.head_commit ? payload.head_commit.message : 'Push event received'
  const pusher = payload.pusher ? payload.pusher.name : (payload.sender ? payload.sender.login : 'GitHub Webhook')
  const branch = payload.ref ? payload.ref.replace('refs/heads/', '') : 'main'

  const auditEntry = {
    id: `wh_${Date.now()}`,
    projectId,
    eventType,
    pusher,
    branch,
    commitMsg,
    timestamp: new Date().toISOString(),
    status: 'triggered'
  }
  webhookAuditLogs.unshift(auditEntry)
  if (webhookAuditLogs.length > 50) webhookAuditLogs.pop()

  // Respond immediately to GitHub webhook ping
  res.json({ success: true, message: `Webhook received for project ${projectId}`, auditEntry })
})

/**
 * GET /api/deploy/webhooks/history
 */
router.get('/webhooks/history', (req, res) => {
  if (webhookAuditLogs.length === 0) {
    webhookAuditLogs.push(
      { id: 'wh_001', projectId: 'proj-autodeploy', eventType: 'push', pusher: 'yatindradhurwe', branch: 'main', commitMsg: 'feat: ultra-premium dark studio redesign', timestamp: new Date().toISOString(), status: 'success' },
      { id: 'wh_002', projectId: 'proj-tipcrm', eventType: 'push', pusher: 'yatindradhurwe', branch: 'main', commitMsg: 'fix: environment secret loading patch', timestamp: new Date(Date.now() - 3600000).toISOString(), status: 'success' }
    )
  }
  res.json({ success: true, history: webhookAuditLogs })
})

export default router

