import express from 'express'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { authenticateToken } from '../middleware/auth.middleware.js'
import {
  getUserByEmail,
  getUserById,
  createUser,
  updateUser,
  getOrganizationsByUserId,
  getOrganizationById,
  createOrganization,
  getServersByOrgId,
  getUserSettings,
  saveUserSettings,
  recordAuditLog
} from '../services/db.service.js'

const router = express.Router()

const JWT_SECRET = process.env.JWT_SECRET || 'autodeploy_super_secret_jwt_key_2026'

// Configurable System Default Admin
const DEFAULT_ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@tipcrm.com').toLowerCase()
const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'

/**
 * POST /api/auth/signup
 */
router.post('/signup', (req, res) => {
  try {
    const { fullName, email, password, orgName } = req.body

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' })
    }

    const cleanEmail = email.trim().toLowerCase()
    const existingUser = getUserByEmail(cleanEmail)
    if (existingUser) {
      return res.status(400).json({ error: 'An account with this email address already exists.' })
    }

    const salt = bcrypt.genSaltSync(10)
    const passwordHash = bcrypt.hashSync(password, salt)
    const verificationToken = Math.random().toString(36).substring(2, 15) + Date.now().toString(36)

    // Create User
    const newUser = createUser({
      fullName: fullName || cleanEmail.split('@')[0],
      email: cleanEmail,
      passwordHash,
      isVerified: true,
      verificationToken
    })

    // Create default Organization for user
    const organizationName = orgName || `${newUser.fullName}'s Workspace`
    const org = createOrganization({
      name: organizationName,
      ownerId: newUser.id,
      planId: 'FREE'
    })

    // Update user primary organizationId
    updateUser(newUser.id, { organizationId: org.id })

    // Generate Token
    const payload = {
      id: newUser.id,
      name: newUser.fullName,
      email: newUser.email,
      organizationId: org.id,
      role: 'user'
    }
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' })

    recordAuditLog({
      organizationId: org.id,
      userId: newUser.id,
      action: 'USER_SIGNUP',
      resourceType: 'user',
      resourceId: newUser.id,
      ip: req.ip || req.headers['x-forwarded-for'] || '127.0.0.1',
      details: { email: cleanEmail, orgName: organizationName }
    })

    res.json({
      message: 'Account created successfully!',
      token,
      user: {
        id: newUser.id,
        fullName: newUser.fullName,
        email: newUser.email,
        organizationId: org.id,
        isVerified: newUser.isVerified
      },
      organization: org
    })
  } catch (err) {
    console.error('[SIGNUP ERROR]:', err)
    res.status(500).json({ error: err.message || 'Failed to create account.' })
  }
})

/**
 * POST /api/auth/login
 */
router.post('/login', (req, res) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ error: 'Email address and password are required.' })
    }

    const cleanEmail = email.trim().toLowerCase()
    let user = getUserByEmail(cleanEmail)

    // Handle system default admin fallback if not yet in DB users
    if (!user && cleanEmail === DEFAULT_ADMIN_EMAIL) {
      user = getUserById('admin-001')
      if (!user) {
        user = createUser({
          id: 'admin-001',
          fullName: 'System Admin',
          email: DEFAULT_ADMIN_EMAIL,
          passwordHash: bcrypt.hashSync(DEFAULT_ADMIN_PASSWORD, 10),
          organizationId: 'org-default',
          isVerified: true
        })
      }
    }

    if (!user) {
      return res.status(401).json({ error: 'Invalid email address or password.' })
    }

    // Check Password
    let isValidPassword = false
    if (user.passwordHash) {
      isValidPassword = bcrypt.compareSync(password, user.passwordHash)
    }
    if (!isValidPassword && cleanEmail === DEFAULT_ADMIN_EMAIL && password === DEFAULT_ADMIN_PASSWORD) {
      isValidPassword = true
    }

    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid email address or password.' })
    }

    // Resolve user's organizations
    const orgs = getOrganizationsByUserId(user.id)
    const activeOrgId = user.organizationId || (orgs.length > 0 ? orgs[0].id : 'org-default')
    const activeOrg = getOrganizationById(activeOrgId) || (orgs.length > 0 ? orgs[0] : null)
    const servers = activeOrgId ? getServersByOrgId(activeOrgId) : []

    // Sign JWT
    const payload = {
      id: user.id,
      name: user.fullName,
      email: user.email,
      organizationId: activeOrgId,
      role: user.id === 'admin-001' ? 'admin' : 'user'
    }

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' })

    recordAuditLog({
      organizationId: activeOrgId,
      userId: user.id,
      action: 'USER_LOGIN',
      resourceType: 'auth',
      resourceId: user.id,
      ip: req.ip || req.headers['x-forwarded-for'] || '127.0.0.1'
    })

    res.json({
      message: 'Authentication successful',
      token,
      user: {
        id: user.id,
        fullName: user.fullName || user.name,
        name: user.fullName || user.name,
        email: user.email,
        organizationId: activeOrgId,
        role: user.id === 'admin-001' ? 'admin' : 'user',
        avatar: user.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=150'
      },
      organizations: orgs,
      activeOrganization: activeOrg,
      servers
    })
  } catch (err) {
    console.error('[LOGIN ERROR]:', err)
    res.status(500).json({ error: err.message || 'Login failed.' })
  }
})

