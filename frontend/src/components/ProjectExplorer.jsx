import React, { useState, useEffect } from 'react'
import { Layers, Play, Square, RefreshCw, Cpu, Activity, Clock, Terminal, AlertCircle, CheckCircle2, ChevronRight, HardDrive, Code, DownloadCloud, X, Check, Globe, Trash2, Zap, Copy, GitBranch, Webhook, Settings } from 'lucide-react'

export default function ProjectExplorer({ jwtToken, activeServer, onOpenInStudio }) {
  const [processes, setProcesses] = useState([])
  const [serverStats, setServerStats] = useState(null)
  const [loading, setLoading] = useState(true)

  // Antigravity Auto-Update State
  const [autoUpdateConfigs, setAutoUpdateConfigs] = useState({})
  const [autoUpdateModal, setAutoUpdateModal] = useState(null)
  const [copiedWebhook, setCopiedWebhook] = useState(false)
  const [savingAutoUpdate, setSavingAutoUpdate] = useState(false)
  const [triggeringAutoSync, setTriggeringAutoSync] = useState(false)

  // Live Update Modal State
  const [updatingAppName, setUpdatingAppName] = useState(null)
  const [updateLogModal, setUpdateLogModal] = useState(null)

  // Delete Project Confirmation Modal State
  const [deleteModal, setDeleteModal] = useState(null)

  useEffect(() => {
    fetchMetrics()
    fetchAutoUpdateConfigs()
  }, [activeServer])

  const fetchAutoUpdateConfigs = async () => {
    try {
      const res = await fetch('/api/studio/autoupdate/list', {
        headers: { 'Authorization': `Bearer ${jwtToken}` }
      })
      const data = await res.json()
      if (data.success && data.configs) {
        setAutoUpdateConfigs(data.configs)
      }
    } catch (e) {
      console.warn('Failed to load auto-update configs:', e)
    }
  }

  const fetchMetrics = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/studio/server-metrics', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify({ host: activeServer ? activeServer.host : '187.127.165.128' })
      })
      const data = await res.json()
      if (data.success) {
        setProcesses(data.processes)
        setServerStats(data.server)
      }
    } catch (e) {
      console.error('Failed to fetch PM2 processes', e)
    } finally {
      setLoading(false)
    }
  }

  const toggleProcessState = (pmId) => {
    setProcesses((prev) =>
      prev.map((proc) => {
        if (proc.pm_id === pmId) {
          const isOnline = proc.status === 'online'
          return { ...proc, status: isOnline ? 'stopped' : 'online' }
        }
        return proc
      })
    )
  }

  const handlePullAndUpdate = async (appName, projectPath) => {
    setUpdatingAppName(appName)
    setUpdateLogModal({
      appName,
      status: 'running',
      title: `Updating '${appName}' from GitHub`,
      logs: `[1/3] Connecting to live server (${activeServer ? activeServer.host : '187.127.165.128'})...\n[2/3] Pulling latest code changes & building dependencies...\n`
    })

    try {
      const res = await fetch('/api/studio/git/pull-and-update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify({
          host: activeServer ? activeServer.host : '187.127.165.128',
          appName,
          projectPath,
          branch: 'main'
        })
      })

      const data = await res.json()

      if (data.success) {
        setUpdateLogModal({
          appName,
          status: 'success',
          title: `🎉 Successfully Updated '${appName}'!`,
          logs: data.output || (data.logs ? data.logs.map(l => l.text).join('') : 'Update complete.')
        })
        fetchMetrics()
      } else {
        setUpdateLogModal({
          appName,
          status: 'failed',
          title: `❌ Failed to Update '${appName}'`,
          logs: data.error + '\n\n' + (data.output || '')
        })
      }
    } catch (err) {
      setUpdateLogModal({
        appName,
        status: 'failed',
        title: `❌ Failed to Update '${appName}'`,
        logs: `Network error: ${err.message}`
      })
    } finally {
      setUpdatingAppName(null)
    }
  }

  const handleOpenAutoUpdateModal = async (appName, projectPath) => {
    try {
      const res = await fetch(`/api/studio/autoupdate/config/${appName}`, {
        headers: { 'Authorization': `Bearer ${jwtToken}` }
      })
      const data = await res.json()
      if (data.success && data.config) {
        setAutoUpdateModal({
          ...data.config,
          appName,
          projectPath: data.config.projectPath || projectPath || `/var/www/${appName}`
        })
      }
    } catch (e) {
      console.error('Failed to fetch auto-update modal data:', e)
    }
  }

  const handleSaveAutoUpdateConfig = async () => {
    if (!autoUpdateModal) return
    setSavingAutoUpdate(true)
    try {
      const res = await fetch('/api/studio/autoupdate/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify(autoUpdateModal)
      })
      const data = await res.json()
      if (data.success) {
        fetchAutoUpdateConfigs()
        alert(`Antigravity Auto-Update settings saved for '${autoUpdateModal.appName}'!`)
      } else {
        alert(`Save Error: ${data.error}`)
      }
    } catch (err) {
      alert(`Save Failed: ${err.message}`)
    } finally {
      setSavingAutoUpdate(false)
    }
  }

  const handleTriggerAutoSyncNow = async () => {
    if (!autoUpdateModal) return
    setTriggeringAutoSync(true)
    try {
      const res = await fetch('/api/studio/autoupdate/trigger-now', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify({ appName: autoUpdateModal.appName })
      })
      const data = await res.json()
      if (data.success) {
        alert(`🎉 Antigravity Auto-Sync completed for '${autoUpdateModal.appName}'!`)
        handleOpenAutoUpdateModal(autoUpdateModal.appName, autoUpdateModal.projectPath)
        fetchMetrics()
        fetchAutoUpdateConfigs()
      } else {
        alert(`Auto-Sync Error: ${data.error || 'Failed'}`)
      }
    } catch (err) {
      alert(`Auto-Sync Request Failed: ${err.message}`)
    } finally {
      setTriggeringAutoSync(false)
    }
  }

  const handleConfirmDeleteProject = async () => {
    if (!deleteModal) return
    setDeleteModal((prev) => ({ ...prev, deleting: true }))
    try {
      const res = await fetch('/api/studio/projects/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify({
          host: activeServer ? activeServer.host : '187.127.165.128',
          appName: deleteModal.appName,
          projectPath: deleteModal.projectPath,
          domain: deleteModal.domain,
          deletePm2: deleteModal.deletePm2,
          deleteFiles: deleteModal.deleteFiles,
          deleteNginx: deleteModal.deleteNginx
        })
      })

      const data = await res.json()
      if (data.success) {
        alert(`Project '${deleteModal.appName}' deleted successfully from live server!`)
        setDeleteModal(null)
        fetchMetrics()
      } else {
        alert(`Delete Error: ${data.error}`)
      }
    } catch (err) {
      alert(`Delete Request Failed: ${err.message}`)
    } finally {
      setDeleteModal((prev) => (prev ? { ...prev, deleting: false } : null))
    }
  }

  const handleRealTimeFetch = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/studio/projects/realtime-fetch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify({ host: activeServer ? activeServer.host : '187.127.165.128' })
      })
      const data = await res.json()
      if (data.success) {
        fetchMetrics()
        fetchAutoUpdateConfigs()
        alert(`🎉 Real-Time scan completed! Sync data updated from live server & GitHub.`)
      }
    } catch (e) {
      console.error('Real-Time fetch error:', e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6 font-sans">
      {/* Header Banner - Apple Glassmorphism + AWS Telemetry */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/60 backdrop-blur-2xl border border-white/10 rounded-3xl p-6 shadow-2xl shadow-slate-950/50">
        <div className="flex items-center space-x-4">
          <div className="p-3.5 rounded-2xl bg-purple-500/10 border border-purple-500/30 text-purple-400 ring-1 ring-purple-500/20 shadow-md">
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-extrabold text-white tracking-tight flex items-center gap-2.5">
              Projects & PM2 Cloud Services Explorer
              <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-purple-950/90 border border-purple-800 text-purple-300 font-mono font-bold">
                PM2 Engine
              </span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5 font-mono">
              Active Host Node: <span className="text-cyan-300 font-bold">{activeServer ? activeServer.host : '187.127.165.128'}</span> ({processes.length} Active Cloud Services Tracked)
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => setDeleteModal({
              appName: '',
              projectPath: '/var/www/',
              domain: '',
              deletePm2: true,
              deleteFiles: true,
              deleteNginx: true,
              deleting: false
            })}
            className="px-4 py-2 bg-rose-950/70 hover:bg-rose-900/90 text-rose-200 border border-rose-800/80 rounded-2xl transition cursor-pointer flex items-center gap-1.5 text-xs font-bold shadow-md shadow-rose-950/40"
            title="Delete any project, PM2 process, or website directory from the live server"
          >
            <Trash2 className="w-3.5 h-3.5 text-rose-400" />
            <span>Delete Project from Server</span>
          </button>

          <button
            onClick={handleRealTimeFetch}
            className="px-4 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold border border-cyan-400/40 rounded-2xl transition cursor-pointer flex items-center gap-2 text-xs shadow-md shadow-cyan-950/40"
            title="Scan live server /var/www directories, active PM2 processes, Nginx configs, and GitHub commits in real time"
          >
            <Zap className={`w-3.5 h-3.5 text-cyan-200 ${loading ? 'animate-spin' : ''}`} />
            <span>Real-Time Sync Telemetry</span>
          </button>

          <button
            onClick={fetchMetrics}
            className="px-4 py-2 bg-slate-800/80 hover:bg-slate-700/80 text-slate-200 border border-white/10 rounded-2xl transition cursor-pointer flex items-center gap-2 text-xs font-semibold shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Services Table Card - AWS EC2 Style */}
      <div className="bg-slate-900/60 backdrop-blur-2xl border border-white/10 rounded-3xl overflow-hidden shadow-2xl shadow-slate-950/50">
        <div className="p-4 border-b border-white/10 bg-slate-950/90 flex items-center justify-between text-xs">
          <span className="font-extrabold text-white tracking-wider uppercase font-mono">Active PM2 Application Services</span>
          <span className="text-slate-400 font-mono text-[11px] bg-slate-900 px-3 py-1 rounded-xl border border-white/5">Node v20.x Engine</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950/80 text-slate-400 font-mono border-b border-white/10 uppercase text-[10px] tracking-wider font-bold">
              <tr>
                <th className="py-3.5 px-5">ID</th>
                <th className="py-3.5 px-5">Application Service & Path</th>
                <th className="py-3.5 px-5">Antigravity Auto-Update</th>
                <th className="py-3.5 px-5">Status</th>
                <th className="py-3.5 px-5">CPU Load</th>
                <th className="py-3.5 px-5">Memory Usage</th>
                <th className="py-3.5 px-5">Restarts</th>
                <th className="py-3.5 px-5 text-right">Service Actions & Studio IDE</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 font-mono">
              {processes.map((proc) => (
                <tr key={proc.pm_id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="py-4 px-5 text-slate-400 font-bold">#{proc.pm_id}</td>
                  <td className="py-4 px-5">
                    <div className="font-extrabold text-white text-xs">{proc.name}</div>
                    <div className="text-[10px] text-slate-500 font-mono mt-0.5">{proc.cwd || `/var/www/${proc.name}`}</div>
                  </td>
                  <td className="py-4 px-5">
                    {autoUpdateConfigs[proc.name]?.enabled ? (
                      <span
                        onClick={() => handleOpenAutoUpdateModal(proc.name, proc.cwd)}
                        className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-cyan-950/80 text-cyan-300 border border-cyan-500/40 inline-flex items-center gap-1.5 cursor-pointer hover:bg-cyan-900/80 transition"
                        title="Click to configure project-wise Antigravity Auto-Update settings"
                      >
                        <Zap className="w-3 h-3 text-cyan-400 animate-pulse" />
                        <span>⚡ Auto-Update ON</span>
                      </span>
                    ) : (
                      <span
                        onClick={() => handleOpenAutoUpdateModal(proc.name, proc.cwd)}
                        className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-950/80 text-slate-400 border border-slate-800 inline-flex items-center gap-1.5 cursor-pointer hover:bg-slate-900 transition"
                        title="Click to enable project-wise Antigravity Auto-Update settings"
                      >
                        <Zap className="w-3 h-3 text-slate-500" />
                        <span>⏸ OFF</span>
                      </span>
                    )}
                  </td>
                  <td className="py-4 px-5">
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border inline-flex items-center gap-1.5 shadow-sm ${
                      proc.status === 'online'
                        ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800/80'
                        : 'bg-rose-950/80 text-rose-300 border-rose-800/80'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${proc.status === 'online' ? 'bg-emerald-400 animate-pulse shadow-sm shadow-emerald-400' : 'bg-rose-400'}`}></span>
                      {proc.status.toUpperCase()}
                    </span>
                  </td>
                  <td className="py-4 px-5 text-cyan-300 font-bold">{proc.cpu}%</td>
                  <td className="py-4 px-5 text-blue-300 font-bold">{proc.memory} MB</td>
                  <td className="py-4 px-5 text-purple-300 font-bold">{proc.restarts}</td>
                  <td className="py-4 px-5 text-right space-x-2">
                    {/* Antigravity Auto-Update Settings Button */}
                    <button
                      onClick={() => handleOpenAutoUpdateModal(proc.name, proc.cwd)}
                      className="px-3 py-1.5 bg-gradient-to-r from-amber-600/30 to-orange-600/30 hover:from-amber-600/50 hover:to-orange-600/50 text-amber-200 border border-amber-500/40 rounded-xl text-[11px] transition cursor-pointer font-bold inline-flex items-center gap-1.5 shadow-md shadow-amber-950/40"
                      title="Configure Antigravity Auto-Update interval, repo branch, and GitHub Webhooks for this project"
                    >
                      <Zap className="w-3.5 h-3.5 text-amber-400" />
                      <span>Auto-Update Settings</span>
                    </button>

                    {/* 1-Click Pull & Update Live Server Button */}
                    <button
                      onClick={() => handlePullAndUpdate(proc.name, proc.cwd)}
                      disabled={updatingAppName === proc.name}
                      className="px-3 py-1.5 bg-gradient-to-r from-purple-600 via-indigo-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white border border-purple-400/40 rounded-xl text-[11px] transition cursor-pointer font-bold inline-flex items-center gap-1.5 shadow-md shadow-purple-950/40 disabled:opacity-50"
                      title="Pull latest code changes from GitHub, rebuild assets, and reload live server service"
                    >
                      <DownloadCloud className={`w-3.5 h-3.5 text-purple-200 ${updatingAppName === proc.name ? 'animate-bounce' : ''}`} />
                      <span>{updatingAppName === proc.name ? 'Updating...' : 'Pull & Update Live'}</span>
                    </button>

                    <button
                      onClick={() => onOpenInStudio && onOpenInStudio(proc.name)}
                      className="px-3 py-1.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white border border-cyan-400/30 rounded-xl text-[11px] transition cursor-pointer font-bold inline-flex items-center gap-1.5 shadow-md shadow-cyan-950/40"
                    >
                      <Code className="w-3.5 h-3.5" />
                      <span>Open in Studio</span>
                    </button>

                    <button
                      onClick={() => toggleProcessState(proc.pm_id)}
                      className={`px-3 py-1.5 rounded-xl border transition text-[11px] cursor-pointer font-semibold ${
                        proc.status === 'online'
                          ? 'bg-amber-950/40 text-amber-300 border-amber-800/60 hover:bg-amber-900/40'
                          : 'bg-emerald-950/40 text-emerald-300 border-emerald-800/60 hover:bg-emerald-900/40'
                      }`}
                    >
                      {proc.status === 'online' ? 'Stop' : 'Start'}
                    </button>

                    {/* Delete Project / Duplicate Website Button */}
                    <button
                      onClick={() => setDeleteModal({
                        appName: proc.name,
                        projectPath: proc.cwd || `/var/www/${proc.name}`,
                        domain: proc.name.includes('.com') ? proc.name : `${proc.name}.yjtechnosoft.com`,
                        deletePm2: true,
                        deleteFiles: true,
                        deleteNginx: true,
                        deleting: false
                      })}
                      className="px-3 py-1.5 bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 border border-rose-800/80 rounded-xl text-[11px] transition cursor-pointer font-bold inline-flex items-center gap-1 shadow-sm"
                      title="Delete project, duplicate website directory, PM2 service and Nginx config from server"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                      <span>Delete</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Live Server Update Terminal Modal */}
      {updateLogModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-2xl w-full p-6 space-y-4 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-3">
                <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
                  <DownloadCloud className="h-5 w-5 animate-pulse" />
                </div>
                <div>
                  <h3 className="font-extrabold text-white text-sm">{updateLogModal.title}</h3>
                  <p className="text-[11px] text-slate-400 font-mono">Live SSH execution terminal for project update</p>
                </div>
              </div>
              <button
                onClick={() => setUpdateLogModal(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Terminal Log Output */}
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 h-72 overflow-y-auto font-mono text-xs text-slate-200 leading-relaxed whitespace-pre-wrap">
              {updateLogModal.logs}
            </div>

            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center space-x-2 text-xs font-mono">
                <span className="text-slate-400">Status:</span>
                <span className={`font-bold ${
                  updateLogModal.status === 'running' ? 'text-amber-400 animate-pulse' :
                  updateLogModal.status === 'success' ? 'text-emerald-400' : 'text-rose-400'
                }`}>
                  {updateLogModal.status === 'running' ? 'Executing Update Pipeline...' :
                   updateLogModal.status === 'success' ? 'Update & Reload Complete ✓' : 'Update Failed'}
                </span>
              </div>

              <button
                onClick={() => setUpdateLogModal(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold transition"
              >
                Close Window
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Project & Duplicate Website Modal */}
      {deleteModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-rose-500/30 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-3">
                <div className="p-2 rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/20">
                  <Trash2 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-white text-sm">Delete Project / Duplicate Website</h3>
                  <p className="text-[11px] text-slate-400 font-mono">Remove service & files from live server</p>
                </div>
              </div>
              <button
                onClick={() => setDeleteModal(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3 bg-slate-950/80 p-4 rounded-2xl border border-white/5 text-xs">
              <div className="space-y-1">
                <label className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest">PM2 Process Name to Delete</label>
                <input
                  type="text"
                  value={deleteModal.appName || ''}
                  onChange={(e) => setDeleteModal({ ...deleteModal, appName: e.target.value })}
                  placeholder="e.g. my-app-backend"
                  className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-rose-400"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest">Remote Server Directory Path</label>
                <input
                  type="text"
                  value={deleteModal.projectPath || ''}
                  onChange={(e) => setDeleteModal({ ...deleteModal, projectPath: e.target.value })}
                  placeholder="e.g. /var/www/my-app"
                  className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-rose-400"
                />
              </div>

              <div className="space-y-2 pt-2 border-t border-white/10 text-slate-300">
                <label className="flex items-center space-x-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={deleteModal.deletePm2}
                    onChange={(e) => setDeleteModal({ ...deleteModal, deletePm2: e.target.checked })}
                    className="rounded border-white/10 text-rose-500 bg-slate-900"
                  />
                  <span>Stop & Delete PM2 Process (<code className="text-cyan-400">pm2 delete {deleteModal.appName}</code>)</span>
                </label>

                <label className="flex items-center space-x-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={deleteModal.deleteFiles}
                    onChange={(e) => setDeleteModal({ ...deleteModal, deleteFiles: e.target.checked })}
                    className="rounded border-white/10 text-rose-500 bg-slate-900"
                  />
                  <span>Delete Files & Directory (<code className="text-rose-400">rm -rf {deleteModal.projectPath}</code>)</span>
                </label>

                <label className="flex items-center space-x-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={deleteModal.deleteNginx}
                    onChange={(e) => setDeleteModal({ ...deleteModal, deleteNginx: e.target.checked })}
                    className="rounded border-white/10 text-rose-500 bg-slate-900"
                  />
                  <span>Delete Nginx Config & Reload Web Server</span>
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                onClick={() => setDeleteModal(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition"
              >
                Cancel
              </button>

              <button
                onClick={handleConfirmDeleteProject}
                disabled={deleteModal.deleting}
                className="px-5 py-2 bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 transition shadow-lg shadow-rose-950/40 disabled:opacity-50"
              >
                {deleteModal.deleting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                <span>{deleteModal.deleting ? 'Deleting...' : 'Confirm Permanent Deletion'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Antigravity Auto-Update Project Settings Modal */}
      {autoUpdateModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-cyan-500/40 rounded-3xl max-w-xl w-full p-6 space-y-5 shadow-2xl shadow-cyan-950/50 animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 rounded-2xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 shadow-inner">
                  <Zap className="h-6 w-6 animate-pulse" />
                </div>
                <div>
                  <h3 className="font-extrabold text-white text-base flex items-center gap-2">
                    Antigravity Auto-Update Settings
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-800 font-mono">
                      {autoUpdateModal.appName}
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400 font-mono mt-0.5">
                    Automatically pull latest changes from GitHub and deploy on live server
                  </p>
                </div>
              </div>
              <button
                onClick={() => setAutoUpdateModal(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Toggle Switch Card */}
            <div className="bg-slate-950 p-4 rounded-2xl border border-white/10 flex items-center justify-between">
              <div>
                <div className="text-xs font-bold text-white flex items-center gap-2">
                  <span>Enable Antigravity Auto-Update for this Project</span>
                  {autoUpdateModal.enabled ? (
                    <span className="text-[9px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2 py-0.2 rounded-full font-bold">ACTIVE</span>
                  ) : (
                    <span className="text-[9px] bg-slate-800 text-slate-400 px-2 py-0.2 rounded-full font-bold">DISABLED</span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                  When enabled, live server syncs automatically on GitHub push or periodic interval
                </p>
              </div>

              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(autoUpdateModal.enabled)}
                  onChange={(e) => setAutoUpdateModal({ ...autoUpdateModal, enabled: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-500"></div>
              </label>
            </div>

            {/* GitHub Webhook URL Card */}
            <div className="space-y-2 bg-slate-950/80 p-4 rounded-2xl border border-white/10">
              <div className="flex items-center justify-between text-xs">
                <label className="font-bold text-white font-mono flex items-center gap-1.5">
                  <Webhook className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Project GitHub Webhook URL</span>
                </label>
                <span className="text-[10px] text-slate-400 font-mono">1-Click Auto-Deploy on Push</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Paste this Webhook URL into your GitHub repository settings (<code className="text-cyan-300">Settings -&gt; Webhooks -&gt; Add webhook</code>):
              </p>
              <div className="bg-slate-900 border border-white/10 rounded-xl p-2.5 flex items-center justify-between gap-2">
                <span className="text-xs font-mono text-cyan-300 truncate select-all">
                  {`${window.location.origin}/api/webhooks/github/${autoUpdateModal.appName}`}
                </span>
                <button
                  onClick={() => {
                    const url = `${window.location.origin}/api/webhooks/github/${autoUpdateModal.appName}`
                    navigator.clipboard.writeText(url)
                    setCopiedWebhook(true)
                    setTimeout(() => setCopiedWebhook(false), 2000)
                  }}
                  className="px-3 py-1 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 rounded-lg text-xs font-mono flex items-center space-x-1 transition cursor-pointer shrink-0"
                >
                  {copiedWebhook ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-cyan-300" />}
                  <span>{copiedWebhook ? 'Copied!' : 'Copy URL'}</span>
                </button>
              </div>
            </div>

            {/* Frequency & Git Options */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">Sync Frequency</label>
                <select
                  value={autoUpdateModal.autoSyncInterval || 5}
                  onChange={(e) => setAutoUpdateModal({ ...autoUpdateModal, autoSyncInterval: Number(e.target.value) })}
                  className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-cyan-400"
                >
                  <option value={0}>Webhook Push Event Only</option>
                  <option value={5}>Every 5 Minutes (Auto-Check)</option>
                  <option value={15}>Every 15 Minutes (Auto-Check)</option>
                  <option value={60}>Every 1 Hour (Auto-Check)</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">Target Branch</label>
                <input
                  type="text"
                  value={autoUpdateModal.branch || 'main'}
                  onChange={(e) => setAutoUpdateModal({ ...autoUpdateModal, branch: e.target.value })}
                  placeholder="main"
                  className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-cyan-400"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">Git Repository URL</label>
              <input
                type="text"
                value={autoUpdateModal.gitRepoUrl || ''}
                onChange={(e) => setAutoUpdateModal({ ...autoUpdateModal, gitRepoUrl: e.target.value })}
                placeholder="https://github.com/yatindradhurwe/repo.git"
                className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-cyan-400"
              />
            </div>

            {/* Last Sync Telemetry */}
            {autoUpdateModal.lastAutoUpdate && (
              <div className="bg-slate-950 p-3 rounded-2xl border border-white/10 space-y-1 font-mono text-xs">
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>Last Antigravity Sync:</span>
                  <span className="text-cyan-300 font-bold">{new Date(autoUpdateModal.lastAutoUpdate).toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>Sync Result:</span>
                  <span className={`font-bold ${autoUpdateModal.lastStatus === 'success' ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {autoUpdateModal.lastStatus === 'success' ? '✓ SUCCESSFUL' : '❌ FAILED'}
                  </span>
                </div>
              </div>
            )}

            {/* Footer Buttons */}
            <div className="flex items-center justify-between pt-2 border-t border-slate-800">
              <button
                onClick={handleTriggerAutoSyncNow}
                disabled={triggeringAutoSync}
                className="px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-md disabled:opacity-50 cursor-pointer"
              >
                <Zap className={`w-3.5 h-3.5 ${triggeringAutoSync ? 'animate-spin' : ''}`} />
                <span>{triggeringAutoSync ? 'Syncing Now...' : 'Trigger Sync Now'}</span>
              </button>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setAutoUpdateModal(null)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveAutoUpdateConfig}
                  disabled={savingAutoUpdate}
                  className="px-5 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-extrabold rounded-xl text-xs flex items-center gap-1.5 transition shadow-lg shadow-cyan-950/40 disabled:opacity-50 cursor-pointer"
                >
                  {savingAutoUpdate ? <RefreshCw className="w-3.5 h-3.5 animate-spin text-slate-950" /> : <Check className="w-3.5 h-3.5" />}
                  <span>{savingAutoUpdate ? 'Saving...' : 'Save Settings'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
