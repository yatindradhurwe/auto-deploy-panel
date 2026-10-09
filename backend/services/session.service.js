import crypto from 'crypto'
import { readDb, writeDb } from './db.service.js'

/**
 * Server-side session registry. Every JWT carries a `sid` that must match an active session here,
 * so logging out (or revoking a device) invalidates that token immediately instead of when it expires.
 */

const MAX_SESSIONS_PER_USER = 20
const TOUCH_INTERVAL_MS = 5 * 60 * 1000

export function newSessionId() {
  return crypto.randomBytes(18).toString('base64url')
}

function isActive(session, now = Date.now()) {
  return !!session && !session.revokedAt && new Date(session.expiresAt).getTime() > now
}

function clientInfo(req) {
  if (!req) return { ip: null, userAgent: null }
  return {
    ip: String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim() || null,
    userAgent: String(req.headers['user-agent'] || '').slice(0, 300) || null
  }
}

/**
 * Stores a session and drops expired/revoked ones, keeping at most MAX_SESSIONS_PER_USER per user.
 */
export function createSession({ id, userId, expiresAt, impersonatedBy = null, req = null }) {
  const db = readDb()
  if (!db.sessions) db.sessions = {}
  const now = Date.now()
  for (const [sid, s] of Object.entries(db.sessions)) {
    if (!isActive(s, now)) delete db.sessions[sid]
  }
  const mine = Object.values(db.sessions)
    .filter((s) => s.userId === userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  for (const old of mine.slice(MAX_SESSIONS_PER_USER - 1)) delete db.sessions[old.id]

  const createdAt = new Date(now).toISOString()
  db.sessions[id] = { id, userId, impersonatedBy, createdAt, lastSeenAt: createdAt, expiresAt, revokedAt: null, ...clientInfo(req) }
  writeDb(db)
  return db.sessions[id]
}

export function getActiveSession(sid) {
  if (!sid) return null
  const session = (readDb().sessions || {})[sid]
  return isActive(session) ? session : null
}

/**
 * Records activity at most every few minutes so authenticated requests don't rewrite the database each time.
 */
export function touchSession(session, req) {
  if (Date.now() - new Date(session.lastSeenAt).getTime() < TOUCH_INTERVAL_MS) return
  const db = readDb()
  const s = (db.sessions || {})[session.id]
  if (!s) return
  s.lastSeenAt = new Date().toISOString()
  Object.assign(s, clientInfo(req))
  writeDb(db)
}

export function revokeSession(sid, userId = null) {
  const db = readDb()
  const s = (db.sessions || {})[sid]
  if (!s || s.revokedAt || (userId && s.userId !== userId)) return false
  s.revokedAt = new Date().toISOString()
  writeDb(db)
  return true
}

/**
 * Revokes every active session of a user, optionally keeping one (the caller's own).
 */
export function revokeUserSessions(userId, { exceptSid = null } = {}) {
  const db = readDb()
  let count = 0
  const now = new Date().toISOString()
  for (const s of Object.values(db.sessions || {})) {
    if (s.userId === userId && s.id !== exceptSid && !s.revokedAt) {
      s.revokedAt = now
      count++
    }
  }
  if (count) writeDb(db)
  return count
}

export function listUserSessions(userId) {
  const now = Date.now()
  return Object.values(readDb().sessions || {})
    .filter((s) => s.userId === userId && isActive(s, now))
    .sort((a, b) => new Date(b.lastSeenAt) - new Date(a.lastSeenAt))
    .map(({ id, createdAt, lastSeenAt, expiresAt, ip, userAgent, impersonatedBy }) => ({ id, createdAt, lastSeenAt, expiresAt, ip, userAgent, impersonatedBy }))
}
