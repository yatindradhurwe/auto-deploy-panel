/**
 * Small in-memory fixed-window rate limiter for credential endpoints (login, signup, password changes).
 * State is per process, which is enough for this single-instance panel.
 */
export function createRateLimiter({ windowMs, max }) {
  const hits = new Map()

  const sweep = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key)
  }, Math.min(windowMs, 60 * 1000))
  sweep.unref()

  return {
    /** Counts an attempt; returns { allowed, retryAfterSec }. */
    hit(key) {
      const now = Date.now()
      let entry = hits.get(key)
      if (!entry || entry.resetAt <= now) {
        entry = { count: 0, resetAt: now + windowMs }
        hits.set(key, entry)
      }
      entry.count++
      return { allowed: entry.count <= max, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) }
    },
    reset(key) {
      hits.delete(key)
    }
  }
}

export function clientIp(req) {
  return String(req.ip || req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown'
}

/**
 * Sends a 429 and returns true when any of the keys is over its limit.
 */
export function rejectIfLimited(res, checks) {
  for (const [limiter, key] of checks) {
    const { allowed, retryAfterSec } = limiter.hit(key)
    if (!allowed) {
      res.set('Retry-After', String(retryAfterSec))
      res.status(429).json({ error: `Too many attempts. Try again in ${Math.ceil(retryAfterSec / 60)} minute(s).`, code: 'RATE_LIMITED' })
      return true
    }
  }
  return false
}
