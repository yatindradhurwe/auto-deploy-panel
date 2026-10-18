import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Cpu, MemoryStick, HardDrive, Activity, RefreshCw, Trash2, Wrench, Power, PackageCheck, DownloadCloud,
  RotateCw, AlertTriangle, CheckCircle2, XCircle, Loader2, Server, Pause, Play, Eraser
} from 'lucide-react'
import { useApi } from '../hooks/useApi'
import { useServers } from '../store/ServersContext'

const POLL_MS = 5000
const HISTORY = 60

const CACHES = [
  { key: 'page', task: 'drop-page-cache', label: 'RAM page cache', hint: 'Cached file data in memory. The kernel refills it as files are read.' },
  { key: 'apt', task: 'apt-clean', label: 'Package cache', hint: 'Downloaded .deb files in /var/cache/apt.' },
  { key: 'journal', task: 'journal-vacuum', label: 'System journal', hint: 'Keeps the last 7 days, at most 200 MB.' },
  { key: 'pm2logs', task: 'pm2-flush', label: 'PM2 logs', hint: 'Empties every app\'s PM2 out/error log.' },
  { key: 'npm', task: 'npm-cache', label: 'npm cache', hint: 'Downloaded packages in ~/.npm; re-fetched when needed.' },
  { key: 'tmp', task: 'tmp-clean', label: 'Old temp files', hint: 'Files in /tmp and /var/tmp unused for 7+ days.' },
  { key: 'oldlogs', task: 'old-logs', label: 'Rotated logs', hint: 'Compressed and numbered old logs in /var/log.' }
]

export function formatBytes(n) {
  if (n === null || n === undefined) return '—'
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024, i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`
}

function formatUptime(s) {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`
}

const tone = (pct) => (pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-cyan-500')
const toneText = (pct) => (pct >= 90 ? 'text-red-400' : pct >= 70 ? 'text-amber-400' : 'text-cyan-300')

function Bar({ pct }) {
  return (
    <div className="w-full bg-slate-950 h-1.5 rounded-full overflow-hidden border border-slate-800">
      <div className={`${tone(pct)} h-full transition-all duration-500`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  )
}

function StatCard({ icon: Icon, label, pct, main, sub }) {
  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-2">
      <div className="flex items-center justify-between text-xs text-slate-400 font-semibold uppercase">
        <span className="flex items-center gap-1.5"><Icon className="w-4 h-4" /> {label}</span>
        <span className={`font-mono ${toneText(pct)}`}>{pct.toFixed(1)}%</span>
      </div>
      <div className="text-2xl font-black text-white font-mono">{main}</div>
      <Bar pct={pct} />
      <div className="text-[11px] text-slate-400 font-mono">{sub}</div>
    </div>
  )
}

/** CPU usage history as a filled line. */
function Sparkline({ values }) {
  if (values.length < 2) return <div className="h-20 flex items-center justify-center text-[11px] text-slate-500">Collecting samples…</div>
  const w = 300, h = 80
  const pts = values.map((v, i) => `${(i / (HISTORY - 1)) * w},${h - (v / 100) * h}`)
  const offset = ((HISTORY - values.length) / (HISTORY - 1)) * w
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-20">
      <g transform={`translate(${offset} 0)`}>
        <polygon points={`0,${h} ${pts.join(' ')} ${((values.length - 1) / (HISTORY - 1)) * w},${h}`} className="fill-cyan-500/15" />
        <polyline points={pts.join(' ')} fill="none" strokeWidth="1.5" vectorEffect="non-scaling-stroke" className="stroke-cyan-400" />
      </g>
    </svg>
  )
}

