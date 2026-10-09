import React, { useState } from 'react'
import {
  AlertTriangle, ShieldAlert, Trash2, X, RefreshCw, CheckCircle2, Lock,
  Server, Database, Code, Mail, Globe, Terminal, Check
} from 'lucide-react'
import { useAuth } from '../store/AuthContext'
import { useServers } from '../store/ServersContext'

export default function DeleteProjectModal({
  isOpen,
  project,
  onClose,
  onSuccess
}) {
  const { token: jwtToken } = useAuth()
  const { activeServer } = useServers()
  const [confirmInput, setConfirmInput] = useState('')
  const [deletePm2, setDeletePm2] = useState(true)
  const [deleteFiles, setDeleteFiles] = useState(true)
  const [deleteNginx, setDeleteNginx] = useState(true)
  const [deleteDb, setDeleteDb] = useState(true)
  const [deleteEmail, setDeleteEmail] = useState(true)

  const [deleting, setDeleting] = useState(false)
  const [deleteLogs, setDeleteLogs] = useState(null)
  const [errorMsg, setErrorMsg] = useState(null)

  if (!isOpen || !project) return null

  const appName = project.repoName || project.name || 'project-app'
  const cleanAppName = appName.toLowerCase().replace(/[^a-z0-9]/g, '-')
  const remotePath = project.path || `/var/www/${cleanAppName}`
  const domainName = project.domain || `${cleanAppName}.yjtechnosoft.com`
  const dbName = project.dbName || `${cleanAppName.replace(/-/g, '_')}_db`

  const expectedMatch = cleanAppName

  const isConfirmed = confirmInput.trim().toLowerCase() === expectedMatch.toLowerCase() || confirmInput.trim() === 'DELETE'

  const handleExecuteDelete = async () => {
    if (!isConfirmed) return
    setDeleting(true)
    setErrorMsg(null)
    setDeleteLogs('🚀 Initiating permanent deletion pipeline on live server...\n')

    const token = jwtToken

    try {
      const res = await fetch('/api/studio/projects/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-Server-Id': activeServer?.id || ''
        },
        body: JSON.stringify({
          serverId: activeServer?.id,
          host: activeServer ? (activeServer.ipAddress || activeServer.host) : '187.127.165.128',
          port: activeServer ? (activeServer.port || 22) : 22,
          username: activeServer ? (activeServer.username || 'root') : 'root',
          appName: cleanAppName,
          projectPath: remotePath,
          domain: domainName,
          dbName: dbName,
          deletePm2,
          deleteFiles,
          deleteNginx,
          deleteDb,
          deleteEmail
        })
      })

      const data = await res.json()

      if (data.success) {
        setDeleteLogs(data.output || `✅ Successfully deleted project '${cleanAppName}' from server!`)
        setTimeout(() => {
          setDeleting(false)
          if (onSuccess) onSuccess()
          onClose()
        }, 2000)
      } else {
        setErrorMsg(data.error || 'Failed to delete project.')
        setDeleting(false)
      }
    } catch (err) {
      setErrorMsg(`Deletion request error: ${err.message}`)
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto selection:bg-rose-500/30 selection:text-rose-200 font-sans">
      <div className="bg-[#0B0E17] border-2 border-rose-500/60 rounded-3xl max-w-xl w-full p-6 space-y-5 shadow-2xl shadow-rose-950/60 animate-in zoom-in-95 duration-200">
        
        {/* Header Alert Bar */}
        <div className="flex items-start justify-between border-b border-rose-500/20 pb-4">
          <div className="flex items-center space-x-3.5">
            <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-400 ring-1 ring-rose-500/20 shadow-inner">
              <ShieldAlert className="w-7 h-7 text-rose-500 animate-pulse" />
            </div>
            <div>
              <h2 className="text-lg font-black text-white tracking-tight flex items-center gap-2">
                <span>PERMANENT DELETION WARNING</span>
                <span className="text-[10px] bg-rose-950 text-rose-300 border border-rose-800 px-2 py-0.5 rounded-full font-mono font-bold">
                  HIGH DANGER
                </span>
              </h2>
              <p className="text-xs text-rose-300/80 font-mono mt-0.5">
                You are about to permanently delete <strong>{project.name}</strong> from your server.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={deleting}
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-900 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Target Details Summary Card */}
        <div className="bg-slate-950/90 border border-slate-800 rounded-2xl p-4 space-y-2.5 font-mono text-xs">
          <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider border-b border-slate-800 pb-1.5 flex items-center justify-between">
            <span>Target Project Identity</span>
            <span className="text-cyan-400 font-bold">Server IP: {activeServer?.ipAddress || '187.127.165.128'}</span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div>
              <span className="text-slate-500 block text-[10px]">Project Name:</span>
              <strong className="text-white truncate block">{project.name}</strong>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px]">PM2 App Name:</span>
              <strong className="text-cyan-300 truncate block">{cleanAppName}</strong>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px]">Remote Code Directory:</span>
              <strong className="text-slate-300 truncate block">{remotePath}</strong>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px]">Domain & SSL Routing:</span>
              <strong className="text-amber-300 truncate block">{domainName}</strong>
            </div>
          </div>
        </div>

        {/* Isolation Guarantee Alert Badge */}
        <div className="bg-gradient-to-r from-emerald-950/60 to-slate-950 border border-emerald-500/40 rounded-2xl p-3.5 flex items-start space-x-3 text-xs font-mono">
          <Lock className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-extrabold text-emerald-300 block">Strict Project Isolation Guaranteed</span>
            <p className="text-slate-300 text-[11px] leading-relaxed">
              ONLY this project (<strong>{project.name}</strong>) will be deleted. All other projects, databases, and services on your server will remain 100% active and completely untouched.
            </p>
          </div>
        </div>

        {/* Resources Cleanup Checkboxes */}
        <div className="space-y-2 bg-slate-950/80 p-4 rounded-2xl border border-slate-800 text-xs font-mono">
          <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-2">Select Resources to Wipe for '{cleanAppName}':</div>

          <label className="flex items-center space-x-2.5 cursor-pointer text-slate-200">
            <input
              type="checkbox"
              checked={deletePm2}
              onChange={(e) => setDeletePm2(e.target.checked)}
              className="rounded border-slate-700 text-rose-500 bg-slate-900 focus:ring-0"
            />
            <span className="flex items-center gap-1.5">
              <Server className="w-3.5 h-3.5 text-cyan-400" />
              <span>Stop & Delete PM2 Process (<code className="text-cyan-300">pm2 delete {cleanAppName}</code>)</span>
            </span>
          </label>

          <label className="flex items-center space-x-2.5 cursor-pointer text-slate-200">
            <input
              type="checkbox"
              checked={deleteFiles}
              onChange={(e) => setDeleteFiles(e.target.checked)}
              className="rounded border-slate-700 text-rose-500 bg-slate-900 focus:ring-0"
            />
            <span className="flex items-center gap-1.5">
              <Code className="w-3.5 h-3.5 text-purple-400" />
              <span>Permanently Delete Code Files (<code className="text-rose-400">rm -rf {remotePath}</code>)</span>
            </span>
          </label>

          <label className="flex items-center space-x-2.5 cursor-pointer text-slate-200">
            <input
              type="checkbox"
              checked={deleteNginx}
              onChange={(e) => setDeleteNginx(e.target.checked)}
              className="rounded border-slate-700 text-rose-500 bg-slate-900 focus:ring-0"
            />
            <span className="flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-amber-400" />
              <span>Remove Nginx Config & SSL Certificates (<code className="text-amber-300">{domainName}</code>)</span>
            </span>
          </label>

          <label className="flex items-center space-x-2.5 cursor-pointer text-slate-200">
            <input
              type="checkbox"
              checked={deleteDb}
              onChange={(e) => setDeleteDb(e.target.checked)}
              className="rounded border-slate-700 text-rose-500 bg-slate-900 focus:ring-0"
            />
            <span className="flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5 text-emerald-400" />
              <span>Drop Database & All Tables (<code className="text-emerald-300">DROP DATABASE {dbName}</code>)</span>
            </span>
          </label>

          <label className="flex items-center space-x-2.5 cursor-pointer text-slate-200">
            <input
              type="checkbox"
              checked={deleteEmail}
              onChange={(e) => setDeleteEmail(e.target.checked)}
              className="rounded border-slate-700 text-rose-500 bg-slate-900 focus:ring-0"
            />
            <span className="flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5 text-blue-400" />
              <span>Clear Domain Email Accounts & Mail Spool</span>
            </span>
          </label>
        </div>

        {/* Type to Confirm Verification Input */}
        <div className="space-y-2 bg-rose-950/20 p-4 rounded-2xl border border-rose-500/30">
          <label className="text-xs font-mono font-bold text-rose-300 block">
            To confirm deletion, type <code className="bg-slate-950 px-2 py-0.5 rounded text-white font-mono border border-rose-500/40">{cleanAppName}</code> below:
          </label>
          <input
            type="text"
            value={confirmInput}
            onChange={(e) => setConfirmInput(e.target.value)}
            placeholder={`Type '${cleanAppName}' or 'DELETE' to enable...`}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs font-mono text-white placeholder-slate-600 focus:outline-none focus:border-rose-500"
          />
        </div>

        {/* Live Terminal / Error Output */}
        {errorMsg && (
          <div className="p-3 bg-rose-950/90 border border-rose-500/50 rounded-xl text-rose-300 font-mono text-xs">
            ❌ {errorMsg}
          </div>
        )}

        {deleteLogs && (
          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-3 h-32 overflow-y-auto font-mono text-[11px] text-cyan-300 whitespace-pre-wrap">
            {deleteLogs}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-end space-x-3 pt-2">
          <button
            onClick={onClose}
            disabled={deleting}
            className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-xl font-mono text-xs font-bold transition cursor-pointer border border-slate-800"
          >
            Cancel
          </button>

          <button
            onClick={handleExecuteDelete}
            disabled={!isConfirmed || deleting}
            className="px-6 py-2.5 bg-gradient-to-r from-rose-600 via-red-600 to-amber-600 hover:from-rose-500 hover:to-red-500 text-white font-extrabold rounded-xl font-mono text-xs shadow-xl shadow-rose-950/50 flex items-center space-x-2 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {deleting ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin text-white" />
                <span>Deleting Project & Resources...</span>
              </>
            ) : (
              <>
                <Trash2 className="w-4 h-4" />
                <span>PERMANENTLY DELETE EVERYTHING</span>
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  )
}
