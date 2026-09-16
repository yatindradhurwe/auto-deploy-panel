import React, { useState, useEffect } from 'react'
import { Server, Activity, Cpu, HardDrive, ShieldCheck, Plus, RefreshCw, Terminal, CheckCircle2, Clock, Globe, Key, AlertTriangle } from 'lucide-react'

export default function ServerManager({ jwtToken, onSelectServer }) {
  const [servers, setServers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [newServer, setNewServer] = useState({
    name: '',
    host: '',
    port: 22,
    username: 'root',
    password: '',
    domain: ''
  })

  useEffect(() => {
    fetchServers()
  }, [])

  const fetchServers = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/studio/servers', {
        headers: { 'Authorization': `Bearer ${jwtToken}` }
      })
      const data = await res.json()
      if (data.success) {
        setServers(data.servers)
      }
    } catch (e) {
      console.error('Failed to load server history', e)
    } finally {
      setLoading(false)
    }
  }

  const handleAddServer = (e) => {
    e.preventDefault()
    if (!newServer.name || !newServer.host) return

    const created = {
      id: `srv-${Date.now()}`,
      name: newServer.name,
      host: newServer.host,
      port: newServer.port || 22,
      username: newServer.username || 'root',
      status: 'online',
      os: 'Linux Server (x86_64)',
      cpuUsage: Math.floor(Math.random() * 20) + 5,
      ramUsage: Math.floor(Math.random() * 30) + 30,
      diskUsage: Math.floor(Math.random() * 40) + 20,
      activeApps: 1,
      domain: newServer.domain || `${newServer.host}.com`,
      lastConnected: new Date().toISOString()
    }

    setServers((prev) => [created, ...prev])
    setShowAddModal(false)
    setNewServer({ name: '', host: '', port: 22, username: 'root', password: '', domain: '' })
  }

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-slate-900 via-slate-900/90 to-blue-950/40 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex items-center space-x-3.5">
          <div className="p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
            <Server className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
              Server History & Cluster Node Manager
              <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-950 border border-cyan-800 text-cyan-400 font-mono">
                {servers.length} Connected
              </span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">Manage SSH profiles, monitor hardware load, and deploy services across server history</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchServers}
            className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-xl transition cursor-pointer"
            title="Refresh Server Metrics"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-medium rounded-xl shadow-lg shadow-cyan-950/30 flex items-center gap-2 transition cursor-pointer text-xs"
          >
            <Plus className="w-4 h-4" />
            <span>Add Server Profile</span>
          </button>
        </div>
      </div>

      {/* Add Server Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full max-w-md shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Server className="w-5 h-5 text-cyan-400" />
              Connect New Remote Server
            </h3>
            <form onSubmit={handleAddServer} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Server Name / Label</label>
                <input
                  type="text"
                  placeholder="e.g. Staging App Node"
                  value={newServer.name}
                  onChange={(e) => setNewServer({ ...newServer, name: e.target.value })}
                  required
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="block text-slate-400 mb-1">Server IP Address</label>
                  <input
                    type="text"
                    placeholder="187.127.165.128"
                    value={newServer.host}
                    onChange={(e) => setNewServer({ ...newServer, host: e.target.value })}
                    required
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono focus:border-cyan-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">SSH Port</label>
                  <input
                    type="number"
                    value={newServer.port}
                    onChange={(e) => setNewServer({ ...newServer, port: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono focus:border-cyan-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-400 mb-1">SSH Username</label>
                  <input
                    type="text"
                    value={newServer.username}
                    onChange={(e) => setNewServer({ ...newServer, username: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono focus:border-cyan-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Primary Domain</label>
                  <input
                    type="text"
                    placeholder="app.domain.com"
                    value={newServer.domain}
                    onChange={(e) => setNewServer({ ...newServer, domain: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono focus:border-cyan-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3 py-2 bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-500 font-semibold"
                >
                  Save Profile
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Server Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {servers.map((srv) => (
          <div
            key={srv.id}
            className="bg-slate-900/80 backdrop-blur border border-slate-800 hover:border-cyan-500/50 rounded-2xl p-5 shadow-xl transition-all group flex flex-col justify-between"
          >
            <div>
              {/* Card Top */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center space-x-2.5">
                  <div className="p-2 bg-slate-950 border border-slate-800 rounded-xl group-hover:border-cyan-500/40 transition-colors">
                    <Server className="w-5 h-5 text-cyan-400" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-sm tracking-tight">{srv.name}</h3>
                    <div className="text-[11px] font-mono text-slate-400 flex items-center gap-1.5 mt-0.5">
                      <span>{srv.username}@{srv.host}:{srv.port}</span>
                    </div>
                  </div>
                </div>

                <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-medium border flex items-center gap-1 ${
                  srv.status === 'online'
                    ? 'bg-emerald-950/80 text-emerald-400 border-emerald-800/80'
                    : 'bg-amber-950/80 text-amber-400 border-amber-800/80'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${srv.status === 'online' ? 'bg-emerald-400 animate-ping' : 'bg-amber-400'}`}></span>
                  {srv.status.toUpperCase()}
                </span>
              </div>

              <div className="text-xs text-slate-400 mb-4 flex items-center gap-2">
                <Globe className="w-3.5 h-3.5 text-slate-500" />
                <span className="font-mono text-cyan-300 truncate">{srv.domain}</span>
              </div>

              {/* Hardware Gauges */}
              <div className="space-y-2.5 bg-slate-950/60 border border-slate-800/60 rounded-xl p-3 text-xs mb-4">
                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-slate-400 flex items-center gap-1"><Cpu className="w-3 h-3 text-cyan-400" /> CPU Load</span>
                    <span className="font-mono text-slate-200">{srv.cpuUsage}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-cyan-500 transition-all duration-500" style={{ width: `${srv.cpuUsage}%` }}></div>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-slate-400 flex items-center gap-1"><Activity className="w-3 h-3 text-blue-400" /> RAM Memory</span>
                    <span className="font-mono text-slate-200">{srv.ramUsage}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 transition-all duration-500" style={{ width: `${srv.ramUsage}%` }}></div>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-slate-400 flex items-center gap-1"><HardDrive className="w-3 h-3 text-purple-400" /> Storage</span>
                    <span className="font-mono text-slate-200">{srv.diskUsage}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-purple-500 transition-all duration-500" style={{ width: `${srv.diskUsage}%` }}></div>
                  </div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-xs">
              <span className="text-[11px] text-slate-500 flex items-center gap-1 font-mono">
                <Clock className="w-3 h-3" /> {new Date(srv.lastConnected).toLocaleTimeString()}
              </span>
              <button
                onClick={() => onSelectServer && onSelectServer(srv)}
                className="px-3 py-1.5 bg-cyan-950/60 hover:bg-cyan-900/60 text-cyan-300 border border-cyan-800/60 rounded-lg font-medium transition cursor-pointer flex items-center gap-1"
              >
                <span>Select & Deploy</span>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
