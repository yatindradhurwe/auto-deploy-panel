import React, { useState, useEffect } from 'react'
import { Zap, Database, RefreshCw, X, Check, Lock, Globe, Sparkles, ShieldCheck, Server } from 'lucide-react'
import { useAuth } from '../store/AuthContext'
import { useServers } from '../store/ServersContext'

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  return Array.from(crypto.getRandomValues(new Uint8Array(18)), b => chars[b % chars.length]).join('')
}

export default function SelfHostDatabaseModal({ project, isOpen, onClose, onSuccess }) {
  const { token: jwtToken } = useAuth()
  const { activeServer } = useServers()

  const [mode, setMode] = useState('supabase') // 'supabase' | 'postgresql' | 'mysql'
  const [dbName, setDbName] = useState('')
  const [dbUser, setDbUser] = useState('')
  const [dbPassword, setDbPassword] = useState('')
  const [domain, setDomain] = useState('')
  const [restartPm2, setRestartPm2] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    if (project) {
      const cleanName = (project.repoName || project.name || 'app').toLowerCase().replace(/[^a-z0-9_]/g, '_')
      setDbName(cleanName)
      setDbUser(cleanName)
      setDbPassword(generatePassword())
      setDomain(project.domain || '')
      setError(null)
    }
  }, [project])

  if (!isOpen || !project) return null

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/studio/projects/attach-database', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`,
          'X-Server-Id': activeServer?.id || ''
        },
        body: JSON.stringify({
          serverId: activeServer?.id,
          projectPath: project.path,
          appName: project.repoName || project.name,
          mode,
          dbName,
          dbUser,
          dbPassword,
          domain: mode === 'supabase' && domain ? domain : '',
          restart: restartPm2
        })
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.success === false) {
        throw new Error(data.error || 'Failed to attach self-hosted database')
      }

      if (onSuccess) onSuccess(data)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4 overflow-y-auto font-sans">
      <div className="bg-slate-900 border border-white/15 rounded-3xl max-w-xl w-full p-6 space-y-5 shadow-2xl font-mono text-xs text-slate-100 my-8">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-emerald-500 via-teal-600 to-cyan-600 flex items-center justify-center font-bold text-slate-950 text-xl shadow-lg shadow-emerald-500/20">
              ⚡
            </div>
            <div>
              <h3 className="font-black text-white text-base tracking-tight">Self-Host Database for Project</h3>
              <p className="text-[11px] text-emerald-400 font-mono">
                Connect dedicated local database / Supabase to <span className="text-white font-bold">{project.name}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/10 rounded-xl text-slate-400 hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="p-3.5 bg-rose-500/10 border border-rose-500/30 rounded-2xl text-rose-300 text-xs">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Mode Selector */}
          <div className="space-y-2">
            <label className="text-slate-300 font-bold block uppercase text-[10px] tracking-wider">
              Choose Database Architecture:
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              
              <button
                type="button"
                onClick={() => setMode('supabase')}
                className={`p-3 rounded-2xl border text-left transition cursor-pointer flex flex-col justify-between space-y-2 ${
                  mode === 'supabase'
                    ? 'bg-emerald-500/15 border-emerald-500/60 shadow-lg shadow-emerald-500/10'
                    : 'bg-slate-950/60 border-white/10 hover:border-white/20'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-base">⚡</span>
                  {mode === 'supabase' && <Check className="w-4 h-4 text-emerald-400" />}
                </div>
                <div>
                  <div className="font-extrabold text-white text-xs">Supabase Stack</div>
                  <div className="text-[10px] text-emerald-300/80 mt-0.5">Postgres + Auth + REST + Storage</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setMode('postgresql')}
                className={`p-3 rounded-2xl border text-left transition cursor-pointer flex flex-col justify-between space-y-2 ${
                  mode === 'postgresql'
                    ? 'bg-cyan-500/15 border-cyan-500/60 shadow-lg shadow-cyan-500/10'
                    : 'bg-slate-950/60 border-white/10 hover:border-white/20'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-base">🐘</span>
                  {mode === 'postgresql' && <Check className="w-4 h-4 text-cyan-400" />}
                </div>
                <div>
                  <div className="font-extrabold text-white text-xs">PostgreSQL 16</div>
                  <div className="text-[10px] text-cyan-300/80 mt-0.5">Direct local port 5432</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setMode('mysql')}
                className={`p-3 rounded-2xl border text-left transition cursor-pointer flex flex-col justify-between space-y-2 ${
                  mode === 'mysql'
                    ? 'bg-amber-500/15 border-amber-500/60 shadow-lg shadow-amber-500/10'
                    : 'bg-slate-950/60 border-white/10 hover:border-white/20'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-base">🐬</span>
                  {mode === 'mysql' && <Check className="w-4 h-4 text-amber-400" />}
                </div>
                <div>
                  <div className="font-extrabold text-white text-xs">MySQL 8.0</div>
                  <div className="text-[10px] text-amber-300/80 mt-0.5">Direct local port 3306</div>
                </div>
              </button>

            </div>
          </div>

          {/* Database Details */}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div className="space-y-1">
              <label className="text-slate-300 font-bold">Database Name:</label>
              <input
                type="text"
                required
                value={dbName}
                onChange={(e) => setDbName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
                className="w-full p-2.5 bg-slate-950 border border-white/10 rounded-xl text-white focus:outline-none focus:border-emerald-500 font-mono shadow-inner"
              />
            </div>

            <div className="space-y-1">
              <label className="text-slate-300 font-bold">Database User:</label>
              <input
                type="text"
                required
                value={dbUser}
                onChange={(e) => setDbUser(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
                className="w-full p-2.5 bg-slate-950 border border-white/10 rounded-xl text-white focus:outline-none focus:border-emerald-500 font-mono shadow-inner"
              />
            </div>
          </div>

          {/* Password with regenerate button */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-slate-300 font-bold">Database Password:</label>
              <button
                type="button"
                onClick={() => setDbPassword(generatePassword())}
                className="text-[11px] text-emerald-400 hover:text-emerald-300 font-mono flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Generate New</span>
              </button>
            </div>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={dbPassword}
                onChange={(e) => setDbPassword(e.target.value)}
                className="w-full p-2.5 pr-10 bg-slate-950 border border-white/10 rounded-xl text-white focus:outline-none focus:border-emerald-500 font-mono shadow-inner"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-2.5 text-slate-400 hover:text-white"
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          {/* Supabase Custom Domain (Optional) */}
          {mode === 'supabase' && (
            <div className="space-y-1">
              <label className="text-slate-300 font-bold">Project Gateway Domain (Optional):</label>
              <input
                type="text"
                placeholder="e.g. api.domain.com (defaults to server port 54100)"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                className="w-full p-2.5 bg-slate-950 border border-white/10 rounded-xl text-white focus:outline-none focus:border-emerald-500 font-mono shadow-inner"
              />
            </div>
          )}

          {/* Auto-restart PM2 */}
          <div className="flex items-center space-x-2 pt-2">
            <input
              type="checkbox"
              id="restart-pm2"
              checked={restartPm2}
              onChange={(e) => setRestartPm2(e.target.checked)}
              className="rounded text-emerald-500 focus:ring-0 cursor-pointer"
            />
            <label htmlFor="restart-pm2" className="text-slate-300 font-bold cursor-pointer text-xs">
              Automatically inject credentials into <span className="text-cyan-300">{project.name}/.env</span> and reload PM2
            </label>
          </div>

          {/* Info Banner */}
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-[11px] text-emerald-300 font-mono space-y-1">
            <div className="font-bold flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              <span>Instant Self-Hosting & Zero-Config Wiring</span>
            </div>
            <p className="text-emerald-300/80">
              The database will be hosted locally on <span className="text-white font-bold">{activeServer?.ipAddress || '127.0.0.1'}</span>. Your project will immediately gain fast, private, low-latency database access.
            </p>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end space-x-3 pt-3 border-t border-white/10">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 bg-slate-800 text-slate-300 rounded-xl font-bold hover:bg-slate-700 cursor-pointer transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2.5 bg-gradient-to-r from-emerald-500 via-teal-600 to-cyan-600 hover:from-emerald-400 hover:to-cyan-500 text-slate-950 font-black rounded-xl shadow-lg flex items-center space-x-2 cursor-pointer transition transform hover:scale-[1.02]"
            >
              <Zap className="w-3.5 h-3.5 fill-current" />
              <span>{loading ? 'Provisioning & Wiring...' : 'Deploy & Attach Database'}</span>
            </button>
          </div>
        </form>

      </div>
    </div>
  )
}
