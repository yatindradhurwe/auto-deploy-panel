import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react'
import { TOKEN_KEY, getStoredToken, storeSession, clearStoredSession, revokeToken } from '../utils/session'
import { stopImpersonation } from '../components/admin/adminApi'

/**
 * Global app state: the signed-in session, which portal it belongs to, and platform status.
 *
 * Two separate login portals share this store:
 *  - 'console' → super admin console, signs in at /admin/login
 *  - 'panel'   → organization server panel for admins, signs in at /login
 * The server enforces the split (POST /api/auth/login with `portal`); the store keeps the UI in step.
 */

export const PORTALS = {
  console: { loginPath: '/admin/login', homePath: '/admin/dashboard' },
  panel: { loginPath: '/login', homePath: '/app/dashboard' }
}

const PORTAL_KEY = 'autodeploy_portal'
const USER_KEY = 'autodeploy_user'

function readStored(key, parse = false) {
  try {
    const value = localStorage.getItem(key)
    return parse ? (value ? JSON.parse(value) : null) : value
  } catch {
    return null
  }
}

const isImpersonating = () => {
  try { return !!sessionStorage.getItem('autodeploy_admin_token') } catch { return false }
}

/** Portal for the current URL when nobody is signed in. */
export function portalFromPath(pathname = window.location.pathname) {
  return pathname.startsWith('/admin') ? 'console' : 'panel'
}

function initialState() {
  const token = getStoredToken()
  const user = readStored(USER_KEY, true)
  return {
    status: token && user ? 'verifying' : 'anonymous', // 'verifying' | 'authenticated' | 'anonymous' | 'maintenance'
    token: token || '',
    user: token ? user : null,
    portal: (token && (readStored(PORTAL_KEY) || user?.portal)) || null,
    notice: '',
    maintenanceMessage: '',
    platformStatus: null
  }
}

function reducer(state, action) {
  switch (action.type) {
    case 'SESSION_STARTED':
      return { ...state, status: 'authenticated', token: action.token, user: action.user, portal: action.portal, notice: '', maintenanceMessage: '' }
    case 'SESSION_VERIFIED':
      return { ...state, status: 'authenticated', user: action.user, portal: action.portal || state.portal }
    case 'SESSION_UPDATED':
      return { ...state, user: { ...state.user, ...action.user }, token: action.token || state.token }
    case 'SESSION_ENDED':
      return { ...state, status: 'anonymous', token: '', user: null, portal: null, notice: action.notice || '' }
    case 'MAINTENANCE':
      return { ...state, status: 'maintenance', maintenanceMessage: action.message }
    case 'VERIFY_SKIPPED':
      return { ...state, status: state.token && state.user ? 'authenticated' : 'anonymous' }
    case 'PLATFORM_STATUS':
      return { ...state, platformStatus: action.platformStatus }
    case 'CLEAR_NOTICE':
      return { ...state, notice: '' }
    default:
      return state
  }
}

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState)
  const endingRef = useRef(false)
  const stateRef = useRef(state)
  stateRef.current = state

  const endLocally = useCallback((notice = '', portal = stateRef.current.portal || portalFromPath()) => {
    clearStoredSession()
    try { localStorage.removeItem(PORTAL_KEY) } catch { /* private mode */ }
    window.history.replaceState(null, '', PORTALS[portal]?.loginPath || '/login')
    dispatch({ type: 'SESSION_ENDED', notice })
  }, [])

  // The server ended this session (logged out elsewhere, revoked, expired, suspended…)
  const sessionEnded = useCallback((message) => {
    if (endingRef.current) return
    endingRef.current = true
    if (isImpersonating()) {
      stopImpersonation()
      return
    }
    endLocally(message || 'Your session has ended. Please log in again.')
  }, [endLocally])

  const startSession = useCallback((token, user, portal) => {
    const resolved = portal || user?.portal || 'panel'
    endingRef.current = false
    storeSession(token, { ...user, portal: resolved })
    try { localStorage.setItem(PORTAL_KEY, resolved) } catch { /* private mode */ }
    window.history.replaceState(null, '', PORTALS[resolved].homePath)
    dispatch({ type: 'SESSION_STARTED', token, user: { ...user, portal: resolved }, portal: resolved })
  }, [])

  /**
   * Signs in through one portal. Throws with the server's message; a super admin using the
   * organization login gets `err.code === 'USE_CONSOLE_LOGIN'`.
   */
  const login = useCallback(async (portal, email, password) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, portal })
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw Object.assign(new Error(data.error || 'Login failed'), { code: data.code, loginUrl: data.loginUrl })
    startSession(data.token, data.user, data.portal || portal)
    return data
  }, [startSession])

  const logout = useCallback(async () => {
    const { user, token, portal } = stateRef.current
    if (user?.impersonatedBy || isImpersonating()) {
      stopImpersonation()
      return
    }
    endingRef.current = true
    await revokeToken(token)
    endLocally('', portal)
  }, [endLocally])

  // Profile changes refresh the stored user; a password change also issues a new token
  const updateSession = useCallback((user, token) => {
    const merged = { ...stateRef.current.user, ...user }
    storeSession(token, merged)
    dispatch({ type: 'SESSION_UPDATED', user: merged, token })
  }, [])

  useEffect(() => {
    fetch('/api/auth/platform-status')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && dispatch({ type: 'PLATFORM_STATUS', platformStatus: data }))
      .catch(() => {})
  }, [])

  // Verify the stored session once on load
  useEffect(() => {
    const token = getStoredToken()
    if (!token || !stateRef.current.user) {
      if (token) endLocally()
      return
    }
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (res.ok && data.user) {
          storeSession(null, data.user)
          if (data.user.portal) try { localStorage.setItem(PORTAL_KEY, data.user.portal) } catch { /* private mode */ }
          dispatch({ type: 'SESSION_VERIFIED', user: data.user, portal: data.user.portal })
        } else if (res.status === 503) {
          dispatch({ type: 'MAINTENANCE', message: data.error || 'The platform is under maintenance. Please check back shortly.' })
        } else if (res.status === 401 || res.status === 403) {
          sessionEnded(data.error)
        } else {
          dispatch({ type: 'VERIFY_SKIPPED' })
        }
      })
      .catch(() => dispatch({ type: 'VERIFY_SKIPPED' }))
  }, [endLocally, sessionEnded])

  // Server-ended sessions (from utils/session's fetch guard) and logins/logouts in other tabs
  useEffect(() => {
    const onEnded = (e) => sessionEnded(e.detail?.message)
    const onStorage = (e) => {
      if (e.key !== TOKEN_KEY && e.key !== null) return
      if (!getStoredToken()) {
        if (endingRef.current) return
        endingRef.current = true
        endLocally('You were logged out in another tab.')
      } else if (e.newValue && e.newValue !== e.oldValue) {
        window.location.reload()
      }
    }
    window.addEventListener('autodeploy:session-ended', onEnded)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('autodeploy:session-ended', onEnded)
      window.removeEventListener('storage', onStorage)
    }
  }, [endLocally, sessionEnded])

  const value = useMemo(() => ({
    ...state,
    isSuperAdmin: state.user?.role === 'superadmin' && !state.user?.impersonatedBy,
    login,
    startSession,
    logout,
    updateSession,
    clearNotice: () => dispatch({ type: 'CLEAR_NOTICE' })
  }), [state, login, startSession, logout, updateSession])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
