import express from 'express'
import bcrypt from 'bcryptjs'
import { authenticateToken, signSessionToken } from '../middleware/auth.middleware.js'
import { isSystemAdminUser } from '../config/secrets.js'
import { getPlatformRole } from '../services/admin.service.js'
import {
  getUserById,
  getUserByEmail,
  updateUser,
  getOrganizationById,
  getOrganizationsByUserId,
  getOrganizationMembers,
  updateOrganization,
  recordAuditLog
} from '../services/db.service.js'
import { listUserSessions, revokeSession, revokeUserSessions } from '../services/session.service.js'
import { createRateLimiter, rejectIfLimited } from '../middleware/rateLimit.middleware.js'

/**
 * Self-service profile for the signed-in account: personal details, email, password and
 * firm (organization) details. Super admins and admins share these endpoints, but:
 *  - credentials (email, password) can't be changed from an impersonation session
 *  - firm details can only be edited by the organization's OWNER/ADMIN members (or a super admin)
 */
const router = express.Router()

router.use(authenticateToken)

// Guards current-password checks against guessing from a hijacked session
const credentialAttempts = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 })

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const PHONE_REGEX = /^\+?[0-9][0-9\s\-().]{5,19}$/
const ORG_EDIT_ROLES = ['OWNER', 'ADMIN']
const FIRM_FIELDS = {
  legalName: 120,
  taxId: 40,
  website: 200,
  email: 160,
  phone: 25,
  addressLine: 200,
  city: 80,
  state: 80,
  postalCode: 20,
  country: 80
}

const handle = (fn) => (req, res) => {
  try {
    const result = fn(req, res)
    if (result !== undefined && !res.headersSent) res.json(result)
  } catch (err) {
    const status = err.status || 400
    if (status >= 500) console.error('[PROFILE API ERROR]:', err)
    res.status(status).json({ success: false, error: err.message })
  }
}

const httpError = (status, message) => Object.assign(new Error(message), { status })

function audit(req, action, resourceType, resourceId, details = {}, organizationId) {
  recordAuditLog({
    organizationId: organizationId || req.user.organizationId || 'org-default',
    userId: req.user.id,
    action,
    resourceType,
    resourceId,
    ip: String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim(),
    details: { email: req.user.email, ...(req.user.impersonatedBy ? { impersonatedBy: req.user.impersonatedBy } : {}), ...details }
  })
}

function requireSelf(req) {
  const user = getUserById(req.user.id)
  if (!user) throw httpError(404, 'Account not found.')
  return user
}

function assertNotImpersonating(req) {
  if (req.user.impersonatedBy) throw httpError(403, 'Email, password and sign-in sessions cannot be changed while viewing as another user.')
}

function assertPassword(user, password) {
  if (!password || !user.passwordHash || !bcrypt.compareSync(String(password), user.passwordHash)) {
    throw httpError(400, 'Current password is incorrect.')
  }
}

function cleanOptional(value, max, label) {
  const text = String(value ?? '').trim()
  if (text.length > max) throw httpError(400, `${label} must be at most ${max} characters.`)
  return text
}

function cleanPhone(value, label = 'Phone number') {
  const phone = cleanOptional(value, 25, label)
  if (phone && !PHONE_REGEX.test(phone)) throw httpError(400, `${label} is not valid.`)
  return phone
}

function resolveOrganization(user) {
  const orgId = user.organizationId || (getOrganizationsByUserId(user.id)[0] || {}).id
  return orgId ? getOrganizationById(orgId) : null
}

function memberRoleOf(org, userId) {
  if (!org) return null
  const member = getOrganizationMembers(org.id).find((m) => m.userId === userId)
  return member ? member.role : null
}

function canEditOrganization(req, org) {
  if (!org) return false
  if (isSystemAdminUser(req.user) && !req.user.impersonatedBy) return true
  return ORG_EDIT_ROLES.includes(String(memberRoleOf(org, req.user.id) || '').toUpperCase())
}

function serializeProfile(req, user) {
  const org = resolveOrganization(user)
  return {
    success: true,
    profile: {
      id: user.id,
      fullName: user.fullName || user.name || '',
      email: user.email,
      phone: user.phone || '',
      jobTitle: user.jobTitle || '',
      role: getPlatformRole(user),
      createdAt: user.createdAt || null,
      lastLoginAt: user.lastLoginAt || null,
      lastLoginIp: user.lastLoginIp || null,
      passwordChangedAt: user.passwordChangedAt || null
    },
    organization: org
      ? { id: org.id, name: org.name, slug: org.slug, createdAt: org.createdAt || null, details: org.details || {} }
      : null,
    access: {
      impersonated: !!req.user.impersonatedBy,
      memberRole: memberRoleOf(org, user.id),
      canChangeCredentials: !req.user.impersonatedBy,
      canEditOrganization: canEditOrganization(req, org)
    }
  }
}

// Public view of the session user, matching what /api/auth/me returns, so the client can refresh its copy
function sessionUser(req, user) {
  return {
    id: user.id,
    fullName: user.fullName || user.name || 'User',
    name: user.fullName || user.name || 'User',
    email: user.email,
    phone: user.phone || '',
    organizationId: req.user.organizationId || user.organizationId || null,
    role: getPlatformRole(user),
    impersonatedBy: req.user.impersonatedBy || null,
    avatar: user.avatar || ''
  }
}

router.get('/', handle((req) => serializeProfile(req, requireSelf(req))))

/**
 * Personal details: name, phone and job title.
 */
