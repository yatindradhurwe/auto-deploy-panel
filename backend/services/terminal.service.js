import crypto from 'crypto'
import { spawn } from 'child_process'
import { Client } from 'ssh2'
import { WebSocketServer } from 'ws'
import { isLocalServer, connectConfigFor, q } from './host.service.js'
import { recordAuditLog } from './db.service.js'

/**
 * Interactive SSH consoles (xterm.js in the browser ⇄ WebSocket ⇄ a real PTY shell).
 *
 *  1. POST /api/studio/terminal/session (normal auth + studio access checks) issues a one-time ticket
 *     bound to the user, the server and the start folder.
 *  2. The browser opens /api/studio/terminal/ws?ticket=… — browsers can't send headers on a WebSocket,
 *     so the ticket stands in for the JWT. It is single use and expires after 30 seconds.
 *
 * The panel's own machine gets a PTY from a small Python helper (no native Node modules); other
 * servers get a dedicated SSH connection with a PTY, so pooled command connections are never shared.
 *
 * Wire format: browser → server JSON text frames { type: 'input', data } | { type: 'resize', cols, rows };
 * server → browser binary frames are terminal output, text frames are JSON { type: 'ready'|'exit'|'error' }.
 */

const WS_PATH = '/api/studio/terminal/ws'
const TICKET_TTL_MS = 30 * 1000
const MAX_PER_USER = 8
const PING_MS = 25 * 1000

const tickets = new Map() // ticket -> { userId, orgId, server, cwd, label, expires }
const openByUser = new Map() // userId -> count

/** Issues a one-time ticket for a console on `server` (null = the panel's own machine) starting in `cwd`. */
export function issueTerminalTicket({ userId, orgId = null, server = null, cwd = '', label = '' }) {
  const now = Date.now()
  for (const [t, v] of tickets) if (v.expires < now) tickets.delete(t)
  if ((openByUser.get(userId) || 0) >= MAX_PER_USER) {
    throw Object.assign(new Error(`You already have ${MAX_PER_USER} consoles open. Close one first.`), { status: 429 })
  }
  const ticket = crypto.randomBytes(32).toString('base64url')
  tickets.set(ticket, { userId, orgId, server, cwd, label, expires: now + TICKET_TTL_MS })
  return { ticket, expiresIn: TICKET_TTL_MS / 1000 }
}

function takeTicket(ticket) {
  const t = tickets.get(ticket)
  tickets.delete(ticket)
  return t && t.expires >= Date.now() ? t : null
}

// PTY for the local machine: forks a login shell on a pseudo-terminal. Terminal bytes travel on
// stdin/stdout; window size changes arrive as "cols rows" lines on fd 3.
const PTY_HELPER = String.raw`
import os, pty, sys, select, fcntl, termios, struct, signal
cwd, shell = sys.argv[1], sys.argv[2]
pid, fd = pty.fork()
if pid == 0:
    try: os.chdir(cwd)
    except Exception: pass
    os.environ['TERM'] = 'xterm-256color'
    os.environ['COLORTERM'] = 'truecolor'
    os.execvp(shell, [shell, '-l'])
def resize(cols, rows):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
    try: os.kill(pid, signal.SIGWINCH)
    except Exception: pass
ctl, buf, inputs = 3, b'', [0, 3]
while True:
    try: r, _, _ = select.select([fd] + inputs, [], [])
    except InterruptedError: continue
    if fd in r:
        try: data = os.read(fd, 65536)
        except OSError: data = b''
        if not data: break
        os.write(1, data)
    if 0 in r:
        data = os.read(0, 65536)
        if not data: break
        os.write(fd, data)
    if ctl in r:
        data = os.read(ctl, 1024)
        if not data: inputs.remove(ctl); continue
        buf += data
        while b'\n' in buf:
            line, buf = buf.split(b'\n', 1)
            try:
                c, w = line.split()
                resize(int(c), int(w))
            except Exception: pass
try: os.kill(pid, signal.SIGHUP)
except Exception: pass
_, status = os.waitpid(pid, 0)
sys.exit(os.waitstatus_to_exitcode(status) if hasattr(os, 'waitstatus_to_exitcode') else 0)
`

function openLocalPty({ cwd, cols, rows }) {
  const shell = process.env.SHELL && process.env.SHELL !== '/bin/sh' ? process.env.SHELL : '/bin/bash'
  const child = spawn('python3', ['-c', PTY_HELPER, cwd || process.env.HOME || '/root', shell], {
    stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    env: { ...process.env, HOME: process.env.HOME || '/root' }
  })
  const pty = {
    write: (d) => child.stdin.writable && child.stdin.write(d),
    resize: (c, r) => child.stdio[3].writable && child.stdio[3].write(`${c} ${r}\n`),
    close: () => { try { child.stdin.end() } catch { /* gone */ } setTimeout(() => child.kill('SIGKILL'), 2000).unref() },
    onData: (fn) => { child.stdout.on('data', fn); child.stderr.on('data', fn) },
    onExit: (fn) => child.on('close', (code) => fn(code))
  }
  pty.resize(cols, rows)
  return Promise.resolve(pty)
}

