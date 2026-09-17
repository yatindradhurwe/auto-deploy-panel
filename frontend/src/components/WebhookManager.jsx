import React, { useState, useEffect } from 'react'
import {
  Webhook, Github, Copy, Check, RefreshCw, GitCommit,
  Clock, ShieldCheck, Zap, ExternalLink
} from 'lucide-react'

export default function WebhookManager({ jwtToken }) {
  const [projects, setProjects] = useState([])
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [copiedId, setCopiedId] = useState(null)

  const fetchData = async () => {
    setLoading(true)
    try {
      const [listRes, histRes] = await Promise.all([
        fetch('/api/studio/autoupdate/list', { headers: { 'Authorization': jwtToken ? `Bearer ${jwtToken}` : '' } }),
        fetch('/api/studio/autoupdate/history', { headers: { 'Authorization': jwtToken ? `Bearer ${jwtToken}` : '' } })
      ])

      const listData = await listRes.json()
      const histData = await histRes.json()

      if (listData.success && listData.configs) {
        const projs = Object.values(listData.configs)
        setProjects(projs.length > 0 ? projs : [
          { appName: 'litigation', branch: 'main', enabled: true },
          { appName: 'tip-crm-backend', branch: 'main', enabled: true },
          { appName: 'auto-deploy-backend', branch: 'main', enabled: true }
        ])
      }
      if (histData.success && histData.history) {
        setHistory(histData.history)
      }
    } catch (e) {
      console.error('Failed to load webhook details:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [jwtToken])

  const handleCopyWebhook = (appName) => {
    const domain = window.location.origin
    const url = `${domain}/api/webhooks/github/${appName}`
    navigator.clipboard.writeText(url)
    setCopiedId(appName)
    setTimeout(() => setCopiedId(null), 2000)
  }

  return (
    <div className="space-y-6 text-slate-100 font-sans">
      {/* Header */}
      <div className="bg-slate-900/80 border border-white/10 backdrop-blur-2xl rounded-3xl p-6 shadow-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-2xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shadow-inner">
              <Webhook className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-black text-white tracking-tight flex items-center gap-2">
                GitHub Webhooks & Automated CI/CD Triggers
                <span className="text-[10px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-2.5 py-0.5 rounded-full font-mono font-bold">AUTO-DEPLOY</span>
              </h2>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                Paste webhook URLs into GitHub to automatically trigger server git pull and rebuild on push events.
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={fetchData}
          className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10 px-4 py-2 rounded-xl font-mono flex items-center space-x-2 transition cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Audit Logs</span>
        </button>
      </div>

      {/* Grid: Project Webhook URL Cards */}
      <div className="bg-slate-900/80 border border-white/10 rounded-3xl p-6 shadow-2xl space-y-4">
        <h3 className="text-sm font-bold text-white font-mono flex items-center gap-2">
          <Github className="w-4 h-4 text-cyan-400" />
          Project Auto-Deploy Webhook URLs ({projects.length})
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {projects.map((proj) => {
            const name = proj.appName || proj.name || proj.id
            const domain = window.location.origin
            const webhookUrl = `${domain}/api/webhooks/github/${name}`
            const isCopied = copiedId === name

            return (
              <div
                key={name}
                className="bg-slate-950/80 border border-white/10 rounded-2xl p-4 space-y-3 relative"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${proj.enabled ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`}></span>
                    <span className="font-bold text-xs text-white font-mono">{name}</span>
                    {proj.enabled ? (
                      <span className="text-[9px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.2 rounded-full font-bold">
                        ⚡ AUTO-UPDATE ON
                      </span>
                    ) : (
                      <span className="text-[9px] bg-slate-800 text-slate-400 px-2 py-0.2 rounded-full font-bold">
                        ⏸ OFF
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono bg-slate-900 px-2 py-0.5 rounded border border-white/10">
                    {proj.branch || 'main'}
                  </span>
                </div>

                <div className="bg-slate-900/90 border border-white/5 rounded-xl p-2.5 flex items-center justify-between gap-2">
                  <span className="text-[10px] font-mono text-cyan-300 truncate select-all">{webhookUrl}</span>
                  <button
                    onClick={() => handleCopyWebhook(name)}
                    className="text-[10px] font-mono bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 px-3 py-1 rounded-lg flex items-center space-x-1 transition cursor-pointer shrink-0"
                  >
                    {isCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-cyan-300" />}
                    <span>{isCopied ? 'Copied!' : 'Copy URL'}</span>
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Audit History Log */}
      <div className="bg-slate-900/80 border border-white/10 rounded-3xl p-6 shadow-2xl space-y-4">
        <h3 className="text-sm font-bold text-white font-mono flex items-center gap-2">
          <Clock className="w-4 h-4 text-indigo-400" />
          Recent Antigravity Auto-Update & Webhook Audit Trail ({history.length})
        </h3>

        <div className="space-y-2">
          {history.length === 0 ? (
            <div className="text-xs text-slate-500 font-mono text-center p-6 bg-slate-950/50 rounded-2xl border border-dashed border-slate-800">
              No auto-update trigger logs recorded yet. Webhook push events and interval sync logs will appear here.
            </div>
          ) : (
            history.map((log) => (
              <div
                key={log.id}
                className="bg-slate-950/80 border border-white/10 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 font-mono text-xs"
              >
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <GitCommit className="w-4 h-4 text-cyan-400" />
                    <span className="font-bold text-white">{log.commitMsg || log.appName}</span>
                  </div>
                  <div className="text-slate-400 text-[11px] flex items-center space-x-3">
                    <span>Target: <strong className="text-indigo-300">{log.appName}</strong></span>
                    <span>Pusher: <strong className="text-cyan-300">{log.pusher || 'Antigravity'}</strong></span>
                    <span>Source: <strong className="text-purple-300">{log.triggerSource || 'manual'}</strong></span>
                  </div>
                </div>

                <div className="flex items-center space-x-3">
                  <span className="text-[10px] text-slate-500">{new Date(log.timestamp).toLocaleTimeString()}</span>
                  <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold border ${
                    log.status === 'success'
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                      : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                  }`}>
                    {log.status === 'success' ? '⚡ AUTO-SYNCED' : '❌ SYNC FAILED'}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
