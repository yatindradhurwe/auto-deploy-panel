import express from 'express'
import { registerAgentServer, processAgentHeartbeat, generateInstallScriptHtml } from '../services/agent.service.js'
import { authenticateToken } from '../middleware/auth.middleware.js'
import { requireTenant } from '../middleware/tenant.middleware.js'
import { getServersByOrgId, createServer, updateServer, deleteServer } from '../services/db.service.js'

const router = express.Router()

/**
 * GET /install.sh
 * Serves the shell agent installer for curl -fsSL ... | bash
 */
router.get('/install.sh', (req, res) => {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol
  const host = req.headers['x-forwarded-host'] || req.headers.host
  const hostUrl = `${protocol}://${host}`
  const scriptContent = generateInstallScriptHtml(hostUrl)
  
  res.setHeader('Content-Type', 'text/plain')
  res.send(scriptContent)
})

/**
 * POST /api/agent/register
 * Outbound call from client VPS node during installation
 */
router.post('/register', (req, res) => {
  try {
    const { organizationId, token, hostname, ipAddress, os, cpu, ram, disk } = req.body
    const result = registerAgentServer({
      organizationId: organizationId || 'org-default',
      token,
      hostname,
      ipAddress: ipAddress || req.ip || '127.0.0.1',
      os,
      cpu,
      ram,
      disk
    })
    res.json({ success: true, ...result })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
})

/**
 * POST /api/agent/heartbeat
 * Periodic system metric heartbeat from installed client agent
 */
router.post('/heartbeat', (req, res) => {
  try {
    const { serverId, agentToken, metrics } = req.body
    const updatedServer = processAgentHeartbeat({ serverId, agentToken, metrics })
    res.json({ success: true, server: updatedServer })
  } catch (err) {
    res.status(400).json({ success: false, error: err.message })
  }
})

/**
 * GET /api/agent/servers
 * Retrieve list of servers for active tenant
 */
router.get('/servers', authenticateToken, requireTenant, (req, res) => {
  try {
    const servers = getServersByOrgId(req.tenant.organizationId)
    res.json({ servers })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * POST /api/agent/servers
 * Manually connect a new server via SSH / IP credentials
 */
router.post('/servers', authenticateToken, requireTenant, (req, res) => {
  try {
    const { name, hostname, ipAddress, port = 22, username = 'root', password, domain } = req.body
    
    if (!ipAddress) {
      return res.status(400).json({ error: 'Server IP Address is required.' })
    }

    const server = createServer({
      organizationId: req.tenant.organizationId,
      name: name || `VPS (${ipAddress})`,
      hostname: hostname || ipAddress,
      ipAddress,
      port,
      username,
      status: 'online',
      domain: domain || ''
    })

    res.json({ success: true, server })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * DELETE /api/agent/servers/:id
 */
router.delete('/servers/:id', authenticateToken, requireTenant, (req, res) => {
  try {
    const deleted = deleteServer(req.params.id)
    res.json({ success: deleted })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
