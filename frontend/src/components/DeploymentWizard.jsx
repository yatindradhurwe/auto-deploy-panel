import React, { useState, useEffect, useRef } from 'react'
import {
  Zap, GitBranch, Github, Server, Globe, Key, ShieldCheck, Terminal, CheckCircle2,
  AlertTriangle, RefreshCw, Layers, ArrowRight, ArrowLeft, Play, Lock, Cpu, Sparkles, X, Check
} from 'lucide-react'

export default function DeploymentWizard({ jwtToken, activeServer, apiBaseUrl = '', onDeploymentSuccess }) {
  const [step, setStep] = useState(1) // 1: Repo, 2: Config, 3: Server/Domain, 4: Live Execution
  const [githubToken, setGithubToken] = useState(() => localStorage.getItem('autodeploy_github_token') || '')
  const [tokenSavedMsg, setTokenSavedMsg] = useState(false)
  const [repos, setRepos] = useState([])
  const [loadingRepos, setLoadingRepos] = useState(false)
  const logsContainerRef = useRef(null)

  // Auto-scroll terminal log container as new logs arrive
  useEffect(() => {
    if (logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight
    }
  }, [deployLogs])

  // Deployment Form State
  const [deployForm, setDeployForm] = useState({
    gitUrl: 'https://github.com/yatindradhurwe/TOP-Income-Producer-CRM.git',
    repoName: 'TOP-Income-Producer-CRM',
    branch: 'main',
    appName: 'tip-crm-app',
    remoteDir: '/var/www/tip-crm-app',
    framework: 'Node.js Express',
    backendPort: 5070,
    domain: '',
    setupSsl: true,
    envVars: 'NODE_ENV=production\nPORT=5070',
    host: activeServer ? (activeServer.ipAddress || activeServer.host) : '187.127.165.128',
    port: activeServer ? (activeServer.port || 22) : 22,
    username: activeServer ? (activeServer.username || 'root') : 'root',
    password: 'Yatindra@1223'
  })

  // Live Stream Execution State
  const [deploying, setDeploying] = useState(false)
  const [deployLogs, setDeployLogs] = useState([])
  const [deployStatus, setDeployStatus] = useState('idle') // 'idle' | 'running' | 'success' | 'failed'
  const [deployId, setDeployId] = useState('')

  // Load saved token on mount from backend database or localStorage
  useEffect(() => {
    const loadSavedToken = async () => {
      try {
        const res = await fetch(`${apiBaseUrl}/api/deploy/get-github-token`, {
          headers: { 'Authorization': `Bearer ${jwtToken}` }
        })
        const data = await res.json()
        if (data.success && data.githubToken) {
          setGithubToken(data.githubToken)
          localStorage.setItem('autodeploy_github_token', data.githubToken)
          fetchGithubReposWithToken(data.githubToken)
        } else if (githubToken) {
          fetchGithubReposWithToken(githubToken)
        }
      } catch (e) {
        if (githubToken) fetchGithubReposWithToken(githubToken)
      }
    }
    loadSavedToken()
  }, [])

  useEffect(() => {
    if (activeServer) {
      setDeployForm(prev => ({
        ...prev,
        host: activeServer.ipAddress || activeServer.host || '187.127.165.128',
        port: activeServer.port || 22,
        username: activeServer.username || 'root'
      }))
    }
  }, [activeServer])

  const handleSaveTokenKey = async () => {
    if (!githubToken.trim()) {
      alert('Please enter a valid GitHub Personal Access Token.')
      return
    }
    try {
      localStorage.setItem('autodeploy_github_token', githubToken.trim())
      await fetch(`${apiBaseUrl}/api/deploy/save-github-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify({ githubToken: githubToken.trim() })
      })
      setTokenSavedMsg(true)
      setTimeout(() => setTokenSavedMsg(false), 3000)
      fetchGithubReposWithToken(githubToken.trim())
    } catch (e) {
      console.warn('Save token error:', e)
    }
  }

  const fetchGithubReposWithToken = async (tokenStr) => {
    const tok = tokenStr || githubToken
    if (!tok || !tok.trim()) return
    setLoadingRepos(true)
    try {
      localStorage.setItem('autodeploy_github_token', tok.trim())
      const res = await fetch(`${apiBaseUrl}/api/deploy/github-repos`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify({ githubToken: tok.trim() })
      })
      const data = await res.json()
      if (data.success && data.repos) {
        setRepos(data.repos)
      }
    } catch (err) {
      console.warn('GitHub API Error:', err)
    } finally {
      setLoadingRepos(false)
    }
  }

  const fetchGithubRepos = () => fetchGithubReposWithToken(githubToken)

  const handleSelectRepo = (repo) => {
    const cleanAppName = repo.name.toLowerCase().replace(/[^a-z0-9]/g, '-')
    setDeployForm(prev => ({
      ...prev,
      gitUrl: repo.authenticated_url || repo.clone_url || repo.html_url,
      repoName: repo.name,
      branch: repo.default_branch || 'main',
      appName: cleanAppName,
      remoteDir: `/var/www/${cleanAppName}`,
      domain: `${cleanAppName}.yjtechnosoft.com`
    }))
  }

  const startOneClickDeployment = async () => {
    setStep(4)
    setDeploying(true)
    setDeployStatus('running')
    setDeployLogs([
      { text: `🚀 Initializing 1-Click Deployment for '${deployForm.appName}'...`, step: 'START', timestamp: new Date().toISOString() },
      { text: `--> Target Host Node: ${deployForm.host}:${deployForm.port} (${deployForm.username})`, step: 'CONFIG', timestamp: new Date().toISOString() },
      { text: `--> Git Repository: ${deployForm.gitUrl} [Branch: ${deployForm.branch}]`, step: 'CONFIG', timestamp: new Date().toISOString() },
      { text: `--> Target Remote Path: ${deployForm.remoteDir}`, step: 'CONFIG', timestamp: new Date().toISOString() }
    ])

    const payload = {
      ...deployForm,
      gitRepoUrl: deployForm.gitUrl,
      gitUrl: deployForm.gitUrl
    }

    try {
      const res = await fetch(`${apiBaseUrl}/api/deploy/deploy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify(payload)
      })

      const data = await res.json()

      if (!data.success) {
        setDeployStatus('failed')
        setDeploying(false)
        setDeployLogs(prev => [...prev, { text: `❌ Deployment Request Failed: ${data.error}`, isError: true, step: 'END', timestamp: new Date().toISOString() }])
        return
      }

      setDeployId(data.deployId)

      // Connect EventSource SSE log stream with authentication token parameter
      const tokenToUse = jwtToken || localStorage.getItem('autodeploy_token') || localStorage.getItem('token') || ''
      const streamUrl = `${apiBaseUrl}/api/deploy/stream/${data.deployId}?token=${encodeURIComponent(tokenToUse)}`
      const eventSource = new EventSource(streamUrl)

      eventSource.onmessage = (event) => {
        try {
          const logData = JSON.parse(event.data)
          setDeployLogs(prev => [...prev, logData])

          if (logData.step === 'END' || logData.text.includes('[FINISHED]')) {
            setDeployStatus(logData.isError ? 'failed' : 'success')
            setDeploying(false)
            eventSource.close()
            if (!logData.isError && onDeploymentSuccess) {
              onDeploymentSuccess()
            }
          }
        } catch (e) {
          console.error('SSE parse error:', e)
        }
      }

      eventSource.onerror = () => {
        eventSource.close()
        setDeploying(false)
      }
    } catch (err) {
      setDeployStatus('failed')
      setDeploying(false)
      setDeployLogs(prev => [...prev, { text: `❌ Deployment Error: ${err.message}`, isError: true, step: 'END', timestamp: new Date().toISOString() }])
    }
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Wizard Header */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-900/90 to-indigo-950/40 border border-slate-800 rounded-3xl p-6 backdrop-blur-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="p-2 bg-gradient-to-tr from-cyan-500 to-indigo-600 rounded-xl text-white shadow-lg shadow-cyan-500/20">
              <Zap className="w-5 h-5" />
            </span>
            <h1 className="text-2xl font-black text-white tracking-tight">1-Click Automated Deployment Wizard</h1>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Deploy any Node.js, React, Express, or Web app from GitHub onto your connected VPS server node in seconds.
          </p>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center space-x-2 bg-slate-950/80 border border-slate-800 px-4 py-2 rounded-2xl">
          {[
            { num: 1, label: 'Repository' },
            { num: 2, label: 'App Config' },
            { num: 3, label: 'Server & Nginx' },
            { num: 4, label: 'Live Deploy' }
          ].map((s) => (
            <div key={s.num} className="flex items-center space-x-1.5">
              <span className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center font-mono ${
                step === s.num
                  ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/30'
                  : step > s.num
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                  : 'bg-slate-800 text-slate-400'
              }`}>
                {step > s.num ? <Check className="w-3.5 h-3.5" /> : s.num}
              </span>
              <span className={`text-xs font-semibold ${step === s.num ? 'text-white' : 'text-slate-500'}`}>{s.label}</span>
              {s.num < 4 && <span className="text-slate-700 mx-1">/</span>}
            </div>
          ))}
        </div>
      </div>

      {/* STEP 1: GitHub & Git Repository Selection */}
      {step === 1 && (
        <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 backdrop-blur-xl space-y-6">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Github className="w-5 h-5 text-cyan-400" />
                <span>Select Git Repository</span>
              </h3>
              <p className="text-xs text-slate-400">Provide your repository URL or load repositories using your GitHub Personal Access Token.</p>
            </div>
          </div>

          {/* GitHub Token Fetch & Save Bar */}
          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-300 block">GitHub Personal Access Token (Saved in account settings)</label>
              {tokenSavedMsg && (
                <span className="text-[11px] font-bold text-emerald-400 bg-emerald-950/80 border border-emerald-800 px-2.5 py-0.5 rounded-full flex items-center gap-1 animate-pulse">
                  <Check className="w-3.5 h-3.5" />
                  <span>Token Saved Permanently!</span>
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="password"
                value={githubToken}
                onChange={(e) => setGithubToken(e.target.value)}
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-xs font-mono text-cyan-300 focus:outline-none focus:border-cyan-500"
              />
              <button
                onClick={handleSaveTokenKey}
                className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-slate-950 font-extrabold text-xs rounded-xl transition flex items-center gap-1.5 shadow-md cursor-pointer"
                title="Save token key permanently so it will never ask again"
              >
                <Check className="w-4 h-4 text-slate-950" />
                <span>Save Token Key</span>
              </button>
              <button
                onClick={fetchGithubRepos}
                disabled={loadingRepos}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-cyan-300 font-bold text-xs rounded-xl border border-slate-700 flex items-center gap-2 cursor-pointer"
              >
                {loadingRepos ? <RefreshCw className="w-4 h-4 animate-spin text-cyan-400" /> : <Github className="w-4 h-4 text-cyan-400" />}
                <span>Fetch Repositories</span>
              </button>
            </div>
          </div>

          {/* Repository List Grid if loaded */}
          {repos.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-60 overflow-y-auto pr-1">
              {repos.map(r => (
                <div
                  key={r.id}
                  onClick={() => handleSelectRepo(r)}
                  className={`p-3.5 rounded-2xl border cursor-pointer transition flex items-center justify-between ${
                    deployForm.repoName === r.name
                      ? 'bg-cyan-950/40 border-cyan-500/80 text-white shadow-lg shadow-cyan-500/10'
                      : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <div className="truncate pr-2">
                    <div className="font-bold text-xs flex items-center gap-2 truncate">
                      <span>{r.name}</span>
                      {r.private && <span className="text-[10px] bg-rose-950 text-rose-300 border border-rose-800 px-1.5 py-0.2 rounded font-mono">Private</span>}
                    </div>
                    <div className="text-[10px] text-slate-500 truncate mt-0.5">{r.html_url}</div>
                  </div>
                  {deployForm.repoName === r.name && <CheckCircle2 className="w-5 h-5 text-cyan-400 flex-shrink-0" />}
                </div>
              ))}
            </div>
          )}

          {/* Manual Git URL Input */}
          <div className="space-y-4 pt-2">
            <div>
              <label className="text-xs font-bold text-slate-300 block mb-1">Git Repository HTTPS Clone URL</label>
              <input
                type="text"
                value={deployForm.gitUrl}
                onChange={(e) => setDeployForm({ ...deployForm, gitUrl: e.target.value })}
                placeholder="https://github.com/username/repository.git"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs font-mono text-cyan-300 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">Git Branch</label>
                <input
                  type="text"
                  value={deployForm.branch}
                  onChange={(e) => setDeployForm({ ...deployForm, branch: e.target.value })}
                  placeholder="main"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">Framework Preset</label>
                <select
                  value={deployForm.framework}
                  onChange={(e) => setDeployForm({ ...deployForm, framework: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs font-medium text-white focus:outline-none focus:border-cyan-500"
                >
                  <option value="Node.js Express">Node.js Express / API Backend</option>
                  <option value="Node.js React">Node.js React / Vite Frontend</option>
                  <option value="Next.js">Next.js SSR Application</option>
                  <option value="Python Flask">Python Flask / FastAPI</option>
                  <option value="Static HTML/JS">Static HTML / Web App</option>
                </select>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end pt-4">
            <button
              onClick={() => setStep(2)}
              className="px-6 py-2.5 bg-gradient-to-r from-cyan-500 to-indigo-600 text-white font-bold text-xs rounded-xl shadow-lg shadow-cyan-500/20 flex items-center space-x-2"
            >
              <span>Continue to App Configuration</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: App & Environment Configuration */}
      {step === 2 && (
        <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 backdrop-blur-xl space-y-6">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Layers className="w-5 h-5 text-cyan-400" />
                <span>Application Name & Node Port</span>
              </h3>
              <p className="text-xs text-slate-400">Configure PM2 service name, listening port, and target destination directory.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-slate-300 block mb-1">Application PM2 Service Name</label>
              <input
                type="text"
                value={deployForm.appName}
                onChange={(e) => {
                  const val = e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '-')
                  setDeployForm({
                    ...deployForm,
                    appName: val,
                    remoteDir: `/var/www/${val}`,
                    domain: `${val}.yjtechnosoft.com`
                  })
                }}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs font-mono text-white focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-300 block mb-1">Backend Port (PM2 HTTP Server)</label>
              <input
                type="number"
                value={deployForm.backendPort}
                onChange={(e) => setDeployForm({ ...deployForm, backendPort: parseInt(e.target.value) || 5050 })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs font-mono text-cyan-300 focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-300 block mb-1">Target Directory Path on VPS</label>
            <input
              type="text"
              value={deployForm.remoteDir}
              onChange={(e) => setDeployForm({ ...deployForm, remoteDir: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs font-mono text-slate-300 focus:outline-none focus:border-cyan-500"
            />
          </div>

          {/* Environment Variables Box */}
          <div>
            <label className="text-xs font-bold text-slate-300 block mb-1">Environment Variables (.env)</label>
            <textarea
              rows={4}
              value={deployForm.envVars}
              onChange={(e) => setDeployForm({ ...deployForm, envVars: e.target.value })}
              placeholder="NODE_ENV=production&#10;PORT=5070&#10;DATABASE_URL=postgres://..."
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs font-mono text-emerald-300 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="flex items-center justify-between pt-4">
            <button
              onClick={() => setStep(1)}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl border border-slate-700 flex items-center space-x-1.5"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back</span>
            </button>
            <button
              onClick={() => setStep(3)}
              className="px-6 py-2.5 bg-gradient-to-r from-cyan-500 to-indigo-600 text-white font-bold text-xs rounded-xl shadow-lg shadow-cyan-500/20 flex items-center space-x-2"
            >
              <span>Continue to Nginx & SSL</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: Server Node, Domain & SSL */}
      {step === 3 && (
        <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 backdrop-blur-xl space-y-6">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Globe className="w-5 h-5 text-cyan-400" />
                <span>Domain Name & SSL Encryption</span>
              </h3>
              <p className="text-xs text-slate-400">Configure Nginx reverse proxy routing and Let's Encrypt SSL certificate.</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-xs font-bold text-slate-300 block mb-1">Target Host Server IP Address</label>
              <input
                type="text"
                value={deployForm.host}
                onChange={(e) => setDeployForm({ ...deployForm, host: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs font-mono text-cyan-300 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-300 block mb-1">Domain Name (Optional)</label>
              <input
                type="text"
                value={deployForm.domain}
                onChange={(e) => setDeployForm({ ...deployForm, domain: e.target.value })}
                placeholder="my-app.yjtechnosoft.com"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs font-mono text-white focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div className="flex items-center space-x-3 bg-slate-950 border border-slate-800 p-4 rounded-2xl">
              <input
                type="checkbox"
                id="setupSsl"
                checked={deployForm.setupSsl}
                onChange={(e) => setDeployForm({ ...deployForm, setupSsl: e.target.checked })}
                className="w-4 h-4 rounded text-cyan-500 focus:ring-0 bg-slate-900 border-slate-700"
              />
              <label htmlFor="setupSsl" className="text-xs text-slate-200 cursor-pointer select-none">
                <strong>Automatically Issue Let's Encrypt SSL Certificate</strong> (Requires DNS A record pointing to {deployForm.host})
              </label>
            </div>
          </div>

          <div className="flex items-center justify-between pt-4">
            <button
              onClick={() => setStep(2)}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl border border-slate-700 flex items-center space-x-1.5"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back</span>
            </button>

            <button
              onClick={startOneClickDeployment}
              className="px-8 py-3 bg-gradient-to-r from-cyan-500 via-indigo-600 to-purple-600 text-white font-extrabold text-xs rounded-xl shadow-xl shadow-cyan-500/20 flex items-center space-x-2 animate-pulse"
            >
              <Zap className="w-4 h-4" />
              <span>Start 1-Click Deployment Now 🚀</span>
            </button>
          </div>
        </div>
      )}

      {/* STEP 4: Live Execution Terminal */}
      {step === 4 && (
        <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 backdrop-blur-xl space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center space-x-2">
              <Terminal className="w-5 h-5 text-cyan-400" />
              <h3 className="text-base font-bold text-white">Live SSH Execution Terminal</h3>
            </div>
            <div className="flex items-center space-x-2">
              {deploying && (
                <span className="px-3 py-1 bg-cyan-950 text-cyan-300 border border-cyan-800 rounded-full text-[10px] font-mono font-bold flex items-center gap-1.5">
                  <RefreshCw className="w-3 h-3 animate-spin text-cyan-400" />
                  <span>DEPLOYING...</span>
                </span>
              )}
              {deployStatus === 'success' && (
                <span className="px-3 py-1 bg-emerald-950 text-emerald-300 border border-emerald-800 rounded-full text-[10px] font-mono font-bold flex items-center gap-1.5">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  <span>SUCCESSFUL</span>
                </span>
              )}
              {deployStatus === 'failed' && (
                <span className="px-3 py-1 bg-rose-950 text-rose-300 border border-rose-800 rounded-full text-[10px] font-mono font-bold flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3 text-rose-400" />
                  <span>FAILED</span>
                </span>
              )}
            </div>
          </div>

          <div ref={logsContainerRef} className="bg-slate-950 border border-slate-800 rounded-2xl p-4 font-mono text-xs text-slate-300 h-96 overflow-y-auto space-y-1 shadow-inner">
            {deployLogs.map((log, idx) => (
              <div key={idx} className={`leading-relaxed ${log.isError ? 'text-rose-400 font-bold' : log.step === 'START' ? 'text-cyan-400 font-bold' : 'text-slate-300'}`}>
                <span className="text-slate-600 text-[10px] mr-2">[{log.timestamp ? log.timestamp.substring(11, 19) : ''}]</span>
                <span>{log.text}</span>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between pt-2">
            <button
              onClick={() => setStep(1)}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl border border-slate-700 flex items-center space-x-1.5"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>New Deployment</span>
            </button>

            {deployStatus === 'success' && (
              <button
                onClick={() => window.location.reload()}
                className="px-6 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold text-xs rounded-xl shadow-lg shadow-emerald-500/20"
              >
                View Deployed Projects & PM2 Apps 🎉
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
