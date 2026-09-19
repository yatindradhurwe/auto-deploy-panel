import crypto from 'crypto'
import {
  getIdempotencyRecord,
  createIdempotencyRecord,
  updateIdempotencyRecord
} from '../services/db.service.js'

/**
 * Deterministically compute SHA-256 hash of HTTP_METHOD + REQUEST_PATH + NORMALIZED_BODY
 */
export function calculateRequestHash(method, path, body) {
  const normMethod = (method || 'POST').toUpperCase().trim()
  const normPath = (path || '/').trim()

  function normalizeValue(val) {
    if (val === null || val === undefined) return null
    if (typeof val !== 'object') return val
    if (Array.isArray(val)) return val.map(normalizeValue)

    const sortedObj = {}
    Object.keys(val).sort().forEach(k => {
      // Mask sensitive secret keys from hash calculation to prevent accidental leaks
      if (['password', 'token', 'secret', 'apiKey', 'githubToken', 'smtpPassword'].includes(k)) {
        sortedObj[k] = '***MASKED***'
      } else {
        sortedObj[k] = normalizeValue(val[k])
      }
    })
    return sortedObj
  }

  const normBody = body ? JSON.stringify(normalizeValue(body)) : ''
  const payloadString = `${normMethod}:${normPath}:${normBody}`

  return crypto.createHash('sha256').update(payloadString).digest('hex')
}

/**
 * Reusable Backend Idempotency Middleware
 */
export function requireIdempotency(options = { required: false }) {
  return (req, res, next) => {
    // Only intercept state-mutating HTTP methods
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      return next()
    }

    const idempotencyKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key']
    if (!idempotencyKey) {
      if (options.required) {
        return res.status(400).json({
          error: 'Missing required Idempotency-Key header for state-mutating operation.',
          code: 'IDEMPOTENCY_KEY_REQUIRED'
        })
      }
      res.setHeader('Idempotency-Replayed', 'false')
      return next()
    }

    const orgId = req.tenant?.organizationId || req.user?.organizationId || 'org-default'
    const userId = req.user?.id || 'system'
    const requestHash = calculateRequestHash(req.method, req.originalUrl || req.path, req.body)

    const existingRecord = getIdempotencyRecord(orgId, idempotencyKey)

    if (existingRecord) {
      // Check 1: Request Hash mismatch with same Idempotency-Key
      if (existingRecord.requestHash !== requestHash) {
        console.warn(`[IDEMPOTENCY CONFLICT] org=${orgId} key=${idempotencyKey} path=${req.path} status=HASH_MISMATCH`)
        return res.status(409).json({
          success: false,
          error: 'This Idempotency-Key has already been used for a different request.',
          code: 'IDEMPOTENCY_HASH_MISMATCH',
          idempotencyKey
        })
      }

      // Check 2: Completed Request Replay
      if (existingRecord.status === 'COMPLETED') {
        console.log(`[IDEMPOTENCY REPLAY] org=${orgId} key=${idempotencyKey} path=${req.path} status=REPLAYED resource=${existingRecord.resourceId}`)
        res.setHeader('Idempotency-Replayed', 'true')

        // Track replayed count
        updateIdempotencyRecord(orgId, idempotencyKey, {
          replayedCount: (existingRecord.replayedCount || 0) + 1,
          lastReplayedAt: new Date().toISOString()
        })

        const status = existingRecord.responseStatus || 200
        return res.status(status).json(existingRecord.responseBody || { success: true })
      }

      // Check 3: Currently Processing Request
      if (existingRecord.status === 'PROCESSING') {
        const ageMs = Date.now() - new Date(existingRecord.createdAt).getTime()
        // Crash recovery timeout: 5 minutes
        if (ageMs > 5 * 60 * 1000) {
          console.warn(`[IDEMPOTENCY TIMEOUT RECOVERY] org=${orgId} key=${idempotencyKey} - restarting expired operation`)
          updateIdempotencyRecord(orgId, idempotencyKey, { status: 'EXPIRED' })
        } else {
          console.warn(`[IDEMPOTENCY IN_PROGRESS] org=${orgId} key=${idempotencyKey} path=${req.path}`)
          res.setHeader('Idempotency-Replayed', 'true')
          return res.status(409).json({
            success: false,
            error: 'An operation with this Idempotency-Key is currently processing. Please wait for completion.',
            code: 'IDEMPOTENCY_IN_PROGRESS',
            idempotencyKey
          })
        }
      }
    }

    // Create new PROCESSING idempotency record
    const { record } = createIdempotencyRecord({
      organizationId: orgId,
      userId,
      idempotencyKey,
      requestHash,
      httpMethod: req.method,
      requestPath: req.originalUrl || req.path,
      resourceType: req.path.split('/')[2] || 'generic'
    })

    res.setHeader('Idempotency-Replayed', 'false')

    // Intercept res.json / res.send to save response output
    const originalJson = res.json.bind(res)
    let isResponseCaptured = false

    res.json = (body) => {
      if (!isResponseCaptured) {
        isResponseCaptured = true
        const statusCode = res.statusCode || 200
        const isSuccess = statusCode >= 200 && statusCode < 400

        // Sanitize sensitive values from saved response body
        const sanitizedBody = JSON.parse(JSON.stringify(body || {}))
        if (sanitizedBody.password) sanitizedBody.password = '***MASKED***'
        if (sanitizedBody.token) sanitizedBody.token = '***MASKED***'
        if (sanitizedBody.agentToken) sanitizedBody.agentToken = '***MASKED***'

        const resourceId = body?.id || body?.server?.id || body?.project?.id || body?.deploymentId || body?.account?.id || null

        updateIdempotencyRecord(orgId, idempotencyKey, {
          status: isSuccess ? 'COMPLETED' : 'FAILED',
          responseStatus: statusCode,
          responseBody: sanitizedBody,
          resourceId: resourceId || record.resourceId
        })
      }
      return originalJson(body)
    }

    next()
  }
}
