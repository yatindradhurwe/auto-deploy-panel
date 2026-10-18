import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { TerminalSquare, Plus, X, RefreshCw, Maximize2, Minimize2, Eraser, ZoomIn, ZoomOut } from 'lucide-react'
import { useAuth } from '../store/AuthContext'

/**
 * Interactive SSH console (xterm.js ⇄ WebSocket ⇄ PTY shell on the server, see backend terminal.service).
 * Every command works as in a normal SSH session: cd, vim/nano, top/htop, prompts, Ctrl+C, colors.
 *
 *  - projectPath: start in this project folder (project console); omit for a server-wide console
 *  - serverId: server to open on (defaults to the server selected in the panel)
 * Tabs stay connected while you switch between them; Ctrl+Shift+C / Ctrl+Shift+V copy and paste.
 */

const THEME = {
  background: '#0b1020',
  foreground: '#e2e8f0',
  cursor: '#34d399',
  cursorAccent: '#0b1020',
  selectionBackground: '#334155',
  black: '#1e293b', red: '#f87171', green: '#34d399', yellow: '#fbbf24', blue: '#60a5fa', magenta: '#c084fc', cyan: '#22d3ee', white: '#e2e8f0',
  brightBlack: '#64748b', brightRed: '#fca5a5', brightGreen: '#6ee7b7', brightYellow: '#fde68a', brightBlue: '#93c5fd', brightMagenta: '#d8b4fe', brightCyan: '#67e8f9', brightWhite: '#f8fafc'
}
const FONT_KEY = 'autodeploy_console_font'
const readFontSize = () => { try { return Number(localStorage.getItem(FONT_KEY)) || 13 } catch { return 13 } }

const STATUS = {
  connecting: { label: 'Connecting…', dot: 'bg-amber-400 animate-pulse' },
  connected: { label: 'Connected', dot: 'bg-emerald-400' },
  closed: { label: 'Disconnected', dot: 'bg-slate-500' },
  error: { label: 'Failed', dot: 'bg-rose-500' }
}

function TerminalPane({ active, projectPath, serverId, fontSize, onStatus, onInfo, controlRef }) {
  const { token } = useAuth()
  const hostRef = useRef(null)
  const termRef = useRef(null)
  const fitRef = useRef(null)
  const wsRef = useRef(null)
  const statusRef = useRef('connecting')

  const setStatus = useCallback((s) => { statusRef.current = s; onStatus(s) }, [onStatus])

  const send = (msg) => { const ws = wsRef.current; if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)) }

  const connect = useCallback(async () => {
    const term = termRef.current
    if (!term) return
    wsRef.current?.close()
    setStatus('connecting')
    try {
      fitRef.current?.fit()
      const res = await fetch('/api/studio/terminal/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(serverId ? { 'X-Server-Id': serverId } : {}) },
        body: JSON.stringify({ projectPath: projectPath || undefined, ...(serverId ? { serverId } : {}) })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ticket) throw new Error(data.error || `Request failed (${res.status})`)
      onInfo({ server: data.server, cwd: data.cwd })

      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${proto}://${window.location.host}/api/studio/terminal/ws?ticket=${encodeURIComponent(data.ticket)}&cols=${term.cols}&rows=${term.rows}`)
      ws.binaryType = 'arraybuffer'
      wsRef.current = ws
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return term.write(new Uint8Array(ev.data))
        let msg
        try { msg = JSON.parse(ev.data) } catch { return }
        if (msg.type === 'ready') { setStatus('connected'); term.focus() }
        else if (msg.type === 'error') { term.write(`\r\n\x1b[31m${msg.message}\x1b[0m\r\n`); setStatus('error') }
        else if (msg.type === 'exit') term.write(`\r\n\x1b[90m[shell exited${msg.code != null ? ` with code ${msg.code}` : ''}]\x1b[0m`)
      }
      ws.onclose = () => {
        if (wsRef.current !== ws) return
        if (statusRef.current !== 'error') setStatus('closed')
        term.write('\r\n\x1b[90mConnection closed. Press Enter to reconnect.\x1b[0m\r\n')
      }
    } catch (err) {
      term.write(`\r\n\x1b[31mCould not open the console: ${err.message}\x1b[0m\r\n\x1b[90mPress Enter to retry.\x1b[0m\r\n`)
      setStatus('error')
    }
  }, [token, projectPath, serverId, setStatus, onInfo])

  useEffect(() => {
    const term = new XTerm({
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", "Fira Code", Menlo, Consolas, "DejaVu Sans Mono", monospace',
      fontSize,
      scrollback: 10000,
      theme: THEME,
      allowProposedApi: true,
      macOptionIsMeta: true
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(hostRef.current)
    termRef.current = term
    fitRef.current = fit

    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || !e.ctrlKey || !e.shiftKey) return true
      if (e.code === 'KeyC') { const sel = term.getSelection(); if (sel) navigator.clipboard?.writeText(sel).catch(() => {}); return false }
      if (e.code === 'KeyV') { navigator.clipboard?.readText().then((t) => t && send({ type: 'input', data: t })).catch(() => {}); return false }
      return true
    })
    const dataSub = term.onData((d) => {
      if (statusRef.current === 'closed' || statusRef.current === 'error') { if (d === '\r') connect(); return }
      send({ type: 'input', data: d })
    })
    const resizeSub = term.onResize(({ cols, rows }) => send({ type: 'resize', cols, rows }))

    const ro = new ResizeObserver(() => { if (hostRef.current?.offsetParent) { try { fit.fit() } catch { /* hidden */ } } })
    ro.observe(hostRef.current)
    connect()

    return () => {
      ro.disconnect()
      dataSub.dispose()
      resizeSub.dispose()
      const ws = wsRef.current
      wsRef.current = null
      ws?.close()
      term.dispose()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.fontSize = fontSize
    try { fitRef.current?.fit() } catch { /* hidden */ }
  }, [fontSize])

  useEffect(() => {
    if (!active) return
    const id = requestAnimationFrame(() => { try { fitRef.current?.fit() } catch { /* hidden */ } termRef.current?.focus() })
    return () => cancelAnimationFrame(id)
  }, [active])

  // Toolbar actions for the visible tab
  useEffect(() => {
    if (active) controlRef.current = { reconnect: connect, clear: () => termRef.current?.clear() }
  }, [active, connect, controlRef])

  return <div ref={hostRef} className={`absolute inset-0 p-2 ${active ? '' : 'invisible pointer-events-none'}`} />
}

