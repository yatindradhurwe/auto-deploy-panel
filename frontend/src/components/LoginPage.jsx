import React, { useState } from 'react'
import { ShieldCheck, Lock, Mail, Eye, EyeOff, KeyRound, AlertCircle, ArrowRight, Server, Sparkles } from 'lucide-react'

export default function LoginPage({ onLoginSuccess }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleQuickFill = () => {
    setEmail('admin@tipcrm.com')
    setPassword('admin123')
    setError(null)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!email || !password) {
      setError('Please provide both email address and password.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Authentication failed. Invalid credentials.')
      }

      // Save token and user payload
      localStorage.setItem('autodeploy_jwt_token', data.token)
      localStorage.setItem('autodeploy_user', JSON.stringify(data.user))

      if (onLoginSuccess) {
        onLoginSuccess(data.user, data.token)
      }
    } catch (err) {
      console.error('Login Error:', err)
      setError(err.message || 'Server connection failed. Make sure backend is running.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#07090E] text-slate-100 flex flex-col justify-center items-center p-4 relative overflow-hidden font-sans select-none">
      {/* Background Decorative Ambient Glows */}
      <div className="absolute -top-40 -left-40 w-[500px] h-[500px] bg-cyan-500/15 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="absolute -bottom-40 -right-40 w-[500px] h-[500px] bg-purple-600/15 rounded-full blur-[120px] pointer-events-none"></div>

      <div className="w-full max-w-md relative z-10">
        {/* Console Logo & Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center p-3.5 bg-slate-900/80 border border-white/10 rounded-3xl shadow-2xl shadow-cyan-500/10 mb-4 group hover:border-cyan-500/50 transition-all ring-1 ring-white/10 backdrop-blur-xl">
            <Server className="w-10 h-10 text-cyan-400 group-hover:scale-110 transition-transform duration-300 drop-shadow" />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-white flex items-center justify-center gap-2">
            AutoDeploy Console
            <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-cyan-950/90 border border-cyan-800 text-cyan-300 font-mono font-bold tracking-wider">
              PRO STUDIO v2.0
            </span>
          </h1>
          <p className="text-slate-400 text-xs mt-1.5 font-mono">Sign in with your Admin credentials to enter the Studio</p>
        </div>

        {/* Login Form Card - Apple Translucent Glass Card */}
        <div className="bg-slate-900/60 backdrop-blur-2xl border border-white/10 rounded-3xl p-6 sm:p-8 shadow-2xl shadow-slate-950/80 relative ring-1 ring-white/5">
          
          {/* Preset Fill Banner */}
          <div className="mb-6 p-3.5 bg-cyan-950/60 border border-cyan-500/30 rounded-2xl flex items-center justify-between gap-3 text-xs shadow-inner">
            <div className="flex items-center gap-2 text-cyan-300">
              <Sparkles className="w-4 h-4 text-cyan-400 shrink-0 animate-pulse" />
              <span className="font-semibold text-[11px]">Default Admin Available</span>
            </div>
            <button
              type="button"
              onClick={handleQuickFill}
              className="px-3 py-1 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold text-[11px] rounded-xl transition-all cursor-pointer shadow-md shadow-cyan-950/40"
            >
              Quick Fill
            </button>
          </div>

          {error && (
            <div className="mb-5 p-4 bg-rose-950/80 border border-rose-800/80 rounded-2xl flex items-start gap-3 text-xs text-rose-300 animate-fadeIn shadow-inner">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div className="leading-relaxed font-mono">{error}</div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email Field */}
            <div>
              <label className="block text-[10px] font-mono font-bold text-slate-400 mb-1.5 uppercase tracking-widest">
                Admin Email Address
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Mail className="w-4 h-4 text-cyan-400" />
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@tipcrm.com"
                  required
                  className="w-full pl-10 pr-4 py-3 bg-slate-950/90 border border-white/10 rounded-2xl text-slate-100 placeholder-slate-500 text-xs focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/50 transition-all font-mono shadow-inner"
                />
              </div>
            </div>

            {/* Password Field */}
            <div>
              <label className="block text-[10px] font-mono font-bold text-slate-400 mb-1.5 uppercase tracking-widest">
                Admin Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Lock className="w-4 h-4 text-cyan-400" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  required
                  className="w-full pl-10 pr-10 py-3 bg-slate-950/90 border border-white/10 rounded-2xl text-slate-100 placeholder-slate-500 text-xs focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/50 transition-all font-mono shadow-inner"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-200 transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Credentials Note */}
            <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
                256-bit JWT Session
              </span>
              <span className="text-slate-500">admin@tipcrm.com / admin123</span>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 px-4 bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-extrabold rounded-2xl shadow-xl shadow-cyan-500/25 flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ring-1 ring-white/20"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  <span>Authenticating Admin...</span>
                </>
              ) : (
                <>
                  <span>Sign In to Studio Console</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        </div>

        {/* Footer info */}
        <div className="mt-8 text-center text-xs text-slate-500 font-mono">
          AutoDeploy Control Center &copy; 2026. Protected by JWT Auth.
        </div>
      </div>
    </div>
  )
}
