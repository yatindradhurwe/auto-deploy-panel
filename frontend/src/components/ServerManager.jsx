import React, { useState, useEffect } from 'react'
import { Server, Activity, Cpu, HardDrive, ShieldCheck, Plus, RefreshCw, Terminal, CheckCircle2, Clock, Globe, Key, AlertTriangle, Cloud, Layers, Database, Lock, Eye, Trash2, X } from 'lucide-react'

export default function ServerManager({ jwtToken, activeServer, onSelectServer }) {
  const [servers, setServers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [selectedServerDetails, setSelectedServerDetails] = useState(null)
  const [saving, setSaving] = useState(false)

  // Server Type selection for connection form
  const [serverType, setServerType] = useState('vps') // 'vps' | 'shared' | 'cloud'

  // Form State
  const [newServer, setNewServer] = useState({
    name: '',
    // VPS Fields
    host: '',
    port: 22,
    username: 'root',
    password: '',
    sshKey: '',
    domain: '',
    // Shared Server Fields
    provider: 'cpanel', // 'cpanel', 'directadmin', 'custom_ftp'
    cpanelUrl: '',
    cpanelUser: '',
    cpanelApiToken: '',
    ftpHost: '',
    ftpPort: 21,
    ftpUser: '',
    ftpPassword: '',
    webRootPath: '/public_html',
    sharedDbHost: '',
    sharedDbUser: '',
    sharedDbPassword: '',
    // Cloud Server Fields
    cloudProvider: 'aws', // 'aws', 'digitalocean', 'gcp', 'hetzner', 'vultr'
    cloudApiKey: '',
    cloudRegion: 'us-east-1',
    cloudInstanceId: ''
  })

  useEffect(() => {
    fetchServers()
  }, [])

  const fetchServers = async () => {
    setLoading(true)
    try {
      const token = jwtToken || localStorage.getItem('autodeploy_token')
      const res = await fetch('/api/agent/servers', {
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json()
      if (data.servers) {
        setServers(data.servers)
      }
    } catch (e) {
      console.error('Failed to load servers', e)
    } finally {
      setLoading(false)
    }
  }

  const handleAddServer = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const token = jwtToken || localStorage.getItem('autodeploy_token')
      const bodyPayload = {
        name: newServer.name,
        serverType,
        domain: newServer.domain,
        // VPS
        ipAddress: newServer.host,
        port: parseInt(newServer.port, 10) || (serverType === 'shared' ? 21 : 22),
        username: newServer.username,
        password: newServer.password,
        sshKey: newServer.sshKey,
        // Shared
        provider: newServer.provider,
        cpanelUrl: newServer.cpanelUrl,
        cpanelUser: newServer.cpanelUser,
        cpanelApiToken: newServer.cpanelApiToken,
        ftpHost: newServer.ftpHost,
        ftpPort: parseInt(newServer.ftpPort, 10) || 21,
        ftpUser: newServer.ftpUser,
        ftpPassword: newServer.ftpPassword,
        webRootPath: newServer.webRootPath,
        sharedDbHost: newServer.sharedDbHost,
        sharedDbUser: newServer.sharedDbUser,
        sharedDbPassword: newServer.sharedDbPassword,
        // Cloud
        cloudProvider: newServer.cloudProvider,
        cloudApiKey: newServer.cloudApiKey,
        cloudRegion: newServer.cloudRegion,
        cloudInstanceId: newServer.cloudInstanceId
      }

      const res = await fetch('/api/agent/servers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(bodyPayload)
      })

      const data = await res.json()
      if (data.success && data.server) {
        setServers(prev => [data.server, ...prev])
        setShowAddModal(false)
        resetForm()
      } else {
        alert(data.error || 'Failed to connect server')
      }
    } catch (err) {
      alert('Error connecting server: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteServer = async (serverId, e) => {
    e.stopPropagation()
    if (!confirm('Are you sure you want to disconnect this server node?')) return
    try {
      const token = jwtToken || localStorage.getItem('autodeploy_token')
      const res = await fetch(`/api/agent/servers/${serverId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json()
      if (data.success) {
        setServers(prev => prev.filter(s => s.id !== serverId))
        if (selectedServerDetails?.id === serverId) setSelectedServerDetails(null)
      }
    } catch (err) {
      alert('Failed to delete server: ' + err.message)
    }
  }

  const resetForm = () => {
    setNewServer({
      name: '',
      host: '',
      port: 22,
      username: 'root',
      password: '',
      sshKey: '',
      domain: '',
      provider: 'cpanel',
      cpanelUrl: '',
      cpanelUser: '',
      cpanelApiToken: '',
      ftpHost: '',
      ftpPort: 21,
      ftpUser: '',
      ftpPassword: '',
      webRootPath: '/public_html',
      sharedDbHost: '',
      sharedDbUser: '',
      sharedDbPassword: '',
      cloudProvider: 'aws',
      cloudApiKey: '',
      cloudRegion: 'us-east-1',
      cloudInstanceId: ''
    })
    setServerType('vps')
  }

  const renderTypeBadge = (type) => {
    const t = (type || 'vps').toLowerCase()
    if (t === 'shared') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-[10px] font-bold uppercase">
          <Layers className="w-3 h-3" /> Shared Server
        </span>
      )
    } else if (t === 'cloud') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-purple-500/10 border border-purple-500/30 text-purple-400 text-[10px] font-bold uppercase">
          <Cloud className="w-3 h-3" /> Cloud VM
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-[10px] font-bold uppercase">
        <Server className="w-3 h-3" /> VPS Node
      </span>
    )
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
              Server Connections Manager
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-cyan-950 border border-cyan-800 text-cyan-400 font-mono font-semibold">
                {servers.length} Connected
              </span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Connect & manage Linux VPS, Shared Hosting (cPanel/FTP), and Cloud Infrastructure (AWS, DO, GCP)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchServers}
            className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-xl transition cursor-pointer"
            title="Refresh Servers"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-semibold rounded-xl shadow-lg shadow-cyan-950/30 flex items-center gap-2 transition cursor-pointer text-xs"
          >
            <Plus className="w-4 h-4" />
            <span>Connect Server Node</span>
          </button>
        </div>
      </div>

      {/* Add Server Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full max-w-xl shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Server className="w-5 h-5 text-cyan-400" />
                Connect New Server (VPS, Shared, Cloud)
              </h3>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Server Type Switcher Tabs */}
            <div className="grid grid-cols-3 gap-2 bg-slate-950 p-1.5 rounded-xl border border-slate-800 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setServerType('vps')}
                className={`py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 transition ${
                  serverType === 'vps'
                    ? 'bg-cyan-500 text-slate-950 font-bold shadow'
                    : 'text-slate-400 hover:text-white hover:bg-slate-900'
                }`}
              >
                <Server className="w-4 h-4" />
                <span>VPS Server</span>
              </button>
              <button
                type="button"
                onClick={() => setServerType('shared')}
                className={`py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 transition ${
                  serverType === 'shared'
                    ? 'bg-amber-500 text-slate-950 font-bold shadow'
                    : 'text-slate-400 hover:text-white hover:bg-slate-900'
                }`}
              >
                <Layers className="w-4 h-4" />
                <span>Shared Server</span>
              </button>
              <button
                type="button"
                onClick={() => setServerType('cloud')}
                className={`py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 transition ${
                  serverType === 'cloud'
                    ? 'bg-purple-500 text-slate-950 font-bold shadow'
                    : 'text-slate-400 hover:text-white hover:bg-slate-900'
                }`}
              >
                <Cloud className="w-4 h-4" />
                <span>Cloud Server</span>
              </button>
            </div>

            <form onSubmit={handleAddServer} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-300 mb-1 font-semibold">Server Name / Label</label>
                <input
                  type="text"
                  placeholder={
                    serverType === 'shared' ? 'e.g. Hostinger cPanel Account' :
                    serverType === 'cloud' ? 'e.g. AWS Production EC2' : 'e.g. Ubuntu VPS Node 01'
                  }
                  value={newServer.name}
                  onChange={(e) => setNewServer({ ...newServer, name: e.target.value })}
                  required
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono focus:border-cyan-500 focus:outline-none"
                />
              </div>

              {/* VPS FIELDS */}
              {serverType === 'vps' && (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-2">
                      <label className="block text-slate-300 mb-1 font-semibold">Server IP Address / Host</label>
                      <input
                        type="text"
                        placeholder="187.127.165.128"
                        value={newServer.host}
                        onChange={(e) => setNewServer({ ...newServer, host: e.target.value })}
                        required
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono focus:border-cyan-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-300 mb-1 font-semibold">SSH Port</label>
                      <input
                        type="number"
                        value={newServer.port}
                        onChange={(e) => setNewServer({ ...newServer, port: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono focus:border-cyan-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-slate-300 mb-1 font-semibold">SSH Username</label>
                      <input
                        type="text"
                        value={newServer.username}
                        onChange={(e) => setNewServer({ ...newServer, username: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono focus:border-cyan-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-300 mb-1 font-semibold">SSH Root/User Password</label>
                      <input
                        type="password"
                        placeholder="••••••••"
                        value={newServer.password}
                        onChange={(e) => setNewServer({ ...newServer, password: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono focus:border-cyan-500 focus:outline-none"
                      />
                    </div>
                  </div>
                </>
              )}

              {/* SHARED HOSTING FIELDS */}
              {serverType === 'shared' && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-slate-300 mb-1 font-semibold">Hosting Panel Type</label>
                      <select
                        value={newServer.provider}
                        onChange={(e) => setNewServer({ ...newServer, provider: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:border-amber-500 focus:outline-none"
                      >
                        <option value="cpanel">cPanel (WHM / Hostinger / GoDaddy)</option>
                        <option value="directadmin">DirectAdmin Panel</option>
                        <option value="custom_ftp">FTP / SFTP Shared Webhost</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-slate-300 mb-1 font-semibold">Panel / Host URL</label>
                      <input
                        type="text"
                        placeholder="https://cpanel.domain.com:2083"
                        value={newServer.cpanelUrl}
                        onChange={(e) => setNewServer({ ...newServer, cpanelUrl: e.target.value, host: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono focus:border-amber-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-2">
                      <label className="block text-slate-300 mb-1 font-semibold">FTP Host / Server IP</label>
                      <input
                        type="text"
                        placeholder="ftp.yourdomain.com"
                        value={newServer.ftpHost}
                        onChange={(e) => setNewServer({ ...newServer, ftpHost: e.target.value })}
                        required
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono focus:border-amber-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-300 mb-1 font-semibold">FTP Port</label>
                      <input
                        type="number"
                        value={newServer.ftpPort}
                        onChange={(e) => setNewServer({ ...newServer, ftpPort: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono focus:border-amber-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-slate-300 mb-1 font-semibold">FTP Username</label>
                      <input
                        type="text"
                        placeholder="myuser@domain.com"
                        value={newServer.ftpUser}
                        onChange={(e) => setNewServer({ ...newServer, ftpUser: e.target.value })}
                        required
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono focus:border-amber-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-300 mb-1 font-semibold">FTP Password</label>
                      <input
                        type="password"
                        placeholder="••••••••"
                        value={newServer.ftpPassword}
                        onChange={(e) => setNewServer({ ...newServer, ftpPassword: e.target.value })}
                        required
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono focus:border-amber-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-slate-300 mb-1 font-semibold">Web Root Directory</label>
                      <input
                        type="text"
                        placeholder="/public_html"
                        value={newServer.webRootPath}
                        onChange={(e) => setNewServer({ ...newServer, webRootPath: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono focus:border-amber-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-300 mb-1 font-semibold">cPanel API Token (Optional)</label>
                      <input
                        type="text"
                        placeholder="API Token for automation"
                        value={newServer.cpanelApiToken}
                        onChange={(e) => setNewServer({ ...newServer, cpanelApiToken: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono focus:border-amber-500 focus:outline-none"
                      />
                    </div>
                  </div>
                </>
              )}

              {/* CLOUD SERVER FIELDS */}
              {serverType === 'cloud' && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-slate-300 mb-1 font-semibold">Cloud Infrastructure Provider</label>
                      <select
                        value={newServer.cloudProvider}
                        onChange={(e) => setNewServer({ ...newServer, cloudProvider: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:border-purple-500 focus:outline-none"
                      >
                        <option value="aws">Amazon Web Services (AWS EC2)</option>
                        <option value="digitalocean">DigitalOcean Droplet</option>
                        <option value="gcp">Google Cloud Platform (GCP Compute)</option>
                        <option value="hetzner">Hetzner Cloud VM</option>
                        <option value="vultr">Vultr Cloud Compute</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-slate-300 mb-1 font-semibold">Region / Zone</label>
                      <input
                        type="text"
                        placeholder="us-east-1 / nyc1"
                        value={newServer.cloudRegion}
                        onChange={(e) => setNewServer({ ...newServer, cloudRegion: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono focus:border-purple-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-slate-300 mb-1 font-semibold">Public IP / Host</label>
                      <input
                        type="text"
                        placeholder="54.210.12.99"
                        value={newServer.host}
                        onChange={(e) => setNewServer({ ...newServer, host: e.target.value })}
                        required
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono focus:border-purple-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-300 mb-1 font-semibold">Instance ID / Droplet ID</label>
                      <input
                        type="text"
                        placeholder="i-08a1b2c3d4e5 / 3849102"
                        value={newServer.cloudInstanceId}
                        onChange={(e) => setNewServer({ ...newServer, cloudInstanceId: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono focus:border-purple-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-slate-300 mb-1 font-semibold">Cloud API Token / Access Key</label>
                    <input
                      type="password"
                      placeholder="AKIAIOSFODNN7EXAMPLE / dop_v1_..."
                      value={newServer.cloudApiKey}
                      onChange={(e) => setNewServer({ ...newServer, cloudApiKey: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono focus:border-purple-500 focus:outline-none"
                    />
                  </div>
                </>
              )}

              <div>
                <label className="block text-slate-300 mb-1 font-semibold">Primary Domain (Optional)</label>
                <input
                  type="text"
                  placeholder="app.mycompany.com"
                  value={newServer.domain}
                  onChange={(e) => setNewServer({ ...newServer, domain: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 rounded-xl hover:bg-slate-700 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 text-white font-bold rounded-xl hover:from-cyan-500 hover:to-blue-500 shadow-lg shadow-cyan-950/40"
                >
                  {saving ? 'Connecting...' : 'Connect Server'}
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
            onClick={() => onSelectServer && onSelectServer(srv.id)}
            className="bg-slate-900/80 backdrop-blur border border-slate-800 hover:border-cyan-500/50 rounded-2xl p-5 shadow-xl transition-all group flex flex-col justify-between cursor-pointer"
          >
            <div>
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center space-x-2.5">
                  <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-xl group-hover:border-cyan-500/40 transition-colors">
                    <Server className="w-5 h-5 text-cyan-400" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-sm group-hover:text-cyan-300 transition-colors">
                      {srv.name}
                    </h3>
                    <div className="font-mono text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5">
                      <Globe className="w-3 h-3 text-slate-500" />
                      <span>{srv.ipAddress || srv.hostname || srv.ftpHost || '0.0.0.0'}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  {renderTypeBadge(srv.serverType)}
                  <button
                    onClick={(e) => handleDeleteServer(srv.id, e)}
                    className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition"
                    title="Disconnect Server"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Specs & Hardware load */}
              <div className="grid grid-cols-3 gap-2 my-4 bg-slate-950 p-2.5 rounded-xl border border-slate-800/80 text-center">
                <div>
                  <div className="text-[10px] text-slate-400 uppercase font-semibold">CPU</div>
                  <div className="text-xs font-bold text-cyan-400 font-mono mt-0.5">{srv.cpu || 12}%</div>
                </div>
                <div className="border-x border-slate-800">
                  <div className="text-[10px] text-slate-400 uppercase font-semibold">RAM</div>
                  <div className="text-xs font-bold text-emerald-400 font-mono mt-0.5">{srv.ram || 45}%</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400 uppercase font-semibold">DISK</div>
                  <div className="text-xs font-bold text-purple-400 font-mono mt-0.5">{srv.disk || 36}%</div>
                </div>
              </div>

              {srv.domain && (
                <div className="flex items-center justify-between text-[11px] text-slate-400 bg-slate-950/50 px-3 py-1.5 rounded-lg border border-slate-800 font-mono">
                  <span>Domain</span>
                  <span className="text-slate-200">{srv.domain}</span>
                </div>
              )}
            </div>

            <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 text-emerald-400 font-semibold">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>{srv.status || 'online'}</span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    if (onSelectServer) onSelectServer(srv.id)
                  }}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition flex items-center gap-1 cursor-pointer ${
                    srv.id === activeServer?.id
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm shadow-emerald-500/10'
                      : 'bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700'
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {srv.id === activeServer?.id ? 'Active Selected Node' : 'Switch Server'}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setSelectedServerDetails(srv)
                  }}
                  className="text-slate-400 hover:text-cyan-300 font-medium flex items-center gap-1 text-[11px] p-1"
                >
                  <Eye className="w-3.5 h-3.5" /> Details
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Server Details Inspector Drawer/Modal */}
      {selectedServerDetails && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full max-w-lg shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <Server className="w-5 h-5 text-cyan-400" />
                <h3 className="font-bold text-white text-base">{selectedServerDetails.name}</h3>
              </div>
              <button onClick={() => setSelectedServerDetails(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex justify-between items-center bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                <span className="text-slate-400">Server Type:</span>
                <div>{renderTypeBadge(selectedServerDetails.serverType)}</div>
              </div>

              <div className="grid grid-cols-2 gap-2 font-mono">
                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase">IP Address / Host</div>
                  <div className="text-slate-200 font-bold mt-0.5">
                    {selectedServerDetails.ipAddress || selectedServerDetails.hostname || 'N/A'}
                  </div>
                </div>

                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase">Port / Protocol</div>
                  <div className="text-slate-200 font-bold mt-0.5">
                    Port {selectedServerDetails.port || 22}
                  </div>
                </div>
              </div>

              {selectedServerDetails.serverType === 'shared' && (
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2 font-mono">
                  <div className="text-[11px] font-bold text-amber-400 uppercase">Shared Hosting Details</div>
                  {selectedServerDetails.cpanelUrl && (
                    <div className="flex justify-between"><span className="text-slate-500">Panel URL:</span> <span className="text-slate-200">{selectedServerDetails.cpanelUrl}</span></div>
                  )}
                  {selectedServerDetails.ftpHost && (
                    <div className="flex justify-between"><span className="text-slate-500">FTP Host:</span> <span className="text-slate-200">{selectedServerDetails.ftpHost}</span></div>
                  )}
                  {selectedServerDetails.ftpUser && (
                    <div className="flex justify-between"><span className="text-slate-500">FTP User:</span> <span className="text-slate-200">{selectedServerDetails.ftpUser}</span></div>
                  )}
                  {selectedServerDetails.webRootPath && (
                    <div className="flex justify-between"><span className="text-slate-500">Web Root:</span> <span className="text-slate-200">{selectedServerDetails.webRootPath}</span></div>
                  )}
                </div>
              )}

              {selectedServerDetails.serverType === 'cloud' && (
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2 font-mono">
                  <div className="text-[11px] font-bold text-purple-400 uppercase">Cloud VM Infrastructure</div>
                  <div className="flex justify-between"><span className="text-slate-500">Provider:</span> <span className="text-slate-200 uppercase">{selectedServerDetails.cloudProvider || 'AWS'}</span></div>
                  {selectedServerDetails.cloudRegion && (
                    <div className="flex justify-between"><span className="text-slate-500">Region:</span> <span className="text-slate-200">{selectedServerDetails.cloudRegion}</span></div>
                  )}
                  {selectedServerDetails.cloudInstanceId && (
                    <div className="flex justify-between"><span className="text-slate-500">Instance ID:</span> <span className="text-slate-200">{selectedServerDetails.cloudInstanceId}</span></div>
                  )}
                </div>
              )}

              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex justify-between items-center">
                <span className="text-slate-400 font-semibold">OS Environment</span>
                <span className="font-mono text-slate-200">{selectedServerDetails.os || 'Linux'}</span>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setSelectedServerDetails(null)}
                className="px-4 py-2 bg-slate-800 text-slate-200 rounded-xl hover:bg-slate-700 text-xs font-semibold"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