router.patch('/', handle((req) => {
  const user = requireSelf(req)
  const { fullName, phone, jobTitle } = req.body || {}
  const updates = {}
  if (fullName !== undefined) {
    const name = cleanOptional(fullName, 100, 'Full name')
    if (!name) throw httpError(400, 'Full name is required.')
    updates.fullName = name
  }
  if (phone !== undefined) updates.phone = cleanPhone(phone)
  if (jobTitle !== undefined) updates.jobTitle = cleanOptional(jobTitle, 80, 'Job title')

  const changed = Object.keys(updates).filter((k) => (user[k] || '') !== updates[k])
  const saved = changed.length ? updateUser(user.id, updates) : user
  if (changed.length) audit(req, 'PROFILE_UPDATED', 'user', user.id, { fields: changed })
  return { ...serializeProfile(req, saved), user: sessionUser(req, saved) }
}))

/**
 * Changing the sign-in email requires the current password.
 */
router.put('/email', handle((req, res) => {
  assertNotImpersonating(req)
  if (rejectIfLimited(res, [[credentialAttempts, req.user.id]])) return
  const user = requireSelf(req)
  const { email, currentPassword } = req.body || {}
  const cleanEmail = String(email || '').trim().toLowerCase()
  if (!EMAIL_REGEX.test(cleanEmail)) throw httpError(400, 'A valid email address is required.')
  assertPassword(user, currentPassword)
  if (cleanEmail === user.email) throw httpError(400, 'This is already your email address.')
  if (getUserByEmail(cleanEmail)) throw httpError(400, 'An account with this email already exists.')

  const saved = updateUser(user.id, { email: cleanEmail })
  audit(req, 'PROFILE_EMAIL_CHANGED', 'user', user.id, { from: user.email, to: cleanEmail })
  return { ...serializeProfile(req, saved), user: sessionUser(req, saved) }
}))

/**
 * Changing the password signs out every other session (token version bump) and returns
 * a fresh token for this one.
 */
router.put('/password', handle((req, res) => {
  assertNotImpersonating(req)
  if (rejectIfLimited(res, [[credentialAttempts, req.user.id]])) return
  const user = requireSelf(req)
  const { currentPassword, newPassword } = req.body || {}
  assertPassword(user, currentPassword)
  const next = String(newPassword || '')
  if (next.length < 8) throw httpError(400, 'New password must be at least 8 characters.')
  if (next.length > 200) throw httpError(400, 'New password is too long.')
  if (bcrypt.compareSync(next, user.passwordHash)) throw httpError(400, 'New password must be different from the current one.')

  const saved = updateUser(user.id, {
    passwordHash: bcrypt.hashSync(next, 10),
    passwordChangedAt: new Date().toISOString(),
    tokenVersion: (user.tokenVersion || 0) + 1
  })
  revokeUserSessions(user.id)
  audit(req, 'PROFILE_PASSWORD_CHANGED', 'user', user.id)
  const token = signSessionToken(saved, { organizationId: req.user.organizationId, req })
  return { success: true, message: 'Password updated. Other sessions have been signed out.', token, user: sessionUser(req, saved) }
}))

/**
 * Devices currently signed in to this account.
 */
router.get('/sessions', handle((req) => ({
  success: true,
  sessions: listUserSessions(req.user.id).map((s) => ({ ...s, current: s.id === req.user.sid }))
})))

router.delete('/sessions/:id', handle((req) => {
  assertNotImpersonating(req)
  if (req.params.id === req.user.sid) throw httpError(400, 'Use log out to end the current session.')
  if (!revokeSession(req.params.id, req.user.id)) throw httpError(404, 'Session not found.')
  audit(req, 'PROFILE_SESSION_REVOKED', 'user', req.user.id)
  return { success: true }
}))

router.post('/sessions/revoke-others', handle((req) => {
  assertNotImpersonating(req)
  const count = revokeUserSessions(req.user.id, { exceptSid: req.user.sid })
  audit(req, 'PROFILE_OTHER_SESSIONS_REVOKED', 'user', req.user.id, { count })
  return { success: true, message: count ? `Signed out ${count} other session(s).` : 'No other active sessions.' }
}))

/**
 * Firm / organization details of the account's active organization.
 */
router.patch('/organization', handle((req) => {
  const user = requireSelf(req)
  const org = resolveOrganization(user)
  if (!org) throw httpError(404, 'You are not part of an organization.')
  if (!canEditOrganization(req, org)) throw httpError(403, 'Only organization owners and admins can edit firm details.')

  const body = req.body || {}
  const updates = {}
  if (body.name !== undefined) {
    const name = cleanOptional(body.name, 100, 'Organization name')
    if (!name) throw httpError(400, 'Organization name is required.')
    updates.name = name
  }
  const details = { ...(org.details || {}) }
  for (const [field, max] of Object.entries(FIRM_FIELDS)) {
    if (body[field] === undefined) continue
    details[field] = field === 'phone' ? cleanPhone(body[field], 'Firm phone number') : cleanOptional(body[field], max, field)
  }
  if (details.email && !EMAIL_REGEX.test(details.email)) throw httpError(400, 'Firm email address is not valid.')
  if (details.website && !/^https?:\/\/\S+$/i.test(details.website)) throw httpError(400, 'Website must start with http:// or https://')
  updates.details = details

  const fields = [...(updates.name && updates.name !== org.name ? ['name'] : []),
    ...Object.keys(FIRM_FIELDS).filter((f) => ((org.details || {})[f] || '') !== (details[f] || ''))]
  if (fields.length) {
    updateOrganization(org.id, updates)
    audit(req, 'ORGANIZATION_DETAILS_UPDATED', 'organization', org.id, { fields }, org.id)
  }
  return serializeProfile(req, user)
}))

export default router
