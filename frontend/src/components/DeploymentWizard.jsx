import React, { useState, useEffect, useRef, useMemo } from 'react'
import {
  Github, Upload, Server, Database, Rocket, Check, X, RefreshCw, ChevronRight, ChevronDown, ArrowLeft,
  AlertTriangle, FileArchive, Globe, Lock, Search, Copy, ExternalLink, Sparkles, Settings2, Box, Loader2, KeyRound, Triangle, Zap
} from 'lucide-react'
import { useAuth } from '../store/AuthContext'
import { useServers } from '../store/ServersContext'
import { signInWithGithub } from '../utils/githubSignIn'
import { VercelImport, SupabaseImport } from './CloudImport'

/**
 * 1-click deployment: GitHub repo, uploaded archive or a Vercel project (+ optional database: new,
 * uploaded, or migrated from Supabase / another PostgreSQL together with Supabase Storage files and,
 * for Supabase apps, Auth, REST, Storage and Edge Functions run on the server) → live site.
 */

const TYPE_OPTIONS = [
  ['auto', 'Auto-detect'], ['static', 'Static website'], ['spa', 'Single-page app (React/Vue/Vite…)'], ['node-ssr', 'Node SSR (Next.js, Nuxt…)'],
  ['node-server', 'Node.js server (Express, NestJS…)'], ['fullstack', 'Frontend + Node API'], ['php', 'PHP / Laravel / WordPress'],
  ['python', 'Python (Django, Flask, FastAPI)'], ['go', 'Go'], ['java', 'Java (Spring Boot)'], ['ruby', 'Ruby / Rails']
]
const ENGINES = [['postgresql', 'PostgreSQL'], ['mysql', 'MySQL / MariaDB'], ['mongodb', 'MongoDB'], ['sqlite', 'SQLite']]
const STEPS = [['source', 'Source'], ['app', 'App'], ['database', 'Database'], ['launch', 'Launch']]

