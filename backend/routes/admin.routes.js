import express from 'express'
import bcrypt from 'bcryptjs'
import { authenticateToken, requireSystemAdmin, signSessionToken } from '../middleware/auth.middleware.js'
import {
  readDb,
  getUserById,
  getUserByEmail,
  createUser,
  updateUser,
  getOrganizationById,
  createOrganization,
  updateOrganization,
  saveSubscription,
  getAllPlans,
  recordAuditLog,
  getIdempotencyStats,
  getAllIdempotencyRecords
} from '../services/db.service.js'
import {
  PRIMARY_ADMIN_ID,
  PLATFORM_ROLES,
  getPlatformRole,
  sanitizeUser,
  generateTempPassword,
  getPlatformSettings,
  savePlatformSettings,
  getPlatformOverview,
  listUsersForAdmin,
  getUserDetailForAdmin,
  listOrganizationsForAdmin,
  getOrganizationDetailForAdmin,
  listServersForAdmin,
  listSubscriptionsForAdmin,
  deleteUserCascade,
  deleteOrganizationCascade,
  upsertPlan,
  deletePlan,
  setOrganizationMemberRole
} from '../services/admin.service.js'
import { listTickets, getTicket, replyToTicket, updateTicket } from '../services/support.service.js'
import { revokeUserSessions } from '../services/session.service.js'

const router = express.Router()

// Every admin route requires a verified, non-impersonated platform admin session
router.use(authenticateToken, requireSystemAdmin)

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const ORG_ROLES = ['OWNER', 'ADMIN', 'DEVELOPER', 'VIEWER']

/**
 * Wraps a handler so thrown errors become JSON responses (400 for validation errors).
 */
const handle = (fn) => (req, res) => {
  try {
    const result = fn(req, res)
    if (result !== undefined && !res.headersSent) res.json(result)
  } catch (err) {
    const status = err.status || 400
    if (status >= 500) console.error('[ADMIN API ERROR]:', err)
    res.status(status).json({ success: false, error: err.message })
  }
}

const httpError = (status, message) => Object.assign(new Error(message), { status })

function audit(req, action, resourceType, resourceId, details = {}, organizationId = 'org-default') {
  recordAuditLog({
    organizationId,
    userId: req.user.id,
    action,
    resourceType,
    resourceId,
    ip: String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim(),
    details: { adminEmail: req.user.email, ...details }
  })
}

function requireUser(userId) {
  const user = getUserById(userId)
  if (!user) throw httpError(404, 'User not found.')
  return user
}

/**
 * Guards against locking the platform out: the primary admin can't be suspended, demoted or deleted,
 * and an admin can't do any of those to their own account.
 */
function assertNotProtected(req, user, action) {
  if (user.id === PRIMARY_ADMIN_ID) throw httpError(400, `The primary admin account cannot be ${action}.`)
  if (user.id === req.user.id) throw httpError(400, `You cannot ${action.replace(/ed$/, '')} your own account.`)
}

// ============================================================================
// Overview
// ============================================================================

router.get('/overview', handle(() => getPlatformOverview()))

// ============================================================================
// Users
// ============================================================================

router.get('/users', handle((req) => ({
  users: listUsersForAdmin({ search: req.query.search || '', status: req.query.status || '', role: req.query.role || '' })
})))

router.get('/users/:id', handle((req) => {
  const detail = getUserDetailForAdmin(req.params.id)
  if (!detail) throw httpError(404, 'User not found.')
  return detail
}))

/**
 * POST /api/admin/users
 * Creates an account. Without a password, a temporary one is generated and returned once.
 */
router.post('/users', handle((req) => {
  const { fullName, email, password, platformRole = 'admin', createOrganization: withOrg = true, organizationName, planId = 'FREE' } = req.body || {}
  const cleanEmail = String(email || '').trim().toLowerCase()
  if (!EMAIL_REGEX.test(cleanEmail)) throw httpError(400, 'A valid email address is required.')
  if (getUserByEmail(cleanEmail)) throw httpError(400, 'An account with this email already exists.')
  if (password && String(password).length < 8) throw httpError(400, 'Password must be at least 8 characters.')
  if (!PLATFORM_ROLES.includes(platformRole)) throw httpError(400, 'platformRole must be "admin" or "superadmin".')
  if (withOrg && !getAllPlans()[planId]) throw httpError(400, `Plan '${planId}' does not exist.`)

  const tempPassword = password ? null : generateTempPassword()
  const user = createUser({
    fullName: String(fullName || '').trim() || cleanEmail.split('@')[0],
    email: cleanEmail,
    passwordHash: bcrypt.hashSync(password || tempPassword, 10),
    isVerified: true
  })
  const updates = { platformRole, status: 'active', createdBy: req.user.id }

  let organization = null
  if (withOrg) {
    organization = createOrganization({ name: String(organizationName || '').trim() || `${user.fullName}'s Workspace`, ownerId: user.id, planId })
    updates.organizationId = organization.id
  }
  const saved = updateUser(user.id, updates)

  audit(req, 'ADMIN_USER_CREATED', 'user', user.id, { email: cleanEmail, platformRole, organizationId: organization?.id })
  return { success: true, user: sanitizeUser(saved), organization, tempPassword }
}))

