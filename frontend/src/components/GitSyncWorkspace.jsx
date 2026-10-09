import React, { useState, useEffect } from 'react'
import {
  FolderGit2, Download, Upload, RefreshCw, GitCommit, History, CheckCircle2,
  AlertCircle, Terminal, FileCode, Check, ShieldCheck, ArrowDown, ArrowUp, RotateCcw
} from 'lucide-react'
import { useAuth } from '../store/AuthContext'
import { useServers } from '../store/ServersContext'

export default function GitSyncWorkspace({ project }) {
  const { token: jwtToken } = useAuth()
  const { activeServer } = useServers()
  const [gitStatus, setGitStatus] = useState({ branch: 'main', modifiedCount: 0, modifiedFiles: [] })
  const [loadingStatus, setLoadingStatus] = useState(true)
  
  const [commitMsg, setCommitMsg] = useState('update feature from studio workspace')
  const [pushing, setPushing] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [logOutput, setLogOutput] = useState('')
  const [successMsg, setSuccessMsg] = useState(null)
  const [errorMsg, setErrorMsg] = useState(null)

  // Git Commit History & Rollback State
  const [commits, setCommits] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [rollingBack, setRollingBack] = useState(null)

  const getToken = () => jwtToken

  useEffect(() => {
    if (project?.path) {
      fetchGitStatus()
      fetchGitHistory()
    }
  }, [project])

  const fetchGitStatus = async () => {
    setLoadingStatus(true)
    try {
      const res = await fetch('/api/studio/git/status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getToken()}`
        },
        body: JSON.stringify({ projectPath: project.path })
      })
      const data = await res.json()
      if (data.success) {
        setGitStatus({
          branch: data.branch || 'main',
          modifiedCount: data.modifiedCount || 0,
          modifiedFiles: data.modifiedFiles || []
        })
      }
    } catch (e) {
      console.error('Git status error:', e)
    } finally {
      setLoadingStatus(false)
    }
  }

  const fetchGitHistory = async () => {
    setLoadingHistory(true)
    try {
      const res = await fetch('/api/studio/git/history', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getToken()}`
        },
        body: JSON.stringify({ projectPath: project.path })
      })
      const data = await res.json()
      if (data.success && Array.isArray(data.commits)) {
        setCommits(data.commits)
      }
    } catch (e) {
      console.error('Git history error:', e)
    } finally {
      setLoadingHistory(false)
    }
  }

  const handleGitPull = async () => {
    setPulling(true)
    setSuccessMsg(null)
    setErrorMsg(null)
    setLogOutput('')
    try {
      const res = await fetch('/api/studio/git/pull', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getToken()}`
        },
        body: JSON.stringify({
          projectPath: project.path,
          branch: gitStatus.branch || 'main'
        })
      })
      const data = await res.json()
      if (data.success) {
        setSuccessMsg('🎉 Git Pull completed successfully!')
        setLogOutput(data.output || 'Already up to date.')
        fetchGitStatus()
        fetchGitHistory()
      } else {
        setErrorMsg(`Git Pull failed: ${data.error}`)
      }
    } catch (e) {
      setErrorMsg(`Git Pull request error: ${e.message}`)
    } finally {
      setPulling(false)
    }
  }

  const handleGitPush = async () => {
    if (!commitMsg.trim()) {
      alert('Please enter a commit message.')
      return
    }
    setPushing(true)
    setSuccessMsg(null)
    setErrorMsg(null)
    setLogOutput('')
    try {
      const res = await fetch('/api/studio/git/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getToken()}`
        },
        body: JSON.stringify({
          projectPath: project.path,
          commitMessage: commitMsg,
          branch: gitStatus.branch || 'main'
        })
      })
      const data = await res.json()
      if (data.success) {
        setSuccessMsg(`🚀 Successfully committed and pushed to GitHub branch '${gitStatus.branch || 'main'}'!`)
        setLogOutput(data.output || 'Push completed.')
        fetchGitStatus()
        fetchGitHistory()
      } else {
        setErrorMsg(`Git Push failed: ${data.error}`)
      }
    } catch (e) {
      setErrorMsg(`Git Push request error: ${e.message}`)
    } finally {
      setPushing(false)
    }
  }

  const handleRollback = async (commitHash) => {
    if (!window.confirm(`Are you sure you want to rollback ${project?.name} to commit ${commitHash}?`)) return
    setRollingBack(commitHash)
    setErrorMsg(null)
    setSuccessMsg(null)
    try {
      const res = await fetch('/api/studio/git/rollback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getToken()}`
        },
        body: JSON.stringify({
          projectPath: project.path,
          commitHash
        })
      })
      const data = await res.json()
      if (data.success) {
        setSuccessMsg(`✅ Successfully rolled back to commit ${commitHash}!`)
        fetchGitStatus()
        fetchGitHistory()
      } else {
        setErrorMsg(`Rollback failed: ${data.error}`)
      }
    } catch (e) {
      setErrorMsg(`Rollback error: ${e.message}`)
    } finally {
      setRollingBack(null)
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 font-sans">
      
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-rose-950/30 to-slate-950 border border-rose-500/30 rounded-3xl p-6 shadow-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <FolderGit2 className="w-5 h-5 text-rose-400" />
            <h2 className="text-xl font-black text-white tracking-tight">GitHub & Version Control Center</h2>
          </div>
          <p className="text-xs text-slate-400 font-mono">
            Direct Git Pull, Commit, Push, and Commit History Rollback for <strong className="text-cyan-300">{project?.name}</strong> (`{project?.path}`)
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={fetchGitStatus}
            className="p-2 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-xl border border-slate-700 transition cursor-pointer"
            title="Refresh Git Status"
          >
            <RefreshCw className={`w-4 h-4 ${loadingStatus ? 'animate-spin text-cyan-400' : ''}`} />
          </button>

          <button
            onClick={handleGitPull}
            disabled={pulling}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-cyan-300 font-bold border border-cyan-500/40 rounded-xl text-xs flex items-center space-x-2 transition cursor-pointer disabled:opacity-50"
          >
            <Download className={`w-4 h-4 text-cyan-400 ${pulling ? 'animate-bounce' : ''}`} />
            <span>{pulling ? 'Pulling...' : 'Git Pull (Sync from GitHub)'}</span>
          </button>
        </div>
      </div>

      {/* Notifications */}
      {successMsg && (
        <div className="p-4 bg-emerald-950/90 border border-emerald-500/40 rounded-2xl text-emerald-300 font-mono text-xs flex items-center space-x-3 shadow-lg">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="p-4 bg-rose-950/90 border border-rose-500/40 rounded-2xl text-rose-300 font-mono text-xs flex items-center space-x-3 shadow-lg">
          <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Main Grid: Status & Commit Form / Log Stream */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Left: Commit & Push Form */}
        <div className="bg-slate-950/90 border border-slate-800 rounded-3xl p-6 space-y-6 shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div className="flex items-center space-x-2">
              <GitCommit className="w-5 h-5 text-cyan-400" />
              <h3 className="font-bold text-white text-sm">Commit & Push Changes to Remote</h3>
            </div>
            <span className="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold uppercase bg-slate-900 text-cyan-400 border border-cyan-500/30">
              Branch: {gitStatus.branch}
            </span>
          </div>

          {/* Uncommitted Changes Status */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-2 font-mono text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Uncommitted Files:</span>
              <span className={`font-bold ${gitStatus.modifiedCount > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                {gitStatus.modifiedCount} File{gitStatus.modifiedCount !== 1 ? 's' : ''} Modified
              </span>
            </div>

            {gitStatus.modifiedFiles?.length > 0 && (
              <div className="max-h-28 overflow-y-auto space-y-1 pt-2 border-t border-slate-800 text-[11px]">
                {gitStatus.modifiedFiles.map((file, idx) => (
                  <div key={idx} className="text-amber-300 truncate flex items-center gap-1.5">
                    <FileCode className="w-3 h-3 text-amber-400 shrink-0" />
                    <span>{file}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Commit Message Input */}
          <div className="space-y-2 font-mono">
            <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider block">
              Commit Message:
            </label>
            <input
              type="text"
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
              placeholder="Describe your changes..."
              className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono"
            />
          </div>

          <button
            onClick={handleGitPush}
            disabled={pushing}
            className="w-full py-3 bg-gradient-to-r from-rose-600 via-indigo-600 to-cyan-500 hover:from-rose-500 hover:to-cyan-400 text-white font-extrabold rounded-2xl text-xs font-mono shadow-lg flex items-center justify-center space-x-2 transition cursor-pointer disabled:opacity-50"
          >
            <Upload className={`w-4 h-4 ${pushing ? 'animate-spin' : ''}`} />
            <span>{pushing ? 'Pushing to Remote...' : 'Commit & Git Push to GitHub'}</span>
          </button>
        </div>

        {/* Right: Output Logs & Rollback History */}
        <div className="space-y-6">
          {/* Terminal Console Output */}
          <div className="bg-slate-950/90 border border-slate-800 rounded-3xl p-5 space-y-3 shadow-xl">
            <div className="flex items-center space-x-2 border-b border-slate-800 pb-3">
              <Terminal className="w-4 h-4 text-cyan-400" />
              <h3 className="font-bold text-white text-xs font-mono">Git Action Console Log Stream</h3>
            </div>
            <pre className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-[11px] font-mono text-cyan-300 min-h-[120px] max-h-40 overflow-y-auto whitespace-pre-wrap">
              {logOutput || 'Console ready. Execute Git Pull or Push to view output stream.'}
            </pre>
          </div>

          {/* Commit History & Rollback Timeline */}
          <div className="bg-slate-950/90 border border-slate-800 rounded-3xl p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <History className="w-4 h-4 text-purple-400" />
                <h3 className="font-bold text-white text-xs font-mono">Recent Commit History & Rollback</h3>
              </div>
              <button
                onClick={fetchGitHistory}
                className="text-[10px] text-cyan-400 hover:underline font-mono"
              >
                Refresh
              </button>
            </div>

            {loadingHistory ? (
              <div className="text-center text-slate-500 font-mono text-xs py-4">
                Loading Git history...
              </div>
            ) : commits.length === 0 ? (
              <div className="text-center text-slate-500 font-mono text-xs py-4">
                No recent commits found.
              </div>
            ) : (
              <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
                {commits.map((c) => (
                  <div
                    key={c.hash}
                    className="p-3 bg-slate-900 border border-slate-800 hover:border-cyan-500/40 rounded-xl flex items-center justify-between text-xs font-mono transition"
                  >
                    <div className="space-y-0.5 max-w-[75%]">
                      <div className="flex items-center gap-2">
                        <span className="px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 text-[10px] font-bold">
                          {c.hash}
                        </span>
                        <span className="text-slate-200 font-semibold truncate">{c.subject}</span>
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {c.author} • {c.relativeTime}
                      </div>
                    </div>

                    <button
                      onClick={() => handleRollback(c.hash)}
                      disabled={rollingBack === c.hash}
                      className="px-2.5 py-1 bg-slate-950 hover:bg-rose-950 text-rose-300 border border-rose-500/30 hover:border-rose-500 rounded-lg text-[10px] font-bold flex items-center gap-1 transition cursor-pointer disabled:opacity-50"
                    >
                      <RotateCcw className={`w-3 h-3 ${rollingBack === c.hash ? 'animate-spin' : ''}`} />
                      <span>Rollback</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>

    </div>
  )
}
