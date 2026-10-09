/**
 * Client side of the session: where the token lives and what happens when the server ends it.
 *
 * Any /api/ response saying the session is gone (logged out elsewhere, revoked, expired, account
 * suspended or deleted) fires `autodeploy:session-ended`, and App returns to the login screen
 * instead of leaving screens half-broken. Logging out in one tab also logs out the other tabs.
 */

export const TOKEN_KEY = 'autodeploy_token'
export const USER_KEY = 'autodeploy_user'
const LEGACY_TOKEN_KEY = 'autodeploy_jwt_token'

// Codes from authenticateToken that mean "this token will never work again"
const SESSION_ENDED_CODES = new Set(['SESSION_REVOKED', 'SESSION_EXPIRED', 'INVALID_TOKEN', 'NO_TOKEN', 'ACCOUNT_DELETED', 'ACCOUNT_SUSPENDED'])
// Credential endpoints answer 401 for a wrong password, which is not a session problem
const IGNORED_PATHS = [/\/api\/auth\/(login|signup)$/]

export function getStoredToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || localStorage.getItem(LEGACY_TOKEN_KEY) || ''
  } catch {
    return ''
  }
}

export function storeSession(token, user) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    localStorage.removeItem(LEGACY_TOKEN_KEY)
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user))
  } catch { /* private mode */ }
}

export function clearStoredSession() {
  try {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(LEGACY_TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
  } catch { /* private mode */ }
}

/**
 * Ends a token on the server. `keepalive` lets the request finish while the page navigates away.
 */
export function revokeToken(token) {
  if (!token) return Promise.resolve()
  return fetch('/api/auth/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    keepalive: true
  }).catch(() => {})
}

let installed = false

export function installSessionGuard() {
  if (installed || typeof window === 'undefined') return
  installed = true
  const nativeFetch = window.fetch.bind(window)

  window.fetch = async (input, init) => {
    const res = await nativeFetch(input, init)
    if (res.status !== 401 && res.status !== 403) return res
    const url = typeof input === 'string' ? input : input?.url || ''
    const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0]
    if (!path.startsWith('/api/') || IGNORED_PATHS.some((re) => re.test(path))) return res

    // Only react to the token the app currently holds, not to a stale request from before a re-login
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined))
    const sentToken = (headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    if (!sentToken || sentToken !== getStoredToken()) return res

    res.clone().json().then((data) => {
      if (data && SESSION_ENDED_CODES.has(data.code)) {
        window.dispatchEvent(new CustomEvent('autodeploy:session-ended', { detail: { code: data.code, message: data.error } }))
      }
    }).catch(() => {})
    return res
  }
}
