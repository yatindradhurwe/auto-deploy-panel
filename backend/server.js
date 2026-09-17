import express from 'express'
import cors from 'cors'
import authRoutes from './routes/auth.routes.js'
import deployRoutes from './routes/deploy.routes.js'
import studioRoutes from './routes/studio.routes.js'
import { authenticateToken } from './middleware/auth.middleware.js'
import { initAutoUpdateService, executeProjectAutoUpdate } from './services/autoupdate.service.js'

const app = express()
const PORT = process.env.PORT || 4000

app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// Health Check (Public Endpoint)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    service: 'AutoDeploy Console & AI Studio Backend Engine',
    version: '2.0.0',
    lastUpdated: '2026-09-17 15:06:00 IST',
    commit: 'b068867',
    authEnabled: true,
    studioEnabled: true,
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

  // Asynchronously trigger Antigravity Auto-Update
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

// Authentication Routes (Public Endpoint)
app.use('/api/auth', authRoutes)

// Protected Deployment & Studio Routes (Requires valid JWT Token)
app.use('/api/deploy', authenticateToken, deployRoutes)
app.use('/api/studio', authenticateToken, studioRoutes)

app.listen(PORT, () => {
  console.log(`[AUTODEPLOY-STUDIO-BACKEND] Listening on http://localhost:${PORT}`)
  initAutoUpdateService()
})

