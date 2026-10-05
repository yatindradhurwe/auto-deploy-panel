import React, { useState, useEffect, useRef } from 'react'
import {
  ArrowLeft, ExternalLink, RefreshCw, Send, Sparkles, Bot, Code, Globe,
  Smartphone, Monitor, Play, CheckCircle2, ShieldAlert, Cpu, Database, Key,
  Activity, Layers, FileCode, Plus, Check, CheckCheck, Upload, GitCommit,
  Terminal, ChevronRight, X, AlertCircle, Eye, Sliders, Shield, Zap, FolderGit2
} from 'lucide-react'
import CodeStudio from './CodeStudio'
import DatabaseManager from './DatabaseManager'
import EnvManager from './EnvManager'
import LogsTelemetryManager from './LogsTelemetryManager'
import GitSyncWorkspace from './GitSyncWorkspace'

export default function ProjectDedicatedStudio({ project, jwtToken, activeServer, onBackToDashboard }) {
  const [activeCanvasTab, setActiveCanvasTab] = useState('preview') // 'preview' | 'code' | 'database' | 'env' | 'logs'
  const [deviceMode, setDeviceMode] = useState('desktop') // 'desktop' | 'mobile'

  // AI Agent Left Panel State
  const [provider, setProvider] = useState('claude') // 'claude' | 'gemini' | 'openai' | 'grok'
  const [apiKey, setApiKey] = useState('')
  const [userPrompt, setUserPrompt] = useState('')
  const [sidebarHidden, setSidebarHidden] = useState(false)

  const [loadingAi, setLoadingAi] = useState(false)
  const [chatMessages, setChatMessages] = useState([])
  const [currentPlan, setCurrentPlan] = useState(null)
  const [executingPlan, setExecutingPlan] = useState(false)
  const [executionResult, setExecutionResult] = useState(null)
  const [errorMsg, setErrorMsg] = useState(null)

  // Server Update / Deployment Status
  const [publishing, setPublishing] = useState(false)
  const [publishSuccessMsg, setPublishSuccessMsg] = useState(null)
  const [iframeKey, setIframeKey] = useState(1)

  const getEffectiveToken = () => {
    return jwtToken || localStorage.getItem('autodeploy_token') || localStorage.getItem('autodeploy_jwt_token') || ''
  }

  const [useProxy, setUseProxy] = useState(true)

  // Determine Live Web URL for Preview
  const getDirectPreviewUrl = () => {
    if (!project) return 'http://187.127.165.128:5050'
    if (project.domain) return project.domain.startsWith('http') ? project.domain : `https://${project.domain}`
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

  // Load API Key from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(`autodeploy_key_${provider}`) || localStorage.getItem('autodeploy_gemini_key')
    setApiKey(saved || '')
  }, [provider])

  // Initial welcome AI message for project
  useEffect(() => {
    if (project) {
      setChatMessages([
        {
          id: 'msg-welcome',
          role: 'assistant',
          content: `👋 Welcome to **${project.name}** Dedicated Project Studio!\n\nI am your AI Project Agent. I have scanned your complete project repository, environment configuration, database, and live PM2 processes.\n\nAsk me to add features, update UI designs, write APIs, run database queries, or deploy updates to your live server.`
        }
      ])
    }
  }, [project])

  const handleKeyChange = (val) => {
    setApiKey(val)
    localStorage.setItem(`autodeploy_key_${provider}`, val)
  }

  // Send Natural Command to AI Agent
  const handleSendAiPrompt = async (customPrompt = '') => {
    const promptToUse = (customPrompt || userPrompt || '').trim()
    if (!promptToUse) return

    const token = getEffectiveToken()
    const userMsgId = `usr-${Date.now()}`

    setChatMessages((prev) => [
      ...prev,
      { id: userMsgId, role: 'user', content: promptToUse }
    ])
    setUserPrompt('')
    setLoadingAi(true)
    setErrorMsg(null)
    setCurrentPlan(null)

    try {
      const res = await fetch('/api/studio/ai/agent/plan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({
          userPrompt: promptToUse,
          projectPath: project.path,
          provider,
          apiKey
        })
      })
      const data = await res.json()
      if (data.success && data.plan) {
        setCurrentPlan(data.plan)
        setChatMessages((prev) => [
          ...prev,
          {
            id: `asst-${Date.now()}`,
            role: 'assistant',
            plan: data.plan,
            content: `I've formulated an action plan to implement your request: **"${promptToUse}"**.\n\nSummary: ${data.plan.summary}`
          }
        ])
      } else {
        setErrorMsg(`AI Agent Plan Error: ${data.error || 'Failed to generate plan'}`)
      }
    } catch (err) {
      setErrorMsg(`Request error: ${err.message}`)
    } finally {
      setLoadingAi(false)
    }
  }

  // Execute Approved AI Plan
  const handleExecutePlan = async (planToExec) => {
    const planTarget = planToExec || currentPlan
    if (!planTarget) return

    const token = getEffectiveToken()
    setExecutingPlan(true)
    setErrorMsg(null)

    try {
      const res = await fetch('/api/studio/ai/agent/execute-plan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({
          planId: planTarget.planId,
          planData: planTarget,
          autoCommit: true,
          autoDeploy: true
        })
      })
      const data = await res.json()
      if (data.success) {
        setExecutionResult(data)
        setChatMessages((prev) => [
          ...prev,
          {
            id: `exec-${Date.now()}`,
            role: 'system',
            content: `✅ **Plan Executed Successfully!**\n- Modified files: ${data.modifiedFiles?.join(', ') || 'None'}\n- Build Status: **${data.verificationStatus}**\n- Server Reload: **PM2 Active**`
          }
        ])
        setCurrentPlan(null)
        setIframeKey((k) => k + 1) // Refresh live preview
      } else {
        setErrorMsg(`Execution error: ${data.error}`)
      }
    } catch (err) {
      setErrorMsg(`Execution failed: ${err.message}`)
    } finally {
      setExecutingPlan(false)
    }
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
      
      {/* Top Header Navigation Bar */}
      <header className="h-14 bg-[#0B0E17] border-b border-white/10 px-4 flex items-center justify-between z-30 shrink-0">
        
        {/* Left: Back to Home & Project Breadcrumb */}
        <div className="flex items-center space-x-3">
          <button
            onClick={onBackToDashboard}
            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700/80 rounded-xl text-xs font-bold font-mono flex items-center space-x-1.5 transition cursor-pointer shadow-md"
          >
            <ArrowLeft className="w-3.5 h-3.5 text-cyan-400" />
            <span>Back to Dashboard</span>
          </button>

          <div className="h-5 w-px bg-slate-800"></div>

          <div className="flex items-center space-x-2 font-mono text-xs">
            <span className="text-slate-400">Projects</span>
            <span className="text-slate-600">/</span>
            <span className="font-extrabold text-white flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              {project?.name || 'Selected Project'}
            </span>
            <span className="text-[10px] bg-cyan-950 text-cyan-300 border border-cyan-800 px-2 py-0.5 rounded-full font-bold uppercase">
              {project?.type || 'Web Application'}
            </span>
          </div>
        </div>

        {/* Center: Canvas View Selector & Device Frame Controls */}
        <div className="flex items-center space-x-2">
          {/* Main View Mode Selector */}
          <div className="bg-slate-950 p-1 rounded-xl border border-slate-800 flex items-center space-x-1 font-mono text-xs">
            <button
              onClick={() => setActiveCanvasTab('preview')}
              className={`px-3 py-1 rounded-lg font-bold flex items-center space-x-1.5 transition cursor-pointer ${
                activeCanvasTab === 'preview'
                  ? 'bg-cyan-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>Live Preview</span>
            </button>

            <button
              onClick={() => setActiveCanvasTab('code')}
              className={`px-3 py-1 rounded-lg font-bold flex items-center space-x-1.5 transition cursor-pointer ${
                activeCanvasTab === 'code'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Code className="w-3.5 h-3.5" />
              <span>Code Studio</span>
            </button>

            <button
              onClick={() => setActiveCanvasTab('database')}
              className={`px-3 py-1 rounded-lg font-bold flex items-center space-x-1.5 transition cursor-pointer ${
                activeCanvasTab === 'database'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Database className="w-3.5 h-3.5" />
              <span>Database</span>
            </button>

            <button
              onClick={() => setActiveCanvasTab('env')}
              className={`px-3 py-1 rounded-lg font-bold flex items-center space-x-1.5 transition cursor-pointer ${
                activeCanvasTab === 'env'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Key className="w-3.5 h-3.5" />
              <span>.env Keys</span>
            </button>

            <button
              onClick={() => setActiveCanvasTab('logs')}
              className={`px-3 py-1 rounded-lg font-bold flex items-center space-x-1.5 transition cursor-pointer ${
                activeCanvasTab === 'logs'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>PM2 Logs</span>
            </button>

            <button
              onClick={() => setActiveCanvasTab('git')}
              className={`px-3 py-1 rounded-lg font-bold flex items-center space-x-1.5 transition cursor-pointer ${
                activeCanvasTab === 'git'
                  ? 'bg-rose-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <FolderGit2 className="w-3.5 h-3.5" />
              <span>Git Sync & Push</span>
            </button>
          </div>

          {/* Device Frame Toggle (Active when preview is selected) */}
          {activeCanvasTab === 'preview' && (
            <div className="bg-slate-950 p-1 rounded-xl border border-slate-800 flex items-center space-x-1">
              <button
                onClick={() => setDeviceMode('desktop')}
                title="Desktop View (100%)"
                className={`p-1.5 rounded-lg transition cursor-pointer ${
                  deviceMode === 'desktop' ? 'bg-slate-800 text-cyan-400' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Monitor className="w-4 h-4" />
              </button>

              <button
                onClick={() => setDeviceMode('mobile')}
                title="Mobile View (375px)"
                className={`p-1.5 rounded-lg transition cursor-pointer ${
                  deviceMode === 'mobile' ? 'bg-slate-800 text-cyan-400' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Smartphone className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Right: Publish & Open Site Controls */}
        <div className="flex items-center space-x-2.5">
          <button
            onClick={() => setIframeKey((k) => k + 1)}
            title="Refresh Live Preview"
            className="p-2 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-xl border border-slate-800 transition cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
          </button>

          <a
            href={getDirectPreviewUrl()}
            target="_blank"
            rel="noreferrer"
            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 rounded-xl text-xs font-bold font-mono flex items-center space-x-1.5 transition"
          >
            <ExternalLink className="w-3.5 h-3.5 text-cyan-400" />
            <span>Open Site</span>
          </a>

          <button
            onClick={handlePublishServerUpdate}
            disabled={publishing}
            className="px-4 py-1.5 bg-gradient-to-r from-cyan-500 via-indigo-600 to-purple-600 hover:from-cyan-400 hover:to-purple-500 text-white font-extrabold rounded-xl text-xs font-mono shadow-lg flex items-center space-x-1.5 transition cursor-pointer disabled:opacity-50"
          >
            <Upload className={`w-3.5 h-3.5 ${publishing ? 'animate-spin' : ''}`} />
            <span>{publishing ? 'Publishing...' : 'Publish & Server Update'}</span>
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

            {/* AI Model Selector */}
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="bg-slate-900 border border-slate-800 text-cyan-300 rounded-lg px-2 py-1 text-[11px] font-bold focus:outline-none"
            >
              <option value="claude">Claude 3.5 Sonnet</option>
              <option value="gemini">Gemini 2.0 Flash</option>
              <option value="openai">OpenAI (gpt-4o)</option>
              <option value="grok">xAI Grok</option>
            </select>

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

          {/* Chat Messages Stream */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 font-mono text-xs">
            {chatMessages.map((msg) => (
              <div
                key={msg.id}
                className={`space-y-2 ${
                  msg.role === 'user' ? 'text-right' : 'text-left'
                }`}
              >
                <div
                  className={`inline-block p-3 rounded-2xl max-w-[90%] text-left whitespace-pre-wrap leading-relaxed shadow-md ${
                    msg.role === 'user'
                      ? 'bg-gradient-to-r from-cyan-600 to-indigo-600 text-white rounded-tr-none'
                      : msg.role === 'system'
                      ? 'bg-emerald-950/90 text-emerald-300 border border-emerald-800'
                      : 'bg-slate-900 text-slate-200 border border-slate-800 rounded-tl-none'
                  }`}
                >
                  {safeText(msg.content)}
                </div>

                {/* Proposed Execution Plan Card */}
                {msg.plan && (
                  <div className="p-3 bg-slate-950 border-2 border-cyan-500/60 rounded-xl space-y-2.5 text-left font-mono shadow-xl">
                    <div className="font-bold text-cyan-300 text-[11px] flex items-center justify-between border-b border-slate-800 pb-1.5">
                      <span>Proposed Execution Plan</span>
                      <span className="text-[9px] bg-cyan-950 text-cyan-400 border border-cyan-800 px-1.5 py-0.5 rounded uppercase font-bold">
                        {msg.plan.proposedChanges?.length || 0} Files
                      </span>
                    </div>

                    <div className="space-y-1 text-[11px] text-slate-300">
                      {msg.plan.planSteps?.map((st, idx) => (
                        <div key={idx} className="flex items-center gap-1.5">
                          <span className="text-cyan-400 font-bold">{idx + 1}.</span>
                          <span>{safeText(st.description)}</span>
                        </div>
                      ))}
                    </div>

                    <div className="pt-2 flex gap-2">
                      <button
                        onClick={() => handleExecutePlan(msg.plan)}
                        disabled={executingPlan}
                        className="flex-1 py-1.5 bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 font-extrabold rounded-lg flex items-center justify-center gap-1 cursor-pointer text-[11px]"
                      >
                        {executingPlan ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                        <span>Approve & Apply Plan</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {loadingAi && (
              <div className="flex items-center space-x-2 text-cyan-400 font-mono text-xs p-3 bg-slate-950 border border-slate-800 rounded-xl">
                <RefreshCw className="w-4 h-4 animate-spin text-cyan-400" />
                <span>AI Project Agent formulation in progress...</span>
              </div>
            )}
          </div>

          {/* Bottom Natural Language Prompt Input Box */}
          <div className="p-3 border-t border-slate-800 bg-slate-950 space-y-2">
            <div className="relative">
              <textarea
                value={userPrompt}
                onChange={(e) => setUserPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSendAiPrompt()
                  }
                }}
                rows={3}
                placeholder="Describe your site, ask to add features, write APIs, or change code... (Press Enter to send)"
                className="w-full p-3 pr-10 bg-slate-900 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-500 text-xs font-mono focus:border-cyan-500 focus:outline-none resize-none"
              ></textarea>

              <button
                onClick={() => handleSendAiPrompt()}
                disabled={loadingAi || !userPrompt.trim()}
                className="absolute right-2.5 bottom-3.5 p-2 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-slate-950 rounded-lg transition cursor-pointer"
              >
                <Send className="w-4 h-4 font-bold" />
              </button>
            </div>

            <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono">
              <span>Model: {provider.toUpperCase()}</span>
              <span>Project: {project?.name}</span>
            </div>
          </div>
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

    </div>
  )
}
