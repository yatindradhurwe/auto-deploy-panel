import React, { useState, useEffect } from 'react'
import { ShieldCheck, Zap, LogOut } from 'lucide-react'
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
        } else if (res.status === 401 || res.status === 403) {
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

  if (!jwtToken || !currentUser) {
    return <SaaSAuthPages onAuthSuccess={(token, user) => handleLoginSuccess(user, token)} />
  }

  const isSuperAdmin = currentUser?.role === 'admin' || currentUser?.id === 'admin-001'
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
      <SuperAdminDashboardLayout
        currentUser={currentUser}
        jwtToken={jwtToken}
        onLogout={handleLogout}
      />
    )
  }

  return (
    <CustomerDashboardLayout
      currentUser={currentUser}
      jwtToken={jwtToken}
      onLogout={handleLogout}
    />
  )
}
