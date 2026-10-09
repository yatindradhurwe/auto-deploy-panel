import express from 'express'
import cors from 'cors'
import crypto from 'crypto'
import { execSync } from 'child_process'
import authRoutes from './routes/auth.routes.js'
import deployRoutes from './routes/deploy.routes.js'
import studioRoutes from './routes/studio.routes.js'
import billingRoutes from './routes/billing.routes.js'
import agentRoutes from './routes/agent.routes.js'
import teamRoutes from './routes/team.routes.js'
import adminRoutes from './routes/admin.routes.js'
import supportRoutes from './routes/support.routes.js'
import profileRoutes from './routes/profile.routes.js'
import projectsRoutes from './routes/projects.routes.js'
import templatesRoutes from './routes/templates.routes.js'
import { authenticateToken } from './middleware/auth.middleware.js'
import { requireStudioAccess, requireDeployAccess } from './middleware/studioAccess.middleware.js'
import { initAutoUpdateService, executeProjectAutoUpdate } from './services/autoupdate.service.js'
import { initMailService } from './services/mail.service.js'

const app = express()
// nginx on the same host terminates TLS; trust its X-Forwarded-For so req.ip is the real client (rate limits, audit)
app.set('trust proxy', 'loopback')
const PORT = process.env.PORT || 4040
// Nginx proxies to 127.0.0.1:4040, so the API does not need to listen on public interfaces
const HOST = process.env.HOST || '127.0.0.1'

app.use(cors())
app.use(express.json({
  limit: '10mb',
  // Keep the raw body so GitHub webhook signatures can be verified
  verify: (req, res, buf) => { req.rawBody = buf }
}))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// Direct route for install.sh agent installer script
app.use('/', agentRoutes)

// Health Check (Public Endpoint)
app.get('/api/health', (req, res) => {
  let lastGitCommitTime = new Date().toISOString()
  try {
    const gitLog = execSync('git log -1 --format=%cd', { encoding: 'utf8' }).trim()
    if (gitLog) lastGitCommitTime = new Date(gitLog).toISOString()
  } catch(e) {}

  res.json({
    status: 'online',
    service: 'AutoDeploy Multi-Tenant SaaS Engine',
    version: '3.0.0-saas',
    authEnabled: true,
    studioEnabled: true,
    multiTenant: true,
    lastCodeUpdate: lastGitCommitTime,
    lastCodeUpdateFormatted: new Date(lastGitCommitTime).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }),
    timestamp: new Date().toISOString(),
  })
})

// Public GitHub Webhook Endpoint (Called automatically on git push)
app.post('/api/webhooks/github/:appName', (req, res) => {
  const { appName } = req.params

  // Verify GitHub HMAC signature (set the same secret in GitHub > Settings > Webhooks)
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET
  if (webhookSecret) {
    const signature = req.headers['x-hub-signature-256'] || ''
    const expected = 'sha256=' + crypto.createHmac('sha256', webhookSecret).update(req.rawBody || '').digest('hex')
    const valid = signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    if (!valid) {
      return res.status(401).json({ success: false, error: 'Invalid webhook signature' })
    }
  } else {
    console.warn('[GITHUB WEBHOOK] GITHUB_WEBHOOK_SECRET is not set — webhook requests are not being verified')
  }

  if (!/^[a-zA-Z0-9._-]+$/.test(appName)) {
    return res.status(400).json({ success: false, error: 'Invalid app name' })
  }
  const payload = req.body || {}
  const pusherName = payload.pusher ? payload.pusher.name : (payload.sender ? payload.sender.login : 'GitHub Webhook')
  const commitMsg = payload.head_commit ? payload.head_commit.message : 'GitHub Push Event Received'

  console.log(`[GITHUB WEBHOOK RECEIVED] Triggering live server auto-update for project '${appName}'...`)

  executeProjectAutoUpdate(appName, 'webhook', { pusher: pusherName, commitMsg })
    .catch(err => console.error(`[GITHUB WEBHOOK FAILED] for '${appName}':`, err.message))

  res.json({
    success: true,
    message: `Antigravity Auto-Update triggered for project '${appName}' via GitHub push event`,
    appName,
    pusher: pusherName,
    timestamp: new Date().toISOString()
  })
})

// Public Authentication & Onboarding Routes
app.use('/api/auth', authRoutes)

import { requireTenant } from './middleware/tenant.middleware.js'
import { requireIdempotency } from './middleware/idempotency.middleware.js'

// Apply Idempotency Middleware to state-mutating endpoints
app.use('/api/agent', requireIdempotency(), agentRoutes)
app.use('/api/billing', requireIdempotency(), billingRoutes)
app.use('/api/team', teamRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/support', supportRoutes)
app.use('/api/profile', profileRoutes)

// Protected Deployment & Studio Routes (Requires valid JWT Token & Tenant Context)
app.use('/api/deploy', authenticateToken, requireTenant, requireDeployAccess, requireIdempotency(), deployRoutes)
// Studio runs shell commands, file and database operations on servers. Super admins get everything;
// organization users only their own servers and the projects they may access (studioAccess.middleware)
app.use('/api/studio', authenticateToken, requireTenant, requireStudioAccess, requireIdempotency(), studioRoutes)
app.use('/api/projects', projectsRoutes)
app.use('/api/templates', templatesRoutes)

app.listen(PORT, HOST, () => {
  console.log(`[AUTODEPLOY-STUDIO-BACKEND] Multi-Tenant Engine Listening on http://${HOST}:${PORT}`)
  initAutoUpdateService()
  initMailService()
})
