import React, { useState, useEffect, useRef } from 'react'
import { Eye, Megaphone, Wrench } from 'lucide-react'
import { stopImpersonation } from './components/admin/adminApi'
import SaaSAuthPages from './components/SaaSAuthPages'
import CustomerDashboardLayout from './components/CustomerDashboardLayout'
import SuperAdminDashboardLayout from './components/SuperAdminDashboardLayout'
import { TOKEN_KEY, getStoredToken, storeSession, clearStoredSession, revokeToken } from './utils/session'

const isSuperAdminUser = (user) => (user?.role === 'superadmin' || user?.id === 'admin-001') && !user?.impersonatedBy
const isImpersonating = () => {
  try { return !!sessionStorage.getItem('autodeploy_admin_token') } catch { return false }
}

export default function App() {
  const [jwtToken, setJwtToken] = useState(getStoredToken)
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const saved = localStorage.getItem('autodeploy_user')
      return saved ? JSON.parse(saved) : null
    } catch (e) {
      return null
    }
  })
  const [verifyingSession, setVerifyingSession] = useState(true)
  const [platformStatus, setPlatformStatus] = useState(null)
  const [maintenanceMessage, setMaintenanceMessage] = useState('')
  const [sessionNotice, setSessionNotice] = useState('')
  const endingRef = useRef(false)

  // Drops the local session and shows the login screen (the server side is already gone or being revoked)
  const resetToLogin = (notice = '') => {
    clearStoredSession()
    setJwtToken('')
    setCurrentUser(null)
    setSessionNotice(notice)
    window.history.replaceState(null, '', '/')
  }

  // The server ended this session (logged out elsewhere, revoked, expired, suspended…)
  const handleSessionEnded = (message) => {
    if (endingRef.current) return
    endingRef.current = true
    if (isImpersonating()) {
      stopImpersonation()
      return
    }
    resetToLogin(message || 'Your session has ended. Please log in again.')
  }

  useEffect(() => {
    fetch('/api/auth/platform-status')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setPlatformStatus(data))
      .catch(() => {})
  }, [])

  useEffect(() => {
    const onEnded = (e) => handleSessionEnded(e.detail?.message)
    // Another tab logged in, out, or switched accounts
    const onStorage = (e) => {
      if (e.key !== TOKEN_KEY && e.key !== null) return
      if (!getStoredToken()) {
        if (endingRef.current) return
        endingRef.current = true
        resetToLogin('You were logged out in another tab.')
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
  }, [])

  // Verify JWT session on initial load
  useEffect(() => {
    const verifySession = async () => {
      const token = getStoredToken()
      if (!token) {
        setVerifyingSession(false)
        return
      }
      try {
        const res = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` }
        })
        if (res.ok) {
          const data = await res.json()
          if (data.user) {
            setCurrentUser(data.user)
            storeSession(null, data.user)
          }
        } else if (res.status === 503) {
          const data = await res.json().catch(() => ({}))
          setMaintenanceMessage(data.error || 'The platform is under maintenance. Please check back shortly.')
        } else if (res.status === 401 || res.status === 403) {
          const data = await res.json().catch(() => ({}))
          handleSessionEnded(data.error)
        }
      } catch (err) {
        console.warn('Session verification check:', err)
      } finally {
        setVerifyingSession(false)
      }
    }
    verifySession()
  }, [])

  const handleLoginSuccess = (user, token) => {
    // Super admins land in the platform console, admins in their server panel
    window.history.replaceState(null, '', isSuperAdminUser(user) ? '/admin/dashboard' : '/app/dashboard')
    endingRef.current = false
    storeSession(token, user)
    setSessionNotice('')
    setCurrentUser(user)
    setJwtToken(token)
  }

  // Profile changes refresh the stored user; a password change also issues a new token
  const handleSessionUpdate = (user, token) => {
    const merged = { ...currentUser, ...user }
    storeSession(token, merged)
    setCurrentUser(merged)
    if (token) setJwtToken(token)
  }

  const handleLogout = async () => {
    if (currentUser?.impersonatedBy || isImpersonating()) {
      stopImpersonation()
      return
    }
    endingRef.current = true
    await revokeToken(jwtToken)
    resetToLogin()
  }

  if (verifyingSession) {
    return (
      <div className="min-h-screen bg-[#07090E] flex flex-col items-center justify-center text-slate-100 font-sans">
        <div className="flex flex-col items-center gap-3">
          <div className="w-9 h-9 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-xs text-slate-400 font-mono tracking-wide">Verifying Session & Tenant Context...</p>
        </div>
      </div>
    )
  }

  if (maintenanceMessage) {
    return (
      <div className="min-h-screen bg-[#07090E] flex items-center justify-center p-6 text-slate-100 font-sans">
        <div className="bg-slate-900 border border-amber-500/30 rounded-2xl p-8 max-w-md w-full text-center space-y-4 shadow-2xl">
          <div className="w-12 h-12 rounded-xl bg-amber-500/10 text-amber-300 flex items-center justify-center mx-auto">
            <Wrench className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold text-white">Scheduled maintenance</h2>
          <p className="text-sm text-slate-300">{maintenanceMessage}</p>
          <button onClick={() => window.location.reload()} className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs rounded-xl cursor-pointer">
            Try again
          </button>
        </div>
      </div>
    )
  }

  if (!jwtToken || !currentUser) {
    return <SaaSAuthPages platformStatus={platformStatus} sessionNotice={sessionNotice} onAuthSuccess={(token, user) => handleLoginSuccess(user, token)} />
  }

  const banners = (
    <>
      {currentUser?.impersonatedBy && (
        <div className="sticky top-0 z-[60] bg-amber-500 text-slate-950 px-4 py-2 text-xs font-bold flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
          <span className="flex items-center gap-1.5"><Eye className="w-4 h-4" />Viewing as {currentUser.email}. Actions you take affect this customer's account.</span>
          <button onClick={stopImpersonation} className="px-3 py-1 rounded-lg bg-slate-950 text-amber-300 hover:bg-slate-800 cursor-pointer">
            Return to admin
          </button>
        </div>
      )}
      {platformStatus?.announcement && (
        <div className="bg-cyan-500/10 border-b border-cyan-500/30 text-cyan-100 px-4 py-2 text-xs flex items-center justify-center gap-2 text-center">
          <Megaphone className="w-4 h-4 shrink-0 text-cyan-300" />
          <span>{platformStatus.announcement}</span>
        </div>
      )}
    </>
  )

  const isSuperAdmin = isSuperAdminUser(currentUser)
  const path = window.location.pathname
  let isPathAdmin = path.startsWith('/admin') || window.location.hash.startsWith('#/admin')

  // /admin is the super admin console; /app is the server & project panel used by admins.
  // Super admins open the console by default and can still reach their own servers under /app.
  if (isPathAdmin && !isSuperAdmin) {
    window.history.replaceState(null, '', '/app/dashboard')
    isPathAdmin = false
  } else if (!isPathAdmin && isSuperAdmin && !path.startsWith('/app')) {
    window.history.replaceState(null, '', '/admin/dashboard')
    isPathAdmin = true
  }

  if (isPathAdmin) {
    return (
      <>
        {banners}
        <SuperAdminDashboardLayout
          currentUser={currentUser}
          jwtToken={jwtToken}
          onLogout={handleLogout}
          onSessionUpdate={handleSessionUpdate}
        />
      </>
    )
  }

  return (
    <>
      {banners}
      <CustomerDashboardLayout
        currentUser={currentUser}
        jwtToken={jwtToken}
        onLogout={handleLogout}
        onSessionUpdate={handleSessionUpdate}
      />
    </>
  )
}
