import express from 'express'
import cors from 'cors'
import deployRoutes from './routes/deploy.routes.js'

const app = express()
const PORT = process.env.PORT || 4000

app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    service: 'AutoDeploy Console Backend Engine',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  })
})

// Register Deployment Routes
app.use('/api/deploy', deployRoutes)

app.listen(PORT, () => {
  console.log(`[AUTODEPLOY-BACKEND] Listening on http://localhost:${PORT}`)
})
