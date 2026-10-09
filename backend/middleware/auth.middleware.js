import jwt from 'jsonwebtoken'
import { JWT_SECRET, isSystemAdminUser } from '../config/secrets.js'

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

  try {
    req.user = jwt.verify(token, JWT_SECRET)
    next()
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired authentication token. Please log in again.' })
  }
}

/**
 * Restricts an endpoint to the platform super admin.
 * Studio endpoints execute shell commands, read/write files and databases directly on the
 * panel host as root, so they must never be reachable by ordinary signed-up tenants.
 */
export const requireSystemAdmin = (req, res, next) => {
  if (!isSystemAdminUser(req.user)) {
    return res.status(403).json({ error: 'Access denied. This action requires platform administrator privileges.' })
  }
  next()
}
