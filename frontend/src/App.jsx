import React, { useState, useEffect, useRef } from 'react'
import {
  Server, Terminal, ShieldCheck, Globe, Zap, Cpu, CheckCircle2,
  XCircle, AlertTriangle, Play, RefreshCw, Copy, Check, Lock, HardDrive, Code,
  Github, Search, X, ChevronRight, Sparkles, FolderGit2, Bot, LogOut, UserCheck,
  Layers, Database, FolderTree, LayoutDashboard
} from 'lucide-react'
import AICopilotDrawer from './components/AICopilotDrawer'
import LoginPage from './components/LoginPage'
import ServerManager from './components/ServerManager'
import ProjectExplorer from './components/ProjectExplorer'
import DatabaseManager from './components/DatabaseManager'
import CodeStudio from './components/CodeStudio'

const DEFAULT_CONFIG = {
  host: '187.127.165.128',
  port: '22',
  username: 'root',
  password: 'Yatindra@1223',
  domain: 'tip-crm.yjtechnosoft.com',
  gitRepoUrl: 'https://github.com/yatindradhurwe/TOP-Income-Producer-CRM.git',
  remoteDir: '/var/www/tip-crm',
  appName: 'tip-crm-backend',
  backendPort: 5050,
  setupSsl: true,
}

