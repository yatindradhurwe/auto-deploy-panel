import React, { useState, useEffect } from 'react'
import { Zap, RefreshCw, X, Check, Sparkles, Link2, CheckCircle2, Copy } from 'lucide-react'
import { useAuth } from '../store/AuthContext'
import { useServers } from '../store/ServersContext'

// No quotes, backslashes, backticks or $ (the server rejects them in database passwords)
function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  return Array.from(crypto.getRandomValues(new Uint8Array(20)), b => chars[b % chars.length]).join('')
}

const ident = (s, max) => String(s || '').toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '').slice(0, max)
const RESERVED_USERS = ['root', 'mysql', 'postgres', 'admin', 'debian-sys-maint']

const MODES = [
  { id: 'supabase', icon: '⚡', title: 'Supabase Stack', sub: 'Postgres + Auth + REST + Storage', stack: true, active: 'bg-emerald-500/15 border-emerald-500/60', check: 'text-emerald-400', subColor: 'text-emerald-300/80' },
  { id: 'existing', icon: '🔗', title: 'Link Existing Stack', sub: 'Use a Supabase stack on this server', stack: true, active: 'bg-teal-500/15 border-teal-500/60', check: 'text-teal-400', subColor: 'text-teal-300/80' },
  { id: 'postgresql', icon: '🐘', title: 'PostgreSQL', sub: 'Local database, port 5432', active: 'bg-cyan-500/15 border-cyan-500/60', check: 'text-cyan-400', subColor: 'text-cyan-300/80' },
  { id: 'mysql', icon: '🐬', title: 'MySQL', sub: 'Local database, port 3306', active: 'bg-amber-500/15 border-amber-500/60', check: 'text-amber-400', subColor: 'text-amber-300/80' }
]

