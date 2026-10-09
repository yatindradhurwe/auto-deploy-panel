import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { spawn } from 'child_process'
import { Client } from 'ssh2'

/**
 * One way to operate on a server, whichever server it is.
 *
 * getHost(server) returns an executor with the same API for the panel's own machine (direct
 * process/fs calls) and for any connected server (a pooled SSH connection + SFTP):
 *
 *   exec(script, { cwd, timeout, input, onData })  -> { code, stdout, stderr }   (bash script)
 *   run(cmd, args, opts)                            -> same, arguments safely quoted
 *   readFile(p, { encoding, maxBytes }) / writeFile(p, data, { mode })
 *   stat(p) / lstat(p) / readdir(p) / exists(p) / realpath(p)
 *   mkdir(p) / rm(p) / rename(a, b) / putFile(localPath, remotePath, { onProgress }) / fetchFile(remote, local)
 *
 * Callers never need to know whether the server is local.
 */

export const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`
const PATH_PREFIX = 'export PATH="$PATH:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"; [ -d "$HOME/.nvm/versions/node" ] && export PATH="$PATH:$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node" | tail -n 1)/bin"; '
const PANEL_PUBLIC_IP = process.env.PANEL_PUBLIC_IP || '187.127.165.128'

const httpError = (status, message) => Object.assign(new Error(message), { status })

/** True when the server record describes the machine the panel runs on. */
export function isLocalServer(server) {
  if (!server) return true
  const addr = server.ipAddress || server.hostname
  if (!addr) return true
  if (['localhost', '127.0.0.1', '::1', PANEL_PUBLIC_IP].includes(addr)) return true
  if (addr === os.hostname()) return true
  return Object.values(os.networkInterfaces()).flat().some(i => i && i.address === addr)
}

/** Strips credentials before a server record leaves the backend. */
export function publicServer(server) {
  if (!server) return server
  const secret = /password|sshKey|privateKey|apiToken|apiKey|agentToken|secret/i
  const out = {}
  for (const [k, v] of Object.entries(server)) if (!secret.test(k)) out[k] = v
  out.hasPassword = !!server.password
  out.hasSshKey = !!server.sshKey
  out.isLocal = isLocalServer(server)
  return out
}

// ---------------------------------------------------------------------------------------------
// Local host
// ---------------------------------------------------------------------------------------------

class LocalHost {
  constructor(server) {
    this.isLocal = true
    this.id = server?.id || 'local'
    this.label = server?.name || 'This server'
  }

  exec(script, { cwd, timeout = 120000, input = null, onData = null, env = null, signal = null } = {}) {
    return new Promise((resolve, reject) => {
      // The script goes into a private temp file, so secrets in it never show up in `ps`
      const file = path.join(os.tmpdir(), `.ad-${process.pid}-${crypto.randomBytes(6).toString('hex')}.sh`)
      fs.writeFileSync(file, PATH_PREFIX + script, { mode: 0o600 })
      const child = spawn('bash', [file], { cwd: cwd || undefined, env: env || process.env })
      child.on('close', () => fs.rm(file, { force: true }, () => {}))
      signal?.addEventListener('abort', () => { stderr += '\n[stopped]'; child.kill('SIGKILL') }, { once: true })
      let stdout = ''
      let stderr = ''
      const timer = setTimeout(() => { child.kill('SIGKILL'); stderr += `\n[timed out after ${Math.round(timeout / 1000)}s]` }, timeout)
      child.stdout.on('data', (d) => { const s = d.toString(); if (stdout.length < 20e6) stdout += s; onData?.(s, false) })
      child.stderr.on('data', (d) => { const s = d.toString(); if (stderr.length < 20e6) stderr += s; onData?.(s, true) })
      child.on('error', (e) => { clearTimeout(timer); reject(e) })
      child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? 1, stdout, stderr }) })
      if (input !== null) child.stdin.end(input)
      else child.stdin.end()
    })
  }

  run(cmd, args = [], opts) { return this.exec([cmd, ...args].map(q).join(' '), opts) }

  async readFile(p, { encoding = 'utf8', maxBytes = null } = {}) {
    if (maxBytes) {
      const fh = await fs.promises.open(p, 'r')
      try {
        const buf = Buffer.alloc(maxBytes)
        const { bytesRead } = await fh.read(buf, 0, maxBytes, 0)
        return encoding ? buf.subarray(0, bytesRead).toString(encoding) : buf.subarray(0, bytesRead)
      } finally { await fh.close() }
    }
    return fs.promises.readFile(p, encoding || undefined)
  }

  async writeFile(p, data, { mode } = {}) {
    await fs.promises.writeFile(p, data, mode ? { mode } : undefined)
  }

  async stat(p) {
    try { return toStat(await fs.promises.stat(p)) } catch { return null }
  }

  async lstat(p) {
    try { return toStat(await fs.promises.lstat(p)) } catch { return null }
  }

  async readdir(p) {
    const entries = await fs.promises.readdir(p, { withFileTypes: true })
    const out = []
    for (const e of entries) {
      let isDirectory = e.isDirectory()
      let size = 0
      if (e.isSymbolicLink() || e.isFile()) {
        try { const st = await fs.promises.stat(path.join(p, e.name)); isDirectory = st.isDirectory(); size = st.size } catch { /* dangling */ }
      }
      out.push({ name: e.name, isDirectory, isFile: !isDirectory, isSymbolicLink: e.isSymbolicLink(), size })
    }
    return out
  }

  async exists(p) { return !!(await this.lstat(p)) }
  async realpath(p) { return fs.promises.realpath(p) }
  async mkdir(p) { await fs.promises.mkdir(p, { recursive: true }) }
  async rm(p) { await fs.promises.rm(p, { recursive: true, force: true }) }
  async rename(a, b) { await fs.promises.rename(a, b) }

  async putFile(local, remote, { onProgress } = {}) {
    await fs.promises.copyFile(local, remote)
    onProgress?.(1)
  }

  async fetchFile(remote, local) { await fs.promises.copyFile(remote, local) }
  close() {}
}

function toStat(st) {
  return { isDirectory: st.isDirectory(), isFile: st.isFile(), isSymbolicLink: st.isSymbolicLink?.() || false, size: st.size, mtimeMs: st.mtimeMs, mode: st.mode }
}

// ---------------------------------------------------------------------------------------------
// Remote host over SSH (one pooled connection per server)
// ---------------------------------------------------------------------------------------------

const MAX_CHANNELS = 4 // OpenSSH allows 10 sessions per connection by default; SFTP and aborts need spares

class RemoteHost {
  constructor(server) {
    this.isLocal = false
    this.id = server.id
    this.label = server.name || server.ipAddress
    this.server = server
    this.conn = null
    this.connecting = null
    this.sftpSession = null
    this.active = 0
    this.waiters = []
    this.idleTimer = null
  }

  connectConfig() {
    const s = this.server
    const cfg = {
      host: s.ipAddress || s.hostname,
      port: Number(s.port) && Number(s.port) !== 21 ? Number(s.port) : 22,
      username: s.username || 'root',
      readyTimeout: 15000,
      keepaliveInterval: 20000,
      keepaliveCountMax: 3
    }
    if (s.sshKey) cfg.privateKey = s.sshKey
    if (s.password) cfg.password = s.password
    if (!cfg.privateKey && !cfg.password) throw httpError(400, `No SSH password or key is stored for ${this.label}. Edit the server and add its credentials.`)
    return cfg
  }

  async connect() {
    if (this.conn) return this.conn
    if (this.connecting) return this.connecting
    this.connecting = new Promise((resolve, reject) => {
      const conn = new Client()
      conn.on('ready', () => { this.conn = conn; this.connecting = null; resolve(conn) })
      conn.on('error', (err) => {
        this.connecting = null
        this.drop()
        reject(httpError(502, `Cannot connect to ${this.label}: ${err.level === 'client-authentication' ? 'SSH login was rejected (check the username/password or key)' : err.message}`))
      })
      conn.on('close', () => this.drop())
      try { conn.connect(this.connectConfig()) } catch (e) { this.connecting = null; reject(e) }
    })
    return this.connecting
  }

  drop() {
    if (this.conn) { try { this.conn.end() } catch { /* ignore */ } }
    this.conn = null
    this.sftpSession = null
  }

  touch() {
    clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => this.drop(), 5 * 60 * 1000)
  }

  async channel(fn) {
    if (this.active >= MAX_CHANNELS) await new Promise(r => this.waiters.push(r))
    this.active++
    try {
      for (let attempt = 0; ; attempt++) {
        const conn = await this.connect()
        this.touch()
        try {
          return await fn(conn)
        } catch (err) {
          // The server refused a new session (MaxSessions): wait for one to free up
          if (/Channel open failure/.test(err.message) && attempt < 6) { await new Promise(r => setTimeout(r, 250 * (attempt + 1))); continue }
          throw err
        }
      }
    } finally {
      this.active--
      this.waiters.shift()?.()
    }
  }

  exec(script, { cwd, timeout = 120000, input = null, onData = null, signal = null } = {}) {
    const full = PATH_PREFIX + (cwd ? `cd ${q(cwd)} || exit 1; ` : '') + script
    // The script travels base64-encoded into a private temp file (no quoting through two shells,
    // no secrets in argv) and runs in its own process group so Stop can kill all of it
    const tag = `/tmp/.ad-${crypto.randomBytes(8).toString('hex')}`
    const cmd = `umask 077; F=${tag}; echo ${Buffer.from(full).toString('base64')} | base64 -d > "$F"; setsid bash "$F" <&0 & P=$!; echo $P > "$F.pid"; wait $P; rc=$?; rm -f "$F" "$F.pid"; exit $rc`
    return this.channel((conn) => new Promise((resolve, reject) => {
      conn.exec(cmd, (err, stream) => {
        if (err) return reject(err)
        let stdout = ''
        let stderr = ''
        let settled = false
        const finish = (code) => { if (settled) return; settled = true; clearTimeout(timer); resolve({ code, stdout, stderr }) }
        const kill = (why) => {
          stderr += `\n[${why}]`
          // Kill the whole process group on the server, then stop waiting for it
          conn.exec(`kill -KILL -- -$(cat ${tag}.pid 2>/dev/null) 2>/dev/null; rm -f ${tag} ${tag}.pid`, (e, s2) => { if (!e) s2.on('close', () => {}).resume() })
          try { stream.close() } catch { /* already closed */ }
          finish(137)
        }
        const timer = setTimeout(() => kill(`timed out after ${Math.round(timeout / 1000)}s`), timeout)
        signal?.addEventListener('abort', () => kill('stopped'), { once: true })
        stream.on('data', (d) => { const s = d.toString(); if (stdout.length < 20e6) stdout += s; onData?.(s, false) })
        stream.stderr.on('data', (d) => { const s = d.toString(); if (stderr.length < 20e6) stderr += s; onData?.(s, true) })
        stream.on('close', (code) => finish(code ?? 1))
        if (input !== null) stream.end(input)
        else stream.end()
      })
    }))
  }

  run(cmd, args = [], opts) { return this.exec([cmd, ...args].map(q).join(' '), opts) }

  async sftp() {
    if (this.sftpSession) return this.sftpSession
    const conn = await this.connect()
    this.sftpSession = await new Promise((resolve, reject) => conn.sftp((err, s) => (err ? reject(err) : resolve(s))))
    this.sftpSession.on('close', () => { this.sftpSession = null })
    return this.sftpSession
  }

  async sftpCall(method, ...args) {
    const s = await this.sftp()
    this.touch()
    return new Promise((resolve, reject) => s[method](...args, (err, res) => (err ? reject(err) : resolve(res))))
  }

  async readFile(p, { encoding = 'utf8', maxBytes = null } = {}) {
    if (maxBytes) {
      const { stdout } = await this.exec(`head -c ${Number(maxBytes)} ${q(p)} | base64 -w0`)
      const buf = Buffer.from(stdout, 'base64')
      return encoding ? buf.toString(encoding) : buf
    }
    const buf = await this.sftpCall('readFile', p)
    return encoding ? buf.toString(encoding) : buf
  }

  async writeFile(p, data, { mode } = {}) {
    await this.sftpCall('writeFile', p, data, mode ? { mode } : {})
  }

  async stat(p) {
    try { return sftpStat(await this.sftpCall('stat', p)) } catch { return null }
  }

  async lstat(p) {
    try { return sftpStat(await this.sftpCall('lstat', p)) } catch { return null }
  }

  async readdir(p) {
    const list = await this.sftpCall('readdir', p)
    const out = []
    for (const e of list) {
      let isDirectory = e.attrs.isDirectory()
      let size = e.attrs.size
      const isSymbolicLink = e.attrs.isSymbolicLink()
      if (isSymbolicLink) {
        const st = await this.stat(path.posix.join(p, e.filename))
        if (st) { isDirectory = st.isDirectory; size = st.size }
      }
      out.push({ name: e.filename, isDirectory, isFile: !isDirectory, isSymbolicLink, size })
    }
    return out
  }

  async exists(p) { return !!(await this.lstat(p)) }

  async realpath(p) {
    const { code, stdout } = await this.run('realpath', ['-e', p])
    if (code !== 0) throw httpError(404, `${p} does not exist`)
    return stdout.trim()
  }

  async mkdir(p) { await this.run('mkdir', ['-p', p]) }
  async rm(p) { await this.run('rm', ['-rf', '--', p]) }

  async rename(a, b) {
    const r = await this.run('mv', ['-f', '--', a, b])
    if (r.code !== 0) throw new Error(r.stderr.trim() || 'rename failed')
  }

  async putFile(local, remote, { onProgress } = {}) {
    const s = await this.sftp()
    const size = fs.statSync(local).size || 1
    await new Promise((resolve, reject) => s.fastPut(local, remote, { step: (sent) => onProgress?.(sent / size) }, (err) => (err ? reject(err) : resolve())))
  }

  async fetchFile(remote, local) {
    const s = await this.sftp()
    await new Promise((resolve, reject) => s.fastGet(remote, local, (err) => (err ? reject(err) : resolve())))
  }

  close() { this.drop() }
}

function sftpStat(a) {
  return { isDirectory: a.isDirectory(), isFile: a.isFile(), isSymbolicLink: a.isSymbolicLink(), size: a.size, mtimeMs: (a.mtime || 0) * 1000, mode: a.mode }
}

// ---------------------------------------------------------------------------------------------
// Pool
// ---------------------------------------------------------------------------------------------

const pool = new Map() // server id -> { fingerprint, host }

const fingerprint = (s) => crypto.createHash('sha1').update(JSON.stringify([s.ipAddress, s.hostname, s.port, s.username, s.password, s.sshKey])).digest('hex')

/** Executor for a server record (null/undefined = the panel's own machine). */
export function getHost(server) {
  if (isLocalServer(server)) {
    const key = `local:${server?.id || 'local'}`
    if (!pool.has(key)) pool.set(key, { host: new LocalHost(server) })
    return pool.get(key).host
  }
  const fp = fingerprint(server)
  const cached = pool.get(server.id)
  if (cached && cached.fingerprint === fp) return cached.host
  cached?.host.close()
  const host = new RemoteHost(server)
  pool.set(server.id, { fingerprint: fp, host })
  return host
}

/** Executor for the server selected in the request (X-Server-Id). */
export const hostFor = (req) => getHost(req.tenant?.server || null)

/** Drops a pooled connection (after a server is edited or deleted). */
export function forgetHost(serverId) {
  const cached = pool.get(serverId)
  if (cached) { cached.host.close(); pool.delete(serverId) }
}

/** Opens a throwaway connection with the given credentials and returns basic facts. */
export async function testServerConnection(server) {
  const host = isLocalServer(server) ? new LocalHost(server) : new RemoteHost({ ...server, id: `test-${Date.now()}` })
  try {
    const { code, stdout } = await host.exec('. /etc/os-release 2>/dev/null; echo "$PRETTY_NAME"; uname -m; nproc; command -v node >/dev/null && node -v || echo none; command -v pm2 >/dev/null && echo pm2 || echo nopm2; command -v nginx >/dev/null && echo nginx || echo nonginx', { timeout: 20000 })
    if (code !== 0) throw new Error('The test command failed on the server.')
    const [osName, arch, cores, node, pm2, nginx] = stdout.trim().split('\n')
    return { ok: true, os: `${osName || 'Linux'} (${arch || ''})`.trim(), cores: Number(cores) || null, node: node === 'none' ? null : node, pm2: pm2 === 'pm2', nginx: nginx === 'nginx' }
  } finally {
    host.close()
  }
}
