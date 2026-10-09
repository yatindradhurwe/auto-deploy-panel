import React, { useState } from 'react'
import { Crown, Mail, Lock, ShieldCheck, ArrowRight, Loader2 } from 'lucide-react'
import { useAuth } from '../store/AuthContext'

/**
 * Sign-in for platform staff (super admins) at /admin/login. Organization admins use /login.
 * There is no signup here: super admin accounts are created from the console.
 */
export default function SuperAdminLogin() {
  const { login, notice, clearNotice, platformStatus } = useAuth()
  const [form, setForm] = useState({ email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    clearNotice()
    try {
      await login('console', form.email, form.password)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const inputClass = 'w-full pl-10 pr-4 py-3 bg-slate-950 border border-purple-500/20 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:border-purple-400 transition'

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-purple-500/30">
      <header className="border-b border-purple-500/20 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-purple-600 via-indigo-600 to-amber-500 flex items-center justify-center shadow-lg shadow-purple-500/20">
            <Crown className="w-5 h-5 text-amber-300" />
          </div>
          <div>
            <div className="font-extrabold text-sm tracking-tight text-white">AutoDeploy</div>
            <div className="text-[10px] font-mono font-bold tracking-wider text-purple-300">SUPER ADMIN CONSOLE</div>
          </div>
        </div>
        <a href="/login" className="text-xs text-slate-400 hover:text-cyan-300 font-semibold">Organization login →</a>
      </header>

      {platformStatus?.maintenanceMode && (
        <div className="bg-amber-500/10 border-b border-amber-500/30 text-amber-100 px-6 py-2.5 text-xs text-center">
          <strong className="text-amber-300">Maintenance mode is on.</strong> Only super admins can sign in.
        </div>
      )}

      <main className="flex-1 flex items-center justify-center p-6 relative overflow-hidden">
        <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-1/4 left-1/4 w-96 h-96 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />

        <div className="w-full max-w-md bg-slate-900/80 border border-purple-500/30 rounded-2xl p-8 shadow-2xl backdrop-blur-xl relative z-10">
          <div className="text-center mb-8">
            <div className="w-12 h-12 rounded-2xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center mx-auto mb-4">
              <ShieldCheck className="w-6 h-6 text-purple-300" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">Super admin sign in</h1>
            <p className="text-sm text-slate-400">Manage organizations, users, plans and platform settings</p>
          </div>

          {notice && !error && (
            <div className="mb-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-sm">{notice}</div>
          )}
          {error && (
            <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">{error}</div>
          )}

          <form onSubmit={submit} className="space-y-5">
            <label className="block">
              <span className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Email address</span>
              <span className="relative block">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input type="email" required autoComplete="username" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputClass} placeholder="you@company.com" />
              </span>
            </label>
            <label className="block">
              <span className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Password</span>
              <span className="relative block">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input type="password" required autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={inputClass} placeholder="••••••••" />
              </span>
            </label>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold rounded-xl shadow-lg shadow-purple-500/25 flex items-center justify-center gap-2 disabled:opacity-60 cursor-pointer"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowRight className="w-5 h-5" />}
              <span>{loading ? 'Signing in…' : 'Sign in to console'}</span>
            </button>
          </form>

          <p className="text-[11px] text-slate-500 text-center mt-6">
            Restricted to platform staff. Sign-ins are rate limited and recorded in the audit trail.
          </p>
        </div>
      </main>
    </div>
  )
}
