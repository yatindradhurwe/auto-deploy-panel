import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SECRET_FILE = path.resolve(__dirname, '../data/.jwt_secret')

/**
 * Resolves the JWT signing secret.
 * Priority: JWT_SECRET env var > persisted random secret in data/.jwt_secret (gitignored).
 * Never falls back to a hardcoded value — a public secret lets anyone forge admin tokens.
 */
function resolveJwtSecret() {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32) {
    return process.env.JWT_SECRET
  }
  try {
    const existing = fs.readFileSync(SECRET_FILE, 'utf8').trim()
    if (existing.length >= 32) return existing
  } catch (e) {}

  const generated = crypto.randomBytes(48).toString('hex')
  fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true })
  fs.writeFileSync(SECRET_FILE, generated, { mode: 0o600 })
  console.log('[SECURITY] Generated new JWT signing secret at data/.jwt_secret')
  return generated
}

export const JWT_SECRET = resolveJwtSecret()

/**
 * Returns true when the authenticated user is the platform owner / super admin.
 * Only trusts fields from a signature-verified JWT.
 */
export function isSystemAdminUser(user) {
  return !!user && (user.id === 'admin-001' || user.role === 'superadmin')
}
