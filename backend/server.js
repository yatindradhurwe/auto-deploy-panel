import express from 'express'
import cors from 'cors'
import authRoutes from './routes/auth.routes.js'
import deployRoutes from './routes/deploy.routes.js'
import { authenticateToken } from './middleware/auth.middleware.js'

const app = express()
const PORT = process.env.PORT || 4000

app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Health Check (Public Endpoint)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    service: 'AutoDeploy Console Backend Engine',
    version: '1.1.0',
    authEnabled: true,
    timestamp: new Date().toISOString(),
  })
})

// Authentication Routes (Public Endpoint)
app.use('/api/auth', authRoutes)

// Protected Deployment Routes (Requires valid JWT Token)
app.use('/api/deploy', authenticateToken, deployRoutes)

app.listen(PORT, () => {
  console.log(`[AUTODEPLOY-BACKEND] Listening on http://localhost:${PORT}`)
})
