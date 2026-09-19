/**
 * Production-Grade Idempotency API Client Wrapper for AutoDeploy SaaS
 * Automatically attaches unique Idempotency-Key headers for state-mutating HTTP requests (POST, PUT, PATCH, DELETE).
 * Preserves the exact same key during retries of the same operation execution.
 */

// Active key cache per operation target to guarantee key preservation during retries
const operationKeyCache = new Map()

/**
 * Generate a cryptographically secure UUIDv4 / Random Idempotency Key
 */
export function generateIdempotencyKey(prefix = 'idemp') {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}_${crypto.randomUUID()}`
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`
}

/**
 * Perform an Idempotent API Fetch Request
 * @param {string} url - API Endpoint URL
 * @param {object} options - Fetch Options (method, headers, body, operationId, etc.)
 * @returns {Promise<Response>}
 */
export async function idempotencyFetch(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase()
  const isMutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)

  const headers = new Headers(options.headers || {})

  if (isMutating) {
    let idempotencyKey = headers.get('Idempotency-Key') || headers.get('X-Idempotency-Key')

    if (!idempotencyKey) {
      // If caller provided an operationId, reuse cached key for retries
      const cacheKey = options.operationId || `${method}:${url}:${options.body || ''}`
      if (operationKeyCache.has(cacheKey)) {
        idempotencyKey = operationKeyCache.get(cacheKey)
      } else {
        idempotencyKey = generateIdempotencyKey(options.keyPrefix || 'idemp')
        operationKeyCache.set(cacheKey, idempotencyKey)

        // Expire operation cache key after 5 minutes
        setTimeout(() => operationKeyCache.delete(cacheKey), 5 * 60 * 1000)
      }
      headers.set('Idempotency-Key', idempotencyKey)
    }
  }

  const updatedOptions = {
    ...options,
    headers
  }

  const response = await fetch(url, updatedOptions)

  // Clear operation key cache once operation completes successfully
  if (isMutating && options.operationId && response.ok) {
    operationKeyCache.delete(options.operationId)
  }

  return response
}
