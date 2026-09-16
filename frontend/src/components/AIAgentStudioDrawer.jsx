import React, { useState, useEffect } from 'react'
import { Sparkles, X, Bot, Play, CheckCircle2, AlertCircle, Key, RefreshCw, Send, ShieldAlert, Cpu, GitCommit, Upload, Code } from 'lucide-react'

export default function AIAgentStudioDrawer({ isOpen, onClose, activeFile, fileContent, projectPath, jwtToken, onApplyCodeFix }) {
  const [provider, setProvider] = useState('gemini') // 'gemini' | 'grok' | 'claude' | 'chatgpt'
  const [apiKey, setApiKey] = useState('')
  const [userPrompt, setUserPrompt] = useState('')
  const [autoCommit, setAutoCommit] = useState(false)
  const [autoDeploy, setAutoDeploy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [agentOutput, setAgentOutput] = useState(null)

  // Load provider API keys from localStorage
  useEffect(() => {
    const savedKey = localStorage.getItem(`autodeploy_key_${provider}`)
    setApiKey(savedKey || '')
  }, [provider])

  const handleKeyChange = (val) => {
    setApiKey(val)
    localStorage.setItem(`autodeploy_key_${provider}`, val)
  }

  const handleExecuteAgent = async (customPrompt = '') => {
    const promptToUse = customPrompt || userPrompt
    if (!promptToUse) {
      alert('Please enter a prompt instruction for the AI Agent.')
      return
    }

    setLoading(true)
    setAgentOutput(null)

    try {
      const res = await fetch('/api/studio/agent/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify({
          userPrompt: promptToUse,
          filePath: activeFile?.fullPath || activeFile?.path,
          codeContent: fileContent,
          provider,
          apiKey,
          autoCommit,
          autoDeploy,
          projectPath
        })
      })
      const data = await res.json()
      if (data.success) {
        setAgentOutput(data)
      } else {
        alert(`Agent Error: ${data.error}`)
      }
    } catch (err) {
      alert(`Agent Request Failed: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-slate-950/80 backdrop-blur-xl flex justify-end font-sans">
      <div className="w-full max-w-xl bg-[#0B0E17]/95 border-l border-white/10 h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-300">
        
        {/* Header - Apple Translucent Glass */}
        <div className="p-4 border-b border-white/10 flex items-center justify-between bg-slate-950/90 backdrop-blur-xl">
          <div className="flex items-center space-x-3.5">
            <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-purple-500 via-indigo-600 to-cyan-500 text-white font-bold shadow-lg shadow-purple-950/50 ring-1 ring-white/20">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-white text-sm tracking-tight flex items-center gap-2">
                Multi-Model Autonomous AI Agent Studio
                <span className="text-[9px] px-2 py-0.5 rounded-full bg-purple-950/80 border border-purple-800 text-purple-300 font-mono font-bold">
                  v2.0 AI
                </span>
              </h3>
              <p className="text-[11px] text-slate-400 font-mono">Self-coding, Git auto-commit & Live server self-deployer</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800/80 transition cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content Container */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
          
          {/* Provider Selector Tabs */}
          <div>
            <label className="block text-[10px] font-mono text-slate-400 uppercase tracking-widest font-bold mb-2.5">
              Select Autonomous AI Engine:
            </label>
            <div className="grid grid-cols-4 gap-2 font-mono text-[11px]">
              <button
                onClick={() => setProvider('gemini')}
                className={`p-3 rounded-2xl border flex flex-col items-center gap-1.5 transition-all duration-200 cursor-pointer ${
                  provider === 'gemini'
                    ? 'bg-cyan-950/90 border-cyan-500/80 text-cyan-300 font-bold shadow-lg shadow-cyan-950/50 ring-1 ring-cyan-500/40'
                    : 'bg-slate-950/60 border-white/5 text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                }`}
              >
                <span className="text-lg">♊</span>
                <span>Gemini</span>
              </button>

              <button
                onClick={() => setProvider('grok')}
                className={`p-3 rounded-2xl border flex flex-col items-center gap-1.5 transition-all duration-200 cursor-pointer ${
                  provider === 'grok'
                    ? 'bg-amber-950/90 border-amber-500/80 text-amber-300 font-bold shadow-lg shadow-amber-950/50 ring-1 ring-amber-500/40'
                    : 'bg-slate-950/60 border-white/5 text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                }`}
              >
                <span className="text-lg">🚀</span>
                <span>xAI Grok</span>
              </button>

              <button
                onClick={() => setProvider('claude')}
                className={`p-3 rounded-2xl border flex flex-col items-center gap-1.5 transition-all duration-200 cursor-pointer ${
                  provider === 'claude'
                    ? 'bg-purple-950/90 border-purple-500/80 text-purple-300 font-bold shadow-lg shadow-purple-950/50 ring-1 ring-purple-500/40'
                    : 'bg-slate-950/60 border-white/5 text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                }`}
              >
                <span className="text-lg">🧠</span>
                <span>Claude</span>
              </button>

              <button
                onClick={() => setProvider('chatgpt')}
                className={`p-3 rounded-2xl border flex flex-col items-center gap-1.5 transition-all duration-200 cursor-pointer ${
                  provider === 'chatgpt'
                    ? 'bg-emerald-950/90 border-emerald-500/80 text-emerald-300 font-bold shadow-lg shadow-emerald-950/50 ring-1 ring-emerald-500/40'
                    : 'bg-slate-950/60 border-white/5 text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                }`}
              >
                <span className="text-lg">🤖</span>
                <span>ChatGPT</span>
              </button>
            </div>
          </div>

          {/* API Key Input Box */}
          <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-300 font-semibold uppercase font-mono flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-cyan-400" />
                {provider.toUpperCase()} API Key Config
              </span>
              <span className="text-slate-500">Saved in Local Storage</span>
            </div>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => handleKeyChange(e.target.value)}
              placeholder={`Enter your ${provider.toUpperCase()} API key...`}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-slate-100 placeholder-slate-500 font-mono focus:border-cyan-500 focus:outline-none"
            />
          </div>

          {/* Preset Agent Prompt Actions */}
          <div>
            <label className="block text-[11px] font-mono text-slate-400 uppercase tracking-wider mb-2">
              One-Click Agent Presets:
            </label>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <button
                onClick={() => handleExecuteAgent("Refactor active file code for high performance, clean structure, and add error handling.")}
                className="p-2.5 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded-xl text-left text-slate-300 transition flex items-center gap-2 cursor-pointer"
              >
                <Sparkles className="w-4 h-4 text-cyan-400 shrink-0" />
                <span>Refactor Active Code</span>
              </button>

              <button
                onClick={() => handleExecuteAgent("Analyze active code file for security vulnerabilities, memory leaks, or missing input validations.")}
                className="p-2.5 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded-xl text-left text-slate-300 transition flex items-center gap-2 cursor-pointer"
              >
                <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
                <span>Security & Bug Audit</span>
              </button>
            </div>
          </div>

          {/* Autonomous Execution Controls */}
          <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl space-y-2 text-xs">
            <div className="font-semibold text-slate-300 uppercase font-mono text-[11px] mb-1">
              Autonomous Actions:
            </div>
            <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={autoCommit}
                onChange={(e) => setAutoCommit(e.target.checked)}
                className="rounded border-slate-700 text-cyan-500 focus:ring-0"
              />
              <span className="flex items-center gap-1.5 font-mono">
                <GitCommit className="w-3.5 h-3.5 text-amber-400" />
                Auto-Commit & Push to GitHub Repository
              </span>
            </label>
          </div>

          {/* Prompt Text Input Box */}
          <div className="space-y-2">
            <label className="block text-[11px] font-mono text-slate-400 uppercase tracking-wider">
              Instruction for {provider.toUpperCase()} Agent:
            </label>
            <textarea
              value={userPrompt}
              onChange={(e) => setUserPrompt(e.target.value)}
              rows={3}
              placeholder={`Ask ${provider.toUpperCase()} Agent to write code, generate features, or fix bugs...`}
              className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-500 text-xs font-mono focus:border-cyan-500 focus:outline-none resize-none"
            ></textarea>
            <button
              onClick={() => handleExecuteAgent()}
              disabled={loading}
              className="w-full py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-medium rounded-xl shadow-lg flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>{provider.toUpperCase()} Agent Working...</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Run {provider.toUpperCase()} Autonomous Agent</span>
                </>
              )}
            </button>
          </div>

          {/* Agent Output Response Window */}
          {agentOutput && (
            <div className="space-y-3 pt-3 border-t border-slate-800">
              <div className="flex items-center justify-between text-xs font-semibold text-cyan-400">
                <span>{agentOutput.provider.toUpperCase()} Agent Output:</span>
                <span className="text-[10px] text-slate-500 font-mono">DONE</span>
              </div>
              <pre className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-slate-200 max-h-72 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                {agentOutput.aiReply}
              </pre>

              {agentOutput.gitLog && (
                <div className="p-3 bg-amber-950/40 border border-amber-800/60 rounded-xl text-xs font-mono text-amber-300">
                  <div className="font-semibold mb-1 flex items-center gap-1.5">
                    <GitCommit className="w-3.5 h-3.5" />
                    Git Auto-Commit Log:
                  </div>
                  <div>{agentOutput.gitLog}</div>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
