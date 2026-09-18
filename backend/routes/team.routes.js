import express from 'express'
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
    const { email, role = 'DEVELOPER' } = req.body
    if (!email) {
      return res.status(400).json({ error: 'User email address is required.' })
    }

    // Quota check
    const entitlement = checkEntitlement(req.tenant.organizationId, 'teamMembers')
    if (!entitlement.allowed) {
      return res.status(403).json({ error: entitlement.reason })
    }

    const cleanEmail = email.trim().toLowerCase()
    let user = getUserByEmail(cleanEmail)

    if (!user) {
      // Auto-create invited pending user account
      user = createUser({
        fullName: cleanEmail.split('@')[0],
        email: cleanEmail,
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
      member
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