const formatBytes = (b) => (b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`)
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50)

function formatRemaining(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return null
  if (sec < 45) return 'Less than a minute remaining'
  const m = Math.round(sec / 60)
  return m <= 1 ? 'About a minute remaining' : `About ${m} minutes remaining`
}

function Dropzone({ accept, hint, onFile, disabled }) {
  const [over, setOver] = useState(false)
  const input = useRef(null)
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled && e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]) }}
      onClick={() => !disabled && input.current?.click()}
      className={`rounded-3xl border-2 border-dashed p-10 text-center transition cursor-pointer ${over ? 'border-cyan-400 bg-cyan-500/10' : 'border-white/15 hover:border-white/30 bg-white/[0.02]'} ${disabled ? 'opacity-50 cursor-default' : ''}`}
    >
      <input ref={input} type="file" accept={accept} className="hidden" onChange={(e) => e.target.files[0] && onFile(e.target.files[0])} />
      <Upload className="w-8 h-8 mx-auto text-slate-400" />
      <div className="mt-3 text-sm font-semibold text-white">Drop a file here, or click to choose</div>
      <div className="mt-1 text-xs text-slate-500">{hint}</div>
    </div>
  )
}

export default function DeploymentWizard({ apiBaseUrl = '', onDeploymentSuccess, onBackToHub, initialTemplate }) {
  const { token: jwtToken } = useAuth()
  const { activeServer } = useServers()
  const token = () => jwtToken
  const api = async (url, { method = 'GET', body } = {}) => {
    const res = await fetch(`${apiBaseUrl}/api/deploy${url}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token()}`, 'X-Server-Id': activeServer?.id || '' },
      body: body ? JSON.stringify(body) : undefined
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.success === false) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { data })
    return data
  }

  const [step, setStep] = useState('source')
  const [error, setError] = useState(null)

  // --- source
  const [sourceType, setSourceType] = useState('github')
  const [githubToken, setGithubToken] = useState('')
  const [hasToken, setHasToken] = useState(false)
  const [ghAccount, setGhAccount] = useState(null) // { connected, login, avatarUrl, authType, oauthAvailable }
  const [ghBusy, setGhBusy] = useState('')
  const [repos, setRepos] = useState([])
  const [repoQuery, setRepoQuery] = useState('')
  const [loadingRepos, setLoadingRepos] = useState(false)
  const [gitUrl, setGitUrl] = useState('')
  const [branch, setBranch] = useState('main')
  const [branches, setBranches] = useState([])
  const [loadingBranches, setLoadingBranches] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [upload, setUpload] = useState(null) // { name, size, progress, uploadId, status }
  const [analysis, setAnalysis] = useState(null)
  const [vercelImport, setVercelImport] = useState(null) // project details imported from Vercel
  const pendingOverrides = useRef(null) // build settings to apply once the imported repo is analyzed

  // --- app config
  const [appName, setAppName] = useState('')
  const [domain, setDomain] = useState('')
  const [envVars, setEnvVars] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [overrides, setOverrides] = useState({ type: 'auto', buildCommand: '', startCommand: '', outputDir: '', appDir: '' })
  const [port, setPort] = useState('')

  // --- database
  const [dbMode, setDbMode] = useState('none')
  const [dbEngine, setDbEngine] = useState('postgresql')
  const [dbUpload, setDbUpload] = useState(null)
  const [dbAdmin, setDbAdmin] = useState({ user: '', password: '' })
  const [dbCreds, setDbCreds] = useState({ name: '', user: '', password: '' })
  const [migrate, setMigrate] = useState({
    sourceUrl: '', includeAuth: true, storageUrl: '', storageKey: '',
    // Run Supabase Auth / REST / Storage / Edge Functions for the app on the server
    runSupabase: true, supabaseRef: '', jwtSecret: '', keys: null, auth: null, noVerifyJwt: [], functionSecrets: '', secretNames: []
  })
  const [migrateCheck, setMigrateCheck] = useState(null) // { busy } | { result } | { error }
  const setMigrateField = (k, v) => { setMigrate(m => ({ ...m, [k]: v })); setMigrateCheck(null) }

  // --- server / launch
  const [ssl, setSsl] = useState(true)
  const [sslEmail, setSslEmail] = useState('')
  const [replaceDomain, setReplaceDomain] = useState(false)

  // Domain: a subdomain of a domain in the connected DNS account (record added automatically), or your own
  const [dnsConn, setDnsConn] = useState(null) // { connected, provider, label, zones, providers }
  const [domainMode, setDomainMode] = useState('custom') // 'managed' | 'custom'
  const [zone, setZone] = useState('')
  const [sub, setSub] = useState('')
  const [subTouched, setSubTouched] = useState(false)
  const [dnsCheck, setDnsCheck] = useState(null) // { busy } | { result } | { error }
  const [dnsForm, setDnsForm] = useState({ open: false, provider: 'hostinger', token: '', busy: false })

  // --- progress
  const [deployId, setDeployId] = useState(null)
  const [stages, setStages] = useState([])
  const [events, setEvents] = useState([])
  const [showLog, setShowLog] = useState(false)
  const [startedAt, setStartedAt] = useState(null)
  const [now, setNow] = useState(Date.now())
  const logRef = useRef(null)


  // Marketplace template: its source, stack analysis and defaults come from the template
  const [template, setTemplate] = useState(null)
  useEffect(() => {
    if (!initialTemplate) return
    const t = initialTemplate
    const d = t.defaults || {}
    setTemplate(t)
    setSourceType('template')
    setAnalysis(t.analysis || { framework: t.name, label: 'Marketplace template', fileCount: '—', type: d.type || 'auto' })
    setAppName(slug(t.name))
    setOverrides({ type: d.type || 'auto', buildCommand: d.buildCommand || '', startCommand: d.startCommand || '', outputDir: d.outputDir || '', appDir: d.appDir || '' })
    if (d.port) setPort(String(d.port))
    if (d.envVars) setEnvVars(d.envVars)
    if (d.database && d.database !== 'none') { setDbMode('create'); setDbEngine(d.database) }
  }, [initialTemplate])

  // GitHub account + repos: "Sign in with GitHub", or a personal access token for developers
  const loadRepos = async () => {
    setLoadingRepos(true)
    try {
      const data = await api('/github-repos', { method: 'POST', body: {} })
      setRepos(Array.from(new Map((data.repos || []).map(r => [r.full_name, r])).values()))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoadingRepos(false)
    }
  }
  const loadGithubAccount = async () => {
    try {
      const d = await api('/github-account')
      setGhAccount(d)
      setHasToken(!!d.connected)
      if (d.error) setError(d.error)
      if (d.connected) loadRepos()
      else setRepos([])
    } catch {
      setGhAccount({ connected: false })
    }
  }
  useEffect(() => { loadGithubAccount() }, [])

  const applyDnsConnection = (c) => {
    setDnsConn(c)
    if (c?.connected && c.zones?.length) {
      setDomainMode('managed')
      setZone(z => (c.zones.includes(z) ? z : c.zones[0]))
    } else {
      setDomainMode('custom')
    }
  }
  useEffect(() => { api('/dns').then(d => applyDnsConnection(d.connection)).catch(() => setDnsConn(null)) }, [])

  const connectDns = async () => {
    setError(null)
    setDnsForm(f => ({ ...f, busy: true }))
    try {
      const d = await api('/dns/connect', { method: 'POST', body: { provider: dnsForm.provider, token: dnsForm.token.trim() } })
      applyDnsConnection(d.connection)
      setDnsForm(f => ({ ...f, open: false, token: '', busy: false }))
    } catch (e) {
      setError(e.message)
      setDnsForm(f => ({ ...f, busy: false }))
    }
  }
  const refreshDnsZones = async () => {
    try { applyDnsConnection((await api('/dns/refresh', { method: 'POST', body: {} })).connection) } catch (e) { setError(e.message) }
  }

  // The subdomain follows the app name until it is edited
  useEffect(() => { if (!subTouched) setSub(appName) }, [appName, subTouched])
  useEffect(() => {
    if (domainMode === 'managed' && zone) setDomain(sub ? `${sub}.${zone}` : zone)
  }, [domainMode, zone, sub])

  // Is the chosen (sub)domain free, already this server, or used by another site?
  useEffect(() => {
    if (domainMode !== 'managed' || !zone || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) { setDnsCheck(null); return }
    setDnsCheck({ busy: true })
    let live = true
    const t = setTimeout(async () => {
      try {
        const d = await api('/dns/check', { method: 'POST', body: { domain } })
        if (live) setDnsCheck({ result: d.check })
      } catch (e) {
        if (live) setDnsCheck({ error: e.message })
      }
    }, 500)
    return () => { live = false; clearTimeout(t) }
  }, [domainMode, zone, domain])

  const githubSignIn = async () => {
    setError(null)
    setGhBusy('oauth')
    try {
      await signInWithGithub(async () => (await api('/github-oauth/start')).url)
      await loadGithubAccount()
    } catch (e) {
      setError(e.message)
    } finally {
      setGhBusy('')
    }
  }

  const saveToken = async () => {
    if (!githubToken.trim()) return
    setError(null)
    setGhBusy('token')
    try {
      await api('/save-github-token', { method: 'POST', body: { githubToken: githubToken.trim() } })
      setGithubToken('')
      await loadGithubAccount()
    } catch (e) {
      setError(e.message)
    } finally {
      setGhBusy('')
    }
  }

  const disconnectGithub = async () => {
    if (!window.confirm('Disconnect your GitHub account? Projects already deployed keep working, but private repositories can no longer be pulled until you connect again.')) return
    try {
      await api('/github-disconnect', { method: 'POST', body: {} })
      await loadGithubAccount()
    } catch (e) {
      setError(e.message)
    }
  }

  const applyAnalysis = (a, nameHint) => {
    setAnalysis(a)
    setOverrides({ type: 'auto', buildCommand: '', startCommand: '', outputDir: '', appDir: '', ...(pendingOverrides.current || {}) })
    if (pendingOverrides.current && Object.values(pendingOverrides.current).some(Boolean)) setShowAdvanced(true)
    pendingOverrides.current = null
    const name = appName || slug(nameHint)
    setAppName(name)
    if (!domain && name) setDomain('')
    if (a.database?.engines?.length) { setDbEngine(a.database.engines[0]) }
  }

  const analyzeGit = async (url = gitUrl, br = branch, nameHint) => {
    setError(null)
    setAnalyzing(true)
    setAnalysis(null)
    try {
      const data = await api('/analyze-git', { method: 'POST', body: { gitUrl: url, branch: br } })
      setBranch(data.branch)
      applyAnalysis(data.analysis, nameHint || url.split('/').pop().replace(/\.git$/, ''))
      if (data.requestedBranchMissing) setError(`Branch "${br}" was not found — using "${data.branch}".`)
    } catch (e) {
      setError(e.message)
    } finally {
      setAnalyzing(false)
    }
  }

  const loadBranches = async (url = gitUrl) => {
    setBranches([])
    if (!url) return
    setLoadingBranches(true)
    try {
      const data = await api('/git-branches', { method: 'POST', body: { gitUrl: url } })
      setBranches(data.branches || [])
    } catch { /* branch list is optional; the text field still works */ } finally {
      setLoadingBranches(false)
    }
  }

  const pickRepo = (r) => {
    setGitUrl(r.clone_url)
    setBranch(r.default_branch || 'main')
    loadBranches(r.clone_url)
    analyzeGit(r.clone_url, r.default_branch || 'main', r.name)
  }

  const pickBranch = (b) => {
    setBranch(b)
    // A non-default branch is usually a separate site: give it its own app name (folder, PM2 process)
    const repo = slug(gitUrl.split('/').pop().replace(/\.git$/, ''))
    if (!appName || appName === repo || appName.startsWith(`${repo}-`)) setAppName(b === branches[0] ? repo : slug(`${repo}-${b}`))
    analyzeGit(gitUrl, b)
  }

  /** A Vercel project: its repository is analyzed like a GitHub pick; env, domain and build settings are filled in. */
  const importFromVercel = (p) => {
    setError(null)
    setVercelImport(p)
    if (p.envText) setEnvVars(prev => (prev.trim() ? `${prev.trim()}\n${p.envText}` : p.envText))
    if (p.domains?.[0]) { setDomainMode('custom'); setDomain(p.domains[0]) }
    if (!appName) setAppName(slug(p.name))
    if (p.supabaseRef) {
      setDbMode('migrate')
      setMigrate(m => ({ ...m, supabaseRef: p.supabaseRef, storageUrl: m.storageUrl || `https://${p.supabaseRef}.supabase.co` }))
    }
    if (p.gitUrl) {
      pendingOverrides.current = p.overrides
      setGitUrl(p.gitUrl)
      setBranch(p.branch)
      loadBranches(p.gitUrl)
      analyzeGit(p.gitUrl, p.branch, p.name)
    }
  }

  /** A Supabase project from the user's account: everything the migration needs except the database password. */
  const importFromSupabase = (d, password) => {
    setMigrate(m => ({
      ...m,
      sourceUrl: d.poolerTemplate.replace('{password}', encodeURIComponent(password)),
      storageUrl: d.storageKey ? d.url : m.storageUrl,
      storageKey: d.storageKey || m.storageKey,
      includeAuth: true,
      runSupabase: true,
      supabaseRef: d.ref,
      jwtSecret: d.jwtSecret || m.jwtSecret,
      keys: d.keys?.anon && d.keys?.service_role ? d.keys : null,
      auth: d.auth,
      noVerifyJwt: d.functions.filter(f => !f.verifyJwt).map(f => f.slug),
      secretNames: d.secretNames,
      // Supabase returns only digests of the functions' secrets: list the names for the user to fill in
      functionSecrets: m.functionSecrets.trim() ? m.functionSecrets : d.secretNames.map(n => `${n}=`).join('\n')
    }))
    setMigrateCheck(null)
  }

  /** Chunked upload with real byte progress. */
  const uploadFile = async (file, kind, setState) => {
    setError(null)
    setState({ name: file.name, size: file.size, progress: 0, status: 'uploading' })
    try {
      const init = await api('/uploads', { method: 'POST', body: { kind, name: file.name, size: file.size } })
      // Sends one chunk; resolves to the offset the server now expects
      const sendChunk = (offset, chunk) => new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', `${apiBaseUrl}/api/deploy/uploads/${init.uploadId}/chunk?offset=${offset}`)
        xhr.setRequestHeader('Authorization', `Bearer ${token()}`)
        xhr.setRequestHeader('Content-Type', 'application/octet-stream')
        if (activeServer?.id) xhr.setRequestHeader('X-Server-Id', activeServer.id)
        xhr.upload.onprogress = (e) => setState(s => ({ ...s, progress: (offset + e.loaded) / file.size }))
        xhr.onload = () => {
          let data = {}
          try { data = JSON.parse(xhr.responseText) } catch { /* ignore */ }
          if (xhr.status === 409 && Number.isFinite(data.expectedOffset)) return resolve(data.expectedOffset)
          if (xhr.status >= 400) return reject(Object.assign(new Error(data.error || `Upload failed (${xhr.status})`), { fatal: true }))
          resolve(data.received)
        }
        xhr.onerror = () => reject(new Error('Network error while uploading'))
        xhr.send(chunk)
      })
      let offset = 0
      let failures = 0
      while (offset < file.size) {
        try {
          offset = await sendChunk(offset, file.slice(offset, offset + init.chunkSize))
          failures = 0
        } catch (err) {
          // Network hiccup: wait and resend from the last confirmed offset
          if (err.fatal || ++failures > 4) throw err
          await new Promise(r => setTimeout(r, 1500 * failures))
        }
      }
      setState(s => ({ ...s, progress: 1, status: 'processing' }))
      const done = await api(`/uploads/${init.uploadId}/complete`, { method: 'POST', body: {} })
      setState(s => ({ ...s, status: 'ready', uploadId: init.uploadId, result: done }))
      return done
    } catch (e) {
      setState(s => ({ ...s, status: 'error' }))
      setError(e.message)
      return null
    }
  }

  const onSourceFile = async (file) => {
    setAnalysis(null)
    const done = await uploadFile(file, 'source', setUpload)
    if (done) applyAnalysis(done.analysis, file.name.replace(/\.(zip|tar\.gz|tgz|tar)$/i, ''))
  }

  const onDbFile = async (file) => {
    const done = await uploadFile(file, 'database', setDbUpload)
    if (done?.engine) setDbEngine(done.engine)
  }

  const migrateStorage = () => (migrate.storageUrl.trim() || migrate.storageKey.trim() ? { url: migrate.storageUrl.trim(), key: migrate.storageKey.trim() } : undefined)
  const supabaseSource = !!migrate.supabaseRef || /supabase\.(co|com)\b/i.test(migrate.sourceUrl)
  const runsSupabase = dbMode === 'migrate' && supabaseSource && migrate.runSupabase

  const checkMigration = async () => {
    setMigrateCheck({ busy: true })
    try {
      const data = await api('/migration-check', { method: 'POST', body: { sourceUrl: migrate.sourceUrl.trim(), includeAuth: migrate.includeAuth, includeStorage: runsSupabase, storage: migrateStorage() } })
      setMigrateCheck({ result: data })
    } catch (e) {
      setMigrateCheck({ error: e.message })
    }
  }

  // ------------------------------------------------------------------ deploy
  const startDeploy = async () => {
    setError(null)
    const body = {
      appName,
      domain,
      envVars,
      port: port ? Number(port) : undefined,
      source: sourceType === 'template' ? { type: 'template', templateId: template?.id } : sourceType === 'github' || sourceType === 'vercel' ? { type: 'github', gitUrl, branch } : { type: 'upload', uploadId: upload?.uploadId },
      overrides: { ...overrides, type: overrides.type },
      database: dbMode === 'none' ? { mode: 'none' } : dbMode === 'migrate' ? {
        mode: 'migrate', sourceUrl: migrate.sourceUrl.trim(), includeAuth: migrate.includeAuth, storage: migrateStorage(),
        name: dbCreds.name.trim(), user: dbCreds.user.trim(), password: dbCreds.password,
        supabase: runsSupabase ? {
          enabled: true, ref: migrate.supabaseRef || undefined, jwtSecret: migrate.jwtSecret.trim() || undefined, keys: migrate.keys || undefined,
          auth: migrate.auth || undefined, noVerifyJwt: migrate.noVerifyJwt, functionSecrets: migrate.functionSecrets
        } : undefined
      } : {
        mode: dbMode, engine: dbEngine, uploadId: dbUpload?.uploadId,
        ...(dbEngine === 'mysql' && dbAdmin.user ? { adminUser: dbAdmin.user, adminPassword: dbAdmin.password } : {}),
        ...(['mysql', 'postgresql'].includes(dbEngine) ? { name: dbCreds.name.trim(), user: dbCreds.user.trim(), password: dbCreds.password } : {})
      },
      ssl, sslEmail, replaceDomain,
      autoDns: domainMode === 'managed'
    }
    try {
      const data = await api('/deploy', { method: 'POST', body })
      setStages(data.stages.map(s => ({ ...s, status: 'pending' })))
      setEvents([])
      setDeployId(data.deployId)
      setStartedAt(Date.now())
      setShowLog(false)
      setStep('progress')
    } catch (e) {
      setError(e.message)
    }
  }

  useEffect(() => {
    if (!deployId) return
    const es = new EventSource(`${apiBaseUrl}/api/deploy/stream/${deployId}?token=${encodeURIComponent(token())}`)
    let opened = false
    es.onopen = () => { if (opened) setEvents([]); opened = true } // the server replays everything on reconnect
    es.onmessage = (m) => {
      try {
        const ev = JSON.parse(m.data)
        setEvents(list => [...list, ev])
        if (ev.kind === 'result') {
          es.close()
          if (ev.status === 'success') onDeploymentSuccess?.()
        }
      } catch { /* ignore */ }
    }
    return () => es.close()
  }, [deployId])

  useEffect(() => {
    if (step !== 'progress') return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [step])

  const view = useMemo(() => {
    const st = Object.fromEntries(stages.map(s => [s.id, { ...s }]))
    let percent = 0
    let currentId = null
    let result = null
    const logs = []
    for (const ev of events) {
      if (ev.kind === 'stage' && st[ev.id]) {
        st[ev.id].status = ev.status
        st[ev.id].detail = ev.detail
        if (ev.status === 'running') currentId = ev.id
      } else if (ev.kind === 'progress') percent = ev.percent
      else if (ev.kind === 'log') logs.push(ev)
      else if (ev.kind === 'result') result = ev
    }
    return { stages: stages.map(s => st[s.id]), percent, current: currentId ? st[currentId] : null, logs, result }
  }, [events, stages])

  useEffect(() => {
    if (showLog && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [view.logs.length, showLog])

  useEffect(() => { if (view.result?.status === 'failed') setShowLog(true) }, [view.result?.status])

  // ------------------------------------------------------------------ render helpers
  const card = 'bg-slate-900/70 backdrop-blur-2xl border border-white/10 rounded-3xl shadow-2xl shadow-black/40'
  const input = 'w-full bg-slate-950 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-cyan-500/60'
  const primary = 'px-5 py-2.5 rounded-full bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-sm flex items-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-default'
  const ghost = 'px-4 py-2.5 rounded-full bg-white/5 hover:bg-white/10 text-slate-200 text-sm flex items-center gap-2 cursor-pointer'

  const sourceReady = !!analysis && (sourceType === 'template' ? !!template : sourceType === 'github' || sourceType === 'vercel' ? !!gitUrl : upload?.status === 'ready')
  const dnsBlocked = domainMode === 'managed' && (!!dnsCheck?.busy || (dnsCheck?.result?.status === 'taken' && !replaceDomain))
  const appReady = /^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/.test(appName) && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain) && !dnsBlocked
  const dbReady = dbMode === 'import' ? dbUpload?.status === 'ready' : dbMode === 'migrate' ? /^postgres(ql)?:\/\/./i.test(migrate.sourceUrl.trim()) && !!migrate.storageUrl.trim() === !!migrate.storageKey.trim() : true
  const filteredRepos = repos.filter(r => r.full_name.toLowerCase().includes(repoQuery.toLowerCase())).slice(0, 50)

  const ProgressBar = ({ value }) => (
    <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
      <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-all duration-500" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  )

  const AnalysisCard = () => analysis && (
    <div className="mt-5 p-5 rounded-2xl bg-white/[0.03] border border-white/10">
      <div className="flex items-center gap-3">
        <div className={`p-2.5 rounded-xl ${analysis.type === 'unknown' ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/15 text-emerald-300'}`}>
          {analysis.type === 'unknown' ? <AlertTriangle className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
        </div>
        <div>
          <div className="text-white font-bold">{analysis.framework}</div>
          <div className="text-xs text-slate-400">{analysis.label} · {analysis.fileCount} files{analysis.database?.engines?.length ? ` · uses ${analysis.database.engines.join(', ')}` : ''}</div>
        </div>
      </div>
      {analysis.evidence?.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-slate-400">
          {analysis.evidence.slice(0, 6).map((e, i) => <li key={i} className="flex gap-2"><Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />{e}</li>)}
        </ul>
      )}
      {analysis.warnings?.map((w, i) => <div key={i} className="mt-3 text-xs text-amber-300 flex gap-2"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{w}</div>)}
    </div>
  )

  // ------------------------------------------------------------------ progress screen
  if (step === 'progress') {
    const r = view.result
    const elapsed = startedAt ? (now - startedAt) / 1000 : 0
    const remaining = !r && view.percent >= 8 && elapsed > 15 ? (elapsed / view.percent) * (100 - view.percent) : null
    return (
      <div className="max-w-2xl mx-auto py-6 space-y-6 font-sans">
        <div className={`${card} p-8 sm:p-10 text-center`}>
          <div className={`mx-auto w-20 h-20 rounded-[1.4rem] flex items-center justify-center shadow-xl ${r?.status === 'success' ? 'bg-gradient-to-br from-emerald-400 to-green-600' : r?.status === 'failed' ? 'bg-gradient-to-br from-rose-400 to-red-600' : 'bg-gradient-to-br from-cyan-400 to-blue-600'}`}>
            {r?.status === 'success' ? <Check className="w-10 h-10 text-onaccent" strokeWidth={3} /> : r?.status === 'failed' ? <X className="w-10 h-10 text-onaccent" strokeWidth={3} /> : <Box className="w-9 h-9 text-onaccent" />}
          </div>
          <h2 className="mt-5 text-xl font-semibold text-white">
            {r?.status === 'success' ? `${appName} is live` : r?.status === 'failed' ? 'Deployment failed' : `Deploying ${appName}`}
          </h2>
          <div className="mt-1 text-sm text-slate-400 min-h-[1.25rem]">
            {r?.status === 'success' ? r.summary?.framework : r?.status === 'failed' ? `During: ${view.stages.find(s => s.id === r.stage)?.label || r.stage}` : (view.current ? `${view.current.label}${view.current.detail ? ` — ${view.current.detail}` : '…'}` : 'Preparing…')}
          </div>

          {!r && (
            <div className="mt-6 space-y-2">
              <ProgressBar value={view.percent / 100} />
              <div className="flex justify-between text-xs text-slate-500">
                <span>{formatRemaining(remaining) || 'Estimating time…'}</span>
                <span className="tabular-nums text-slate-300 font-semibold">{view.percent}%</span>
              </div>
            </div>
          )}

          {r?.status === 'success' && (
            <div className="mt-6 space-y-4">
              <a href={r.url} target="_blank" rel="noreferrer" className={`${primary} mx-auto w-fit`}>Open {r.url.replace(/^https?:\/\//, '')} <ExternalLink className="w-4 h-4" /></a>
              {r.summary?.database && (
                <div className="text-left p-4 rounded-2xl bg-white/[0.03] border border-white/10 text-xs space-y-1.5">
                  <div className="text-white font-semibold flex items-center gap-2"><Database className="w-4 h-4 text-cyan-400" /> Database credentials (also saved in the app's .env)</div>
                  {[['Engine', r.summary.database.engine], ['Database', r.summary.database.name], ['User', r.summary.database.user], ['Password', r.summary.database.password], ['Connection URL', r.summary.database.url]].filter(([, v]) => v).map(([k, v]) => (
                    <div key={k} className="flex items-center gap-2"><span className="text-slate-500 w-28 shrink-0">{k}</span><code className="text-slate-200 truncate flex-1">{v}</code>
                      <button onClick={() => navigator.clipboard?.writeText(v)} className="text-slate-500 hover:text-white cursor-pointer"><Copy className="w-3.5 h-3.5" /></button></div>
                  ))}
                </div>
              )}
              {r.summary?.admin && (
                <div className="text-left p-4 rounded-2xl bg-white/[0.03] border border-white/10 text-xs space-y-1.5">
                  <div className="text-white font-semibold flex items-center gap-2"><KeyRound className="w-4 h-4 text-cyan-400" /> App admin login (created by the app's seed script, saved in .env)</div>
                  {[['URL', r.summary.admin.url], ['Email', r.summary.admin.email], ['Password', r.summary.admin.password]].filter(([, v]) => v).map(([k, v]) => (
                    <div key={k} className="flex items-center gap-2"><span className="text-slate-500 w-28 shrink-0">{k}</span><code className="text-slate-200 truncate flex-1">{v}</code>
                      <button onClick={() => navigator.clipboard?.writeText(v)} className="text-slate-500 hover:text-white cursor-pointer"><Copy className="w-3.5 h-3.5" /></button></div>
                  ))}
                </div>
              )}
              {r.summary?.storage && (
                <div className="text-left p-4 rounded-2xl bg-white/[0.03] border border-white/10 text-xs space-y-1.5">
                  <div className="text-white font-semibold flex items-center gap-2"><FileArchive className="w-4 h-4 text-cyan-400" /> Storage — {r.summary.storage.files} file(s) copied (STORAGE_DIR and STORAGE_PUBLIC_URL are in .env)</div>
                  {[['Folder', r.summary.storage.directory], ['Public URL', r.summary.storage.publicUrl], ['Replaces', r.summary.storage.supabaseUrl]].map(([k, v]) => (
                    <div key={k} className="flex items-center gap-2"><span className="text-slate-500 w-28 shrink-0">{k}</span><code className="text-slate-200 truncate flex-1">{v}</code>
                      <button onClick={() => navigator.clipboard?.writeText(v)} className="text-slate-500 hover:text-white cursor-pointer"><Copy className="w-3.5 h-3.5" /></button></div>
                  ))}
                  <div className="text-slate-500">Buckets: {r.summary.storage.buckets.map(b => `${b.name} (${b.public ? 'public' : 'private'}, ${b.files})`).join(' · ') || 'none'}</div>
                </div>
              )}
              {r.summary?.supabase && (
                <div className="text-left p-4 rounded-2xl bg-white/[0.03] border border-white/10 text-xs space-y-1.5">
                  <div className="text-white font-semibold flex items-center gap-2"><Zap className="w-4 h-4 text-cyan-400" /> Supabase now runs on this server{r.summary.supabase.keysChanged ? ' (new keys, already in .env and the built app)' : ''}</div>
                  {[['Supabase URL', r.summary.supabase.url], ['anon key', r.summary.supabase.anonKey], ['service_role key', r.summary.supabase.serviceKey], ['Replaces', r.summary.supabase.replaces]].filter(([, v]) => v).map(([k, v]) => (
                    <div key={k} className="flex items-center gap-2"><span className="text-slate-500 w-28 shrink-0">{k}</span><code className="text-slate-200 truncate flex-1">{v}</code>
                      <button onClick={() => navigator.clipboard?.writeText(v)} className="text-slate-500 hover:text-white cursor-pointer"><Copy className="w-3.5 h-3.5" /></button></div>
                  ))}
                  <div className="text-slate-500">Services: {r.summary.supabase.processes.join(', ')}{r.summary.supabase.functions.length ? ` · functions: ${r.summary.supabase.functions.join(', ')}` : ''}. Keep the service_role key secret.</div>
                </div>
              )}
              {r.summary?.warnings?.map((w, i) => <div key={i} className="text-left text-xs text-amber-300 flex gap-2"><AlertTriangle className="w-4 h-4 shrink-0" />{w}</div>)}
            </div>
          )}

          {r?.status === 'failed' && (
            <div className="mt-5 text-left p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-sm text-rose-200 whitespace-pre-wrap">{r.error}</div>
          )}
        </div>

        <div className={`${card} p-5`}>
          <ul className="space-y-1">
            {view.stages.map(s => (
              <li key={s.id} className="flex items-center gap-3 py-1.5">
                <span className="w-6 h-6 rounded-full flex items-center justify-center shrink-0">
                  {s.status === 'done' && <span className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center"><Check className="w-3 h-3 text-white" strokeWidth={3} /></span>}
                  {s.status === 'running' && <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />}
                  {s.status === 'warning' && <span className="w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center"><AlertTriangle className="w-3 h-3 text-onaccent" /></span>}
                  {s.status === 'failed' && <span className="w-5 h-5 rounded-full bg-rose-500 flex items-center justify-center"><X className="w-3 h-3 text-white" strokeWidth={3} /></span>}
                  {s.status === 'skipped' && <span className="w-5 h-5 rounded-full border border-white/15 flex items-center justify-center text-slate-600 text-[10px]">—</span>}
                  {s.status === 'pending' && <span className="w-5 h-5 rounded-full border border-white/15" />}
                </span>
                <span className={`text-sm flex-1 ${s.status === 'pending' || s.status === 'skipped' ? 'text-slate-500' : 'text-slate-200'}`}>{s.label}</span>
                {s.detail && <span className="text-xs text-slate-500 truncate max-w-[45%]">{s.detail}</span>}
              </li>
            ))}
          </ul>
          <button onClick={() => setShowLog(v => !v)} className="mt-3 text-xs text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer">
            {showLog ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />} {showLog ? 'Hide details' : 'Show details'}
          </button>
          {showLog && (
            <pre ref={logRef} className="mt-3 max-h-80 overflow-auto rounded-xl bg-black/60 border border-white/5 p-3 text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-all">
              {view.logs.map((l, i) => <span key={i} className={l.isError ? 'text-amber-300' : 'text-slate-300'}>{l.text}</span>)}
            </pre>
          )}
        </div>

        {r && (
          <div className="flex justify-center gap-3">
            {r.status === 'failed' && <button onClick={() => setStep('launch')} className={ghost}><ArrowLeft className="w-4 h-4" /> Back to settings</button>}
            {r.status === 'failed' && <button onClick={startDeploy} className={primary}><RefreshCw className="w-4 h-4" /> Try again</button>}
            {r.status === 'success' && <button onClick={() => { setStep('source'); setDeployId(null); setAnalysis(null); setUpload(null); setDbUpload(null); setAppName(''); setDomain(''); setSubTouched(false); setVercelImport(null) }} className={ghost}>Deploy another app</button>}
            {r.status === 'success' && onBackToHub && <button onClick={onBackToHub} className={primary}>Done</button>}
          </div>
        )}
      </div>
    )
  }

  // ------------------------------------------------------------------ wizard
  const stepIndex = STEPS.findIndex(([id]) => id === step)
  return (
    <div className="max-w-4xl mx-auto space-y-6 font-sans">
      {/* Header + steps */}
      <div className={`${card} p-6`}>
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-600 text-onaccent"><Rocket className="w-5 h-5" /></div>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-white">Deploy a new app</h1>
            <p className="text-xs text-slate-400">From GitHub or an uploaded project — with an optional database — to a live domain with HTTPS.</p>
          </div>
          {onBackToHub && <button onClick={onBackToHub} className={ghost}><ArrowLeft className="w-4 h-4" /> Back</button>}
        </div>
        <div className="mt-5 flex items-center gap-2">
          {STEPS.map(([id, label], i) => (
            <React.Fragment key={id}>
              <button
                onClick={() => i < stepIndex && setStep(id)}
                className={`flex items-center gap-2 text-xs font-semibold ${i <= stepIndex ? 'text-white' : 'text-slate-500'} ${i < stepIndex ? 'cursor-pointer' : 'cursor-default'}`}
              >
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] ${i < stepIndex ? 'bg-emerald-500 text-onaccent' : i === stepIndex ? 'bg-cyan-500 text-slate-950' : 'bg-white/10'}`}>
                  {i < stepIndex ? <Check className="w-3.5 h-3.5" strokeWidth={3} /> : i + 1}
                </span>
                <span className="hidden sm:inline">{label}</span>
              </button>
              {i < STEPS.length - 1 && <div className={`flex-1 h-px ${i < stepIndex ? 'bg-emerald-500/50' : 'bg-white/10'}`} />}
            </React.Fragment>
          ))}
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-sm flex gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="cursor-pointer"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* ---------------------------------------------------------- source */}
      {step === 'source' && (
        <div className={`${card} p-6`}>
          <div className="inline-flex p-1 rounded-full bg-white/5 border border-white/10">
            {[...(template ? [['template', 'Template', Sparkles]] : []), ['github', 'GitHub', Github], ['upload', 'Upload project', Upload], ['vercel', 'From Vercel', Triangle]].map(([id, label, Icon]) => (
              <button key={id} onClick={() => { setSourceType(id); setAnalysis(id === 'template' ? (template.analysis || { framework: template.name, label: 'Marketplace template', fileCount: '—', type: template.defaults?.type || 'auto' }) : null); setError(null) }} className={`px-4 py-2 rounded-full text-sm flex items-center gap-2 cursor-pointer ${sourceType === id ? 'bg-white text-slate-950 font-semibold' : 'text-slate-300'}`}>
                <Icon className="w-4 h-4" /> {label}
              </button>
            ))}
          </div>

          {sourceType === 'template' && template && (
            <div className="mt-5 space-y-3">
              <div className="p-5 rounded-2xl bg-amber-500/10 border border-amber-500/30">
                <div className="text-white font-bold">{template.name}</div>
                <div className="text-xs text-slate-300 mt-1">{template.description}</div>
                <div className="text-[11px] text-amber-200/80 mt-2">From the marketplace · {template.source?.type === 'git' ? `Git, branch ${template.source.branch}` : 'packaged archive'}. Build settings, port, environment and database are pre-filled — review them in the next steps.</div>
              </div>
              <AnalysisCard />
            </div>
          )}

          {sourceType === 'github' && (
            <div className="mt-5 space-y-4">
              {hasToken ? (
                <div>
                  <div className="mb-3 flex items-center gap-3 text-sm">
                    {ghAccount?.avatarUrl ? <img src={ghAccount.avatarUrl} alt="" className="w-7 h-7 rounded-full" /> : <Github className="w-5 h-5 text-slate-400" />}
                    <div className="flex-1 min-w-0 text-slate-300 truncate">
                      Connected as <span className="text-white font-semibold">{ghAccount?.login}</span>
                      <span className="text-slate-500 text-xs"> · {loadingRepos ? 'loading repositories…' : `${repos.length} repositories`}</span>
                    </div>
                    <button onClick={loadRepos} disabled={loadingRepos} title="Reload repositories" className="text-slate-400 hover:text-white cursor-pointer"><RefreshCw className={`w-4 h-4 ${loadingRepos ? 'animate-spin' : ''}`} /></button>
                    <button onClick={disconnectGithub} className="text-xs text-slate-400 hover:text-white cursor-pointer">Disconnect</button>
                  </div>
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input value={repoQuery} onChange={(e) => setRepoQuery(e.target.value)} placeholder="Search your repositories" className={`${input} pl-10`} />
                  </div>
                  <div className="mt-2 max-h-64 overflow-y-auto rounded-2xl border border-white/10 divide-y divide-white/5">
                    {loadingRepos && <div className="p-4 text-sm text-slate-500 flex items-center gap-2"><RefreshCw className="w-4 h-4 animate-spin" /> Loading repositories…</div>}
                    {!loadingRepos && filteredRepos.length === 0 && <div className="p-4 text-sm text-slate-500">No repositories found.</div>}
                    {filteredRepos.map(r => (
                      <button key={r.full_name} onClick={() => pickRepo(r)} className={`w-full px-4 py-3 text-left flex items-center gap-3 hover:bg-white/5 cursor-pointer ${gitUrl === r.clone_url ? 'bg-cyan-500/10' : ''}`}>
                        <Github className="w-4 h-4 text-slate-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-white truncate">{r.full_name} {r.private && <Lock className="w-3 h-3 inline text-slate-500" />}</div>
                          <div className="text-xs text-slate-500 truncate">{r.language || 'unknown language'} · {r.default_branch}{r.description ? ` · ${r.description}` : ''}</div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-slate-600" />
                      </button>
                    ))}
                  </div>
                </div>
              ) : ghAccount === null ? (
                <div className="p-4 text-sm text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Checking your GitHub connection…</div>
              ) : (
                <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 text-sm">
                  <div className="text-white font-semibold">Connect GitHub to pick a repository</div>
                  <div className="text-xs text-slate-400 mt-1">See all your repositories, including private ones and your organizations'. Public repositories also work without connecting: paste the URL below.</div>
                  {ghAccount.oauthAvailable && (
                    <button onClick={githubSignIn} disabled={!!ghBusy} className="mt-4 w-full sm:w-auto px-5 py-3 rounded-full bg-white hover:bg-slate-200 text-slate-900 font-bold text-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50">
                      {ghBusy === 'oauth' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Github className="w-4 h-4" />} Sign in with GitHub
                    </button>
                  )}
                  <details className="mt-4" open={!ghAccount.oauthAvailable}>
                    <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-200">{ghAccount.oauthAvailable ? 'Developer? Use a personal access token instead' : 'Use a personal access token'}</summary>
                    <div className="text-xs text-slate-500 mt-2">Create one at <a href="https://github.com/settings/tokens/new?scopes=repo,read:org&description=AutoDeploy" target="_blank" rel="noreferrer" className="text-cyan-300 hover:underline">github.com → Settings → Developer settings → Personal access tokens</a> with the "repo" scope (classic), or a fine-grained token with read access to Contents.</div>
                    <div className="mt-2 flex gap-2">
                      <input type="password" value={githubToken} onChange={(e) => setGithubToken(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveToken()} placeholder="ghp_… or github_pat_…" autoComplete="off" className={input} />
                      <button onClick={saveToken} disabled={!githubToken.trim() || !!ghBusy} className={ghost}>{ghBusy === 'token' && <Loader2 className="w-4 h-4 animate-spin" />}Connect</button>
                    </div>
                  </details>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-[1fr_160px_auto] gap-2 items-end">
                <label className="block"><span className="text-xs text-slate-400">Repository URL</span>
                  <input value={gitUrl} onChange={(e) => { setGitUrl(e.target.value); setBranches([]) }} onBlur={() => gitUrl && !branches.length && loadBranches()} placeholder="https://github.com/user/repo.git" className={`${input} mt-1`} /></label>
                <label className="block"><span className="text-xs text-slate-400 flex items-center gap-1">Branch {loadingBranches && <RefreshCw className="w-3 h-3 animate-spin" />}</span>
                  {branches.length > 0 ? (
                    <select value={branch} onChange={(e) => pickBranch(e.target.value)} disabled={analyzing} className={`${input} mt-1`}>
                      {!branches.includes(branch) && <option value={branch}>{branch}</option>}
                      {branches.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  ) : (
                    <input value={branch} onChange={(e) => setBranch(e.target.value)} className={`${input} mt-1`} />
                  )}</label>
                <button onClick={() => { if (!branches.length) loadBranches(); analyzeGit() }} disabled={!gitUrl || analyzing} className={primary}>
                  {analyzing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Analyze
                </button>
              </div>
              {analyzing && <div className="text-sm text-slate-400 flex items-center gap-2"><RefreshCw className="w-4 h-4 animate-spin" /> Downloading the repository and detecting the stack…</div>}
            </div>
          )}

          {sourceType === 'vercel' && (
            <>
              <VercelImport api={api} styles={{ input, primary, ghost }} onImport={importFromVercel} imported={vercelImport} />
              {analyzing && <div className="mt-3 text-sm text-slate-400 flex items-center gap-2"><RefreshCw className="w-4 h-4 animate-spin" /> Downloading the repository and detecting the stack…</div>}
              {vercelImport && !analyzing && !analysis && <div className="mt-3 text-xs text-slate-400">If the repository is private, connect the GitHub account that can read it in the GitHub tab, then pick the project again.</div>}
            </>
          )}

          {sourceType === 'upload' && (
            <div className="mt-5">
              {!upload || upload.status === 'error' ? (
                <Dropzone accept=".zip,.tar.gz,.tgz,.tar" hint="Your project folder as .zip or .tar.gz — up to 2 GB. Leave out node_modules to upload faster." onFile={onSourceFile} />
              ) : (
                <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10">
                  <div className="flex items-center gap-3">
                    <FileArchive className="w-8 h-8 text-cyan-400" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white truncate">{upload.name}</div>
                      <div className="text-xs text-slate-500">{formatBytes(upload.size)} · {upload.status === 'uploading' ? `Uploading ${Math.round(upload.progress * 100)}%` : upload.status === 'processing' ? 'Extracting and analyzing…' : 'Ready'}</div>
                    </div>
                    {upload.status === 'ready' && <button onClick={() => { setUpload(null); setAnalysis(null) }} className="text-xs text-slate-400 hover:text-white cursor-pointer">Replace</button>}
                  </div>
                  {upload.status !== 'ready' && <div className="mt-3"><ProgressBar value={upload.status === 'processing' ? 1 : upload.progress} /></div>}
                </div>
              )}
            </div>
          )}

          <AnalysisCard />

          <div className="mt-6 flex justify-end">
            <button onClick={() => setStep('app')} disabled={!sourceReady} className={primary}>Continue <ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------- app */}
      {step === 'app' && (
        <div className={`${card} p-6 space-y-5`}>
          <AnalysisCard />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block"><span className="text-xs text-slate-400">App name</span>
              <input value={appName} onChange={(e) => setAppName(slug(e.target.value))} placeholder="my-shop" className={`${input} mt-1`} />
              <span className="text-[11px] text-slate-500">Installed in /var/www/{appName || 'app-name'}</span></label>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-slate-400">Domain</span>
              {dnsConn?.connected && dnsConn.zones?.length > 0 && (
                <div className="flex rounded-full bg-white/5 p-0.5 text-xs">
                  {[['managed', `Subdomain of my ${dnsConn.label} domains`], ['custom', 'Other domain']].map(([id, l]) => (
                    <button key={id} onClick={() => setDomainMode(id)} className={`px-3 py-1 rounded-full cursor-pointer ${domainMode === id ? 'bg-cyan-500 text-slate-950 font-semibold' : 'text-slate-300 hover:text-white'}`}>{l}</button>
                  ))}
                </div>
              )}
            </div>

            {domainMode === 'managed' ? (
              <>
                <div className="flex items-stretch rounded-xl border border-white/10 bg-slate-950 focus-within:border-cyan-500/60 overflow-hidden">
                  <input value={sub} onChange={(e) => { setSubTouched(true); setSub(e.target.value.toLowerCase().replace(/[^a-z0-9.-]/g, '')) }} placeholder="(root domain)" className="flex-1 min-w-0 bg-transparent px-3.5 py-2.5 text-sm text-slate-100 focus:outline-none text-right" />
                  <span className="px-1 py-2.5 text-sm text-slate-500">.</span>
                  <select value={zone} onChange={(e) => setZone(e.target.value)} className="bg-white/5 border-l border-white/10 px-3 text-sm text-slate-100 focus:outline-none cursor-pointer">
                    {dnsConn.zones.map(z => <option key={z} value={z}>{z}</option>)}
                  </select>
                </div>
                <div className="flex items-start justify-between gap-3 text-[11px]">
                  <span className={dnsCheck?.result?.status === 'taken' || dnsCheck?.error ? 'text-amber-300' : 'text-slate-500'}>
                    {dnsCheck?.busy ? <span className="inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Checking {domain}…</span>
                      : dnsCheck?.error ? dnsCheck.error
                        : dnsCheck?.result ? <>{dnsCheck.result.status === 'free' && <Check className="inline w-3 h-3 text-emerald-400 mr-1" />}{dnsCheck.result.detail} {dnsCheck.result.status !== 'taken' && `The A record is added in ${dnsConn.label} automatically and HTTPS is issued once it resolves.`}</>
                          : `The A record is added in ${dnsConn.label} automatically.`}
                  </span>
                  <button onClick={refreshDnsZones} className="shrink-0 text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer" title="Re-read the domains in the DNS account"><RefreshCw className="w-3 h-3" /> Domains</button>
                </div>
                {dnsCheck?.result?.status === 'taken' && (
                  <label className="flex items-center gap-2 text-xs text-amber-200 cursor-pointer"><input type="checkbox" checked={replaceDomain} onChange={(e) => setReplaceDomain(e.target.checked)} /> Point {domain} at this server instead (replaces its current DNS record and any site using it here)</label>
                )}
              </>
            ) : (
              <>
                <input value={domain} onChange={(e) => setDomain(e.target.value.trim().toLowerCase())} placeholder="shop.example.com" className={input} />
                <span className="text-[11px] text-slate-500">Point its DNS A record to {activeServer?.ipAddress || 'your server'} for HTTPS.</span>
              </>
            )}

            {dnsConn && !dnsConn.connected && (
              <div className="p-3 rounded-xl bg-white/[0.03] border border-white/10 text-xs space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-300"><Globe className="inline w-3.5 h-3.5 mr-1 text-cyan-400" />Connect your DNS provider to pick a subdomain and have its DNS record added automatically.</span>
                  {!dnsForm.open && <button onClick={() => setDnsForm(f => ({ ...f, open: true }))} className="shrink-0 text-cyan-300 hover:text-cyan-200 cursor-pointer">Connect</button>}
                </div>
                {dnsForm.open && (
                  <>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <select value={dnsForm.provider} onChange={(e) => setDnsForm(f => ({ ...f, provider: e.target.value }))} className={`${input} sm:max-w-[10rem]`}>
                        {Object.entries(dnsConn.providers || {}).map(([id, p]) => <option key={id} value={id}>{p.label}</option>)}
                      </select>
                      <input type="password" value={dnsForm.token} onChange={(e) => setDnsForm(f => ({ ...f, token: e.target.value }))} placeholder="API token" className={input} />
                      <button onClick={connectDns} disabled={dnsForm.busy || !dnsForm.token.trim()} className={primary}>{dnsForm.busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Connect'}</button>
                    </div>
                    <div className="text-slate-500">
                      {dnsConn.providers?.[dnsForm.provider]?.tokenHelp}
                      {dnsConn.providers?.[dnsForm.provider]?.tokenUrl && <> · <a href={dnsConn.providers[dnsForm.provider].tokenUrl} target="_blank" rel="noreferrer" className="text-cyan-400 hover:underline">open it <ExternalLink className="inline w-3 h-3" /></a></>}
                      . The token stays on the panel (never shown again) and is shared with Domains and Email.
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
          {vercelImport?.missingEnv?.length > 0 && (
            <div className="text-xs text-amber-300 flex gap-2"><AlertTriangle className="w-4 h-4 shrink-0" />Enter the values of {vercelImport.missingEnv.join(', ')} (sensitive on Vercel, so they could not be imported).</div>
          )}
          <label className="block"><span className="text-xs text-slate-400">Environment variables (optional, one per line)</span>
            <textarea value={envVars} onChange={(e) => setEnvVars(e.target.value)} rows={4} placeholder={'API_KEY=…\nSMTP_HOST=…'} className={`${input} mt-1 font-mono text-xs`} />
            <span className="text-[11px] text-slate-500">PORT, NODE_ENV and database settings are added automatically.</span></label>

          <button onClick={() => setShowAdvanced(v => !v)} className="text-xs text-slate-400 hover:text-white flex items-center gap-1.5 cursor-pointer">
            <Settings2 className="w-3.5 h-3.5" /> Advanced {showAdvanced ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
          {showAdvanced && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-2xl bg-white/[0.02] border border-white/10">
              <label className="block sm:col-span-2"><span className="text-xs text-slate-400">App type</span>
                <select value={overrides.type} onChange={(e) => setOverrides(o => ({ ...o, type: e.target.value }))} className={`${input} mt-1`}>
                  {TYPE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{v === 'auto' ? `Auto-detect (${analysis?.framework || '…'})` : l}</option>)}
                </select></label>
              <label className="block"><span className="text-xs text-slate-400">Build command</span>
                <input value={overrides.buildCommand} onChange={(e) => setOverrides(o => ({ ...o, buildCommand: e.target.value }))} placeholder={analysis?.build || analysis?.frontend?.build || 'npm run build'} className={`${input} mt-1 font-mono text-xs`} /></label>
              <label className="block"><span className="text-xs text-slate-400">Start command</span>
                <input value={overrides.startCommand} onChange={(e) => setOverrides(o => ({ ...o, startCommand: e.target.value }))} placeholder={analysis?.start || analysis?.backend?.start || 'npm run start'} className={`${input} mt-1 font-mono text-xs`} /></label>
              <label className="block"><span className="text-xs text-slate-400">Build output folder</span>
                <input value={overrides.outputDir} onChange={(e) => setOverrides(o => ({ ...o, outputDir: e.target.value }))} placeholder={analysis?.outputDir || analysis?.frontend?.outputDir || 'dist'} className={`${input} mt-1 font-mono text-xs`} /></label>
              <label className="block"><span className="text-xs text-slate-400">App folder inside the project</span>
                <input value={overrides.appDir} onChange={(e) => setOverrides(o => ({ ...o, appDir: e.target.value }))} placeholder={analysis?.dir || '(project root)'} className={`${input} mt-1 font-mono text-xs`} /></label>
              <label className="block"><span className="text-xs text-slate-400">Port (server apps)</span>
                <input value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} placeholder="auto" className={`${input} mt-1`} /></label>
            </div>
          )}

          <div className="flex justify-between">
            <button onClick={() => setStep('source')} className={ghost}><ArrowLeft className="w-4 h-4" /> Back</button>
            <button onClick={() => setStep('database')} disabled={!appReady} className={primary}>Continue <ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------- database */}
      {step === 'database' && (
        <div className={`${card} p-6 space-y-5`}>
          {analysis?.database?.hints?.length > 0 && (
            <div className="text-xs text-slate-400 p-3 rounded-xl bg-white/[0.03] border border-white/10">
              <span className="text-slate-200 font-semibold">Detected:</span> {analysis.database.hints.join(' · ')}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[['none', 'No database', 'The app needs none, or uses an external one'], ['create', 'Create new database', 'Empty database + user; credentials go into .env'], ['import', 'Upload database file', 'Create it and import your .sql / .dump / .sqlite'], ['migrate', 'Migrate existing database', 'Copy from Supabase or any PostgreSQL, plus Supabase Storage files']].map(([id, title, desc]) => (
              <button key={id} onClick={() => setDbMode(id)} className={`p-4 rounded-2xl border text-left cursor-pointer ${dbMode === id ? 'border-cyan-400 bg-cyan-500/10' : 'border-white/10 bg-white/[0.02] hover:bg-white/5'}`}>
                <div className="text-sm text-white font-semibold">{title}</div>
                <div className="text-xs text-slate-400 mt-1">{desc}</div>
              </button>
            ))}
          </div>

          {dbMode !== 'none' && dbMode !== 'migrate' && (
            <label className="block"><span className="text-xs text-slate-400">Database engine</span>
              <select value={dbEngine} onChange={(e) => setDbEngine(e.target.value)} disabled={dbUpload?.result?.engine && dbMode === 'import'} className={`${input} mt-1`}>
                {ENGINES.filter(([v]) => dbMode === 'create' || v !== 'mongodb').map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select></label>
          )}

          {dbMode === 'import' && (
            !dbUpload || dbUpload.status === 'error' ? (
              <Dropzone accept=".sql,.gz,.dump,.sqlite,.sqlite3,.db" hint=".sql or .sql.gz (MySQL / PostgreSQL), .dump (pg_dump custom format), .sqlite / .db" onFile={onDbFile} />
            ) : (
              <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10">
                <div className="flex items-center gap-3">
                  <Database className="w-7 h-7 text-cyan-400" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white truncate">{dbUpload.name}</div>
                    <div className="text-xs text-slate-500">{formatBytes(dbUpload.size)} · {dbUpload.status === 'uploading' ? `Uploading ${Math.round(dbUpload.progress * 100)}%` : dbUpload.status === 'processing' ? 'Checking…' : `${dbUpload.result?.engine ? `${dbUpload.result.engine} dump` : 'SQL dump'} ready`}</div>
                  </div>
                  {dbUpload.status === 'ready' && <button onClick={() => setDbUpload(null)} className="text-xs text-slate-400 hover:text-white cursor-pointer">Replace</button>}
                </div>
                {dbUpload.status !== 'ready' && <div className="mt-3"><ProgressBar value={dbUpload.status === 'processing' ? 1 : dbUpload.progress} /></div>}
              </div>
            )
          )}

          {dbMode === 'migrate' && (
            <div className="space-y-4">
              <SupabaseImport api={api} styles={{ input, primary, ghost }} onImport={importFromSupabase} preferredRef={migrate.supabaseRef} />
              <label className="block"><span className="text-xs text-slate-400">Connection string of the database to copy</span>
                <input value={migrate.sourceUrl} onChange={(e) => setMigrateField('sourceUrl', e.target.value)} placeholder="postgresql://postgres.abcdefgh:password@aws-0-eu-central-1.pooler.supabase.com:5432/postgres" autoComplete="off" spellCheck={false} className={`${input} mt-1 font-mono`} />
                <span className="block text-[11px] text-slate-500 mt-1">Supabase: Connect → Session pooler (the direct db.….supabase.co address is IPv6 only). Neon, RDS, Railway and other PostgreSQL work too. The source is only read, never changed.</span></label>
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer"><input type="checkbox" checked={migrate.includeAuth} onChange={(e) => setMigrateField('includeAuth', e.target.checked)} /> Also copy Supabase Auth users (the auth schema)</label>

              <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 space-y-2">
                <div className="text-xs text-slate-300 font-semibold">Supabase Storage files <span className="text-slate-500 font-normal">(optional)</span></div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input value={migrate.storageUrl} onChange={(e) => setMigrateField('storageUrl', e.target.value)} placeholder="Project URL (https://abcdefgh.supabase.co)" autoComplete="off" spellCheck={false} className={input} />
                  <input type="password" value={migrate.storageKey} onChange={(e) => setMigrateField('storageKey', e.target.value)} placeholder="service_role / secret key" autoComplete="new-password" className={input} />
                </div>
                <div className="text-[11px] text-slate-500">Every bucket is downloaded to the server. Public buckets are served from your domain at the same paths, so <code>https://….supabase.co/storage/v1/object/public/…</code> becomes <code>https://{domain || 'your-domain'}/storage/v1/object/public/…</code>. The key is used for this copy only and is not saved.</div>
              </div>

              {supabaseSource && (
                <div className={`p-4 rounded-2xl border space-y-3 ${migrate.runSupabase ? 'bg-cyan-500/5 border-cyan-500/25' : 'bg-white/[0.03] border-white/10'}`}>
                  <label className="flex items-start gap-2 text-sm text-slate-200 cursor-pointer">
                    <input type="checkbox" className="mt-1" checked={migrate.runSupabase} onChange={(e) => setMigrateField('runSupabase', e.target.checked)} />
                    <span><span className="font-semibold flex items-center gap-1.5"><Zap className="w-4 h-4 text-cyan-400" /> Run Supabase on this server</span>
                      <span className="block text-xs text-slate-400 mt-0.5">Auth (users keep their passwords), the REST API with your row level security, Storage and the repo's Edge Functions, at <code>https://{domain || 'your-domain'}/auth/v1</code>, <code>/rest/v1</code>, <code>/storage/v1</code> and <code>/functions/v1</code>. The app's Supabase URL and keys are switched to them, so supabase-js keeps working without code changes. Realtime is not included. Uses about 200 MB of memory.</span></span>
                  </label>
                  {migrate.runSupabase && (
                    <>
                      <label className="block"><span className="text-xs text-slate-400">JWT secret {migrate.jwtSecret ? <span className="text-emerald-300">· filled in</span> : <span className="text-slate-500">(optional)</span>}</span>
                        <input type="password" value={migrate.jwtSecret} onChange={(e) => setMigrateField('jwtSecret', e.target.value)} placeholder="Legacy JWT secret (Project Settings → JWT Keys)" autoComplete="new-password" className={`${input} mt-1 font-mono`} />
                        <span className="block text-[11px] text-slate-500 mt-1">With it, the project's current anon and service keys and your users' sessions stay valid. Without it, new keys are issued (written to .env and into the built app) and users sign in once more.</span></label>
                      <label className="block"><span className="text-xs text-slate-400">Edge Function secrets <span className="text-slate-500">(one KEY=value per line)</span></span>
                        <textarea value={migrate.functionSecrets} onChange={(e) => setMigrateField('functionSecrets', e.target.value)} rows={3} placeholder={'OPENAI_API_KEY=…\nSTRIPE_SECRET_KEY=…'} className={`${input} mt-1 font-mono text-xs`} />
                        <span className="block text-[11px] text-slate-500 mt-1">{migrate.secretNames.length ? `Your project has ${migrate.secretNames.length} secret(s); Supabase does not reveal their values, so paste them here. ` : ''}SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_DB_URL are set automatically. Functions are read from the repo's supabase/functions folder.</span></label>
                    </>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <button onClick={checkMigration} disabled={!dbReady || migrateCheck?.busy} className={ghost}>{migrateCheck?.busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Test connection</button>
                {migrateCheck?.error && <span className="text-xs text-rose-300 whitespace-pre-wrap flex-1 min-w-0">{migrateCheck.error}</span>}
              </div>
              {migrateCheck?.result && (
                <div className="p-4 rounded-2xl bg-emerald-500/5 border border-emerald-500/20 text-xs text-slate-300 space-y-1.5">
                  {migrateCheck.result.database && (() => {
                    const d = migrateCheck.result.database
                    return <>
                      <div className="flex gap-2"><Check className="w-4 h-4 text-emerald-400 shrink-0" /><span>{d.provider === 'supabase' ? 'Supabase' : d.host} · PostgreSQL {d.version} · {d.tables} table(s) in {d.schemas.join(', ') || 'no schemas'}{d.size ? ` · ${formatBytes(d.size)}` : ''}{d.users !== null && d.users !== undefined ? ` · ${d.users} user(s)` : ''}</span></div>
                      {d.notes?.map((n, i) => <div key={i} className="flex gap-2 text-amber-300"><AlertTriangle className="w-4 h-4 shrink-0" /><span>{n}</span></div>)}
                    </>
                  })()}
                  {migrateCheck.result.storage && (
                    <div className="flex gap-2"><Check className="w-4 h-4 text-emerald-400 shrink-0" /><span>{migrateCheck.result.storage.buckets.length ? migrateCheck.result.storage.buckets.map(b => `${b.name} (${b.public ? 'public' : 'private'}${b.files !== null ? `, ${b.files} file(s), ${formatBytes(b.bytes)}` : ''})`).join(' · ') : 'No storage buckets'}</span></div>
                  )}
                </div>
              )}
            </div>
          )}

          {dbMode !== 'none' && (dbMode === 'migrate' || ['mysql', 'postgresql'].includes(dbEngine)) && (
            <div>
              <div className="text-xs text-slate-400">New database credentials <span className="text-slate-500">(optional — leave empty to generate them; they are written to .env)</span></div>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input value={dbCreds.name} onChange={(e) => setDbCreds(c => ({ ...c, name: e.target.value }))} placeholder={`Database name (${(appName || 'app').replace(/-/g, '_')})`} className={input} />
                <input value={dbCreds.user} onChange={(e) => setDbCreds(c => ({ ...c, user: e.target.value }))} placeholder="Username" autoComplete="off" className={input} />
                <input type="password" value={dbCreds.password} onChange={(e) => setDbCreds(c => ({ ...c, password: e.target.value }))} placeholder="Password (min 8)" autoComplete="new-password" className={input} />
              </div>
            </div>
          )}

          {dbMode !== 'none' && dbMode !== 'migrate' && dbEngine === 'mysql' && (
            <details className="text-xs text-slate-400">
              <summary className="cursor-pointer">MySQL admin login (only if the panel can't log in to MySQL by itself — use root or another admin, not the new database's user)</summary>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input value={dbAdmin.user} onChange={(e) => setDbAdmin(a => ({ ...a, user: e.target.value }))} placeholder="Admin user (root)" autoComplete="off" className={input} />
                <input type="password" value={dbAdmin.password} onChange={(e) => setDbAdmin(a => ({ ...a, password: e.target.value }))} placeholder="Admin password" autoComplete="new-password" className={input} />
              </div>
            </details>
          )}

          <div className="flex justify-between">
            <button onClick={() => setStep('app')} className={ghost}><ArrowLeft className="w-4 h-4" /> Back</button>
            <button onClick={() => setStep('launch')} disabled={!dbReady} className={primary}>Continue <ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------- launch */}
      {step === 'launch' && (
        <div className={`${card} p-6 space-y-5`}>
          <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 flex items-center gap-3">
            <Server className="w-5 h-5 text-cyan-400" />
            <div className="flex-1 min-w-0">
              <div className="text-sm text-white font-semibold truncate">Deploying to {activeServer?.name || 'this server'}</div>
              <div className="text-xs text-slate-500 truncate">{activeServer?.ipAddress || activeServer?.hostname || 'the panel host'} · uses the server's saved SSH login · switch servers with the server menu at the top</div>
            </div>
            {activeServer?.status === 'offline' && <span className="text-xs text-rose-300">unreachable</span>}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-200 cursor-pointer"><input type="checkbox" checked={ssl} onChange={(e) => setSsl(e.target.checked)} /> <Lock className="w-4 h-4 text-emerald-400" /> Free HTTPS certificate (Let's Encrypt)</label>
            {ssl && <input value={sslEmail} onChange={(e) => setSslEmail(e.target.value)} placeholder="Email for certificate notices (optional)" className={`${input} sm:max-w-xs`} />}
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer"><input type="checkbox" checked={replaceDomain} onChange={(e) => setReplaceDomain(e.target.checked)} /> Replace an existing site already using {domain || 'this domain'}</label>

          <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 text-sm grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
            {[
              ['Source', sourceType === 'template' ? `Template: ${template?.name}` : sourceType === 'github' || sourceType === 'vercel' ? `${gitUrl.replace(/^https:\/\/(github\.com\/)?/, '').replace(/\.git$/, '')} · ${branch}` : upload?.name],
              ['App', `${overrides.type !== 'auto' ? TYPE_OPTIONS.find(t => t[0] === overrides.type)?.[1] : analysis?.framework}`],
              ['Address', `${ssl ? 'https' : 'http'}://${domain}`],
              ['DNS', domainMode === 'managed' ? `Automatic · ${dnsConn?.label} A record → ${activeServer?.ipAddress || 'this server'}` : `You point ${domain} to ${activeServer?.ipAddress || 'the server'}`],
              ['Folder', `/var/www/${appName}`],
              ['Database', dbMode === 'none' ? 'None' : dbMode === 'migrate' ? `PostgreSQL · copy of ${migrateCheck?.result?.database?.provider === 'supabase' || /supabase\./i.test(migrate.sourceUrl) ? 'Supabase' : 'external database'}${migrate.storageUrl.trim() ? ' + Storage files' : ''}${runsSupabase ? ' · Supabase API on this server' : ''}` : `${ENGINES.find(e => e[0] === dbEngine)?.[1]}${dbMode === 'import' ? ` · import ${dbUpload?.name}` : ' · new, empty'}`],
              ['Server', activeServer?.name || 'This server']
            ].map(([k, v]) => (
              <div key={k} className="flex gap-3"><span className="text-slate-500 w-20 shrink-0">{k}</span><span className="text-slate-200 truncate">{v}</span></div>
            ))}
          </div>

          <div className="flex justify-between">
            <button onClick={() => setStep('database')} className={ghost}><ArrowLeft className="w-4 h-4" /> Back</button>
            <button onClick={startDeploy} disabled={activeServer?.status === 'offline'} className={primary}><Rocket className="w-4 h-4" /> Deploy</button>
          </div>
        </div>
      )}
    </div>
  )
}