/**
 * PATCH /api/admin/users/:id
 * Edits name, email and platform role.
 */
router.patch('/users/:id', handle((req) => {
  const user = requireUser(req.params.id)
  const { fullName, email, platformRole } = req.body || {}
  const updates = {}
  const changes = {}

  if (fullName !== undefined) {
    const name = String(fullName).trim()
    if (!name) throw httpError(400, 'Name cannot be empty.')
    updates.fullName = name
    changes.fullName = name
  }
  if (email !== undefined) {
    const cleanEmail = String(email).trim().toLowerCase()
    if (!EMAIL_REGEX.test(cleanEmail)) throw httpError(400, 'A valid email address is required.')
    const other = getUserByEmail(cleanEmail)
    if (other && other.id !== user.id) throw httpError(400, 'Another account already uses this email.')
    updates.email = cleanEmail
    changes.email = { from: user.email, to: cleanEmail }
  }
  if (platformRole !== undefined && platformRole !== getPlatformRole(user)) {
    if (!PLATFORM_ROLES.includes(platformRole)) throw httpError(400, 'platformRole must be "admin" or "superadmin".')
    if (platformRole === 'admin') assertNotProtected(req, user, 'demoted')
    updates.platformRole = platformRole
    changes.platformRole = { from: getPlatformRole(user), to: platformRole }
  }
  if (Object.keys(updates).length === 0) throw httpError(400, 'Nothing to update.')

  const saved = updateUser(user.id, updates)
  audit(req, changes.platformRole ? 'ADMIN_USER_ROLE_CHANGED' : 'ADMIN_USER_UPDATED', 'user', user.id, changes)
  return { success: true, user: sanitizeUser(saved) }
}))

router.post('/users/:id/suspend', handle((req) => {
  const user = requireUser(req.params.id)
  assertNotProtected(req, user, 'suspended')
  const reason = String((req.body || {}).reason || '').trim().slice(0, 300)
  const saved = updateUser(user.id, { status: 'suspended', suspendedReason: reason || null, suspendedAt: new Date().toISOString(), suspendedBy: req.user.id })
  audit(req, 'ADMIN_USER_SUSPENDED', 'user', user.id, { email: user.email, reason })
  return { success: true, user: sanitizeUser(saved) }
}))

router.post('/users/:id/activate', handle((req) => {
  const user = requireUser(req.params.id)
  const saved = updateUser(user.id, { status: 'active', suspendedReason: null, suspendedAt: null, suspendedBy: null })
  audit(req, 'ADMIN_USER_ACTIVATED', 'user', user.id, { email: user.email })
  return { success: true, user: sanitizeUser(saved) }
}))

/**
 * Generates a new temporary password (returned once) and signs the user out everywhere.
 */
router.post('/users/:id/reset-password', handle((req) => {
  const user = requireUser(req.params.id)
  if (user.id === PRIMARY_ADMIN_ID && req.user.id !== PRIMARY_ADMIN_ID) {
    throw httpError(400, 'Only the primary admin can reset the primary admin password.')
  }
  const tempPassword = generateTempPassword()
  updateUser(user.id, { passwordHash: bcrypt.hashSync(tempPassword, 10), tokenVersion: (user.tokenVersion || 0) + 1 })
  audit(req, 'ADMIN_USER_PASSWORD_RESET', 'user', user.id, { email: user.email })
  return { success: true, tempPassword, message: `Password reset for ${user.email}. All of their sessions were signed out.` }
}))

router.post('/users/:id/revoke-sessions', handle((req) => {
  const user = requireUser(req.params.id)
  updateUser(user.id, { tokenVersion: (user.tokenVersion || 0) + 1 })
  revokeUserSessions(user.id)
  audit(req, 'ADMIN_USER_SESSIONS_REVOKED', 'user', user.id, { email: user.email })
  return { success: true, message: `All sessions for ${user.email} were signed out.` }
}))

/**
 * Issues a 1-hour session as the target user for support. Admin accounts can't be impersonated,
 * and impersonation sessions never carry admin rights.
 */