function ActionButton({ icon: Icon, label, onClick, busy, disabled, danger, title }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      title={title}
      className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 border transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
        danger
          ? 'bg-red-500/10 border-red-500/30 text-red-300 hover:bg-red-500/20'
          : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
      }`}
    >
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
      {label}
    </button>
  )
}

export default function ServerMaintenance() {
  const api = useApi()
  const { activeServer, activeServerId } = useServers()
  const [health, setHealth] = useState(null)
  const [isPanelHost, setIsPanelHost] = useState(false)
  const [caches, setCaches] = useState(null)
  const [cpuHistory, setCpuHistory] = useState([])
  const [error, setError] = useState('')
  const [live, setLive] = useState(true)
  const [running, setRunning] = useState('') // task id (or task:service) in progress
  const [result, setResult] = useState(null)
  const inFlight = useRef(false)

  const loadHealth = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    try {
      const data = await api('/api/studio/maintenance/health', { method: 'POST', body: {} })
      setHealth(data.health)
      setIsPanelHost(!!data.isPanelHost)
      setCpuHistory((h) => [...h, data.health.cpu.usage].slice(-HISTORY))
      setError('')
    } catch (err) {
      setError(err.message)
    } finally {
      inFlight.current = false
    }
  }, [api])

  const loadCaches = useCallback(async () => {
    try {
      const data = await api('/api/studio/maintenance/caches', { method: 'POST', body: {} })
      setCaches(data.caches)
    } catch (err) {
      setError(err.message)
    }
  }, [api])

  // Start over whenever the selected server changes
  useEffect(() => {
    setHealth(null); setCaches(null); setCpuHistory([]); setResult(null); setError('')
    loadHealth()
    loadCaches()
  }, [activeServerId, loadHealth, loadCaches])

  useEffect(() => {
    if (!live) return
    const t = setInterval(() => { if (!document.hidden) loadHealth() }, POLL_MS)
    return () => clearInterval(t)
  }, [live, loadHealth])

  const run = async (task, { confirmText, service, label } = {}) => {
    if (confirmText && !window.confirm(confirmText)) return
    const key = service ? `${task}:${service}` : task
    setRunning(key)
    setResult(null)
    try {
      const data = await api('/api/studio/maintenance/run', { method: 'POST', body: { task, service } })
      setResult({ ok: true, label: label || data.label, output: data.output, freedBytes: data.freedBytes })
    } catch (err) {
      setResult({ ok: false, label: label || task, output: err.data?.output || err.message })
    } finally {
      setRunning('')
      if (task !== 'reboot') { loadHealth(); loadCaches() }
    }
  }

  const totalCache = caches ? CACHES.reduce((s, c) => s + (caches[c.key] || 0), 0) : null
  const root = health?.disks?.find((d) => d.mount === '/') || health?.disks?.[0]

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/80 border border-slate-800 rounded-2xl p-5">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400"><Wrench className="w-5 h-5" /></div>
          <div>
            <h2 className="text-lg font-bold text-white">Server Health & Maintenance</h2>
            <p className="text-xs text-slate-400 font-mono">
              <Server className="w-3 h-3 inline mr-1" />
              {activeServer?.name || 'Server'}
              {health && ` · ${health.system.os} · up ${formatUptime(health.system.uptimeSeconds)}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ActionButton icon={live ? Pause : Play} label={live ? 'Live' : 'Paused'} onClick={() => setLive((v) => !v)} title={live ? `Refreshing every ${POLL_MS / 1000}s` : 'Resume live updates'} />
          <ActionButton icon={RefreshCw} label="Refresh" onClick={() => { loadHealth(); loadCaches() }} />
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-xl p-3">
          <XCircle className="w-4 h-4 shrink-0" /> <span>{error}</span>
        </div>
      )}

      {health?.system.privileges === 'none' && (
        <div className="flex items-start gap-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>The SSH user is not root and has no passwordless sudo, so most cache and maintenance tasks will be refused. Connect as root or allow sudo for this user.</span>
        </div>
      )}
      {health?.system.rebootRequired && (
        <div className="flex items-start gap-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3">
          <AlertTriangle className="w-4 h-4 shrink-0" /> <span>Installed updates need a reboot to take effect.</span>
        </div>
      )}

      {!health && !error && (
        <div className="flex items-center justify-center gap-2 text-sm text-slate-400 py-16"><Loader2 className="w-4 h-4 animate-spin" /> Reading server health…</div>
      )}

      {health && (
        <>
          {/* Usage cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <StatCard icon={Cpu} label="CPU usage" pct={health.cpu.usage} main={`${health.cpu.usage.toFixed(1)}%`}
              sub={`Load ${health.cpu.load.load1} / ${health.cpu.load.load5} / ${health.cpu.load.load15} · ${health.cpu.count} core${health.cpu.count > 1 ? 's' : ''}`} />
            <StatCard icon={MemoryStick} label="Memory" pct={health.memory.percent} main={formatBytes(health.memory.used)}
              sub={`of ${formatBytes(health.memory.total)} · ${formatBytes(health.memory.cached)} cache`} />
            <StatCard icon={Activity} label="Swap" pct={health.swap.percent} main={health.swap.total ? formatBytes(health.swap.used) : 'None'}
              sub={health.swap.total ? `of ${formatBytes(health.swap.total)}` : 'No swap configured'} />
            <StatCard icon={HardDrive} label={`Disk ${root?.mount || '/'}`} pct={root?.percent || 0} main={formatBytes(root?.used)}
              sub={`${formatBytes(root?.available)} free of ${formatBytes(root?.size)}`} />
          </div>

          {/* CPU detail + top processes */}
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
            <div className="xl:col-span-2 bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white">CPU over the last {Math.round((HISTORY * POLL_MS) / 60000)} minutes</h3>
                <span className="text-[11px] text-slate-500 font-mono truncate max-w-[50%]" title={health.cpu.model || ''}>{health.cpu.model}</span>
              </div>
              <Sparkline values={cpuHistory} />
              {health.cpu.cores.length > 1 && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 max-h-48 overflow-y-auto pr-1">
                  {health.cpu.cores.map((c) => (
                    <div key={c.name} className="text-[11px] font-mono">
                      <div className="flex justify-between text-slate-400"><span>{c.name}</span><span className={toneText(c.usage)}>{c.usage.toFixed(0)}%</span></div>
                      <Bar pct={c.usage} />
                    </div>
                  ))}
                </div>
              )}
              {health.disks.length > 1 && (
                <div className="space-y-2 pt-2 border-t border-slate-800">
                  {health.disks.map((d) => (
                    <div key={d.mount} className="text-[11px] font-mono">
                      <div className="flex justify-between text-slate-400"><span>{d.mount}</span><span>{formatBytes(d.used)} / {formatBytes(d.size)} ({d.percent}%)</span></div>
                      <Bar pct={d.percent} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="xl:col-span-3 bg-slate-900/80 border border-slate-800 rounded-2xl p-5">
              <h3 className="text-sm font-bold text-white mb-3">Top processes by CPU</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] font-mono">
                  <thead className="text-slate-500 text-left">
                    <tr><th className="py-1.5 pr-3">PID</th><th className="pr-3">User</th><th className="pr-3">Command</th><th className="pr-3 text-right">CPU</th><th className="pr-3 text-right">Mem</th><th className="text-right">RSS</th></tr>
                  </thead>
                  <tbody className="text-slate-300">
                    {health.processes.map((p) => (
                      <tr key={p.pid} className="border-t border-slate-800/70">
                        <td className="py-1.5 pr-3 text-slate-500">{p.pid}</td>
                        <td className="pr-3">{p.user}</td>
                        <td className="pr-3 truncate max-w-[180px]" title={p.command}>{p.command}</td>
                        <td className={`pr-3 text-right ${toneText(p.cpu)}`}>{p.cpu.toFixed(1)}%</td>
                        <td className="pr-3 text-right">{p.memory.toFixed(1)}%</td>
                        <td className="text-right">{formatBytes(p.rssBytes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-slate-500 mt-2">Process CPU is the average since each process started.</p>
            </div>
          </div>
        </>
      )}

      {/* Clear cache */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2"><Eraser className="w-4 h-4 text-cyan-400" /> Clear cache</h3>
            <p className="text-[11px] text-slate-400">{caches ? `${formatBytes(totalCache)} can be reclaimed` : 'Measuring caches…'}</p>
          </div>
          <ActionButton icon={Trash2} label="Clear all caches" busy={running === 'clear-all-caches'} disabled={!!running}
            onClick={() => run('clear-all-caches', { confirmText: 'Clear every cache listed here (RAM cache, package cache, journal over 7 days, PM2 logs, npm cache, old temp files, rotated logs)?' })} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
          {CACHES.map((c) => (
            <div key={c.key} className="flex items-center justify-between gap-3 bg-slate-950 border border-slate-800 rounded-xl p-3">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-200">{c.label} <span className="font-mono text-cyan-300 ml-1">{caches ? formatBytes(caches[c.key]) : '…'}</span></div>
                <div className="text-[10px] text-slate-500">{c.hint}</div>
              </div>
              <ActionButton icon={Trash2} label="Clear" busy={running === c.task} disabled={!!running}
                onClick={() => run(c.task, { label: `Clear ${c.label.toLowerCase()}`, confirmText: c.key === 'pm2logs' ? 'Empty the PM2 logs of every app on this server?' : undefined })} />
            </div>
          ))}
        </div>
      </div>

      {/* Maintenance */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-3">
          <h3 className="text-sm font-bold text-white flex items-center gap-2"><Wrench className="w-4 h-4 text-cyan-400" /> Maintenance</h3>
          <p className="text-[11px] text-slate-400">
            {health?.system.pendingUpdates === null || health?.system.pendingUpdates === undefined
              ? 'Package updates: unknown'
              : `${health.system.pendingUpdates} package update${health.system.pendingUpdates === 1 ? '' : 's'} available (as of the last check)`}
            {health?.failedUnits?.length ? ` · ${health.failedUnits.length} failed systemd unit${health.failedUnits.length > 1 ? 's' : ''}: ${health.failedUnits.join(', ')}` : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            <ActionButton icon={PackageCheck} label="Check for updates" busy={running === 'check-updates'} disabled={!!running} onClick={() => run('check-updates')} />
            <ActionButton icon={DownloadCloud} label="Install updates" busy={running === 'apt-upgrade'} disabled={!!running}
              onClick={() => run('apt-upgrade', { confirmText: 'Install all available package updates now? This can take several minutes and may restart services.' })} />
            <ActionButton icon={Trash2} label="Remove unused packages" busy={running === 'apt-autoremove'} disabled={!!running}
              onClick={() => run('apt-autoremove', { confirmText: 'Remove packages that are no longer needed (apt autoremove)?' })} />
            <ActionButton icon={RotateCw} label="Test & reload nginx" busy={running === 'nginx-reload'} disabled={!!running} onClick={() => run('nginx-reload')} />
            <ActionButton icon={Power} label="Reboot server" danger busy={running === 'reboot'} disabled={!!running || isPanelHost}
              title={isPanelHost ? 'The panel runs on this server; reboot it over SSH.' : undefined}
              onClick={() => run('reboot', { confirmText: `Reboot ${activeServer?.name || 'this server'} now? Every site and app on it will be offline until it is back up.` })} />
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-3">
          <h3 className="text-sm font-bold text-white flex items-center gap-2"><Server className="w-4 h-4 text-cyan-400" /> Services</h3>
          {!health ? <div className="text-[11px] text-slate-500">…</div> : health.services.length === 0 ? (
            <div className="text-[11px] text-slate-500">No known services found.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {health.services.map((s) => (
                <div key={s.name} className="flex items-center justify-between gap-2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2">
                  <span className="text-xs font-mono flex items-center gap-1.5 min-w-0">
                    {s.active === 'active' ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> : <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                    <span className="truncate text-slate-200">{s.name}</span>
                    <span className="text-slate-500">{s.sub || s.active}</span>
                  </span>
                  <button
                    onClick={() => run('restart-service', { service: s.name, label: `Restart ${s.name}`, confirmText: `Restart ${s.name}?` })}
                    disabled={!!running}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-cyan-300 hover:bg-slate-800 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                    title={`Restart ${s.name}`}
                  >
                    {running === `restart-service:${s.name}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Last task output */}
      {result && (
        <div className={`border rounded-2xl p-4 space-y-2 ${result.ok ? 'bg-emerald-500/5 border-emerald-500/30' : 'bg-red-500/5 border-red-500/30'}`}>
          <div className="flex items-center justify-between">
            <div className={`text-xs font-bold flex items-center gap-1.5 ${result.ok ? 'text-emerald-300' : 'text-red-300'}`}>
              {result.ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
              {result.label} {result.ok ? 'finished' : 'failed'}
              {result.ok && result.freedBytes !== null && result.freedBytes !== undefined && <span className="font-mono text-slate-300 ml-1">· freed {formatBytes(result.freedBytes)}</span>}
            </div>
            <button onClick={() => setResult(null)} className="text-[11px] text-slate-400 hover:text-white cursor-pointer">Dismiss</button>
          </div>
          {result.output && <pre className="text-[11px] font-mono text-slate-300 bg-slate-950 border border-slate-800 rounded-xl p-3 max-h-72 overflow-auto whitespace-pre-wrap">{result.output}</pre>}
        </div>
      )}
    </div>
  )
}
