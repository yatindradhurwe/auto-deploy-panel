import React, { useState, useEffect, useRef } from 'react'
import {
  Folder, FileCode, ChevronRight, ChevronDown, Save, RefreshCw, Code, Terminal, FileText, CheckCircle2, Play, Search, X, GitBranch, Download, Upload, AlertCircle, Sparkles, FolderGit2, Bot, RotateCcw, History, DownloadCloud, Trash2, Plus, FolderPlus, FilePlus, CornerDownRight, Check, Maximize2, Minimize2, Sliders, Command, Layers, ExternalLink
} from 'lucide-react'
import AIAgentStudioDrawer from './AIAgentStudioDrawer'

export default function CodeStudio({ jwtToken, activeServer, initialProject }) {
  const [projects, setProjects] = useState([])
  const [selectedProject, setSelectedProject] = useState(null)
  const [deleteStudioModal, setDeleteStudioModal] = useState(null)

  const [fileTree, setFileTree] = useState([])
  const [treeSearchQuery, setTreeSearchQuery] = useState('')
  const [openFiles, setOpenFiles] = useState([])
  const [activeFile, setActiveFile] = useState(null)
  const [fileContent, setFileContent] = useState('')
  const [initialContent, setInitialContent] = useState('')
  const [loadingTree, setLoadingTree] = useState(true)
  const [loadingFile, setLoadingFile] = useState(false)
  const [savingFile, setSavingFile] = useState(false)
  const [saveMessage, setSaveMessage] = useState(null)
  const [expandedFolders, setExpandedFolders] = useState({})

  // Selected Node in Tree (for context actions like create file in folder / delete folder)
  const [selectedTreeNode, setSelectedTreeNode] = useState(null)

  // New File / Folder Modal State
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createType, setCreateType] = useState('file') // 'file' | 'folder'
  const [newRelPath, setNewRelPath] = useState('')
  const [creatingItem, setCreatingItem] = useState(false)

  // Upload Modal State
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [uploadFiles, setUploadFiles] = useState([])
  const [uploadTargetDir, setUploadTargetDir] = useState('')
  const [uploadingFiles, setUploadingFiles] = useState(false)
  const [uploadSuccessMsg, setUploadSuccessMsg] = useState(null)

  // Integrated Terminal State
  const [showTerminal, setShowTerminal] = useState(false)
  const [terminalCmd, setTerminalCmd] = useState('')
  const [terminalLogs, setTerminalLogs] = useState([])
  const [executingTerminalCmd, setExecutingTerminalCmd] = useState(false)
  const terminalEndRef = useRef(null)

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
  const [updatingLive, setUpdatingLive] = useState(false)

  // ⌘S Keyboard Shortcut for Save File
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (activeFile && !savingFile) {
          handleSaveFile()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeFile, fileContent, savingFile])

  // Auto scroll terminal logs
  useEffect(() => {
    if (showTerminal) {
      terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [terminalLogs, showTerminal])

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

  // Create File / Directory Action
  const handleCreateFileOrFolder = async (e) => {
    e.preventDefault()
    if (!selectedProject || !newRelPath.trim()) return
    setCreatingItem(true)
    try {
      const basePrefix = selectedTreeNode && selectedTreeNode.type === 'directory' ? selectedTreeNode.path + '/' : ''
      const targetRelPath = basePrefix + newRelPath.trim()

      const res = await fetch('/api/studio/files/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify({
          projectPath: selectedProject.path,
          relativePath: targetRelPath,
          type: createType
        })
      })
      const data = await res.json()
      if (data.success) {
        setShowCreateModal(false)
        setNewRelPath('')
        fetchFileTree(selectedProject.path)
        if (createType === 'file') {
          handleOpenFile({
            name: newRelPath.split('/').pop(),
            path: targetRelPath,
            fullPath: data.fullPath,
            type: 'file'
          })
        }
      } else {
        alert(`Creation Error: ${data.error}`)
      }
    } catch (err) {
      alert(`Creation Failed: ${err.message}`)
    } finally {
      setCreatingItem(false)
    }
  }

  // Delete Selected File or Folder
  const handleDeleteSelectedTreeItem = async (nodeToDelete) => {
    const targetNode = nodeToDelete || selectedTreeNode
    if (!selectedProject || !targetNode) {
      alert('Please select a file or folder in the tree to delete.')
      return
    }

    if (!window.confirm(`Are you sure you want to permanently delete '${targetNode.name}'?`)) return

    try {
      const res = await fetch('/api/studio/files/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify({ filePath: targetNode.fullPath || targetNode.path })
      })
      const data = await res.json()
      if (data.success) {
        if (activeFile && activeFile.path === targetNode.path) {
          handleCloseTab(targetNode.path, { stopPropagation: () => {} })
        }
        setSelectedTreeNode(null)
        fetchFileTree(selectedProject.path)
      } else {
        alert(`Delete Error: ${data.error}`)
      }
    } catch (err) {
      alert(`Delete Failed: ${err.message}`)
    }
  }

  // Upload Files / Folders Engine
  const handleProcessUploadedFiles = async (e) => {
    const inputFiles = e.target.files
    if (!inputFiles || inputFiles.length === 0 || !selectedProject) return

    setUploadingFiles(true)
    setUploadSuccessMsg(null)

    try {
      const processedFiles = []
      for (let i = 0; i < inputFiles.length; i++) {
        const f = inputFiles[i]
        const relPath = f.webkitRelativePath || f.name
        
        // Read file content as Base64 for binary or UTF-8 text
        const base64Content = await new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => {
            const result = reader.result
            const base64 = result.split(',')[1] || result
            resolve(base64)
          }
          reader.onerror = reject
          reader.readAsDataURL(f)
        })

        processedFiles.push({
          relativePath: relPath,
          contentBase64: base64Content
        })
      }

      const res = await fetch('/api/studio/files/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify({
          projectPath: selectedProject.path,
          targetDir: uploadTargetDir,
          files: processedFiles
        })
      })

      const data = await res.json()
      if (data.success) {
        setUploadSuccessMsg(`🎉 ${data.message}`)
        fetchFileTree(selectedProject.path)
        setTimeout(() => {
          setShowUploadModal(false)
          setUploadSuccessMsg(null)
        }, 2000)
      } else {
        alert(`Upload Error: ${data.error}`)
      }
    } catch (err) {
      alert(`Upload Failed: ${err.message}`)
    } finally {
      setUploadingFiles(false)
    }
  }

  // Run Terminal Command inside Code Studio
  const handleExecuteTerminalCommand = async (cmdToRun = terminalCmd) => {
    if (!cmdToRun || !cmdToRun.trim() || !selectedProject) return
    const execCmd = cmdToRun.trim()
    setExecutingTerminalCmd(true)
    
    setTerminalLogs((prev) => [
      ...prev,
      { type: 'input', text: `$ ${execCmd}\n`, timestamp: new Date().toLocaleTimeString() }
    ])

    if (cmdToRun === terminalCmd) setTerminalCmd('')

    try {
      const res = await fetch('/api/studio/terminal/exec', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify({
          projectPath: selectedProject.path,
          command: execCmd
        })
      })
      const data = await res.json()
      if (data.output) {
        setTerminalLogs((prev) => [...prev, { type: 'output', text: data.output, isError: !data.success }])
      } else if (data.error) {
        setTerminalLogs((prev) => [...prev, { type: 'output', text: `ERROR: ${data.error}\n`, isError: true }])
      }
    } catch (err) {
      setTerminalLogs((prev) => [...prev, { type: 'output', text: `Terminal Request Exception: ${err.message}\n`, isError: true }])
    } finally {
      setExecutingTerminalCmd(false)
    }
  }

  const handleOpenFile = async (fileItem) => {
    if (fileItem.type === 'directory') {
      setExpandedFolders((prev) => ({ ...prev, [fileItem.path]: !prev[fileItem.path] }))
      setSelectedTreeNode(fileItem)
      return
    }

    setSelectedTreeNode(fileItem)
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
        body: JSON.stringify({
          filePath: fileItem.fullPath || fileItem.path,
          projectPath: selectedProject ? selectedProject.path : undefined
        })
      })
      const data = await res.json()
      if (data.success) {
        setFileContent(data.content)
        setInitialContent(data.content)
      } else {
        setFileContent(`// Error reading file: ${data.error}`)
        setInitialContent('')
      }
    } catch (err) {
      setFileContent(`// Failed to fetch file content: ${err.message}`)
      setInitialContent('')
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
        setInitialContent('')
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
          projectPath: selectedProject ? selectedProject.path : undefined,
          content: fileContent
        })
      })
      const data = await res.json()
      if (data.success) {
        setSaveMessage('File saved successfully!')
        setInitialContent(fileContent)
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

  const getLanguageMode = (fileName) => {
    if (!fileName) return 'Plain Text'
    const ext = fileName.split('.').pop()?.toLowerCase()
    if (ext === 'jsx' || ext === 'tsx') return 'JavaScript React'
    if (ext === 'js' || ext === 'ts') return 'JavaScript'
    if (ext === 'json') return 'JSON'
    if (ext === 'html') return 'HTML5'
    if (ext === 'css') return 'CSS3'
    if (ext === 'md') return 'Markdown'
    if (ext === 'py') return 'Python'
    if (ext === 'sh') return 'Shell Script'
    return 'Plain Text'
  }

  const filterTreeNodes = (nodes, query) => {
    if (!query) return nodes
    const lowerQ = query.toLowerCase()

    return nodes.filter((node) => {
      if (node.name.toLowerCase().includes(lowerQ)) return true
      if (node.children) {
        const filteredChildren = filterTreeNodes(node.children, query)
        return filteredChildren.length > 0
      }
      return false
    })
  }

  const renderTreeNode = (node, depth = 0) => {
    const isExpanded = expandedFolders[node.path]
    const isDirectory = node.type === 'directory'
    const isSelected = selectedTreeNode?.path === node.path
    const isActiveTabFile = activeFile?.path === node.path

    return (
      <div key={node.path} className="select-none">
        <button
          onClick={() => handleOpenFile(node)}
          style={{ paddingLeft: `${depth * 14 + 10}px` }}
          className={`w-full text-left py-1 pr-2 rounded-lg flex items-center justify-between text-xs transition cursor-pointer font-mono group ${
            isActiveTabFile
              ? 'bg-cyan-500/20 text-cyan-300 font-bold border-l-2 border-cyan-400'
              : isSelected
              ? 'bg-slate-800/80 text-white'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/80'
          }`}
        >
          <div className="flex items-center space-x-2 truncate">
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
                <span className="w-3.5 h-3.5 shrink-0" />
                {getFileIcon(node.name)}
              </>
            )}
            <span className="truncate text-[11px]">{node.name}</span>
          </div>

          {/* Inline Delete Quick Button */}
          <span
            onClick={(e) => {
              e.stopPropagation()
              handleDeleteSelectedTreeItem(node)
            }}
            title="Delete this file/folder"
            className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-500 hover:text-rose-400 transition"
          >
            <Trash2 className="w-3 h-3" />
          </span>
        </button>

        {isDirectory && isExpanded && node.children && (
          <div className="space-y-0.5">
            {node.children.map((child) => renderTreeNode(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  const filteredTree = filterTreeNodes(fileTree, treeSearchQuery)

  // Editor Lines & Chars count
  const fileLinesCount = fileContent ? fileContent.split('\n').length : 0
  const fileCharCount = fileContent ? fileContent.length : 0
  const isModified = fileContent !== initialContent

  return (
    <div className="space-y-4 font-sans">

      {/* Code Studio Top Bar Header */}
      <div className="bg-slate-900/80 backdrop-blur-2xl border border-white/10 rounded-3xl p-5 shadow-2xl shadow-slate-950/50 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center space-x-3.5">
          <div className="p-3 rounded-2xl bg-gradient-to-tr from-cyan-500/20 to-blue-600/20 text-cyan-400 border border-cyan-500/30 ring-1 ring-cyan-500/20 shadow-inner">
            <FolderTree className="h-6 w-6 text-cyan-400" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-lg font-extrabold text-white">Code Studio IDE</h1>
              <span className="text-[10px] bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 px-2 py-0.5 rounded-full font-mono font-bold">
                VS CODE MODE
              </span>
            </div>
            <p className="text-xs text-slate-400 font-mono mt-0.5">
              Multi-file editor, integrated terminal execution, file uploads, and AI Agent code modifications.
            </p>
          </div>
        </div>

        {/* Project Selector & Actions */}
        <div className="flex items-center space-x-2 overflow-x-auto">
          {/* Project Dropdown */}
          <select
            value={selectedProject ? selectedProject.id : ''}
            onChange={(e) => {
              const proj = projects.find((p) => p.id === e.target.value)
              if (proj) {
                setSelectedProject(proj)
                setOpenFiles([])
                setActiveFile(null)
                setFileContent('')
                setSelectedTreeNode(null)
              }
            }}
            className="bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-cyan-400 shadow-inner"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                📁 {p.name} ({p.branch || 'main'})
              </option>
            ))}
          </select>

          {/* AI Agent Studio Drawer Trigger */}
          <button
            onClick={() => setShowAgentDrawer(true)}
            className="bg-gradient-to-r from-cyan-500/20 via-blue-500/20 to-indigo-500/20 hover:from-cyan-500/30 hover:to-indigo-500/30 text-cyan-300 border border-cyan-500/40 text-xs px-3.5 py-2 rounded-xl font-bold flex items-center space-x-1.5 transition shadow-md shadow-cyan-950/40 cursor-pointer"
          >
            <Sparkles className="h-3.5 w-3.5 text-cyan-400 animate-pulse" />
            <span>AI Code Agent</span>
          </button>

          {/* Terminal Drawer Toggle */}
          <button
            onClick={() => setShowTerminal(!showTerminal)}
            className={`text-xs px-3 py-2 rounded-xl flex items-center space-x-1.5 transition font-semibold cursor-pointer border ${
              showTerminal
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50 shadow-md shadow-emerald-950/40'
                : 'bg-slate-950/80 hover:bg-slate-800 text-slate-300 border-white/10'
            }`}
          >
            <Terminal className="h-3.5 w-3.5 text-emerald-400" />
            <span>Terminal</span>
          </button>

          {/* Git Commit & Push */}
          <button
            onClick={() => setShowCommitModal(true)}
            className="bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/40 text-xs px-3 py-2 rounded-xl font-semibold flex items-center space-x-1 transition cursor-pointer"
          >
            <GitBranch className="h-3.5 w-3.5 text-purple-400" />
            <span>Commit ({gitStatus.modifiedCount})</span>
          </button>

          {/* Pull & Update Live Server */}
          <button
            onClick={handlePullAndUpdateLiveServer}
            disabled={updatingLive}
            className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 text-white font-bold px-3.5 py-2 rounded-xl text-xs flex items-center space-x-1.5 transition shadow-lg shadow-purple-950/40 cursor-pointer"
          >
            <DownloadCloud className={`h-3.5 w-3.5 text-purple-200 ${updatingLive ? 'animate-bounce' : ''}`} />
            <span>{updatingLive ? 'Updating...' : 'Update Live Server'}</span>
          </button>

          {/* Delete Project */}
          {selectedProject && (
            <button
              onClick={() => setDeleteStudioModal({
                id: selectedProject.id,
                appName: selectedProject.repoName || selectedProject.name,
                projectPath: selectedProject.path,
                domain: selectedProject.name.includes('.com') ? selectedProject.name : `${selectedProject.repoName || selectedProject.name}.com`,
                deletePm2: true,
                deleteFiles: true,
                deleteNginx: true,
                deleting: false
              })}
              className="p-2 bg-rose-950/50 hover:bg-rose-900/80 text-rose-300 border border-rose-800/80 rounded-xl text-xs transition cursor-pointer"
              title="Delete this project from live server"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Main Studio Split Layout: Sidebar Explorer + VS Code Editor */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 items-start">
        
        {/* Left Explorer File Tree Sidebar */}
        <div className="bg-slate-900/60 backdrop-blur-2xl border border-white/10 rounded-3xl p-4 space-y-3 shadow-2xl shadow-slate-950/50 flex flex-col h-[650px] overflow-hidden">
          
          {/* Tree Header & Action Toolbar */}
          <div className="space-y-2 border-b border-white/10 pb-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <Folder className="w-3.5 h-3.5 text-cyan-400" />
                <span>Explorer</span>
              </span>

              {/* Action Icons: New File, New Folder, Upload, Delete, Refresh */}
              <div className="flex items-center space-x-1">
                <button
                  onClick={() => {
                    setCreateType('file')
                    setNewRelPath('')
                    setShowCreateModal(true)
                  }}
                  title="Create New File"
                  className="p-1 text-slate-400 hover:text-cyan-300 hover:bg-slate-800 rounded-lg transition cursor-pointer"
                >
                  <FilePlus className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={() => {
                    setCreateType('folder')
                    setNewRelPath('')
                    setShowCreateModal(true)
                  }}
                  title="Create New Directory"
                  className="p-1 text-slate-400 hover:text-amber-300 hover:bg-slate-800 rounded-lg transition cursor-pointer"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={() => setShowUploadModal(true)}
                  title="Upload Files or Folders"
                  className="p-1 text-slate-400 hover:text-emerald-300 hover:bg-slate-800 rounded-lg transition cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={() => handleDeleteSelectedTreeItem()}
                  disabled={!selectedTreeNode}
                  title={selectedTreeNode ? `Delete '${selectedTreeNode.name}'` : 'Select item to delete'}
                  className="p-1 text-slate-400 hover:text-rose-400 disabled:opacity-30 hover:bg-slate-800 rounded-lg transition cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={() => selectedProject && fetchFileTree(selectedProject.path)}
                  title="Refresh File Tree"
                  className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingTree ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {/* Tree Search Filter Bar */}
            <div className="relative">
              <input
                type="text"
                value={treeSearchQuery}
                onChange={(e) => setTreeSearchQuery(e.target.value)}
                placeholder="Filter files..."
                className="w-full bg-slate-950 border border-white/10 rounded-xl pl-7 pr-2.5 py-1 text-xs text-slate-200 font-mono focus:outline-none focus:border-cyan-400 shadow-inner"
              />
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2 top-2" />
              {treeSearchQuery && (
                <button
                  onClick={() => setTreeSearchQuery('')}
                  className="absolute right-2 top-2 text-slate-500 hover:text-slate-300"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* File Tree List */}
          <div className="flex-1 overflow-y-auto space-y-0.5 pr-1">
            {loadingTree ? (
              <div className="h-40 flex flex-col items-center justify-center space-y-2 text-slate-500 text-xs font-mono">
                <RefreshCw className="w-5 h-5 animate-spin text-cyan-400" />
                <span>Scanning directory...</span>
              </div>
            ) : filteredTree.length === 0 ? (
              <div className="h-40 flex flex-col items-center justify-center space-y-2 text-slate-500 text-xs text-center p-4 font-mono">
                <FileText className="w-6 h-6 text-slate-600" />
                <p>No files match search query.</p>
              </div>
            ) : (
              filteredTree.map((node) => renderTreeNode(node))
            )}
          </div>

          {/* Selected Node Status Footer */}
          <div className="pt-2 border-t border-white/10 text-[10px] font-mono text-slate-400 flex items-center justify-between">
            <span className="truncate">Path: {selectedTreeNode ? selectedTreeNode.path : 'Root'}</span>
            <span className="text-cyan-400 font-bold">{selectedTreeNode ? selectedTreeNode.type : ''}</span>
          </div>
        </div>

        {/* Right VS Code File Editor Workspace */}
        <div className="lg:col-span-3 bg-slate-900/60 backdrop-blur-2xl border border-white/10 rounded-3xl overflow-hidden shadow-2xl shadow-slate-950/50 flex flex-col h-[650px]">
          
          {/* Tab Bar across top of editor */}
          <div className="bg-slate-950 border-b border-white/10 flex items-center overflow-x-auto select-none">
            {openFiles.length === 0 ? (
              <div className="px-4 py-2.5 text-xs text-slate-500 font-mono flex items-center gap-2">
                <Code className="w-4 h-4 text-slate-600" />
                <span>No files open. Click a file from Explorer to edit.</span>
              </div>
            ) : (
              openFiles.map((file) => {
                const isActive = activeFile?.path === file.path
                return (
                  <div
                    key={file.path}
                    onClick={() => handleOpenFile(file)}
                    className={`px-3 py-2 border-r border-white/10 flex items-center space-x-2 text-xs font-mono cursor-pointer transition ${
                      isActive
                        ? 'bg-slate-900 text-cyan-300 font-bold border-t-2 border-t-cyan-400'
                        : 'bg-slate-950 text-slate-400 hover:bg-slate-900/60 hover:text-slate-200'
                    }`}
                  >
                    {getFileIcon(file.name)}
                    <span className="truncate max-w-[140px] text-[11px]">{file.name}</span>
                    <button
                      onClick={(e) => handleCloseTab(file.path, e)}
                      className="p-0.5 rounded text-slate-500 hover:text-white hover:bg-slate-800 transition"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )
              })
            )}
          </div>

          {/* Breadcrumbs Header */}
          {activeFile && (
            <div className="bg-slate-900/90 border-b border-white/10 px-4 py-1.5 flex items-center justify-between text-[11px] font-mono text-slate-400 select-none">
              <div className="flex items-center space-x-1.5 truncate">
                <span className="text-cyan-400 font-bold">{selectedProject ? selectedProject.name : 'Project'}</span>
                {activeFile.path.split('/').map((part, idx) => (
                  <React.Fragment key={idx}>
                    <ChevronRight className="w-3 h-3 text-slate-600 shrink-0" />
                    <span className={idx === activeFile.path.split('/').length - 1 ? 'text-white font-bold' : 'text-slate-400'}>
                      {part}
                    </span>
                  </React.Fragment>
                ))}
              </div>

              <div className="flex items-center space-x-3">
                {isModified && (
                  <span className="text-[10px] text-amber-400 font-bold flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
                    Unsaved
                  </span>
                )}
                {saveMessage && (
                  <span className="text-[10px] text-emerald-400 font-bold flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    Saved
                  </span>
                )}
                <button
                  onClick={handleSaveFile}
                  disabled={savingFile}
                  className="bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-bold px-3 py-1 rounded-lg text-xs flex items-center space-x-1 transition cursor-pointer shadow-sm"
                >
                  <Save className={`w-3.5 h-3.5 ${savingFile ? 'animate-spin' : ''}`} />
                  <span>{savingFile ? 'Saving...' : 'Save (⌘S)'}</span>
                </button>
              </div>
            </div>
          )}

          {/* Code Editor Body */}
          <div className="flex-1 bg-slate-950 relative overflow-hidden flex">
            {loadingFile ? (
              <div className="w-full h-full flex flex-col items-center justify-center space-y-2 text-slate-500 text-xs font-mono">
                <RefreshCw className="w-6 h-6 animate-spin text-cyan-400" />
                <span>Reading file content...</span>
              </div>
            ) : !activeFile ? (
              <div className="w-full h-full flex flex-col items-center justify-center text-slate-600 space-y-3 p-6 text-center font-mono">
                <FileCode className="w-12 h-12 text-slate-700" />
                <div>
                  <p className="text-sm font-bold text-slate-400">Visual Studio Code Editor</p>
                  <p className="text-xs text-slate-500 mt-1 max-w-sm">
                    Select a file from the explorer sidebar on the left to edit code, or create new files and upload folders.
                  </p>
                </div>
                <kbd className="bg-slate-900 border border-slate-800 text-slate-400 text-xs px-3 py-1 rounded-lg font-mono">
                  ⌘S to Save File
                </kbd>
              </div>
            ) : (
              <textarea
                value={fileContent}
                onChange={(e) => setFileContent(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Tab') {
                    e.preventDefault()
                    const start = e.target.selectionStart
                    const end = e.target.selectionEnd
                    const updated = fileContent.substring(0, start) + '  ' + fileContent.substring(end)
                    setFileContent(updated)
                    setTimeout(() => {
                      e.target.selectionStart = e.target.selectionEnd = start + 2
                    }, 0)
                  }
                }}
                placeholder="// Code Editor..."
                spellCheck={false}
                className="w-full h-full bg-[#07090E] text-slate-100 font-mono text-xs p-4 focus:outline-none resize-none leading-relaxed selection:bg-cyan-500/30 selection:text-cyan-200"
              />
            )}
          </div>

          {/* Integrated Bottom Terminal Drawer */}
          {showTerminal && (
            <div className="bg-slate-950 border-t border-white/10 h-52 flex flex-col font-mono text-xs animate-in slide-in-from-bottom duration-200">
              <div className="bg-slate-900 px-3 py-1.5 border-b border-white/10 flex items-center justify-between text-slate-400 text-[11px]">
                <div className="flex items-center space-x-2">
                  <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="font-bold text-white">Integrated Terminal</span>
                  <span className="text-slate-500">({selectedProject ? selectedProject.path : 'Root'})</span>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => handleExecuteTerminalCommand('npm install')}
                    className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px]"
                  >
                    npm install
                  </button>
                  <button
                    onClick={() => handleExecuteTerminalCommand('git status')}
                    className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px]"
                  >
                    git status
                  </button>
                  <button
                    onClick={() => handleExecuteTerminalCommand('ls -la')}
                    className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px]"
                  >
                    ls -la
                  </button>
                  <button
                    onClick={() => setTerminalLogs([])}
                    className="p-1 text-slate-500 hover:text-white"
                    title="Clear Terminal"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Terminal Logs Window */}
              <div className="flex-1 p-3 overflow-y-auto space-y-1 bg-slate-950 text-slate-300 leading-relaxed text-[11px]">
                {terminalLogs.length === 0 ? (
                  <div className="text-slate-600 italic">
                    Type a command below (e.g. npm test, ls, git status) and press Enter...
                  </div>
                ) : (
                  terminalLogs.map((log, idx) => (
                    <div key={idx} className={`whitespace-pre-wrap ${log.isError ? 'text-rose-400' : log.type === 'input' ? 'text-cyan-300 font-bold' : 'text-slate-300'}`}>
                      {log.text}
                    </div>
                  ))
                )}
                <div ref={terminalEndRef} />
              </div>

              {/* Terminal Input Bar */}
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  handleExecuteTerminalCommand()
                }}
                className="bg-slate-900 border-t border-white/10 px-3 py-1.5 flex items-center gap-2"
              >
                <span className="text-emerald-400 font-bold">$</span>
                <input
                  type="text"
                  value={terminalCmd}
                  onChange={(e) => setTerminalCmd(e.target.value)}
                  placeholder="Execute shell command in project directory..."
                  className="flex-1 bg-transparent text-xs text-white focus:outline-none font-mono"
                />
                <button
                  type="submit"
                  disabled={executingTerminalCmd || !terminalCmd.trim()}
                  className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-slate-950 font-bold text-xs rounded-lg flex items-center gap-1 transition cursor-pointer"
                >
                  <Play className="w-3 h-3 fill-current" />
                  <span>Run</span>
                </button>
              </form>
            </div>
          )}

          {/* VS Code Bottom Status Bar */}
          <div className="bg-slate-950 border-t border-white/10 px-4 py-1.5 flex items-center justify-between text-[11px] font-mono text-slate-400 select-none">
            <div className="flex items-center space-x-4">
              <span className="flex items-center gap-1 text-cyan-400">
                <GitBranch className="w-3 h-3" />
                <span>{gitStatus.branch || 'main'}</span>
              </span>

              <span>Ln {fileLinesCount}, Ch {fileCharCount}</span>
              <span>UTF-8</span>
              <span>Spaces: 2</span>
            </div>

            <div className="flex items-center space-x-4">
              <span>Mode: <strong className="text-slate-200">{getLanguageMode(activeFile?.name)}</strong></span>
              <span className="text-emerald-400 font-bold">VS Code Studio v2.0</span>
            </div>
          </div>

        </div>

      </div>

      {/* New File / New Directory Creation Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-3">
                <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  {createType === 'file' ? <FilePlus className="w-5 h-5" /> : <FolderPlus className="w-5 h-5" />}
                </div>
                <div>
                  <h3 className="font-extrabold text-white text-sm">Create New {createType === 'file' ? 'File' : 'Folder'}</h3>
                  <p className="text-[11px] text-slate-400 font-mono">
                    {selectedTreeNode && selectedTreeNode.type === 'directory' ? `Inside '${selectedTreeNode.path}'` : 'In project root'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateFileOrFolder} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest">
                  Relative {createType === 'file' ? 'File Path (e.g. src/utils/helpers.js)' : 'Folder Path (e.g. src/utils)'}
                </label>
                <input
                  type="text"
                  autoFocus
                  value={newRelPath}
                  onChange={(e) => setNewRelPath(e.target.value)}
                  placeholder={createType === 'file' ? 'e.g. src/components/NewComponent.jsx' : 'e.g. src/services'}
                  className="w-full bg-slate-950 border border-white/10 rounded-2xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-cyan-400 shadow-inner"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={creatingItem || !newRelPath.trim()}
                  className="px-5 py-2 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-bold rounded-xl text-xs flex items-center gap-1 transition shadow-lg shadow-cyan-950/40 cursor-pointer"
                >
                  {creatingItem ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  <span>{creatingItem ? 'Creating...' : `Create ${createType}`}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* File & Folder Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-emerald-500/40 rounded-3xl max-w-lg w-full p-6 space-y-4 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-3">
                <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <Upload className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-white text-sm">Upload Files & Folders</h3>
                  <p className="text-[11px] text-slate-400 font-mono">Upload files directly into project workspace on live server</p>
                </div>
              </div>
              <button
                onClick={() => setShowUploadModal(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest">Target Subdirectory (Optional)</label>
                <input
                  type="text"
                  value={uploadTargetDir}
                  onChange={(e) => setUploadTargetDir(e.target.value)}
                  placeholder="e.g. src/assets (Leave blank for project root)"
                  className="w-full bg-slate-950 border border-white/10 rounded-2xl px-3.5 py-2 text-xs text-white font-mono focus:outline-none focus:border-emerald-400"
                />
              </div>

              {/* Upload Drop Zone / Pickers */}
              <div className="border-2 border-dashed border-slate-700 hover:border-emerald-500/50 rounded-2xl p-6 text-center space-y-3 bg-slate-950/60 transition">
                <Upload className="w-8 h-8 text-emerald-400 mx-auto animate-bounce" />
                <div>
                  <p className="text-xs font-bold text-white">Select Single Files or Entire Directories</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">Files will be unpacked into project on server</p>
                </div>

                <div className="flex justify-center gap-3 pt-2">
                  <label className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-cyan-300 font-bold text-xs rounded-xl cursor-pointer border border-white/10 transition flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Select Files</span>
                    <input
                      type="file"
                      multiple
                      onChange={handleProcessUploadedFiles}
                      className="hidden"
                    />
                  </label>

                  <label className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold text-xs rounded-xl cursor-pointer border border-white/10 transition flex items-center gap-1.5">
                    <Folder className="w-3.5 h-3.5 text-amber-400" />
                    <span>Select Folder</span>
                    <input
                      type="file"
                      webkitdirectory="true"
                      directory="true"
                      multiple
                      onChange={handleProcessUploadedFiles}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              {uploadingFiles && (
                <div className="flex items-center space-x-2 text-xs font-mono text-cyan-300 bg-cyan-950/60 border border-cyan-800 p-3 rounded-2xl">
                  <RefreshCw className="w-4 h-4 animate-spin text-cyan-400" />
                  <span>Uploading files to live server workspace...</span>
                </div>
              )}

              {uploadSuccessMsg && (
                <div className="flex items-center space-x-2 text-xs font-mono text-emerald-300 bg-emerald-950/60 border border-emerald-800 p-3 rounded-2xl">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>{uploadSuccessMsg}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Commit & Push Modal */}
      {showCommitModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-3">
                <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
                  <GitBranch className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-white text-sm">Git Commit & Push</h3>
                  <p className="text-[11px] text-slate-400 font-mono">Commit changes and push to GitHub</p>
                </div>
              </div>
              <button
                onClick={() => setShowCommitModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleGitPushSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest">Commit Message</label>
                <input
                  type="text"
                  value={commitMsg}
                  onChange={(e) => setCommitMsg(e.target.value)}
                  placeholder="e.g. Update components & backend API"
                  className="w-full bg-slate-950 border border-white/10 rounded-2xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-cyan-400 shadow-inner"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCommitModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pushingGit || !commitMsg.trim()}
                  className="px-5 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 transition shadow-lg shadow-purple-950/40 disabled:opacity-50"
                >
                  {pushingGit ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <GitBranch className="w-3.5 h-3.5" />}
                  <span>{pushingGit ? 'Pushing...' : 'Commit & Push'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Git Log / Terminal Output Modal */}
      {gitLogModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-2xl w-full p-6 space-y-4 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-3">
                <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  <Terminal className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-white text-sm">{gitLogModal.title}</h3>
                  <p className="text-[11px] text-slate-400 font-mono">Git Command Terminal Output</p>
                </div>
              </div>
              <button
                onClick={() => setGitLogModal(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 h-64 overflow-y-auto font-mono text-xs text-slate-200 leading-relaxed whitespace-pre-wrap">
              {gitLogModal.output}
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setGitLogModal(null)}
                className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold transition"
              >
                Close Window
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Agent Studio Drawer */}
      <AIAgentStudioDrawer
        isOpen={showAgentDrawer}
        onClose={() => setShowAgentDrawer(false)}
        selectedProject={selectedProject}
        jwtToken={jwtToken}
        onCodeModified={() => {
          if (selectedProject) {
            fetchFileTree(selectedProject.path)
            fetchGitStatus(selectedProject.path)
            if (activeFile) handleOpenFile(activeFile)
          }
        }}
      />

    </div>
  )
}
