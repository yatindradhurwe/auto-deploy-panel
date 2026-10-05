import React, { useState, useEffect } from 'react'
import {
  Server, Terminal, ShieldCheck, Globe, Zap, Cpu, CheckCircle2,
  XCircle, AlertTriangle, Play, RefreshCw, Copy, Check, Lock, HardDrive, Code,
  Github, Search, X, ChevronRight, ChevronLeft, ChevronDown, Sparkles, FolderGit2, Bot, LogOut, UserCheck,
  Layers, Database, FolderTree, LayoutDashboard, Key, Activity, Clock, Webhook, Save, Trash2, DownloadCloud, Mail,
  CreditCard, Users, Crown, Plus, AlertCircle, Building, Sliders, Settings, HelpCircle, Menu
} from 'lucide-react'
import ServerSelectorDropdown from './ServerSelectorDropdown'
import ServerManager from './ServerManager'
import ProjectExplorer from './ProjectExplorer'
import DatabaseManager from './DatabaseManager'
import CodeStudio from './CodeStudio'
import EnvManager from './EnvManager'
import LogsTelemetryManager from './LogsTelemetryManager'
import DomainSSLManager from './DomainSSLManager'
import CronManager from './CronManager'
import WebhookManager from './WebhookManager'
import EmailManager from './EmailManager'
import BillingManager from './BillingManager'
import TeamManager from './TeamManager'
import AuditLogViewer from './AuditLogViewer'
import AICopilotDrawer from './AICopilotDrawer'
import AIAgentStudioDrawer from './AIAgentStudioDrawer'
import ProjectDedicatedStudio from './ProjectDedicatedStudio'
import AllProjectsHub from './AllProjectsHub'
import ServerConnectLanding from './ServerConnectLanding'
import MarketplaceView from './MarketplaceView'

import DeploymentWizard from './DeploymentWizard'

