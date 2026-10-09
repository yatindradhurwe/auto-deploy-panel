import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import zlib from 'zlib'
import { execFile } from 'child_process'
import { fileURLToPath } from 'url'
import { analyzeLocalDir } from './detector.service.js'

/**
 * Chunked uploads for 1-click deploy (project source archives and database files), plus
 * stack analysis of GitHub repositories via a shallow clone.
 * Chunks keep each request under the nginx body limit and let a dropped upload resume.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UPLOAD_ROOT = path.resolve(__dirname, '../data/uploads')
export const CHUNK_SIZE = 8 * 1024 * 1024
const MAX_SIZE = 2 * 1024 * 1024 * 1024
const RETENTION_MS = 24 * 60 * 60 * 1000

const KINDS = {
  source: { exts: ['.zip', '.tar.gz', '.tgz', '.tar'], label: 'project archive (.zip, .tar.gz, .tgz, .tar)' },
  database: { exts: ['.sql', '.sql.gz', '.dump', '.sqlite', '.sqlite3', '.db'], label: 'database file (.sql, .sql.gz, .dump, .sqlite, .db)' }
}

const httpError = (status, message) => Object.assign(new Error(message), { status })

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 300000, maxBuffer: 16 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message).trim().split('\n').slice(-5).join('\n')))
      resolve(stdout)
    })
  })
}

const extOf = (name) => {
  const lower = name.toLowerCase()
  return ['.tar.gz', '.sql.gz'].find(e => lower.endsWith(e)) || path.extname(lower)
}

const uploadDir = (id) => path.join(UPLOAD_ROOT, id)
const metaFile = (id) => path.join(uploadDir(id), 'meta.json')

function readMeta(id) {
  if (!/^upl_[a-f0-9]{20}$/.test(String(id || ''))) throw httpError(400, 'Invalid upload id.')
  try { return JSON.parse(fs.readFileSync(metaFile(id), 'utf8')) } catch { throw httpError(404, 'Upload not found or expired — upload the file again.') }
}

const writeMeta = (meta) => fs.writeFileSync(metaFile(meta.id), JSON.stringify(meta))

export function cleanupOldUploads() {
  let entries = []
  try { entries = fs.readdirSync(UPLOAD_ROOT) } catch { return }
  for (const e of entries) {
    const p = path.join(UPLOAD_ROOT, e)
    try {
      if (Date.now() - fs.statSync(p).mtimeMs > RETENTION_MS) fs.rmSync(p, { recursive: true, force: true })
    } catch { /* ignore */ }
  }
}

export function initUpload({ kind, name, size }, userId) {
  const k = KINDS[kind]
  if (!k) throw httpError(400, 'kind must be "source" or "database".')
  name = path.basename(String(name || '')).replace(/[^\w.\- ]/g, '_')
  const ext = extOf(name)
  if (!k.exts.includes(ext)) throw httpError(400, `Unsupported file type. Upload a ${k.label}.`)
  size = Number(size)
  if (!Number.isFinite(size) || size <= 0) throw httpError(400, 'File is empty.')
  if (size > MAX_SIZE) throw httpError(413, 'File is larger than 2 GB.')
  cleanupOldUploads()

  const id = `upl_${crypto.randomBytes(10).toString('hex')}`
  fs.mkdirSync(uploadDir(id), { recursive: true, mode: 0o700 })
  const meta = { id, kind, name, ext, size, received: 0, ownerUserId: userId, status: 'uploading', createdAt: new Date().toISOString() }
  writeMeta(meta)
  return { uploadId: id, chunkSize: CHUNK_SIZE }
}

