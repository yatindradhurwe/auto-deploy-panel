/**
 * AutoDeploy In-Memory & Distributed Lock Service
 * Prevents concurrent deployments from executing simultaneously on the same project & environment.
 */

const activeLocks = new Map() // lockKey -> { organizationId, projectId, environment, acquiredAt, expiresAt }

/**
 * Generate lock key for deployment execution
 */
export function makeDeploymentLockKey(organizationId = 'org-default', projectId = 'default', environment = 'production') {
  return `deployment-lock:${organizationId}:${projectId}:${environment}`
}

/**
 * Acquire execution lock for a deployment job
 * @param {string} lockKey - Format: deployment-lock:orgId:projectId:env
 * @param {number} ttlMs - Lock time-to-live in milliseconds (default: 10 minutes)
 * @returns {{ acquired: boolean, lock?: object, message?: string }}
 */
export function acquireLock(lockKey, ttlMs = 10 * 60 * 1000) {
  const now = Date.now()

  // Clean stale lock if expired
  if (activeLocks.has(lockKey)) {
    const existing = activeLocks.get(lockKey)
    if (now > existing.expiresAt) {
      activeLocks.delete(lockKey)
    } else {
      return {
        acquired: false,
        message: `Deployment execution is currently locked for key '${lockKey}'. Active deployment running since ${new Date(existing.acquiredAt).toLocaleTimeString()}.`,
        lock: existing
      }
    }
  }

  const lockRecord = {
    lockKey,
    acquiredAt: now,
    expiresAt: now + ttlMs
  }

  activeLocks.set(lockKey, lockRecord)
  return { acquired: true, lock: lockRecord }
}

/**
 * Release execution lock
 */
export function releaseLock(lockKey) {
  if (activeLocks.has(lockKey)) {
    activeLocks.delete(lockKey)
    return true
  }
  return false
}

/**
 * Check if resource is currently locked
 */
export function isLocked(lockKey) {
  const now = Date.now()
  if (activeLocks.has(lockKey)) {
    const existing = activeLocks.get(lockKey)
    if (now > existing.expiresAt) {
      activeLocks.delete(lockKey)
      return false
    }
    return true
  }
  return false
}