export default function App() {
  // Studio Workspace Active Navigation Tab
  const [activeTab, setActiveTab] = useState('deploy') // 'deploy' | 'servers' | 'projects' | 'databases' | 'code'
  const [activeServer, setActiveServer] = useState({
    name: 'Production Server Node 01',
    host: '187.127.165.128',
    domain: 'automate-deployment.yjtechnosoft.com'
  })
  const [targetProjectInStudio, setTargetProjectInStudio] = useState('')

  // JWT Auth State
  const [jwtToken, setJwtToken] = useState(() => localStorage.getItem('autodeploy_jwt_token') || '')
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
      const token = localStorage.getItem('autodeploy_jwt_token')
      if (!token) {
        setVerifyingSession(false)
        return
      }
      try {
        const res = await fetch('/api/auth/me', {
          headers: { 'Authorization': `Bearer ${token}` }
        })
        if (res.ok) {
          const data = await res.json()
          if (data.user) {
            setCurrentUser(data.user)
            localStorage.setItem('autodeploy_user', JSON.stringify(data.user))
          }
        } else if (res.status === 401 || res.status === 403) {
          // Token expired or invalid -> automatic logout
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
  }

  const handleLogout = async () => {
    try {
      if (jwtToken) {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${jwtToken}` }
        }).catch(() => {})
      }
    } finally {
      localStorage.removeItem('autodeploy_jwt_token')
      localStorage.removeItem('autodeploy_user')
      setJwtToken('')
      setCurrentUser(null)
      setDeployId(null)
      setLogs([])
      setCurrentStep('IDLE')
      setDeploySuccess(null)
    }
  }

  const [config, setConfig] = useState(DEFAULT_CONFIG)
  const [testingSsh, setTestingSsh] = useState(false)
  const [sshStatus, setSshStatus] = useState(null)
  
  const [scanningPorts, setScanningPorts] = useState(false)
  const [scanResult, setScanResult] = useState(null)

  const [deploying, setDeploying] = useState(false)
  const [deployId, setDeployId] = useState(null)
  const [logs, setLogs] = useState([])
  const [currentStep, setCurrentStep] = useState('IDLE')
  const [deploySuccess, setDeploySuccess] = useState(null)
  const [copied, setCopied] = useState(false)

  // GitHub Side Panel State
  const [githubToken, setGithubToken] = useState(() => localStorage.getItem('autodeploy_gh_token') || '')
  const [showGithubDrawer, setShowGithubDrawer] = useState(false)
  const [loadingRepos, setLoadingRepos] = useState(false)
  const [repos, setRepos] = useState([])
  const [repoSearch, setRepoSearch] = useState('')
  const [repoError, setRepoError] = useState(null)

  // AI Copilot Drawer State
  const [showAiDrawer, setShowAiDrawer] = useState(false)

  const terminalEndRef = useRef(null)

  // Save GitHub token to local storage
  useEffect(() => {
    if (githubToken) {
      localStorage.setItem('autodeploy_gh_token', githubToken)
    }
  }, [githubToken])

  // Auto-scroll terminal
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  // Handle SSE log streaming
  useEffect(() => {
    if (!deployId) return

    const eventSource = new EventSource(`/api/deploy/stream/${deployId}?token=${encodeURIComponent(jwtToken)}`)

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        setLogs((prev) => [...prev, data])
        if (data.step) setCurrentStep(data.step)
        if (data.step === 'END') {
          setDeploying(false)
          setDeploySuccess(!data.isError)
          if (data.isError) {
            // Auto open AI copilot on deployment failure!
            setShowAiDrawer(true)
          }
          eventSource.close()
        }
      } catch (e) {
        console.error('Failed to parse SSE payload', e)
      }
    }

    eventSource.onerror = (err) => {
      console.error('SSE connection error', err)
      eventSource.close()
      setDeploying(false)
    }

    return () => {
      eventSource.close()
    }
  }, [deployId])

  const handleInputChange = (field, value) => {
    setConfig((prev) => ({ ...prev, [field]: value }))
  }

  const handlePresetServer = () => {
    setConfig(DEFAULT_CONFIG)
    setSshStatus(null)
    setScanResult(null)
  }

  const handleFetchGithubRepos = async (tokenToUse = githubToken) => {
    if (!tokenToUse) {
      setShowGithubDrawer(true)
      setRepoError('Please enter your GitHub Personal Access Token below to load your repositories.')
      return
    }
    setLoadingRepos(true)
    setRepoError(null)
    try {
      const res = await fetch('/api/deploy/github-repos', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': jwtToken ? `Bearer ${jwtToken}` : ''
        },
        body: JSON.stringify({ githubToken: tokenToUse }),
      })
      const data = await res.json()
      if (data.success) {
        setRepos(data.repos)
        setShowGithubDrawer(true)
      } else {
        setRepoError(data.error || 'Failed to fetch repositories')
      }
    } catch (err) {
      setRepoError(err.message)
    } finally {
      setLoadingRepos(false)
    }
  }

  const handleSelectRepo = (repo) => {
    const cleanRepoName = repo.name.toLowerCase().replace(/[^a-z0-9-]/g, '-')
    const targetPath = `/var/www/${cleanRepoName}`
    const targetAppName = `${cleanRepoName}-backend`
    const targetDomain = repo.name === 'TOP-Income-Producer-CRM' ? 'tip-crm.yjtechnosoft.com' : `${cleanRepoName}.com`

    setConfig((prev) => ({
      ...prev,
      gitRepoUrl: repo.authenticated_url || repo.clone_url,
      remoteDir: targetPath,
      appName: targetAppName,
      domain: targetDomain,
    }))

    setShowGithubDrawer(false)
  }

  const handleTestSsh = async () => {
    setTestingSsh(true)
    setSshStatus(null)
    try {
      const res = await fetch('/api/deploy/test-ssh', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': jwtToken ? `Bearer ${jwtToken}` : ''
        },
        body: JSON.stringify(config),
      })
      const data = await res.json()
      if (data.success) {
        setSshStatus({ type: 'success', message: 'SSH Connection Verified!', details: data.rawInfo })
      } else {
        setSshStatus({ type: 'error', message: data.error || 'Connection Failed' })
      }
    } catch (err) {
      setSshStatus({ type: 'error', message: err.message })
    } finally {
      setTestingSsh(false)
    }
  }

  const handleScanPorts = async () => {
    setScanningPorts(true)
    setScanResult(null)
    try {
      const res = await fetch('/api/deploy/scan-ports', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': jwtToken ? `Bearer ${jwtToken}` : ''
        },
        body: JSON.stringify(config),
      })
      const data = await res.json()
      if (data.success) {
        setScanResult(data)
        if (data.suggestedPort) {
          handleInputChange('backendPort', data.suggestedPort)
        }
      } else {
        alert(`Port scan failed: ${data.error}`)
      }
    } catch (err) {
      alert(`Port scan error: ${err.message}`)
    } finally {
      setScanningPorts(false)
    }
  }

  const handleTriggerDeploy = async () => {
    if (!config.host || !config.domain) {
      alert('Please provide Server IP and Public Domain Name before deploying.')
      return
    }

    setDeploying(true)
    setLogs([])
    setDeploySuccess(null)
    setCurrentStep('INIT')

    try {
      const res = await fetch('/api/deploy/deploy', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': jwtToken ? `Bearer ${jwtToken}` : ''
        },
        body: JSON.stringify(config),
      })
      const data = await res.json()
      if (data.success && data.deployId) {
        setDeployId(data.deployId)
      } else {
        setDeploying(false)
        alert(`Deployment error: ${data.error}`)
      }
    } catch (err) {
      setDeploying(false)
      alert(`Deployment request failed: ${err.message}`)
    }
  }

  const handleCopyLogs = () => {
    const text = logs.map((l) => l.text).join('')
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const filteredRepos = repos.filter((r) =>
    r.name.toLowerCase().includes(repoSearch.toLowerCase()) ||
    (r.description && r.description.toLowerCase().includes(repoSearch.toLowerCase()))
  )

  if (verifyingSession) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-100 font-sans">
        <div className="flex flex-col items-center gap-3">
          <div className="w-9 h-9 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-xs text-slate-400 font-mono tracking-wide">Verifying Admin Session...</p>
        </div>
      </div>
    )
  }

  if (!jwtToken || !currentUser) {
    return <LoginPage onLoginSuccess={handleLoginSuccess} />
  }

  return (
    <div className="min-h-screen bg-[#07090E] text-slate-100 flex flex-col relative overflow-x-hidden selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* Top Navbar - Apple Translucent Glass Style */}
      <header className="border-b border-white/10 bg-slate-950/70 backdrop-blur-2xl sticky top-0 z-40 shadow-xl shadow-slate-950/40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3.5">
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-tr from-cyan-500 via-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/25 ring-1 ring-white/20">
              <Zap className="h-5 w-5 text-white font-bold" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-extrabold text-base tracking-tight text-white bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">AutoDeploy Console</span>
                <span className="text-[10px] bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 px-2 py-0.5 rounded-full font-mono font-semibold tracking-wider">PRO STUDIO v2.0</span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono">Autonomous Cloud Deploy & Multi-Model AI Agent IDE</p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            {/* AI Agent Drawer Trigger Button */}
            <button
              onClick={() => setShowAiDrawer(true)}
              className="text-xs bg-gradient-to-r from-cyan-500/20 via-blue-500/20 to-indigo-500/20 hover:from-cyan-500/30 hover:to-indigo-500/30 text-cyan-300 border border-cyan-500/40 px-3.5 py-1.5 rounded-xl flex items-center space-x-2 transition-all duration-300 shadow-md shadow-cyan-950/40 font-semibold cursor-pointer ring-1 ring-cyan-500/20"
            >
              <Sparkles className="h-4 w-4 text-cyan-400 animate-pulse" />
              <span>AI DevOps Copilot</span>
            </button>

            {/* GitHub Side Panel Toggle Button */}
            <button
              onClick={() => {
                if (repos.length === 0 && githubToken) handleFetchGithubRepos()
                else setShowGithubDrawer(true)
              }}
              className="text-xs bg-slate-900/80 hover:bg-slate-800 text-slate-200 border border-white/10 px-3 py-1.5 rounded-xl flex items-center space-x-2 transition shadow-sm cursor-pointer"
            >
              <Github className="h-4 w-4 text-white" />
              <span className="font-medium">GitHub</span>
            </button>

            <button
              onClick={handlePresetServer}
              className="text-xs bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-white/10 px-3 py-1.5 rounded-xl flex items-center space-x-1.5 transition cursor-pointer"
            >
              <Server className="h-3.5 w-3.5 text-cyan-400" />
              <span>Preset Profile</span>
            </button>

            {/* Logged in Admin User Badge & Logout */}
            <div className="flex items-center space-x-2.5 bg-slate-900/90 border border-white/10 rounded-2xl px-3 py-1 ml-2 shadow-inner">
              <div className="w-7 h-7 rounded-xl bg-gradient-to-tr from-cyan-400 to-blue-600 flex items-center justify-center text-slate-950 font-extrabold text-xs shadow-md ring-1 ring-white/30">
                {currentUser?.name ? currentUser.name.charAt(0) : 'A'}
              </div>
              <div className="hidden md:block text-left leading-tight">
                <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                  <span>{currentUser?.name || 'System Admin'}</span>
                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-800/80 font-mono font-bold">ADMIN</span>
                </div>
                <div className="text-[10px] text-slate-400 font-mono">{currentUser?.email || 'admin@tipcrm.com'}</div>
              </div>
              <button
                onClick={handleLogout}
                title="Sign Out of Console"
                className="ml-1.5 p-1 text-slate-400 hover:text-rose-400 hover:bg-rose-950/50 rounded-lg transition-colors cursor-pointer"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Studio Workspace AWS Segmented Tab Bar */}
      <div className="bg-slate-950/80 border-b border-white/10 backdrop-blur-xl sticky top-16 z-30 shadow-2xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between overflow-x-auto font-mono text-xs py-2">
          <div className="flex items-center space-x-1 bg-slate-900/80 p-1 rounded-2xl border border-white/10 shadow-inner">
            <button
              onClick={() => setActiveTab('deploy')}
              className={`px-4 py-2 rounded-xl flex items-center gap-2 transition-all duration-300 cursor-pointer ${
                activeTab === 'deploy'
                  ? 'bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 text-white font-bold shadow-lg shadow-cyan-500/25 ring-1 ring-white/20'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50'
              }`}
            >
              <Zap className="w-4 h-4" />
              <span>1-Click Deploy</span>
            </button>

            <button
              onClick={() => setActiveTab('servers')}
              className={`px-4 py-2 rounded-xl flex items-center gap-2 transition-all duration-300 cursor-pointer ${
                activeTab === 'servers'
                  ? 'bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 text-white font-bold shadow-lg shadow-cyan-500/25 ring-1 ring-white/20'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50'
              }`}
            >
              <Server className="w-4 h-4" />
              <span>Server History</span>
            </button>

            <button
              onClick={() => setActiveTab('projects')}
              className={`px-4 py-2 rounded-xl flex items-center gap-2 transition-all duration-300 cursor-pointer ${
                activeTab === 'projects'
                  ? 'bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 text-white font-bold shadow-lg shadow-cyan-500/25 ring-1 ring-white/20'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50'
              }`}
            >
              <Layers className="w-4 h-4" />
              <span>Projects & PM2</span>
            </button>

            <button
              onClick={() => setActiveTab('databases')}
              className={`px-4 py-2 rounded-xl flex items-center gap-2 transition-all duration-300 cursor-pointer ${
                activeTab === 'databases'
                  ? 'bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 text-white font-bold shadow-lg shadow-cyan-500/25 ring-1 ring-white/20'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50'
              }`}
            >
              <Database className="w-4 h-4" />
              <span>Databases</span>
            </button>

            <button
              onClick={() => setActiveTab('code')}
              className={`px-4 py-2 rounded-xl flex items-center gap-2 transition-all duration-300 cursor-pointer ${
                activeTab === 'code'
                  ? 'bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 text-white font-bold shadow-lg shadow-cyan-500/25 ring-1 ring-white/20'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50'
              }`}
            >
              <FolderTree className="w-4 h-4" />
              <span>Code Studio IDE</span>
            </button>
          </div>

          <div className="hidden md:flex items-center gap-2 text-slate-400 text-[11px] bg-slate-900/60 border border-white/10 px-3 py-1.5 rounded-xl shadow-inner">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-sm shadow-emerald-400/50"></span>
            <span className="font-mono text-slate-400">Target Host:</span>
            <span className="text-cyan-300 font-semibold font-mono">{activeServer.name} ({activeServer.host})</span>
          </div>
        </div>
      </div>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">

        {activeTab === 'servers' && (
          <ServerManager
            jwtToken={jwtToken}
            onSelectServer={(srv) => {
              setActiveServer(srv)
              handleInputChange('host', srv.host)
              handleInputChange('domain', srv.domain)
              setActiveTab('deploy')
            }}
          />
        )}

        {activeTab === 'projects' && (
          <ProjectExplorer
            jwtToken={jwtToken}
            activeServer={activeServer}
            onOpenInStudio={(projName) => {
              setTargetProjectInStudio(projName)
              setActiveTab('code')
            }}
          />
        )}

        {activeTab === 'databases' && (
          <DatabaseManager jwtToken={jwtToken} />
        )}

        {activeTab === 'code' && (
          <CodeStudio jwtToken={jwtToken} activeServer={activeServer} initialProject={targetProjectInStudio} />
        )}

        {activeTab === 'deploy' && (
          <>
            {/* Top Info Banner */}
            <div className="bg-gradient-to-r from-slate-900 via-slate-900/90 to-blue-950/40 border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
              <div className="absolute top-0 right-0 -mt-8 -mr-8 w-48 h-48 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none"></div>
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
                <div>
                  <h1 className="text-xl font-bold text-white flex items-center gap-2">
                    Deploy Software to Public Server & Domain
                  </h1>
              <p className="text-sm text-slate-400 mt-1 max-w-2xl">
                Connect your GitHub account, configure server SSH credentials, and let the integrated AI Agent Copilot diagnose errors and execute automated server fixes.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowAiDrawer(true)}
                className="bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 text-xs px-4 py-2.5 rounded-xl font-semibold flex items-center space-x-2 transition"
              >
                <Sparkles className="h-4 w-4 text-cyan-400" />
                <span>Open AI Copilot</span>
              </button>
            </div>
          </div>
        </div>

        {/* Step 1 & Step 2 Forms Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

          {/* Card 1: Server SSH Credentials */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center space-x-3">
                <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  <Server className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-semibold text-white">1. Server Connection (SSH)</h2>
                  <p className="text-xs text-slate-400">Target Linux Server IP & Access Credentials</p>
                </div>
              </div>

              <button
                onClick={handleTestSsh}
                disabled={testingSsh}
                className="text-xs bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-cyan-400 border border-slate-700 px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${testingSsh ? 'animate-spin' : ''}`} />
                <span>{testingSsh ? 'Testing...' : 'Test SSH Connection'}</span>
              </button>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2 space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Server IP Address</label>
                <input
                  type="text"
                  value={config.host}
                  onChange={(e) => handleInputChange('host', e.target.value)}
                  placeholder="e.g. 187.127.165.128"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">SSH Port</label>
                <input
                  type="text"
                  value={config.port}
                  onChange={(e) => handleInputChange('port', e.target.value)}
                  placeholder="22"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">SSH Username</label>
                <input
                  type="text"
                  value={config.username}
                  onChange={(e) => handleInputChange('username', e.target.value)}
                  placeholder="root"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">SSH Password</label>
                <input
                  type="password"
                  value={config.password}
                  onChange={(e) => handleInputChange('password', e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            {/* SSH Test Status Result */}
            {sshStatus && (
              <div
                className={`p-3.5 rounded-xl border text-xs font-mono space-y-1 ${
                  sshStatus.type === 'success'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                    : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                }`}
              >
                <div className="flex items-center space-x-2 font-semibold">
                  {sshStatus.type === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                  <span>{sshStatus.message}</span>
                </div>
                {sshStatus.details && <p className="text-[11px] opacity-80 whitespace-pre-wrap mt-1">{sshStatus.details}</p>}
              </div>
            )}
          </div>

          {/* Card 2: Software & Domain Config */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center space-x-3">
                <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  <Globe className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-semibold text-white">2. Public Domain & Repo Config</h2>
                  <p className="text-xs text-slate-400">Target Public Domain & GitHub Source</p>
                </div>
              </div>

              <button
                onClick={() => {
                  if (repos.length === 0 && githubToken) handleFetchGithubRepos()
                  else setShowGithubDrawer(true)
                }}
                className="text-xs bg-slate-800 hover:bg-slate-700 text-cyan-400 border border-slate-700 px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition"
              >
                <Github className="h-3.5 w-3.5 text-cyan-400" />
                <span>Select from GitHub</span>
              </button>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300 flex items-center justify-between">
                <span>Target Public Domain Name</span>
                <span className="text-[10px] text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded">Nginx + SSL Auto-Configured</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={config.domain}
                  onChange={(e) => handleInputChange('domain', e.target.value)}
                  placeholder="e.g. tip-crm.yjtechnosoft.com"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-sm text-cyan-300 font-mono focus:outline-none focus:border-cyan-500"
                />
                <Globe className="h-4 w-4 text-slate-500 absolute left-3 top-2.5" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300">Git Repository URL</label>
              <div className="relative">
                <input
                  type="text"
                  value={config.gitRepoUrl}
                  onChange={(e) => handleInputChange('gitRepoUrl', e.target.value)}
                  placeholder="https://github.com/org/repo.git"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-cyan-500"
                />
                <Code className="h-4 w-4 text-slate-500 absolute left-3 top-2.5" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Remote App Path</label>
                <input
                  type="text"
                  value={config.remoteDir}
                  onChange={(e) => handleInputChange('remoteDir', e.target.value)}
                  placeholder="/var/www/my-app"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">PM2 Process Name</label>
                <input
                  type="text"
                  value={config.appName}
                  onChange={(e) => handleInputChange('appName', e.target.value)}
                  placeholder="my-app-backend"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <label className="flex items-center space-x-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.setupSsl}
                  onChange={(e) => handleInputChange('setupSsl', e.target.checked)}
                  className="rounded border-slate-800 text-cyan-500 focus:ring-cyan-500 bg-slate-950"
                />
                <span>Auto-provision SSL Certificate (Certbot Let's Encrypt)</span>
              </label>

              <div className="flex items-center space-x-1.5 text-xs text-slate-400">
                <span>Backend Port:</span>
                <span className="font-mono text-cyan-400 font-bold">{config.backendPort}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Step 3: Server Port & Service Inspection Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div className="flex items-center space-x-3">
              <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <Cpu className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-semibold text-white">3. Non-Conflicting Port Inspection & Service Monitor</h2>
                <p className="text-xs text-slate-400">Scan active server ports & ensure existing apps are protected</p>
              </div>
            </div>

            <button
              onClick={handleScanPorts}
              disabled={scanningPorts}
              className="text-xs bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-amber-400 border border-slate-700 px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${scanningPorts ? 'animate-spin' : ''}`} />
              <span>{scanningPorts ? 'Scanning Server...' : 'Scan Ports & Active Services'}</span>
            </button>
          </div>

          {scanResult ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                <div className="text-xs font-semibold text-slate-400 flex items-center justify-between">
                  <span>Suggested Backend Port</span>
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                </div>
                <div className="text-2xl font-bold font-mono text-emerald-400">
                  {scanResult.suggestedPort}
                </div>
                <p className="text-[11px] text-slate-500">Unused port assigned automatically to prevent conflicts.</p>
              </div>

              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                <div className="text-xs font-semibold text-slate-400">Active PM2 Services</div>
                <div className="space-y-1.5 max-h-24 overflow-y-auto">
                  {scanResult.pm2Apps && scanResult.pm2Apps.length > 0 ? (
                    scanResult.pm2Apps.map((app) => (
                      <div key={app.id} className="flex items-center justify-between text-xs font-mono bg-slate-900 px-2 py-1 rounded">
                        <span className="text-slate-300 font-semibold">{app.name}</span>
                        <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">{app.status}</span>
                      </div>
                    ))
                  ) : (
                    <span className="text-xs text-slate-500">No active PM2 apps found</span>
                  )}
                </div>
              </div>

              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                <div className="text-xs font-semibold text-slate-400">Listening System Ports</div>
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                  {scanResult.activePorts?.map((port) => (
                    <span key={port} className="text-[11px] font-mono bg-slate-900 text-slate-300 border border-slate-800 px-2 py-0.5 rounded">
                      :{port}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-slate-950/50 p-4 rounded-xl border border-dashed border-slate-800 text-center text-xs text-slate-500">
              Click <strong className="text-amber-400">"Scan Ports & Active Services"</strong> to verify server resources and detect open ports.
            </div>
          )}
        </div>

        {/* Step 4: Action Button & Interactive Live Terminal */}
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center space-x-3">
              <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <Terminal className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-semibold text-white">4. Live Execution Terminal</h2>
                <p className="text-xs text-slate-400">Watch real-time SSH output during automated deployment</p>
              </div>
            </div>

            <button
              onClick={handleTriggerDeploy}
              disabled={deploying}
              className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50 text-slate-950 font-bold px-6 py-3 rounded-xl shadow-lg shadow-cyan-500/20 flex items-center justify-center space-x-2 transition text-sm cursor-pointer"
            >
              {deploying ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin text-slate-950" />
                  <span>Deploying to {config.domain}...</span>
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 text-slate-950 fill-current" />
                  <span>🚀 Launch Automated Deployment to Public Domain</span>
                </>
              )}
            </button>
          </div>

          {/* Terminal Console Box */}
          <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl font-mono text-xs">
            {/* Terminal Header */}
            <div className="bg-slate-900 px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="h-3 w-3 rounded-full bg-rose-500/80"></div>
                <div className="h-3 w-3 rounded-full bg-amber-500/80"></div>
                <div className="h-3 w-3 rounded-full bg-emerald-500/80"></div>
                <span className="text-slate-400 text-xs ml-2 font-mono">root@{config.host}:~# ./deploy.sh --domain {config.domain}</span>
              </div>

              <div className="flex items-center space-x-2">
                {/* AI Auto Fix Button in Terminal Header */}
                <button
                  onClick={() => setShowAiDrawer(true)}
                  className="text-[11px] bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 px-2.5 py-1 rounded-md flex items-center space-x-1 transition font-semibold"
                >
                  <Sparkles className="h-3 w-3 text-cyan-400" />
                  <span>🤖 Auto-Fix with AI Agent</span>
                </button>

                <button
                  onClick={handleCopyLogs}
                  disabled={logs.length === 0}
                  className="text-[11px] text-slate-400 hover:text-white border border-slate-800 hover:border-slate-700 bg-slate-950 px-2.5 py-1 rounded-md flex items-center space-x-1 transition disabled:opacity-40"
                >
                  {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                  <span>{copied ? 'Copied' : 'Copy Logs'}</span>
                </button>
              </div>
            </div>

            {/* Terminal Output Body */}
            <div className="p-4 h-96 overflow-y-auto space-y-1 font-mono text-slate-300 leading-relaxed bg-slate-950">
              {logs.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-600 space-y-2">
                  <Terminal className="h-8 w-8 text-slate-700" />
                  <p className="text-xs">Terminal ready. Click "Launch Automated Deployment" above to begin.</p>
                </div>
              ) : (
                logs.map((item, idx) => (
                  <div
                    key={idx}
                    className={`whitespace-pre-wrap ${
                      item.isError ? 'text-rose-400 font-semibold' : item.step === 'COMPLETE' ? 'text-emerald-400 font-bold' : 'text-slate-300'
                    }`}
                  >
                    {item.text}
                  </div>
                ))
              )}
              <div ref={terminalEndRef} />
            </div>

            {/* Terminal Footer Status Bar */}
            <div className="bg-slate-900/80 px-4 py-2 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400 font-mono">
              <div className="flex items-center space-x-2">
                <span>Status:</span>
                <span className={`font-semibold ${deploying ? 'text-amber-400 animate-pulse' : deploySuccess === false ? 'text-rose-400' : deploySuccess ? 'text-emerald-400' : 'text-slate-400'}`}>
                  {deploying ? `Deploying (${currentStep})...` : deploySuccess === false ? 'Deployment Failed' : deploySuccess ? 'Deployment Successful' : 'Idle'}
                </span>
              </div>

              {deploySuccess === false && (
                <button
                  onClick={() => setShowAiDrawer(true)}
                  className="text-rose-400 hover:text-rose-300 font-semibold flex items-center space-x-1 animate-pulse"
                >
                  <Bot className="h-3.5 w-3.5" />
                  <span>Click to Auto-Fix with AI Agent</span>
                </button>
              )}

              {deploySuccess && (
                <a
                  href={`https://${config.domain}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-emerald-400 hover:underline flex items-center space-x-1"
                >
                  <span>Open https://{config.domain}</span>
                  <Globe className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
        </div>
        </>
        )}

      </main>

      {/* GitHub Slide-Out Side Panel Drawer */}
      {showGithubDrawer && (
        <div className="fixed inset-0 z-50 overflow-hidden bg-slate-950/70 backdrop-blur-sm flex justify-end">
          <div className="w-full max-w-md bg-slate-900 border-l border-slate-800 h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
            {/* Drawer Header */}
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  <Github className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-white text-sm">GitHub Repositories</h3>
                  <p className="text-[11px] text-slate-400">Select a project to auto-fill deployment config</p>
                </div>
              </div>
              <button
                onClick={() => setShowGithubDrawer(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Token Connection Box */}
            <div className="p-4 border-b border-slate-800 bg-slate-950/60 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-medium text-slate-300">GitHub Personal Access Token</label>
                <a
                  href="https://github.com/settings/tokens"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] text-cyan-400 hover:underline"
                >
                  Create Token
                </a>
              </div>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={githubToken}
                  onChange={(e) => setGithubToken(e.target.value)}
                  placeholder="Paste GitHub Personal Access Token..."
                  className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs font-mono text-cyan-300 focus:outline-none focus:border-cyan-500"
                />
                <button
                  onClick={() => handleFetchGithubRepos(githubToken)}
                  disabled={loadingRepos}
                  className="bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-semibold px-3 py-1.5 rounded-lg text-xs flex items-center space-x-1 transition"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loadingRepos ? 'animate-spin' : ''}`} />
                  <span>Fetch</span>
                </button>
              </div>
            </div>

            {/* Search Filter */}
            <div className="p-3 border-b border-slate-800 bg-slate-900">
              <div className="relative">
                <input
                  type="text"
                  value={repoSearch}
                  onChange={(e) => setRepoSearch(e.target.value)}
                  placeholder="Search repository..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                />
                <Search className="h-3.5 w-3.5 text-slate-500 absolute left-2.5 top-2.5" />
              </div>
            </div>

            {/* Repositories List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {repoError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
                  {repoError}
                </div>
              )}

              {loadingRepos ? (
                <div className="h-48 flex flex-col items-center justify-center space-y-2 text-slate-400 text-xs">
                  <RefreshCw className="h-6 w-6 animate-spin text-cyan-400" />
                  <span>Fetching GitHub Repositories...</span>
                </div>
              ) : filteredRepos.length === 0 ? (
                <div className="h-48 flex flex-col items-center justify-center space-y-2 text-slate-500 text-xs text-center p-4">
                  <FolderGit2 className="h-8 w-8 text-slate-700" />
                  <p>No repositories found. Enter token and click Fetch above.</p>
                </div>
              ) : (
                filteredRepos.map((repo) => (
                  <div
                    key={repo.id}
                    className="bg-slate-950/80 border border-slate-800 hover:border-cyan-500/50 rounded-xl p-3.5 space-y-2.5 transition group cursor-pointer"
                    onClick={() => handleSelectRepo(repo)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-semibold text-xs text-white group-hover:text-cyan-400 transition flex items-center space-x-1.5">
                        <Code className="h-3.5 w-3.5 text-slate-400" />
                        <span>{repo.name}</span>
                      </div>

                      {repo.private ? (
                        <span className="text-[10px] font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <Lock className="h-2.5 w-2.5" /> Private
                        </span>
                      ) : (
                        <span className="text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                          Public
                        </span>
                      )}
                    </div>

                    {repo.description && (
                      <p className="text-[11px] text-slate-400 line-clamp-2">{repo.description}</p>
                    )}

                    <div className="flex items-center justify-between pt-1 border-t border-slate-900 text-[10px] text-slate-500">
                      <span>{repo.language || 'Code'}</span>
                      <span className="text-cyan-400 group-hover:translate-x-1 transition flex items-center space-x-0.5 font-medium">
                        <span>Deploy This Repo</span>
                        <ChevronRight className="h-3 w-3" />
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* AI Copilot Drawer */}
      <AICopilotDrawer
        isOpen={showAiDrawer}
        onClose={() => setShowAiDrawer(false)}
        logs={logs}
        config={config}
      />

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 py-4 text-center text-xs text-slate-500 font-mono">
        AutoDeploy Console &copy; 2026 · Standalone Server Deployment & AI Agent Copilot
      </footer>
    </div>
  )
}
