import express from 'express'
import https from 'https'
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
 * Fetch Repositories from GitHub API using Personal Access Token
 */
router.post('/github-repos', async (req, res) => {
  const { githubToken } = req.body
  if (!githubToken) {
    return res.status(400).json({ success: false, error: 'GitHub Personal Access Token is required' })
  }

  const options = {
    hostname: 'api.github.com',
    path: '/user/repos?per_page=100&sort=updated',
    method: 'GET',
    headers: {
      'Authorization': `token ${githubToken.trim()}`,
      'User-Agent': 'AutoDeploy-Console-App',
      'Accept': 'application/vnd.github.v3+json'
    }
  }

  const request = https.request(options, (apiRes) => {
    let body = ''
    apiRes.on('data', (chunk) => { body += chunk })
    apiRes.on('end', () => {
      if (apiRes.statusCode >= 200 && apiRes.statusCode < 300) {
        try {
          const repos = JSON.parse(body)
          const formatted = repos.map((repo) => {
            const cleanUrl = repo.clone_url
            // Embed token into clone URL if repository is private
            const authUrl = repo.private
              ? cleanUrl.replace('https://', `https://${githubToken.trim()}@`)
              : cleanUrl

            return {
              id: repo.id,
              name: repo.name,
              full_name: repo.full_name,
              private: repo.private,
              description: repo.description,
              html_url: repo.html_url,
              clone_url: cleanUrl,
              authenticated_url: authUrl,
              default_branch: repo.default_branch || 'main',
              updated_at: repo.updated_at,
              language: repo.language
            }
          })
          res.json({ success: true, repos: formatted })
        } catch (e) {
          res.status(500).json({ success: false, error: 'Failed to parse GitHub API response' })
        }
      } else {
        res.status(apiRes.statusCode).json({ success: false, error: `GitHub API error: Status ${apiRes.statusCode}` })
      }
    })
  })

  request.on('error', (err) => {
    res.status(500).json({ success: false, error: `GitHub Request failed: ${err.message}` })
  })

  request.end()
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