export default function SshConsole({ projectPath = '', serverId = '', title = 'SSH Console', className = '' }) {
  const nextId = useRef(2)
  const [tabs, setTabs] = useState([{ id: 1, status: 'connecting', info: null }])
  const [activeId, setActiveId] = useState(1)
  const [fullscreen, setFullscreen] = useState(false)
  const [fontSize, setFontSize] = useState(readFontSize)
  const controlRef = useRef({})

  const patchTab = useCallback((id, patch) => setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t))), [])
  const addTab = () => { const id = nextId.current++; setTabs((ts) => [...ts, { id, status: 'connecting', info: null }]); setActiveId(id) }
  const closeTab = (id) => setTabs((ts) => {
    const rest = ts.filter((t) => t.id !== id)
    if (!rest.length) { const nid = nextId.current++; setActiveId(nid); return [{ id: nid, status: 'connecting', info: null }] }
    if (id === activeId) setActiveId(rest[rest.length - 1].id)
    return rest
  })
  const zoom = (d) => setFontSize((s) => {
    const n = Math.min(24, Math.max(9, s + d))
    try { localStorage.setItem(FONT_KEY, String(n)) } catch { /* private mode */ }
    return n
  })

  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e) => { if (e.key === 'Escape' && e.shiftKey) setFullscreen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen])

  const current = tabs.find((t) => t.id === activeId) || tabs[0]
  const st = STATUS[current?.status] || STATUS.connecting
  const btn = 'h-7 w-7 rounded-lg inline-flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 cursor-pointer transition'

  return (
    <div className={`${fullscreen ? 'fixed inset-0 z-[60] rounded-none' : `relative rounded-2xl ${className}`} flex flex-col overflow-hidden border border-white/10 bg-[#0b1020] shadow-2xl`}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10 bg-slate-950/80">
        <TerminalSquare className="w-4 h-4 text-emerald-400 shrink-0" />
        <span className="text-xs font-bold text-white whitespace-nowrap">{title}</span>
        <span className="hidden md:inline text-[11px] font-mono text-slate-500 truncate min-w-0">
          {current?.info ? `${current.info.server}${current.info.cwd ? ` : ${current.info.cwd}` : ''}` : ''}
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-slate-400 ml-auto whitespace-nowrap">
          <span className={`w-2 h-2 rounded-full ${st.dot}`} />{st.label}
        </span>
        <div className="flex items-center gap-0.5 shrink-0">
          <button onClick={() => zoom(-1)} title="Smaller text" className={btn}><ZoomOut className="w-3.5 h-3.5" /></button>
          <button onClick={() => zoom(1)} title="Larger text" className={btn}><ZoomIn className="w-3.5 h-3.5" /></button>
          <button onClick={() => controlRef.current.clear?.()} title="Clear screen" className={btn}><Eraser className="w-3.5 h-3.5" /></button>
          <button onClick={() => controlRef.current.reconnect?.()} title="Reconnect" className={btn}><RefreshCw className="w-3.5 h-3.5" /></button>
          <button onClick={() => setFullscreen((f) => !f)} title={fullscreen ? 'Exit full screen (Shift+Esc)' : 'Full screen'} className={btn}>
            {fullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1 px-2 pt-1.5 bg-slate-950/60 overflow-x-auto">
        {tabs.map((t, i) => (
          <div
            key={t.id}
            onClick={() => setActiveId(t.id)}
            className={`group flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-t-lg text-[11px] font-mono cursor-pointer whitespace-nowrap border border-b-0 ${t.id === activeId ? 'bg-[#0b1020] text-emerald-200 border-white/10' : 'text-slate-500 border-transparent hover:text-slate-300'}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${(STATUS[t.status] || STATUS.connecting).dot}`} />
            <span>{projectPath ? 'project' : 'shell'} {i + 1}</span>
            <button onClick={(e) => { e.stopPropagation(); closeTab(t.id) }} title="Close tab" className="p-0.5 rounded hover:bg-white/10 hover:text-rose-300 cursor-pointer">
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
        <button onClick={addTab} title="New tab" className="p-1 rounded-md text-slate-500 hover:text-white hover:bg-white/10 cursor-pointer">
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="relative flex-1 min-h-[320px]">
        {tabs.map((t) => (
          <TerminalPane
            key={t.id}
            active={t.id === activeId}
            projectPath={projectPath}
            serverId={serverId}
            fontSize={fontSize}
            controlRef={controlRef}
            onStatus={(status) => patchTab(t.id, { status })}
            onInfo={(info) => patchTab(t.id, { info })}
          />
        ))}
      </div>
    </div>
  )
}
