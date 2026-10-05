import React, { useState } from 'react'
import { Server, Cpu, HardDrive, Zap, CheckCircle2, ShieldCheck, Plus, ArrowRight, Activity, Globe, Lock, RefreshCw, Key } from 'lucide-react'

export default function ServerConnectLanding({ servers, loadingServers, onSelectServer, onConnectServer, connecting }) {
  const [showConnectModal, setShowConnectModal] = useState(false)
  const [form, setForm] = useState({
    name: '',
    ipAddress: '',
    port: 22,
    username: 'root',
    password: '',
    domain: ''
  })

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!form.name || !form.ipAddress) {
      alert('Server Name and IP Address are required.')
      return
    }
    onConnectServer(form, () => setShowConnectModal(false))
  }

  return (
    <div className="min-h-screen bg-[#07090E] text-slate-100 flex flex-col font-sans">
      
      {/* Landing Top Header */}
      <header className="h-16 border-b border-white/10 bg-[#0B0E17]/90 backdrop-blur-xl px-6 flex items-center justify-between z-30">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-2xl bg-gradient-to-tr from-cyan-500 via-indigo-600 to-purple-600 flex items-center justify-center font-black text-white shadow-lg shadow-cyan-950/50">
            ⚡
          </div>
          <div>
            <h1 className="font-extrabold text-white text-base tracking-tight flex items-center gap-2">
              AutoDeploy Studio
              <span className="text-[10px] bg-cyan-950 border border-cyan-800 text-cyan-300 font-mono px-2 py-0.5 rounded-full uppercase font-bold">
                Multi-Tenant SaaS
              </span>
            </h1>
          </div>
        </div>

        <button
          onClick={() => setShowConnectModal(true)}
          className="px-4 py-2 bg-gradient-to-r from-cyan-500 via-indigo-600 to-purple-600 hover:from-cyan-400 hover:to-purple-500 text-white font-extrabold rounded-xl text-xs font-mono shadow-lg flex items-center space-x-2 transition cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Connect New Server Node</span>
        </button>
      </header>

      {/* Hero Section */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-10 space-y-8">
        
        <div className="space-y-3 text-center max-w-2xl mx-auto">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-cyan-950/80 border border-cyan-800/80 text-cyan-300 font-mono text-xs font-semibold">
            <Server className="w-3.5 h-3.5" />
            <span>Select Connected Server Node to Enter Projects Hub</span>
          </div>
          <h2 className="text-3xl md:text-4xl font-black text-white tracking-tight">
            Connect & Manage Your Server Infrastructure
          </h2>
          <p className="text-sm text-slate-400 font-mono">
            Select an active server node below to view all running web applications, PM2 services, databases, and AI Agent workspace.
          </p>
        </div>

        {/* Servers Grid View */}
        {loadingServers ? (
          <div className="h-64 flex flex-col items-center justify-center space-y-3 text-slate-400 font-mono text-xs">
            <RefreshCw className="w-8 h-8 animate-spin text-cyan-400" />
            <p>Scanning connected server nodes & hardware metrics...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {servers.map((srv) => (
              <div
                key={srv.id}
                onClick={() => onSelectServer(srv)}
                className="bg-slate-950/90 border-2 border-slate-800/80 hover:border-cyan-500/80 rounded-3xl p-6 space-y-5 transition duration-200 cursor-pointer group shadow-xl hover:shadow-cyan-950/40 relative overflow-hidden"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="p-3 rounded-2xl bg-cyan-950 text-cyan-400 border border-cyan-800 group-hover:scale-105 transition">
                      <Server className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="font-extrabold text-white text-base group-hover:text-cyan-300 transition">
                        {srv.name}
                      </h3>
                      <p className="text-xs text-slate-400 font-mono mt-0.5">{srv.hostname || srv.ipAddress}</p>
                    </div>
                  </div>

                  <span className="px-2.5 py-1 rounded-full text-[10px] font-bold font-mono uppercase bg-emerald-950 text-emerald-300 border border-emerald-800 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                    {srv.status || 'ONLINE'}
                  </span>
                </div>

                {/* Metrics Badges */}
                <div className="grid grid-cols-3 gap-2 font-mono text-xs pt-2 border-t border-slate-900">
                  <div className="bg-slate-900/80 p-2.5 rounded-xl border border-slate-800 text-center">
                    <span className="text-[10px] text-slate-500 block uppercase">CPU Load</span>
                    <strong className="text-white text-sm">{srv.cpu !== undefined ? srv.cpu : 12}%</strong>
                  </div>
                  <div className="bg-slate-900/80 p-2.5 rounded-xl border border-slate-800 text-center">
                    <span className="text-[10px] text-slate-500 block uppercase">RAM Usage</span>
                    <strong className="text-cyan-400 text-sm">{srv.ram !== undefined ? srv.ram : 42}%</strong>
                  </div>
                  <div className="bg-slate-900/80 p-2.5 rounded-xl border border-slate-800 text-center">
                    <span className="text-[10px] text-slate-500 block uppercase">Active Apps</span>
                    <strong className="text-emerald-400 text-sm">{srv.activeApps || 3}</strong>
                  </div>
                </div>

                {/* Open Hub Button */}
                <div className="pt-2 flex items-center justify-between text-xs font-mono text-cyan-400 font-bold group-hover:text-cyan-300">
                  <span>Open Projects Hub</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition" />
                </div>
              </div>
            ))}

            {/* Connect Server Card Action */}
            <div
              onClick={() => setShowConnectModal(true)}
              className="bg-slate-950/40 border-2 border-dashed border-slate-800 hover:border-cyan-500/60 rounded-3xl p-6 flex flex-col items-center justify-center space-y-3 text-center transition cursor-pointer hover:bg-slate-900/40 min-h-[220px]"
            >
              <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 text-slate-400">
                <Plus className="w-8 h-8" />
              </div>
              <div>
                <h4 className="font-extrabold text-white text-sm">Connect Another Server Node</h4>
                <p className="text-xs text-slate-500 font-mono mt-1">VPS, Dedicated, cPanel, or Cloud Instance</p>
              </div>
            </div>
          </div>
        )}

      </main>

      {/* Connect Server Modal */}
      {showConnectModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#0B0E17] border border-white/10 rounded-3xl max-w-lg w-full p-6 space-y-5 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 rounded-xl bg-cyan-950 text-cyan-400 border border-cyan-800">
                  <Server className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-white text-base">Connect New Server Node</h3>
                  <p className="text-xs text-slate-400 font-mono">SSH authentication setup</p>
                </div>
              </div>
              <button
                onClick={() => setShowConnectModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 font-mono text-xs">
              <div className="space-y-1">
                <label className="text-slate-300 font-semibold">Server Display Name *</label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Production Node 02"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 space-y-1">
                  <label className="text-slate-300 font-semibold">Host IP / Domain *</label>
                  <input
                    type="text"
                    required
                    value={form.ipAddress}
                    onChange={(e) => setForm({ ...form, ipAddress: e.target.value })}
                    placeholder="187.127.165.128"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:border-cyan-500 focus:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-slate-300 font-semibold">SSH Port</label>
                  <input
                    type="number"
                    value={form.port}
                    onChange={(e) => setForm({ ...form, port: parseInt(e.target.value) || 22 })}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:border-cyan-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-slate-300 font-semibold">SSH Username</label>
                  <input
                    type="text"
                    value={form.username}
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                    placeholder="root"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:border-cyan-500 focus:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-slate-300 font-semibold">SSH Password</label>
                  <input
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    placeholder="Password"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:border-cyan-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowConnectModal(false)}
                  className="px-4 py-2 bg-slate-900 text-slate-300 rounded-xl border border-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={connecting}
                  className="px-5 py-2 bg-gradient-to-r from-cyan-500 to-indigo-600 text-white font-bold rounded-xl shadow-lg flex items-center space-x-1.5"
                >
                  {connecting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  <span>Connect & Launch Hub</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  )
}
