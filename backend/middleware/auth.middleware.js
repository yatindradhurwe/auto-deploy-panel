import jwt from 'jsonwebtoken'
import { JWT_SECRET, isSystemAdminUser } from '../config/secrets.js'
import { getUserById } from '../services/db.service.js'
import { getPlatformRole, getUserStatus, getPlatformSettings } from '../services/admin.service.js'
import { newSessionId, createSession, getActiveSession, touchSession } from '../services/session.service.js'

const JWT_OPTIONS = { algorithm: 'HS256', issuer: 'autodeploy-panel', audience: 'autodeploy-panel' }

// Browsers can't set headers on EventSource or iframe requests, so only these GET endpoints accept ?token=
const QUERY_TOKEN_PATHS = [/^\/api\/deploy\/stream\/[^/]+$/, /^\/api\/studio\/preview-proxy$/]

/**
 * Signs a session token and registers its server-side session.
 *  - `sid` must match an active session, so logout/revocation takes effect immediately
 *  - `tv` (token version) lets admins revoke every session of a user by bumping user.tokenVersion
 */
export function signSessionToken(user, { organizationId, expiresIn = '7d', impersonatedBy = null, req = null } = {}) {
  const sid = newSessionId()
  const payload = {
    id: user.id,
    name: user.fullName || user.name,
    email: user.email,
    organizationId: organizationId || user.organizationId || null,
    role: getPlatformRole(user),
    tv: user.tokenVersion || 0,
    sid
  }
  if (impersonatedBy) payload.impersonatedBy = impersonatedBy
  const token = jwt.sign(payload, JWT_SECRET, { ...JWT_OPTIONS, expiresIn, jwtid: sid })
  const { exp } = jwt.decode(token)
  createSession({ id: sid, userId: user.id, expiresAt: new Date(exp * 1000).toISOString(), impersonatedBy, req })
  return token
}

export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'] || req.headers['Authorization']
  let token = authHeader && authHeader.split(' ')[1]

  if (!token && req.method === 'GET' && req.query && QUERY_TOKEN_PATHS.some((re) => re.test(req.originalUrl.split('?')[0]))) {
    token = req.query.token
  }

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No authentication token provided.', code: 'NO_TOKEN' })
  }

  let decoded
  try {
    decoded = jwt.verify(token, JWT_SECRET, { algorithms: [JWT_OPTIONS.algorithm], issuer: JWT_OPTIONS.issuer, audience: JWT_OPTIONS.audience })
  } catch (err) {
    const expired = err.name === 'TokenExpiredError'
    return res.status(401).json({ error: expired ? 'Your session has expired. Please log in again.' : 'Invalid authentication token. Please log in again.', code: expired ? 'SESSION_EXPIRED' : 'INVALID_TOKEN' })
  }

  const session = getActiveSession(decoded.sid)
  if (!session || session.userId !== decoded.id) {
    return res.status(401).json({ error: 'Your session has ended. Please log in again.', code: 'SESSION_REVOKED' })
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

  touchSession(session, req)
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
