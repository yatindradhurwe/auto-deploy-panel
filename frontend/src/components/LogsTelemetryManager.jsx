import React, { useState, useEffect, useRef } from 'react'
import {
  Activity, Play, Square, RotateCw, Trash2, Terminal, RefreshCw,
  Search, Copy, Check, Filter, Cpu, HardDrive, ShieldCheck, Zap, AlertCircle
} from 'lucide-react'

export default function LogsTelemetryManager({ jwtToken }) {
  const [processes, setProcesses] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedApp, setSelectedApp] = useState('')
  const [logs, setLogs] = useState('')
  const [loadingLogs, setLoadingLogs] = useState(false)
  const [logSearch, setLogSearch] = useState('')
  const [actionLoading, setActionLoading] = useState(null)
  const [copied, setCopied] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)

  const logsEndRef = useRef(null)

  const fetchPM2Status = async () => {
    try {
      const res = await fetch('/api/studio/server-metrics', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': jwtToken ? `Bearer ${jwtToken}` : ''
        },
        body: JSON.stringify({ host: '187.127.165.128' })
      })
      const data = await res.json()
      if (data.success && data.processes) {
        setProcesses(data.processes)
        if (!selectedApp && data.processes.length > 0) {
          setSelectedApp(data.processes[0].name)
        }
      }
    } catch (e) {
      console.error('Error fetching PM2 status:', e)
    } finally {
      setLoading(false)
    }
  }

  const fetchLogs = async (appName) => {
    if (!appName) return
    setLoadingLogs(true)
    try {
      const res = await fetch('/api/studio/pm2/logs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': jwtToken ? `Bearer ${jwtToken}` : ''
        },
        body: JSON.stringify({ appName, lines: 100 })
      })
      const data = await res.json()
      if (data.success) {
        setLogs(data.logs || 'No log data stream available.')
      } else {
        setLogs(`Error loading logs: ${data.error}`)
      }
    } catch (err) {
      setLogs(`Failed to fetch logs: ${err.message}`)
    } finally {
      setLoadingLogs(false)
    }
  }

  useEffect(() => {
    fetchPM2Status()
    const interval = setInterval(() => {
      fetchPM2Status()
    }, 6000)
    return () => clearInterval(interval)
  }, [jwtToken])

  useEffect(() => {
    if (selectedApp) {
      fetchLogs(selectedApp)
    }
  }, [selectedApp])

  useEffect(() => {
    if (!autoRefresh || !selectedApp) return
    const logInterval = setInterval(() => {
      fetchLogs(selectedApp)
    }, 4000)
    return () => clearInterval(logInterval)
  }, [selectedApp, autoRefresh])

  const handleProcessAction = async (action, processId, name) => {
    setActionLoading(`${action}-${processId}`)
    try {
      const res = await fetch('/api/studio/pm2/control', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': jwtToken ? `Bearer ${jwtToken}` : ''
        },
        body: JSON.stringify({ action, processId, appName: name })
      })
      const data = await res.json()
      if (data.success) {
        await fetchPM2Status()
        if (name === selectedApp) {
          await fetchLogs(name)
        }
      } else {
        alert(`PM2 action failed: ${data.error}`)
      }
    } catch (err) {
      alert(`Action error: ${err.message}`)
    } finally {
      setActionLoading(null)
    }
  }

  const handleCopyLogs = () => {
    navigator.clipboard.writeText(logs)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const filteredLogs = logs
    ? logs
        .split('\n')
        .filter((l) => l.toLowerCase().includes(logSearch.toLowerCase()))
        .join('\n')
    : ''

  return (
    <div className="space-y-6 text-slate-100 font-sans">
      {/* Top Header Card */}
      <div className="bg-slate-900/80 border border-white/10 backdrop-blur-2xl rounded-3xl p-6 shadow-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-2xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-inner">
              <Activity className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-black text-white tracking-tight flex items-center gap-2">
                PM2 Process Manager & Live Log Telemetry
                <span className="text-[10px] bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 px-2.5 py-0.5 rounded-full font-mono font-bold">REAL-TIME</span>
              </h2>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                Inspect active node processes, restart/reload services, and tail real-time output streams.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`text-xs px-3.5 py-2 rounded-xl font-mono flex items-center space-x-2 transition border cursor-pointer ${
              autoRefresh
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                : 'bg-slate-800 text-slate-400 border-white/10 hover:text-slate-200'
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${autoRefresh ? 'animate-spin' : ''}`} />
            <span>Auto Stream: {autoRefresh ? 'ON (4s)' : 'PAUSED'}</span>
          </button>
          <button
            onClick={fetchPM2Status}
            className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10 px-4 py-2 rounded-xl font-mono flex items-center space-x-2 transition cursor-pointer"
          >
            <RotateCw className="w-3.5 h-3.5 text-slate-300" />
            <span>Refresh All</span>
          </button>
        </div>
      </div>

      {/* Process Control Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {processes.map((proc) => {
          const isSelected = selectedApp === proc.name
          const isOnline = proc.status === 'online'
          return (
            <div
              key={proc.pm_id}
              onClick={() => setSelectedApp(proc.name)}
              className={`p-5 rounded-2xl border transition-all duration-300 cursor-pointer relative overflow-hidden ${
                isSelected
                  ? 'bg-slate-900/90 border-cyan-500/60 shadow-xl shadow-cyan-950/40 ring-1 ring-cyan-500/30'
                  : 'bg-slate-950/60 border-white/10 hover:border-white/20 hover:bg-slate-900/60'
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse"></span>
                    <h3 className="font-bold text-sm text-white font-mono tracking-wide">{proc.name}</h3>
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono">ID #{proc.pm_id}</span>
                </div>
                <span
                  className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                    isOnline
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                      : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                  }`}
                >
                  {proc.status.toUpperCase()}
                </span>
              </div>

              {/* Specs */}
              <div className="grid grid-cols-2 gap-2 mt-4 text-[11px] font-mono text-slate-300 bg-slate-900/80 p-2.5 rounded-xl border border-white/5">
                <div>
                  <span className="text-slate-500 block text-[9px]">CPU USAGE</span>
                  <span className="font-bold text-cyan-300">{proc.cpu || 0}%</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[9px]">MEMORY</span>
                  <span className="font-bold text-cyan-300">{proc.memory || 0} MB</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[9px]">RESTARTS</span>
                  <span className="font-bold text-amber-300">{proc.restarts || 0}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[9px]">LOG STREAM</span>
                  <span className="font-bold text-emerald-300">{isSelected ? 'ACTIVE' : 'SELECT'}</span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center space-x-1.5 mt-4 pt-3 border-t border-white/5">
                <button
                  onClick={(e) => { e.stopPropagation(); handleProcessAction('restart', proc.pm_id, proc.name) }}
                  disabled={actionLoading === `restart-${proc.pm_id}`}
                  title="Restart PM2 App"
                  className="flex-1 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-[10px] font-mono py-1.5 rounded-lg flex items-center justify-center space-x-1 transition cursor-pointer"
                >
                  <RotateCw className="w-3 h-3" />
                  <span>Restart</span>
                </button>

                <button
                  onClick={(e) => { e.stopPropagation(); handleProcessAction('reload', proc.pm_id, proc.name) }}
                  disabled={actionLoading === `reload-${proc.pm_id}`}
                  title="Zero-downtime Reload"
                  className="flex-1 bg-blue-500/10 hover:bg-blue-500/20 text-blue-300 border border-blue-500/30 text-[10px] font-mono py-1.5 rounded-lg flex items-center justify-center space-x-1 transition cursor-pointer"
                >
                  <Zap className="w-3 h-3" />
                  <span>Reload</span>
                </button>

                <button
                  onClick={(e) => { e.stopPropagation(); handleProcessAction(isOnline ? 'stop' : 'restart', proc.pm_id, proc.name) }}
                  disabled={actionLoading === `stop-${proc.pm_id}`}
                  title={isOnline ? 'Stop App' : 'Start App'}
                  className="p-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-lg transition cursor-pointer"
                >
                  {isOnline ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Terminal Log Console */}
      <div className="bg-slate-950 border border-white/10 rounded-3xl overflow-hidden shadow-2xl">
        {/* Terminal Header */}
        <div className="bg-slate-900/90 px-6 py-3.5 border-b border-white/10 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center space-x-3">
            <div className="flex space-x-1.5">
              <div className="w-3 h-3 rounded-full bg-rose-500/80"></div>
              <div className="w-3 h-3 rounded-full bg-amber-500/80"></div>
              <div className="w-3 h-3 rounded-full bg-emerald-500/80"></div>
            </div>
            <div className="flex items-center space-x-2 font-mono text-xs text-slate-300">
              <Terminal className="w-4 h-4 text-cyan-400" />
              <span>Log Stream:</span>
              <span className="text-cyan-300 font-bold bg-cyan-950/80 border border-cyan-800/80 px-2 py-0.5 rounded">
                {selectedApp || 'Select a process'}
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            {/* Search Filter */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={logSearch}
                onChange={(e) => setLogSearch(e.target.value)}
                placeholder="Filter logs..."
                className="bg-slate-950 text-slate-200 border border-white/10 text-xs font-mono pl-9 pr-3 py-1.5 rounded-xl focus:outline-none focus:border-cyan-500/50 w-44"
              />
            </div>

            <button
              onClick={() => fetchLogs(selectedApp)}
              className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10 px-3 py-1.5 rounded-xl font-mono flex items-center space-x-1.5 transition cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingLogs ? 'animate-spin' : ''}`} />
              <span>Fetch</span>
            </button>

            <button
              onClick={handleCopyLogs}
              className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10 px-3 py-1.5 rounded-xl font-mono flex items-center space-x-1.5 transition cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-slate-300" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
        </div>

        {/* Terminal Window Content */}
        <div className="p-6 font-mono text-xs bg-slate-950 min-h-[360px] max-h-[500px] overflow-y-auto leading-relaxed text-slate-300">
          {filteredLogs ? (
            filteredLogs.split('\n').map((line, idx) => {
              let textClass = 'text-slate-300'
              if (line.includes('error') || line.includes('ERR') || line.includes('Error')) {
                textClass = 'text-rose-400 bg-rose-950/30 px-1 py-0.5 rounded'
              } else if (line.includes('warn') || line.includes('WARN')) {
                textClass = 'text-amber-300'
              } else if (line.includes('online') || line.includes('success') || line.includes('listening')) {
                textClass = 'text-emerald-300'
              } else if (line.startsWith('===')) {
                textClass = 'text-cyan-400 font-bold border-b border-cyan-900/50 pb-1 mt-2 mb-1 block'
              }
              return (
                <div key={idx} className={`${textClass} whitespace-pre-wrap hover:bg-slate-900/40 px-1 py-0.5 rounded transition-colors`}>
                  {line}
                </div>
              )
            })
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-slate-500 font-mono">
              <Terminal className="w-10 h-10 mb-3 opacity-30 text-cyan-400" />
              <p>No log records match search or app selected.</p>
            </div>
          )}
          <div ref={logsEndRef} />
        </div>
      </div>
    </div>
  )
}
