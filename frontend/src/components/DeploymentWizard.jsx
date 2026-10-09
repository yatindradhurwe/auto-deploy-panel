import React, { useState, useEffect, useRef, useMemo } from 'react'
import {
  Github, Upload, Server, Database, Rocket, Check, X, RefreshCw, ChevronRight, ChevronDown, ArrowLeft,
  AlertTriangle, FileArchive, Globe, Lock, Search, Copy, ExternalLink, Sparkles, Settings2, Box, Loader2
} from 'lucide-react'

/**
 * 1-click deployment: GitHub repo or uploaded archive (+ optional database file) → live site.
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

export default function DeploymentWizard({ jwtToken, activeServer, apiBaseUrl = '', onDeploymentSuccess, onBackToHub, initialTemplate }) {
  const token = () => jwtToken || localStorage.getItem('autodeploy_token') || localStorage.getItem('autodeploy_jwt_token') || ''
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
  const [repos, setRepos] = useState([])
  const [repoQuery, setRepoQuery] = useState('')
  const [loadingRepos, setLoadingRepos] = useState(false)
  const [gitUrl, setGitUrl] = useState('')
  const [branch, setBranch] = useState('main')
  const [analyzing, setAnalyzing] = useState(false)
  const [upload, setUpload] = useState(null) // { name, size, progress, uploadId, status }
  const [analysis, setAnalysis] = useState(null)

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

  // --- server / launch
  const [ssl, setSsl] = useState(true)
  const [sslEmail, setSslEmail] = useState('')
  const [replaceDomain, setReplaceDomain] = useState(false)

  // --- progress
  const [deployId, setDeployId] = useState(null)
  const [stages, setStages] = useState([])
  const [events, setEvents] = useState([])
  const [showLog, setShowLog] = useState(false)
  const [startedAt, setStartedAt] = useState(null)
  const [now, setNow] = useState(Date.now())
  const logRef = useRef(null)


  useEffect(() => {
    if (!initialTemplate) return
    setSourceType('github')
    setGitUrl(initialTemplate.repoUrl || initialTemplate.gitUrl || '')
    setAppName(slug(initialTemplate.id || initialTemplate.name))
  }, [initialTemplate])

  // GitHub token + repos
  const loadRepos = async () => {
    setLoadingRepos(true)
    try {
      const data = await api('/github-repos', { method: 'POST', body: {} })
      setRepos(Array.from(new Map((data.repos || []).map(r => [r.full_name, r])).values()))
    } catch { /* no token */ } finally {
      setLoadingRepos(false)
    }
  }
  useEffect(() => {
    api('/get-github-token').then(d => { if (d.githubToken) { setHasToken(true); loadRepos() } }).catch(() => {})
  }, [])

  const saveToken = async () => {
    if (!githubToken.trim()) return
    try {
      await api('/save-github-token', { method: 'POST', body: { githubToken: githubToken.trim() } })
      setHasToken(true)
      setGithubToken('')
      loadRepos()
    } catch (e) {
      setError(e.message)
    }
  }

  const applyAnalysis = (a, nameHint) => {
    setAnalysis(a)
    setOverrides({ type: 'auto', buildCommand: '', startCommand: '', outputDir: '', appDir: '' })
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

  const pickRepo = (r) => {
    setGitUrl(r.clone_url)
    setBranch(r.default_branch || 'main')
    analyzeGit(r.clone_url, r.default_branch || 'main', r.name)
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

  // ------------------------------------------------------------------ deploy
  const startDeploy = async () => {
    setError(null)
    const body = {
      appName,
      domain,
      envVars,
      port: port ? Number(port) : undefined,
      source: sourceType === 'github' ? { type: 'github', gitUrl, branch } : { type: 'upload', uploadId: upload?.uploadId },
      overrides: { ...overrides, type: overrides.type },
      database: dbMode === 'none' ? { mode: 'none' } : {
        mode: dbMode, engine: dbEngine, uploadId: dbUpload?.uploadId,
        ...(dbEngine === 'mysql' && dbAdmin.user ? { adminUser: dbAdmin.user, adminPassword: dbAdmin.password } : {})
      },
      ssl, sslEmail, replaceDomain
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

  const sourceReady = !!analysis && (sourceType === 'github' ? !!gitUrl : upload?.status === 'ready')
  const appReady = /^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/.test(appName) && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)
  const dbReady = dbMode !== 'import' || dbUpload?.status === 'ready'
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
            {r?.status === 'success' ? <Check className="w-10 h-10 text-white" strokeWidth={3} /> : r?.status === 'failed' ? <X className="w-10 h-10 text-white" strokeWidth={3} /> : <Box className="w-9 h-9 text-white" />}
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
                  {s.status === 'warning' && <span className="w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center"><AlertTriangle className="w-3 h-3 text-white" /></span>}
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
            {r.status === 'success' && <button onClick={() => { setStep('source'); setDeployId(null); setAnalysis(null); setUpload(null); setDbUpload(null); setAppName(''); setDomain('') }} className={ghost}>Deploy another app</button>}
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
          <div className="p-2.5 rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-600 text-white"><Rocket className="w-5 h-5" /></div>
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
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] ${i < stepIndex ? 'bg-emerald-500 text-white' : i === stepIndex ? 'bg-cyan-500 text-slate-950' : 'bg-white/10'}`}>
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
            {[['github', 'GitHub', Github], ['upload', 'Upload project', Upload]].map(([id, label, Icon]) => (
              <button key={id} onClick={() => { setSourceType(id); setAnalysis(null); setError(null) }} className={`px-4 py-2 rounded-full text-sm flex items-center gap-2 cursor-pointer ${sourceType === id ? 'bg-white text-slate-950 font-semibold' : 'text-slate-300'}`}>
                <Icon className="w-4 h-4" /> {label}
              </button>
            ))}
          </div>

          {sourceType === 'github' && (
            <div className="mt-5 space-y-4">
              {hasToken ? (
                <div>
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
              ) : (
                <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 text-sm">
                  <div className="text-white font-semibold">Connect GitHub (for private repos and a repo list)</div>
                  <div className="text-xs text-slate-400 mt-1">Create a token at github.com → Settings → Developer settings → Personal access tokens with "repo" access. Public repos work without it.</div>
                  <div className="mt-3 flex gap-2">
                    <input type="password" value={githubToken} onChange={(e) => setGithubToken(e.target.value)} placeholder="ghp_…" className={input} />
                    <button onClick={saveToken} className={ghost}>Connect</button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-[1fr_160px_auto] gap-2 items-end">
                <label className="block"><span className="text-xs text-slate-400">Repository URL</span>
                  <input value={gitUrl} onChange={(e) => setGitUrl(e.target.value)} placeholder="https://github.com/user/repo.git" className={`${input} mt-1`} /></label>
                <label className="block"><span className="text-xs text-slate-400">Branch</span>
                  <input value={branch} onChange={(e) => setBranch(e.target.value)} className={`${input} mt-1`} /></label>
                <button onClick={() => analyzeGit()} disabled={!gitUrl || analyzing} className={primary}>
                  {analyzing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Analyze
                </button>
              </div>
              {analyzing && <div className="text-sm text-slate-400 flex items-center gap-2"><RefreshCw className="w-4 h-4 animate-spin" /> Downloading the repository and detecting the stack…</div>}
            </div>
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
            <label className="block"><span className="text-xs text-slate-400">Domain</span>
              <input value={domain} onChange={(e) => setDomain(e.target.value.trim().toLowerCase())} placeholder="shop.example.com" className={`${input} mt-1`} />
              <span className="text-[11px] text-slate-500">Point its DNS A record to {activeServer?.ipAddress || 'your server'} for HTTPS</span></label>
          </div>
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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[['none', 'No database', 'The app needs none, or uses an external one'], ['create', 'Create new database', 'Empty database + user; credentials go into .env'], ['import', 'Upload database file', 'Create it and import your .sql / .dump / .sqlite']].map(([id, title, desc]) => (
              <button key={id} onClick={() => setDbMode(id)} className={`p-4 rounded-2xl border text-left cursor-pointer ${dbMode === id ? 'border-cyan-400 bg-cyan-500/10' : 'border-white/10 bg-white/[0.02] hover:bg-white/5'}`}>
                <div className="text-sm text-white font-semibold">{title}</div>
                <div className="text-xs text-slate-400 mt-1">{desc}</div>
              </button>
            ))}
          </div>

          {dbMode !== 'none' && (
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

          {dbMode !== 'none' && dbEngine === 'mysql' && (
            <details className="text-xs text-slate-400">
              <summary className="cursor-pointer">MySQL admin login (only if the server's MySQL root needs a password)</summary>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input value={dbAdmin.user} onChange={(e) => setDbAdmin(a => ({ ...a, user: e.target.value }))} placeholder="root" className={input} />
                <input type="password" value={dbAdmin.password} onChange={(e) => setDbAdmin(a => ({ ...a, password: e.target.value }))} placeholder="password" className={input} />
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
              ['Source', sourceType === 'github' ? `${gitUrl.replace(/^https:\/\/(github\.com\/)?/, '').replace(/\.git$/, '')} · ${branch}` : upload?.name],
              ['App', `${overrides.type !== 'auto' ? TYPE_OPTIONS.find(t => t[0] === overrides.type)?.[1] : analysis?.framework}`],
              ['Address', `${ssl ? 'https' : 'http'}://${domain}`],
              ['Folder', `/var/www/${appName}`],
              ['Database', dbMode === 'none' ? 'None' : `${ENGINES.find(e => e[0] === dbEngine)?.[1]}${dbMode === 'import' ? ` · import ${dbUpload?.name}` : ' · new, empty'}`],
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
