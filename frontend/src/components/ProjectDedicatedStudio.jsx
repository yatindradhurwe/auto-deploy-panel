import React, { useState, useEffect, useRef } from 'react'
import {
  ArrowLeft, ExternalLink, RefreshCw, Send, Sparkles, Bot, Code, Globe,
  Smartphone, Monitor, Play, CheckCircle2, ShieldAlert, Cpu, Database, Key,
  Activity, Layers, FileCode, Plus, Check, CheckCheck, Upload, GitCommit,
  Terminal, ChevronRight, X, AlertCircle, Eye, Sliders, Shield, Zap, FolderGit2, Trash2, Settings, Server
} from 'lucide-react'
import CodeStudio from './CodeStudio'
import ProjectAgentPanel from './ProjectAgentPanel'
import DatabaseManager from './DatabaseManager'
import EnvManager from './EnvManager'
import LogsTelemetryManager from './LogsTelemetryManager'
import GitSyncWorkspace from './GitSyncWorkspace'
import DeleteProjectModal from './DeleteProjectModal'
import ProjectSettingsModal from './ProjectSettingsModal'

export default function ProjectDedicatedStudio({ project, jwtToken, activeServer, onBackToDashboard }) {
  const [activeCanvasTab, setActiveCanvasTab] = useState('preview') // 'preview' | 'code' | 'database' | 'env' | 'logs'
  const [deviceMode, setDeviceMode] = useState('desktop') // 'desktop' | 'mobile'
  const [showSettingsModal, setShowSettingsModal] = useState(false)

  // AI Agent Left Panel State
  const [sidebarHidden, setSidebarHidden] = useState(false)
  const [errorMsg, setErrorMsg] = useState(null)

  // Server Update / Deployment Status
  const [publishing, setPublishing] = useState(false)
  const [publishSuccessMsg, setPublishSuccessMsg] = useState(null)
  const [iframeKey, setIframeKey] = useState(1)
  const [showDeleteModal, setShowDeleteModal] = useState(false)

  const getEffectiveToken = () => {
    return jwtToken || localStorage.getItem('autodeploy_token') || localStorage.getItem('autodeploy_jwt_token') || ''
  }

  const [useProxy, setUseProxy] = useState(false)

  // Determine Live Web URL for Preview
  const getDirectPreviewUrl = () => {
    if (!project) return 'https://automate-deployment.yjtechnosoft.com'

    // 1. Explicit domain property on project
    if (project.domain && project.domain.trim()) {
      let dom = project.domain.trim()
      dom = dom.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '')
      if (dom) return `https://${dom}`
    }

    const cleanName = (project.repoName || project.name || '').toLowerCase()

    // 2. Known project domain mappings (Exact matches only)
    if (cleanName === 'auto-deploy-panel' || cleanName === 'autodeploy') {
      return 'https://automate-deployment.yjtechnosoft.com'
    }
    if (cleanName === 'tip-crm' || cleanName === 'crm-export') {
      return 'https://tip-crm.yjtechnosoft.com'
    }
    if (cleanName === 'litigation') {
      return 'https://litigation.yjtechnosoft.com'
    }

    // 3. Direct server IP and port fallback
    const host = activeServer ? (activeServer.ipAddress || activeServer.host) : '187.127.165.128'
    const port = project.backendPort || project.port || 5050
    return `http://${host}:${port}`
  }

  const getIframeSrc = () => {
    const directUrl = getDirectPreviewUrl()
    if (useProxy) {
      const tok = getEffectiveToken()
      return `/api/studio/preview-proxy?url=${encodeURIComponent(directUrl)}&token=${encodeURIComponent(tok)}`
    }
    return directUrl
  }

  // One-Click Server Publish & Deploy Update
  const handlePublishServerUpdate = async () => {
    setPublishing(true)
    setPublishSuccessMsg(null)
    setErrorMsg(null)
    const token = getEffectiveToken()

    try {
      const res = await fetch('/api/studio/git/pull-and-update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({
          appName: project.repoName || project.name,
          projectPath: project.path,
          host: activeServer ? (activeServer.ipAddress || activeServer.host) : '187.127.165.128',
          branch: 'main'
        })
      })
      const data = await res.json()
      if (data.success) {
        setPublishSuccessMsg(`🎉 Successfully published updates to live server! PM2 reloaded.`)
        setIframeKey((k) => k + 1)
      } else {
        setErrorMsg(`Publish failed: ${data.error}`)
      }
    } catch (e) {
      setErrorMsg(`Server update error: ${e.message}`)
    } finally {
      setPublishing(false)
    }
  }

  const safeText = (val) => {
    if (val === null || val === undefined) return ''
    if (typeof val === 'object') {
      if (val.text) return String(val.text)
      if (val.message) return String(val.message)
      if (val.data && Array.isArray(val.data)) return String(val.data)
      return JSON.stringify(val)
    }
    return String(val)
  }

  return (
    <div className="min-h-screen bg-[#07090E] text-slate-100 flex flex-col font-sans overflow-hidden">
      
      {/* Top Header Navigation Bar (Fits 100% in Viewport, Icon-Only Project Settings) */}
      <header className="h-14 bg-[#0B0E17]/90 backdrop-blur-2xl border-b border-white/10 px-3 lg:px-5 flex items-center justify-between gap-2 z-30 shrink-0 shadow-2xl sticky top-0 overflow-x-auto scrollbar-none">
        
        {/* Left: Back to Dashboard & Project Breadcrumb */}
        <div className="flex items-center space-x-2.5 shrink-0">
          <button
            onClick={onBackToDashboard}
            className="h-8.5 px-2.5 bg-slate-900/90 hover:bg-slate-800 text-slate-200 border border-white/10 hover:border-cyan-500/40 rounded-xl text-xs font-bold font-mono inline-flex items-center justify-center space-x-1 transition-all cursor-pointer shadow-md backdrop-blur-md shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span className="hidden sm:inline">Dashboard</span>
          </button>

          <div className="h-4 w-px bg-white/15 hidden sm:block shrink-0"></div>

          <div className="flex items-center space-x-1.5 font-mono text-xs shrink-0">
            <span className="text-slate-400 font-medium hidden md:inline">Projects</span>
            <span className="text-slate-600 hidden md:inline">/</span>
            <span className="font-extrabold text-white flex items-center gap-1.5 tracking-tight text-xs sm:text-sm">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0"></span>
              <span className="truncate max-w-[90px] sm:max-w-[140px] md:max-w-[180px] inline-block align-middle">{project?.name || 'Selected Project'}</span>
            </span>
            <span className="text-[10px] bg-cyan-950/90 text-cyan-300 border border-cyan-500/30 px-2 py-0.5 rounded-full font-bold uppercase backdrop-blur-md hidden lg:inline-block shrink-0">
              {project?.type || 'Web App'}
            </span>
            <span title={activeServer?.ipAddress || ''} className="text-[10px] bg-slate-900 text-slate-300 border border-white/10 px-2 py-0.5 rounded-full font-bold hidden md:inline-flex items-center gap-1 shrink-0">
              <Server className="w-3 h-3 text-cyan-400" /> {project?.serverName || activeServer?.name || 'This server'}
            </span>
          </div>
        </div>

        {/* Center: Canvas View Selector & Device Frame Controls */}
        <div className="flex items-center space-x-2 overflow-x-auto scrollbar-none py-0.5 max-w-full justify-center shrink-0">
          {/* Main View Mode Selector */}
          <div className="bg-slate-950/90 p-1 rounded-2xl border border-white/10 inline-flex items-center space-x-1 font-mono text-xs backdrop-blur-xl shadow-inner overflow-x-auto scrollbar-none shrink-0">
            <button
              onClick={() => setActiveCanvasTab('preview')}
              className={`h-8 px-3 rounded-xl font-bold inline-flex items-center justify-center space-x-1.5 transition-all duration-200 cursor-pointer whitespace-nowrap shrink-0 ${
                activeCanvasTab === 'preview'
                  ? 'bg-gradient-to-r from-cyan-500 via-indigo-600 to-indigo-700 text-white shadow-md shadow-cyan-500/25 ring-1 ring-cyan-400/40'
                  : 'text-slate-400 hover:text-white hover:bg-white/10'
              }`}
            >
              <Globe className="w-3.5 h-3.5 shrink-0" />
              <span>Live Preview</span>
            </button>

            <button
              onClick={() => setActiveCanvasTab('code')}
              className={`h-8 px-3 rounded-xl font-bold inline-flex items-center justify-center space-x-1.5 transition-all duration-200 cursor-pointer whitespace-nowrap shrink-0 ${
                activeCanvasTab === 'code'
                  ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md shadow-purple-600/25 ring-1 ring-purple-400/40'
                  : 'text-slate-400 hover:text-white hover:bg-white/10'
              }`}
            >
              <Code className="w-3.5 h-3.5 shrink-0" />
              <span>Code Studio</span>
            </button>

            <button
              onClick={() => setActiveCanvasTab('database')}
              className={`h-8 px-3 rounded-xl font-bold inline-flex items-center justify-center space-x-1.5 transition-all duration-200 cursor-pointer whitespace-nowrap shrink-0 ${
                activeCanvasTab === 'database'
                  ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md shadow-emerald-600/25 ring-1 ring-emerald-400/40'
                  : 'text-slate-400 hover:text-white hover:bg-white/10'
              }`}
            >
              <Database className="w-3.5 h-3.5 shrink-0" />
              <span>Database</span>
            </button>

            <button
              onClick={() => setActiveCanvasTab('env')}
              className={`h-8 px-3 rounded-xl font-bold inline-flex items-center justify-center space-x-1.5 transition-all duration-200 cursor-pointer whitespace-nowrap shrink-0 ${
                activeCanvasTab === 'env'
                  ? 'bg-gradient-to-r from-amber-600 to-orange-600 text-white shadow-md shadow-amber-600/25 ring-1 ring-amber-400/40'
                  : 'text-slate-400 hover:text-white hover:bg-white/10'
              }`}
            >
              <Key className="w-3.5 h-3.5 shrink-0" />
              <span>.env Keys</span>
            </button>

            <button
              onClick={() => setActiveCanvasTab('logs')}
              className={`h-8 px-3 rounded-xl font-bold inline-flex items-center justify-center space-x-1.5 transition-all duration-200 cursor-pointer whitespace-nowrap shrink-0 ${
                activeCanvasTab === 'logs'
                  ? 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white shadow-md shadow-indigo-600/25 ring-1 ring-indigo-400/40'
                  : 'text-slate-400 hover:text-white hover:bg-white/10'
              }`}
            >
              <Terminal className="w-3.5 h-3.5 shrink-0" />
              <span>PM2 Logs</span>
            </button>

            <button
              onClick={() => setActiveCanvasTab('git')}
              className={`h-8 px-3 rounded-xl font-bold inline-flex items-center justify-center space-x-1.5 transition-all duration-200 cursor-pointer whitespace-nowrap shrink-0 ${
                activeCanvasTab === 'git'
                  ? 'bg-gradient-to-r from-rose-600 to-pink-600 text-white shadow-md shadow-rose-600/25 ring-1 ring-rose-400/40'
                  : 'text-slate-400 hover:text-white hover:bg-white/10'
              }`}
            >
              <FolderGit2 className="w-3.5 h-3.5 shrink-0" />
              <span>Git Sync</span>
            </button>
          </div>

          {/* Device Frame Toggle (Active when preview is selected) */}
          {activeCanvasTab === 'preview' && (
            <div className="bg-slate-950/90 p-1 rounded-2xl border border-white/10 inline-flex items-center space-x-1 backdrop-blur-xl shrink-0">
              <button
                onClick={() => setDeviceMode('desktop')}
                title="Desktop View (100%)"
                className={`h-8 w-8 rounded-xl inline-flex items-center justify-center transition-all cursor-pointer shrink-0 ${
                  deviceMode === 'desktop' ? 'bg-white/20 text-cyan-300 shadow-sm' : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Monitor className="w-4 h-4 shrink-0" />
              </button>

              <button
                onClick={() => setDeviceMode('mobile')}
                title="Mobile View (375px)"
                className={`h-8 w-8 rounded-xl inline-flex items-center justify-center transition-all cursor-pointer shrink-0 ${
                  deviceMode === 'mobile' ? 'bg-white/20 text-cyan-300 shadow-sm' : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Smartphone className="w-4 h-4 shrink-0" />
              </button>
            </div>
          )}
        </div>

        {/* Right: Refresh, Settings (Icon Only), Open Site, Publish & Delete Action Buttons */}
        <div className="flex items-center space-x-1.5 shrink-0 justify-end ml-auto">
          <button
            onClick={() => setIframeKey((k) => k + 1)}
            title="Refresh Live Preview"
            className="h-8.5 w-8.5 bg-slate-900/90 hover:bg-slate-800 text-slate-300 rounded-xl border border-white/10 hover:border-white/20 inline-flex items-center justify-center transition cursor-pointer shadow-md shrink-0"
          >
            <RefreshCw className="w-4 h-4 shrink-0" />
          </button>

          {/* Project Settings Button - Uses Icon Only to preserve horizontal viewport width */}
          <button
            onClick={() => setShowSettingsModal(true)}
            title="Project settings"
            className="h-8.5 w-8.5 bg-slate-900/90 hover:bg-slate-800 text-cyan-300 border border-white/10 hover:border-cyan-500/40 rounded-xl font-mono text-xs font-bold inline-flex items-center justify-center transition cursor-pointer shadow-md shrink-0"
          >
            <Settings className="w-4 h-4 text-cyan-400 shrink-0" />
          </button>

          <a
            href={getDirectPreviewUrl()}
            target="_blank"
            rel="noreferrer"
            className="h-8.5 px-2.5 bg-slate-900/90 hover:bg-slate-800 text-cyan-300 border border-white/10 hover:border-cyan-500/40 rounded-xl text-xs font-bold font-mono inline-flex items-center justify-center space-x-1.5 transition shadow-md whitespace-nowrap shrink-0"
            title="Open Live Website ↗"
          >
            <ExternalLink className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span className="hidden xl:inline">Open Site</span>
          </a>

          <button
            onClick={handlePublishServerUpdate}
            disabled={publishing}
            className="h-8.5 px-3 bg-gradient-to-r from-cyan-500 via-indigo-600 to-purple-600 hover:from-cyan-400 hover:to-purple-500 text-white font-extrabold rounded-xl text-xs font-mono shadow-lg shadow-cyan-500/20 inline-flex items-center justify-center space-x-1.5 transition transform hover:scale-[1.02] cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Upload className={`w-3.5 h-3.5 shrink-0 ${publishing ? 'animate-spin' : ''}`} />
            <span>{publishing ? 'Publishing...' : 'Publish'}</span>
          </button>

          <button
            onClick={() => setShowDeleteModal(true)}
            title="Delete Project & Clear All Files, Database, PM2 and Email"
            className="h-8.5 w-8.5 bg-rose-950/80 hover:bg-rose-900/90 text-rose-300 border border-rose-800/80 rounded-xl inline-flex items-center justify-center transition cursor-pointer shrink-0"
          >
            <Trash2 className="w-4 h-4 text-rose-400 shrink-0" />
          </button>
        </div>
      </header>

      {/* Main Studio Body (Split into Left AI Chat & Center Canvas) */}
      <div className="flex-1 flex overflow-hidden relative">
        
        {/* Left AI Agent Chat Panel */}
        <aside
          className={`${
            sidebarHidden ? 'w-0 border-r-0' : 'w-80 md:w-96 border-r border-white/10'
          } bg-[#07090E] transition-all duration-300 flex flex-col z-20 shrink-0 relative`}
        >
          {/* AI Sidebar Header */}
          <div className="p-3.5 border-b border-slate-800 bg-slate-950 flex items-center justify-between font-mono text-xs">
            <div className="flex items-center space-x-2">
              <div className="p-1.5 rounded-lg bg-gradient-to-tr from-cyan-500 to-purple-600 text-slate-950 font-bold">
                <Bot className="w-4 h-4" />
              </div>
              <span className="font-extrabold text-white">AI Project Agent</span>
            </div>

<span className="text-[10px] text-slate-500 font-bold">Claude · ChatGPT · Gemini</span>

            <button
              onClick={() => setSidebarHidden(true)}
              title="Hide AI Chat Panel"
              className="p-1 text-slate-400 hover:text-white rounded"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Error Banner */}
          {errorMsg && (
            <div className="p-3 bg-rose-950/80 border-b border-rose-500/40 text-rose-300 font-mono text-[11px] flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">{safeText(errorMsg)}</div>
            </div>
          )}

          {/* Success Banner */}
          {publishSuccessMsg && (
            <div className="p-3 bg-emerald-950/80 border-b border-emerald-500/40 text-emerald-300 font-mono text-[11px] flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">{safeText(publishSuccessMsg)}</div>
            </div>
          )}

          <ProjectAgentPanel
            projectPath={project?.path}
            projectName={project?.name}
            jwtToken={jwtToken}
            activeServer={activeServer}
            onFilesChanged={() => setIframeKey((k) => k + 1)}
          />
        </aside>

        {/* Restore Sidebar Toggle Button (if hidden) */}
        {sidebarHidden && (
          <button
            onClick={() => setSidebarHidden(false)}
            className="absolute left-2 top-2 z-30 p-2 bg-slate-900 border border-slate-800 text-cyan-400 rounded-xl shadow-lg hover:bg-slate-800 transition cursor-pointer flex items-center gap-1 font-mono text-xs"
          >
            <Bot className="w-4 h-4" />
            <span>Open AI Agent</span>
          </button>
        )}

        {/* Center Main Workspace Canvas Area */}
        <main className="flex-1 bg-[#05070B] flex flex-col relative overflow-hidden">
          
          {/* Mode 1: Live Interactive Preview */}
          {activeCanvasTab === 'preview' && (
            <div className="flex-1 flex items-center justify-center p-4 overflow-auto bg-slate-950/60">
              <div
                className={`transition-all duration-300 bg-slate-900 rounded-2xl border border-slate-800 shadow-2xl overflow-hidden flex flex-col ${
                  deviceMode === 'mobile' ? 'w-[375px] h-[667px]' : 'w-full h-full'
                }`}
              >
                {/* Frame Header Address Bar */}
                <div className="h-8 bg-slate-950 border-b border-slate-800 px-3 flex items-center justify-between font-mono text-[11px] text-slate-400 shrink-0">
                  <div className="flex items-center space-x-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80"></span>
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80"></span>
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80"></span>
                  </div>

                  <div className="flex items-center space-x-2">
                    <div className="bg-slate-900 px-3 py-0.5 rounded-full border border-slate-800 text-cyan-400 font-bold flex items-center gap-1 text-[10px] truncate max-w-xs">
                      <Globe className="w-3 h-3 text-cyan-400 shrink-0" />
                      <span className="truncate">{getDirectPreviewUrl()}</span>
                    </div>

                    <button
                      onClick={() => setUseProxy(!useProxy)}
                      className={`px-2 py-0.5 rounded text-[9px] font-bold border transition ${
                        useProxy ? 'bg-cyan-950 text-cyan-300 border-cyan-800' : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}
                      title="Toggle Proxy Mode (Bypasses HTTPS Mixed-Content Iframe Block)"
                    >
                      {useProxy ? 'Proxy Stream' : 'Direct URL'}
                    </button>
                  </div>

                  <div className="flex items-center space-x-2">
                    <a
                      href={getDirectPreviewUrl()}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] text-slate-400 hover:text-cyan-300 flex items-center gap-0.5"
                    >
                      <span>Open ↗</span>
                    </a>
                    <span className="text-[10px] uppercase font-bold text-slate-500">{deviceMode}</span>
                  </div>
                </div>

                {/* Interactive Preview Frame */}
                <iframe
                  key={`${iframeKey}-${useProxy ? 'proxy' : 'direct'}`}
                  src={getIframeSrc()}
                  title="Project Live Preview"
                  className="flex-1 w-full h-full border-0 bg-white"
                />
              </div>
            </div>
          )}

          {/* Mode 2: Code Studio IDE Editor */}
          {activeCanvasTab === 'code' && (
            <div className="flex-1 h-full overflow-hidden">
              <CodeStudio
                jwtToken={jwtToken}
                activeServer={activeServer}
                initialProject={project?.repoName || project?.name || project?.path}
              />
            </div>
          )}

          {/* Mode 3: Database Manager (Scoped to Project) */}
          {activeCanvasTab === 'database' && (
            <div className="flex-1 h-full overflow-auto p-4">
              <DatabaseManager
                jwtToken={jwtToken}
                activeServer={activeServer}
                project={project}
              />
            </div>
          )}

          {/* Mode 4: Environment Manager (Scoped to Project) */}
          {activeCanvasTab === 'env' && (
            <div className="flex-1 h-full overflow-auto p-4">
              <EnvManager
                jwtToken={jwtToken}
                activeServer={activeServer}
                project={project}
                initialProject={project?.repoName || project?.name || project?.path}
              />
            </div>
          )}

          {/* Mode 5: PM2 Logs & Telemetry (Scoped to Project) */}
          {activeCanvasTab === 'logs' && (
            <div className="flex-1 h-full overflow-auto p-4">
              <LogsTelemetryManager
                jwtToken={jwtToken}
                activeServer={activeServer}
                project={project}
                initialApp={project?.repoName || project?.name}
              />
            </div>
          )}

          {/* Mode 6: Git Pull & Push Sync Center */}
          {activeCanvasTab === 'git' && (
            <div className="flex-1 h-full overflow-auto p-4">
              <GitSyncWorkspace
                project={project}
                jwtToken={jwtToken}
                activeServer={activeServer}
              />
            </div>
          )}

        </main>
      </div>

      <DeleteProjectModal
        isOpen={showDeleteModal}
        project={project}
        activeServer={activeServer}
        jwtToken={jwtToken}
        onClose={() => setShowDeleteModal(false)}
        onSuccess={() => onBackToDashboard && onBackToDashboard()}
      />

      <ProjectSettingsModal
        isOpen={showSettingsModal}
        project={project}
        onClose={() => setShowSettingsModal(false)}
        onSaveProjectSettings={(updatedSettings) => {
          console.log('Project Settings Saved:', updatedSettings)
        }}
      />
    </div>
  )
}