function openRemotePty(server, { cwd, cols, rows }) {
  return new Promise((resolve, reject) => {
    const conn = new Client()
    const fail = (err) => { try { conn.end() } catch { /* ignore */ } reject(err) }
    conn.on('error', (err) => fail(new Error(err.level === 'client-authentication' ? 'SSH login was rejected (check the server\'s username/password or key).' : err.message)))
    conn.on('ready', () => {
      const start = `${cwd ? `cd ${q(cwd)} 2>/dev/null || echo "Folder not found: ${cwd.replace(/["$`\\]/g, '')}"; ` : ''}exec "\${SHELL:-/bin/bash}" -l`
      conn.exec(start, { pty: { term: 'xterm-256color', cols, rows } }, (err, stream) => {
        if (err) return fail(err)
        resolve({
          write: (d) => stream.writable && stream.write(d),
          resize: (c, r) => stream.setWindow(r, c, 0, 0),
          close: () => { try { stream.close() } catch { /* gone */ } conn.end() },
          onData: (fn) => { stream.on('data', fn); stream.stderr.on('data', fn) },
          onExit: (fn) => { let code = null; stream.on('exit', (c) => { code = c }); stream.on('close', () => { conn.end(); fn(code) }) }
        })
      })
    })
    try { conn.connect({ ...connectConfigFor(server), keepaliveInterval: 15000, keepaliveCountMax: 4 }) } catch (e) { reject(e) }
  })
}

const clampSize = (v, def, max) => Math.min(max, Math.max(2, Number(v) || def))

/** Handles WebSocket upgrades for the console on the panel's HTTP server. */
export function attachTerminalServer(httpServer) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 })

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname !== WS_PATH) return
    const session = takeTicket(url.searchParams.get('ticket') || '')
    if (!session) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nContent-Type: text/plain\r\n\r\nConsole ticket is missing or expired.')
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => runConsole(ws, session, url, req))
  })
}

async function runConsole(ws, session, url, req) {
  const { userId, orgId, server, cwd, label } = session
  const cols = clampSize(url.searchParams.get('cols'), 120, 500)
  const rows = clampSize(url.searchParams.get('rows'), 32, 300)
  const sendJson = (o) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(o))
  openByUser.set(userId, (openByUser.get(userId) || 0) + 1)

  let pty = null
  let closed = false
  const cleanup = () => {
    if (closed) return
    closed = true
    clearInterval(ping)
    openByUser.set(userId, Math.max(0, (openByUser.get(userId) || 1) - 1))
    pty?.close()
  }
  const ping = setInterval(() => { if (ws.readyState === ws.OPEN) ws.ping() }, PING_MS)
  ws.on('close', cleanup)
  ws.on('error', cleanup)

  // Keystrokes typed before the shell is up are replayed once it is
  const early = []
  ws.on('message', (raw, isBinary) => {
    let msg
    try { msg = isBinary ? { type: 'input', data: raw.toString('utf8') } : JSON.parse(raw.toString('utf8')) } catch { return }
    if (msg.type === 'input' && typeof msg.data === 'string') pty ? pty.write(msg.data) : early.push(msg.data)
    else if (msg.type === 'resize' && pty) pty.resize(clampSize(msg.cols, cols, 500), clampSize(msg.rows, rows, 300))
  })

  try {
    pty = isLocalServer(server) ? await openLocalPty({ cwd, cols, rows }) : await openRemotePty(server, { cwd, cols, rows })
  } catch (err) {
    sendJson({ type: 'error', message: `Could not open the console: ${err.message}` })
    ws.close(1011, 'console failed')
    cleanup()
    return
  }
  if (closed) { pty.close(); return }

  pty.onData((chunk) => { if (ws.readyState === ws.OPEN) ws.send(chunk, { binary: true }) })
  pty.onExit((code) => {
    sendJson({ type: 'exit', code })
    if (ws.readyState === ws.OPEN) ws.close(1000, 'shell exited')
    cleanup()
  })
  for (const d of early.splice(0)) pty.write(d)
  sendJson({ type: 'ready', server: server?.name || 'This server', cwd })

  try {
    recordAuditLog({
      organizationId: orgId,
      userId,
      action: 'TERMINAL_OPENED',
      resourceType: 'server',
      resourceId: server?.id || 'local',
      ip: req.headers['x-real-ip'] || req.socket.remoteAddress,
      details: { server: server?.name || 'This server', cwd, label }
    })
  } catch { /* audit is best effort */ }
}
