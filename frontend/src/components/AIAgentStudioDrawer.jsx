import React, { useState, useEffect } from 'react'
import {
  Sparkles, X, Bot, Play, CheckCircle2, AlertCircle, Key, RefreshCw, Send,
  ShieldAlert, Cpu, GitCommit, Upload, Code, Check, Terminal, FileCode,
  CheckCheck, Layers, Database, Shield, Zap, Search, Activity, History, Trash2, ChevronRight, FileText
} from 'lucide-react'

export default function AIAgentStudioDrawer({
  isOpen,
  onClose,
  activeFile,
  fileContent,
  projectPath,
  jwtToken,
  onApplyCodeFix,
  onSelectProject
}) {
  const [provider, setProvider] = useState('gemini') // 'gemini' | 'openai' | 'claude' | 'grok'
  const [apiKey, setApiKey] = useState('')
  const [userPrompt, setUserPrompt] = useState('')
  const [autoCommit, setAutoCommit] = useState(true)
  const [autoDeploy, setAutoDeploy] = useState(true)

  const [activeTab, setActiveTab] = useState('agent') // 'agent' | 'analysis' | 'history'
  const [projectsList, setProjectsList] = useState([])
  const [selectedProjectPath, setSelectedProjectPath] = useState(projectPath || '')
  const [projectContext, setProjectContext] = useState(null)

  const [analyzingContext, setAnalyzingContext] = useState(false)
  const [loadingPlan, setLoadingPlan] = useState(false)
  const [executingPlan, setExecutingPlan] = useState(false)

  const [currentPlan, setCurrentPlan] = useState(null)
  const [executionResult, setExecutionResult] = useState(null)
  const [activeStepStage, setActiveStepStage] = useState('')
  const [historyLogs, setHistoryLogs] = useState([])
  const [appliedFix, setAppliedFix] = useState(false)

  // Sync selected project path when prop changes
  useEffect(() => {
    if (projectPath && projectPath !== selectedProjectPath) {
      setSelectedProjectPath(projectPath)
    }
  }, [projectPath])

  // Load API keys from localStorage
  useEffect(() => {
    const savedKey = localStorage.getItem(`autodeploy_key_${provider}`)
    setApiKey(savedKey || '')
  }, [provider])

  // Load available projects and analyze context when drawer opens
  useEffect(() => {
    if (isOpen) {
      fetchProjects()
      if (selectedProjectPath || projectPath) {
        handleAnalyzeProject(selectedProjectPath || projectPath)
        fetchHistory(selectedProjectPath || projectPath)
      }
    }
  }, [isOpen, selectedProjectPath])

  const handleKeyChange = (val) => {
    setApiKey(val)
    localStorage.setItem(`autodeploy_key_${provider}`, val)
  }

  const fetchProjects = async () => {
    try {
      const res = await fetch('/api/studio/projects', {
        headers: { Authorization: `Bearer ${jwtToken}` }
      })
      const data = await res.json()
      if (data.projects) {
        setProjectsList(data.projects)
        if (!selectedProjectPath && data.projects.length > 0) {
          setSelectedProjectPath(data.projects[0].path)
        }
      }
    } catch (e) {}
  }

  const handleAnalyzeProject = async (pPath) => {
    const pathTarget = pPath || selectedProjectPath || projectPath
    if (!pathTarget) return
    setAnalyzingContext(true)
    try {
      const res = await fetch('/api/studio/ai/agent/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify({ projectPath: pathTarget })
      })
      const data = await res.json()
      if (data.success && data.context) {
        setProjectContext(data.context)
      }
    } catch (e) {
    } finally {
      setAnalyzingContext(false)
    }
  }

  const fetchHistory = async (pPath) => {
    const pathTarget = pPath || selectedProjectPath || projectPath
    if (!pathTarget) return
    try {
      const res = await fetch(`/api/studio/ai/agent/history?projectPath=${encodeURIComponent(pathTarget)}`, {
        headers: { Authorization: `Bearer ${jwtToken}` }
      })
      const data = await res.json()
      if (data.success && data.history) {
        setHistoryLogs(data.history)
      }
    } catch (e) {}
  }

  // Generate Plan & Unified Diff Preview
  const handleGeneratePlan = async (customPrompt = '') => {
    const promptToUse = customPrompt || userPrompt
    if (!promptToUse.trim()) {
      alert('Please enter a natural-language command for the AI Project Agent.')
      return
    }

    setLoadingPlan(true)
    setCurrentPlan(null)
    setExecutionResult(null)
    setAppliedFix(false)
    setActiveStepStage('Planning')

    try {
      const res = await fetch('/api/studio/ai/agent/plan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify({
          userPrompt: promptToUse,
          projectPath: selectedProjectPath || projectPath,
          provider,
          apiKey
        })
      })
      const data = await res.json()
      if (data.success && data.plan) {
        setCurrentPlan(data.plan)
      } else {
        alert(`Plan generation failed: ${data.error || 'Unknown error'}`)
      }
    } catch (err) {
      alert(`Agent Request Failed: ${err.message}`)
    } finally {
      setLoadingPlan(false)
    }
  }

  // Execute Approved Plan
  const handleExecutePlan = async () => {
    if (!currentPlan) return
    setExecutingPlan(true)
    setActiveStepStage('Editing')

    try {
      const res = await fetch('/api/studio/ai/agent/execute-plan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify({
          planId: currentPlan.planId,
          planData: currentPlan,
          autoCommit,
          autoDeploy
        })
      })
      const data = await res.json()
      if (data.success) {
        setExecutionResult(data)
        setActiveStepStage('Deploy')
        fetchHistory(selectedProjectPath || projectPath)
      } else {
        alert(`Execution failed: ${data.error}`)
      }
    } catch (err) {
      alert(`Execution Request Failed: ${err.message}`)
    } finally {
      setExecutingPlan(false)
    }
  }

  const handleClearHistory = async () => {
    try {
      await fetch('/api/studio/ai/agent/clear-history', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify({ projectPath: selectedProjectPath || projectPath })
      })
      setHistoryLogs([])
    } catch (e) {}
  }

  if (!isOpen) return null

  // Stepper Stage List
  const stepperStages = [
    { key: 'Analyzing', label: 'Analyzing', icon: Search },
    { key: 'Planning', label: 'Planning', icon: Cpu },
    { key: 'Editing', label: 'Editing', icon: Code },
    { key: 'Testing', label: 'Testing', icon: ShieldAlert },
    { key: 'Build', label: 'Build', icon: Zap },
    { key: 'Deploy', label: 'Deploy', icon: Upload }
  ]

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-slate-950/80 backdrop-blur-xl flex justify-end font-sans">
      <div className="w-full max-w-2xl bg-[#07090E] border-l border-white/10 h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-300">
        
        {/* Header - AI Project Agent */}
        <div className="p-4 border-b border-white/10 flex items-center justify-between bg-slate-950/90 backdrop-blur-xl">
          <div className="flex items-center space-x-3.5">
            <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-cyan-500 via-indigo-600 to-purple-500 text-white font-bold shadow-lg shadow-cyan-950/50 ring-1 ring-white/20">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-extrabold text-white text-sm tracking-tight">AI Project Agent</h3>
                <span className="text-[9px] px-2 py-0.5 rounded-full bg-cyan-950 border border-cyan-800 text-cyan-300 font-mono font-bold uppercase">
                  FULL DEV ENGINE
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono">Autonomous Code Engineer, Verification Testing, Git & PM2 Pipeline</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800/80 transition cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Project Selector & Scope Navigation Bar */}
        <div className="px-4 py-2.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center space-x-2 flex-1 min-w-0">
            <Layers className="w-4 h-4 text-cyan-400 shrink-0" />
            <span className="text-slate-400 font-mono text-[11px] shrink-0">Selected Project:</span>
            <select
              value={selectedProjectPath}
              onChange={(e) => {
                setSelectedProjectPath(e.target.value)
                if (onSelectProject) {
                  const found = projectsList.find(p => p.path === e.target.value)
                  if (found) onSelectProject(found)
                }
              }}
              className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-cyan-300 font-mono text-xs focus:outline-none focus:border-cyan-500 truncate flex-1"
            >
              {projectsList.map((p) => (
                <option key={p.id || p.path} value={p.path}>
                  {p.name} ({p.path})
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => handleAnalyzeProject()}
            disabled={analyzingContext}
            className="px-2.5 py-1 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 rounded-lg font-mono text-[11px] flex items-center space-x-1 shrink-0 transition cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${analyzingContext ? 'animate-spin' : ''}`} />
            <span>Rescan</span>
          </button>
        </div>

        {/* Drawer Tabs */}
        <div className="flex border-b border-slate-800 bg-slate-950/60 font-mono text-xs">
          <button
            onClick={() => setActiveTab('agent')}
            className={`flex-1 py-2.5 text-center font-semibold border-b-2 transition cursor-pointer ${
              activeTab === 'agent'
                ? 'border-cyan-500 text-cyan-400 bg-cyan-950/20'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            🤖 AI Command Studio
          </button>
          <button
            onClick={() => setActiveTab('analysis')}
            className={`flex-1 py-2.5 text-center font-semibold border-b-2 transition cursor-pointer ${
              activeTab === 'analysis'
                ? 'border-purple-500 text-purple-400 bg-purple-950/20'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            🔍 Project Context
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex-1 py-2.5 text-center font-semibold border-b-2 transition cursor-pointer ${
              activeTab === 'history'
                ? 'border-amber-500 text-amber-400 bg-amber-950/20'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            📜 Agent Logs ({historyLogs.length})
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
          
          {activeTab === 'agent' && (
            <>
              {/* Provider Selection Bar */}
              <div>
                <label className="block text-[10px] font-mono text-slate-400 uppercase tracking-widest font-bold mb-2">
                  Select AI Provider Engine:
                </label>
                <div className="grid grid-cols-4 gap-2 font-mono text-[11px]">
                  <button
                    onClick={() => setProvider('openai')}
                    className={`p-2.5 rounded-xl border flex flex-col items-center gap-1 transition cursor-pointer ${
                      provider === 'openai' || provider === 'chatgpt'
                        ? 'bg-emerald-950/90 border-emerald-500 text-emerald-300 font-bold shadow-md shadow-emerald-950'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <span className="text-base">🤖</span>
                    <span>OpenAI (gpt-4o)</span>
                  </button>

                  <button
                    onClick={() => setProvider('gemini')}
                    className={`p-2.5 rounded-xl border flex flex-col items-center gap-1 transition cursor-pointer ${
                      provider === 'gemini'
                        ? 'bg-cyan-950/90 border-cyan-500 text-cyan-300 font-bold shadow-md shadow-cyan-950'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <span className="text-base">♊</span>
                    <span>Gemini 2.0</span>
                  </button>

                  <button
                    onClick={() => setProvider('claude')}
                    className={`p-2.5 rounded-xl border flex flex-col items-center gap-1 transition cursor-pointer ${
                      provider === 'claude'
                        ? 'bg-purple-950/90 border-purple-500 text-purple-300 font-bold shadow-md shadow-purple-950'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <span className="text-base">🧠</span>
                    <span>Claude 3.5</span>
                  </button>

                  <button
                    onClick={() => setProvider('grok')}
                    className={`p-2.5 rounded-xl border flex flex-col items-center gap-1 transition cursor-pointer ${
                      provider === 'grok'
                        ? 'bg-amber-950/90 border-amber-500 text-amber-300 font-bold shadow-md shadow-amber-950'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <span className="text-base">🚀</span>
                    <span>xAI Grok</span>
                  </button>
                </div>
              </div>

              {/* API Key Box */}
              <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl space-y-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-300 font-semibold uppercase font-mono flex items-center gap-1.5">
                    <Key className="w-3.5 h-3.5 text-cyan-400" />
                    {provider.toUpperCase()} API Key Config
                  </span>
                  <span className="text-slate-500 text-[10px]">Built-in AI Fallback Active</span>
                </div>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => handleKeyChange(e.target.value)}
                  placeholder={`Paste optional ${provider.toUpperCase()} API Key (or leave empty for built-in AI)`}
                  className="w-full px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-slate-100 placeholder-slate-500 font-mono text-xs focus:border-cyan-500 focus:outline-none"
                />
              </div>

              {/* Natural Language Quick Command Presets */}
              <div>
                <label className="block text-[11px] font-mono text-slate-400 uppercase tracking-wider mb-2 font-bold">
                  Quick Natural Commands:
                </label>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <button
                    onClick={() => handleGeneratePlan("Analyze my complete project structure, framework, APIs, database, and logs")}
                    className="p-2.5 bg-slate-950 hover:bg-slate-900 border border-slate-800 rounded-xl text-left text-slate-300 transition flex items-center gap-2 cursor-pointer"
                  >
                    <Search className="w-4 h-4 text-cyan-400 shrink-0" />
                    <span>Analyze my project</span>
                  </button>

                  <button
                    onClick={() => handleGeneratePlan("Add a new feature with responsive UI component and backend API endpoint")}
                    className="p-2.5 bg-slate-950 hover:bg-slate-900 border border-slate-800 rounded-xl text-left text-slate-300 transition flex items-center gap-2 cursor-pointer"
                  >
                    <Sparkles className="w-4 h-4 text-purple-400 shrink-0" />
                    <span>Add a feature</span>
                  </button>

                  <button
                    onClick={() => handleGeneratePlan("Diagnose and fix bugs, missing error catches, and runtime exceptions")}
                    className="p-2.5 bg-slate-950 hover:bg-slate-900 border border-slate-800 rounded-xl text-left text-slate-300 transition flex items-center gap-2 cursor-pointer"
                  >
                    <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
                    <span>Fix bugs / errors</span>
                  </button>

                  <button
                    onClick={() => handleGeneratePlan("Refactor code for performance, modular architecture, and security hardening")}
                    className="p-2.5 bg-slate-950 hover:bg-slate-900 border border-slate-800 rounded-xl text-left text-slate-300 transition flex items-center gap-2 cursor-pointer"
                  >
                    <Zap className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>Optimize performance</span>
                  </button>

                  <button
                    onClick={() => handleGeneratePlan("Inspect database configuration, schema structures, and verify query speed")}
                    className="p-2.5 bg-slate-950 hover:bg-slate-900 border border-slate-800 rounded-xl text-left text-slate-300 transition flex items-center gap-2 cursor-pointer"
                  >
                    <Database className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Update database</span>
                  </button>

                  <button
                    onClick={() => handleGeneratePlan("Run automated build checks and verification tests across the codebase")}
                    className="p-2.5 bg-slate-950 hover:bg-slate-900 border border-slate-800 rounded-xl text-left text-slate-300 transition flex items-center gap-2 cursor-pointer"
                  >
                    <Terminal className="w-4 h-4 text-indigo-400 shrink-0" />
                    <span>Run tests / build</span>
                  </button>
                </div>
              </div>

              {/* Pipeline Controls */}
              <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl space-y-2 text-xs font-mono">
                <div className="font-semibold text-slate-300 uppercase text-[11px]">
                  Autonomous Pipeline Options:
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoCommit}
                      onChange={(e) => setAutoCommit(e.target.checked)}
                      className="rounded border-slate-700 text-cyan-500 focus:ring-0"
                    />
                    <span className="flex items-center gap-1.5">
                      <GitCommit className="w-3.5 h-3.5 text-amber-400" />
                      Auto-Commit Git
                    </span>
                  </label>

                  <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoDeploy}
                      onChange={(e) => setAutoDeploy(e.target.checked)}
                      className="rounded border-slate-700 text-cyan-500 focus:ring-0"
                    />
                    <span className="flex items-center gap-1.5">
                      <Upload className="w-3.5 h-3.5 text-emerald-400" />
                      Auto-Reload PM2
                    </span>
                  </label>
                </div>
              </div>

              {/* Custom Command Prompt Box */}
              <div className="space-y-2">
                <label className="block text-[11px] font-mono text-slate-400 uppercase tracking-wider font-bold">
                  Custom Natural-Language Command:
                </label>
                <textarea
                  value={userPrompt}
                  onChange={(e) => setUserPrompt(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && e.ctrlKey && handleGeneratePlan()}
                  rows={3}
                  placeholder="e.g. Add JWT authentication middleware to /api routes and create login form..."
                  className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-500 text-xs font-mono focus:border-cyan-500 focus:outline-none resize-none"
                ></textarea>

                <button
                  onClick={() => handleGeneratePlan()}
                  disabled={loadingPlan || executingPlan}
                  className="w-full py-2.5 bg-gradient-to-r from-cyan-600 via-indigo-600 to-purple-600 hover:from-cyan-500 hover:to-purple-500 text-white font-extrabold rounded-xl shadow-lg flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50 text-xs uppercase font-mono tracking-wider"
                >
                  {loadingPlan ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin text-cyan-300" />
                      <span>Formulating Action Plan & Diff Preview...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      <span>Generate AI Action Plan & File Diff</span>
                    </>
                  )}
                </button>
              </div>

              {/* Real-time Stepper Activity Component */}
              {(loadingPlan || executingPlan || executionResult) && (
                <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-3 font-mono">
                  <div className="text-[11px] font-bold text-slate-300 uppercase flex items-center gap-2">
                    <Activity className="w-4 h-4 text-cyan-400" />
                    <span>Real-time Agent Stepper Pipeline Activity</span>
                  </div>

                  <div className="grid grid-cols-6 gap-1 relative py-2">
                    {stepperStages.map((st, idx) => {
                      const IconComp = st.icon
                      const isPast = ['Analyzing', 'Planning', 'Editing', 'Testing', 'Build', 'Deploy'].indexOf(st.key) <= ['Analyzing', 'Planning', 'Editing', 'Testing', 'Build', 'Deploy'].indexOf(activeStepStage)
                      const isCurrent = activeStepStage === st.key

                      return (
                        <div key={st.key} className="flex flex-col items-center text-center space-y-1">
                          <div
                            className={`w-7 h-7 rounded-full flex items-center justify-center text-xs border transition ${
                              isPast
                                ? 'bg-cyan-950 text-cyan-400 border-cyan-500 shadow-sm shadow-cyan-500/50'
                                : 'bg-slate-900 text-slate-600 border-slate-800'
                            } ${isCurrent ? 'ring-2 ring-cyan-400 animate-pulse' : ''}`}
                          >
                            <IconComp className="w-3.5 h-3.5" />
                          </div>
                          <span className={`text-[9px] font-bold ${isPast ? 'text-cyan-300' : 'text-slate-600'}`}>
                            {st.label}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Plan & Unified File Diff Preview Box with Approval Controls */}
              {currentPlan && (
                <div className="space-y-4 p-4 bg-slate-950/90 border-2 border-cyan-500/60 rounded-2xl font-mono shadow-2xl animate-in fade-in duration-200">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                    <span className="font-extrabold text-cyan-300 text-xs flex items-center gap-2">
                      <Cpu className="w-4 h-4 text-cyan-400" />
                      <span>AI Execution Plan & File Diff Preview</span>
                    </span>
                    <span className="text-[10px] bg-cyan-950 text-cyan-400 border border-cyan-800 px-2 py-0.5 rounded-full font-bold">
                      AWAITING APPROVAL
                    </span>
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed bg-slate-900/80 p-3 rounded-xl border border-slate-800">
                    {currentPlan.summary}
                  </p>

                  {/* Plan Steps */}
                  <div className="space-y-2">
                    <div className="text-[11px] font-bold text-slate-400 uppercase">Step-by-step Action Plan:</div>
                    <div className="space-y-1.5">
                      {currentPlan.planSteps?.map((st, i) => (
                        <div key={i} className="flex items-start space-x-2 text-xs bg-slate-900/40 p-2 rounded-lg border border-slate-800/60">
                          <span className="w-5 h-5 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800 text-[10px] flex items-center justify-center font-bold shrink-0">
                            {st.step || i + 1}
                          </span>
                          <div className="flex-1 min-w-0">
                            <span className="text-slate-200 font-semibold">{st.description}</span>
                            {st.file && <span className="text-[10px] text-cyan-400 ml-2">({st.file})</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Proposed File Changes Diff */}
                  <div className="space-y-2">
                    <div className="text-[11px] font-bold text-slate-400 uppercase">Proposed Unified File Diffs:</div>
                    {currentPlan.proposedChanges?.map((ch, idx) => (
                      <div key={idx} className="bg-slate-900 rounded-xl border border-slate-800 p-3 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-cyan-300 font-bold flex items-center gap-1.5">
                            <FileCode className="w-4 h-4 text-cyan-400" />
                            {ch.filePath}
                          </span>
                          <span className="text-[10px] uppercase bg-cyan-950 text-cyan-400 border border-cyan-800 px-2 py-0.5 rounded-full font-bold">
                            {ch.action}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400">{ch.explanation}</p>
                        {ch.diff && (
                          <pre className="text-[10px] bg-slate-950 p-2.5 rounded-lg text-emerald-400 overflow-x-auto whitespace-pre-wrap border border-slate-800">
                            {ch.diff}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Approve & Execute / Reject Controls */}
                  <div className="flex items-center gap-3 pt-2">
                    <button
                      onClick={handleExecutePlan}
                      disabled={executingPlan}
                      className="flex-1 py-2.5 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white font-extrabold rounded-xl shadow-lg flex items-center justify-center gap-2 transition cursor-pointer text-xs uppercase tracking-wider"
                    >
                      {executingPlan ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>Executing Plan on Disk...</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                          <span>Approve & Execute Plan</span>
                        </>
                      )}
                    </button>

                    <button
                      onClick={() => setCurrentPlan(null)}
                      disabled={executingPlan}
                      className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 rounded-xl font-bold transition cursor-pointer text-xs"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              )}

              {/* Final Execution Report Box */}
              {executionResult && (
                <div className="space-y-3 p-4 bg-slate-950 border border-slate-800 rounded-2xl font-mono text-xs shadow-inner">
                  <div className="flex items-center justify-between text-cyan-400 font-bold">
                    <span className="flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-cyan-400" />
                      Execution Report Summary
                    </span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
                      executionResult.verificationStatus?.includes('PASSED')
                        ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                        : 'bg-rose-950 text-rose-300 border-rose-800'
                    }`}>
                      {executionResult.verificationStatus}
                    </span>
                  </div>

                  {executionResult.modifiedFiles?.length > 0 && (
                    <div>
                      <span className="text-slate-400">Modified Files: </span>
                      <span className="text-cyan-300 font-bold">{executionResult.modifiedFiles.join(', ')}</span>
                    </div>
                  )}

                  {/* Apply Code to Editor Button */}
                  {onApplyCodeFix && currentPlan?.proposedChanges?.[0]?.updatedCode && (
                    <div className="bg-slate-900 p-3 rounded-xl border border-cyan-500/40 flex items-center justify-between">
                      <span className="text-slate-300">Generated code available for active file editor</span>
                      <button
                        onClick={() => {
                          onApplyCodeFix(currentPlan.proposedChanges[0].updatedCode)
                          setAppliedFix(true)
                        }}
                        className={`px-3 py-1.5 rounded-xl font-bold transition flex items-center gap-1.5 cursor-pointer ${
                          appliedFix
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                            : 'bg-cyan-500 text-slate-950 hover:bg-cyan-400'
                        }`}
                      >
                        {appliedFix ? <CheckCheck className="w-4 h-4" /> : <Code className="w-4 h-4" />}
                        <span>{appliedFix ? 'Applied to Editor!' : 'Apply to Editor'}</span>
                      </button>
                    </div>
                  )}

                  {executionResult.verificationLog && (
                    <div className="space-y-1">
                      <div className="text-slate-400 font-semibold">Verification Log:</div>
                      <pre className="p-2.5 bg-slate-900 rounded-lg text-slate-300 text-[10px] overflow-x-auto whitespace-pre-wrap border border-slate-800">
                        {executionResult.verificationLog}
                      </pre>
                    </div>
                  )}

                  {executionResult.gitLog && (
                    <div className="space-y-1">
                      <div className="text-amber-400 font-semibold">Git Push Log:</div>
                      <pre className="p-2.5 bg-slate-900 rounded-lg text-amber-300 text-[10px] overflow-x-auto whitespace-pre-wrap border border-slate-800">
                        {executionResult.gitLog}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {activeTab === 'analysis' && (
            <div className="space-y-4 font-mono">
              {analyzingContext ? (
                <div className="h-64 flex flex-col items-center justify-center space-y-3 text-slate-400">
                  <RefreshCw className="w-8 h-8 animate-spin text-purple-400" />
                  <p className="font-semibold text-slate-200">Analyzing complete project architecture...</p>
                </div>
              ) : projectContext ? (
                <div className="space-y-3">
                  <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-2">
                    <h4 className="font-bold text-cyan-300 text-sm flex items-center gap-2">
                      <Layers className="w-4 h-4 text-cyan-400" />
                      <span>{projectContext.appName}</span>
                    </h4>
                    <div className="grid grid-cols-2 gap-2 text-xs text-slate-300">
                      <div><span className="text-slate-500">Framework:</span> <strong className="text-white">{projectContext.framework}</strong></div>
                      <div><span className="text-slate-500">Git Branch:</span> <strong className="text-cyan-400">{projectContext.gitState?.branch}</strong></div>
                      <div><span className="text-slate-500">PM2 Status:</span> <strong className="text-emerald-400">{projectContext.pm2State?.status}</strong></div>
                      <div><span className="text-slate-500">Masked Env Keys:</span> <strong className="text-purple-400">{projectContext.envKeys?.length || 0}</strong></div>
                    </div>
                  </div>

                  <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-2 text-xs">
                    <div className="font-bold text-slate-300 uppercase">Main File Tree Overview:</div>
                    <div className="bg-slate-900 p-3 rounded-xl max-h-48 overflow-y-auto text-slate-400 text-[11px] leading-relaxed">
                      {projectContext.fileTreeSummary?.map((f, i) => (
                        <div key={i}>{f}</div>
                      ))}
                    </div>
                  </div>

                  <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-2 text-xs">
                    <div className="font-bold text-slate-300 uppercase">Recent Execution Logs:</div>
                    <pre className="bg-slate-900 p-3 rounded-xl text-slate-300 text-[10px] max-h-48 overflow-y-auto whitespace-pre-wrap border border-slate-800">
                      {projectContext.recentLogs}
                    </pre>
                  </div>
                </div>
              ) : (
                <div className="h-48 flex flex-col items-center justify-center text-slate-500 text-xs">
                  <p>Click "Rescan" to inspect project context.</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'history' && (
            <div className="space-y-3 font-mono">
              <div className="flex items-center justify-between text-xs pb-2 border-b border-slate-800">
                <span className="text-slate-400">Execution History Logs</span>
                {historyLogs.length > 0 && (
                  <button
                    onClick={handleClearHistory}
                    className="text-rose-400 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Clear History</span>
                  </button>
                )}
              </div>

              {historyLogs.length === 0 ? (
                <div className="h-48 flex flex-col items-center justify-center text-slate-500 text-xs">
                  <History className="w-8 h-8 text-slate-700 mb-2" />
                  <p>No project execution history logs recorded yet.</p>
                </div>
              ) : (
                historyLogs.map((h, i) => (
                  <div key={i} className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-cyan-300">{h.userPrompt}</span>
                      <span className="text-[10px] text-slate-500">{new Date(h.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Files: {h.modifiedFiles?.join(', ') || 'None'} | Verification: <strong className="text-emerald-400">{h.verificationStatus}</strong>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
