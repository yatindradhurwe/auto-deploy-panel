import express from 'express'
import { authenticateToken } from '../middleware/auth.middleware.js'
import { getAllUsers, getAllOrganizations, getAllServers, readDb } from '../services/db.service.js'

const router = express.Router()

// Super Admin authorization check
const requireSuperAdmin = (req, res, next) => {
  if (req.user && (req.user.id === 'admin-001' || req.user.role === 'admin')) {
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

export default router
