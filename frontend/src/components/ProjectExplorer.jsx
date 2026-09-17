import React, { useState, useEffect } from 'react'
import { Layers, Play, Square, RefreshCw, Cpu, Activity, Clock, Terminal, AlertCircle, CheckCircle2, ChevronRight, HardDrive, Code, DownloadCloud, X, Check, Globe } from 'lucide-react'

export default function ProjectExplorer({ jwtToken, activeServer, onOpenInStudio }) {
  const [processes, setProcesses] = useState([])
  const [serverStats, setServerStats] = useState(null)
  const [loading, setLoading] = useState(true)

  // Live Update Modal State
  const [updatingAppName, setUpdatingAppName] = useState(null)
  const [updateLogModal, setUpdateLogModal] = useState(null)

  useEffect(() => {
    fetchMetrics()
  }, [activeServer])

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

        <button
          onClick={fetchMetrics}
          className="px-4 py-2 bg-slate-800/80 hover:bg-slate-700/80 text-slate-200 border border-white/10 rounded-2xl transition cursor-pointer flex items-center gap-2 text-xs font-semibold shadow-sm"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Telemetry</span>
        </button>
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
                          ? 'bg-rose-950/40 text-rose-300 border-rose-800/60 hover:bg-rose-900/40'
                          : 'bg-emerald-950/40 text-emerald-300 border-emerald-800/60 hover:bg-emerald-900/40'
                      }`}
                    >
                      {proc.status === 'online' ? 'Stop Service' : 'Start Service'}
                    </button>
                    <button
                      onClick={fetchMetrics}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-white/10 rounded-xl text-[11px] transition cursor-pointer font-semibold"
                    >
                      Restart
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
    </div>
  )
}
