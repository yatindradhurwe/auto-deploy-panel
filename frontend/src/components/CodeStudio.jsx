import React, { useState, useEffect } from 'react'
import { Folder, FileCode, ChevronRight, ChevronDown, Save, RefreshCw, Code, Terminal, FileText, CheckCircle2, Play, Search, X } from 'lucide-react'

export default function CodeStudio({ jwtToken, activeServer }) {
  const [fileTree, setFileTree] = useState([])
  const [openFiles, setOpenFiles] = useState([])
  const [activeFile, setActiveFile] = useState(null)
  const [fileContent, setFileContent] = useState('')
  const [loadingTree, setLoadingTree] = useState(true)
  const [loadingFile, setLoadingFile] = useState(false)
  const [savingFile, setSavingFile] = useState(false)
  const [saveMessage, setSaveMessage] = useState(null)
  const [expandedFolders, setExpandedFolders] = useState({})

  useEffect(() => {
    fetchFileTree()
  }, [])

  const fetchFileTree = async () => {
    setLoadingTree(true)
    try {
      const res = await fetch('/api/studio/files/tree', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify({ projectPath: '' })
      })
      const data = await res.json()
      if (data.success) {
        setFileTree(data.tree)
        // Expand root level folders
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

  const handleOpenFile = async (fileItem) => {
    if (fileItem.type === 'directory') {
      setExpandedFolders((prev) => ({ ...prev, [fileItem.path]: !prev[fileItem.path] }))
      return
    }

    // Add to open tabs if not already open
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

  // Recursive Tree Node Renderer
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
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-slate-900 via-slate-900/90 to-blue-950/40 border border-slate-800 rounded-2xl p-5 shadow-xl">
        <div className="flex items-center space-x-3.5">
          <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
            <Code className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
              Code Studio & IDE Explorer
              <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-950 border border-cyan-800 text-cyan-400 font-mono">
                VS Code / Android Studio
              </span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">Visual repository file explorer, direct web code editor, syntax viewer & live patch deployer</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {activeFile && (
            <button
              onClick={handleSaveFile}
              disabled={savingFile}
              className="px-3.5 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-medium rounded-xl shadow-md text-xs flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>{savingFile ? 'Saving...' : 'Save File'}</span>
            </button>
          )}
          <button
            onClick={fetchFileTree}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-xl transition cursor-pointer"
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
                Scanning files...
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
    </div>
  )
}
