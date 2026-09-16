import React, { useState, useEffect } from 'react'
import {
  Sparkles, X, Bot, Play, CheckCircle2, XCircle, AlertCircle,
  Terminal, Key, RefreshCw, Send, ShieldAlert, Cpu
} from 'lucide-react'

export default function AICopilotDrawer({ isOpen, onClose, logs, config, onAutoFixConfig }) {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('autodeploy_gemini_key') || '')
  const [provider, setProvider] = useState('gemini')
  const [loading, setLoading] = useState(false)
  const [userPrompt, setUserPrompt] = useState('')

  const [diagnosis, setDiagnosis] = useState(null)
  const [executingFix, setExecutingFix] = useState(false)
  const [fixResult, setFixResult] = useState(null)

  useEffect(() => {
    if (apiKey) localStorage.setItem('autodeploy_gemini_key', apiKey)
  }, [apiKey])

  // Automatically trigger diagnosis when drawer opens with error logs
  useEffect(() => {
    if (isOpen && logs && logs.length > 0 && !diagnosis) {
      handleAnalyzeLogs()
    }
  }, [isOpen])

  const handleAnalyzeLogs = async (customPrompt = '') => {
    setLoading(true)
    setDiagnosis(null)
    setFixResult(null)
    try {
      const token = localStorage.getItem('autodeploy_jwt_token')
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

  const handleExecuteFix = async (command) => {
    if (!command) return
    setExecutingFix(true)
    setFixResult(null)
    try {
      const token = localStorage.getItem('autodeploy_jwt_token')
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

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-slate-950/70 backdrop-blur-sm flex justify-end">
      <div className="w-full max-w-lg bg-slate-900 border-l border-slate-800 h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
        
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 text-slate-950 shadow-md">
              <Sparkles className="h-5 w-5 font-bold" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="font-bold text-white text-sm">AI DevOps Agent Copilot</h3>
                <span className="text-[10px] bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 px-2 py-0.5 rounded-full font-mono">Gemini 1.5</span>
              </div>
              <p className="text-[11px] text-slate-400">Automated log diagnostics & server error remediation</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* API Key Box */}
        <div className="p-4 border-b border-slate-800 bg-slate-950/60 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-medium text-slate-300 flex items-center space-x-1">
              <Key className="h-3 w-3 text-cyan-400" />
              <span>Gemini / OpenAI API Key (Optional)</span>
            </label>
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noreferrer"
              className="text-[10px] text-cyan-400 hover:underline"
            >
              Get Free Gemini Key
            </a>
          </div>
          <div className="flex gap-2">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Paste Gemini API Key for deep LLM analysis..."
              className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs font-mono text-cyan-300 focus:outline-none focus:border-cyan-500"
            />
            <button
              onClick={() => handleAnalyzeLogs()}
              disabled={loading}
              className="bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-semibold px-3 py-1.5 rounded-lg text-xs flex items-center space-x-1 transition"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Analyze</span>
            </button>
          </div>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 font-sans">
          
          {loading ? (
            <div className="h-64 flex flex-col items-center justify-center space-y-3 text-slate-400 text-xs">
              <RefreshCw className="h-8 w-8 animate-spin text-cyan-400" />
              <p className="font-semibold text-slate-200">AI Agent Analyzing Terminal Logs...</p>
              <p className="text-[11px] text-slate-500">Checking Git repo status, Nginx configuration, PM2 service, and open ports.</p>
            </div>
          ) : diagnosis ? (
            <div className="space-y-4">
              
              {/* Diagnosis Output Box */}
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
                <div className="flex items-center space-x-2 text-cyan-400 font-semibold text-xs border-b border-slate-800 pb-2">
                  <Bot className="h-4 w-4" />
                  <span>AI Agent Diagnostic Analysis</span>
                </div>
                
                <div className="text-xs text-slate-300 space-y-2 leading-relaxed whitespace-pre-wrap font-mono bg-slate-900/60 p-3 rounded-lg border border-slate-800/80 max-h-60 overflow-y-auto">
                  {diagnosis.aiDiagnosis}
                </div>
              </div>

              {/* Heuristic Quick Fix Actions */}
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
                        className="ml-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/40 text-[11px] font-semibold px-2.5 py-1 rounded flex items-center space-x-1 transition whitespace-nowrap"
                      >
                        <Play className="h-3 w-3 fill-current" />
                        <span>{executingFix ? 'Executing...' : 'Run Fix on Server'}</span>
                      </button>
                    </div>
                  )}
                </div>
              ))}

              {/* Fix Result Notification */}
              {fixResult && (
                <div
                  className={`p-3.5 rounded-xl border text-xs font-mono space-y-1.5 ${
                    fixResult.success
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                      : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                  }`}
                >
                  <div className="flex items-center space-x-2 font-semibold">
                    {fixResult.success ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                    <span>{fixResult.success ? 'SSH Fix Action Executed Successfully!' : 'SSH Fix Action Failed'}</span>
                  </div>
                  {fixResult.stdout && <pre className="text-[11px] opacity-90 whitespace-pre-wrap bg-slate-950/80 p-2 rounded">{fixResult.stdout}</pre>}
                  {fixResult.stderr && <pre className="text-[11px] opacity-90 whitespace-pre-wrap bg-slate-950/80 p-2 text-rose-300">{fixResult.stderr}</pre>}
                </div>
              )}

            </div>
          ) : (
            <div className="h-48 flex flex-col items-center justify-center space-y-2 text-slate-500 text-xs text-center p-4">
              <Bot className="h-8 w-8 text-slate-700" />
              <p>Click "Analyze" to inspect logs and generate AI fix recommendations.</p>
            </div>
          )}

        </div>

        {/* Natural Language Prompt Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-900 space-y-2">
          <label className="text-[11px] font-medium text-slate-300">Ask AI Agent for Custom Fix or Code Modification</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={userPrompt}
              onChange={(e) => setUserPrompt(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAnalyzeLogs(userPrompt)}
              placeholder="e.g. How to fix Nginx 500 error or change port?"
              className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
            />
            <button
              onClick={() => handleAnalyzeLogs(userPrompt)}
              disabled={loading || !userPrompt}
              className="bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-bold px-3.5 py-2 rounded-lg text-xs flex items-center space-x-1 transition"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