router.post('/users/:id/impersonate', handle((req) => {
  const user = requireUser(req.params.id)
  if (getPlatformRole(user) === 'superadmin') throw httpError(400, 'Super admin accounts cannot be impersonated.')
  if (user.status === 'suspended') throw httpError(400, 'Reactivate this account before impersonating it.')
  const token = signSessionToken(user, { expiresIn: '1h', impersonatedBy: req.user.id, req })
  audit(req, 'ADMIN_USER_IMPERSONATED', 'user', user.id, { email: user.email })
  return { success: true, token, user: { ...sanitizeUser(user), role: 'admin', impersonatedBy: req.user.id } }
}))

router.delete('/users/:id', handle((req) => {
  const user = requireUser(req.params.id)
  assertNotProtected(req, user, 'deleted')
  const result = deleteUserCascade(user.id)
  audit(req, 'ADMIN_USER_DELETED', 'user', user.id, { email: user.email, ...result })
  return { success: true, message: `User ${user.email} deleted.`, ...result }
}))

// Backwards-compatible endpoint used by older UI builds
router.post('/users/delete', handle((req) => {
  const user = requireUser((req.body || {}).userId)
  assertNotProtected(req, user, 'deleted')
  const result = deleteUserCascade(user.id)
  audit(req, 'ADMIN_USER_DELETED', 'user', user.id, { email: user.email, ...result })
  return { success: true, message: `User ${user.id} deleted successfully.`, ...result }
}))

// ============================================================================
// Organizations
// ============================================================================

router.get('/organizations', handle((req) => ({
  organizations: listOrganizationsForAdmin({ search: req.query.search || '', status: req.query.status || '', planId: req.query.planId || '' })
})))

router.get('/organizations/:id', handle((req) => {
  const detail = getOrganizationDetailForAdmin(req.params.id)
  if (!detail) throw httpError(404, 'Organization not found.')
  return detail
}))

function requireOrg(orgId) {
  const org = getOrganizationById(orgId)
  if (!org) throw httpError(404, 'Organization not found.')
  return org
}

router.patch('/organizations/:id', handle((req) => {
  const org = requireOrg(req.params.id)
  const name = String((req.body || {}).name || '').trim()
  if (!name) throw httpError(400, 'Organization name is required.')
  const saved = updateOrganization(org.id, { name: name.slice(0, 100) })
  audit(req, 'ADMIN_ORG_UPDATED', 'organization', org.id, { name: { from: org.name, to: name } }, org.id)
  return { success: true, organization: saved }
}))

/**
 * Manually assigns a plan (e.g. a comped or invoiced customer) and sets the billing period.
 */
router.post('/organizations/:id/plan', handle((req) => {
  const org = requireOrg(req.params.id)
  const { planId, status = 'active', periodDays = 30 } = req.body || {}
  const plans = getAllPlans()
  if (!plans[planId]) throw httpError(400, `Plan '${planId}' does not exist.`)
  if (!['active', 'trialing', 'past_due', 'canceled'].includes(status)) throw httpError(400, 'Invalid subscription status.')
  const days = Math.min(Math.max(parseInt(periodDays, 10) || 30, 1), 3650)
  const subscription = saveSubscription(org.id, {
    planId,
    status,
    currentPeriodStart: new Date().toISOString(),
    currentPeriodEnd: new Date(Date.now() + days * 86400000).toISOString(),
    cancelAtPeriodEnd: status === 'canceled',
    assignedBy: req.user.id
  })
  audit(req, 'ADMIN_ORG_PLAN_CHANGED', 'subscription', org.id, { from: org.planId, to: planId, status, periodDays: days }, org.id)
  return { success: true, subscription }
}))

router.post('/organizations/:id/suspend', handle((req) => {
  const org = requireOrg(req.params.id)
  if (org.id === 'org-default') throw httpError(400, 'The platform organization cannot be suspended.')
  const reason = String((req.body || {}).reason || '').trim().slice(0, 300)
  const saved = updateOrganization(org.id, { status: 'suspended', suspendedReason: reason || null, suspendedAt: new Date().toISOString() })
  audit(req, 'ADMIN_ORG_SUSPENDED', 'organization', org.id, { reason }, org.id)
  return { success: true, organization: saved }
}))

router.post('/organizations/:id/activate', handle((req) => {
  const org = requireOrg(req.params.id)
  const saved = updateOrganization(org.id, { status: 'active', suspendedReason: null, suspendedAt: null })
  audit(req, 'ADMIN_ORG_ACTIVATED', 'organization', org.id, {}, org.id)
  return { success: true, organization: saved }
}))

