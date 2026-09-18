import express from 'express'
import cors from 'cors'
import authRoutes from './routes/auth.routes.js'
import deployRoutes from './routes/deploy.routes.js'
import studioRoutes from './routes/studio.routes.js'
import billingRoutes from './routes/billing.routes.js'
import agentRoutes from './routes/agent.routes.js'
import teamRoutes from './routes/team.routes.js'
import adminRoutes from './routes/admin.routes.js'
import { authenticateToken } from './middleware/auth.middleware.js'
import { initAutoUpdateService, executeProjectAutoUpdate } from './services/autoupdate.service.js'

const app = express()
const PORT = process.env.PORT || 4000

app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// Direct route for install.sh agent installer script
app.use('/', agentRoutes)

// Health Check (Public Endpoint)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    service: 'AutoDeploy Multi-Tenant SaaS Engine',
    version: '3.0.0-saas',
    authEnabled: true,
    studioEnabled: true,
    multiTenant: true,
    timestamp: new Date().toISOString(),
  })
})

// Public GitHub Webhook Endpoint (Called automatically on git push)
app.post('/api/webhooks/github/:appName', (req, res) => {
  const { appName } = req.params
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

// Agent Management Routes
app.use('/api/agent', agentRoutes)

// Protected SaaS Subscriptions & Billing Routes
app.use('/api/billing', billingRoutes)

// Protected Team Management & RBAC Routes
app.use('/api/team', teamRoutes)

// Super Admin Platform Monitoring Routes
app.use('/api/admin', adminRoutes)

// Protected Deployment & Studio Routes (Requires valid JWT Token)
app.use('/api/deploy', authenticateToken, deployRoutes)
app.use('/api/studio', authenticateToken, studioRoutes)

app.listen(PORT, () => {
  console.log(`[AUTODEPLOY-STUDIO-BACKEND] Multi-Tenant Engine Listening on http://localhost:${PORT}`)
  initAutoUpdateService()
})
