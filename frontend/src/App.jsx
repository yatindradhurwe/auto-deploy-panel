import React from 'react'
import { Eye, Megaphone, Wrench } from 'lucide-react'
import { stopImpersonation } from './components/admin/adminApi'
import SaaSAuthPages from './components/SaaSAuthPages'
import SuperAdminLogin from './components/SuperAdminLogin'
import CustomerDashboardLayout from './components/CustomerDashboardLayout'
import SuperAdminDashboardLayout from './components/SuperAdminDashboardLayout'
import { useAuth } from './store/AuthContext'
import { WorkspaceProvider } from './store'

/**
 * Routes between the two portals. Session state lives in the auth store (store/AuthContext).
 *  - /admin/login → super admin sign in;  /admin/* → super admin console
 *  - /login, /signup → organization sign in;  /app/* → organization server panel
 */
export default function App() {
  const { status, user: currentUser, isSuperAdmin, platformStatus, maintenanceMessage } = useAuth()
  const path = window.location.pathname

  if (status === 'verifying') {
    return (
      <div className="min-h-screen bg-[#07090E] flex flex-col items-center justify-center text-slate-100 font-sans">
        <div className="flex flex-col items-center gap-3">
          <div className="w-9 h-9 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-xs text-slate-400 font-mono tracking-wide">Verifying Session & Tenant Context...</p>
        </div>
      </div>
    )
  }

  if (status === 'maintenance') {
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

  if (status === 'anonymous' || !currentUser) {
    if (path.startsWith('/admin')) {
      if (path !== '/admin/login') window.history.replaceState(null, '', '/admin/login')
      return <SuperAdminLogin />
    }
    const view = path === '/signup' ? 'signup' : 'login'
    if (path !== `/${view}`) window.history.replaceState(null, '', `/${view}`)
    return <SaaSAuthPages initialView={view} />
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

  // Admins never see the console. Super admins open the console by default and can still use
  // the server panel under /app for the platform's own servers.
  const showConsole = isSuperAdmin && !path.startsWith('/app')
  if (!isSuperAdmin && !path.startsWith('/app')) window.history.replaceState(null, '', '/app/dashboard')
  if (showConsole && (!path.startsWith('/admin') || path === '/admin/login')) window.history.replaceState(null, '', '/admin/dashboard')

  return (
    <>
      {banners}
      {showConsole ? <SuperAdminDashboardLayout /> : (
        <WorkspaceProvider key={currentUser.id}>
          <CustomerDashboardLayout />
        </WorkspaceProvider>
      )}
    </>
  )
}
