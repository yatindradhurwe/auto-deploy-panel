import React, { useState, useEffect } from 'react'
import {
  Server, Terminal, ShieldCheck, Globe, Zap, Cpu, CheckCircle2,
  XCircle, AlertTriangle, Play, RefreshCw, Copy, Check, Lock, HardDrive, Code,
  Github, Search, X, ChevronRight, ChevronLeft, ChevronDown, Sparkles, FolderGit2, Bot, LogOut, UserCheck,
  Layers, Database, FolderTree, LayoutDashboard, Key, Activity, Clock, Webhook, Save, Trash2, DownloadCloud, Mail,
  CreditCard, Users, Crown, Plus, AlertCircle, Building, Sliders, Settings, HelpCircle
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

import DeploymentWizard from './DeploymentWizard'

export default function CustomerDashboardLayout({ currentUser, jwtToken, onLogout, apiBaseUrl = '' }) {
  const [activeTab, setActiveTab] = useState('dashboard') // 'dashboard' | 'servers' | 'projects' | 'deployments' | 'databases' | 'code' | 'env' | 'domains' | 'logs' | 'email' | 'team' | 'billing' | 'settings'
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [servers, setServers] = useState([])
  const [activeServerId, setActiveServerId] = useState('')
  const [loadingServers, setLoadingServers] = useState(true)
  const [showAiDrawer, setShowAiDrawer] = useState(false)
  const [copied, setCopied] = useState(false)
  
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

  useEffect(() => {
    fetchTenantServers()
    const token = `tok_${Math.random().toString(36).substring(2, 15)}`
    setAgentToken(token)
    setInstallCommand(`curl -fsSL ${window.location.origin}/install.sh | sudo bash -s -- --token=${token}`)
  }, [])

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
        { id: 'servers', label: 'Server Nodes', icon: Server, badge: servers.length.toString() },
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

  return (
    <div className="min-h-screen bg-[#07090E] text-slate-100 flex flex-col font-sans selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* Customer Header */}
      <header className="border-b border-white/10 bg-slate-950/90 backdrop-blur-2xl sticky top-0 z-40 shadow-xl">
        <div className="px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="p-1.5 text-slate-400 hover:text-white bg-slate-900 rounded-xl border border-white/10 transition cursor-pointer"
            >
              <LayoutDashboard className="w-4 h-4 text-cyan-400" />
            </button>
            <div className="flex items-center space-x-2">
              <span className="font-extrabold text-sm tracking-tight text-white bg-gradient-to-r from-cyan-400 via-indigo-300 to-purple-400 bg-clip-text text-transparent">AutoDeploy</span>
              <span className="text-[10px] bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 px-2 py-0.5 rounded-full font-mono font-bold">CUSTOMER WORKSPACE</span>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <ServerSelectorDropdown
              activeServerId={activeServerId}
              onServerSelect={(id) => setActiveServerId(id)}
              apiBaseUrl={apiBaseUrl}
            />

            <button
              onClick={() => setShowAiDrawer(true)}
              className="text-xs bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/40 px-3 py-1.5 rounded-xl flex items-center space-x-1.5 transition font-semibold"
            >
              <Sparkles className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
              <span className="hidden sm:inline">AI Copilot</span>
            </button>

            {currentUser?.role === 'admin' && (
              <a
                href="/admin/dashboard"
                className="text-xs bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/40 px-3 py-1.5 rounded-xl font-bold flex items-center space-x-1"
              >
                <Crown className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden md:inline">Super Admin Portal</span>
              </a>
            )}

            <div className="flex items-center space-x-2 bg-slate-900 border border-white/10 rounded-xl px-3 py-1 text-xs">
              <div className="w-5 h-5 rounded-full bg-cyan-500 text-slate-950 font-bold flex items-center justify-center text-[10px]">
                {currentUser?.fullName?.charAt(0) || 'U'}
              </div>
              <span className="font-semibold text-white max-w-[100px] truncate">{currentUser?.fullName || currentUser?.email}</span>
              <button onClick={onLogout} className="text-slate-400 hover:text-rose-400 p-0.5 ml-1">
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Workspace Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside className={`bg-slate-950/80 border-r border-white/10 backdrop-blur-xl flex flex-col justify-between transition-all duration-300 z-30 select-none ${sidebarCollapsed ? 'w-16' : 'w-64'}`}>
          <div className="p-3 space-y-6 overflow-y-auto">
            {customerNavSections.map((section, idx) => (
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
                      className={`w-full flex items-center ${sidebarCollapsed ? 'justify-center px-2 py-2.5' : 'justify-between px-3 py-2'} rounded-xl text-xs transition-all cursor-pointer ${
                        isActive
                          ? 'bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 text-white font-bold shadow-lg shadow-cyan-500/20'
                          : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900'
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
        </aside>

        {/* Central Customer Area */}
        <main className="flex-1 overflow-y-auto p-6 space-y-6">
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
                      className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 rounded-xl font-bold text-xs flex items-center space-x-2 border border-slate-700"
                    >
                      <Plus className="w-4 h-4 text-cyan-400" />
                      <span>+ Connect VPS Server</span>
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
                    <div className="text-3xl font-black text-white mt-2">{activeServer?.cpu || 12}%</div>
                    <div className="w-full bg-slate-950 h-1.5 rounded-full mt-2 overflow-hidden border border-slate-800">
                      <div className="bg-cyan-500 h-full" style={{ width: `${activeServer?.cpu || 12}%` }} />
                    </div>
                  </div>

                  <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 backdrop-blur-xl">
                    <div className="text-xs text-slate-400 font-semibold uppercase">RAM Memory</div>
                    <div className="text-3xl font-black text-white mt-2">{activeServer?.ram || 42}%</div>
                    <div className="w-full bg-slate-950 h-1.5 rounded-full mt-2 overflow-hidden border border-slate-800">
                      <div className="bg-indigo-500 h-full" style={{ width: `${activeServer?.ram || 42}%` }} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'servers' && <ServerManager jwtToken={jwtToken} apiBaseUrl={apiBaseUrl} />}
          {activeTab === 'projects' && <ProjectExplorer jwtToken={jwtToken} activeServer={activeServer} apiBaseUrl={apiBaseUrl} />}
          {activeTab === 'deployments' && <DeploymentWizard jwtToken={jwtToken} activeServer={activeServer} apiBaseUrl={apiBaseUrl} onDeploymentSuccess={() => fetchTenantServers()} />}
          {activeTab === 'databases' && <DatabaseManager jwtToken={jwtToken} apiBaseUrl={apiBaseUrl} />}
          {activeTab === 'code' && <CodeStudio jwtToken={jwtToken} activeServer={activeServer} apiBaseUrl={apiBaseUrl} />}
          {activeTab === 'env' && <EnvManager jwtToken={jwtToken} apiBaseUrl={apiBaseUrl} />}
          {activeTab === 'domains' && <DomainSSLManager jwtToken={jwtToken} apiBaseUrl={apiBaseUrl} />}
          {activeTab === 'cron' && <CronManager jwtToken={jwtToken} apiBaseUrl={apiBaseUrl} />}
          {activeTab === 'webhooks' && <WebhookManager jwtToken={jwtToken} apiBaseUrl={apiBaseUrl} />}
          {activeTab === 'logs' && <LogsTelemetryManager jwtToken={jwtToken} activeServer={activeServer} apiBaseUrl={apiBaseUrl} />}
          {activeTab === 'email' && <EmailManager jwtToken={jwtToken} activeServer={activeServer} apiBaseUrl={apiBaseUrl} />}
          {activeTab === 'team' && <TeamManager apiBaseUrl={apiBaseUrl} />}
          {activeTab === 'billing' && <BillingManager apiBaseUrl={apiBaseUrl} />}
          {activeTab === 'audit-logs' && <AuditLogViewer apiBaseUrl={apiBaseUrl} />}
        </main>
      </div>

      <AICopilotDrawer isOpen={showAiDrawer} onClose={() => setShowAiDrawer(false)} logs={[]} config={{ host: activeServer?.ipAddress }} />
    </div>
  )
}
