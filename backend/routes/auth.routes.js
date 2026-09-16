import express from 'express'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { authenticateToken } from '../middleware/auth.middleware.js'

const router = express.Router()

const JWT_SECRET = process.env.JWT_SECRET || 'autodeploy_super_secret_jwt_key_2026'

// Configurable Admin Credentials (with sensible defaults)
const DEFAULT_ADMIN = {
  id: 'admin-001',
  name: 'System Admin',
  email: process.env.ADMIN_EMAIL || 'admin@tipcrm.com',
  // Pre-hashed password for 'admin123' if env password not provided
  passwordHash: process.env.ADMIN_PASSWORD
    ? bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10)
    : '$2a$10$f/9K3P01b0V.qLz0P6J/6e3Oq8zQf1g1234567890abcdefgHiJKL', // bcrypt hash for 'admin123'
  plainPassword: process.env.ADMIN_PASSWORD || 'admin123', // For quick fallback check
  role: 'admin',
  avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=150'
}

/**
 * POST /api/auth/login
 * Body: { email, password }
 */
router.post('/login', (req, res) => {
  const { email, password } = req.body

  if (!email || !password) {
    return res.status(400).json({ error: 'Email address and password are required.' })
  }

  const normalizedInputEmail = email.trim().toLowerCase()
  const normalizedAdminEmail = DEFAULT_ADMIN.email.toLowerCase()

  if (normalizedInputEmail !== normalizedAdminEmail) {
    return res.status(401).json({ error: 'Invalid email address or password.' })
  }

  // Check password against plain default or bcrypt hash
  const isValidPassword =
    password === DEFAULT_ADMIN.plainPassword ||
    bcrypt.compareSync(password, DEFAULT_ADMIN.passwordHash)

  if (!isValidPassword) {
    return res.status(401).json({ error: 'Invalid email address or password.' })
  }

  // Generate JWT token valid for 24 hours
  const payload = {
    id: DEFAULT_ADMIN.id,
    name: DEFAULT_ADMIN.name,
    email: DEFAULT_ADMIN.email,
    role: DEFAULT_ADMIN.role
  }

  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' })

  return res.json({
    message: 'Authentication successful',
    token,
    user: {
      id: DEFAULT_ADMIN.id,
      name: DEFAULT_ADMIN.name,
      email: DEFAULT_ADMIN.email,
      role: DEFAULT_ADMIN.role,
      avatar: DEFAULT_ADMIN.avatar
    }
  })
})

/**
 * GET /api/auth/me
 * Header: Authorization: Bearer <token>
 */
router.get('/me', authenticateToken, (req, res) => {
  res.json({
    user: {
      ...req.user,
      avatar: DEFAULT_ADMIN.avatar
    }
  })
})

/**
 * POST /api/auth/logout
 * Header: Authorization: Bearer <token>
 */
router.post('/logout', authenticateToken, (req, res) => {
  res.json({ message: 'Session logged out successfully' })
})

export default router