/**
 * GET /api/auth/me
 */
router.get('/me', authenticateToken, (req, res) => {
  try {
    const user = getUserById(req.user.id) || req.user
    const orgs = getOrganizationsByUserId(user.id)
    const activeOrgId = user.organizationId || (orgs.length > 0 ? orgs[0].id : 'org-default')
    const activeOrg = getOrganizationById(activeOrgId)
    const servers = activeOrgId ? getServersByOrgId(activeOrgId) : []

    res.json({
      user: {
        id: user.id,
        fullName: user.fullName || user.name || 'User',
        name: user.fullName || user.name || 'User',
        email: user.email,
        organizationId: activeOrgId,
        role: user.id === 'admin-001' ? 'admin' : 'user',
        avatar: user.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=150'
      },
      organizations: orgs,
      activeOrganization: activeOrg,
      servers
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * POST /api/auth/onboarding
 * Complete onboarding workflow: create organization, choose plan, generate install script command
 */
router.post('/onboarding', authenticateToken, (req, res) => {
  try {
    const { orgName, planId = 'STARTER' } = req.body
    const userId = req.user.id

    let org = null
    if (orgName) {
      org = createOrganization({ name: orgName, ownerId: userId, planId })
      updateUser(userId, { organizationId: org.id })
    } else {
      const user = getUserById(userId)
      org = getOrganizationById(user.organizationId)
    }

    // Generate installation curl command for server agent
    const agentToken = `tok_${Math.random().toString(36).substring(2, 15)}`
    const installCommand = `curl -fsSL https://automate-deployment.yjtechnosoft.com/install.sh | sudo bash -s -- --token=${agentToken} --org=${org ? org.id : 'org-default'}`

    recordAuditLog({
      organizationId: org ? org.id : 'org-default',
      userId,
      action: 'ONBOARDING_COMPLETED',
      resourceType: 'organization',
      resourceId: org ? org.id : 'org-default'
    })

    res.json({
      success: true,
      message: 'Onboarding completed successfully',
      organization: org,
      agentToken,
      installCommand
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * GET /api/auth/settings
 */
router.get('/settings', authenticateToken, (req, res) => {
  try {
    const userId = req.user.id
    const settings = getUserSettings(userId)
    res.json({ success: true, settings })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
})

/**
 * POST /api/auth/settings
 */
router.post('/settings', authenticateToken, (req, res) => {
  try {
    const userId = req.user.id
    const newSettings = req.body || {}
    const updated = saveUserSettings(userId, newSettings)
    res.json({ success: true, settings: updated, message: 'Settings stored in database successfully' })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
})

/**
 * POST /api/auth/logout
 */
router.post('/logout', authenticateToken, (req, res) => {
  res.json({ message: 'Session logged out successfully' })
})

export default router
