import React, { useState, useEffect } from 'react'
import {
  Sparkles, X, Bot, Play, CheckCircle2, XCircle, AlertCircle,
  Terminal, Key, RefreshCw, Send, ShieldAlert, Cpu, Code, Activity, Upload, GitCommit
} from 'lucide-react'

export default function AICopilotDrawer({ isOpen, onClose, logs, config, onAutoFixConfig }) {
  const [provider, setProvider] = useState('gemini')
  const [apiKey, setApiKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [userPrompt, setUserPrompt] = useState('')

  const [diagnosis, setDiagnosis] = useState(null)
  const [executingFix, setExecutingFix] = useState(false)
  const [fixResult, setFixResult] = useState(null)
  const [currentPlan, setCurrentPlan] = useState(null)
  const [executingPlan, setExecutingPlan] = useState(false)

  useEffect(() => {
    const savedKey = localStorage.getItem(`autodeploy_key_${provider}`) || localStorage.getItem('autodeploy_gemini_key')
    setApiKey(savedKey || '')
  }, [provider])

  useEffect(() => {
    if (isOpen && logs && logs.length > 0 && !diagnosis) {
      handleAnalyzeLogs()
    }
  }, [isOpen])

  const handleKeyChange = (val) => {
    setApiKey(val)
    localStorage.setItem(`autodeploy_key_${provider}`, val)
  }

  const handleAnalyzeLogs = async (customPrompt = '') => {
    setLoading(true)
    setDiagnosis(null)
    setFixResult(null)
    setCurrentPlan(null)
    try {
      const token = localStorage.getItem('autodeploy_jwt_token') || localStorage.getItem('autodeploy_token')
      const res = await fetch('/api/deploy/ai-copilot', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({
          logs,
          config,
          userPrompt: customPrompt || userPrompt,
          provider,
          apiKey,
        }),
      })
      const data = await res.json()
      if (data.success) {
        setDiagnosis(data)
      } else {
        alert(`AI Analysis error: ${data.error}`)
      }
    } catch (err) {
      alert(`AI Request failed: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  const handleGeneratePlan = async (customPrompt = '') => {
    const promptToUse = customPrompt || userPrompt
    if (!promptToUse.trim()) return

    setLoading(true)
    setCurrentPlan(null)
    try {
      const token = localStorage.getItem('autodeploy_jwt_token') || localStorage.getItem('autodeploy_token')
      const res = await fetch('/api/studio/ai/agent/plan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({
          userPrompt: promptToUse,
          projectPath: config?.remoteDir || config?.projectPath || '/var/www/app',
          provider,
          apiKey
        })
      })
      const data = await res.json()
      if (data.success && data.plan) {
        setCurrentPlan(data.plan)
      }
    } catch (e) {
    } finally {
      setLoading(false)
    }
  }

  const handleExecuteFix = async (command) => {
    if (!command) return
    setExecutingFix(true)
    setFixResult(null)
    try {
      const token = localStorage.getItem('autodeploy_jwt_token') || localStorage.getItem('autodeploy_token')
      const res = await fetch('/api/deploy/ai-execute-fix', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({
          config,
          command,
        }),
      })
      const data = await res.json()
      setFixResult(data)
    } catch (err) {
      setFixResult({ success: false, stderr: err.message })
    } finally {
      setExecutingFix(false)
    }
  }

  const handleExecutePlan = async () => {
    if (!currentPlan) return
    setExecutingPlan(true)
    try {
      const token = localStorage.getItem('autodeploy_jwt_token') || localStorage.getItem('autodeploy_token')
      const res = await fetch('/api/studio/ai/agent/execute-plan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({
          planId: currentPlan.planId,
          planData: currentPlan,
          autoCommit: true,
          autoDeploy: true
        })
      })
      const data = await res.json()
      if (data.success) {
        setFixResult({
          success: true,
          stdout: `AI Project Plan executed cleanly across project!\nStatus: ${data.verificationStatus}\nLog: ${data.verificationLog || 'Verified'}`
        })
        setCurrentPlan(null)
      }
    } catch (e) {
      setFixResult({ success: false, stderr: e.message })
    } finally {
      setExecutingPlan(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-slate-950/70 backdrop-blur-md flex justify-end font-sans">
      <div className="w-full max-w-xl bg-slate-900 border-l border-slate-800 h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
        
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-gradient-to-tr from-cyan-500 to-purple-600 text-slate-950 shadow-md">
              <Bot className="h-5 w-5 font-bold" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="font-bold text-white text-sm">AI Project Agent & DevOps Copilot</h3>
                <span className="text-[10px] bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 px-2 py-0.5 rounded-full font-mono">
                  Multi-Provider AI
                </span>
              </div>
              <p className="text-[11px] text-slate-400">Automated log diagnostics, code execution & server remediation</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Provider Selector */}
        <div className="p-3 border-b border-slate-800 bg-slate-950/80 space-y-2">
          <div className="grid grid-cols-4 gap-1.5 font-mono text-[10px]">
            <button
              onClick={() => setProvider('openai')}
              className={`p-1.5 rounded-lg border text-center transition cursor-pointer ${
                provider === 'openai' ? 'bg-emerald-950 border-emerald-500 text-emerald-300 font-bold' : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
            >
              OpenAI
            </button>
            <button
              onClick={() => setProvider('gemini')}
              className={`p-1.5 rounded-lg border text-center transition cursor-pointer ${
                provider === 'gemini' ? 'bg-cyan-950 border-cyan-500 text-cyan-300 font-bold' : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
            >
              Gemini
            </button>
            <button
              onClick={() => setProvider('claude')}
              className={`p-1.5 rounded-lg border text-center transition cursor-pointer ${
                provider === 'claude' ? 'bg-purple-950 border-purple-500 text-purple-300 font-bold' : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
            >
              Claude
            </button>
            <button
              onClick={() => setProvider('grok')}
              className={`p-1.5 rounded-lg border text-center transition cursor-pointer ${
                provider === 'grok' ? 'bg-amber-950 border-amber-500 text-amber-300 font-bold' : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
            >
              xAI Grok
            </button>
          </div>

          <div className="flex gap-2 pt-1">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => handleKeyChange(e.target.value)}
              placeholder={`Paste ${provider.toUpperCase()} API Key (optional)...`}
              className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs font-mono text-cyan-300 focus:outline-none focus:border-cyan-500"
            />
            <button
              onClick={() => handleAnalyzeLogs()}
              disabled={loading}
              className="bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-semibold px-3 py-1.5 rounded-lg text-xs flex items-center space-x-1 transition cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Diagnose</span>
            </button>
          </div>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 font-sans text-xs">
          
          {loading ? (
            <div className="h-64 flex flex-col items-center justify-center space-y-3 text-slate-400">
              <RefreshCw className="h-8 w-8 animate-spin text-cyan-400" />
              <p className="font-semibold text-slate-200">AI Project Agent Analyzing Logs & Code Base...</p>
            </div>
          ) : currentPlan ? (
            <div className="space-y-3 p-4 bg-slate-950 border-2 border-cyan-500/60 rounded-xl font-mono">
              <div className="font-bold text-cyan-300 border-b border-slate-800 pb-2">
                🤖 Proposed AI Action Plan & File Diff Preview
              </div>
              <p className="text-slate-300 leading-relaxed bg-slate-900 p-2.5 rounded-lg border border-slate-800">
                {currentPlan.summary}
              </p>

              <div className="space-y-1">
                <div className="text-slate-400 font-bold uppercase text-[10px]">Steps to Execute:</div>
                {currentPlan.planSteps?.map((s, i) => (
                  <div key={i} className="text-slate-200 text-[11px] bg-slate-900/60 p-2 rounded">
                    {i + 1}. {s.description}
                  </div>
                ))}
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleExecutePlan}
                  disabled={executingPlan}
                  className="flex-1 py-2 bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 font-extrabold rounded-lg flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {executingPlan ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  <span>Approve & Execute Plan</span>
                </button>
                <button
                  onClick={() => setCurrentPlan(null)}
                  className="px-3 py-2 bg-slate-800 text-slate-300 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : diagnosis ? (
            <div className="space-y-4">
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
                <div className="flex items-center space-x-2 text-cyan-400 font-semibold text-xs border-b border-slate-800 pb-2">
                  <Bot className="h-4 w-4" />
                  <span>AI Diagnostic & Remediation Analysis</span>
                </div>
                <div className="text-xs text-slate-300 space-y-2 leading-relaxed whitespace-pre-wrap font-mono bg-slate-900/60 p-3 rounded-lg border border-slate-800/80 max-h-60 overflow-y-auto">
                  {diagnosis.aiDiagnosis}
                </div>
              </div>

              {diagnosis.heuristicDiagnosis?.suggestedFixes?.map((fix, idx) => (
                <div key={idx} className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-white flex items-center gap-1.5">
                      <ShieldAlert className="h-4 w-4 text-amber-400" />
                      <span>Recommended Server Fix Action</span>
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">SSH Executable</span>
                  </div>

                  <p className="text-xs text-slate-300">{fix.explanation}</p>

                  {fix.command && (
                    <div className="bg-slate-900 p-2.5 rounded-lg font-mono text-xs text-cyan-300 border border-slate-800 overflow-x-auto flex items-center justify-between">
                      <code>{fix.command}</code>
                      <button
                        onClick={() => handleExecuteFix(fix.command)}
                        disabled={executingFix}
                        className="ml-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/40 text-[11px] font-semibold px-2.5 py-1 rounded flex items-center space-x-1 transition cursor-pointer"
                      >
                        <Play className="h-3 w-3 fill-current" />
                        <span>{executingFix ? 'Executing...' : 'Run Fix on Server'}</span>
                      </button>
                    </div>
                  )}
                </div>
              ))}

              {fixResult && (
                <div className={`p-3.5 rounded-xl border text-xs font-mono space-y-1.5 ${
                  fixResult.success ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                }`}>
                  <div className="flex items-center space-x-2 font-semibold">
                    {fixResult.success ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                    <span>{fixResult.success ? 'Action Executed Successfully!' : 'Action Failed'}</span>
                  </div>
                  {fixResult.stdout && <pre className="text-[11px] whitespace-pre-wrap bg-slate-950/80 p-2 rounded">{fixResult.stdout}</pre>}
                  {fixResult.stderr && <pre className="text-[11px] whitespace-pre-wrap bg-slate-950/80 p-2 text-rose-300">{fixResult.stderr}</pre>}
                </div>
              )}
            </div>
          ) : (
            <div className="h-48 flex flex-col items-center justify-center space-y-2 text-slate-500 text-xs text-center p-4">
              <Bot className="h-8 w-8 text-slate-700" />
              <p>Type a natural language instruction or click "Diagnose" for log analysis.</p>
            </div>
          )}

        </div>

        {/* Natural Language Prompt Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-900 space-y-2">
          <label className="text-[11px] font-medium text-slate-300">Natural-Language Command for AI Project Agent</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={userPrompt}
              onChange={(e) => setUserPrompt(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleGeneratePlan(userPrompt)}
              placeholder="e.g. Add user feature, fix Nginx 500 error, or refactor code..."
              className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
            />
            <button
              onClick={() => handleGeneratePlan(userPrompt)}
              disabled={loading || !userPrompt}
              className="bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-bold px-3.5 py-2 rounded-lg text-xs flex items-center space-x-1 transition cursor-pointer"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
