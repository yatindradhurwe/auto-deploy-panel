import React, { useState, useEffect } from 'react'
import { ShieldCheck, Zap, LogOut, Eye, Megaphone, Wrench } from 'lucide-react'
import { stopImpersonation } from './components/admin/adminApi'
import SaaSAuthPages from './components/SaaSAuthPages'
import CustomerDashboardLayout from './components/CustomerDashboardLayout'
import SuperAdminDashboardLayout from './components/SuperAdminDashboardLayout'

export default function App() {
  const [jwtToken, setJwtToken] = useState(() => localStorage.getItem('autodeploy_token') || localStorage.getItem('autodeploy_jwt_token') || '')
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

  useEffect(() => {
    fetch('/api/auth/platform-status')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setPlatformStatus(data))
      .catch(() => {})
  }, [])

  // Verify JWT session on initial load
  useEffect(() => {
    const verifySession = async () => {
      const token = localStorage.getItem('autodeploy_token') || localStorage.getItem('autodeploy_jwt_token')
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
            localStorage.setItem('autodeploy_user', JSON.stringify(data.user))
          }
        } else if (res.status === 503) {
          const data = await res.json().catch(() => ({}))
          setMaintenanceMessage(data.error || 'The platform is under maintenance. Please check back shortly.')
        } else if (res.status === 401 || res.status === 403) {
          // An expired impersonation session returns the admin to their own session
          if (sessionStorage.getItem('autodeploy_admin_token')) {
            stopImpersonation()
            return
          }
          handleLogout()
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
    setCurrentUser(user)
    setJwtToken(token)
    localStorage.setItem('autodeploy_token', token)
    localStorage.setItem('autodeploy_user', JSON.stringify(user))
  }

  const handleLogout = async () => {
    if (currentUser?.impersonatedBy) {
      stopImpersonation()
      return
    }
    try {
      if (jwtToken) {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${jwtToken}` }
        }).catch(() => {})
      }
    } finally {
      localStorage.removeItem('autodeploy_token')
      localStorage.removeItem('autodeploy_jwt_token')
      localStorage.removeItem('autodeploy_user')
      setJwtToken('')
      setCurrentUser(null)
    }
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
    return <SaaSAuthPages platformStatus={platformStatus} onAuthSuccess={(token, user) => handleLoginSuccess(user, token)} />
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

  const isSuperAdmin = (currentUser?.role === 'admin' || currentUser?.id === 'admin-001') && !currentUser?.impersonatedBy
  const isPathAdmin = window.location.pathname.startsWith('/admin') || window.location.hash.startsWith('#/admin')

  if (isPathAdmin) {
    if (!isSuperAdmin) {
      return (
        <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-100 p-6 font-sans">
          <div className="bg-slate-900 border border-rose-500/30 rounded-2xl p-8 max-w-md w-full text-center space-y-4 shadow-2xl">
            <div className="w-12 h-12 rounded-xl bg-rose-500/10 text-rose-400 flex items-center justify-center mx-auto">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <h2 className="text-xl font-bold text-white">403 Forbidden Access Denied</h2>
            <p className="text-xs text-slate-400">
              The Super Admin Portal (/admin/*) is restricted to platform administrators. Your account does not have Super Admin permissions.
            </p>
            <a
              href="/app/dashboard"
              className="inline-block px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-indigo-600 text-white font-bold text-xs rounded-xl shadow-lg shadow-cyan-500/20"
            >
              Return to Customer Dashboard (/app/dashboard)
            </a>
          </div>
        </div>
      )
    }

    return (
      <>
        {banners}
        <SuperAdminDashboardLayout
          currentUser={currentUser}
          jwtToken={jwtToken}
          onLogout={handleLogout}
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
      />
    </>
  )
}