/** Appends one chunk read from the request stream. `offset` must equal the bytes received so far. */
export function appendChunk(id, offset, req, userId) {
  const meta = readMeta(id)
  if (meta.ownerUserId !== userId) throw httpError(404, 'Upload not found.')
  if (meta.status !== 'uploading') throw httpError(409, 'Upload already completed.')
  offset = Number(offset)
  if (offset !== meta.received) throw Object.assign(httpError(409, `Expected offset ${meta.received}.`), { expectedOffset: meta.received })

  const file = path.join(uploadDir(id), `file${meta.ext}`)
  return new Promise((resolve, reject) => {
    let bytes = 0
    const out = fs.createWriteStream(file, { flags: 'a' })
    req.on('data', (chunk) => {
      bytes += chunk.length
      if (bytes > CHUNK_SIZE + 1024 || meta.received + bytes > meta.size) {
        req.destroy()
        out.destroy()
        reject(httpError(413, 'Chunk exceeds the declared file size.'))
      }
    })
    req.pipe(out)
    out.on('finish', () => {
      // Re-sync from disk so a half-written chunk is never counted
      meta.received = fs.statSync(file).size
      writeMeta(meta)
      resolve({ received: meta.received, size: meta.size })
    })
    out.on('error', reject)
    req.on('error', reject)
  })
}

/** Keeps only symlinks that point inside `root` — an archive must not reach outside its folder. */
function removeEscapingSymlinks(root) {
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isSymbolicLink()) {
        let target = null
        try { target = fs.realpathSync(p) } catch { /* dangling */ }
        if (!target || !(target === root || target.startsWith(root + path.sep))) fs.rmSync(p, { force: true })
      } else if (e.isDirectory()) {
        walk(p)
      }
    }
  }
  walk(root)
}

/** If the archive wrapped everything in one folder (my-app/…), use that folder as the root. */
function projectRoot(extracted) {
  let dir = extracted
  for (let i = 0; i < 2; i++) {
    const entries = fs.readdirSync(dir).filter(n => n !== '__MACOSX' && n !== '.DS_Store')
    if (entries.length === 1 && fs.statSync(path.join(dir, entries[0])).isDirectory()) dir = path.join(dir, entries[0])
    else break
  }
  return dir
}

async function extractArchive(file, ext, dest) {
  fs.mkdirSync(dest, { recursive: true })
  if (ext === '.zip') {
    // unzip refuses absolute paths and strips ../ components
    await run('unzip', ['-q', '-o', file, '-d', dest])
  } else {
    // GNU tar strips leading / and refuses members containing ..
    await run('tar', [ext === '.tar' ? '-xf' : '-xzf', file, '-C', dest, '--no-same-owner', '--no-same-permissions'])
  }
  const real = fs.realpathSync(dest)
  removeEscapingSymlinks(real)
  return projectRoot(real)
}

/** Detects which engine a dump belongs to from its first bytes. */
function sniffDatabase(file, ext) {
  if (['.sqlite', '.sqlite3', '.db'].includes(ext)) {
    const head = Buffer.alloc(16)
    const fd = fs.openSync(file, 'r')
    fs.readSync(fd, head, 0, 16, 0)
    fs.closeSync(fd)
    if (!head.toString('latin1').startsWith('SQLite format 3')) throw httpError(400, 'This .db/.sqlite file is not an SQLite database.')
    return { engine: 'sqlite', format: 'sqlite' }
  }
  if (ext === '.dump') {
    const head = Buffer.alloc(5)
    const fd = fs.openSync(file, 'r')
    fs.readSync(fd, head, 0, 5, 0)
    fs.closeSync(fd)
    if (head.toString('latin1') === 'PGDMP') return { engine: 'postgresql', format: 'pg_custom' }
  }
  let text = ''
  const fd = fs.openSync(file, 'r')
  const buf = Buffer.alloc(256 * 1024)
  const n = fs.readSync(fd, buf, 0, buf.length, 0)
  fs.closeSync(fd)
  if (ext === '.sql.gz') {
    try { text = zlib.gunzipSync(buf.subarray(0, n), { finishFlush: zlib.constants.Z_SYNC_FLUSH }).toString('utf8') } catch { throw httpError(400, 'Could not read the gzip file.') }
  } else {
    text = buf.subarray(0, n).toString('utf8')
  }
  if (/PostgreSQL database dump|SET statement_timeout|pg_catalog\.|CREATE EXTENSION|::regclass|OWNER TO/i.test(text)) return { engine: 'postgresql', format: 'sql' }
  if (/MySQL dump|MariaDB dump|ENGINE=|AUTO_INCREMENT|\/\*!40\d{3}|`\w+`\s+(int|varchar|text)/i.test(text)) return { engine: 'mysql', format: 'sql' }
  if (/^\s*(CREATE TABLE|INSERT INTO)/im.test(text)) return { engine: null, format: 'sql' }
  throw httpError(400, 'This file does not look like an SQL dump.')
}