export default function CustomerDashboardLayout({ currentUser, jwtToken, onLogout, apiBaseUrl = '' }) {
  const [activeTab, setActiveTab] = useState('dashboard') // 'dashboard' | 'servers' | 'projects' | 'deployments' | 'databases' | 'code' | 'env' | 'domains' | 'logs' | 'email' | 'team' | 'billing' | 'settings'
  const [activeWorkspaceProject, setActiveWorkspaceProject] = useState(null)
  const [viewStep, setViewStep] = useState('servers') // Default home page after login: 'servers' ("Connect & Manage Your Server Infrastructure")
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [servers, setServers] = useState([])
  const [activeServerId, setActiveServerId] = useState('')
  const [loadingServers, setLoadingServers] = useState(true)
  const [showAiDrawer, setShowAiDrawer] = useState(false)
  const [copied, setCopied] = useState(false)
  const [templateToDeploy, setTemplateToDeploy] = useState(null)
  
  // Connect Server Form state inside customer dashboard
  const [connectForm, setConnectForm] = useState({
    name: '',
    ipAddress: '',
    port: 22,
    username: 'root',
    domain: ''
  })
  const [connecting, setConnecting] = useState(false)
  const [agentToken, setAgentToken] = useState('')
  const [installCommand, setInstallCommand] = useState('')
  const [buildInfo, setBuildInfo] = useState(null)

  const [activeServerMetrics, setActiveServerMetrics] = useState(null)

  const fetchTenantServers = async () => {
    setLoadingServers(true)
    try {
      const res = await fetch(`${apiBaseUrl}/api/agent/servers`, {
        headers: { Authorization: `Bearer ${jwtToken}` }
      })
      const data = await res.json()
      if (data.servers) {
        setServers(data.servers)
        if (data.servers.length > 0 && !activeServerId) {
          setActiveServerId(data.servers[0].id)
        }
      }
    } catch (err) {
      console.error('Failed to fetch customer servers:', err)
    } finally {
      setLoadingServers(false)
    }
  }

  const fetchActiveServerMetrics = async (srvId) => {
    if (!srvId) return
    try {
      const res = await fetch('/api/studio/server-metrics', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`,
          'X-Server-Id': srvId
        },
        body: JSON.stringify({ serverId: srvId })
      })
      const data = await res.json()
      if (data.success && data.server) {
        setActiveServerMetrics(data.server)
      }
    } catch (e) {}
  }

  const fetchBuildInfo = async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/api/health`)
      const data = await res.json()
      if (data && data.lastCodeUpdateFormatted) {
        setBuildInfo(data)
      }
    } catch (e) {}
  }

  useEffect(() => {
    fetchTenantServers()
    fetchBuildInfo()
    const token = `tok_${Math.random().toString(36).substring(2, 15)}`
    setAgentToken(token)
    setInstallCommand(`curl -fsSL ${window.location.origin}/install.sh | sudo bash -s -- --token=${token}`)
  }, [])

  useEffect(() => {
    if (activeServerId) {
      fetchActiveServerMetrics(activeServerId)
    }
  }, [activeServerId])

  const handleConnectServer = async (e) => {
    e.preventDefault()
    setConnecting(true)
    try {
      const res = await fetch(`${apiBaseUrl}/api/agent/servers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwtToken}`
        },
        body: JSON.stringify(connectForm)
      })
      const data = await res.json()
      if (data.success && data.server) {
        fetchTenantServers()
        setActiveServerId(data.server.id)
        setActiveTab('dashboard')
      } else {
        alert(data.error || 'Failed to connect server.')
      }
    } catch (err) {
      alert('Error connecting server: ' + err.message)
    } finally {
      setConnecting(false)
    }
  }

  const copyCommand = () => {
    navigator.clipboard.writeText(installCommand)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const activeServer = servers.find(s => s.id === activeServerId) || servers[0] || null

  const customerNavSections = [
    {
      title: 'WORKSPACE',
      items: [
        { id: 'dashboard', label: 'Dashboard Overview', icon: LayoutDashboard },
        { id: 'servers', label: 'Server Nodes', icon: Server },
        { id: 'projects', label: 'Projects & PM2', icon: Layers },
        { id: 'deployments', label: '1-Click Deploy', icon: Zap }
      ]
    },
    {
      title: 'INFRASTRUCTURE',
      items: [
        { id: 'databases', label: 'Databases', icon: Database },
        { id: 'domains', label: 'SSL & Domains', icon: Globe },
        { id: 'env', label: 'Environment (.env)', icon: Key },
        { id: 'cron', label: 'Cron Jobs', icon: Clock }
      ]
    },
    {
      title: 'DEVELOPMENT',
      items: [
        { id: 'code', label: 'Code Studio IDE', icon: FolderTree },
        { id: 'webhooks', label: 'Webhooks CI/CD', icon: Webhook }
      ]
    },
    {
      title: 'MONITORING & LOGS',
      items: [
        { id: 'logs', label: 'Logs & Telemetry', icon: Activity }
      ]
    },
    {
      title: 'COMMUNICATION',
      items: [
        { id: 'email', label: 'Domain Email Inbox', icon: Mail }
      ]
    },
    {
      title: 'ACCOUNT & SAAS',
      items: [
        { id: 'team', label: 'Team & Roles', icon: Users },
        { id: 'billing', label: 'Billing & Quotas', icon: CreditCard },
        { id: 'audit-logs', label: 'Audit Logs', icon: ShieldCheck }
      ]
    }
  ]

  if (activeWorkspaceProject) {
    return (
      <ProjectDedicatedStudio
        project={activeWorkspaceProject}
        jwtToken={jwtToken}
        activeServer={activeServer}
        onBackToDashboard={() => setActiveWorkspaceProject(null)}
      />
    )
  }

  if (viewStep === 'servers') {
    return (
      <ServerConnectLanding
        servers={servers}
        loadingServers={loadingServers}
        onSelectServer={(srv) => {
          if (srv && srv.id) {
            setActiveServerId(srv.id)
          }
          setViewStep('hub')
        }}
        onConnectServer={async (srvForm, callback) => {
          setConnecting(true)
          try {
            const res = await fetch(`${apiBaseUrl}/api/agent/servers`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${jwtToken}`
              },
              body: JSON.stringify(srvForm)
            })
            const data = await res.json()
            if (data.success && data.server) {
              await fetchTenantServers()
              setActiveServerId(data.server.id)
              setViewStep('hub')
              if (callback) callback()
            } else {
              alert(data.error || 'Failed to connect server.')
            }
          } catch (err) {
            alert('Error connecting server: ' + err.message)
          } finally {
            setConnecting(false)
          }
        }}
        connecting={connecting}
      />
    )
  }

  const renderHubSubView = (component, title) => (
    <div className="min-h-screen bg-[#07090E] text-slate-100 flex flex-col font-sans">
      <header className="h-16 bg-[#0B0E17]/90 backdrop-blur-xl border-b border-white/10 px-6 flex items-center justify-between z-30 shrink-0">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => setActiveTab('projects')}
            className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 rounded-xl text-xs font-mono font-bold transition flex items-center space-x-1.5 cursor-pointer shadow-md"
          >
            <ChevronLeft className="w-3.5 h-3.5 text-cyan-400" />
            <span>Back to Projects Hub</span>
          </button>
          <div className="h-5 w-px bg-slate-800"></div>
          <div className="flex items-center space-x-2 font-mono text-xs">
            <span className="text-slate-400">Hub</span>
            <span className="text-slate-600">/</span>
            <span className="font-extrabold text-white">{title}</span>
          </div>
        </div>

        <div className="flex items-center space-x-3 text-xs font-mono">
          <ServerSelectorDropdown
            activeServerId={activeServerId}
            onServerSelect={(id) => setActiveServerId(id)}
            apiBaseUrl={apiBaseUrl}
          />
          <button
            onClick={() => setActiveTab('deployments')}
            className="px-3.5 py-1.5 bg-gradient-to-r from-cyan-500 via-indigo-600 to-purple-600 hover:from-cyan-400 hover:to-purple-500 text-white font-extrabold rounded-xl shadow-lg flex items-center space-x-1.5 transition cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>1-Click Deploy</span>
          </button>
        </div>
      </header>
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8">
        {component}
      </main>
    </div>
  )

  if (viewStep === 'hub') {
    if (activeTab === 'marketplace') {
      return (
        <MarketplaceView
          onBackToHub={() => setActiveTab('projects')}
          onDeployTemplate={(tpl) => {
            setTemplateToDeploy(tpl)
            setActiveTab('deployments')
          }}
        />
      )
    }

    if (activeTab === 'deployments') {
      return renderHubSubView(
        <DeploymentWizard
          jwtToken={jwtToken}
          activeServer={activeServer}
          apiBaseUrl={apiBaseUrl}
          onDeploymentSuccess={() => fetchTenantServers()}
          onBackToHub={() => setActiveTab('projects')}
          initialTemplate={templateToDeploy}
        />,
        '1-Click Automated Deployment'
      )
    }

    if (activeTab === 'databases') {
      return renderHubSubView(
        <DatabaseManager jwtToken={jwtToken} activeServer={activeServer} apiBaseUrl={apiBaseUrl} />,
        'Database Management Suite'
      )
    }

    if (activeTab === 'email') {
      return renderHubSubView(
        <EmailManager jwtToken={jwtToken} activeServer={activeServer} apiBaseUrl={apiBaseUrl} />,
        'Domain Email Inbox'
      )
    }

    if (activeTab === 'audit-logs') {
      return renderHubSubView(
        <AuditLogViewer apiBaseUrl={apiBaseUrl} />,
        'Audit Logs & Security'
      )
    }

    return (
      <AllProjectsHub
        server={activeServer}
        jwtToken={jwtToken}
        currentUser={currentUser}
        onOpenProjectStudio={(p) => setActiveWorkspaceProject(p)}
        onChangeServerNode={() => setViewStep('servers')}
        onTabChange={(tabId) => {
          if (tabId === 'servers') {
            setViewStep('servers')
          } else {
            setActiveTab(tabId)
          }
        }}
        activeHubTab={activeTab}
      />
    )
  }

  return (
    <div className="min-h-screen bg-[#07090E] text-slate-100 flex flex-col font-sans selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* Customer Header */}
      <header className="border-b border-white/10 bg-slate-950/90 backdrop-blur-2xl sticky top-0 z-40 shadow-xl">
        <div className="px-3 sm:px-6 h-14 flex items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center space-x-2 sm:space-x-3">
            {/* Mobile Hamburger Button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden p-1.5 text-slate-300 hover:text-white bg-slate-900 rounded-xl border border-white/10 transition cursor-pointer"
              aria-label="Toggle mobile menu"
            >
              {mobileMenuOpen ? <X className="w-5 h-5 text-cyan-400" /> : <Menu className="w-5 h-5 text-cyan-400" />}
            </button>

            {/* Desktop Collapse Toggle */}
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="hidden lg:flex p-1.5 text-slate-400 hover:text-white bg-slate-900 rounded-xl border border-white/10 transition cursor-pointer"
            >
              <LayoutDashboard className="w-4 h-4 text-cyan-400" />
            </button>

            <div className="flex items-center space-x-1.5 sm:space-x-2">
              <span className="font-extrabold text-xs sm:text-sm tracking-tight text-white bg-gradient-to-r from-cyan-400 via-indigo-300 to-purple-400 bg-clip-text text-transparent">AutoDeploy</span>
              <span className="text-[9px] sm:text-[10px] bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 px-1.5 sm:px-2 py-0.5 rounded-full font-mono font-bold hidden xs:inline-block">WORKSPACES</span>
            </div>
          </div>

          <div className="flex items-center space-x-1.5 sm:space-x-3 overflow-x-auto no-scrollbar">
            <button
              onClick={() => setViewStep('hub')}
              className="text-xs bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-700 px-2.5 sm:px-3 py-1.5 rounded-xl font-bold flex items-center space-x-1.5 transition cursor-pointer shrink-0"
              title="Return to Projects Hub"
            >
              <ChevronLeft className="w-3.5 h-3.5 text-cyan-400" />
              <span className="hidden sm:inline">Projects Hub</span>
            </button>

            <ServerSelectorDropdown
              activeServerId={activeServerId}
              onServerSelect={(id) => setActiveServerId(id)}
              apiBaseUrl={apiBaseUrl}
            />

            {buildInfo?.lastCodeUpdateFormatted && (
              <div className="hidden xl:flex items-center space-x-1.5 bg-slate-900/90 border border-cyan-500/30 text-cyan-300 px-2.5 py-1 rounded-xl text-[11px] font-mono shadow-inner" title={`Full Commit Timestamp: ${buildInfo.lastCodeUpdate}`}>
                <Clock className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
                <span className="text-[10px] text-slate-400">Code Updated:</span>
                <span className="font-bold text-cyan-300">{buildInfo.lastCodeUpdateFormatted}</span>
              </div>
            )}

            <button
              onClick={() => setShowAiDrawer(true)}
              className="text-xs bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/40 px-2.5 sm:px-3 py-1.5 rounded-xl flex items-center space-x-1.5 transition font-semibold shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
              <span className="hidden sm:inline">AI Copilot</span>
            </button>

            {currentUser?.role === 'admin' && (
              <a
                href="/admin/dashboard"
                className="text-xs bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/40 px-2.5 sm:px-3 py-1.5 rounded-xl font-bold flex items-center space-x-1 shrink-0"
              >
                <Crown className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden md:inline">Super Admin Portal</span>
              </a>
            )}

            <div className="flex items-center space-x-1.5 sm:space-x-2 bg-slate-900 border border-white/10 rounded-xl px-2.5 py-1 text-xs shrink-0">
              <div className="w-5 h-5 rounded-full bg-cyan-500 text-slate-950 font-bold flex items-center justify-center text-[10px]">
                {currentUser?.fullName?.charAt(0) || 'U'}
              </div>
              <span className="font-semibold text-white max-w-[80px] sm:max-w-[120px] truncate hidden xs:inline">{currentUser?.fullName || currentUser?.email}</span>
              <button onClick={onLogout} className="text-slate-400 hover:text-rose-400 p-0.5 ml-1" title="Logout">
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Workspace Body */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Mobile Backdrop Overlay */}
        {mobileMenuOpen && (
          <div
            onClick={() => setMobileMenuOpen(false)}
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-30 lg:hidden animate-in fade-in duration-200"
          />
        )}

        {/* Sidebar */}
        <aside className={`fixed lg:relative inset-y-0 left-0 bg-slate-950/95 border-r border-white/10 backdrop-blur-2xl flex flex-col justify-between transition-all duration-300 z-40 select-none ${
          mobileMenuOpen ? 'translate-x-0 w-64' : '-translate-x-full lg:translate-x-0'
        } ${sidebarCollapsed ? 'lg:w-16' : 'lg:w-64'}`}>
          <div className="p-3 space-y-6 overflow-y-auto">
            {customerNavSections.map((section, idx) => (
              <div key={idx} className="space-y-1">
                {(!sidebarCollapsed || mobileMenuOpen) && (
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
                      onClick={() => {
                        setActiveTab(item.id)
                        setMobileMenuOpen(false)
                      }}
                      className={`w-full flex items-center ${sidebarCollapsed && !mobileMenuOpen ? 'justify-center px-2 py-2.5' : 'justify-between px-3 py-2'} rounded-xl text-xs transition-all cursor-pointer ${
                        isActive
                          ? 'bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 text-white font-bold shadow-lg shadow-cyan-500/20'
                          : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900'
                      }`}
                    >
                      <div className="flex items-center space-x-2.5">
                        <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                        {(!sidebarCollapsed || mobileMenuOpen) && <span className="font-medium">{item.label}</span>}
                      </div>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </aside>

        {/* Central Customer Area */}
        <main className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-6 w-full">
          {/* Active Workspace Server Context Switcher Bar */}
          <div className="bg-gradient-to-r from-slate-900 via-slate-900/95 to-blue-950/40 border border-slate-800 rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 shadow-md">
            <div className="flex items-center space-x-2.5 overflow-x-auto no-scrollbar">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
              <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider flex-shrink-0">Active Workspace Server:</span>
              <span className="text-xs font-bold text-cyan-300 flex-shrink-0">{activeServer?.name || 'Production Server Node 01'}</span>
              <span className="text-[10px] font-mono text-slate-300 bg-slate-950 px-2 py-0.5 rounded border border-slate-800 flex-shrink-0">
                {activeServer?.ipAddress || activeServer?.ftpHost || activeServer?.hostname || '187.127.165.128'}
              </span>
              <span className="text-[10px] uppercase font-bold text-amber-400 px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 flex-shrink-0">
                {activeServer?.serverType || 'VPS'} Node
              </span>
            </div>

            <div className="flex items-center space-x-2">
              <span className="text-xs text-slate-400 font-medium hidden sm:inline">Switch Target Server:</span>
              <ServerSelectorDropdown
                activeServerId={activeServerId}
                onServerSelect={(id) => setActiveServerId(id)}
                apiBaseUrl={apiBaseUrl}
              />
            </div>
          </div>

          {activeTab === 'dashboard' && (
            <div className="space-y-8 max-w-7xl mx-auto">
              {/* Welcome Banner */}
              <div className="bg-gradient-to-r from-slate-900 via-slate-900/90 to-cyan-950/30 border border-slate-800 rounded-3xl p-8 backdrop-blur-xl relative overflow-hidden">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
                  <div>
                    <h1 className="text-3xl font-black text-white tracking-tight">
                      Welcome back, {currentUser?.fullName || 'Developer'}
                    </h1>
                    <p className="text-slate-400 text-sm mt-1">
                      Organization Workspace: <strong className="text-cyan-400">{currentUser?.organizationId || 'My Company'}</strong>
                    </p>
                  </div>

                  <div className="flex items-center space-x-3">
                    <button
                      onClick={() => setActiveTab('servers')}
                      className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 rounded-xl font-bold text-xs flex items-center space-x-2 border border-slate-700 cursor-pointer"
                    >
                      <Plus className="w-4 h-4 text-cyan-400" />
                      <span>+ Connect Server (VPS / Shared / Cloud)</span>
                    </button>
                    <button
                      onClick={() => setActiveTab('deployments')}
                      className="px-4 py-2.5 bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-cyan-500/20 flex items-center space-x-2"
                    >
                      <Zap className="w-4 h-4" />
                      <span>Deploy New Project</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* No Connected Servers State */}
              {servers.length === 0 ? (
                <div className="bg-slate-900/80 border border-cyan-500/30 rounded-3xl p-8 backdrop-blur-xl text-center space-y-6 shadow-2xl">
                  <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center mx-auto text-cyan-400">
                    <Server className="w-8 h-8" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-white mb-2">No VPS Server Connected Yet</h3>
                    <p className="text-xs text-slate-400 max-w-lg mx-auto">
                      Connect your own cloud server node (Ubuntu / Debian / CentOS) using your server IP or by running the automated agent installer command.
                    </p>
                  </div>

                  {/* Installer Script Code Box */}
                  <div className="max-w-2xl mx-auto bg-slate-950 border border-slate-800 rounded-2xl p-4 text-left font-mono text-xs text-cyan-300 relative">
                    <div className="text-[10px] text-slate-500 uppercase font-bold mb-2">Run Agent Installer Command on Your VPS Terminal</div>
                    <div className="pr-12 break-all">{installCommand}</div>
                    <button
                      onClick={copyCommand}
                      className="absolute right-3 top-8 p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition"
                    >
                      {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>

                  <div className="pt-2">
                    <button
                      onClick={() => setActiveTab('servers')}
                      className="px-6 py-3 bg-gradient-to-r from-cyan-500 to-indigo-600 text-white font-bold text-xs rounded-xl shadow-lg shadow-cyan-500/20"
                    >
                      Enter SSH Server Credentials Manually
                    </button>
                  </div>
                </div>
              ) : (
                /* Connected Server Health Overview */
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                  <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 backdrop-blur-xl">
                    <div className="text-xs text-slate-400 font-semibold uppercase">Total Servers</div>
                    <div className="text-3xl font-black text-white mt-2">{servers.length}</div>
                    <div className="text-[11px] text-emerald-400 mt-1 flex items-center space-x-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>{servers.filter(s => s.status === 'online').length} Online</span>
                    </div>
                  </div>

                  <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 backdrop-blur-xl">
                    <div className="text-xs text-slate-400 font-semibold uppercase">Active Server IP</div>
                    <div className="text-xl font-bold font-mono text-cyan-400 mt-2">{activeServer?.ipAddress || '127.0.0.1'}</div>
                    <div className="text-[11px] text-slate-400 mt-1">{activeServer?.name}</div>
                  </div>

                  <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 backdrop-blur-xl">
                    <div className="text-xs text-slate-400 font-semibold uppercase">CPU Usage</div>
                    <div className="text-3xl font-black text-white mt-2">{activeServerMetrics?.cpu !== undefined ? activeServerMetrics.cpu : (activeServer?.cpu || 12)}%</div>
                    <div className="w-full bg-slate-950 h-1.5 rounded-full mt-2 overflow-hidden border border-slate-800">
                      <div className="bg-cyan-500 h-full" style={{ width: `${activeServerMetrics?.cpu !== undefined ? activeServerMetrics.cpu : (activeServer?.cpu || 12)}%` }} />
                    </div>
                  </div>

                  <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 backdrop-blur-xl">
                    <div className="text-xs text-slate-400 font-semibold uppercase">RAM Memory</div>
                    <div className="text-3xl font-black text-white mt-2">{activeServerMetrics?.memory !== undefined ? activeServerMetrics.memory : (activeServer?.ram || 42)}%</div>
                    <div className="w-full bg-slate-950 h-1.5 rounded-full mt-2 overflow-hidden border border-slate-800">
                      <div className="bg-indigo-500 h-full" style={{ width: `${activeServerMetrics?.memory !== undefined ? activeServerMetrics.memory : (activeServer?.ram || 42)}%` }} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'servers' && <ServerManager jwtToken={jwtToken} activeServer={activeServer} onSelectServer={(id) => setActiveServerId(id)} apiBaseUrl={apiBaseUrl} />}
          {activeTab === 'projects' && <ProjectExplorer jwtToken={jwtToken} activeServer={activeServer} apiBaseUrl={apiBaseUrl} onOpenProjectStudio={(p) => setActiveWorkspaceProject(p)} />}
          {activeTab === 'deployments' && <DeploymentWizard jwtToken={jwtToken} activeServer={activeServer} apiBaseUrl={apiBaseUrl} onDeploymentSuccess={() => fetchTenantServers()} />}
          {activeTab === 'databases' && <DatabaseManager jwtToken={jwtToken} activeServer={activeServer} apiBaseUrl={apiBaseUrl} />}
          {activeTab === 'code' && <CodeStudio jwtToken={jwtToken} activeServer={activeServer} apiBaseUrl={apiBaseUrl} onOpenProjectStudio={(p) => setActiveWorkspaceProject(p)} />}
          {activeTab === 'env' && <EnvManager jwtToken={jwtToken} activeServer={activeServer} apiBaseUrl={apiBaseUrl} />}
          {activeTab === 'domains' && <DomainSSLManager jwtToken={jwtToken} activeServer={activeServer} apiBaseUrl={apiBaseUrl} />}
          {activeTab === 'cron' && <CronManager jwtToken={jwtToken} activeServer={activeServer} apiBaseUrl={apiBaseUrl} />}
          {activeTab === 'webhooks' && <WebhookManager jwtToken={jwtToken} activeServer={activeServer} apiBaseUrl={apiBaseUrl} />}
          {activeTab === 'logs' && <LogsTelemetryManager jwtToken={jwtToken} activeServer={activeServer} apiBaseUrl={apiBaseUrl} />}
          {activeTab === 'email' && <EmailManager jwtToken={jwtToken} activeServer={activeServer} apiBaseUrl={apiBaseUrl} />}
          {activeTab === 'team' && <TeamManager apiBaseUrl={apiBaseUrl} />}
          {activeTab === 'billing' && <BillingManager apiBaseUrl={apiBaseUrl} />}
          {activeTab === 'audit-logs' && <AuditLogViewer apiBaseUrl={apiBaseUrl} />}
        </main>
      </div>

      <AIAgentStudioDrawer
        isOpen={showAiDrawer}
        onClose={() => setShowAiDrawer(false)}
        jwtToken={jwtToken}
        projectPath={activeServer?.remoteDir || '/var/www/auto-deploy-panel'}
      />
    </div>
  )
}
