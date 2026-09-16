import express from 'express'
import cors from 'cors'
import authRoutes from './routes/auth.routes.js'
import deployRoutes from './routes/deploy.routes.js'
import studioRoutes from './routes/studio.routes.js'
import { authenticateToken } from './middleware/auth.middleware.js'

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
    authEnabled: true,
    studioEnabled: true,
    timestamp: new Date().toISOString(),
  })
})

// Authentication Routes (Public Endpoint)
app.use('/api/auth', authRoutes)

// Protected Deployment & Studio Routes (Requires valid JWT Token)
app.use('/api/deploy', authenticateToken, deployRoutes)
app.use('/api/studio', authenticateToken, studioRoutes)

app.listen(PORT, () => {
  console.log(`[AUTODEPLOY-STUDIO-BACKEND] Listening on http://localhost:${PORT}`)
})
