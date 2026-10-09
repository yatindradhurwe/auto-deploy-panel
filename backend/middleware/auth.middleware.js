import jwt from 'jsonwebtoken'
import { JWT_SECRET, isSystemAdminUser } from '../config/secrets.js'
import { getUserById } from '../services/db.service.js'
import { getPlatformRole, getUserStatus, getPlatformSettings } from '../services/admin.service.js'

/**
 * Signs a session token. `tv` (token version) lets admins revoke every session of a user
 * by bumping user.tokenVersion.
 */
export function signSessionToken(user, { organizationId, expiresIn = '7d', impersonatedBy = null } = {}) {
  const payload = {
    id: user.id,
    name: user.fullName || user.name,
    email: user.email,
    organizationId: organizationId || user.organizationId || null,
    role: getPlatformRole(user),
    tv: user.tokenVersion || 0
  }
  if (impersonatedBy) payload.impersonatedBy = impersonatedBy
  return jwt.sign(payload, JWT_SECRET, { expiresIn })
}

export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'] || req.headers['Authorization']
  let token = authHeader && authHeader.split(' ')[1]

  // Allow token from query param for SSE event stream & iframe preview proxy requests
  if (!token && req.query) {
    token = req.query.token || req.query.jwtToken || req.query.authToken
  }

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No authentication token provided.' })
  }

  let decoded
  try {
    decoded = jwt.verify(token, JWT_SECRET)
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired authentication token. Please log in again.' })
  }

  // Re-check the account on every request so suspensions, deletions, role changes
  // and "sign out everywhere" take effect immediately instead of when the token expires.
  const user = getUserById(decoded.id)
  if (!user) {
    return res.status(401).json({ error: 'This account no longer exists.', code: 'ACCOUNT_DELETED' })
  }
  if ((decoded.tv || 0) !== (user.tokenVersion || 0)) {
    return res.status(401).json({ error: 'Your session was signed out. Please log in again.', code: 'SESSION_REVOKED' })
  }
  if (getUserStatus(user) === 'suspended') {
    return res.status(403).json({ error: `Your account has been suspended.${user.suspendedReason ? ` Reason: ${user.suspendedReason}` : ''}`, code: 'ACCOUNT_SUSPENDED' })
  }

  if (decoded.impersonatedBy) {
    const admin = getUserById(decoded.impersonatedBy)
    if (!admin || getPlatformRole(admin) !== 'superadmin' || getUserStatus(admin) === 'suspended') {
      return res.status(401).json({ error: 'Impersonation session is no longer valid.', code: 'SESSION_REVOKED' })
    }
  }

  req.user = {
    ...decoded,
    name: user.fullName || decoded.name,
    email: user.email,
    role: getPlatformRole(user)
  }

  const settings = getPlatformSettings()
  if (settings.maintenanceMode && req.user.role !== 'superadmin') {
    return res.status(503).json({ error: settings.maintenanceMessage, code: 'MAINTENANCE_MODE' })
  }

  next()
}

/**
 * Restricts an endpoint to the platform super admin.
 * Studio endpoints execute shell commands, read/write files and databases directly on the
 * panel host as root, so they must never be reachable by ordinary signed-up tenants.
 * Impersonation sessions never get admin rights, even when an admin started them.
 */
export const requireSystemAdmin = (req, res, next) => {
  if (!isSystemAdminUser(req.user) || req.user.impersonatedBy) {
    return res.status(403).json({ error: 'Access denied. This action requires platform administrator privileges.' })
  }
  next()
}
