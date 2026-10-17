import React, { useState } from 'react'
import TeamManager from './TeamManager'
import SupportDesk from './SupportDesk'
import ProfilePage from './ProfilePage'
import BillingManager from './BillingManager'
import {
  Server, Cpu, HardDrive, Zap, CheckCircle2, ShieldCheck, Plus, ArrowRight,
  Activity, Globe, Lock, RefreshCw, Key, Monitor, Terminal, Layers,
  CreditCard, Users, HelpCircle, UserPlus, Check, Sparkles, Receipt, Download,
  MessageSquare, AlertCircle, FileText, ChevronRight, Mail, Phone, ExternalLink, Trash2, X, UserCircle, LogOut
} from 'lucide-react'
import ThemeToggle from './ThemeToggle'
import { useAuth } from '../store/AuthContext'

export default function ServerConnectLanding({ currentUser, apiBaseUrl = '', servers, loadingServers, onSelectServer, onConnectServer, connecting }) {
  const { logout } = useAuth()
  const [activeTab, setActiveTab] = useState('servers') // 'servers' | 'billing' | 'team' | 'support' | 'profile'
  const [showConnectModal, setShowConnectModal] = useState(false)

  // Server Connect Form State
  const [form, setForm] = useState({
    name: '',
    ipAddress: '',
    port: 22,
    username: 'root',
    password: '',
    domain: ''
  })

  // Billing transactions history (no payment gateway is connected yet, so there are no real invoices)
  const transactions = []

  const handleSubmitConnect = (e) => {
    e.preventDefault()
    if (!form.name || !form.ipAddress) {
      alert('Server Name and IP Address are required.')
      return
    }
    onConnectServer(form, () => setShowConnectModal(false))
  }


  return (
    <div className="min-h-screen bg-slate-950 app-canvas text-slate-100 flex flex-col font-sans selection:bg-cyan-500/30 selection:text-cyan-200">
      
      {/* Landing Top Header Bar (Apple macOS Style Navigation) */}
      <header className="min-h-[4rem] border-b border-white/10 bg-slate-900/90 backdrop-blur-2xl px-4 lg:px-6 py-2 flex flex-wrap lg:flex-nowrap items-center justify-between gap-3 z-30 sticky top-0 shadow-2xl">
        
        {/* Left: Logo & Branding */}
        <div className="flex items-center space-x-3 shrink-0">
          <div className="w-8.5 h-8.5 rounded-xl bg-gradient-to-tr from-cyan-500 via-indigo-600 to-purple-600 flex items-center justify-center font-black text-onaccent shadow-lg shadow-cyan-500/20">
            ⚡
          </div>
          <div>
            <h1 className="font-extrabold text-white text-sm tracking-tight flex items-center gap-2 font-sans">
              AutoDeploy <span className="font-mono text-cyan-400 text-xs font-semibold">Studio SaaS</span>
              <span className="text-[10px] bg-cyan-950/80 border border-cyan-500/30 text-cyan-300 font-mono px-2 py-0.5 rounded-full uppercase font-bold tracking-wider">
                v2.0 Active
              </span>
            </h1>
          </div>
        </div>

        {/* Center: Main Navigation Tabs */}
        <div className="flex items-center space-x-1.5 overflow-x-auto scrollbar-none py-0.5 max-w-full justify-center shrink-0">
          <nav className="bg-slate-950/80 p-1 rounded-2xl border border-white/10 inline-flex items-center space-x-1 font-mono text-xs backdrop-blur-xl shadow-inner">
            <button
              onClick={() => setActiveTab('servers')}
              className={`h-8.5 px-4 rounded-xl font-bold inline-flex items-center space-x-2 transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'servers'
                  ? 'bg-gradient-to-r from-cyan-500 via-indigo-600 to-purple-600 text-onaccent shadow-md shadow-cyan-500/20 ring-1 ring-cyan-400/30'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Server className="w-4 h-4 shrink-0" />
              <span>Server Nodes</span>
            </button>

            <button
              onClick={() => setActiveTab('billing')}
              className={`h-8.5 px-4 rounded-xl font-bold inline-flex items-center space-x-2 transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'billing'
                  ? 'bg-gradient-to-r from-amber-500 via-orange-600 to-amber-700 text-onaccent shadow-md shadow-amber-500/20 ring-1 ring-amber-400/30'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <CreditCard className="w-4 h-4 text-amber-400 shrink-0" />
              <span>Plans & Billing</span>
            </button>

            <button
              onClick={() => setActiveTab('team')}
              className={`h-8.5 px-4 rounded-xl font-bold inline-flex items-center space-x-2 transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'team'
                  ? 'bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-700 text-onaccent shadow-md shadow-indigo-500/20 ring-1 ring-indigo-400/30'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Users className="w-4 h-4 shrink-0" />
              <span>Team Members</span>
            </button>

            <button
              onClick={() => setActiveTab('support')}
              className={`h-8.5 px-4 rounded-xl font-bold inline-flex items-center space-x-2 transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'support'
                  ? 'bg-gradient-to-r from-emerald-500 via-teal-600 to-emerald-700 text-onaccent shadow-md shadow-emerald-500/20 ring-1 ring-emerald-400/30'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <HelpCircle className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Help & Support</span>
            </button>

            <button
              onClick={() => setActiveTab('profile')}
              className={`h-8.5 px-4 rounded-xl font-bold inline-flex items-center space-x-2 transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'profile'
                  ? 'bg-gradient-to-r from-slate-600 via-slate-700 to-slate-800 text-onaccent shadow-md ring-1 ring-slate-400/30'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
              title={currentUser?.email || 'My profile'}
            >
              <UserCircle className="w-4 h-4 shrink-0" />
              <span>My Profile</span>
            </button>
          </nav>
        </div>

        {/* Right Action Buttons */}
        <div className="flex items-center space-x-2.5 shrink-0 justify-end ml-auto lg:ml-0">
          <ThemeToggle compact />
          <button
            onClick={() => setActiveTab('billing')}
            className="h-8.5 px-3 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-xl text-xs font-mono font-bold inline-flex items-center space-x-1.5 transition cursor-pointer shrink-0"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">Upgrade Plan</span>
          </button>

          <button
            onClick={() => setShowConnectModal(true)}
            className="h-8.5 px-4 bg-gradient-to-r from-cyan-500 via-indigo-600 to-purple-600 hover:from-cyan-400 hover:to-purple-500 text-onaccent font-extrabold rounded-xl text-xs font-mono shadow-lg shadow-cyan-500/20 inline-flex items-center space-x-1.5 transition transform hover:scale-[1.02] cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4 shrink-0" />
            <span>Connect Server</span>
          </button>
          <button
            onClick={logout}
            title="Log out"
            className="h-8.5 px-3 bg-slate-900/90 hover:bg-rose-500/10 text-slate-300 hover:text-rose-300 border border-white/10 hover:border-rose-500/40 rounded-xl text-xs font-bold inline-flex items-center space-x-1.5 transition cursor-pointer shrink-0"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Logout</span>
          </button>
        </div>
      </header>


      {/* Main Content View Switcher */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 lg:px-8 py-8 space-y-8">
        
        {/* TAB 1: SERVER NODES MANAGEMENT */}
        {activeTab === 'servers' && (
          <div className="space-y-8">
            <div className="space-y-4 text-center max-w-3xl mx-auto">
              <div className="inline-flex items-center space-x-2 px-3.5 py-1 rounded-full bg-cyan-950/60 border border-cyan-800/60 text-cyan-300 font-mono text-xs font-semibold backdrop-blur-md shadow-md">
                <Server className="w-3.5 h-3.5 text-cyan-400" />
                <span>Infrastructure Management & Active Server Nodes</span>
              </div>

              <h2 className="text-3xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-slate-100 to-slate-400 tracking-tight leading-tight">
                Connect & Manage Your Server Infrastructure
              </h2>

              <p className="text-sm text-slate-400 font-mono max-w-xl mx-auto leading-relaxed">
                Select an active server node below to launch your Dedicated Project Studio, inspect real-time PM2 telemetry, manage databases, and deploy updates.
              </p>
            </div>

            {/* Servers Grid View */}
            {loadingServers ? (
              <div className="h-64 flex flex-col items-center justify-center space-y-4 text-slate-400 font-mono text-xs bg-slate-950/40 rounded-3xl border border-white/5 backdrop-blur-xl">
                <RefreshCw className="w-8 h-8 animate-spin text-cyan-400" />
                <p className="tracking-wide">Scanning connected server nodes & hardware metrics...</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {servers.map((srv) => (
                  <div
                    key={srv.id}
                    onClick={() => onSelectServer(srv)}
                    className="bg-slate-900/90 border border-white/10 hover:border-cyan-500/80 rounded-3xl p-6 space-y-6 transition-all duration-300 cursor-pointer group shadow-2xl hover:shadow-[0_0_35px_rgba(6,182,212,0.2)] relative overflow-hidden backdrop-blur-xl hover:-translate-y-1"
                  >
                    <div className="absolute -right-12 -top-12 w-32 h-32 bg-cyan-500/10 rounded-full blur-2xl group-hover:bg-cyan-500/20 transition duration-500"></div>

                    <div className="flex items-start justify-between relative z-10">
                      <div className="flex items-center space-x-3.5">
                        <div className="p-3 rounded-2xl bg-cyan-950/80 text-cyan-400 border border-cyan-800/80 group-hover:scale-110 group-hover:border-cyan-500 transition duration-300 shadow-lg shadow-cyan-950/50">
                          <Server className="w-6 h-6" />
                        </div>
                        <div>
                          <h3 className="font-extrabold text-white text-base group-hover:text-cyan-300 transition duration-200 tracking-tight">
                            {srv.name}
                          </h3>
                          <p className="text-xs text-slate-400 font-mono mt-0.5 flex items-center gap-1">
                            <span>{srv.hostname || srv.ipAddress}</span>
                          </p>
                        </div>
                      </div>

                      <span title={srv.error || ''} className={`px-3 py-1 rounded-full text-[10px] font-extrabold font-mono uppercase flex items-center gap-1.5 shadow-sm border ${srv.status === 'offline' ? 'bg-rose-950/90 text-rose-300 border-rose-800/80' : srv.status === 'online' ? 'bg-emerald-950/90 text-emerald-300 border-emerald-800/80' : 'bg-slate-900 text-slate-400 border-slate-700'}`}>
                        <span className="relative flex h-2 w-2">
                          {srv.status === 'online' && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
                          <span className={`relative inline-flex rounded-full h-2 w-2 ${srv.status === 'offline' ? 'bg-rose-400' : srv.status === 'online' ? 'bg-emerald-400' : 'bg-slate-500'}`}></span>
                        </span>
                        {srv.status === 'offline' ? 'unreachable' : (srv.status || 'checking')}
                      </span>
                    </div>

                    {/* Hardware Telemetry Meters */}
                    <div className="grid grid-cols-3 gap-2 font-mono text-xs pt-3 border-t border-white/5 relative z-10">
                      <div className="bg-slate-900/90 p-2.5 rounded-2xl border border-white/5 text-center shadow-inner">
                        <span className="text-[10px] text-slate-500 block uppercase font-bold tracking-wider">CPU Load</span>
                        <strong className="text-white text-sm font-extrabold">{srv.cpu ?? '—'}{srv.cpu !== undefined ? '%' : ''}</strong>
                      </div>
                      <div className="bg-slate-900/90 p-2.5 rounded-2xl border border-white/5 text-center shadow-inner">
                        <span className="text-[10px] text-slate-500 block uppercase font-bold tracking-wider">RAM Usage</span>
                        <strong className="text-cyan-400 text-sm font-extrabold">{srv.ram ?? '—'}{srv.ram !== undefined ? '%' : ''}</strong>
                      </div>
                      <div className="bg-slate-900/90 p-2.5 rounded-2xl border border-white/5 text-center shadow-inner">
                        <span className="text-[10px] text-slate-500 block uppercase font-bold tracking-wider">Active Apps</span>
                        <strong className="text-emerald-400 text-sm font-extrabold">{srv.activeApps ?? '—'}</strong>
                      </div>
                    </div>

                    {/* Open Hub Action Bar */}
                    <div className="pt-2 flex items-center justify-between text-xs font-mono text-cyan-400 font-extrabold group-hover:text-cyan-300 relative z-10">
                      <span className="flex items-center gap-1.5">
                        <Layers className="w-3.5 h-3.5" />
                        <span>Open Projects Hub</span>
                      </span>
                      <div className="w-7 h-7 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center group-hover:bg-cyan-500 group-hover:text-slate-950 transition duration-300 shadow-md">
                        <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition" />
                      </div>
                    </div>
                  </div>
                ))}

                {/* Connect Server Card Action */}
                <div
                  onClick={() => setShowConnectModal(true)}
                  className="bg-slate-900/40 border-2 border-dashed border-white/10 hover:border-cyan-500/60 rounded-3xl p-6 flex flex-col items-center justify-center space-y-4 text-center transition-all duration-300 cursor-pointer hover:bg-slate-900/40 min-h-[220px] backdrop-blur-xl group"
                >
                  <div className="p-4 rounded-2xl bg-slate-900/80 border border-white/10 text-slate-400 group-hover:scale-110 group-hover:text-cyan-400 transition duration-300 shadow-lg">
                    <Plus className="w-7 h-7" />
                  </div>
                  <div>
                    <h4 className="font-extrabold text-white text-sm tracking-tight group-hover:text-cyan-300 transition">Connect Another Server Node</h4>
                    <p className="text-xs text-slate-500 font-mono mt-1">VPS, Dedicated, cPanel, or Cloud Instance</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: BILLING, SUBSCRIPTION PLANS & TRANSACTIONS */}
        {activeTab === 'billing' && (
          <BillingManager apiBaseUrl={apiBaseUrl} />
        )}

        {/* TAB 3: TEAM MEMBERS MANAGEMENT (live data from /api/team) */}
        {activeTab === 'team' && (
          <TeamManager />
        )}

        {/* TAB 4: HELP & SUPPORT */}
        {activeTab === 'support' && (
          <div className="space-y-10">
            <div className="space-y-4 text-center max-w-3xl mx-auto">
              <div className="inline-flex items-center space-x-2 px-3.5 py-1 rounded-full bg-emerald-950/60 border border-emerald-800/60 text-emerald-300 font-mono text-xs font-semibold backdrop-blur-md shadow-md">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>All Systems Operational (99.99% Uptime)</span>
              </div>

              <h2 className="text-3xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-slate-100 to-slate-400 tracking-tight leading-tight">
                Help Center & Support Desk
              </h2>

              <p className="text-sm text-slate-400 font-mono max-w-xl mx-auto leading-relaxed">
                Need assistance with SSH key connection, PM2 process bindings, or SSL certificates? Our dev support team is available 24/7.
              </p>
            </div>

            {/* Quick Support Options Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 font-mono">
              <div className="bg-slate-900/90 border border-white/10 rounded-3xl p-6 space-y-3 backdrop-blur-xl shadow-xl">
                <div className="p-3 rounded-2xl bg-cyan-950 text-cyan-400 border border-cyan-800 w-fit">
                  <FileText className="w-5 h-5" />
                </div>
                <h4 className="font-extrabold text-white text-base">Documentation & Guides</h4>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Detailed walkthroughs for SSH setup, PM2 process management, MySQL database imports, and custom domain mapping.
                </p>
                <a
                  href="#docs"
                  onClick={(e) => { e.preventDefault(); alert('Opening AutoDeploy Studio Documentation...') }}
                  className="inline-flex items-center gap-1.5 text-xs text-cyan-400 font-bold hover:text-cyan-300 pt-2"
                >
                  <span>Explore Documentation</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </a>
              </div>

              <div className="bg-slate-900/90 border border-white/10 rounded-3xl p-6 space-y-3 backdrop-blur-xl shadow-xl">
                <div className="p-3 rounded-2xl bg-emerald-950 text-emerald-400 border border-emerald-800 w-fit">
                  <MessageSquare className="w-5 h-5" />
                </div>
                <h4 className="font-extrabold text-white text-base">Live WhatsApp / Chat</h4>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Chat directly with our senior DevOps engineers for immediate issue resolution and deployment debugging.
                </p>
                <a
                  href="https://wa.me/919131622340"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-emerald-400 font-bold hover:text-emerald-300 pt-2"
                >
                  <span>Open WhatsApp Support ↗</span>
                </a>
              </div>

              <div className="bg-slate-900/90 border border-white/10 rounded-3xl p-6 space-y-3 backdrop-blur-xl shadow-xl">
                <div className="p-3 rounded-2xl bg-purple-950 text-purple-400 border border-purple-800 w-fit">
                  <Mail className="w-5 h-5" />
                </div>
                <h4 className="font-extrabold text-white text-base">24/7 Email Desk</h4>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Submit detailed technical logs or request custom enterprise cluster deployments via direct email.
                </p>
                <a
                  href="mailto:support@yjtechnosoft.com"
                  className="inline-flex items-center gap-1.5 text-xs text-purple-400 font-bold hover:text-purple-300 pt-2"
                >
                  <span>support@yjtechnosoft.com</span>
                </a>
              </div>
            </div>

            <SupportDesk />
          </div>
        )}

        {/* TAB 5: MY PROFILE */}
        {activeTab === 'profile' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-black text-white tracking-tight">My profile</h2>
              <p className="text-slate-400 text-sm mt-1">Your account details, sign-in email, password and firm details</p>
            </div>
            <ProfilePage apiBaseUrl={apiBaseUrl} />
          </div>
        )}

      </main>

      {/* MODAL 1: CONNECT NEW SERVER NODE */}
      {showConnectModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xl flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/15 rounded-3xl max-w-lg w-full p-6 space-y-6 shadow-[0_20px_50px_rgba(0,0,0,0.8)] animate-in zoom-in-95 duration-200 relative overflow-hidden">
            
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 rounded-xl bg-cyan-950 text-cyan-400 border border-cyan-800">
                  <Server className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-white text-sm tracking-tight">Connect New Server Node</h3>
                  <p className="text-[11px] text-slate-400 font-mono">SSH authentication & host details</p>
                </div>
              </div>
              <button
                onClick={() => setShowConnectModal(false)}
                className="w-8 h-8 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white flex items-center justify-center transition cursor-pointer text-xs"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitConnect} className="space-y-4 font-mono text-xs">
              <div className="space-y-1.5">
                <label className="text-slate-300 font-semibold">Server Display Name *</label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Production Node 02"
                  className="w-full px-3.5 py-2.5 bg-slate-950/80 border border-white/10 rounded-xl text-white focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 space-y-1.5">
                  <label className="text-slate-300 font-semibold">Host IP / Domain *</label>
                  <input
                    type="text"
                    required
                    value={form.ipAddress}
                    onChange={(e) => setForm({ ...form, ipAddress: e.target.value })}
                    placeholder="187.127.165.128"
                    className="w-full px-3.5 py-2.5 bg-slate-950/80 border border-white/10 rounded-xl text-white focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-slate-300 font-semibold">Port *</label>
                  <input
                    type="number"
                    required
                    value={form.port}
                    onChange={(e) => setForm({ ...form, port: parseInt(e.target.value) || 22 })}
                    className="w-full px-3.5 py-2.5 bg-slate-950/80 border border-white/10 rounded-xl text-white focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-slate-300 font-semibold">SSH Username *</label>
                  <input
                    type="text"
                    required
                    value={form.username}
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                    placeholder="root"
                    className="w-full px-3.5 py-2.5 bg-slate-950/80 border border-white/10 rounded-xl text-white focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-slate-300 font-semibold">SSH Password</label>
                  <input
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    placeholder="••••••••"
                    className="w-full px-3.5 py-2.5 bg-slate-950/80 border border-white/10 rounded-xl text-white focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-slate-300 font-semibold">Primary Domain (Optional)</label>
                <input
                  type="text"
                  value={form.domain}
                  onChange={(e) => setForm({ ...form, domain: e.target.value })}
                  placeholder="automate-deployment.yjtechnosoft.com"
                  className="w-full px-3.5 py-2.5 bg-slate-950/80 border border-white/10 rounded-xl text-white focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </div>

              <div className="pt-3 flex items-center justify-end space-x-3 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setShowConnectModal(false)}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 rounded-xl font-bold transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={connecting}
                  className="px-5 py-2 bg-gradient-to-r from-cyan-500 via-indigo-600 to-purple-600 hover:from-cyan-400 hover:to-purple-500 text-onaccent font-extrabold rounded-xl shadow-lg shadow-cyan-500/20 transition cursor-pointer disabled:opacity-50 flex items-center space-x-2"
                >
                  <Plus className="w-4 h-4" />
                  <span>{connecting ? 'Connecting Node...' : 'Save & Connect Server'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}


    </div>
  )
}
