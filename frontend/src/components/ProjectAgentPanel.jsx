import React, { useState, useEffect, useRef } from 'react'
import {
  Bot, Send, Square, RefreshCw, Plus, History, FileCode, Terminal, Eye, ChevronRight, ChevronDown,
  AlertTriangle, CheckCircle2, Undo2, Rocket, X, Key, Brain, Trash2, GitCommit, Settings
} from 'lucide-react'
import { useAuth } from '../store/AuthContext'
import { useServers } from '../store/ServersContext'

/**
 * Claude Code-style project agent: chat → Claude explores, edits and verifies the project
 * on the server → review diffs → revert or deploy.
 */

const API = '/api/studio/ai/agent'

const PROVIDER_STYLE = {
  claude: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  openai: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  gemini: 'bg-blue-500/15 text-blue-300 border-blue-500/30'
}

// Minimal, safe markdown: fenced code, inline code, bold, headings, bullet lists
function renderMarkdown(text) {
  const parts = text.split(/```(\w*)\n?([\s\S]*?)```/g)
  const out = []
  for (let i = 0; i < parts.length; i += 3) {
    const prose = parts[i]
    if (prose) {
      prose.split('\n').forEach((line, j) => {
        const key = `${i}-${j}`
        const heading = line.match(/^#{1,4}\s+(.*)/)
        const bullet = line.match(/^\s*[-*]\s+(.*)/)
        const content = inline(heading ? heading[1] : bullet ? bullet[1] : line, key)
        if (heading) out.push(<div key={key} className="font-bold text-white mt-2">{content}</div>)
        else if (bullet) out.push(<div key={key} className="pl-3 flex gap-1.5"><span className="text-cyan-400">•</span><span>{content}</span></div>)
        else out.push(<div key={key} className={line.trim() ? '' : 'h-2'}>{content}</div>)
      })
    }
    if (i + 2 < parts.length) {
      out.push(
        <pre key={`code-${i}`} className="my-1.5 p-2.5 bg-black/50 border border-white/10 rounded-lg overflow-x-auto text-[11px] text-emerald-200">{parts[i + 2]}</pre>
      )
    }
  }
  return out
}

function inline(text, key) {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((seg, k) => {
    if (seg.startsWith('`') && seg.endsWith('`') && seg.length > 1) return <code key={`${key}-${k}`} className="px-1 py-0.5 rounded bg-black/40 text-amber-200 text-[11px]">{seg.slice(1, -1)}</code>
    if (seg.startsWith('**') && seg.endsWith('**')) return <strong key={`${key}-${k}`} className="text-white">{seg.slice(2, -2)}</strong>
    return seg
  })
}

function DiffView({ diff }) {
  return (
    <pre className="text-[11px] leading-relaxed overflow-x-auto">
      {diff.split('\n').map((line, i) => (
        <div
          key={i}
          className={
            line.startsWith('+++') || line.startsWith('---') ? 'text-slate-500'
              : line.startsWith('+') ? 'bg-emerald-500/10 text-emerald-300'
                : line.startsWith('-') ? 'bg-rose-500/10 text-rose-300'
                  : line.startsWith('@@') ? 'text-cyan-400'
                    : 'text-slate-400'
          }
        >
          {line || ' '}
        </div>
      ))}
    </pre>
  )
}

export default function ProjectAgentPanel({ projectPath, projectName, onFilesChanged }) {
  const { token: jwtToken } = useAuth()
  const { activeServer } = useServers()
  const [status, setStatus] = useState(null)
  const [provider, setProvider] = useState(null)
  const [showSettings, setShowSettings] = useState(false)
  const [drafts, setDrafts] = useState({})
  const [savingProvider, setSavingProvider] = useState(null)
  const [sessions, setSessions] = useState([])
  const [showHistory, setShowHistory] = useState(false)
  const [session, setSession] = useState(null)
  const [transcript, setTranscript] = useState([])
  const [prompt, setPrompt] = useState('')
  const [runningState, setRunningState] = useState(false)
  const [liveText, setLiveText] = useState('')
  const [liveThinking, setLiveThinking] = useState('')
  const [activeTool, setActiveTool] = useState(null)
  const [expanded, setExpanded] = useState({})
  const [error, setError] = useState(null)
  const [showChanges, setShowChanges] = useState(false)
  const [changes, setChanges] = useState(null)
  const [showDeploy, setShowDeploy] = useState(false)
  const [deployCommit, setDeployCommit] = useState(true)
  const [deployMessage, setDeployMessage] = useState('')
  const [deploying, setDeploying] = useState(false)
  const scrollRef = useRef(null)
  const liveStreamRef = useRef(false)

  const token = () => jwtToken
  const headers = () => ({ 'Content-Type': 'application/json', 'Authorization': `Bearer ${token()}`, 'X-Server-Id': activeServer?.id || '' })

  const api = async (url, body) => {
    const res = await fetch(`${API}${url}`, body === undefined ? { headers: headers() } : { method: 'POST', headers: headers(), body: JSON.stringify(body) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.success === false) throw new Error(data.error || `Request failed (${res.status})`)
    return data
  }

  const loadSessions = async () => {
    if (!projectPath) return []
    const data = await api(`/sessions?projectPath=${encodeURIComponent(projectPath)}`)
    setSessions(data.sessions)
    return data.sessions
  }

  const openSession = async (id) => {
    const data = await api(`/sessions/${id}`)
    setSession(data.session)
    setTranscript(data.session.transcript)
    setRunningState(data.session.status === 'running')
    setShowHistory(false)
  }

  useEffect(() => {
    setSession(null)
    setTranscript([])
    setError(null)
    ;(async () => {
      try {
        const s = await api('/status')
        setStatus(s.status)
        setProvider(p => p || s.status.defaultProvider)
        const list = await loadSessions()
        if (list[0]) await openSession(list[0].id)
      } catch (e) {
        setError(e.message)
      }
    })()
  }, [projectPath])

  // A run that continues server-side (page reload, second tab): poll until it finishes
  useEffect(() => {
    if (!session || !runningState || liveStreamRef.current) return
    const t = setInterval(async () => {
      try {
        const data = await api(`/sessions/${session.id}`)
        setTranscript(data.session.transcript)
        setSession(data.session)
        if (data.session.status !== 'running') { setRunningState(false); onFilesChanged?.() }
      } catch { /* keep polling */ }
    }, 2500)
    return () => clearInterval(t)
  }, [session?.id, runningState])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [transcript, liveText, liveThinking, activeTool])

  const saveProvider = async (id, makeDefault = false) => {
    const d = drafts[id] || {}
    setSavingProvider(id)
    setError(null)
    try {
      const body = { provider: id, makeDefault }
      if (d.apiKey !== undefined && d.apiKey !== '') body.apiKey = d.apiKey
      if (d.model !== undefined) body.model = d.model
      const data = await api('/settings', body)
      setStatus(data.status)
      setDrafts(x => ({ ...x, [id]: {} }))
      if (makeDefault || !provider || !data.status.providers.find(p => p.id === provider)?.configured) setProvider(data.status.defaultProvider)
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingProvider(null)
    }
  }

  const removeKey = async (id) => {
    if (!window.confirm('Remove this API key from the server?')) return
    try {
      const data = await api('/settings', { provider: id, apiKey: '' })
      setStatus(data.status)
      if (provider === id) setProvider(data.status.defaultProvider)
    } catch (err) {
      setError(err.message)
    }
  }

  const newSession = async () => {
    const data = await api('/sessions', { projectPath, projectName, provider })
    setSession(data.session)
    setTranscript([])
    setShowHistory(false)
    loadSessions()
    return data.session
  }

  const handleEvent = (ev) => {
    switch (ev.type) {
      case 'text_delta': setLiveText(t => t + ev.text); break
      case 'thinking_delta': setLiveThinking(t => t + ev.text); break
      case 'tool_pending': setActiveTool({ summary: ev.name === 'bash' ? 'Preparing command…' : 'Preparing edit…' }); break
      case 'tool_start': setActiveTool({ name: ev.name, summary: ev.summary }); break
      case 'thinking': setLiveThinking(''); setTranscript(t => [...t, ev]); break
      case 'assistant': setLiveText(''); setTranscript(t => [...t, ev]); break
      case 'tool':
        setActiveTool(null)
        setTranscript(t => [...t, ev])
        if (ev.changed) onFilesChanged?.()
        break
      case 'done':
        setLiveText('')
        setLiveThinking('')
        setActiveTool(null)
        setTranscript(t => [...t, ev])
        if (ev.usage) setSession(s => s && ({ ...s, usage: ev.usage, changedFiles: (ev.changedFiles || []).map(f => ({ file: f })) }))
        break
      default: setTranscript(t => [...t, ev])
    }
  }

  const send = async () => {
    const text = prompt.trim()
    if (!text || runningState) return
    setError(null)
    setPrompt('')
    let s = session
    try {
      if (!s) s = await newSession()
    } catch (e) {
      setError(e.message)
      return
    }
    setRunningState(true)
    liveStreamRef.current = true
    try {
      const res = await fetch(`${API}/sessions/${s.id}/message`, { method: 'POST', headers: headers(), body: JSON.stringify({ prompt: text }) })
      if (!res.ok || !res.body) throw new Error(`Agent request failed (${res.status})`)
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let idx
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, idx)
          buf = buf.slice(idx + 2)
          for (const line of chunk.split('\n')) {
            if (line.startsWith('data: ')) {
              try { handleEvent(JSON.parse(line.slice(6))) } catch { /* ignore malformed */ }
            }
          }
        }
      }
    } catch (e) {
      setError(`${e.message}. The agent keeps working on the server — reopen this session to see progress.`)
    } finally {
      liveStreamRef.current = false
      setRunningState(false)
      setLiveText('')
      setLiveThinking('')
      setActiveTool(null)
      try {
        const data = await api(`/sessions/${s.id}`)
        setSession(data.session)
        setTranscript(data.session.transcript)
        if (data.session.status === 'running') setRunningState(true)
      } catch { /* ignore */ }
      loadSessions()
    }
  }

  const stop = async () => {
    if (!session) return
    try { await api(`/sessions/${session.id}/stop`, {}) } catch (e) { setError(e.message) }
  }

  const openChanges = async () => {
    setShowChanges(true)
    setChanges(null)
    try {
      setChanges((await api(`/sessions/${session.id}/changes`)).files)
    } catch (e) {
      setError(e.message)
    }
  }

  const revert = async (file = null) => {
    if (!window.confirm(file ? `Revert ${file} to how it was before this session?` : 'Revert ALL files changed in this session?')) return
    try {
      const data = await api(`/sessions/${session.id}/revert`, { file })
      setSession(data.session)
      setTranscript(data.session.transcript)
      onFilesChanged?.()
      if (file) openChanges()
      else setShowChanges(false)
    } catch (e) {
      setError(e.message)
    }
  }

  const deploy = async () => {
    setDeploying(true)
    try {
      const data = await api(`/sessions/${session.id}/deploy`, { commit: deployCommit, commitMessage: deployMessage || session.title })
      setTranscript(t => [...t, { type: 'system', text: `Deploy: ${data.log.join(' ')}` }])
      setShowDeploy(false)
      onFilesChanged?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setDeploying(false)
    }
  }

  const removeSession = async (id) => {
    if (!window.confirm('Delete this conversation? File changes it made stay in place.')) return
    try {
      await api(`/sessions/${id}/delete`, {})
      if (session?.id === id) { setSession(null); setTranscript([]) }
      loadSessions()
    } catch (e) {
      setError(e.message)
    }
  }

  const changedCount = session?.changedFiles?.length || 0

  // ------------------------------------------------------------------ render
  const providerSettings = () => (
    <div className="space-y-3 w-full text-left">
      {status?.providers.map(p => {
        const d = drafts[p.id] || {}
        return (
          <div key={p.id} className="p-3 rounded-xl bg-slate-900 border border-slate-700 space-y-2">
            <div className="flex items-center gap-2">
              <span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${PROVIDER_STYLE[p.id]}`}>{p.label}</span>
              {p.configured
                ? <span className="text-emerald-400 text-[11px]">connected · key {p.keyHint}{p.keySource === 'environment' ? ' (env)' : ''}</span>
                : <span className="text-slate-500 text-[11px]">not connected</span>}
              {status.defaultProvider === p.id && <span className="ml-auto text-[10px] text-cyan-300">default</span>}
            </div>
            <input
              type="password"
              value={d.apiKey || ''}
              onChange={(e) => setDrafts(x => ({ ...x, [p.id]: { ...d, apiKey: e.target.value } }))}
              placeholder={p.configured ? 'Paste a new key to replace' : `API key — ${p.keyHelp}`}
              className="w-full p-2 bg-slate-950 border border-slate-700 rounded-lg text-slate-100 focus:border-cyan-500 focus:outline-none"
            />
            <div className="flex items-center gap-2">
              <span className="text-slate-500 text-[11px]">Model</span>
              <input
                value={d.model ?? p.model}
                onChange={(e) => setDrafts(x => ({ ...x, [p.id]: { ...d, model: e.target.value } }))}
                placeholder={p.defaultModel}
                className="flex-1 p-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-100 focus:border-cyan-500 focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => saveProvider(p.id)} disabled={savingProvider === p.id} className="px-2.5 py-1 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold cursor-pointer disabled:opacity-50">Save</button>
              {p.configured && status.defaultProvider !== p.id && <button onClick={() => saveProvider(p.id, true)} className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer">Make default</button>}
              {p.configured && p.keySource !== 'environment' && <button onClick={() => removeKey(p.id)} className="ml-auto text-slate-500 hover:text-rose-400 cursor-pointer">Remove key</button>}
            </div>
          </div>
        )
      })}
      <p className="text-[10px] text-slate-500">Keys are stored on the server only and shared by every project's agent. Each conversation keeps the model it started with.</p>
    </div>
  )

  if (status && !status.providers.some(p => p.configured)) {
    return (
      <div className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-3">
        <div className="flex flex-col items-center text-center gap-2 pt-2">
          <Key className="w-7 h-7 text-cyan-400" />
          <div className="text-sm font-bold text-white">Connect an AI model</div>
          <p className="text-slate-400">Add an API key for Claude, ChatGPT or Gemini — one is enough.</p>
        </div>
        {providerSettings()}
        {error && <div className="text-rose-300">{error}</div>}
      </div>
    )
  }

  const configuredProviders = status?.providers.filter(p => p.configured) || []
  const sessionProvider = session ? status?.providers.find(p => p.id === session.provider) : null

  return (
    <div className="flex-1 flex flex-col min-h-0 font-mono text-xs relative">
      {/* Session bar */}
      <div className="px-3 py-2 border-b border-slate-800 flex items-center gap-2 bg-slate-950/80">
        <button onClick={() => { setShowHistory(h => !h); loadSessions() }} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-300 cursor-pointer" title="Conversations">
          <History className="w-4 h-4" />
        </button>
        {session ? (
          <span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold shrink-0 ${PROVIDER_STYLE[session.provider] || ''}`} title={session.model}>{session.providerLabel}</span>
        ) : (
          <select
            value={provider || ''}
            onChange={(e) => setProvider(e.target.value)}
            title="Model for the new conversation"
            className="bg-slate-900 border border-slate-700 text-cyan-300 rounded-lg px-1.5 py-1 text-[11px] font-bold focus:outline-none shrink-0"
          >
            {configuredProviders.map(p => <option key={p.id} value={p.id}>{p.label} · {p.model}</option>)}
          </select>
        )}
        <span className="flex-1 truncate text-slate-300">{session?.title || 'New conversation'}</span>
        {session?.usage && (
          <span className="text-[10px] text-slate-500 shrink-0" title={`${session.usage.input + session.usage.cacheRead} input / ${session.usage.output} output tokens`}>
            {session.usage.costUsd != null ? `$${session.usage.costUsd.toFixed(2)}` : `${Math.round((session.usage.input + session.usage.cacheRead + session.usage.output) / 1000)}k tok`}
          </span>
        )}
        <button onClick={() => setShowSettings(true)} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-300 cursor-pointer" title="AI models & keys">
          <Settings className="w-4 h-4" />
        </button>
        <button onClick={() => { setSession(null); setTranscript([]); setShowHistory(false) }} disabled={runningState} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-300 cursor-pointer disabled:opacity-40" title="New conversation">
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {showHistory && (
        <div className="absolute top-11 left-2 right-2 z-30 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-h-80 overflow-y-auto">
          {sessions.length === 0 && <div className="p-3 text-slate-500">No conversations yet.</div>}
          {sessions.map(s => (
            <div key={s.id} className={`flex items-center gap-2 px-3 py-2 border-b border-slate-800 hover:bg-slate-800 ${session?.id === s.id ? 'bg-slate-800/60' : ''}`}>
              <button onClick={() => openSession(s.id)} className="flex-1 text-left min-w-0 cursor-pointer">
                <div className="truncate text-slate-200"><span className="text-[10px] text-slate-500 mr-1">[{s.providerLabel}]</span>{s.title}</div>
                <div className="text-[10px] text-slate-500">{new Date(s.updatedAt).toLocaleString()} · {s.changedFiles} file(s){s.status === 'running' ? ' · running' : ''}</div>
              </button>
              <button onClick={() => removeSession(s.id)} className="text-slate-600 hover:text-rose-400 cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
      )}

      {/* Transcript */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {transcript.length === 0 && !runningState && (
          <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 space-y-2 leading-relaxed">
            <div className="flex items-center gap-2 text-white font-bold"><Bot className="w-4 h-4 text-cyan-400" /> {(session ? sessionProvider : status?.providers.find(p => p.id === provider))?.label || 'AI agent'} · {projectName}</div>
            <p>Describe what you want changed in this {projectName ? 'project' : 'site'}. The agent reads the code, makes the edits on the server, and checks them with the project's build or tests.</p>
            <p className="text-slate-500">Examples: "Change the hero heading to …", "Add a contact form that emails me", "The login page shows a blank screen — fix it".</p>
            <p className="text-slate-500">You review every changed file and can undo it. Restarting the live app only happens when you press Deploy.</p>
          </div>
        )}

        {transcript.map((ev, i) => {
          if (ev.type === 'user') {
            return <div key={i} className="flex justify-end"><div className="max-w-[90%] p-2.5 rounded-2xl rounded-tr-none bg-gradient-to-r from-cyan-600 to-indigo-600 text-white whitespace-pre-wrap">{ev.text}</div></div>
          }
          if (ev.type === 'assistant') {
            return <div key={i} className="text-slate-200 leading-relaxed break-words">{renderMarkdown(ev.text)}</div>
          }
          if (ev.type === 'thinking') {
            const open = expanded[`t${i}`]
            return (
              <button key={i} onClick={() => setExpanded(x => ({ ...x, [`t${i}`]: !open }))} className="block w-full text-left text-slate-500 italic cursor-pointer">
                <span className="flex items-center gap-1"><Brain className="w-3 h-3" /> Thinking {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}</span>
                {open && <div className="mt-1 pl-4 whitespace-pre-wrap not-italic text-slate-400 text-[11px]">{ev.text}</div>}
              </button>
            )
          }
          if (ev.type === 'tool') {
            const open = expanded[ev.id]
            const Icon = ev.name === 'bash' ? Terminal : ev.summary.startsWith('view') ? Eye : FileCode
            return (
              <div key={i} className={`rounded-lg border ${ev.isError ? 'border-rose-800/60 bg-rose-950/20' : ev.changed ? 'border-emerald-800/50 bg-emerald-950/20' : 'border-slate-800 bg-slate-900/60'}`}>
                <button onClick={() => setExpanded(x => ({ ...x, [ev.id]: !open }))} className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left cursor-pointer">
                  <Icon className={`w-3.5 h-3.5 shrink-0 ${ev.isError ? 'text-rose-400' : ev.changed ? 'text-emerald-400' : 'text-slate-400'}`} />
                  <span className={`flex-1 truncate ${ev.isError ? 'text-rose-300' : 'text-slate-300'}`}>{ev.summary}</span>
                  {open ? <ChevronDown className="w-3 h-3 text-slate-500" /> : <ChevronRight className="w-3 h-3 text-slate-500" />}
                </button>
                {open && <pre className="px-2.5 pb-2 text-[11px] text-slate-400 whitespace-pre-wrap break-all max-h-72 overflow-y-auto">{ev.output}</pre>}
              </div>
            )
          }
          if (ev.type === 'error') {
            return <div key={i} className="p-2.5 rounded-lg bg-rose-950/50 border border-rose-800/50 text-rose-200 flex gap-2"><AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />{ev.text}</div>
          }
          if (ev.type === 'system') {
            return <div key={i} className="p-2.5 rounded-lg bg-emerald-950/40 border border-emerald-800/40 text-emerald-200 whitespace-pre-wrap">{ev.text}</div>
          }
          if (ev.type === 'done') {
            return <div key={i} className="text-[10px] text-slate-600 text-center">— done{ev.changedFiles?.length ? ` · ${ev.changedFiles.length} file(s) changed in this conversation` : ''} —</div>
          }
          return null
        })}

        {liveThinking && <div className="text-slate-500 italic whitespace-pre-wrap text-[11px] flex gap-1.5"><Brain className="w-3 h-3 mt-0.5 shrink-0" />{liveThinking.slice(-400)}</div>}
        {liveText && <div className="text-slate-200 leading-relaxed break-words">{renderMarkdown(liveText)}</div>}
        {activeTool && (
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-cyan-800/50 bg-cyan-950/30 text-cyan-200">
            <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" /> <span className="truncate">{activeTool.summary}</span>
          </div>
        )}
        {runningState && !activeTool && !liveText && !liveThinking && (
          <div className="flex items-center gap-2 text-cyan-400"><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Working…</div>
        )}
      </div>

      {error && (
        <div className="mx-3 mb-2 p-2 rounded-lg bg-rose-950/70 border border-rose-800/50 text-rose-200 flex gap-2">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="cursor-pointer"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* Changes / deploy bar */}
      {changedCount > 0 && !runningState && (
        <div className="mx-3 mb-2 p-2 rounded-xl bg-slate-900 border border-slate-700 flex items-center gap-2">
          <FileCode className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="flex-1 text-slate-300">{changedCount} file{changedCount === 1 ? '' : 's'} changed</span>
          <button onClick={openChanges} className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer">Review</button>
          <button onClick={() => { setDeployMessage(session?.title || ''); setShowDeploy(true) }} className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center gap-1 cursor-pointer"><Rocket className="w-3.5 h-3.5" /> Deploy</button>
        </div>
      )}

      {/* Prompt box */}
      <div className="p-3 border-t border-slate-800 bg-slate-950">
        <div className="relative">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            rows={3}
            disabled={!status}
            placeholder={runningState ? 'The agent is working… (you can stop it)' : 'Describe what to change… (Enter to send, Shift+Enter for a new line)'}
            className="w-full p-3 pr-11 bg-slate-900 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none resize-none"
          />
          {runningState ? (
            <button onClick={stop} title="Stop" className="absolute right-2.5 bottom-3.5 p-2 bg-rose-500 hover:bg-rose-400 text-white rounded-lg cursor-pointer"><Square className="w-4 h-4" /></button>
          ) : (
            <button onClick={send} disabled={!prompt.trim()} title="Send" className="absolute right-2.5 bottom-3.5 p-2 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-slate-950 rounded-lg cursor-pointer"><Send className="w-4 h-4" /></button>
          )}
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-500">
          <span>{session ? `${session.providerLabel} · ${session.model}` : status ? `${status.providers.find(p => p.id === provider)?.label || ''} · ${status.providers.find(p => p.id === provider)?.model || ''}` : 'Connecting…'}</span>
          <span className="truncate max-w-[50%]">{projectPath}</span>
        </div>
      </div>

      {showSettings && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-white/10 rounded-2xl w-full max-w-md max-h-[88vh] flex flex-col">
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
              <span className="text-sm font-bold text-white flex items-center gap-2"><Settings className="w-4 h-4 text-cyan-400" /> AI models & keys</span>
              <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-white cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 overflow-y-auto">{providerSettings()}</div>
          </div>
        </div>
      )}

      {/* Review changes */}
      {showChanges && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-4xl max-h-[88vh] flex flex-col">
            <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
              <span className="text-sm font-bold text-white flex-1">Changes in this conversation</span>
              <button onClick={() => revert(null)} className="px-2.5 py-1.5 rounded-lg bg-rose-950/60 border border-rose-700/40 text-rose-300 flex items-center gap-1 cursor-pointer"><Undo2 className="w-3.5 h-3.5" /> Revert all</button>
              <button onClick={() => setShowChanges(false)} className="text-slate-400 hover:text-white cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {!changes && <div className="text-slate-500 flex items-center gap-2"><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Loading diffs…</div>}
              {changes?.length === 0 && <div className="text-slate-500">No changes.</div>}
              {changes?.map(f => (
                <div key={f.file} className="border border-white/10 rounded-xl overflow-hidden">
                  <div className="px-3 py-2 bg-slate-950 flex items-center gap-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${f.status === 'added' ? 'bg-emerald-500/15 text-emerald-300' : f.status === 'deleted' ? 'bg-rose-500/15 text-rose-300' : 'bg-amber-500/15 text-amber-300'}`}>{f.status}</span>
                    <span className="flex-1 text-slate-200 truncate">{f.file}</span>
                    <button onClick={() => revert(f.file)} className="text-slate-400 hover:text-rose-300 flex items-center gap-1 cursor-pointer"><Undo2 className="w-3.5 h-3.5" /> Revert</button>
                  </div>
                  <div className="p-2 bg-black/30 max-h-96 overflow-y-auto"><DiffView diff={f.diff || '(no difference)'} /></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Deploy confirm */}
      {showDeploy && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-md">
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
              <span className="text-sm font-bold text-white flex items-center gap-2"><Rocket className="w-4 h-4 text-emerald-400" /> Deploy {projectName}</span>
              <button onClick={() => setShowDeploy(false)} className="text-slate-400 hover:text-white cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-3 text-slate-300">
              <p>Restarts this project's server process (PM2) so backend changes go live. Static frontends that Claude already rebuilt are live already.</p>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={deployCommit} onChange={(e) => setDeployCommit(e.target.checked)} />
                <GitCommit className="w-3.5 h-3.5" /> Commit the {changedCount} changed file(s) to git first
              </label>
              {deployCommit && <input value={deployMessage} onChange={(e) => setDeployMessage(e.target.value)} placeholder="Commit message" className="w-full p-2 bg-slate-950 border border-slate-700 rounded-lg text-slate-100" />}
            </div>
            <div className="px-4 py-3 border-t border-white/10 flex justify-end gap-2">
              <button onClick={() => setShowDeploy(false)} className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-200 cursor-pointer">Cancel</button>
              <button onClick={deploy} disabled={deploying} className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50">
                {deploying ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} Deploy now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