export async function completeUpload(id, userId) {
  const meta = readMeta(id)
  if (meta.ownerUserId !== userId) throw httpError(404, 'Upload not found.')
  if (meta.received !== meta.size) throw httpError(400, `Upload incomplete (${meta.received} of ${meta.size} bytes).`)
  const file = path.join(uploadDir(id), `file${meta.ext}`)

  if (meta.kind === 'source') {
    let root
    try {
      root = await extractArchive(file, meta.ext, path.join(uploadDir(id), 'extracted'))
    } catch (err) {
      throw httpError(400, `Could not extract the archive: ${err.message}`)
    }
    const analysis = analyzeLocalDir(root)
    Object.assign(meta, { status: 'ready', root, analysis })
    writeMeta(meta)
    return { uploadId: id, name: meta.name, size: meta.size, analysis }
  }

  const db = sniffDatabase(file, meta.ext)
  Object.assign(meta, { status: 'ready', database: db })
  writeMeta(meta)
  return { uploadId: id, name: meta.name, size: meta.size, ...db }
}

/** For the deploy pipeline: archive path + metadata of a completed upload owned by the user. */
export function getReadyUpload(id, userId, kind) {
  const meta = readMeta(id)
  if (meta.ownerUserId !== userId || meta.kind !== kind) throw httpError(404, 'Upload not found.')
  if (meta.status !== 'ready') throw httpError(400, 'Upload is not finished.')
  return { ...meta, file: path.join(uploadDir(id), `file${meta.ext}`) }
}

// ---------------------------------------------------------------------------------------------
// GitHub / Git analysis
// ---------------------------------------------------------------------------------------------

export function validateGitUrl(url) {
  url = String(url || '').trim()
  if (!/^(https:\/\/[A-Za-z0-9.-]+(:\d+)?\/[^\s'"`$;|&<>\\]+|git@[A-Za-z0-9.-]+:[^\s'"`$;|&<>\\]+)$/.test(url)) {
    throw httpError(400, 'Enter an https:// Git URL (e.g. https://github.com/user/repo.git) or git@github.com:user/repo.git.')
  }
  return url
}

/** Adds the saved GitHub token to a github.com https URL that has no credentials. */
export function withGithubToken(url, token) {
  if (!token || !/^https:\/\/github\.com\//i.test(url)) return url
  return url.replace(/^https:\/\/github\.com\//i, `https://x-access-token:${encodeURIComponent(token)}@github.com/`)
}

export const redactUrl = (text) => String(text).replace(/(https:\/\/)[^@\s/]+@/g, '$1***@')

export async function analyzeGitRepo({ gitUrl, branch, token }) {
  const url = withGithubToken(validateGitUrl(gitUrl), token)
  if (branch && !/^[A-Za-z0-9._\/-]{1,100}$/.test(branch)) throw httpError(400, 'Invalid branch name.')
  const dir = path.join(UPLOAD_ROOT, `git_${crypto.randomBytes(8).toString('hex')}`)
  fs.mkdirSync(UPLOAD_ROOT, { recursive: true })
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'true' }
  const base = ['-c', 'protocol.ext.allow=never', '-c', 'protocol.file.allow=never', 'clone', '--depth', '1', '--single-branch']
  try {
    try {
      await run('git', [...base, ...(branch ? ['--branch', branch] : []), '--', url, dir], { env, timeout: 120000 })
    } catch (err) {
      if (!branch) throw err
      // Branch not found: fall back to the default branch and say so
      fs.rmSync(dir, { recursive: true, force: true })
      await run('git', [...base, '--', url, dir], { env, timeout: 120000 })
    }
    const actualBranch = (await run('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'])).trim()
    const analysis = analyzeLocalDir(dir)
    return { analysis, branch: actualBranch, requestedBranchMissing: !!branch && branch !== actualBranch }
  } catch (err) {
    const msg = redactUrl(err.message)
    if (/Authentication failed|could not read Username|Repository not found|403/i.test(msg)) {
      throw httpError(400, 'Could not access this repository. If it is private, connect your GitHub token first.')
    }
    throw httpError(400, `Could not clone the repository: ${msg}`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