router.delete('/organizations/:id', handle((req) => {
  const org = requireOrg(req.params.id)
  if (org.id === 'org-default') throw httpError(400, 'The platform organization cannot be deleted.')
  deleteOrganizationCascade(org.id)
  audit(req, 'ADMIN_ORG_DELETED', 'organization', org.id, { name: org.name })
  return { success: true, message: `Organization '${org.name}' deleted. Nothing was changed on its servers.` }
}))

router.post('/organizations/:id/members/:userId/role', handle((req) => {
  const org = requireOrg(req.params.id)
  const role = String((req.body || {}).role || '').toUpperCase()
  if (!ORG_ROLES.includes(role)) throw httpError(400, `Role must be one of ${ORG_ROLES.join(', ')}.`)
  setOrganizationMemberRole(org.id, req.params.userId, role)
  audit(req, 'ADMIN_ORG_MEMBER_ROLE_CHANGED', 'organization', org.id, { userId: req.params.userId, role }, org.id)
  return { success: true }
}))

// ============================================================================
// Servers & subscriptions
// ============================================================================

router.get('/servers', handle(() => ({ servers: listServersForAdmin() })))

router.get('/subscriptions', handle(() => ({ subscriptions: listSubscriptionsForAdmin() })))

// ============================================================================
// Plans
// ============================================================================

router.get('/plans', handle(() => {
  const db = readDb()
  const usage = {}
  for (const s of Object.values(db.subscriptions || {})) usage[s.planId] = (usage[s.planId] || 0) + 1
  return { plans: Object.values(getAllPlans()).map((p) => ({ ...p, isPublic: p.isPublic !== false, subscriberCount: usage[p.id] || 0 })) }
}))

router.post('/plans', handle((req) => {
  const plan = upsertPlan((req.body || {}).id, req.body || {}, { isNew: true })
  audit(req, 'ADMIN_PLAN_CREATED', 'plan', plan.id, plan)
  return { success: true, plan }
}))

router.put('/plans/:id', handle((req) => {
  const plan = upsertPlan(req.params.id, req.body || {})
  audit(req, 'ADMIN_PLAN_UPDATED', 'plan', plan.id, plan)
  return { success: true, plan }
}))

router.delete('/plans/:id', handle((req) => {
  deletePlan(req.params.id)
  audit(req, 'ADMIN_PLAN_DELETED', 'plan', req.params.id)
  return { success: true }
}))

// ============================================================================
// Platform settings
// ============================================================================

router.get('/settings', handle(() => ({ settings: getPlatformSettings(), plans: Object.values(getAllPlans()).map((p) => ({ id: p.id, name: p.name })) })))

router.put('/settings', handle((req) => {
  const before = getPlatformSettings()
  const settings = savePlatformSettings(req.body || {})
  const changed = Object.fromEntries(Object.keys(settings).filter((k) => k !== 'updatedAt' && before[k] !== settings[k]).map((k) => [k, { from: before[k], to: settings[k] }]))
  audit(req, 'ADMIN_SETTINGS_UPDATED', 'platform', 'settings', changed)
  return { success: true, settings }
}))

// ============================================================================
// Support desk
// ============================================================================

router.get('/support/tickets', handle((req) => ({
  success: true,
  tickets: listTickets({ status: req.query.status || '', search: req.query.search || '' })
})))

router.get('/support/tickets/:id', handle((req) => ({ success: true, ticket: getTicket(req.params.id) })))

router.post('/support/tickets/:id/replies', handle((req) => {
  const ticket = replyToTicket(req.params.id, { user: req.user, body: (req.body || {}).body, asStaff: true })
  audit(req, 'ADMIN_SUPPORT_REPLIED', 'support_ticket', ticket.id, { number: ticket.number }, ticket.organizationId)
  return { success: true, ticket }
}))

router.patch('/support/tickets/:id', handle((req) => {
  const { status, priority } = req.body || {}
  const { ticket, changes } = updateTicket(req.params.id, { status, priority })
  audit(req, 'ADMIN_SUPPORT_TICKET_UPDATED', 'support_ticket', ticket.id, { number: ticket.number, ...changes }, ticket.organizationId)
  return { success: true, ticket }
}))

// ============================================================================
// Audit trail & idempotency
// ============================================================================

router.get('/audit-logs', handle((req) => {
  const { search = '', action = '', limit = 500 } = req.query
  const q = String(search).toLowerCase()
  const logs = (readDb().auditLogs || [])
    .filter((l) => !action || l.action === action)
    .filter((l) => !q || JSON.stringify(l).toLowerCase().includes(q))
    .slice(0, Math.min(parseInt(limit, 10) || 500, 2000))
  return { success: true, logs }
}))

router.get('/idempotency/stats', handle(() => ({ success: true, stats: getIdempotencyStats() })))

router.get('/idempotency/records', handle(() => ({ success: true, records: getAllIdempotencyRecords() })))

export default router
