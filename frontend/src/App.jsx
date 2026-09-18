import React, { useState, useEffect, useRef } from 'react'
import {
  Server, Terminal, ShieldCheck, Globe, Zap, Cpu, CheckCircle2,
  XCircle, AlertTriangle, Play, RefreshCw, Copy, Check, Lock, HardDrive, Code,
  Github, Search, X, ChevronRight, ChevronLeft, ChevronDown, Sparkles, FolderGit2, Bot, LogOut, UserCheck,
  Layers, Database, FolderTree, LayoutDashboard, Key, Activity, Clock, Webhook, Save, Trash2, DownloadCloud, Mail,
  Command, Sliders, CheckSquare, Menu, Maximize2, Minimize2, Filter, Info, ExternalLink, CreditCard, Users, Crown
} from 'lucide-react'
import AICopilotDrawer from './components/AICopilotDrawer'
import LoginPage from './components/LoginPage'
import SaaSAuthPages from './components/SaaSAuthPages'
import ServerSelectorDropdown from './components/ServerSelectorDropdown'
import ServerManager from './components/ServerManager'
import ProjectExplorer from './components/ProjectExplorer'
import DatabaseManager from './components/DatabaseManager'
import CodeStudio from './components/CodeStudio'
import EnvManager from './components/EnvManager'
import LogsTelemetryManager from './components/LogsTelemetryManager'
import DomainSSLManager from './components/DomainSSLManager'
import CronManager from './components/CronManager'
import WebhookManager from './components/WebhookManager'
import EmailManager from './components/EmailManager'
import BillingManager from './components/BillingManager'
import TeamManager from './components/TeamManager'
import AuditLogViewer from './components/AuditLogViewer'
import SuperAdminPortal from './components/SuperAdminPortal'

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
  const [activeTab, setActiveTab] = useState('deploy') // 'deploy' | 'servers' | 'projects' | 'databases' | 'code' | 'env' | 'logs' | 'ssl' | 'cron' | 'webhooks' | 'email'
  const [activeServer, setActiveServer] = useState({
    name: 'Production Server Node 01',
    host: '187.127.165.128',
    domain: 'automate-deployment.yjtechnosoft.com'
  })
  const [targetProjectInStudio, setTargetProjectInStudio] = useState('')
  const [lastPanelUpdate, setLastPanelUpdate] = useState('18 Sep 2026, 11:12 AM IST')

  // UI Layout States: Collapsible Sidebar & Command Palette
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [cmdSearchQuery, setCmdSearchQuery] = useState('')
  const [deploymentStep, setDeploymentStep] = useState(1) // 1-7 Guided Steps

  useEffect(() => {
    fetch('/api/health')
      .then(res => res.json())
      .then(data => {
        if (data && data.lastUpdated) {
          setLastPanelUpdate(data.lastUpdated)
        }
      })
      .catch(() => {})
  }, [])

  // Listen for ⌘K / Ctrl+K keyboard shortcut to open Command Palette
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setShowCommandPalette((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

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

  // Fetch user settings from server database after login/verification
  const loadUserSettings = async (token) => {
    if (!token) return
    try {
      const res = await fetch('/api/auth/settings', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        if (data.success && data.settings) {
          if (data.settings.githubToken) {
            setGithubToken(data.settings.githubToken)
          }
          setConfig((prev) => ({
            ...prev,
            ...data.settings
          }))
        }
      }
    } catch (e) {
      console.warn('Failed to load user settings from database:', e)
    }
  }

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
            await loadUserSettings(token)
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
    loadUserSettings(token)
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
  const [savingToken, setSavingToken] = useState(false)
  const [tokenSavedSuccess, setTokenSavedSuccess] = useState(false)
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
    setShowGithubDrawer(true)
    if (!tokenToUse) {
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
      } else {
        setRepoError(data.error || 'Failed to fetch repositories')
      }
    } catch (err) {
      setRepoError(err.message)
    } finally {
      setLoadingRepos(false)
    }
  }

  const handleSaveTokenToDatabase = async () => {
    setShowGithubDrawer(true)
    if (!githubToken || !githubToken.trim()) {
      setRepoError('Please enter a GitHub Personal Access Token before saving.')
      return
    }
    setSavingToken(true)
    setRepoError(null)
    setTokenSavedSuccess(false)
    try {
      const res = await fetch('/api/auth/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': jwtToken ? `Bearer ${jwtToken}` : ''
        },
        body: JSON.stringify({ githubToken: githubToken.trim() })
      })
      const data = await res.json()
      if (data.success) {
        setTokenSavedSuccess(true)
        setTimeout(() => setTokenSavedSuccess(false), 4000)
        handleFetchGithubRepos(githubToken.trim())
      } else {
        setRepoError(data.error || 'Failed to save token to database.')
      }
    } catch (err) {
      setRepoError(err.message)
    } finally {
      setSavingToken(false)
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

  // Duplicate Project Conflict Modal State
  const [duplicateConflictModal, setDuplicateConflictModal] = useState(null)
  const [checkingDuplicate, setCheckingDuplicate] = useState(false)

  const handleTriggerDeploy = async (forceOverwrite = false) => {
    if (!config.host || !config.domain) {
      alert('Please provide Server IP and Public Domain Name before deploying.')
      return
    }

    // Auto-advance stepper to live terminal step (Step 7)
    setDeploymentStep(7)

    if (!forceOverwrite) {
      setCheckingDuplicate(true)
      try {
        const checkRes = await fetch('/api/deploy/check-existing', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': jwtToken ? `Bearer ${jwtToken}` : ''
          },
          body: JSON.stringify(config)
        })
        const checkData = await checkRes.json()
        if (checkData.success && checkData.exists) {
          setDuplicateConflictModal(checkData)
          setCheckingDuplicate(false)
          return
        }
      } catch (e) {
        console.warn('Pre-deployment check error, proceeding:', e)
      } finally {
        setCheckingDuplicate(false)
      }
    }

    setDuplicateConflictModal(null)
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

  const handleDeleteDuplicateAndDeployFresh = async () => {
    if (!duplicateConflictModal) return
    const { appName, remoteDir, domain } = duplicateConflictModal
    setDuplicateConflictModal(null)
    setDeploying(true)
    setLogs([{ text: `[PRE-DEPLOY] Deleting existing duplicate project '${appName}' from live server...\n`, isError: false, step: 'INIT' }])

    try {
      const delRes = await fetch('/api/studio/projects/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': jwtToken ? `Bearer ${jwtToken}` : ''
        },
        body: JSON.stringify({
          host: config.host,
          port: config.port,
          username: config.username,
          password: config.password,
          appName,
          projectPath: remoteDir,
          domain,
          deletePm2: true,
          deleteFiles: true,
          deleteNginx: true
        })
      })
      const delData = await delRes.json()
      if (delData.success) {
        setLogs((prev) => [...prev, { text: `[PRE-DEPLOY] Duplicate project deleted successfully! Launching fresh deployment...\n`, isError: false, step: 'INIT' }])
        handleTriggerDeploy(true)
      } else {
        setDeploying(false)
        alert(`Failed to delete duplicate project: ${delData.error}`)
      }
    } catch (err) {
      setDeploying(false)
      alert(`Delete duplicate request failed: ${err.message}`)
    }
  }

  const handleUpdateExistingProjectFromModal = async () => {
    if (!duplicateConflictModal) return
    const { appName, remoteDir } = duplicateConflictModal
    setDuplicateConflictModal(null)
    setDeploying(true)
    setLogs([{ text: `[UPDATE] Triggering 1-Click Pull & Update for existing live project '${appName}'...\n`, isError: false, step: 'INIT' }])

    try {
      const updateRes = await fetch('/api/studio/git/pull-and-update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': jwtToken ? `Bearer ${jwtToken}` : ''
        },
        body: JSON.stringify({
          host: config.host,
          port: config.port,
          username: config.username,
          password: config.password,
          appName,
          projectPath: remoteDir,
          branch: 'main'
        })
      })
      const updateData = await updateRes.json()
      if (updateData.success) {
        setLogs((prev) => [...prev, { text: updateData.output || updateData.message, isError: false, step: 'END' }])
        setDeploySuccess(true)
      } else {
        setLogs((prev) => [...prev, { text: (updateData.error || 'Update failed') + '\n' + (updateData.output || ''), isError: true, step: 'END' }])
        setDeploySuccess(false)
      }
    } catch (err) {
      setDeploying(false)
      alert(`Update request failed: ${err.message}`)
    } finally {
      setDeploying(false)
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

  // Navigation Items Grouping
  const navSections = [
    {
      title: 'DEPLOYMENT',
      items: [
        { id: 'deploy', label: '1-Click Deploy', icon: Zap, badge: 'AUTO' },
        { id: 'projects', label: 'Projects & PM2', icon: Layers }
      ]
    },
    {
      title: 'INFRASTRUCTURE',
      items: [
        { id: 'servers', label: 'Server Nodes', icon: Server },
        { id: 'databases', label: 'Databases', icon: Database },
        { id: 'ssl', label: 'SSL & Domains', icon: Globe }
      ]
    },
    {
      title: 'DEVELOPMENT',
      items: [
        { id: 'code', label: 'Code Studio IDE', icon: FolderTree },
        { id: 'env', label: 'Environment (.env)', icon: Key }
      ]
    },
    {
      title: 'ORGANIZATION SAAS',
      items: [
        { id: 'billing', label: 'Billing & Quotas', icon: CreditCard },
        { id: 'team', label: 'Team & Roles', icon: Users },
        { id: 'audit-logs', label: 'Audit Trail Logs', icon: ShieldCheck },
        ...(currentUser?.id === 'admin-001' || currentUser?.role === 'admin'
          ? [{ id: 'admin', label: 'Super Admin Portal', icon: Crown, badge: 'SAAS' }]
          : [])
      ]
    },
    {
      title: 'MONITORING',
      items: [
        { id: 'logs', label: 'Logs & Telemetry', icon: Activity },
        { id: 'webhooks', label: 'Webhooks CI/CD', icon: Webhook },
        { id: 'cron', label: 'Cron Jobs', icon: Clock }
      ]
    },
    {
      title: 'COMMUNICATION',
      items: [
        { id: 'email', label: 'Domain Email Panel', icon: Mail }
      ]
    }
  ]

  // Command palette menu search options
  const commandOptions = [
    { id: 'deploy', title: 'Go to 1-Click Guided Deployment', category: 'Navigation', icon: Zap },
    { id: 'projects', title: 'Manage Active Projects & PM2 Processes', category: 'Navigation', icon: Layers },
    { id: 'servers', title: 'View Server Nodes & Connection History', category: 'Navigation', icon: Server },
    { id: 'databases', title: 'Database Manager (MySQL / PostgreSQL / Mongo)', category: 'Navigation', icon: Database },
    { id: 'code', title: 'Open Code Studio IDE & File Editor', category: 'Navigation', icon: FolderTree },
    { id: 'env', title: 'Manage Environment (.env) Variables', category: 'Navigation', icon: Key },
    { id: 'billing', title: 'SaaS Billing & Quotas', category: 'Organization', icon: CreditCard },
    { id: 'team', title: 'Manage Team Members & RBAC Roles', category: 'Organization', icon: Users },
    { id: 'audit-logs', title: 'View Organization Audit Trail Logs', category: 'Organization', icon: ShieldCheck },
    { id: 'admin', title: 'Super Admin Control Portal', category: 'Organization', icon: Crown },
    { id: 'logs', title: 'View System Logs & Performance Telemetry', category: 'Navigation', icon: Activity },
    { id: 'ssl', title: 'Manage SSL Certificates & Domain Routing', category: 'Navigation', icon: Globe },
    { id: 'cron', title: 'Configure Automated Cron Tasks', category: 'Navigation', icon: Clock },
    { id: 'webhooks', title: 'Webhooks CI/CD Automated Deployment', category: 'Navigation', icon: Webhook },
    { id: 'email', title: 'Domain Email Inbox & Mail Server Panel', category: 'Navigation', icon: Mail },
    { action: 'ssh_test', title: 'Run SSH Connection Pre-flight Check', category: 'Action', icon: RefreshCw },
    { action: 'scan_ports', title: 'Scan Target Server Open Ports', category: 'Action', icon: Cpu },
    { action: 'github', title: 'Open GitHub Repositories Panel', category: 'Action', icon: Github },
    { action: 'copilot', title: 'Open AI DevOps Copilot Assistant', category: 'Action', icon: Sparkles }
  ]

  const filteredCommandOptions = commandOptions.filter(opt =>
    opt.title.toLowerCase().includes(cmdSearchQuery.toLowerCase()) ||
    opt.category.toLowerCase().includes(cmdSearchQuery.toLowerCase())
  )

  const handleCommandSelect = (opt) => {
    setShowCommandPalette(false)
    setCmdSearchQuery('')
    if (opt.id) {
      setActiveTab(opt.id)
    } else if (opt.action === 'ssh_test') {
      setActiveTab('deploy')
      setDeploymentStep(1)
      handleTestSsh()
    } else if (opt.action === 'scan_ports') {
      setActiveTab('deploy')
      setDeploymentStep(3)
      handleScanPorts()
    } else if (opt.action === 'github') {
      setShowGithubDrawer(true)
      if (repos.length === 0 && githubToken) handleFetchGithubRepos()
    } else if (opt.action === 'copilot') {
      setShowAiDrawer(true)
    }
  }

  if (verifyingSession) {
    return (
      <div className="min-h-screen bg-[#07090E] flex flex-col items-center justify-center text-slate-100 font-sans">
        <div className="flex flex-col items-center gap-3">
          <div className="w-9 h-9 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-xs text-slate-400 font-mono tracking-wide">Verifying Admin Session...</p>
        </div>
      </div>
    )
  }

  if (!jwtToken || !currentUser) {
    return <SaaSAuthPages onAuthSuccess={(token, user) => handleLoginSuccess(user, token)} />
  }

  return (
    <div className="min-h-screen bg-[#07090E] text-slate-100 flex flex-col relative overflow-x-hidden font-sans selection:bg-cyan-500/30 selection:text-cyan-200">

      {/* Modern Compact Header with Command Search */}
      <header className="border-b border-white/10 bg-slate-950/80 backdrop-blur-2xl sticky top-0 z-40 shadow-xl shadow-slate-950/40">
        <div className="px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          {/* Left: Sidebar Toggle & Brand */}
          <div className="flex items-center space-x-3">
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="p-1.5 text-slate-400 hover:text-white bg-slate-900/80 hover:bg-slate-800 rounded-xl border border-white/10 transition cursor-pointer"
              title={sidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
            >
              <Menu className="w-4 h-4" />
            </button>

            <div className="flex items-center space-x-2.5">
              <div className="h-8 w-8 rounded-xl bg-gradient-to-tr from-cyan-500 via-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/25 ring-1 ring-white/20">
                <Zap className="h-4 w-4 text-white font-bold" />
              </div>
              <div className="flex items-center space-x-2">
                <span className="font-extrabold text-sm tracking-tight text-white bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">AutoDeploy</span>
                <span className="text-[9px] bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 px-2 py-0.5 rounded-full font-mono font-bold tracking-wider">v2.0 PRO</span>
              </div>
            </div>
          </div>

          {/* Center: Global Command Search (⌘K Trigger) */}
          <div className="flex-1 max-w-md hidden md:block">
            <button
              onClick={() => setShowCommandPalette(true)}
              className="w-full bg-slate-900/90 hover:bg-slate-900 border border-white/10 hover:border-cyan-500/40 rounded-xl px-3 py-1.5 text-xs text-slate-400 flex items-center justify-between transition shadow-inner group cursor-pointer"
            >
              <div className="flex items-center space-x-2 text-slate-400 group-hover:text-slate-300">
                <Search className="w-3.5 h-3.5 text-slate-400 group-hover:text-cyan-400" />
                <span className="font-mono text-[11px]">Search commands, servers, projects...</span>
              </div>
              <kbd className="bg-slate-950 border border-slate-800 text-slate-400 group-hover:text-cyan-300 text-[10px] font-mono px-2 py-0.5 rounded-md flex items-center gap-1 shadow-sm">
                <span>⌘</span><span>K</span>
              </kbd>
            </button>
          </div>

          {/* Right Header Actions */}
          <div className="flex items-center space-x-2.5">
            {/* Top Bar Server Selector Dropdown */}
            <ServerSelectorDropdown
              activeServerId={activeServer.id || 'srv-default'}
              onServerSelect={(srvId) => {
                setActiveServer((prev) => ({ ...prev, id: srvId }))
              }}
            />

            {/* AI Copilot Drawer Trigger */}
            <button
              onClick={() => setShowAiDrawer(true)}
              className="text-xs bg-gradient-to-r from-cyan-500/20 via-blue-500/20 to-indigo-500/20 hover:from-cyan-500/30 hover:to-indigo-500/30 text-cyan-300 border border-cyan-500/40 px-3 py-1.5 rounded-xl flex items-center space-x-1.5 transition shadow-md shadow-cyan-950/40 font-semibold cursor-pointer ring-1 ring-cyan-500/20"
            >
              <Sparkles className="h-3.5 w-3.5 text-cyan-400 animate-pulse" />
              <span className="hidden sm:inline">AI Copilot</span>
            </button>

            {/* GitHub Drawer Trigger */}
            <button
              onClick={() => {
                setShowGithubDrawer(true)
                if (repos.length === 0 && githubToken) handleFetchGithubRepos()
              }}
              className="text-xs bg-slate-900/80 hover:bg-slate-800 text-slate-200 border border-white/10 px-3 py-1.5 rounded-xl flex items-center space-x-1.5 transition shadow-sm cursor-pointer"
            >
              <Github className="h-3.5 w-3.5 text-white" />
              <span className="hidden sm:inline font-medium">GitHub</span>
            </button>

            {/* Preset Profile Trigger */}
            <button
              onClick={handlePresetServer}
              title="Reset config to default target server preset"
              className="text-xs bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-white/10 px-2.5 py-1.5 rounded-xl flex items-center space-x-1 transition cursor-pointer"
            >
              <Server className="h-3.5 w-3.5 text-cyan-400" />
              <span className="hidden lg:inline">Preset Profile</span>
            </button>

            {/* Logged in User Admin Badge & Logout */}
            <div className="flex items-center space-x-2 bg-slate-900/90 border border-white/10 rounded-xl px-2.5 py-1 shadow-inner">
              <div className="w-6 h-6 rounded-lg bg-gradient-to-tr from-cyan-400 to-blue-600 flex items-center justify-center text-slate-950 font-extrabold text-xs shadow-md ring-1 ring-white/30">
                {currentUser?.name ? currentUser.name.charAt(0) : 'A'}
              </div>
              <div className="hidden xl:block text-left leading-tight">
                <div className="text-[11px] font-semibold text-white flex items-center gap-1">
                  <span>{currentUser?.name || 'Admin'}</span>
                  <span className="text-[8px] px-1 py-0.2 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 font-mono font-bold">ADMIN</span>
                </div>
              </div>
              <button
                onClick={handleLogout}
                title="Sign Out"
                className="p-1 text-slate-400 hover:text-rose-400 hover:bg-rose-950/50 rounded-lg transition-colors cursor-pointer"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Operational Telemetry Thin Status Bar */}
      <div className="bg-slate-950/90 border-b border-white/10 text-[11px] font-mono py-1.5 px-4 sm:px-6 shadow-sm flex items-center justify-between overflow-x-auto text-slate-400">
        <div className="flex items-center space-x-6 min-w-max">
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-sm shadow-emerald-400/50"></span>
            <span className="text-slate-400">Target Node:</span>
            <span className="text-cyan-300 font-bold">{activeServer.name} ({activeServer.host})</span>
          </div>

          <div className="flex items-center space-x-2">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-slate-400">SSL Status:</span>
            <span className="text-emerald-300 font-bold">Auto Certbot Enabled</span>
          </div>

          <div className="flex items-center space-x-2">
            <Layers className="w-3.5 h-3.5 text-blue-400" />
            <span className="text-slate-400">PM2 Status:</span>
            <span className="text-blue-300 font-bold">Process #18 & #19 Online</span>
          </div>
        </div>

        <div className="flex items-center space-x-3 text-slate-400 min-w-max pl-4">
          <span className="bg-emerald-950/80 text-emerald-300 border border-emerald-800/80 px-2 py-0.5 rounded-lg flex items-center gap-1.5 font-bold text-[10px]">
            <Clock className="w-3 h-3 text-emerald-400" />
            UPDATED: {lastPanelUpdate}
          </span>
        </div>
      </div>

      {/* Main Body with Collapsible Sidebar & Workspace */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* Collapsible Left Sidebar */}
        <aside
          className={`bg-slate-950/80 border-r border-white/10 backdrop-blur-xl flex flex-col justify-between transition-all duration-300 z-30 select-none ${
            sidebarCollapsed ? 'w-16' : 'w-64'
          }`}
        >
          {/* Navigation Links */}
          <div className="p-3 space-y-6 overflow-y-auto">
            {navSections.map((section, idx) => (
              <div key={idx} className="space-y-1">
                {!sidebarCollapsed && (
                  <div className="px-3 text-[10px] font-mono font-bold text-slate-500 tracking-wider uppercase mb-1.5">
                    {section.title}
                  </div>
                )}
                {section.items.map((item) => {
                  const Icon = item.icon
                  const isActive = activeTab === item.id
                  return (
                    <button
                      key={item.id}
                      onClick={() => setActiveTab(item.id)}
                      title={sidebarCollapsed ? item.label : undefined}
                      className={`w-full flex items-center ${
                        sidebarCollapsed ? 'justify-center px-2 py-2.5' : 'justify-between px-3 py-2'
                      } rounded-xl text-xs transition-all duration-200 cursor-pointer ${
                        isActive
                          ? 'bg-gradient-to-r from-cyan-600/90 via-blue-600/90 to-indigo-600/90 text-white font-bold shadow-lg shadow-cyan-500/20 ring-1 ring-white/20'
                          : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/80'
                      }`}
                    >
                      <div className="flex items-center space-x-2.5">
                        <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                        {!sidebarCollapsed && <span className="font-medium">{item.label}</span>}
                      </div>

                      {!sidebarCollapsed && item.badge && (
                        <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 font-bold">
                          {item.badge}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>

          {/* Sidebar Footer Collapse Toggle */}
          <div className="p-3 border-t border-white/10 bg-slate-950/90">
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="w-full flex items-center justify-center p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-900 border border-white/5 transition cursor-pointer text-xs font-mono"
            >
              {sidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <div className="flex items-center gap-2"><ChevronLeft className="w-4 h-4" /> Collapse Navigation</div>}
            </button>
          </div>
        </aside>

        {/* Central Workspace Area */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 space-y-6">

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

          {activeTab === 'env' && (
            <EnvManager jwtToken={jwtToken} />
          )}

          {activeTab === 'logs' && (
            <LogsTelemetryManager jwtToken={jwtToken} />
          )}

          {activeTab === 'ssl' && (
            <DomainSSLManager jwtToken={jwtToken} />
          )}

          {activeTab === 'cron' && (
            <CronManager jwtToken={jwtToken} />
          )}

          {activeTab === 'webhooks' && (
            <WebhookManager jwtToken={jwtToken} />
          )}

          {activeTab === 'email' && (
            <EmailManager jwtToken={jwtToken} activeServer={activeServer} />
          )}

          {activeTab === 'billing' && (
            <BillingManager />
          )}

          {activeTab === 'team' && (
            <TeamManager />
          )}

          {activeTab === 'audit-logs' && (
            <AuditLogViewer />
          )}

          {activeTab === 'admin' && (
            <SuperAdminPortal />
          )}

          {activeTab === 'deploy' && (
            <div className="space-y-6">
              
              {/* Workspace Header Banner */}
              <div className="bg-slate-900/60 backdrop-blur-2xl border border-white/10 rounded-3xl p-6 shadow-2xl shadow-slate-950/50 relative overflow-hidden">
                <div className="absolute top-0 right-0 -mt-8 -mr-8 w-64 h-64 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none"></div>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
                  <div>
                    <h1 className="text-xl font-extrabold text-white flex items-center gap-2">
                      Deploy Software to Public Server & Domain
                    </h1>
                    <p className="text-xs text-slate-400 mt-1 max-w-2xl font-mono">
                      Guided 7-step deployment engine with automatic Let's Encrypt SSL, non-conflicting port scanning, and AI Agent Copilot error resolution.
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setShowAiDrawer(true)}
                      className="bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/40 text-xs px-4 py-2.5 rounded-2xl font-bold flex items-center space-x-2 transition shadow-md shadow-cyan-950/40 cursor-pointer"
                    >
                      <Sparkles className="h-4 w-4 text-cyan-400 animate-pulse" />
                      <span>Open AI Copilot</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* 7-Step Guided Stepper Bar */}
              <div className="bg-slate-950/80 border border-white/10 rounded-2xl p-3 shadow-xl overflow-x-auto">
                <div className="flex items-center min-w-max justify-between space-x-2 text-xs font-mono">
                  {[
                    { num: 1, name: 'Server Connection', icon: Server },
                    { num: 2, name: 'Repository', icon: Code },
                    { num: 3, name: 'App & Port Scan', icon: Cpu },
                    { num: 4, name: 'Domain & SSL', icon: Globe },
                    { num: 5, name: 'Environment', icon: Key },
                    { num: 6, name: 'Review', icon: CheckSquare },
                    { num: 7, name: 'Live Execution', icon: Terminal },
                  ].map((st, idx) => {
                    const StepIcon = st.icon
                    const isActiveStep = deploymentStep === st.num
                    const isPassedStep = deploymentStep > st.num
                    return (
                      <React.Fragment key={st.num}>
                        <button
                          onClick={() => setDeploymentStep(st.num)}
                          className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl transition-all duration-200 cursor-pointer ${
                            isActiveStep
                              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 font-bold shadow-md shadow-cyan-950/50'
                              : isPassedStep
                              ? 'bg-slate-900/80 text-emerald-400 border border-emerald-500/30'
                              : 'bg-slate-900/40 text-slate-500 border border-white/5 hover:text-slate-300'
                          }`}
                        >
                          <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                            isActiveStep ? 'bg-cyan-500 text-slate-950' : isPassedStep ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-400'
                          }`}>
                            {isPassedStep ? <Check className="w-3 h-3" /> : st.num}
                          </div>
                          <span className="whitespace-nowrap">{st.name}</span>
                        </button>
                        {idx < 6 && <ChevronRight className="w-4 h-4 text-slate-700 shrink-0" />}
                      </React.Fragment>
                    )
                  })}
                </div>
              </div>

              {/* Step 1: Server Connection (SSH) */}
              {deploymentStep === 1 && (
                <div className="bg-slate-900/60 backdrop-blur-2xl border border-white/10 rounded-3xl p-6 space-y-6 shadow-2xl shadow-slate-950/50 animate-in fade-in duration-200">
                  <div className="flex items-center justify-between border-b border-white/10 pb-4">
                    <div className="flex items-center space-x-3.5">
                      <div className="p-2.5 rounded-2xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 ring-1 ring-cyan-500/20">
                        <Server className="h-5 w-5" />
                      </div>
                      <div>
                        <h2 className="font-extrabold text-white text-sm">Step 1: Server Connection & SSH Credentials</h2>
                        <p className="text-[11px] text-slate-400 font-mono">Configure SSH authentication for target Linux deployment node</p>
                      </div>
                    </div>

                    <button
                      onClick={handleTestSsh}
                      disabled={testingSsh}
                      className="text-xs bg-slate-800/80 hover:bg-slate-700/80 disabled:opacity-50 text-cyan-300 border border-white/10 px-4 py-2 rounded-xl flex items-center space-x-1.5 transition font-semibold cursor-pointer"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${testingSsh ? 'animate-spin' : ''}`} />
                      <span>{testingSsh ? 'Testing Connection...' : 'Test SSH Connection'}</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="sm:col-span-2 space-y-1.5">
                      <label className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest">Server IP Address</label>
                      <input
                        type="text"
                        value={config.host}
                        onChange={(e) => handleInputChange('host', e.target.value)}
                        placeholder="e.g. 187.127.165.128"
                        className="w-full bg-slate-950/90 border border-white/10 rounded-2xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-cyan-400 shadow-inner"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest">SSH Port</label>
                      <input
                        type="text"
                        value={config.port}
                        onChange={(e) => handleInputChange('port', e.target.value)}
                        placeholder="22"
                        className="w-full bg-slate-950/90 border border-white/10 rounded-2xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-cyan-400 shadow-inner"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest">SSH Username</label>
                      <input
                        type="text"
                        value={config.username}
                        onChange={(e) => handleInputChange('username', e.target.value)}
                        placeholder="root"
                        className="w-full bg-slate-950/90 border border-white/10 rounded-2xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-cyan-400 shadow-inner"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest">SSH Password</label>
                      <input
                        type="password"
                        value={config.password}
                        onChange={(e) => handleInputChange('password', e.target.value)}
                        placeholder="••••••••"
                        className="w-full bg-slate-950/90 border border-white/10 rounded-2xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-cyan-400 shadow-inner"
                      />
                    </div>
                  </div>

                  {sshStatus && (
                    <div
                      className={`p-4 rounded-2xl border text-xs font-mono space-y-1 shadow-inner ${
                        sshStatus.type === 'success'
                          ? 'bg-emerald-950/80 border-emerald-800/80 text-emerald-300'
                          : 'bg-rose-950/80 border-rose-800/80 text-rose-300'
                      }`}
                    >
                      <div className="flex items-center space-x-2 font-bold">
                        {sshStatus.type === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                        <span>{sshStatus.message}</span>
                      </div>
                      {sshStatus.details && <p className="text-[11px] opacity-80 whitespace-pre-wrap mt-1">{sshStatus.details}</p>}
                    </div>
                  )}

                  <div className="flex justify-end pt-2">
                    <button
                      onClick={() => setDeploymentStep(2)}
                      className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold px-6 py-2.5 rounded-xl text-xs flex items-center space-x-2 transition cursor-pointer shadow-lg shadow-cyan-500/20"
                    >
                      <span>Proceed to Step 2: Repository</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* Step 2: Repository */}
              {deploymentStep === 2 && (
                <div className="bg-slate-900/60 backdrop-blur-2xl border border-white/10 rounded-3xl p-6 space-y-6 shadow-2xl shadow-slate-950/50 animate-in fade-in duration-200">
                  <div className="flex items-center justify-between border-b border-white/10 pb-4">
                    <div className="flex items-center space-x-3.5">
                      <div className="p-2.5 rounded-2xl bg-blue-500/10 text-blue-400 border border-blue-500/30 ring-1 ring-blue-500/20">
                        <Code className="h-5 w-5" />
                      </div>
                      <div>
                        <h2 className="font-extrabold text-white text-sm">Step 2: Source Repository Configuration</h2>
                        <p className="text-[11px] text-slate-400 font-mono">Specify Git Repository clone URL or pick from GitHub account</p>
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        setShowGithubDrawer(true)
                        if (repos.length === 0 && githubToken) handleFetchGithubRepos()
                      }}
                      className="text-xs bg-slate-800/80 hover:bg-slate-700/80 text-cyan-300 border border-white/10 px-4 py-2 rounded-xl flex items-center space-x-1.5 transition font-semibold cursor-pointer"
                    >
                      <Github className="h-3.5 w-3.5 text-cyan-400" />
                      <span>Select From GitHub Repos</span>
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest">Git Repository Clone URL</label>
                    <div className="relative">
                      <input
                        type="text"
                        value={config.gitRepoUrl}
                        onChange={(e) => handleInputChange('gitRepoUrl', e.target.value)}
                        placeholder="https://github.com/username/repository.git"
                        className="w-full bg-slate-950/90 border border-white/10 rounded-2xl pl-9 pr-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-cyan-400 shadow-inner"
                      />
                      <Code className="h-4 w-4 text-slate-500 absolute left-3 top-3" />
                    </div>
                  </div>

                  <div className="flex justify-between pt-2">
                    <button
                      onClick={() => setDeploymentStep(1)}
                      className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold px-5 py-2.5 rounded-xl text-xs flex items-center space-x-1.5 transition cursor-pointer"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      <span>Back to Server</span>
                    </button>

                    <button
                      onClick={() => setDeploymentStep(3)}
                      className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold px-6 py-2.5 rounded-xl text-xs flex items-center space-x-2 transition cursor-pointer shadow-lg shadow-cyan-500/20"
                    >
                      <span>Proceed to Step 3: App & Port</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* Step 3: Application & Port Scan */}
              {deploymentStep === 3 && (
                <div className="bg-slate-900/60 backdrop-blur-2xl border border-white/10 rounded-3xl p-6 space-y-6 shadow-2xl shadow-slate-950/50 animate-in fade-in duration-200">
                  <div className="flex items-center justify-between border-b border-white/10 pb-4">
                    <div className="flex items-center space-x-3.5">
                      <div className="p-2.5 rounded-2xl bg-amber-500/10 text-amber-400 border border-amber-500/30 ring-1 ring-amber-500/20">
                        <Cpu className="h-5 w-5" />
                      </div>
                      <div>
                        <h2 className="font-extrabold text-white text-sm">Step 3: Target App Directory & Non-Conflicting Port Inspection</h2>
                        <p className="text-[11px] text-slate-400 font-mono">Scan active Linux ports and ensure existing PM2 apps are protected</p>
                      </div>
                    </div>

                    <button
                      onClick={handleScanPorts}
                      disabled={scanningPorts}
                      className="text-xs bg-slate-800/80 hover:bg-slate-700/80 disabled:opacity-50 text-amber-300 border border-white/10 px-4 py-2 rounded-xl flex items-center space-x-1.5 transition font-semibold cursor-pointer"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${scanningPorts ? 'animate-spin' : ''}`} />
                      <span>{scanningPorts ? 'Scanning Server...' : 'Scan Active Ports & PM2'}</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest">Remote Server App Directory</label>
                      <input
                        type="text"
                        value={config.remoteDir}
                        onChange={(e) => handleInputChange('remoteDir', e.target.value)}
                        placeholder="/var/www/my-app"
                        className="w-full bg-slate-950/90 border border-white/10 rounded-2xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-cyan-400 shadow-inner"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest">PM2 Process Name</label>
                      <input
                        type="text"
                        value={config.appName}
                        onChange={(e) => handleInputChange('appName', e.target.value)}
                        placeholder="my-app-backend"
                        className="w-full bg-slate-950/90 border border-white/10 rounded-2xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-cyan-400 shadow-inner"
                      />
                    </div>
                  </div>

                  {scanResult ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                      <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-2">
                        <div className="text-xs font-semibold text-slate-400 flex items-center justify-between">
                          <span>Suggested Backend Port</span>
                          <ShieldCheck className="h-4 w-4 text-emerald-400" />
                        </div>
                        <div className="text-2xl font-bold font-mono text-emerald-400">
                          {scanResult.suggestedPort}
                        </div>
                        <p className="text-[11px] text-slate-500">Unused port assigned automatically to prevent conflicts.</p>
                      </div>

                      <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-2">
                        <div className="text-xs font-semibold text-slate-400">Active PM2 Services</div>
                        <div className="space-y-1.5 max-h-24 overflow-y-auto">
                          {scanResult.pm2Apps && scanResult.pm2Apps.length > 0 ? (
                            scanResult.pm2Apps.map((app) => (
                              <div key={app.id} className="flex items-center justify-between text-xs font-mono bg-slate-900 px-2.5 py-1 rounded-lg">
                                <span className="text-slate-300 font-semibold">{app.name}</span>
                                <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">{app.status}</span>
                              </div>
                            ))
                          ) : (
                            <span className="text-xs text-slate-500">No active PM2 apps found</span>
                          )}
                        </div>
                      </div>

                      <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-2">
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
                    <div className="bg-slate-950/50 p-4 rounded-2xl border border-dashed border-slate-800 text-center text-xs text-slate-500">
                      Click <strong className="text-amber-400 font-semibold">"Scan Active Ports & PM2"</strong> to detect used ports and assign an open port automatically.
                    </div>
                  )}

                  <div className="flex justify-between pt-2">
                    <button
                      onClick={() => setDeploymentStep(2)}
                      className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold px-5 py-2.5 rounded-xl text-xs flex items-center space-x-1.5 transition cursor-pointer"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      <span>Back to Repo</span>
                    </button>

                    <button
                      onClick={() => setDeploymentStep(4)}
                      className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold px-6 py-2.5 rounded-xl text-xs flex items-center space-x-2 transition cursor-pointer shadow-lg shadow-cyan-500/20"
                    >
                      <span>Proceed to Step 4: Domain & SSL</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* Step 4: Domain & SSL */}
              {deploymentStep === 4 && (
                <div className="bg-slate-900/60 backdrop-blur-2xl border border-white/10 rounded-3xl p-6 space-y-6 shadow-2xl shadow-slate-950/50 animate-in fade-in duration-200">
                  <div className="flex items-center justify-between border-b border-white/10 pb-4">
                    <div className="flex items-center space-x-3.5">
                      <div className="p-2.5 rounded-2xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 ring-1 ring-indigo-500/20">
                        <Globe className="h-5 w-5" />
                      </div>
                      <div>
                        <h2 className="font-extrabold text-white text-sm">Step 4: Public Domain Routing & Let's Encrypt SSL</h2>
                        <p className="text-[11px] text-slate-400 font-mono">Configure Nginx reverse proxy and HTTPS certificate provisioning</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest flex items-center justify-between">
                      <span>Target Public Domain Name</span>
                      <span className="text-[9px] text-cyan-300 bg-cyan-950/80 border border-cyan-800 px-2 py-0.5 rounded-full font-bold">Nginx Reverse Proxy</span>
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        value={config.domain}
                        onChange={(e) => handleInputChange('domain', e.target.value)}
                        placeholder="e.g. tip-crm.yjtechnosoft.com"
                        className="w-full bg-slate-950/90 border border-white/10 rounded-2xl pl-9 pr-3.5 py-2.5 text-xs text-cyan-300 font-mono focus:outline-none focus:border-cyan-400 shadow-inner font-semibold"
                      />
                      <Globe className="h-4 w-4 text-slate-500 absolute left-3 top-3" />
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-4 bg-slate-950/90 border border-white/10 rounded-2xl">
                    <label className="flex items-center space-x-3 text-xs text-slate-200 cursor-pointer font-mono">
                      <input
                        type="checkbox"
                        checked={config.setupSsl}
                        onChange={(e) => handleInputChange('setupSsl', e.target.checked)}
                        className="w-4 h-4 rounded border-white/10 text-cyan-500 focus:ring-cyan-500 bg-slate-950 cursor-pointer"
                      />
                      <span>Auto-provision SSL Certificate (Certbot Let's Encrypt HTTPS)</span>
                    </label>

                    <div className="flex items-center space-x-1.5 text-xs text-slate-400 font-mono">
                      <span>Assigned Backend Port:</span>
                      <span className="font-mono text-cyan-300 font-bold">{config.backendPort}</span>
                    </div>
                  </div>

                  <div className="flex justify-between pt-2">
                    <button
                      onClick={() => setDeploymentStep(3)}
                      className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold px-5 py-2.5 rounded-xl text-xs flex items-center space-x-1.5 transition cursor-pointer"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      <span>Back to App & Port</span>
                    </button>

                    <button
                      onClick={() => setDeploymentStep(5)}
                      className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold px-6 py-2.5 rounded-xl text-xs flex items-center space-x-2 transition cursor-pointer shadow-lg shadow-cyan-500/20"
                    >
                      <span>Proceed to Step 5: Environment</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* Step 5: Environment Variables */}
              {deploymentStep === 5 && (
                <div className="bg-slate-900/60 backdrop-blur-2xl border border-white/10 rounded-3xl p-6 space-y-6 shadow-2xl shadow-slate-950/50 animate-in fade-in duration-200">
                  <div className="flex items-center justify-between border-b border-white/10 pb-4">
                    <div className="flex items-center space-x-3.5">
                      <div className="p-2.5 rounded-2xl bg-amber-500/10 text-amber-400 border border-amber-500/30 ring-1 ring-amber-500/20">
                        <Key className="h-5 w-5" />
                      </div>
                      <div>
                        <h2 className="font-extrabold text-white text-sm">Step 5: Environment (.env) Variables</h2>
                        <p className="text-[11px] text-slate-400 font-mono">Pre-configure environment variables for the deployed application</p>
                      </div>
                    </div>

                    <button
                      onClick={() => setActiveTab('env')}
                      className="text-xs bg-slate-800/80 hover:bg-slate-700/80 text-amber-300 border border-white/10 px-3.5 py-1.5 rounded-xl flex items-center space-x-1.5 transition font-semibold cursor-pointer"
                    >
                      <Key className="h-3.5 w-3.5 text-amber-400" />
                      <span>Open Full Environment Manager</span>
                    </button>
                  </div>

                  <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-2xl space-y-3 font-mono text-xs">
                    <div className="text-slate-400 flex items-center justify-between">
                      <span>Default Deployment Environment Parameters:</span>
                      <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">PORT={config.backendPort}</span>
                    </div>
                    <div className="p-3 bg-slate-900/90 rounded-xl border border-white/5 text-slate-300 text-[11px] space-y-1">
                      <div>PORT={config.backendPort}</div>
                      <div>NODE_ENV=production</div>
                      <div>DOMAIN=https://{config.domain}</div>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      You can add custom database URIs and secret keys in the dedicated Environment tab at any time.
                    </p>
                  </div>

                  <div className="flex justify-between pt-2">
                    <button
                      onClick={() => setDeploymentStep(4)}
                      className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold px-5 py-2.5 rounded-xl text-xs flex items-center space-x-1.5 transition cursor-pointer"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      <span>Back to Domain & SSL</span>
                    </button>

                    <button
                      onClick={() => setDeploymentStep(6)}
                      className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold px-6 py-2.5 rounded-xl text-xs flex items-center space-x-2 transition cursor-pointer shadow-lg shadow-cyan-500/20"
                    >
                      <span>Proceed to Step 6: Review</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* Step 6: Review & Summary */}
              {deploymentStep === 6 && (
                <div className="bg-slate-900/60 backdrop-blur-2xl border border-white/10 rounded-3xl p-6 space-y-6 shadow-2xl shadow-slate-950/50 animate-in fade-in duration-200">
                  <div className="flex items-center justify-between border-b border-white/10 pb-4">
                    <div className="flex items-center space-x-3.5">
                      <div className="p-2.5 rounded-2xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 ring-1 ring-emerald-500/20">
                        <CheckSquare className="h-5 w-5" />
                      </div>
                      <div>
                        <h2 className="font-extrabold text-white text-sm">Step 6: Deployment Pre-flight Summary & Verification</h2>
                        <p className="text-[11px] text-slate-400 font-mono">Verify target node parameters before executing deployment workflow</p>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-slate-950 p-4 rounded-2xl border border-white/10 space-y-2.5 font-mono text-xs">
                      <div className="text-slate-400 font-bold uppercase text-[10px] tracking-wider text-cyan-400 border-b border-slate-800 pb-1.5">
                        Server & Infrastructure
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Host IP:</span>
                        <span className="text-white font-semibold">{config.host}:{config.port}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">SSH User:</span>
                        <span className="text-white">{config.username}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Assigned Port:</span>
                        <span className="text-emerald-400 font-bold">:{config.backendPort}</span>
                      </div>
                    </div>

                    <div className="bg-slate-950 p-4 rounded-2xl border border-white/10 space-y-2.5 font-mono text-xs">
                      <div className="text-slate-400 font-bold uppercase text-[10px] tracking-wider text-blue-400 border-b border-slate-800 pb-1.5">
                        Domain & Application
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Domain:</span>
                        <span className="text-cyan-300 font-semibold">{config.domain}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">PM2 Process:</span>
                        <span className="text-white">{config.appName}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Auto SSL:</span>
                        <span className="text-emerald-400 font-bold">{config.setupSsl ? 'Enabled (Certbot)' : 'Disabled'}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-between pt-4">
                    <button
                      onClick={() => setDeploymentStep(5)}
                      className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold px-5 py-2.5 rounded-xl text-xs flex items-center space-x-1.5 transition cursor-pointer"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      <span>Back to Environment</span>
                    </button>

                    <button
                      onClick={() => handleTriggerDeploy()}
                      disabled={deploying || checkingDuplicate}
                      className="bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-slate-950 font-extrabold px-8 py-3 rounded-2xl text-xs flex items-center space-x-2 transition shadow-xl shadow-cyan-500/25 cursor-pointer"
                    >
                      <Play className="w-4 h-4 fill-current text-slate-950" />
                      <span>🚀 Launch Automated Deployment to {config.domain}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Step 7: Deploy & Live Terminal */}
              {deploymentStep === 7 && (
                <div className="space-y-4 animate-in fade-in duration-200">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center space-x-3">
                      <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        <Terminal className="h-5 w-5" />
                      </div>
                      <div>
                        <h2 className="font-extrabold text-white text-sm">Step 7: Live Execution Terminal</h2>
                        <p className="text-xs text-slate-400 font-mono">Watch real-time SSH output during automated deployment</p>
                      </div>
                    </div>

                    <button
                      onClick={() => handleTriggerDeploy()}
                      disabled={deploying || checkingDuplicate}
                      className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50 text-slate-950 font-bold px-6 py-2.5 rounded-xl shadow-lg shadow-cyan-500/20 flex items-center justify-center space-x-2 transition text-xs cursor-pointer"
                    >
                      {deploying || checkingDuplicate ? (
                        <>
                          <RefreshCw className="h-4 w-4 animate-spin text-slate-950" />
                          <span>{checkingDuplicate ? 'Checking duplicates...' : `Deploying to ${config.domain}...`}</span>
                        </>
                      ) : (
                        <>
                          <Play className="h-4 w-4 text-slate-950 fill-current" />
                          <span>Launch Deployment</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Terminal Box */}
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
                        <button
                          onClick={() => setShowAiDrawer(true)}
                          className="text-[11px] bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 px-2.5 py-1 rounded-lg flex items-center space-x-1 transition font-semibold cursor-pointer"
                        >
                          <Sparkles className="h-3 w-3 text-cyan-400" />
                          <span>Auto-Fix with AI Agent</span>
                        </button>

                        <button
                          onClick={handleCopyLogs}
                          disabled={logs.length === 0}
                          className="text-[11px] text-slate-400 hover:text-white border border-slate-800 hover:border-slate-700 bg-slate-950 px-2.5 py-1 rounded-lg flex items-center space-x-1 transition disabled:opacity-40 cursor-pointer"
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
                          <p className="text-xs">Terminal ready. Click "Launch Deployment" above to start live stream.</p>
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
                          className="text-rose-400 hover:text-rose-300 font-semibold flex items-center space-x-1 animate-pulse cursor-pointer"
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
              )}

            </div>
          )}

        </main>
      </div>

      {/* Command Palette (⌘K) Modal */}
      {showCommandPalette && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-start justify-center pt-20 p-4">
          <div className="bg-slate-900 border border-slate-700/80 rounded-2xl max-w-xl w-full overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-150">
            <div className="p-3 border-b border-slate-800 flex items-center gap-2 bg-slate-950">
              <Search className="w-4 h-4 text-cyan-400 ml-2" />
              <input
                type="text"
                autoFocus
                value={cmdSearchQuery}
                onChange={(e) => setCmdSearchQuery(e.target.value)}
                placeholder="Type a command or view name..."
                className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none font-mono"
              />
              <button
                onClick={() => setShowCommandPalette(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="max-h-80 overflow-y-auto p-2 space-y-1">
              {filteredCommandOptions.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500 font-mono">
                  No matching commands found.
                </div>
              ) : (
                filteredCommandOptions.map((opt, idx) => {
                  const OptIcon = opt.icon
                  return (
                    <button
                      key={idx}
                      onClick={() => handleCommandSelect(opt)}
                      className="w-full text-left flex items-center justify-between p-2.5 rounded-xl hover:bg-slate-800 transition cursor-pointer group"
                    >
                      <div className="flex items-center space-x-3">
                        <div className="p-2 rounded-lg bg-slate-950 text-cyan-400 border border-white/5 group-hover:border-cyan-500/30">
                          <OptIcon className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-slate-200 group-hover:text-white">{opt.title}</div>
                          <div className="text-[10px] text-slate-500 font-mono">{opt.category}</div>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-cyan-400 group-hover:translate-x-0.5 transition" />
                    </button>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}

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
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Token Connection Box */}
            <div className="p-4 border-b border-slate-800 bg-slate-950/60 space-y-2.5">
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
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="password"
                  value={githubToken}
                  onChange={(e) => setGithubToken(e.target.value)}
                  placeholder="Paste GitHub Personal Access Token..."
                  className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs font-mono text-cyan-300 focus:outline-none focus:border-cyan-500"
                />
                <div className="flex gap-1.5">
                  <button
                    onClick={handleSaveTokenToDatabase}
                    disabled={savingToken}
                    className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold px-3 py-1.5 rounded-lg text-xs flex items-center space-x-1 transition cursor-pointer shadow-sm"
                    title="Save token persistently to backend database for logged-in user"
                  >
                    {savingToken ? (
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    <span>{savingToken ? 'Saving...' : 'Save Token'}</span>
                  </button>

                  <button
                    onClick={() => handleFetchGithubRepos(githubToken)}
                    disabled={loadingRepos}
                    className="bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-semibold px-3 py-1.5 rounded-lg text-xs flex items-center space-x-1 transition cursor-pointer shadow-sm"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${loadingRepos ? 'animate-spin' : ''}`} />
                    <span>Fetch Repos</span>
                  </button>
                </div>
              </div>

              {tokenSavedSuccess && (
                <div className="flex items-center space-x-1.5 text-[11px] font-mono text-emerald-400 bg-emerald-950/80 border border-emerald-800/80 px-2.5 py-1 rounded-lg">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Token saved to user database successfully!</span>
                </div>
              )}
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

      {/* Duplicate Project Conflict Resolution Modal */}
      {duplicateConflictModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700/80 rounded-2xl max-w-xl w-full p-6 space-y-5 shadow-2xl shadow-cyan-950/50 animate-in fade-in zoom-in duration-200">
            {/* Modal Header */}
            <div className="flex items-start justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
                  <AlertTriangle className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    Duplicate Project Detected on Live Server
                  </h3>
                  <p className="text-xs text-slate-400 font-mono">
                    Host: <span className="text-cyan-400 font-semibold">{config.host}</span> | Domain: <span className="text-cyan-400 font-semibold">{duplicateConflictModal.domain}</span>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setDuplicateConflictModal(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Warning Message Box */}
            <div className="bg-amber-950/30 border border-amber-500/30 rounded-xl p-4 space-y-2">
              <p className="text-xs text-amber-200 font-medium">
                The target project or domain already exists on your live server. Proceeding directly will overwrite or cause conflicts with existing running services.
              </p>
              {duplicateConflictModal.reasons && duplicateConflictModal.reasons.length > 0 && (
                <ul className="space-y-1 pt-1">
                  {duplicateConflictModal.reasons.map((reason, idx) => (
                    <li key={idx} className="text-[11px] text-amber-300/90 font-mono flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-400"></span>
                      <span>{reason}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Details Grid */}
            <div className="grid grid-cols-3 gap-2 bg-slate-950 p-3 rounded-xl border border-slate-800 text-xs">
              <div className="space-y-1">
                <div className="text-[10px] text-slate-500 uppercase font-mono">Directory</div>
                <div className="font-mono text-slate-300 font-semibold truncate" title={duplicateConflictModal.remoteDir}>
                  {duplicateConflictModal.details?.directoryExists ? '📁 Exists' : '❌ Not Found'}
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] text-slate-500 uppercase font-mono">PM2 Service</div>
                <div className="font-mono text-slate-300 font-semibold">
                  {duplicateConflictModal.details?.pm2Exists ? `⚡ ${duplicateConflictModal.details.pm2Status || 'Active'}` : '❌ Not Found'}
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] text-slate-500 uppercase font-mono">Nginx Config</div>
                <div className="font-mono text-slate-300 font-semibold">
                  {duplicateConflictModal.details?.nginxConfigExists ? '🌐 Configured' : '❌ Not Found'}
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="space-y-2.5 pt-2">
              <div className="text-xs font-semibold text-slate-300">Choose how to proceed:</div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  onClick={handleDeleteDuplicateAndDeployFresh}
                  className="w-full bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/40 p-3 rounded-xl font-medium text-xs flex flex-col items-start space-y-1 transition group cursor-pointer"
                >
                  <div className="flex items-center space-x-1.5 font-semibold text-rose-400 group-hover:text-rose-200">
                    <Trash2 className="h-4 w-4" />
                    <span>Delete Duplicate & Deploy Fresh</span>
                  </div>
                  <span className="text-[10px] text-rose-300/70 font-mono text-left">
                    Removes old directory, PM2 service & Nginx config, then executes full clean deployment.
                  </span>
                </button>

                <button
                  onClick={handleUpdateExistingProjectFromModal}
                  className="w-full bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/40 p-3 rounded-xl font-medium text-xs flex flex-col items-start space-y-1 transition group cursor-pointer"
                >
                  <div className="flex items-center space-x-1.5 font-semibold text-cyan-400 group-hover:text-cyan-200">
                    <RefreshCw className="h-4 w-4" />
                    <span>Pull Latest Changes & Update</span>
                  </div>
                  <span className="text-[10px] text-cyan-300/70 font-mono text-left">
                    Runs git pull, npm install/build, and reloads active PM2 service on live server.
                  </span>
                </button>
              </div>

              <div className="pt-2 text-right">
                <button
                  onClick={() => setDuplicateConflictModal(null)}
                  className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-xl font-medium transition cursor-pointer"
                >
                  Cancel
                </button>
              </div>
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
      <footer className="border-t border-slate-900 bg-slate-950 py-3 text-center text-xs text-slate-500 font-mono flex flex-col items-center justify-center gap-1">
        <div>AutoDeploy Console &copy; 2026 · Autonomous Cloud Deploy & Multi-Model AI Agent IDE</div>
        <div className="text-[10px] text-emerald-400 font-bold flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5" />
          <span>Last Live Panel Build & Server Update: {lastPanelUpdate}</span>
        </div>
      </footer>
    </div>
  )
}
