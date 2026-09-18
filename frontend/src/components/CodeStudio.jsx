import React, { useState, useEffect } from 'react'
import { Folder, FileCode, ChevronRight, ChevronDown, Save, RefreshCw, Code, Terminal, FileText, CheckCircle2, Play, Search, X, GitBranch, Download, Upload, AlertCircle, Sparkles, FolderGit2, Bot, RotateCcw, History, DownloadCloud, Trash2 } from 'lucide-react'
import AIAgentStudioDrawer from './AIAgentStudioDrawer'

export default function CodeStudio({ jwtToken, activeServer, initialProject }) {
  const [projects, setProjects] = useState([])
  const [selectedProject, setSelectedProject] = useState(null)
  const [deleteStudioModal, setDeleteStudioModal] = useState(null)

  const [fileTree, setFileTree] = useState([])
  const [openFiles, setOpenFiles] = useState([])
  const [activeFile, setActiveFile] = useState(null)
  const [fileContent, setFileContent] = useState('')
  const [loadingTree, setLoadingTree] = useState(true)
  const [loadingFile, setLoadingFile] = useState(false)
  const [savingFile, setSavingFile] = useState(false)
  const [saveMessage, setSaveMessage] = useState(null)
  const [expandedFolders, setExpandedFolders] = useState({})

  // AI Agent Studio Drawer State
  const [showAgentDrawer, setShowAgentDrawer] = useState(false)

  // Git State & Rollback State
  const [gitStatus, setGitStatus] = useState({ branch: 'main', modifiedCount: 0 })
  const [pullingGit, setPullingGit] = useState(false)
  const [pushingGit, setPushingGit] = useState(false)
  const [showCommitModal, setShowCommitModal] = useState(false)
  const [commitMsg, setCommitMsg] = useState('update code from studio ide')
  const [gitLogModal, setGitLogModal] = useState(null)

  const [showRollbackModal, setShowRollbackModal] = useState(false)
  const [commitHistory, setCommitHistory] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  useEffect(() => {
    fetchProjects()
  }, [])

  useEffect(() => {
    if (selectedProject) {
      fetchFileTree(selectedProject.path)
      fetchGitStatus(selectedProject.path)
    }
  }, [selectedProject])

  const fetchProjects = async () => {
    try {
      const res = await fetch('/api/studio/projects', {
        headers: { 'Authorization': `Bearer ${jwtToken}` }
      })
      const data = await res.json()
      if (data.success && data.projects.length > 0) {
        setProjects(data.projects)
        // If initialProject passed from ProjectExplorer, use it
        if (initialProject) {
          const matched = data.projects.find((p) => p.repoName === initialProject || p.name.includes(initialProject))
          if (matched) setSelectedProject(matched)
          else setSelectedProject(data.projects[0])
        } else {
          setSelectedProject(data.projects[0])
        }
      }
    } catch (e) {
      console.error('Failed to load projects', e)
    }
  }

  const fetchFileTree = async (projectPath) => {
    setLoadingTree(true)
    try {
      const res = await fetch('/api/studio/files/tree', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify({ projectPath })
      })
      const data = await res.json()
      if (data.success) {
        setFileTree(data.tree)
        // Auto expand top directories
        const initExpanded = {}
        data.tree.forEach((item) => {
          if (item.type === 'directory') initExpanded[item.path] = true
        })
        setExpandedFolders(initExpanded)
      }
    } catch (e) {
      console.error('Failed to load file tree', e)
    } finally {
      setLoadingTree(false)
    }
  }

  const fetchGitStatus = async (projectPath) => {
    try {
      const res = await fetch('/api/studio/git/status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify({ projectPath })
      })
      const data = await res.json()
      if (data.success) {
        setGitStatus({ branch: data.branch, modifiedCount: data.modifiedCount })
      }
    } catch (e) {}
  }

  const handleGitPull = async () => {
    if (!selectedProject) return
    setPullingGit(true)
    try {
      const res = await fetch('/api/studio/git/pull', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify({ projectPath: selectedProject.path, branch: gitStatus.branch || 'main' })
      })
      const data = await res.json()
      if (data.success) {
        setGitLogModal({ title: 'Git Pull Successful', output: data.output || data.message })
        fetchFileTree(selectedProject.path)
        fetchGitStatus(selectedProject.path)
      } else {
        alert(`Git Pull Error: ${data.error}`)
      }
    } catch (err) {
      alert(`Git Pull Failed: ${err.message}`)
    } finally {
      setPullingGit(false)
    }
  }

  const [updatingLive, setUpdatingLive] = useState(false)

  const handlePullAndUpdateLiveServer = async () => {
    if (!selectedProject) return
    setUpdatingLive(true)
    try {
      const res = await fetch('/api/studio/git/pull-and-update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify({
          host: activeServer ? activeServer.host : '187.127.165.128',
          appName: selectedProject.repoName || selectedProject.name,
          projectPath: selectedProject.path,
          branch: gitStatus.branch || 'main'
        })
      })
      const data = await res.json()
      if (data.success) {
        setGitLogModal({
          title: `🎉 Successfully Updated Live Server ('${selectedProject.name}')!`,
          output: data.output || data.message
        })
        fetchFileTree(selectedProject.path)
        fetchGitStatus(selectedProject.path)
      } else {
        setGitLogModal({
          title: `❌ Failed to Update Live Server ('${selectedProject.name}')`,
          output: (data.error || 'Update error') + '\n\n' + (data.output || '')
        })
      }
    } catch (err) {
      alert(`Live Update Failed: ${err.message}`)
    } finally {
      setUpdatingLive(false)
    }
  }

  const handleGitPushSubmit = async (e) => {
    e.preventDefault()
    if (!selectedProject || !commitMsg) return
    setPushingGit(true)
    setShowCommitModal(false)
    try {
      const res = await fetch('/api/studio/git/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify({
          projectPath: selectedProject.path,
          commitMessage: commitMsg,
          branch: gitStatus.branch || 'main'
        })
      })
      const data = await res.json()
      if (data.success) {
        setGitLogModal({ title: 'Git Commit & Push Successful', output: data.output || data.message })
        fetchGitStatus(selectedProject.path)
      } else {
        alert(`Git Push Error: ${data.error}`)
      }
    } catch (err) {
      alert(`Git Push Failed: ${err.message}`)
    } finally {
      setPushingGit(false)
    }
  }

  const handleFetchHistory = async () => {
    if (!selectedProject) return
    setLoadingHistory(true)
    setShowRollbackModal(true)
    try {
      const res = await fetch('/api/studio/git/history', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify({ projectPath: selectedProject.path })
      })
      const data = await res.json()
      if (data.success) {
        setCommitHistory(data.commits || [])
      }
    } catch (err) {
      console.error('Failed to fetch commit history', err)
    } finally {
      setLoadingHistory(false)
    }
  }

  const handleRollbackCommit = async (commitHash) => {
    if (!selectedProject || !commitHash) return
    if (!window.confirm(`Are you sure you want to rollback ${selectedProject.name} to commit ${commitHash}?`)) return

    try {
      const res = await fetch('/api/studio/git/rollback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify({ projectPath: selectedProject.path, commitHash })
      })
      const data = await res.json()
      if (data.success) {
        setShowRollbackModal(false)
        setGitLogModal({ title: `Git Rollback to ${commitHash} Complete`, output: data.output || data.message })
        fetchFileTree(selectedProject.path)
        fetchGitStatus(selectedProject.path)
      } else {
        alert(`Rollback Error: ${data.error}`)
      }
    } catch (err) {
      alert(`Rollback Failed: ${err.message}`)
    }
  }

  const handleConfirmDeleteStudioProject = async () => {
    if (!deleteStudioModal) return
    setDeleteStudioModal((prev) => ({ ...prev, deleting: true }))
    try {
      const res = await fetch('/api/studio/projects/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify({
          host: activeServer ? activeServer.host : '187.127.165.128',
          appName: deleteStudioModal.appName,
          projectPath: deleteStudioModal.projectPath,
          domain: deleteStudioModal.domain,
          deletePm2: deleteStudioModal.deletePm2,
          deleteFiles: deleteStudioModal.deleteFiles,
          deleteNginx: deleteStudioModal.deleteNginx
        })
      })
      const data = await res.json()
      if (data.success) {
        alert(`Project '${deleteStudioModal.appName}' deleted successfully from live server!`)
        setDeleteStudioModal(null)
        const updatedProjects = projects.filter((p) => p.id !== deleteStudioModal.id && p.repoName !== deleteStudioModal.appName)
        setProjects(updatedProjects)
        if (updatedProjects.length > 0) {
          setSelectedProject(updatedProjects[0])
        } else {
          setSelectedProject(null)
          setFileTree([])
        }
      } else {
        alert(`Delete Error: ${data.error}`)
      }
    } catch (err) {
      alert(`Delete Request Failed: ${err.message}`)
    } finally {
      setDeleteStudioModal((prev) => (prev ? { ...prev, deleting: false } : null))
    }
  }

  const handleOpenFile = async (fileItem) => {
    if (fileItem.type === 'directory') {
      setExpandedFolders((prev) => ({ ...prev, [fileItem.path]: !prev[fileItem.path] }))
      return
    }

    if (!openFiles.some((f) => f.path === fileItem.path)) {
      setOpenFiles((prev) => [...prev, fileItem])
    }
    setActiveFile(fileItem)

    setLoadingFile(true)
    setSaveMessage(null)
    try {
      const res = await fetch('/api/studio/files/read', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify({ filePath: fileItem.fullPath || fileItem.path })
      })
      const data = await res.json()
      if (data.success) {
        setFileContent(data.content)
      } else {
        setFileContent(`// Error reading file: ${data.error}`)
      }
    } catch (err) {
      setFileContent(`// Failed to fetch file content: ${err.message}`)
    } finally {
      setLoadingFile(false)
    }
  }

  const handleCloseTab = (filePath, e) => {
    e.stopPropagation()
    const remaining = openFiles.filter((f) => f.path !== filePath)
    setOpenFiles(remaining)
    if (activeFile?.path === filePath) {
      if (remaining.length > 0) {
        handleOpenFile(remaining[remaining.length - 1])
      } else {
        setActiveFile(null)
        setFileContent('')
      }
    }
  }

  const handleSaveFile = async () => {
    if (!activeFile) return
    setSavingFile(true)
    setSaveMessage(null)
    try {
      const res = await fetch('/api/studio/files/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify({
          filePath: activeFile.fullPath || activeFile.path,
          content: fileContent
        })
      })
      const data = await res.json()
      if (data.success) {
        setSaveMessage('File saved successfully!')
        fetchGitStatus(selectedProject ? selectedProject.path : '')
        setTimeout(() => setSaveMessage(null), 3000)
      } else {
        alert(`Failed to save: ${data.error}`)
      }
    } catch (err) {
      alert(`Save request error: ${err.message}`)
    } finally {
      setSavingFile(false)
    }
  }

  const getFileIcon = (fileName) => {
    const ext = fileName.split('.').pop()?.toLowerCase()
    if (['js', 'jsx', 'ts', 'tsx'].includes(ext)) return <FileCode className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
    if (['json', 'md', 'txt'].includes(ext)) return <FileText className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
    if (['css', 'scss', 'html'].includes(ext)) return <Code className="w-3.5 h-3.5 text-blue-400 shrink-0" />
    if (['py', 'sh', 'bash'].includes(ext)) return <Terminal className="w-3.5 h-3.5 text-purple-400 shrink-0" />
    return <FileCode className="w-3.5 h-3.5 text-slate-400 shrink-0" />
  }

  const renderTreeNode = (node, depth = 0) => {
    const isExpanded = expandedFolders[node.path]
    const isDirectory = node.type === 'directory'

    return (
      <div key={node.path} className="select-none">
        <button
          onClick={() => handleOpenFile(node)}
          style={{ paddingLeft: `${depth * 14 + 10}px` }}
          className={`w-full py-1.5 pr-2.5 text-left font-mono text-[11px] flex items-center gap-2 transition rounded-xl hover:bg-slate-800/60 cursor-pointer ${
            activeFile?.path === node.path ? 'bg-cyan-950/70 text-cyan-300 font-bold border border-cyan-500/30 shadow-sm' : 'text-slate-300'
          }`}
        >
          {isDirectory ? (
            <>
              {isExpanded ? (
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              )}
              <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0 drop-shadow" />
            </>
          ) : (
            <>
              <span className="w-3.5 h-3.5 inline-block shrink-0"></span>
              {getFileIcon(node.name)}
            </>
          )}
          <span className="truncate">{node.name}</span>
        </button>

        {isDirectory && isExpanded && node.children && (
          <div>
            {node.children.map((child) => renderTreeNode(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Top Banner & Git Action Controls - Apple Glassmorphism + AWS Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/60 backdrop-blur-2xl border border-white/10 rounded-3xl p-5 shadow-2xl shadow-slate-950/50">
        
        {/* Left Project Selector */}
        <div className="flex items-center space-x-3.5">
          <div className="p-3 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 ring-1 ring-cyan-500/20">
            <Code className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <label className="text-[10px] font-mono text-slate-400 uppercase tracking-widest font-bold">Active Repository Target:</label>
              <select
                value={selectedProject?.id || ''}
                onChange={(e) => {
                  const p = projects.find((proj) => proj.id === e.target.value)
                  if (p) setSelectedProject(p)
                }}
                className="bg-slate-950/90 border border-cyan-500/40 text-cyan-300 text-xs font-mono px-3 py-1.5 rounded-xl focus:outline-none focus:border-cyan-400 cursor-pointer shadow-inner"
              >
                {projects.map((proj) => (
                  <option key={proj.id} value={proj.id}>
                    {proj.name} ({proj.repoName})
                  </option>
                ))}
              </select>

              {/* Delete Project from Server Button */}
              {selectedProject && (
                <button
                  onClick={() => {
                    const appName = selectedProject.repoName || selectedProject.name
                    setDeleteStudioModal({
                      id: selectedProject.id,
                      appName,
                      projectPath: selectedProject.path,
                      domain: appName.includes('.com') ? appName : `${appName}.yjtechnosoft.com`,
                      deletePm2: true,
                      deleteFiles: true,
                      deleteNginx: true,
                      deleting: false
                    })
                  }}
                  className="px-2.5 py-1.5 bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 border border-rose-800/80 rounded-xl text-xs transition cursor-pointer font-bold inline-flex items-center gap-1 shadow-sm"
                  title="Delete this project, directory, PM2 process, and Nginx config from server"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                  <span>Delete Project</span>
                </button>
              )}
            </div>
            <p className="text-xs text-slate-400 flex items-center gap-2">
              <span className="font-mono text-slate-300 text-[11px] bg-slate-950/60 px-2.5 py-0.5 rounded-lg border border-white/5">{selectedProject?.path}</span>
            </p>
          </div>
        </div>

        {/* Right Git Pull / Push & AI Agent Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Git Status Pill */}
          <div className="px-3 py-1.5 bg-slate-950/90 border border-white/10 rounded-2xl text-xs font-mono flex items-center gap-2 shadow-inner">
            <GitBranch className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-slate-200 font-semibold">{gitStatus.branch}</span>
            {gitStatus.modifiedCount > 0 && (
              <span className="px-2 py-0.2 rounded-full bg-amber-950/80 text-amber-300 border border-amber-800 text-[10px] font-bold">
                {gitStatus.modifiedCount} modified
              </span>
            )}
          </div>

          {/* Git Pull */}
          <button
            onClick={handleGitPull}
            disabled={pullingGit}
            className="px-3.5 py-1.5 bg-slate-800/80 hover:bg-slate-700/80 text-cyan-300 border border-cyan-800/60 rounded-xl font-semibold text-xs flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50 shadow-sm"
            title="Pull latest code from GitHub origin/main"
          >
            <Download className={`w-3.5 h-3.5 ${pullingGit ? 'animate-spin' : ''}`} />
            <span>{pullingGit ? 'Pulling...' : 'Git Pull'}</span>
          </button>

          {/* Git Commit & Push */}
          <button
            onClick={() => setShowCommitModal(true)}
            disabled={pushingGit}
            className="px-4 py-1.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 transition cursor-pointer shadow-lg shadow-cyan-500/20 disabled:opacity-50"
            title="Commit all changes and push to GitHub origin/main"
          >
            <Upload className={`w-3.5 h-3.5 ${pushingGit ? 'animate-spin' : ''}`} />
            <span>{pushingGit ? 'Pushing...' : 'Git Commit & Push'}</span>
          </button>

          {/* Pull & Update Live Server */}
          <button
            onClick={handlePullAndUpdateLiveServer}
            disabled={updatingLive}
            className="px-4 py-1.5 bg-gradient-to-r from-purple-600 via-indigo-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 transition cursor-pointer shadow-lg shadow-purple-950/40 disabled:opacity-50 ring-1 ring-purple-400/30"
            title="Pull latest code from GitHub origin/main and rebuild/reload live server app"
          >
            <DownloadCloud className={`w-3.5 h-3.5 text-purple-200 ${updatingLive ? 'animate-bounce' : ''}`} />
            <span>{updatingLive ? 'Updating Live...' : 'Pull & Update Live'}</span>
          </button>

          {/* Git Commit Rollback */}
          <button
            onClick={handleFetchHistory}
            className="px-3.5 py-1.5 bg-slate-800/80 hover:bg-slate-700/80 text-amber-300 border border-amber-500/30 rounded-xl font-semibold text-xs flex items-center gap-1.5 transition cursor-pointer shadow-sm"
            title="View recent Git commits and rollback codebase"
          >
            <History className="w-3.5 h-3.5 text-amber-400" />
            <span>Rollback</span>
          </button>

          {/* AI Agent Studio Drawer Toggle */}
          <button
            onClick={() => setShowAgentDrawer(true)}
            className="px-4 py-1.5 bg-gradient-to-r from-purple-600 via-indigo-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 transition cursor-pointer shadow-lg shadow-purple-900/40 ring-1 ring-purple-400/30"
            title="Open Multi-Model AI Agent Studio (Gemini, Grok, Claude, ChatGPT)"
          >
            <Bot className="w-3.5 h-3.5 text-purple-200 animate-bounce" />
            <span>AI Agent Studio</span>
          </button>

          {/* Save File */}
          {activeFile && (
            <button
              onClick={handleSaveFile}
              disabled={savingFile}
              className="px-4 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 transition cursor-pointer shadow-lg shadow-emerald-950/40 disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{savingFile ? 'Saving...' : 'Save File'}</span>
            </button>
          )}

          <button
            onClick={() => selectedProject && fetchFileTree(selectedProject.path)}
            className="p-2 bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 border border-white/10 rounded-xl transition cursor-pointer"
            title="Refresh File Tree"
          >
            <RefreshCw className={`w-4 h-4 ${loadingTree ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {saveMessage && (
        <div className="p-3 bg-emerald-950/80 border border-emerald-800 rounded-xl text-xs text-emerald-300 flex items-center gap-2 font-mono">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{saveMessage}</span>
        </div>
      )}

      {/* Git Commit Modal */}
      {showCommitModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full max-w-md shadow-2xl space-y-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Upload className="w-4 h-4 text-cyan-400" />
              Commit & Push to GitHub Repository
            </h3>
            <form onSubmit={handleGitPushSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Commit Message</label>
                <input
                  type="text"
                  value={commitMsg}
                  onChange={(e) => setCommitMsg(e.target.value)}
                  required
                  placeholder="e.g. feat: update component styling and API endpoint"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono focus:border-cyan-500 focus:outline-none"
                />
              </div>
              <div className="p-2.5 bg-slate-950/60 border border-slate-800 rounded-lg text-[11px] text-slate-400 font-mono">
                <div>Target Branch: <span className="text-cyan-400">{gitStatus.branch || 'main'}</span></div>
                <div>Repository: <span className="text-slate-300">{selectedProject?.gitUrl}</span></div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCommitModal(false)}
                  className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-gradient-to-r from-cyan-600 to-blue-600 text-white font-semibold rounded-lg hover:from-cyan-500 hover:to-blue-500"
                >
                  Confirm Git Push
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Git Log Output Modal */}
      {gitLogModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full max-w-lg shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Terminal className="w-4 h-4 text-cyan-400" />
                {gitLogModal.title}
              </h3>
              <button
                onClick={() => setGitLogModal(null)}
                className="p-1 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <pre className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-emerald-400 max-h-60 overflow-y-auto whitespace-pre-wrap leading-relaxed">
              {gitLogModal.output}
            </pre>
            <div className="flex justify-end">
              <button
                onClick={() => setGitLogModal(null)}
                className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold"
              >
                Close Output Window
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Git Rollback Commit Selector Modal */}
      {showRollbackModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xl flex items-center justify-center p-4">
          <div className="bg-[#0B0E17] border border-white/10 rounded-3xl p-6 w-full max-w-lg shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-sm font-extrabold text-white flex items-center gap-2">
                <RotateCcw className="w-4 h-4 text-amber-400" />
                Select Commit to Rollback ({selectedProject?.name})
              </h3>
              <button
                onClick={() => setShowRollbackModal(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {loadingHistory ? (
              <div className="flex items-center justify-center p-8 text-xs font-mono text-slate-400">
                <RefreshCw className="w-4 h-4 animate-spin mr-2 text-amber-400" />
                Fetching Git commit history...
              </div>
            ) : commitHistory.length === 0 ? (
              <p className="text-xs text-slate-400 font-mono p-4 text-center">No recent commit history found.</p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {commitHistory.map((c) => (
                  <div
                    key={c.hash}
                    className="p-3 bg-slate-950/80 border border-white/5 hover:border-amber-500/40 rounded-2xl flex items-center justify-between gap-3 text-xs font-mono transition"
                  >
                    <div>
                      <div className="flex items-center gap-2 text-slate-200 font-bold">
                        <span className="text-amber-400 px-2 py-0.5 rounded bg-amber-950/80 border border-amber-800 text-[10px]">{c.hash}</span>
                        <span className="truncate max-w-xs">{c.subject}</span>
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5">by {c.author} • {c.relativeTime}</div>
                    </div>
                    <button
                      onClick={() => handleRollbackCommit(c.hash)}
                      className="px-3 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-xl text-[11px] font-bold transition cursor-pointer shrink-0"
                    >
                      Rollback To This
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Studio Editor Workspace - Android Studio Dark IDE Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 h-[640px]">
        
        {/* Left Tree Explorer Sidebar */}
        <div className="bg-slate-900/60 backdrop-blur-2xl border border-white/10 rounded-3xl flex flex-col overflow-hidden shadow-2xl shadow-slate-950/50">
          <div className="p-3.5 border-b border-white/10 bg-slate-950/90 flex items-center justify-between text-xs font-bold text-slate-300 uppercase tracking-wider">
            <span className="flex items-center gap-2">
              <Folder className="w-4 h-4 text-amber-400 shrink-0" />
              Project Explorer
            </span>
            <span className="text-[9px] px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-800/80 font-mono font-bold">TREE</span>
          </div>

          <div className="p-2 flex-1 overflow-y-auto font-mono text-xs space-y-0.5">
            {loadingTree ? (
              <div className="flex items-center justify-center p-8 text-slate-500 text-xs">
                <RefreshCw className="w-4 h-4 animate-spin mr-2 text-cyan-400" />
                Scanning project files...
              </div>
            ) : (
              fileTree.map((node) => renderTreeNode(node))
            )}
          </div>
        </div>

        {/* Right Main Code Editor Window */}
        <div className="lg:col-span-3 bg-slate-900/60 backdrop-blur-2xl border border-white/10 rounded-3xl flex flex-col overflow-hidden shadow-2xl shadow-slate-950/50">
          
          {/* File Tab Bar - Android Studio Style */}
          <div className="flex items-center bg-slate-950/90 border-b border-white/10 overflow-x-auto text-xs font-mono">
            {openFiles.map((f) => (
              <button
                key={f.path}
                onClick={() => handleOpenFile(f)}
                className={`px-4 py-2.5 border-r border-white/10 flex items-center gap-2 transition shrink-0 cursor-pointer ${
                  activeFile?.path === f.path
                    ? 'bg-slate-900 text-cyan-300 border-t-2 border-t-cyan-400 font-bold shadow-inner'
                    : 'text-slate-400 hover:bg-slate-900/50'
                }`}
              >
                {getFileIcon(f.name)}
                <span>{f.name}</span>
                <span
                  onClick={(e) => handleCloseTab(f.path, e)}
                  className="p-0.5 hover:bg-slate-800 rounded-md text-slate-500 hover:text-rose-400 transition"
                >
                  <X className="w-3 h-3" />
                </span>
              </button>
            ))}
          </div>

          {/* Active File Content Code Editor Area */}
          {activeFile ? (
            <div className="flex-1 flex flex-col relative font-mono text-xs bg-[#080B11]">
              {loadingFile && (
                <div className="absolute inset-0 bg-slate-950/80 backdrop-blur z-10 flex items-center justify-center text-slate-400">
                  <RefreshCw className="w-5 h-5 animate-spin mr-2 text-cyan-400" />
                  Loading file content...
                </div>
              )}
              <textarea
                value={fileContent}
                onChange={(e) => setFileContent(e.target.value)}
                spellCheck={false}
                className="flex-1 w-full p-4 bg-[#080B11] text-slate-100 font-mono text-xs focus:outline-none resize-none leading-relaxed select-text tracking-wide selection:bg-cyan-500/30"
              ></textarea>
              <div className="p-2.5 bg-slate-950/90 border-t border-white/10 flex items-center justify-between text-[11px] text-slate-400 font-mono">
                <span className="truncate flex items-center gap-1.5">
                  <FileCode className="w-3.5 h-3.5 text-cyan-400" />
                  {activeFile.fullPath || activeFile.path}
                </span>
                <div className="flex items-center gap-3">
                  <span className="px-2 py-0.5 rounded bg-slate-900 border border-white/5 text-slate-300">UTF-8</span>
                  <span className="px-2 py-0.5 rounded bg-slate-900 border border-white/5 text-cyan-400 font-bold">Lines: {fileContent.split('\n').length}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-500 bg-[#080B11]">
              <div className="p-4 rounded-3xl bg-slate-900/60 border border-white/10 mb-4 shadow-xl">
                <Code className="w-12 h-12 text-cyan-400 opacity-80" />
              </div>
              <p className="text-base font-bold text-slate-300">No File Opened</p>
              <p className="text-xs text-slate-500 max-w-sm mt-1">Select a file from the left Project Explorer tree to edit code directly in Code Studio IDE</p>
            </div>
          )}

        </div>

      </div>

      {/* AI Agent Studio Drawer */}
      <AIAgentStudioDrawer
        isOpen={showAgentDrawer}
        onClose={() => setShowAgentDrawer(false)}
        activeFile={activeFile}
        fileContent={fileContent}
        projectPath={selectedProject ? selectedProject.path : ''}
        jwtToken={jwtToken}
        onApplyCodeFix={(newCode) => {
          setFileContent(newCode)
          setShowAgentDrawer(false)
        }}
      />
      {/* Delete Project Modal */}
      {deleteStudioModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-rose-500/40 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-3">
                <div className="p-2 rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/20">
                  <Trash2 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-white text-sm">Delete Project from Server</h3>
                  <p className="text-[11px] text-slate-400 font-mono">Permanently remove service & files from live server</p>
                </div>
              </div>
              <button
                onClick={() => setDeleteStudioModal(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3 bg-slate-950/80 p-4 rounded-2xl border border-white/5 text-xs">
              <div className="font-semibold text-white">Target App: <span className="text-cyan-300 font-mono">{deleteStudioModal.appName}</span></div>
              <div className="text-slate-400 font-mono text-[11px]">Path: {deleteStudioModal.projectPath}</div>

              <div className="space-y-2 pt-2 border-t border-white/10 text-slate-300">
                <label className="flex items-center space-x-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={deleteStudioModal.deletePm2}
                    onChange={(e) => setDeleteStudioModal({ ...deleteStudioModal, deletePm2: e.target.checked })}
                    className="rounded border-white/10 text-rose-500 bg-slate-900"
                  />
                  <span>Stop & Delete PM2 Process (<code className="text-cyan-400">pm2 delete {deleteStudioModal.appName}</code>)</span>
                </label>

                <label className="flex items-center space-x-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={deleteStudioModal.deleteFiles}
                    onChange={(e) => setDeleteStudioModal({ ...deleteStudioModal, deleteFiles: e.target.checked })}
                    className="rounded border-white/10 text-rose-500 bg-slate-900"
                  />
                  <span>Delete Files & Directory (<code className="text-rose-400">rm -rf {deleteStudioModal.projectPath}</code>)</span>
                </label>

                <label className="flex items-center space-x-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={deleteStudioModal.deleteNginx}
                    onChange={(e) => setDeleteStudioModal({ ...deleteStudioModal, deleteNginx: e.target.checked })}
                    className="rounded border-white/10 text-rose-500 bg-slate-900"
                  />
                  <span>Delete Nginx Config & Reload Web Server</span>
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                onClick={() => setDeleteStudioModal(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition cursor-pointer"
              >
                Cancel
              </button>

              <button
                onClick={handleConfirmDeleteStudioProject}
                disabled={deleteStudioModal.deleting}
                className="px-5 py-2 bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 transition shadow-lg shadow-rose-950/40 disabled:opacity-50 cursor-pointer"
              >
                {deleteStudioModal.deleting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                <span>{deleteStudioModal.deleting ? 'Deleting...' : 'Confirm Permanent Deletion'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Agent Studio Drawer */}
      <AIAgentStudioDrawer
        isOpen={showAgentDrawer}
        onClose={() => setShowAgentDrawer(false)}
        activeFile={activeFile}
        fileContent={fileContent}
        projectPath={selectedProject?.path}
        jwtToken={jwtToken}
        onApplyCodeFix={(newCode) => {
          setFileContent(newCode)
          setSaveMessage('AI Agent code changes applied to active editor! Click "Save File" or "Git Commit" to apply.')
          setTimeout(() => setSaveMessage(null), 5000)
        }}
      />
    </div>
  )
}
