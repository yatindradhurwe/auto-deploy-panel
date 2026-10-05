import React, { useState } from 'react'
import {
  Server, Cpu, HardDrive, Zap, CheckCircle2, ShieldCheck, Plus, ArrowRight,
  Activity, Globe, Lock, RefreshCw, Key, Monitor, Terminal, Layers,
  CreditCard, Users, HelpCircle, UserPlus, Check, Sparkles, Receipt, Download,
  MessageSquare, AlertCircle, FileText, ChevronRight, Mail, Phone, ExternalLink, Trash2, X
} from 'lucide-react'

export default function ServerConnectLanding({ servers, loadingServers, onSelectServer, onConnectServer, connecting }) {
  const [activeTab, setActiveTab] = useState('servers') // 'servers' | 'billing' | 'team' | 'support'
  const [showConnectModal, setShowConnectModal] = useState(false)
  const [billingCycle, setBillingCycle] = useState('monthly') // 'monthly' | 'annual'
  const [selectedPlanForBuy, setSelectedPlanForBuy] = useState(null)
  const [paymentSuccessMsg, setPaymentSuccessMsg] = useState(null)

  // Team State
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteForm, setInviteForm] = useState({ email: '', name: '', role: 'Developer' })
  const [teamMembers, setTeamMembers] = useState([
    { id: 'usr-1', name: 'Yatindra Dhurwe', email: 'yatindra@yjtechnosoft.com', role: 'Owner / Admin', status: 'Active', avatar: 'YD', joined: 'Oct 2024' },
    { id: 'usr-2', name: 'DevOps Lead', email: 'devops@kshana.tech', role: 'Developer', status: 'Active', avatar: 'DL', joined: 'Jan 2025' }
  ])

  // Support Ticket State
  const [ticketForm, setTicketForm] = useState({ category: 'Server Connectivity', priority: 'Medium', subject: '', message: '' })
  const [ticketSubmitted, setTicketSubmitted] = useState(false)

  // Server Connect Form State
  const [form, setForm] = useState({
    name: '',
    ipAddress: '',
    port: 22,
    username: 'root',
    password: '',
    domain: ''
  })

  // Sample Billing Transactions History
  const [transactions] = useState([
    { id: 'INV-2026-004', date: '2026-10-01', description: 'PRO SaaS Subscription (Monthly)', amount: '$49.00', status: 'Paid', method: 'Visa ending in 4242' },
    { id: 'INV-2026-003', date: '2026-09-01', description: 'PRO SaaS Subscription (Monthly)', amount: '$49.00', status: 'Paid', method: 'Visa ending in 4242' },
    { id: 'INV-2026-002', date: '2026-08-01', description: 'Starter SaaS Plan', amount: '$19.00', status: 'Paid', method: 'UPI / Direct Bank' }
  ])

  const handleSubmitConnect = (e) => {
    e.preventDefault()
    if (!form.name || !form.ipAddress) {
      alert('Server Name and IP Address are required.')
      return
    }
    onConnectServer(form, () => setShowConnectModal(false))
  }

  const handleInviteSubmit = (e) => {
    e.preventDefault()
    if (!inviteForm.email) return
    const newMember = {
      id: `usr-${Date.now()}`,
      name: inviteForm.name || inviteForm.email.split('@')[0],
      email: inviteForm.email,
      role: inviteForm.role,
      status: 'Active',
      avatar: (inviteForm.name || inviteForm.email).slice(0, 2).toUpperCase(),
      joined: 'Today'
    }
    setTeamMembers([...teamMembers, newMember])
    setInviteForm({ email: '', name: '', role: 'Developer' })
    setShowInviteModal(false)
  }

  const handleTicketSubmit = (e) => {
    e.preventDefault()
    if (!ticketForm.subject || !ticketForm.message) return
    setTicketSubmitted(true)
    setTimeout(() => {
      setTicketSubmitted(false)
      setTicketForm({ category: 'Server Connectivity', priority: 'Medium', subject: '', message: '' })
    }, 4000)
  }

  const handleConfirmBuyPlan = (plan) => {
    setPaymentSuccessMsg(`🎉 Successfully subscribed to ${plan.title}! Your server quota and features are now upgraded.`)
    setSelectedPlanForBuy(null)
    setTimeout(() => setPaymentSuccessMsg(null), 5000)
  }

  return (
    <div className="min-h-screen bg-[#030712] text-slate-100 flex flex-col font-sans selection:bg-cyan-500/30 selection:text-cyan-200">
      
      {/* Landing Top Header Bar (Apple macOS Style Navigation) */}
      <header className="min-h-[4rem] border-b border-white/10 bg-[#0B0E17]/90 backdrop-blur-2xl px-4 lg:px-6 py-2 flex flex-wrap lg:flex-nowrap items-center justify-between gap-3 z-30 sticky top-0 shadow-2xl">
        
        {/* Left: Logo & Branding */}
        <div className="flex items-center space-x-3 shrink-0">
          <div className="w-8.5 h-8.5 rounded-xl bg-gradient-to-tr from-cyan-500 via-indigo-600 to-purple-600 flex items-center justify-center font-black text-white shadow-lg shadow-cyan-500/20">
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
                  ? 'bg-gradient-to-r from-cyan-500 via-indigo-600 to-purple-600 text-white shadow-md shadow-cyan-500/20 ring-1 ring-cyan-400/30'
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
                  ? 'bg-gradient-to-r from-amber-500 via-orange-600 to-amber-700 text-white shadow-md shadow-amber-500/20 ring-1 ring-amber-400/30'
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
                  ? 'bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-700 text-white shadow-md shadow-indigo-500/20 ring-1 ring-indigo-400/30'
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
                  ? 'bg-gradient-to-r from-emerald-500 via-teal-600 to-emerald-700 text-white shadow-md shadow-emerald-500/20 ring-1 ring-emerald-400/30'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <HelpCircle className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Help & Support</span>
            </button>
          </nav>
        </div>

        {/* Right Action Buttons */}
        <div className="flex items-center space-x-2.5 shrink-0 justify-end ml-auto lg:ml-0">
          <button
            onClick={() => setActiveTab('billing')}
            className="h-8.5 px-3 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-xl text-xs font-mono font-bold inline-flex items-center space-x-1.5 transition cursor-pointer shrink-0"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">Upgrade Plan</span>
          </button>

          <button
            onClick={() => setShowConnectModal(true)}
            className="h-8.5 px-4 bg-gradient-to-r from-cyan-500 via-indigo-600 to-purple-600 hover:from-cyan-400 hover:to-purple-500 text-white font-extrabold rounded-xl text-xs font-mono shadow-lg shadow-cyan-500/20 inline-flex items-center space-x-1.5 transition transform hover:scale-[1.02] cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4 shrink-0" />
            <span>Connect Server</span>
          </button>
        </div>
      </header>

      {/* Global Success Notification Toast */}
      {paymentSuccessMsg && (
        <div className="bg-emerald-950 border-b border-emerald-500/40 text-emerald-300 px-6 py-3 font-mono text-xs flex items-center justify-between shadow-xl animate-in slide-in-from-top duration-300">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <span>{paymentSuccessMsg}</span>
          </div>
          <button onClick={() => setPaymentSuccessMsg(null)} className="text-emerald-400 hover:text-white font-bold">✕</button>
        </div>
      )}

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
                    className="bg-[#0B0F19]/90 border border-white/10 hover:border-cyan-500/80 rounded-3xl p-6 space-y-6 transition-all duration-300 cursor-pointer group shadow-2xl hover:shadow-[0_0_35px_rgba(6,182,212,0.2)] relative overflow-hidden backdrop-blur-xl hover:-translate-y-1"
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

                      <span className="px-3 py-1 rounded-full text-[10px] font-extrabold font-mono uppercase bg-emerald-950/90 text-emerald-300 border border-emerald-800/80 flex items-center gap-1.5 shadow-sm">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400"></span>
                        </span>
                        {srv.status || 'ONLINE'}
                      </span>
                    </div>

                    {/* Hardware Telemetry Meters */}
                    <div className="grid grid-cols-3 gap-2 font-mono text-xs pt-3 border-t border-white/5 relative z-10">
                      <div className="bg-slate-900/90 p-2.5 rounded-2xl border border-white/5 text-center shadow-inner">
                        <span className="text-[10px] text-slate-500 block uppercase font-bold tracking-wider">CPU Load</span>
                        <strong className="text-white text-sm font-extrabold">{srv.cpu !== undefined ? srv.cpu : 12}%</strong>
                      </div>
                      <div className="bg-slate-900/90 p-2.5 rounded-2xl border border-white/5 text-center shadow-inner">
                        <span className="text-[10px] text-slate-500 block uppercase font-bold tracking-wider">RAM Usage</span>
                        <strong className="text-cyan-400 text-sm font-extrabold">{srv.ram !== undefined ? srv.ram : 42}%</strong>
                      </div>
                      <div className="bg-slate-900/90 p-2.5 rounded-2xl border border-white/5 text-center shadow-inner">
                        <span className="text-[10px] text-slate-500 block uppercase font-bold tracking-wider">Active Apps</span>
                        <strong className="text-emerald-400 text-sm font-extrabold">{srv.activeApps || 3}</strong>
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
                  className="bg-[#0B0F19]/40 border-2 border-dashed border-white/10 hover:border-cyan-500/60 rounded-3xl p-6 flex flex-col items-center justify-center space-y-4 text-center transition-all duration-300 cursor-pointer hover:bg-slate-900/40 min-h-[220px] backdrop-blur-xl group"
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
          <div className="space-y-10">
            {/* Header Banner */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-[#0B0F19]/90 border border-white/10 rounded-3xl p-6 backdrop-blur-xl shadow-2xl">
              <div className="space-y-2">
                <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-amber-500/10 text-amber-300 font-mono text-xs font-bold border border-amber-500/30">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span>Current Active Subscription</span>
                </div>
                <h2 className="text-2xl font-black text-white tracking-tight">PRO Developer Tier</h2>
                <p className="text-xs text-slate-400 font-mono">
                  Unlimited App Deployments • 5 Server Nodes • Autonomous AI Code Agent • Auto SSL Certificates
                </p>
              </div>

              <div className="flex items-center space-x-3 shrink-0">
                <div className="text-right font-mono text-xs">
                  <span className="text-slate-400 block">Renews on</span>
                  <span className="font-bold text-emerald-400">Nov 01, 2026</span>
                </div>
                <button
                  onClick={() => setBillingCycle(billingCycle === 'monthly' ? 'annual' : 'monthly')}
                  className="px-4 py-2 bg-slate-900 border border-white/10 text-cyan-300 rounded-2xl font-mono text-xs font-bold hover:bg-slate-800 transition"
                >
                  Switch to {billingCycle === 'monthly' ? 'Annual (Save 20%)' : 'Monthly'}
                </button>
              </div>
            </div>

            {/* Subscription Plans Grid */}
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-extrabold text-white tracking-tight">Subscription Plans & Quotas</h3>
                  <p className="text-xs text-slate-400 font-mono">Choose the plan that fits your server infrastructure scale</p>
                </div>

                {/* Billing Cycle Toggle */}
                <div className="bg-slate-950 p-1 rounded-2xl border border-white/10 flex items-center space-x-1 font-mono text-xs">
                  <button
                    onClick={() => setBillingCycle('monthly')}
                    className={`px-3 py-1.5 rounded-xl font-bold transition ${
                      billingCycle === 'monthly' ? 'bg-cyan-500 text-slate-950 shadow' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Monthly Billing
                  </button>
                  <button
                    onClick={() => setBillingCycle('annual')}
                    className={`px-3 py-1.5 rounded-xl font-bold transition flex items-center space-x-1 ${
                      billingCycle === 'annual' ? 'bg-amber-500 text-slate-950 shadow' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <span>Annual</span>
                    <span className="text-[9px] bg-emerald-950 text-emerald-300 px-1.5 py-0.5 rounded-md border border-emerald-800 font-black">20% OFF</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 font-sans">
                {/* Plan 1: Starter */}
                <div className="bg-[#0B0F19]/90 border border-white/10 rounded-3xl p-6 flex flex-col justify-between space-y-6 shadow-xl backdrop-blur-xl hover:border-cyan-500/50 transition">
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <span className="text-xs font-mono font-bold text-slate-400 uppercase tracking-widest">SOLO / STARTER</span>
                      <h4 className="text-2xl font-black text-white">Starter Node</h4>
                      <p className="text-xs text-slate-400 font-mono">Perfect for single developers & small side projects</p>
                    </div>

                    <div className="pt-2">
                      <span className="text-4xl font-black text-white">{billingCycle === 'monthly' ? '$19' : '$15'}</span>
                      <span className="text-xs font-mono text-slate-400"> / month</span>
                    </div>

                    <ul className="space-y-2.5 font-mono text-xs text-slate-300 border-t border-white/10 pt-4">
                      <li className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-cyan-400 shrink-0" />
                        <span>1 Connected VPS Server Node</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-cyan-400 shrink-0" />
                        <span>Up to 5 Live Web Apps</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-cyan-400 shrink-0" />
                        <span>PM2 Process Auto-Restart</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-cyan-400 shrink-0" />
                        <span>Community Discord Support</span>
                      </li>
                    </ul>
                  </div>

                  <button
                    onClick={() => setSelectedPlanForBuy({ title: 'Starter Node', price: billingCycle === 'monthly' ? '$19/mo' : '$15/mo' })}
                    className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-white/10 rounded-2xl font-mono text-xs font-bold transition cursor-pointer"
                  >
                    Select Starter Plan
                  </button>
                </div>

                {/* Plan 2: Pro (Popular) */}
                <div className="bg-[#0B0F19] border-2 border-cyan-500/80 rounded-3xl p-6 flex flex-col justify-between space-y-6 shadow-2xl shadow-cyan-950/40 relative backdrop-blur-xl scale-105">
                  <div className="absolute -top-3 right-6 bg-gradient-to-r from-cyan-500 to-indigo-600 text-slate-950 font-black text-[10px] font-mono uppercase px-3 py-1 rounded-full shadow">
                    MOST POPULAR
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-1">
                      <span className="text-xs font-mono font-bold text-cyan-400 uppercase tracking-widest">DEVELOPER PRO</span>
                      <h4 className="text-2xl font-black text-white">PRO Developer</h4>
                      <p className="text-xs text-slate-400 font-mono">For growing startups & active production deployments</p>
                    </div>

                    <div className="pt-2">
                      <span className="text-4xl font-black text-white">{billingCycle === 'monthly' ? '$49' : '$39'}</span>
                      <span className="text-xs font-mono text-slate-400"> / month</span>
                    </div>

                    <ul className="space-y-2.5 font-mono text-xs text-slate-200 border-t border-white/10 pt-4">
                      <li className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-cyan-400 shrink-0" />
                        <span>Up to 5 Connected VPS Server Nodes</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-cyan-400 shrink-0" />
                        <span>UNLIMITED Live Web Applications</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-cyan-400 shrink-0" />
                        <span>Autonomous AI Code Agent (Claude/Gemini)</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-cyan-400 shrink-0" />
                        <span>Automated Free SSL & Proxy Streaming</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-cyan-400 shrink-0" />
                        <span>Priority 24/7 Developer Support</span>
                      </li>
                    </ul>
                  </div>

                  <button
                    onClick={() => setSelectedPlanForBuy({ title: 'PRO Developer', price: billingCycle === 'monthly' ? '$49/mo' : '$39/mo' })}
                    className="w-full py-2.5 bg-gradient-to-r from-cyan-500 via-indigo-600 to-purple-600 hover:from-cyan-400 hover:to-purple-500 text-white font-extrabold rounded-2xl font-mono text-xs shadow-lg shadow-cyan-500/25 transition cursor-pointer"
                  >
                    Upgrade to PRO Plan
                  </button>
                </div>

                {/* Plan 3: Enterprise */}
                <div className="bg-[#0B0F19]/90 border border-white/10 rounded-3xl p-6 flex flex-col justify-between space-y-6 shadow-xl backdrop-blur-xl hover:border-purple-500/50 transition">
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <span className="text-xs font-mono font-bold text-purple-400 uppercase tracking-widest">AGENCY / ENTERPRISE</span>
                      <h4 className="text-2xl font-black text-white">Enterprise Cluster</h4>
                      <p className="text-xs text-slate-400 font-mono">Custom multi-server clusters & white-label teams</p>
                    </div>

                    <div className="pt-2">
                      <span className="text-4xl font-black text-white">{billingCycle === 'monthly' ? '$149' : '$119'}</span>
                      <span className="text-xs font-mono text-slate-400"> / month</span>
                    </div>

                    <ul className="space-y-2.5 font-mono text-xs text-slate-300 border-t border-white/10 pt-4">
                      <li className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-purple-400 shrink-0" />
                        <span>UNLIMITED Server Nodes & Clusters</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-purple-400 shrink-0" />
                        <span>Dedicated IP & Dedicated Proxy Stream</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-purple-400 shrink-0" />
                        <span>White-label Panel Branding & Domain</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-purple-400 shrink-0" />
                        <span>24/7 Dedicated Account Manager & Phone SLA</span>
                      </li>
                    </ul>
                  </div>

                  <button
                    onClick={() => setSelectedPlanForBuy({ title: 'Enterprise Cluster', price: billingCycle === 'monthly' ? '$149/mo' : '$119/mo' })}
                    className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-purple-300 border border-purple-500/30 rounded-2xl font-mono text-xs font-bold transition cursor-pointer"
                  >
                    Buy Enterprise Plan
                  </button>
                </div>
              </div>
            </div>

            {/* Payment Transactions & Invoices Table */}
            <div className="bg-[#0B0F19]/90 border border-white/10 rounded-3xl p-6 space-y-4 backdrop-blur-xl shadow-xl font-mono">
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <div className="flex items-center space-x-2">
                  <Receipt className="w-5 h-5 text-cyan-400" />
                  <h3 className="text-base font-extrabold text-white">Payment Transactions & Invoices</h3>
                </div>
                <span className="text-xs text-slate-400">3 Payment Records</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left text-slate-300">
                  <thead className="bg-slate-950/80 text-slate-400 uppercase text-[10px] border-b border-white/10">
                    <tr>
                      <th className="px-4 py-3">Invoice ID</th>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Description</th>
                      <th className="px-4 py-3">Amount</th>
                      <th className="px-4 py-3">Payment Method</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Invoice PDF</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {transactions.map((tx) => (
                      <tr key={tx.id} className="hover:bg-white/5 transition">
                        <td className="px-4 py-3 font-bold text-white">{tx.id}</td>
                        <td className="px-4 py-3 text-slate-400">{tx.date}</td>
                        <td className="px-4 py-3 text-cyan-300">{tx.description}</td>
                        <td className="px-4 py-3 font-extrabold text-white">{tx.amount}</td>
                        <td className="px-4 py-3 text-slate-400">{tx.method}</td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800">
                            {tx.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => alert(`Downloading Invoice PDF: ${tx.id}`)}
                            className="p-1.5 bg-slate-900 hover:bg-slate-800 text-cyan-400 rounded-lg border border-white/10 transition cursor-pointer"
                            title="Download PDF Invoice"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: TEAM MEMBERS MANAGEMENT */}
        {activeTab === 'team' && (
          <div className="space-y-8">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div className="inline-flex items-center space-x-2 text-xs font-mono text-indigo-400 font-bold uppercase tracking-wider mb-1">
                  <Users className="w-4 h-4" />
                  <span>Access Control & Permissions</span>
                </div>
                <h2 className="text-3xl font-black text-white tracking-tight">Team Members</h2>
                <p className="text-xs text-slate-400 font-mono mt-1">
                  Manage collaborators, assign server node access, and configure developer roles
                </p>
              </div>

              <button
                onClick={() => setShowInviteModal(true)}
                className="px-4 py-2 bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-700 text-white font-extrabold text-xs font-mono rounded-2xl shadow-lg shadow-indigo-500/20 flex items-center space-x-2 shrink-0 transition cursor-pointer hover:scale-[1.02]"
              >
                <UserPlus className="w-4 h-4" />
                <span>+ Invite Team Member</span>
              </button>
            </div>

            {/* Team Members List */}
            <div className="bg-[#0B0F19]/90 border border-white/10 rounded-3xl p-6 space-y-4 backdrop-blur-xl shadow-2xl font-mono">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {teamMembers.map((member) => (
                  <div
                    key={member.id}
                    className="bg-slate-950/80 border border-white/10 hover:border-indigo-500/50 rounded-2xl p-4 flex items-center justify-between transition group shadow-md"
                  >
                    <div className="flex items-center space-x-3.5">
                      <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center font-extrabold text-white text-sm shadow-md">
                        {member.avatar}
                      </div>
                      <div>
                        <h4 className="font-extrabold text-white text-sm tracking-tight flex items-center gap-2">
                          <span>{member.name}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[9px] uppercase font-bold border ${
                            member.role.includes('Admin')
                              ? 'bg-purple-950 text-purple-300 border-purple-800'
                              : 'bg-cyan-950 text-cyan-300 border-cyan-800'
                          }`}>
                            {member.role}
                          </span>
                        </h4>
                        <p className="text-xs text-slate-400 mt-0.5">{member.email}</p>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
                      <span className="text-[10px] text-slate-500 font-bold hidden sm:inline">Joined {member.joined}</span>
                      {!member.role.includes('Owner') && (
                        <button
                          onClick={() => setTeamMembers(teamMembers.filter((m) => m.id !== member.id))}
                          className="p-2 text-rose-400 hover:bg-rose-950/80 rounded-xl transition cursor-pointer"
                          title="Remove Member"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
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
              <div className="bg-[#0B0F19]/90 border border-white/10 rounded-3xl p-6 space-y-3 backdrop-blur-xl shadow-xl">
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

              <div className="bg-[#0B0F19]/90 border border-white/10 rounded-3xl p-6 space-y-3 backdrop-blur-xl shadow-xl">
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

              <div className="bg-[#0B0F19]/90 border border-white/10 rounded-3xl p-6 space-y-3 backdrop-blur-xl shadow-xl">
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

            {/* Support Ticket Submission Form */}
            <div className="bg-[#0B0F19]/90 border border-white/10 rounded-3xl p-6 space-y-6 backdrop-blur-xl shadow-2xl font-mono">
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <div className="flex items-center space-x-2">
                  <HelpCircle className="w-5 h-5 text-cyan-400" />
                  <h3 className="text-base font-extrabold text-white">Create Support Ticket</h3>
                </div>
                <span className="text-xs text-slate-400">Average Response Time: &lt; 15 mins</span>
              </div>

              {ticketSubmitted ? (
                <div className="p-6 bg-emerald-950/80 border border-emerald-500/40 rounded-2xl text-center space-y-2 text-emerald-300">
                  <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
                  <h4 className="font-bold text-base text-white">Support Ticket Submitted Successfully!</h4>
                  <p className="text-xs">Ticket ID: #TK-{Math.floor(100000 + Math.random() * 900000)}. Our engineers have been notified and will reply shortly.</p>
                </div>
              ) : (
                <form onSubmit={handleTicketSubmit} className="space-y-4 text-xs">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-slate-300 font-bold block">Issue Category</label>
                      <select
                        value={ticketForm.category}
                        onChange={(e) => setTicketForm({ ...ticketForm, category: e.target.value })}
                        className="w-full px-3.5 py-2.5 bg-slate-950 border border-white/10 rounded-xl text-white focus:outline-none focus:border-cyan-500"
                      >
                        <option value="Server Connectivity">Server Connectivity / SSH Error</option>
                        <option value="Deployment Failure">Deployment / Build Failure</option>
                        <option value="PM2 Process">PM2 Process & Domain Binding</option>
                        <option value="Database Import">MySQL / PostgreSQL Database Import</option>
                        <option value="Billing Plan">Billing & Subscription Inquiry</option>
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-slate-300 font-bold block">Priority Level</label>
                      <select
                        value={ticketForm.priority}
                        onChange={(e) => setTicketForm({ ...ticketForm, priority: e.target.value })}
                        className="w-full px-3.5 py-2.5 bg-slate-950 border border-white/10 rounded-xl text-white focus:outline-none focus:border-cyan-500"
                      >
                        <option value="Low">Low - General Inquiry</option>
                        <option value="Medium">Medium - Standard Issue</option>
                        <option value="High">High - Production Degradation</option>
                        <option value="Urgent">Urgent - Server Down</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-slate-300 font-bold block">Subject / Issue Summary *</label>
                    <input
                      type="text"
                      required
                      value={ticketForm.subject}
                      onChange={(e) => setTicketForm({ ...ticketForm, subject: e.target.value })}
                      placeholder="e.g. Nginx 503 error on domain deployment"
                      className="w-full px-3.5 py-2.5 bg-slate-950 border border-white/10 rounded-xl text-white focus:outline-none focus:border-cyan-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-slate-300 font-bold block">Detailed Description / Error Logs *</label>
                    <textarea
                      required
                      rows={4}
                      value={ticketForm.message}
                      onChange={(e) => setTicketForm({ ...ticketForm, message: e.target.value })}
                      placeholder="Paste error logs, server IP, or step-by-step description of the problem..."
                      className="w-full p-3.5 bg-slate-950 border border-white/10 rounded-xl text-white focus:outline-none focus:border-cyan-500"
                    ></textarea>
                  </div>

                  <div className="pt-2 flex justify-end">
                    <button
                      type="submit"
                      className="px-6 py-2.5 bg-gradient-to-r from-emerald-500 via-teal-600 to-emerald-700 hover:from-emerald-400 hover:to-teal-500 text-white font-extrabold rounded-xl shadow-lg shadow-emerald-500/20 transition cursor-pointer flex items-center space-x-2"
                    >
                      <MessageSquare className="w-4 h-4" />
                      <span>Submit Support Ticket</span>
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}

      </main>

      {/* MODAL 1: CONNECT NEW SERVER NODE */}
      {showConnectModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xl flex items-center justify-center p-4">
          <div className="bg-[#0B0E17] border border-white/15 rounded-3xl max-w-lg w-full p-6 space-y-6 shadow-[0_20px_50px_rgba(0,0,0,0.8)] animate-in zoom-in-95 duration-200 relative overflow-hidden">
            
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
                  className="px-5 py-2 bg-gradient-to-r from-cyan-500 via-indigo-600 to-purple-600 hover:from-cyan-400 hover:to-purple-500 text-white font-extrabold rounded-xl shadow-lg shadow-cyan-500/20 transition cursor-pointer disabled:opacity-50 flex items-center space-x-2"
                >
                  <Plus className="w-4 h-4" />
                  <span>{connecting ? 'Connecting Node...' : 'Save & Connect Server'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: INVITE TEAM MEMBER */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xl flex items-center justify-center p-4">
          <div className="bg-[#0B0E17] border border-white/15 rounded-3xl max-w-md w-full p-6 space-y-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 rounded-xl bg-indigo-950 text-indigo-400 border border-indigo-800">
                  <UserPlus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-white text-sm tracking-tight">Invite Team Member</h3>
                  <p className="text-[11px] text-slate-400 font-mono">Grant access to server panel</p>
                </div>
              </div>
              <button
                onClick={() => setShowInviteModal(false)}
                className="w-8 h-8 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white flex items-center justify-center transition cursor-pointer text-xs"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleInviteSubmit} className="space-y-4 font-mono text-xs">
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold">Email Address *</label>
                <input
                  type="email"
                  required
                  value={inviteForm.email}
                  onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                  placeholder="developer@company.com"
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-white/10 rounded-xl text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold">Full Name (Optional)</label>
                <input
                  type="text"
                  value={inviteForm.name}
                  onChange={(e) => setInviteForm({ ...inviteForm, name: e.target.value })}
                  placeholder="Alex Smith"
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-white/10 rounded-xl text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold">Access Role</label>
                <select
                  value={inviteForm.role}
                  onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-white/10 rounded-xl text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="Developer">Developer (Deploy & Logs Access)</option>
                  <option value="Admin">Admin (Full Server & Billing Access)</option>
                  <option value="Viewer">Viewer (Read-only Telemetry)</option>
                </select>
              </div>

              <div className="pt-3 flex justify-end space-x-3 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  className="px-4 py-2 bg-slate-900 text-slate-300 rounded-xl font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-700 text-white font-extrabold rounded-xl shadow-lg cursor-pointer"
                >
                  Send Invitation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: BUY PLAN / CHECKOUT CONFIRMATION */}
      {selectedPlanForBuy && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xl flex items-center justify-center p-4">
          <div className="bg-[#0B0E17] border border-white/15 rounded-3xl max-w-md w-full p-6 space-y-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 rounded-xl bg-amber-950 text-amber-400 border border-amber-800">
                  <CreditCard className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-white text-sm tracking-tight">Confirm Plan Upgrade</h3>
                  <p className="text-[11px] text-slate-400 font-mono">{selectedPlanForBuy.title} • {selectedPlanForBuy.price}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedPlanForBuy(null)}
                className="w-8 h-8 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white flex items-center justify-center text-xs cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 font-mono text-xs">
              <div className="p-4 bg-slate-950 rounded-2xl border border-white/10 space-y-2">
                <div className="flex justify-between font-bold text-white">
                  <span>Selected Tier:</span>
                  <span className="text-cyan-400">{selectedPlanForBuy.title}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Billing Cycle:</span>
                  <span className="capitalize text-white">{billingCycle}</span>
                </div>
                <div className="flex justify-between text-slate-400 border-t border-white/10 pt-2">
                  <span>Total Due Today:</span>
                  <span className="text-base font-black text-amber-300">{selectedPlanForBuy.price}</span>
                </div>
              </div>

              <div className="space-y-2">
                <span className="text-slate-300 font-bold block">Payment Method</span>
                <div className="grid grid-cols-2 gap-2">
                  <button className="p-3 bg-cyan-950/80 border border-cyan-500/60 rounded-xl text-cyan-300 text-left font-bold flex items-center space-x-2">
                    <CreditCard className="w-4 h-4 text-cyan-400" />
                    <span>Card / UPI / NetBanking</span>
                  </button>
                  <button className="p-3 bg-slate-950 border border-white/10 rounded-xl text-slate-400 text-left hover:text-white transition">
                    <span>PayPal / Wire</span>
                  </button>
                </div>
              </div>

              <div className="pt-3 flex justify-end space-x-3 border-t border-white/10">
                <button
                  onClick={() => setSelectedPlanForBuy(null)}
                  className="px-4 py-2 bg-slate-900 text-slate-300 rounded-xl font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleConfirmBuyPlan(selectedPlanForBuy)}
                  className="px-5 py-2 bg-gradient-to-r from-amber-500 via-orange-600 to-amber-700 text-white font-extrabold rounded-xl shadow-lg cursor-pointer"
                >
                  Confirm & Buy Plan
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
