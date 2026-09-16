import React, { useState, useEffect } from 'react'
import { Layers, Play, Square, RefreshCw, Cpu, Activity, Clock, Terminal, AlertCircle, CheckCircle2, ChevronRight, HardDrive, Code } from 'lucide-react'

export default function ProjectExplorer({ jwtToken, activeServer, onOpenInStudio }) {
  const [processes, setProcesses] = useState([])
  const [serverStats, setServerStats] = useState(null)
  const [loading, setLoading] = useState(true)

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

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-slate-900 via-slate-900/90 to-blue-950/40 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex items-center space-x-3.5">
          <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-400">
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
              Projects & Services Explorer
              <span className="text-xs px-2 py-0.5 rounded-full bg-purple-950 border border-purple-800 text-purple-400 font-mono">
                PM2 Engine
              </span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Active Host: <span className="font-mono text-cyan-400">{activeServer ? activeServer.host : '187.127.165.128'}</span> ({processes.length} Processes Tracked)
            </p>
          </div>
        </div>

        <button
          onClick={fetchMetrics}
          className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl transition cursor-pointer flex items-center gap-2 text-xs"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Services</span>
        </button>
      </div>

      {/* Services Table Card */}
      <div className="bg-slate-900/80 backdrop-blur border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
        <div className="p-4 border-b border-slate-800 bg-slate-900/90 flex items-center justify-between text-xs">
          <span className="font-semibold text-white tracking-wide uppercase">Active PM2 Process Services</span>
          <span className="text-slate-400 font-mono">Node v20.x Process Manager</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950/70 text-slate-400 font-mono border-b border-slate-800 uppercase text-[11px]">
              <tr>
                <th className="py-3 px-4">ID</th>
                <th className="py-3 px-4">Application Service</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">CPU %</th>
                <th className="py-3 px-4">Memory</th>
                <th className="py-3 px-4">Restarts</th>
                <th className="py-3 px-4 text-right">Service Control & Studio IDE</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {processes.map((proc) => (
                <tr key={proc.pm_id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="py-3.5 px-4 text-slate-400">#{proc.pm_id}</td>
                  <td className="py-3.5 px-4">
                    <div className="font-semibold text-white text-xs">{proc.name}</div>
                    <div className="text-[10px] text-slate-500 font-mono">/var/www/{proc.name}</div>
                  </td>
                  <td className="py-3.5 px-4">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border inline-flex items-center gap-1 ${
                      proc.status === 'online'
                        ? 'bg-emerald-950/80 text-emerald-400 border-emerald-800/80'
                        : 'bg-rose-950/80 text-rose-400 border-rose-800/80'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${proc.status === 'online' ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`}></span>
                      {proc.status.toUpperCase()}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-cyan-400">{proc.cpu}%</td>
                  <td className="py-3.5 px-4 text-blue-400">{proc.memory} MB</td>
                  <td className="py-3.5 px-4 text-purple-400">{proc.restarts}</td>
                  <td className="py-3.5 px-4 text-right space-x-2">
                    <button
                      onClick={() => onOpenInStudio && onOpenInStudio(proc.name)}
                      className="px-2.5 py-1 bg-cyan-950/80 hover:bg-cyan-900/80 text-cyan-300 border border-cyan-800/80 rounded-lg text-[11px] transition cursor-pointer font-semibold inline-flex items-center gap-1"
                    >
                      <Code className="w-3 h-3" />
                      <span>Open in Studio</span>
                    </button>
                    <button
                      onClick={() => toggleProcessState(proc.pm_id)}
                      className={`px-2.5 py-1 rounded-lg border transition text-[11px] cursor-pointer ${
                        proc.status === 'online'
                          ? 'bg-rose-950/40 text-rose-300 border-rose-800/60 hover:bg-rose-900/40'
                          : 'bg-emerald-950/40 text-emerald-300 border-emerald-800/60 hover:bg-emerald-900/40'
                      }`}
                    >
                      {proc.status === 'online' ? 'Stop' : 'Start'}
                    </button>
                    <button
                      onClick={fetchMetrics}
                      className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg text-[11px] transition cursor-pointer"
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
    </div>
  )
}
