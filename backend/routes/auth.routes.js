import express from 'express'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { authenticateToken, signSessionToken } from '../middleware/auth.middleware.js'
import { getPlatformRole, getUserStatus, getPlatformSettings } from '../services/admin.service.js'
import { revokeSession } from '../services/session.service.js'
import { createRateLimiter, rejectIfLimited, clientIp } from '../middleware/rateLimit.middleware.js'
import {
  getUserByEmail,
  getUserById,
  createUser,
  updateUser,
  getOrganizationsByUserId,
  getOrganizationById,
  createOrganization,
  updateOrganization,
  getServersByOrgId,
  getUserSettings,
  saveUserSettings,
  recordAuditLog
} from '../services/db.service.js'

const router = express.Router()

// Configurable System Default Admin (bootstrap password only comes from env, never a hardcoded default)
const DEFAULT_ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@tipcrm.com').toLowerCase()
const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ''

// Brute-force protection: per account+IP and per IP
const loginByAccount = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 8 })
const loginByIp = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 40 })
const signupByIp = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 10 })

// Compared against when the account doesn't exist, so response time doesn't reveal which emails are registered
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('autodeploy-timing-equalizer', 10)

/**
 * POST /api/auth/signup
 */
router.post('/signup', (req, res) => {
  try {
    const { fullName, email, password, orgName } = req.body
    if (rejectIfLimited(res, [[signupByIp, clientIp(req)]])) return

    const platform = getPlatformSettings()
    if (!platform.allowSignups) {
      return res.status(403).json({ error: 'New account registration is currently closed.', code: 'SIGNUPS_DISABLED' })
    }
    if (platform.maintenanceMode) {
      return res.status(503).json({ error: platform.maintenanceMessage, code: 'MAINTENANCE_MODE' })
    }

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' })
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' })
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
      planId: platform.defaultSignupPlanId || 'FREE'
    })

    // Update user primary organizationId
    updateUser(newUser.id, { organizationId: org.id })

    const token = signSessionToken(newUser, { organizationId: org.id, req })

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
        role: 'admin',
        portal: 'panel',
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
    // Super admins and organization admins sign in through separate portals
    const portal = req.body.portal === 'console' ? 'console' : 'panel'

    if (!email || !password) {
      return res.status(400).json({ error: 'Email address and password are required.' })
    }

    const cleanEmail = String(email).trim().toLowerCase()
    const accountKey = `${clientIp(req)}|${cleanEmail}`
    if (rejectIfLimited(res, [[loginByAccount, accountKey], [loginByIp, clientIp(req)]])) return
    let user = getUserByEmail(cleanEmail)

    // Handle system default admin fallback if not yet in DB users
    if (!user && cleanEmail === DEFAULT_ADMIN_EMAIL && DEFAULT_ADMIN_PASSWORD) {
      user = getUserById('admin-001')
      // Once the primary admin has changed their email from the profile page, the bootstrap email no longer signs in
      if (user && user.email !== DEFAULT_ADMIN_EMAIL) {
        user = null
      } else if (!user) {
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

    const isValidPassword = bcrypt.compareSync(String(password), (user && user.passwordHash) || DUMMY_PASSWORD_HASH) && !!(user && user.passwordHash)
    if (!user) {
      return res.status(401).json({ error: 'Invalid email address or password.' })
    }

    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid email address or password.' })
    }

    const role = getPlatformRole(user)
    // Don't confirm to the console login that a customer's password is right
    if (portal === 'console' && role !== 'superadmin') {
      return res.status(401).json({ error: 'Invalid email address or password.' })
    }
    if (portal === 'panel' && role === 'superadmin') {
      return res.status(403).json({ error: 'Super admin accounts sign in through the super admin portal.', code: 'USE_CONSOLE_LOGIN', loginUrl: '/admin/login' })
    }

    if (getUserStatus(user) === 'suspended') {
      return res.status(403).json({ error: `Your account has been suspended.${user.suspendedReason ? ` Reason: ${user.suspendedReason}` : ''} Contact support for help.`, code: 'ACCOUNT_SUSPENDED' })
    }
    const platform = getPlatformSettings()
    if (platform.maintenanceMode && getPlatformRole(user) !== 'superadmin') {
      return res.status(503).json({ error: platform.maintenanceMessage, code: 'MAINTENANCE_MODE' })
    }

    loginByAccount.reset(accountKey)
    const loginIp = req.headers['x-forwarded-for'] || req.ip || '127.0.0.1'
    updateUser(user.id, { lastLoginAt: new Date().toISOString(), lastLoginIp: String(loginIp).split(',')[0].trim() })

    // Resolve user's organizations
    const orgs = getOrganizationsByUserId(user.id)
    const activeOrgId = user.organizationId || (orgs.length > 0 ? orgs[0].id : 'org-default')
    const activeOrg = getOrganizationById(activeOrgId) || (orgs.length > 0 ? orgs[0] : null)
    const servers = activeOrgId ? getServersByOrgId(activeOrgId) : []

    const token = signSessionToken(user, { organizationId: activeOrgId, req })

    recordAuditLog({
      organizationId: activeOrgId,
      userId: user.id,
      action: 'USER_LOGIN',
      resourceType: 'auth',
      resourceId: user.id,
      ip: req.ip || req.headers['x-forwarded-for'] || '127.0.0.1',
      details: { portal }
    })

    res.json({
      message: 'Authentication successful',
      token,
      portal,
      user: {
        id: user.id,
        fullName: user.fullName || user.name,
        name: user.fullName || user.name,
        email: user.email,
        organizationId: activeOrgId,
        role: getPlatformRole(user),
        portal,
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
 * GET /api/auth/platform-status
 * Public: lets the login page show maintenance notices, announcements and whether signups are open.
 */
router.get('/platform-status', (req, res) => {
  const settings = getPlatformSettings()
  res.json({
    allowSignups: settings.allowSignups,
    maintenanceMode: settings.maintenanceMode,
    maintenanceMessage: settings.maintenanceMode ? settings.maintenanceMessage : '',
    announcement: settings.announcement || ''
  })
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
        phone: user.phone || '',
        organizationId: activeOrgId,
        role: getPlatformRole(user),
        portal: req.user.portal,
        impersonatedBy: req.user.impersonatedBy || null,
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

    // Generate installation curl command for server agent; store the token so /api/agent/register can verify it
    const agentToken = `tok_${crypto.randomBytes(24).toString('hex')}`
    if (org) {
      updateOrganization(org.id, { agentTokens: [...(org.agentTokens || []), agentToken].slice(-20) })
    }
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
  revokeSession(req.user.sid, req.user.id)
  recordAuditLog({
    organizationId: req.user.organizationId || 'org-default',
    userId: req.user.id,
    action: 'USER_LOGOUT',
    resourceType: 'auth',
    resourceId: req.user.id,
    ip: clientIp(req)
  })
  res.json({ message: 'Session logged out successfully' })
})

export default router
