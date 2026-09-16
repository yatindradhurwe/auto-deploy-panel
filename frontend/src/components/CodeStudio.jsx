import React, { useState, useEffect } from 'react'
import { Folder, FileCode, ChevronRight, ChevronDown, Save, RefreshCw, Code, Terminal, FileText, CheckCircle2, Play, Search, X, GitBranch, Download, Upload, AlertCircle, Sparkles, FolderGit2, Bot } from 'lucide-react'
import AIAgentStudioDrawer from './AIAgentStudioDrawer'

export default function CodeStudio({ jwtToken, activeServer, initialProject }) {
  const [projects, setProjects] = useState([])
  const [selectedProject, setSelectedProject] = useState(null)

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

  // Git State
  const [gitStatus, setGitStatus] = useState({ branch: 'main', modifiedCount: 0 })
  const [pullingGit, setPullingGit] = useState(false)
  const [pushingGit, setPushingGit] = useState(false)
  const [showCommitModal, setShowCommitModal] = useState(false)
  const [commitMsg, setCommitMsg] = useState('update code from studio ide')
  const [gitLogModal, setGitLogModal] = useState(null)

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

  const renderTreeNode = (node, depth = 0) => {
    const isExpanded = expandedFolders[node.path]
    const isDirectory = node.type === 'directory'

    return (
      <div key={node.path} className="select-none">
        <button
          onClick={() => handleOpenFile(node)}
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
          className={`w-full py-1.5 pr-2 text-left font-mono text-xs flex items-center gap-1.5 transition rounded hover:bg-slate-800/60 ${
            activeFile?.path === node.path ? 'bg-slate-800 text-cyan-300 font-semibold' : 'text-slate-300'
          }`}
        >
          {isDirectory ? (
            <>
              {isExpanded ? (
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              )}
              <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            </>
          ) : (
            <>
              <span className="w-3.5 h-3.5 inline-block shrink-0"></span>
              <FileCode className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
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
      {/* Top Banner & Git Action Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-slate-900 via-slate-900/90 to-blue-950/40 border border-slate-800 rounded-2xl p-5 shadow-xl">
        
        {/* Left Project Selector */}
        <div className="flex items-center space-x-3.5">
          <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
            <Code className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <label className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">Active Target Repository:</label>
              <select
                value={selectedProject?.id || ''}
                onChange={(e) => {
                  const p = projects.find((proj) => proj.id === e.target.value)
                  if (p) setSelectedProject(p)
                }}
                className="bg-slate-950 border border-cyan-500/40 text-cyan-300 text-xs font-mono px-3 py-1 rounded-lg focus:outline-none focus:border-cyan-400 cursor-pointer"
              >
                {projects.map((proj) => (
                  <option key={proj.id} value={proj.id}>
                    {proj.name} ({proj.repoName})
                  </option>
                ))}
              </select>
            </div>
            <p className="text-xs text-slate-400 flex items-center gap-2">
              <span className="font-mono text-slate-300">{selectedProject?.path}</span>
            </p>
          </div>
        </div>

        {/* Right Git Pull / Push Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Git Status Pill */}
          <div className="px-2.5 py-1 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono flex items-center gap-1.5">
            <GitBranch className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-slate-300">{gitStatus.branch}</span>
            {gitStatus.modifiedCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-amber-950 text-amber-400 border border-amber-800 text-[10px] font-bold">
                {gitStatus.modifiedCount} modified
              </span>
            )}
          </div>

          {/* Git Pull */}
          <button
            onClick={handleGitPull}
            disabled={pullingGit}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-800/60 rounded-xl font-medium text-xs flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
            title="Pull latest code from GitHub origin/main"
          >
            <Download className={`w-3.5 h-3.5 ${pullingGit ? 'animate-spin' : ''}`} />
            <span>{pullingGit ? 'Pulling...' : 'Git Pull'}</span>
          </button>

          {/* Git Commit & Push */}
          <button
            onClick={() => setShowCommitModal(true)}
            disabled={pushingGit}
            className="px-3.5 py-1.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-medium rounded-xl text-xs flex items-center gap-1.5 transition cursor-pointer shadow-md disabled:opacity-50"
            title="Commit all changes and push to GitHub origin/main"
          >
            <Upload className={`w-3.5 h-3.5 ${pushingGit ? 'animate-spin' : ''}`} />
            <span>{pushingGit ? 'Pushing...' : 'Git Commit & Push'}</span>
          </button>

          {/* AI Agent Studio Drawer Toggle */}
          <button
            onClick={() => setShowAgentDrawer(true)}
            className="px-3.5 py-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-medium rounded-xl text-xs flex items-center gap-1.5 transition cursor-pointer shadow-lg shadow-purple-900/30"
            title="Open Multi-Model AI Agent Studio (Gemini, Grok, Claude, ChatGPT)"
          >
            <Bot className="w-3.5 h-3.5 text-purple-200" />
            <span>AI Agent Studio</span>
          </button>

          {/* Save File */}
          {activeFile && (
            <button
              onClick={handleSaveFile}
              disabled={savingFile}
              className="px-3.5 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-medium rounded-xl text-xs flex items-center gap-1.5 transition cursor-pointer shadow-md disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{savingFile ? 'Saving...' : 'Save File'}</span>
            </button>
          )}

          <button
            onClick={() => selectedProject && fetchFileTree(selectedProject.path)}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-xl transition cursor-pointer"
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

      {/* Main Studio Editor Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 h-[620px]">
        
        {/* Left Tree Explorer Sidebar */}
        <div className="bg-slate-900/90 backdrop-blur border border-slate-800 rounded-2xl flex flex-col overflow-hidden shadow-xl">
          <div className="p-3 border-b border-slate-800 bg-slate-950/80 flex items-center justify-between text-xs font-semibold text-slate-400 uppercase tracking-wider">
            <span className="flex items-center gap-1.5">
              <Folder className="w-4 h-4 text-amber-400" />
              Project Explorer
            </span>
            <span className="text-[10px] text-slate-500 font-mono">TREE</span>
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
        <div className="lg:col-span-3 bg-slate-900/90 backdrop-blur border border-slate-800 rounded-2xl flex flex-col overflow-hidden shadow-xl">
          
          {/* File Tab Bar */}
          <div className="flex items-center bg-slate-950 border-b border-slate-800 overflow-x-auto text-xs font-mono">
            {openFiles.map((f) => (
              <button
                key={f.path}
                onClick={() => handleOpenFile(f)}
                className={`px-3.5 py-2.5 border-r border-slate-800 flex items-center gap-2 transition shrink-0 ${
                  activeFile?.path === f.path
                    ? 'bg-slate-900 text-cyan-300 border-t-2 border-t-cyan-400 font-semibold'
                    : 'text-slate-400 hover:bg-slate-900/50'
                }`}
              >
                <FileCode className="w-3.5 h-3.5 text-cyan-400" />
                <span>{f.name}</span>
                <span
                  onClick={(e) => handleCloseTab(f.path, e)}
                  className="p-0.5 hover:bg-slate-800 rounded text-slate-500 hover:text-rose-400 transition"
                >
                  <X className="w-3 h-3" />
                </span>
              </button>
            ))}
          </div>

          {/* Active File Content Code Editor Area */}
          {activeFile ? (
            <div className="flex-1 flex flex-col relative font-mono text-xs bg-slate-950">
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
                className="flex-1 w-full p-4 bg-slate-950 text-slate-100 font-mono text-xs focus:outline-none resize-none leading-relaxed select-text"
              ></textarea>
              <div className="p-2 bg-slate-900 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400 font-mono">
                <span className="truncate">{activeFile.fullPath || activeFile.path}</span>
                <span>Lines: {fileContent.split('\n').length}</span>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-500">
              <Code className="w-12 h-12 text-slate-700 mb-3" />
              <p className="text-sm font-medium text-slate-400">No File Selected</p>
              <p className="text-xs text-slate-500 max-w-sm mt-1">Select a file from the left Project Explorer tree to open and edit code directly in Code Studio</p>
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
    </div>
  )
}
