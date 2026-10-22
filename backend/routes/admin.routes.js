import express from 'express'
import bcrypt from 'bcryptjs'
import { authenticateToken, requireSystemAdmin, signSessionToken } from '../middleware/auth.middleware.js'
import {
  readDb,
  writeDb,
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
  getAllIdempotencyRecords,
  getServerById,
  updateServer,
  deleteServer
} from '../services/db.service.js'
import { isLocalServer, forgetHost } from '../services/host.service.js'
import { sweepSubscriptions, checkSubscriptionHealth, GRACE_DAYS } from '../services/subscription.service.js'
import { getPaymentConfig } from '../services/payments.service.js'
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
  getServerDetailForAdmin,
  listSubscriptionsForAdmin,
  deleteUserCascade,
  deleteOrganizationCascade,
  upsertPlan,
  deletePlan,
  setOrganizationMemberRole
} from '../services/admin.service.js'
import { listTickets, getTicket, replyToTicket, updateTicket } from '../services/support.service.js'
import { revokeUserSessions } from '../services/session.service.js'
import { listTemplates, getTemplate, createTemplate, updateTemplate, deleteTemplate, publicTemplate } from '../services/template.service.js'
import { getUserSettings } from '../services/db.service.js'
import * as projectAgent from '../services/project-agent.service.js'
import { getPublicIntegrations, saveIntegrationSection, CURRENCIES, NOTIFICATION_EVENTS } from '../services/integrations.service.js'
import { testGithubApp } from '../services/github.service.js'
import { sendEmail, sendSms, sendWhatsApp, notifyUser } from '../services/notify.service.js'
import { testRazorpay, listPayments } from '../services/payments.service.js'
import { getAiBilling, saveAiBilling, getOrganizationTokenSummary, getLedger, adjustBalance } from '../services/ai-credits.service.js'

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

router.get('/overview', handle(() => ({ ...getPlatformOverview(), currency: getPaymentConfig().currency })))

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
  const { fullName, email, platformRole, phone, jobTitle, isVerified } = req.body || {}
  const updates = {}
  const changes = {}

  if (phone !== undefined) {
    const clean = String(phone).trim().slice(0, 30)
    if (clean && !/^\+?[0-9 ()-]{6,30}$/.test(clean)) throw httpError(400, 'Enter a valid phone number.')
    updates.phone = clean
    changes.phone = clean
  }
  if (jobTitle !== undefined) {
    updates.jobTitle = String(jobTitle).trim().slice(0, 80)
    changes.jobTitle = updates.jobTitle
  }
  if (isVerified !== undefined && !!isVerified !== !!user.isVerified) {
    updates.isVerified = !!isVerified
    changes.isVerified = !!isVerified
  }

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
  return { success: true, token, user: { ...sanitizeUser(user), role: 'admin', portal: 'panel', impersonatedBy: req.user.id } }
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

/**
 * POST /api/admin/users/bulk { ids: [], action: 'suspend' | 'activate' | 'revoke-sessions' | 'delete', reason }
 * Applies one action to many users. Protected accounts (primary admin, yourself) are skipped, not failed.
 */
