import React, { useState, useEffect } from 'react'
import { Server, ChevronDown, Plus, Check, Globe, Cpu, Activity, RefreshCw, Layers, Cloud } from 'lucide-react'

export default function ServerSelectorDropdown({ activeServerId, onServerSelect, apiBaseUrl = '' }) {
  const [servers, setServers] = useState([])
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)

  // New server form state
  const [serverType, setServerType] = useState('vps')
  const [newServer, setNewServer] = useState({
    name: '',
    ipAddress: '',
    port: 22,
    username: 'root',
    password: '',
    domain: '',
    provider: 'cpanel',
    ftpHost: '',
    ftpUser: '',
    ftpPassword: '',
    cloudProvider: 'aws'
  })

  const fetchServers = async () => {
    setLoading(true)
    try {
      const token = localStorage.getItem('autodeploy_token')
      const res = await fetch(`${apiBaseUrl}/api/agent/servers`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json()
      if (data.servers) {
        setServers(data.servers)
      }
    } catch (err) {
      console.error('Failed to fetch organization servers:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchServers()
  }, [])

  const currentServer = servers.find(s => s.id === activeServerId) || servers[0] || {
    id: 'srv-default',
    name: 'Production Server Node 01',
    ipAddress: '187.127.165.128',
    serverType: 'vps',
    status: 'online'
  }

  const handleAddServer = async (e) => {
    e.preventDefault()
    try {
      const token = localStorage.getItem('autodeploy_token')
      const res = await fetch(`${apiBaseUrl}/api/agent/servers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          ...newServer,
          serverType
        })
      })
      const data = await res.json()
      if (data.success && data.server) {
        setShowAddModal(false)
        fetchServers()
        if (onServerSelect) onServerSelect(data.server.id)
      }
    } catch (err) {
      alert('Failed to add server: ' + err.message)
    }
  }

  const getTypeIcon = (type) => {
    const t = (type || 'vps').toLowerCase()
    if (t === 'shared') return <Layers className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
    if (t === 'cloud') return <Cloud className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
    return <Server className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
  }

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center space-x-2.5 px-3 py-1.5 bg-slate-900 border border-slate-700/80 hover:border-cyan-500/50 rounded-xl text-xs font-semibold text-slate-200 transition-all shadow-sm cursor-pointer"
      >
        <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        {getTypeIcon(currentServer.serverType)}
        <span className="max-w-[140px] truncate">{currentServer.name}</span>
        <span className="font-mono text-[10px] text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">
          {currentServer.ipAddress || currentServer.ftpHost || currentServer.hostname || '0.0.0.0'}
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
      </button>

      {isOpen && (
        <div className="absolute left-0 mt-2 w-72 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl z-50 overflow-hidden backdrop-blur-xl">
          <div className="p-2.5 border-b border-slate-800 flex items-center justify-between text-[11px] font-bold text-slate-400 uppercase tracking-wider">
            <span>Your Connected Servers ({servers.length})</span>
            <button onClick={fetchServers} className="hover:text-cyan-400 cursor-pointer">
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="max-h-60 overflow-y-auto p-1.5 space-y-1">
            {servers.map((srv) => (
              <button
                key={srv.id}
                onClick={() => {
                  if (onServerSelect) onServerSelect(srv.id)
                  setIsOpen(false)
                }}
                className={`w-full flex items-center justify-between p-2 rounded-lg text-left text-xs transition cursor-pointer ${
                  srv.id === currentServer.id
                    ? 'bg-cyan-500/15 text-cyan-300 font-bold border border-cyan-500/30'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center space-x-2 overflow-hidden">
                  {getTypeIcon(srv.serverType)}
                  <div className="truncate">
                    <div className="truncate flex items-center gap-1.5">
                      <span>{srv.name}</span>
                      <span className="text-[9px] uppercase px-1 rounded bg-slate-800 text-slate-400">
                        {srv.serverType || 'vps'}
                      </span>
                    </div>
                    <div className="font-mono text-[10px] text-slate-400">
                      {srv.ipAddress || srv.ftpHost || srv.hostname || '0.0.0.0'}
                    </div>
                  </div>
                </div>
                {srv.id === currentServer.id && <Check className="w-4 h-4 text-cyan-400 flex-shrink-0" />}
              </button>
            ))}
          </div>

          <div className="p-2 border-t border-slate-800 bg-slate-950/60">
            <button
              onClick={() => {
                setIsOpen(false)
                setShowAddModal(true)
              }}
              className="w-full flex items-center justify-center space-x-1.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-400 font-semibold text-xs rounded-lg transition cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Connect Server (VPS/Shared/Cloud)</span>
            </button>
          </div>
        </div>
      )}

      {/* Add New Server Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-white mb-1">Connect Server Node</h3>

            <div className="grid grid-cols-3 gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-[11px] font-bold">
              <button
                type="button"
                onClick={() => setServerType('vps')}
                className={`py-1.5 rounded-lg transition ${serverType === 'vps' ? 'bg-cyan-500 text-slate-950' : 'text-slate-400'}`}
              >
                VPS Node
              </button>
              <button
                type="button"
                onClick={() => setServerType('shared')}
                className={`py-1.5 rounded-lg transition ${serverType === 'shared' ? 'bg-amber-500 text-slate-950' : 'text-slate-400'}`}
              >
                Shared Panel
              </button>
              <button
                type="button"
                onClick={() => setServerType('cloud')}
                className={`py-1.5 rounded-lg transition ${serverType === 'cloud' ? 'bg-purple-500 text-slate-950' : 'text-slate-400'}`}
              >
                Cloud VM
              </button>
            </div>

            <form onSubmit={handleAddServer} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 mb-1 font-semibold">Server Name / Label</label>
                <input
                  type="text"
                  required
                  placeholder="My Production Node"
                  value={newServer.name}
                  onChange={(e) => setNewServer({ ...newServer, name: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 mb-1 font-semibold">
                  {serverType === 'shared' ? 'FTP Host / Panel Domain' : 'Server IPv4 / Hostname'}
                </label>
                <input
                  type="text"
                  required
                  placeholder={serverType === 'shared' ? 'ftp.domain.com' : '187.127.165.128'}
                  value={newServer.ipAddress}
                  onChange={(e) => setNewServer({ ...newServer, ipAddress: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
                />
              </div>

              <div className="flex space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold rounded-xl shadow-lg shadow-cyan-500/20"
                >
                  Connect Server
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
