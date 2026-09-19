import express from 'express'
import { authenticateToken } from '../middleware/auth.middleware.js'
import { getAllUsers, getAllOrganizations, getAllServers, readDb } from '../services/db.service.js'

const router = express.Router()

// Super Admin authorization check
const requireSuperAdmin = (req, res, next) => {
  if (req.user && (req.user.id === 'admin-001' || (req.user.role && req.user.role.toLowerCase().includes('admin')) || req.user.email === 'admin@tipcrm.com')) {
    return next()
  }
  return res.status(403).json({ error: 'Access denied: Super Admin privilege required.' })
}

/**
 * GET /api/admin/overview
 * Platform-wide Super Admin analytics
 */
router.get('/overview', authenticateToken, requireSuperAdmin, (req, res) => {
  try {
    const users = getAllUsers()
    const orgs = getAllOrganizations()
    const servers = getAllServers()
    const db = readDb()
    const subscriptions = Object.values(db.subscriptions || {})

    res.json({
      metrics: {
        totalUsers: users.length,
        totalOrganizations: orgs.length,
        totalServers: servers.length,
        totalSubscriptions: subscriptions.length,
        activeSubscriptions: subscriptions.filter(s => s.status === 'active').length
      },
      recentUsers: users.slice(-5).reverse(),
      recentOrganizations: orgs.slice(-5).reverse()
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * GET /api/admin/users
 */
router.get('/users', authenticateToken, requireSuperAdmin, (req, res) => {
  try {
    const users = getAllUsers()
    res.json({ users })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * GET /api/admin/organizations
 */
router.get('/organizations', authenticateToken, requireSuperAdmin, (req, res) => {
  try {
    const orgs = getAllOrganizations()
    res.json({ organizations: orgs })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * GET /api/admin/servers
 */
router.get('/servers', authenticateToken, requireSuperAdmin, (req, res) => {
  try {
    const servers = getAllServers()
    res.json({ servers })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * GET /api/admin/subscriptions
 */
router.get('/subscriptions', authenticateToken, requireSuperAdmin, (req, res) => {
  try {
    const db = readDb()
    const subscriptions = Object.values(db.subscriptions || {})
    res.json({ subscriptions })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * POST /api/admin/users/delete
 */
router.post('/users/delete', authenticateToken, requireSuperAdmin, (req, res) => {
  try {
    const { userId } = req.body
    if (!userId || userId === 'admin-001') {
      return res.status(400).json({ error: 'Cannot delete primary system admin account.' })
    }
    const db = readDb()
    delete db.users[userId]
    // Write db updates
    fs.writeFileSync(path.resolve(process.cwd(), 'data/db.json'), JSON.stringify(db, null, 2))
    res.json({ success: true, message: `User ${userId} deleted successfully.` })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

import { getIdempotencyStats, getAllIdempotencyRecords } from '../services/db.service.js'

/**
 * GET /api/admin/idempotency/stats
 * Summary statistics for Admin Idempotency Dashboard
 */
router.get('/idempotency/stats', authenticateToken, requireSuperAdmin, (req, res) => {
  try {
    const stats = getIdempotencyStats()
    res.json({ success: true, stats })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * GET /api/admin/idempotency/records
 * Full audit list of Idempotency records
 */
router.get('/idempotency/records', authenticateToken, requireSuperAdmin, (req, res) => {
  try {
    const records = getAllIdempotencyRecords()
    res.json({ success: true, records })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * GET /api/admin/audit-logs
 * Platform-wide Audit Trail
 */
router.get('/audit-logs', authenticateToken, requireSuperAdmin, (req, res) => {
  try {
    const db = readDb()
    const logs = db.auditLogs || []
    res.json({ success: true, logs })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
