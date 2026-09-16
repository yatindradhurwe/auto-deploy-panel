import express from 'express'
import { testSshConnection, scanPortsAndServices, executeDeployment } from '../services/ssh.service.js'

const router = express.Router()

// In-memory store for active streaming deployments
const activeDeployments = new Map()

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
 * Trigger Deployment with Server-Sent Events (SSE) Live Log Streaming
 */
router.get('/stream/:deployId', (req, res) => {
  const { deployId } = req.params
  const deploy = activeDeployments.get(deployId)

  if (!deploy) {
    return res.status(404).json({ error: 'Deployment session not found or expired' })
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  // Send historical logs first
  deploy.logs.forEach((log) => {
    res.write(`data: ${JSON.stringify(log)}\n\n`)
  })

  // Add listener for new logs
  const logListener = (logData) => {
    res.write(`data: ${JSON.stringify(logData)}\n\n`)
  }

  deploy.listeners.push(logListener)

  req.on('close', () => {
    deploy.listeners = deploy.listeners.filter((l) => l !== logListener)
  })
})

/**
 * Start Deployment Session
 */
router.post('/deploy', async (req, res) => {
  const deployId = `deploy_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
  const deploySession = {
    id: deployId,
    config: req.body,
    logs: [],
    listeners: [],
    status: 'running',
    startedAt: new Date().toISOString(),
  }

  activeDeployments.set(deployId, deploySession)

  // Respond immediately with deployId
  res.json({ success: true, deployId })

  // Execute deployment in background and broadcast logs
  const onLog = (chunk, isError = false, step = 'LOG') => {
    const logItem = {
      text: chunk,
      isError,
      step,
      timestamp: new Date().toISOString(),
    }
    deploySession.logs.push(logItem)
    deploySession.listeners.forEach((listener) => listener(logItem))
  }

  try {
    await executeDeployment(req.body, onLog)
    deploySession.status = 'success'
    onLog(`[FINISHED] Deployment completed successfully!`, false, 'END')
  } catch (err) {
    deploySession.status = 'failed'
    onLog(`[FAILED] Deployment error: ${err.message}`, true, 'END')
  }
})

export default router