export default function SelfHostDatabaseModal({ project, isOpen, onClose, onSuccess, canManageStacks = false }) {
  const { token: jwtToken } = useAuth()
  const { activeServer } = useServers()

  const [mode, setMode] = useState('postgresql')
  const [dbName, setDbName] = useState('')
  const [dbUser, setDbUser] = useState('')
  const [dbPassword, setDbPassword] = useState('')
  const [domain, setDomain] = useState('')
  const [existingApp, setExistingApp] = useState('')
  const [stacks, setStacks] = useState(null) // null = not loaded
  const [stacksError, setStacksError] = useState(null)
  const [restartPm2, setRestartPm2] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [showPassword, setShowPassword] = useState(false)
  const [copied, setCopied] = useState(false)

  const request = async (endpoint, body) => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwtToken}`,
        'X-Server-Id': activeServer?.id || ''
      },
      body: JSON.stringify({ serverId: activeServer?.id, ...body })
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.success === false) {
      throw new Error(data.error || (res.status === 504 ? 'The server is still working on it (the request timed out). Refresh in a few minutes to see the result.' : `Request failed (${res.status})`))
    }
    return data
  }

  useEffect(() => {
    if (!project) return
    const cleanName = ident(project.repoName || project.name || 'app', 63) || 'app'
    const user = ident(cleanName, 32)
    setDbName(cleanName)
    setDbUser(RESERVED_USERS.includes(user) ? `${user}_app` : user)
    setDbPassword(generatePassword())
    setDomain(project.domain || '')
    setMode(canManageStacks ? 'supabase' : 'postgresql')
    setExistingApp('')
    setStacks(null)
    setStacksError(null)
    setError(null)
    setResult(null)
    setLoading(false)
  }, [project, canManageStacks])

  // Supabase stacks on this server, for "Link Existing Stack"
  useEffect(() => {
    if (!isOpen || mode !== 'existing' || stacks !== null) return
    request('/api/studio/supabase/projects', {})
      .then((data) => {
        const list = data.supabaseStacks || []
        setStacks(list)
        if (list.length && !existingApp) setExistingApp(list[0].appName)
      })
      .catch((err) => { setStacks([]); setStacksError(err.message) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, mode, stacks])

  if (!isOpen || !project) return null

  const close = () => { if (!loading) onClose() }
  const needsDbFields = mode !== 'existing'

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (mode === 'existing' && !existingApp) return setError('Choose the Supabase stack to link.')
    if (mode === 'supabase' && !domain.trim()) return setError('Enter the domain the Supabase API will be served on.')
    setLoading(true)
    setError(null)
    try {
      const data = await request('/api/studio/projects/attach-database', {
        projectPath: project.path,
        appName: project.repoName || project.name,
        mode,
        dbName,
        dbUser,
        dbPassword,
        domain: mode === 'supabase' ? domain.trim() : '',
        existingApp: mode === 'existing' ? existingApp : '',
        restart: restartPm2
      })
      setResult(data)
      if (onSuccess) onSuccess(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const copy = (text) => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => {})
  }

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4 overflow-y-auto font-sans" onClick={close}>
      <div className="bg-slate-900 border border-white/15 rounded-3xl max-w-xl w-full p-6 space-y-5 shadow-2xl font-mono text-xs text-slate-100 my-8" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center space-x-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-emerald-500 via-teal-600 to-cyan-600 flex items-center justify-center font-bold text-slate-950 text-xl shadow-lg shadow-emerald-500/20 shrink-0">
              ⚡
            </div>
            <div className="min-w-0">
              <h3 className="font-black text-white text-base tracking-tight">Self-Host Database for Project</h3>
              <p className="text-[11px] text-emerald-400 font-mono truncate">
                Give <span className="text-white font-bold">{project.name}</span> a database on {activeServer?.name || 'this server'}
              </p>
            </div>
          </div>
          <button
            onClick={close}
            disabled={loading}
            aria-label="Close"
            className="p-1.5 hover:bg-white/10 rounded-xl text-slate-400 hover:text-white transition disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {result ? (
          <div className="space-y-4">
            <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl text-emerald-200 flex items-start gap-2.5">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              <div className="space-y-1">
                <p className="font-bold">{result.message}</p>
                {result.envFile && <p className="text-emerald-300/80">Updated {result.envFile} (previous copy in {result.envFile}.bak).</p>}
                {result.restarted?.length > 0 && <p className="text-emerald-300/80">Restarted {result.restarted.join(', ')}.</p>}
              </div>
            </div>
            {result.supabaseUrl && (
              <div className="space-y-2">
                {[['Supabase URL', result.supabaseUrl], ['Anon key', result.anonKey]].filter(([, v]) => v).map(([label, value]) => (
                  <div key={label} className="space-y-1">
                    <div className="text-slate-400 font-bold">{label}</div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 min-w-0 truncate p-2 bg-slate-950 border border-white/10 rounded-xl text-cyan-300">{value}</code>
                      <button type="button" onClick={() => copy(value)} className="p-2 bg-slate-800 hover:bg-slate-700 rounded-xl" title="Copy">
                        {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {result.notes?.length > 0 && (
              <ul className="list-disc pl-5 space-y-1 text-amber-200/90">
                {result.notes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            )}
            <div className="flex justify-end pt-3 border-t border-white/10">
              <button onClick={onClose} className="px-5 py-2 bg-slate-800 text-slate-200 rounded-xl font-bold hover:bg-slate-700 cursor-pointer transition">
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {MODES.filter(m => canManageStacks || !m.stack).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      disabled={loading}
                      onClick={() => { setMode(m.id); setError(null) }}
                      className={`p-3 rounded-2xl border text-left transition cursor-pointer flex flex-col justify-between space-y-2 ${
                        mode === m.id ? `${m.active} shadow-lg` : 'bg-slate-950/60 border-white/10 hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-base">{m.icon}</span>
                        {mode === m.id && <Check className={`w-4 h-4 ${m.check}`} />}
                      </div>
                      <div>
                        <div className="font-extrabold text-white text-xs">{m.title}</div>
                        <div className={`text-[10px] mt-0.5 ${m.subColor}`}>{m.sub}</div>
                      </div>
                    </button>
                  ))}
                </div>
                {!canManageStacks && (
                  <p className="text-[10px] text-slate-500">Supabase stacks are server-wide; an organization owner or admin can set one up.</p>
                )}
              </div>

              {mode === 'existing' && (
                <div className="space-y-1">
                  <label className="text-slate-300 font-bold">Supabase stack:</label>
                  {stacks === null ? (
                    <div className="p-2.5 text-slate-400 flex items-center gap-2"><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Loading stacks…</div>
                  ) : stacks.length === 0 ? (
                    <div className="p-2.5 text-slate-400">{stacksError || 'No self-hosted Supabase stacks on this server yet. Choose "Supabase Stack" to create one.'}</div>
                  ) : (
                    <select
                      value={existingApp}
                      onChange={(e) => setExistingApp(e.target.value)}
                      className="w-full p-2.5 bg-slate-950 border border-white/10 rounded-xl text-white focus:outline-none focus:border-emerald-500 font-mono"
                    >
                      {stacks.map((s) => (
                        <option key={s.appName} value={s.appName}>{s.appName} — {s.publicUrl}{s.status !== 'online' ? ` (${s.status})` : ''}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {needsDbFields && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <div className="space-y-1">
                      <label className="text-slate-300 font-bold">Database Name:</label>
                      <input
                        type="text"
                        required
                        maxLength={63}
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
                        maxLength={32}
                        value={dbUser}
                        onChange={(e) => setDbUser(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
                        className="w-full p-2.5 bg-slate-950 border border-white/10 rounded-xl text-white focus:outline-none focus:border-emerald-500 font-mono shadow-inner"
                      />
                    </div>
                  </div>

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
                        minLength={8}
                        value={dbPassword}
                        onChange={(e) => setDbPassword(e.target.value.replace(/['"\\`$\s]/g, ''))}
                        className="w-full p-2.5 pr-14 bg-slate-950 border border-white/10 rounded-xl text-white focus:outline-none focus:border-emerald-500 font-mono shadow-inner"
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
                </>
              )}

              {mode === 'supabase' && (
                <div className="space-y-1">
                  <label className="text-slate-300 font-bold">Supabase API Domain:</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. app.example.com or api.example.com"
                    value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                    className="w-full p-2.5 bg-slate-950 border border-white/10 rounded-xl text-white focus:outline-none focus:border-emerald-500 font-mono shadow-inner"
                  />
                  <p className="text-[10px] text-slate-500">
                    The app's own domain gets /auth/v1, /rest/v1 and /storage/v1 added to it. A new domain gets its own nginx site (point its DNS at this server).
                  </p>
                </div>
              )}

              <div className="flex items-center space-x-2 pt-2">
                <input
                  type="checkbox"
                  id="restart-pm2"
                  checked={restartPm2}
                  onChange={(e) => setRestartPm2(e.target.checked)}
                  className="rounded text-emerald-500 focus:ring-0 cursor-pointer"
                />
                <label htmlFor="restart-pm2" className="text-slate-300 font-bold cursor-pointer text-xs">
                  Write the credentials to <span className="text-cyan-300">{project.name}/.env</span> and restart its PM2 processes
                </label>
              </div>

              <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-[11px] text-emerald-300 font-mono space-y-1">
                <div className="font-bold flex items-center gap-1.5">
                  {mode === 'existing' ? <Link2 className="w-3.5 h-3.5 text-amber-300" /> : <Sparkles className="w-3.5 h-3.5 text-amber-300" />}
                  <span>{mode === 'existing' ? 'Link and wire up' : 'Self-hosting on this server'}</span>
                </div>
                <p className="text-emerald-300/80">
                  {mode === 'supabase'
                    ? 'Installs Auth, REST and Storage for this app (a few minutes the first time). The new database starts empty.'
                    : mode === 'existing'
                      ? 'Points the app\'s Supabase URL, keys and DATABASE_URL at the chosen stack.'
                      : <>The database runs on <span className="text-white font-bold">{activeServer?.ipAddress || 'this server'}</span> and the app connects over 127.0.0.1. It starts empty.</>}
                </p>
              </div>

              <div className="flex items-center justify-end space-x-3 pt-3 border-t border-white/10">
                <button
                  type="button"
                  onClick={close}
                  disabled={loading}
                  className="px-4 py-2 bg-slate-800 text-slate-300 rounded-xl font-bold hover:bg-slate-700 cursor-pointer transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading || (mode === 'existing' && !existingApp)}
                  className="px-5 py-2.5 bg-gradient-to-r from-emerald-500 via-teal-600 to-cyan-600 hover:from-emerald-400 hover:to-cyan-500 text-slate-950 font-black rounded-xl shadow-lg flex items-center space-x-2 cursor-pointer transition disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5 fill-current" />}
                  <span>{loading ? (mode === 'supabase' ? 'Installing Supabase…' : 'Provisioning…') : mode === 'existing' ? 'Link Stack' : 'Create & Attach Database'}</span>
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