router.post('/users/bulk', handle((req) => {
  const { ids, action, reason = '' } = req.body || {}
  if (!Array.isArray(ids) || ids.length === 0) throw httpError(400, 'Select at least one user.')
  if (ids.length > 200) throw httpError(400, 'At most 200 users at a time.')
  if (!['suspend', 'activate', 'revoke-sessions', 'delete'].includes(action)) throw httpError(400, 'Unknown bulk action.')
  const cleanReason = String(reason).trim().slice(0, 300)
  const done = []
  const skipped = []

  for (const id of [...new Set(ids.map(String))]) {
    const user = getUserById(id)
    if (!user) { skipped.push({ id, reason: 'not found' }); continue }
    try {
      if (action !== 'revoke-sessions' && action !== 'activate') assertNotProtected(req, user, action === 'delete' ? 'deleted' : 'suspended')
      if (action === 'suspend') {
        updateUser(user.id, { status: 'suspended', suspendedReason: cleanReason || null, suspendedAt: new Date().toISOString(), suspendedBy: req.user.id })
        audit(req, 'ADMIN_USER_SUSPENDED', 'user', user.id, { email: user.email, reason: cleanReason, bulk: true })
      } else if (action === 'activate') {
        updateUser(user.id, { status: 'active', suspendedReason: null, suspendedAt: null, suspendedBy: null })
        audit(req, 'ADMIN_USER_ACTIVATED', 'user', user.id, { email: user.email, bulk: true })
      } else if (action === 'revoke-sessions') {
        updateUser(user.id, { tokenVersion: (user.tokenVersion || 0) + 1 })
        revokeUserSessions(user.id)
        audit(req, 'ADMIN_USER_SESSIONS_REVOKED', 'user', user.id, { email: user.email, bulk: true })
      } else {
        const result = deleteUserCascade(user.id)
        audit(req, 'ADMIN_USER_DELETED', 'user', user.id, { email: user.email, bulk: true, ...result })
      }
      done.push(user.id)
    } catch (err) {
      skipped.push({ id, email: user.email, reason: err.message })
    }
  }
  const verb = { suspend: 'blocked', activate: 'unblocked', 'revoke-sessions': 'signed out', delete: 'deleted' }[action]
  return { success: true, done, skipped, message: `${done.length} user${done.length === 1 ? '' : 's'} ${verb}${skipped.length ? `, ${skipped.length} skipped` : ''}.` }
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
    endedAt: status === 'canceled' ? new Date().toISOString() : null,
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

router.get('/servers', handle(() => ({ servers: listServersForAdmin(), organizations: listOrganizationsForAdmin().map((o) => ({ id: o.id, name: o.name })) })))

function requireServer(serverId) {
  const server = getServerById(serverId)
  if (!server) throw httpError(404, 'Server not found.')
  return server
}

router.get('/servers/:id', handle((req) => {
  const detail = getServerDetailForAdmin(req.params.id)
  if (!detail) throw httpError(404, 'Server not found.')
  return detail
}))

/**
 * PATCH /api/admin/servers/:id { name, organizationId, notes }
 * Renames a server, moves it (and its project records) to another organization, or keeps an admin note.
 */
router.patch('/servers/:id', handle((req) => {
  const server = requireServer(req.params.id)
  const { name, organizationId, notes } = req.body || {}
  const updates = {}
  const changes = {}
  if (name !== undefined) {
    const clean = String(name).trim().slice(0, 80)
    if (!clean) throw httpError(400, 'Server name cannot be empty.')
    updates.name = clean
    changes.name = { from: server.name, to: clean }
  }
  if (notes !== undefined) {
    updates.adminNotes = String(notes).trim().slice(0, 1000)
    changes.notes = true
  }
  let moved = 0
  if (organizationId !== undefined && organizationId !== server.organizationId) {
    if (!getOrganizationById(organizationId)) throw httpError(400, 'Target organization not found.')
    if (isLocalServer(server)) throw httpError(400, 'The platform host stays with the platform organization.')
    updates.organizationId = organizationId
    changes.organizationId = { from: server.organizationId, to: organizationId }
  }
  if (Object.keys(updates).length === 0) throw httpError(400, 'Nothing to update.')
  const saved = updateServer(server.id, updates)
  if (updates.organizationId) {
    const db = readDb()
    for (const p of Object.values(db.projects || {})) {
      if (p.serverId === server.id) { p.organizationId = updates.organizationId; moved++ }
    }
    if (moved) writeDb(db)
    forgetHost(server.id)
  }
  audit(req, 'ADMIN_SERVER_UPDATED', 'server', server.id, { ...changes, projectsMoved: moved }, saved.organizationId)
  return { success: true, server: getServerDetailForAdmin(server.id).server, message: moved ? `Server updated; ${moved} project record(s) moved with it.` : 'Server updated.' }
}))

/**
 * Blocks a server: every connection to it (studio, SSH console, deploys, auto-updates, the agent) is refused until unblocked.
 */
router.post('/servers/:id/block', handle((req) => {
  const server = requireServer(req.params.id)
  if (isLocalServer(server)) throw httpError(400, 'The platform host cannot be blocked; the panel runs on it.')
  const reason = String((req.body || {}).reason || '').trim().slice(0, 300)
  updateServer(server.id, { blocked: true, blockedReason: reason || null, blockedAt: new Date().toISOString(), blockedBy: req.user.id })
  forgetHost(server.id)
  audit(req, 'ADMIN_SERVER_BLOCKED', 'server', server.id, { name: server.name, ipAddress: server.ipAddress, reason }, server.organizationId)
  return { success: true, server: getServerDetailForAdmin(server.id).server, message: `${server.name || 'Server'} blocked.` }
}))

router.post('/servers/:id/unblock', handle((req) => {
  const server = requireServer(req.params.id)
  updateServer(server.id, { blocked: false, blockedReason: null, blockedAt: null, blockedBy: null })
  audit(req, 'ADMIN_SERVER_UNBLOCKED', 'server', server.id, { name: server.name, ipAddress: server.ipAddress }, server.organizationId)
  return { success: true, server: getServerDetailForAdmin(server.id).server, message: `${server.name || 'Server'} unblocked.` }
}))

/**
 * Removes a server from the platform with its project records. Nothing on the machine itself is changed.
 */
router.delete('/servers/:id', handle((req) => {
  const server = requireServer(req.params.id)
  if (isLocalServer(server) && server.ipAddress) throw httpError(400, 'The platform host cannot be removed; the panel runs on it.')
  const db = readDb()
  let removedProjects = 0
  for (const [id, p] of Object.entries(db.projects || {})) {
    if (p.serverId === server.id) { delete db.projects[id]; removedProjects++ }
  }
  if (removedProjects) writeDb(db)
  deleteServer(server.id)
  forgetHost(server.id)
  audit(req, 'ADMIN_SERVER_DELETED', 'server', server.id, { name: server.name, ipAddress: server.ipAddress, removedProjects }, server.organizationId)
  return { success: true, message: `${server.name || server.id} removed${removedProjects ? ` with ${removedProjects} project record(s)` : ''}. Nothing on the server itself was changed.` }
}))

router.get('/subscriptions', handle(() => ({
  subscriptions: listSubscriptionsForAdmin(),
  plans: Object.values(getAllPlans()).map((p) => ({ id: p.id, name: p.name, priceMonthly: p.priceMonthly })),
  currency: getPaymentConfig().currency,
  graceDays: GRACE_DAYS
})))

/** GET /api/admin/subscriptions/health — finds broken, stale and orphaned subscription data (read-only). */
router.get('/subscriptions/health', handle(() => ({ success: true, ...checkSubscriptionHealth() })))

/** POST /api/admin/subscriptions/health/fix — repairs every fixable issue, then applies expiries. */
router.post('/subscriptions/health/fix', handle((req) => {
  const result = checkSubscriptionHealth({ fix: true })
  const changes = sweepSubscriptions()
  audit(req, 'ADMIN_SUBSCRIPTIONS_REPAIRED', 'platform', 'subscriptions', { fixed: result.fixed, types: [...new Set(result.issues.filter((i) => i.fixable).map((i) => i.type))], statusChanges: changes.length })
  return { success: true, ...checkSubscriptionHealth(), fixed: result.fixed, message: `Fixed ${result.fixed} issue${result.fixed === 1 ? '' : 's'}.` }
}))

function requireSubscription(orgId) {
  requireOrg(orgId)
  const sub = (readDb().subscriptions || {})[orgId]
  if (!sub) throw httpError(404, 'This organization has no subscription record. Assign a plan first.')
  return sub
}

/**
 * POST /api/admin/subscriptions/:orgId/extend { days }
 * Adds days to the billing period (from today if it already ended) and makes it active again.
 */
router.post('/subscriptions/:orgId/extend', handle((req) => {
  const sub = requireSubscription(req.params.orgId)
  const days = parseInt((req.body || {}).days, 10)
  if (!Number.isFinite(days) || days < 1 || days > 3650) throw httpError(400, 'Days must be between 1 and 3650.')
  const end = new Date(sub.currentPeriodEnd || 0).getTime()
  const from = end > Date.now() ? end : Date.now()
  const saved = saveSubscription(sub.organizationId, {
    status: 'active',
    currentPeriodStart: end > Date.now() ? sub.currentPeriodStart : new Date().toISOString(),
    currentPeriodEnd: new Date(from + days * 86400000).toISOString(),
    endedAt: null,
    assignedBy: req.user.id
  })
  audit(req, 'ADMIN_SUBSCRIPTION_EXTENDED', 'subscription', sub.organizationId, { days, from: sub.currentPeriodEnd, to: saved.currentPeriodEnd }, sub.organizationId)
  return { success: true, subscription: saved, message: `Extended by ${days} day${days === 1 ? '' : 's'} to ${saved.currentPeriodEnd.slice(0, 10)}.` }
}))

/**
 * POST /api/admin/subscriptions/:orgId/cancel { immediately }
 * At period end (default) or right away, in which case Free limits apply immediately.
 */
router.post('/subscriptions/:orgId/cancel', handle((req) => {
  const sub = requireSubscription(req.params.orgId)
  const immediately = !!(req.body || {}).immediately
  const saved = saveSubscription(sub.organizationId, immediately
    ? { status: 'canceled', cancelAtPeriodEnd: true, endedAt: new Date().toISOString(), currentPeriodEnd: new Date().toISOString() }
    : { cancelAtPeriodEnd: true })
  audit(req, 'ADMIN_SUBSCRIPTION_CANCELED', 'subscription', sub.organizationId, { immediately, planId: sub.planId }, sub.organizationId)
  return { success: true, subscription: saved, message: immediately ? 'Subscription canceled; Free plan limits apply now.' : `Subscription will end on ${String(sub.currentPeriodEnd).slice(0, 10)}.` }
}))

/** POST /api/admin/subscriptions/:orgId/reactivate — undoes a pending or completed cancellation. */
router.post('/subscriptions/:orgId/reactivate', handle((req) => {
  const sub = requireSubscription(req.params.orgId)
  const ended = new Date(sub.currentPeriodEnd || 0).getTime() <= Date.now()
  const saved = saveSubscription(sub.organizationId, {
    status: 'active',
    cancelAtPeriodEnd: false,
    endedAt: null,
    ...(ended ? { currentPeriodStart: new Date().toISOString(), currentPeriodEnd: new Date(Date.now() + 30 * 86400000).toISOString() } : {})
  })
  audit(req, 'ADMIN_SUBSCRIPTION_REACTIVATED', 'subscription', sub.organizationId, { planId: sub.planId, newPeriod: ended }, sub.organizationId)
  return { success: true, subscription: saved, message: ended ? 'Reactivated with a new 30-day period.' : 'Cancellation removed; the subscription renews as normal.' }
}))

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
// AI models & token billing
// ============================================================================

router.get('/ai', handle(() => ({
  success: true,
  status: projectAgent.getAgentStatus(),
  billing: getAiBilling(),
  organizations: getOrganizationTokenSummary(),
  ledger: getLedger({ limit: 200 })
})))

router.put('/ai/providers/:id', handle((req) => {
  const { apiKey, model, makeDefault, enabled } = req.body || {}
  const status = projectAgent.updateProviderSettings({ provider: req.params.id, apiKey, model, makeDefault, enabled })
  // Never log the key itself
  audit(req, 'ADMIN_AI_PROVIDER_UPDATED', 'ai-provider', req.params.id, {
    keyChanged: apiKey !== undefined, keyRemoved: apiKey === '', model, makeDefault: !!makeDefault, enabled
  })
  return { success: true, status }
}))

router.put('/ai/billing', handle((req) => {
  const billing = saveAiBilling(req.body || {})
  audit(req, 'ADMIN_AI_BILLING_UPDATED', 'platform', 'ai-billing', { packs: billing.packs.length, multipliers: billing.multipliers, signupBonusTokens: billing.signupBonusTokens })
  return { success: true, billing }
}))

router.post('/organizations/:id/ai-tokens', handle((req) => {
  const org = getOrganizationById(req.params.id)
  if (!org) throw httpError(404, 'Organization not found.')
  const { tokens, note = '' } = req.body || {}
  const balance = adjustBalance(org.id, tokens, { userId: req.user.id, note })
  audit(req, 'ADMIN_AI_TOKENS_ADJUSTED', 'organization', org.id, { tokens: Number(tokens), note, balance }, org.id)
  return { success: true, balance }
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
  notifyUser(ticket.createdBy, 'supportReply', {
    subject: `Reply on support ticket #${ticket.number}`,
    text: `Our support team replied to your ticket #${ticket.number} "${ticket.subject}". Sign in to your panel to read it and respond.`
  })
  return { success: true, ticket }
}))

router.patch('/support/tickets/:id', handle((req) => {
  const { status, priority } = req.body || {}
  const { ticket, changes } = updateTicket(req.params.id, { status, priority })
  audit(req, 'ADMIN_SUPPORT_TICKET_UPDATED', 'support_ticket', ticket.id, { number: ticket.number, ...changes }, ticket.organizationId)
  return { success: true, ticket }
}))

// ============================================================================
// Marketplace templates
// ============================================================================

const handleAsync = (fn) => async (req, res) => {
  try {
    res.json(await fn(req))
  } catch (err) {
    const status = err.status || 400
    if (status >= 500) console.error('[ADMIN API ERROR]:', err)
    res.status(status).json({ success: false, error: err.message })
  }
}

const templateActor = (req) => ({ userId: req.user.id, githubToken: (getUserSettings(req.user.id)?.githubToken || '').trim() || null })

router.get('/templates', handle(() => ({ success: true, templates: listTemplates().map(publicTemplate) })))

router.get('/templates/:id', handle((req) => {
  const t = getTemplate(req.params.id)
  if (!t) throw httpError(404, 'Template not found.')
  return { success: true, template: publicTemplate(t) }
}))

/** Body: template fields + a source: { gitUrl, branch } or { uploadId } from /api/deploy/uploads */
router.post('/templates', handleAsync(async (req) => {
  const t = await createTemplate(req.body || {}, templateActor(req))
  audit(req, 'ADMIN_TEMPLATE_CREATED', 'template', t.id, { name: t.name, source: t.source.type })
  return { success: true, template: publicTemplate(t) }
}))

router.patch('/templates/:id', handleAsync(async (req) => {
  const t = await updateTemplate(req.params.id, req.body || {}, templateActor(req))
  audit(req, 'ADMIN_TEMPLATE_UPDATED', 'template', t.id, { name: t.name, status: t.status })
  return { success: true, template: publicTemplate(t) }
}))

router.delete('/templates/:id', handle((req) => {
  const t = deleteTemplate(req.params.id)
  audit(req, 'ADMIN_TEMPLATE_DELETED', 'template', t.id, { name: t.name })
  return { success: true }
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

// ============================================================================
// Integrations: payments (Razorpay), GitHub sign-in, email, SMS, WhatsApp, notifications
// ============================================================================

router.get('/integrations', handle(() => ({
  success: true,
  integrations: getPublicIntegrations(),
  currencies: CURRENCIES,
  events: NOTIFICATION_EVENTS,
  payments: listPayments({ limit: 100 }).map((p) => ({ ...p, amount: p.amount / 100 }))
})))

router.put('/integrations/:section', handle((req) => {
  const integrations = saveIntegrationSection(req.params.section, req.body || {})
  // Record which fields changed, never their values
  audit(req, 'ADMIN_INTEGRATION_UPDATED', 'integration', req.params.section, { fields: Object.keys(req.body || {}) })
  return { success: true, integrations }
}))

router.post('/integrations/:section/test', handleAsync(async (req) => {
  const to = String((req.body || {}).to || '').trim()
  const section = req.params.section
  let result
  if (section === 'razorpay') return { success: true, ...(await testRazorpay()) }
  if (section === 'github') return { success: true, ...(await testGithubApp()) }
  if (!to) throw httpError(400, section === 'email' ? 'Enter an email address to send the test to.' : 'Enter a phone number to send the test to.')
  const text = 'This is a test message from your AutoDeploy platform. If you received it, this channel is set up correctly.'
  if (section === 'email') result = await sendEmail({ to, subject: 'AutoDeploy test email', text })
  else if (section === 'sms') result = await sendSms({ to, text })
  else if (section === 'whatsapp') result = await sendWhatsApp({ to, text })
  else throw httpError(404, 'Unknown integration.')
  audit(req, 'ADMIN_INTEGRATION_TESTED', 'integration', section, { to })
  return { success: true, message: `Test sent to ${to}.${result?.fallback ? ` ${result.fallback} Switch the port to 587 with SSL off to skip the retry.` : ''}`, id: result?.id || null }
}))

export default router
