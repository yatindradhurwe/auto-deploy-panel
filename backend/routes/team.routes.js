import express from 'express'
import bcrypt from 'bcryptjs'
import { authenticateToken } from '../middleware/auth.middleware.js'
import { requireTenant, requireRole } from '../middleware/tenant.middleware.js'
import {
  getOrganizationMembers,
  addOrganizationMember,
  removeOrganizationMember,
  updateMemberRole,
  getUserByEmail,
  createUser,
  getAuditLogsByOrgId,
  recordAuditLog
} from '../services/db.service.js'
import { checkEntitlement } from '../services/subscription.service.js'
import { generateTempPassword } from '../services/admin.service.js'
import { removeSharesForMember } from '../services/project-access.service.js'

const INVITE_ROLES = ['ADMIN', 'DEVELOPER', 'VIEWER']

const router = express.Router()

/**
 * GET /api/team/members
 */
router.get('/members', authenticateToken, requireTenant, (req, res) => {
  try {
    const members = getOrganizationMembers(req.tenant.organizationId)
    res.json({ members })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * POST /api/team/invite
 */
router.post('/invite', authenticateToken, requireTenant, requireRole(['OWNER', 'ADMIN']), (req, res) => {
  try {
    const { email } = req.body
    const role = String(req.body.role || 'DEVELOPER').toUpperCase()
    if (!email) {
      return res.status(400).json({ error: 'User email address is required.' })
    }
    if (!INVITE_ROLES.includes(role)) {
      return res.status(400).json({ error: `Role must be one of ${INVITE_ROLES.join(', ')}.` })
    }

    // Quota check
    const entitlement = checkEntitlement(req.tenant.organizationId, 'teamMembers')
    if (!entitlement.allowed) {
      return res.status(403).json({ error: entitlement.reason })
    }

    const cleanEmail = email.trim().toLowerCase()
    let user = getUserByEmail(cleanEmail)
    let tempPassword = null

    if (!user) {
      // New teammates get a one-time temporary password (shown once to the inviter) so they can sign in
      tempPassword = generateTempPassword()
      user = createUser({
        fullName: cleanEmail.split('@')[0],
        email: cleanEmail,
        passwordHash: bcrypt.hashSync(tempPassword, 10),
        isVerified: false
      })
    }

    const member = addOrganizationMember({
      organizationId: req.tenant.organizationId,
      userId: user.id,
      role
    })

    recordAuditLog({
      organizationId: req.tenant.organizationId,
      userId: req.user.id,
      action: 'TEAM_MEMBER_INVITED',
      resourceType: 'user',
      resourceId: user.id,
      details: { email: cleanEmail, role }
    })

    res.json({
      success: true,
      message: `User '${cleanEmail}' added to organization as ${role}!`,
      member,
      tempPassword
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * PUT /api/team/members/:userId/role
 */
router.put('/members/:userId/role', authenticateToken, requireTenant, requireRole(['OWNER', 'ADMIN']), (req, res) => {
  try {
    const { role } = req.body
    const updated = updateMemberRole(req.tenant.organizationId, req.params.userId, role)
    
    recordAuditLog({
      organizationId: req.tenant.organizationId,
      userId: req.user.id,
      action: 'MEMBER_ROLE_UPDATED',
      resourceType: 'user',
      resourceId: req.params.userId,
      details: { role }
    })

    res.json({ success: true, member: updated })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * DELETE /api/team/members/:userId
 */
router.delete('/members/:userId', authenticateToken, requireTenant, requireRole(['OWNER', 'ADMIN']), (req, res) => {
  try {
    const removed = removeOrganizationMember(req.tenant.organizationId, req.params.userId)
    if (removed) removeSharesForMember(req.tenant.organizationId, req.params.userId)

    recordAuditLog({
      organizationId: req.tenant.organizationId,
      userId: req.user.id,
      action: 'MEMBER_REMOVED',
      resourceType: 'user',
      resourceId: req.params.userId
    })

    res.json({ success: removed })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * GET /api/team/audit-logs
 */
router.get('/audit-logs', authenticateToken, requireTenant, (req, res) => {
  try {
    const logs = getAuditLogsByOrgId(req.tenant.organizationId)
    res.json({ logs })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
