#!/usr/bin/env node
/**
 * Supabase Storage-compatible API for one app (the subset supabase-js uses), installed by the panel
 * with the app's local Supabase stack. Files live on disk under STORAGE_DIR/<bucket>/<object name>;
 * their rows live in the app database's storage.buckets / storage.objects tables, and every request
 * runs as the caller's role (anon, authenticated, service_role from the JWT), so the row level
 * security policies copied from Supabase decide who may read, upload or delete.
 *
 *   node storage-server.mjs           serve on 127.0.0.1:$PORT
 *   node storage-server.mjs --sync    register files already on disk that have no row yet
 *
 * Environment: PORT, DATABASE_URL (the app's authenticator login), JWT_SECRET, STORAGE_DIR,
 * FILE_SIZE_LIMIT (bytes), BUCKETS_FILE (optional JSON [{ name, public }] used by --sync).
 */
import http from 'http'
import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import { Transform } from 'stream'
import { pipeline } from 'stream/promises'
import pg from 'pg'
import busboy from 'busboy'

const PORT = Number(process.env.PORT) || 5000
const JWT_SECRET = process.env.JWT_SECRET || ''
const ROOT = path.resolve(process.env.STORAGE_DIR || '/var/lib/autodeploy-storage/app')
const FILE_SIZE_LIMIT = Number(process.env.FILE_SIZE_LIMIT) || 50 * 1024 * 1024
const ROLE_RE = /^[a-z_][a-z0-9_]{0,62}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BUCKET_RE = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,99}$/

if (!JWT_SECRET) { console.error('JWT_SECRET is not set'); process.exit(1) }
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4, idleTimeoutMillis: 30000 })
pool.on('error', (e) => console.error('database:', e.message))

class ApiError extends Error {
  constructor(status, error, message) { super(message); this.status = status; this.error = error }
}
const notFound = (what = 'Object') => new ApiError(404, 'not_found', `${what} not found`)

// ------------------------------------------------------------------ JWT (HS256, the project's secret)
function verifyJwt(token) {
  const parts = String(token || '').split('.')
  if (parts.length !== 3) return null
  try {
    if (JSON.parse(Buffer.from(parts[0], 'base64url')).alg !== 'HS256') return null
    const want = crypto.createHmac('sha256', JWT_SECRET).update(`${parts[0]}.${parts[1]}`).digest()
    const got = Buffer.from(parts[2], 'base64url')
    if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url'))
    if (claims.exp && Date.now() / 1000 > claims.exp) return null
    return claims
  } catch { return null }
}

function signJwt(claims) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const body = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(claims)}`
  return `${body}.${crypto.createHmac('sha256', JWT_SECRET).update(body).digest('base64url')}`
}

/** The caller's claims: Authorization: Bearer <jwt>, else an apikey header that is a JWT. Null = no credentials. */
function callerClaims(req) {
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')?.[1]
  const token = bearer || req.headers.apikey
  if (!token) return null
  const claims = verifyJwt(token)
  if (!claims) throw new ApiError(403, 'Unauthorized', 'invalid signature')
  return claims
}

const requireClaims = (claims) => { if (!claims) throw new ApiError(400, 'Error', 'headers must have required property \'authorization\''); return claims }
const SERVICE = { role: 'service_role' }

// ------------------------------------------------------------------ database, as the caller's role
async function asRole(claims, fn, { dryRun = false } = {}) {
  const role = claims?.role || 'anon'
  if (!ROLE_RE.test(role)) throw new ApiError(403, 'Unauthorized', 'Invalid role in token')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`SET LOCAL ROLE "${role}"`)
    await client.query(
      "SELECT set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('request.jwt.claim.role', $3, true), set_config('storage.allow_delete_query', 'true', true)",
      [JSON.stringify(claims || { role: 'anon' }), String(claims?.sub || ''), role]
    )
    const out = await fn(client)
    await client.query(dryRun ? 'ROLLBACK' : 'COMMIT')
    return out
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw dbError(e)
  } finally {
    client.release()
  }
}

function dbError(e) {
  if (e instanceof ApiError) return e
  if (e.code === '42501') return new ApiError(403, 'Unauthorized', /row-level security/.test(e.message) ? 'new row violates row-level security policy' : e.message)
  if (e.code === '23505') return new ApiError(409, 'Duplicate', 'The resource already exists')
  if (e.code === '23503') return new ApiError(404, 'not_found', 'Bucket not found')
  if (e.code === '22P02') return new ApiError(400, 'invalid_request', e.message)
  console.error('database:', e.message)
  return new ApiError(500, 'internal', 'Internal Server Error')
}

let columns = { objects: new Set(), buckets: new Set() }
async function loadColumns() {
  const rows = await asRole(SERVICE, (c) => c.query("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'storage' AND table_name IN ('objects', 'buckets')"))
  columns = { objects: new Set(), buckets: new Set() }
  for (const r of rows.rows) columns[r.table_name].add(r.column_name)
  if (!columns.objects.size) throw new Error('storage.objects does not exist in this database')
}
// Versioned schemas (Supabase Storage 2026+) keep archived versions and delete markers next to the current object
const CUR = () => `${columns.objects.has('archived_at') ? ' AND archived_at IS NULL' : ''}${columns.objects.has('is_delete_marker') ? ' AND NOT is_delete_marker' : ''}`
const bucketCols = () => ['id', 'name', 'owner', 'public', 'file_size_limit', 'allowed_mime_types', 'created_at', 'updated_at'].filter(c => columns.buckets.has(c))

async function getBucket(id) {
  const r = await asRole(SERVICE, (c) => c.query(`SELECT ${bucketCols().join(', ')} FROM storage.buckets WHERE id = $1`, [id]))
  if (!r.rows[0]) throw notFound('Bucket')
  return r.rows[0]
}

// ------------------------------------------------------------------ files on disk
function safeName(name) {
  name = String(name || '')
  if (!name || name.length > 1024 || /[\x00-\x1f\x7f\\]/.test(name) || name.startsWith('/') || name.endsWith('/')) throw new ApiError(400, 'InvalidKey', `Invalid key: ${name}`)
  if (name.split('/').some(s => !s || s === '.' || s === '..')) throw new ApiError(400, 'InvalidKey', `Invalid key: ${name}`)
  return name
}
function safeBucket(id) {
  id = String(id || '')
  if (!BUCKET_RE.test(id) || id.includes('/')) throw new ApiError(400, 'InvalidBucketName', `Invalid bucket name: ${id}`)
  return id
}
const filePath = (bucket, name) => {
  const p = path.join(ROOT, bucket, name)
  if (!p.startsWith(`${path.join(ROOT, bucket)}${path.sep}`)) throw new ApiError(400, 'InvalidKey', 'Invalid key')
  return p
}

async function placeFile(tmp, bucket, name, isPublic) {
  const dest = filePath(bucket, name)
  await fsp.mkdir(path.dirname(dest), { recursive: true, mode: isPublic ? 0o755 : 0o700 })
  await fsp.chmod(tmp, isPublic ? 0o644 : 0o600)
  await fsp.rename(tmp, dest)
}
const removeFile = (bucket, name) => fsp.rm(filePath(bucket, name), { force: true }).catch(() => {})

/** Counts and hashes bytes as they stream, and stops at the size limit. */
function meter(limit) {
  const hash = crypto.createHash('md5')
  let size = 0
  const t = new Transform({
    transform(chunk, _enc, cb) {
      size += chunk.length
      if (size > limit) return cb(new ApiError(413, 'Payload too large', 'The object exceeded the maximum allowed size'))
      hash.update(chunk)
      cb(null, chunk)
    }
  })
  t.result = () => ({ size, etag: `"${hash.digest('hex')}"` })
  return t
}

/** Streams the request body (raw, or the file part of multipart/form-data) to `tmp`. */
async function receiveBody(req, tmp, limit) {
  const ct = String(req.headers['content-type'] || '')
  if (/^multipart\/form-data/i.test(ct)) {
    return new Promise((resolve, reject) => {
      const fields = {}
      let file = null
      let writing = null
      const bb = busboy({ headers: req.headers, limits: { files: 1, fields: 20 } })
      bb.on('field', (k, v) => { fields[k] = v })
      bb.on('file', (_field, stream, info) => {
        const m = meter(limit)
        file = { info, m }
        writing = pipeline(stream, m, fs.createWriteStream(tmp, { mode: 0o600 }))
        writing.catch(() => {})
      })
      bb.on('error', reject)
      bb.on('close', async () => {
        try {
          if (!writing) throw new ApiError(400, 'invalid_request', 'No file in the form data')
          await writing
          resolve({ ...file.m.result(), mimetype: fields.contentType || file.info.mimeType || 'application/octet-stream', cacheControl: fields.cacheControl, userMetadata: fields.metadata })
        } catch (e) { reject(e) }
      })
      req.pipe(bb)
    })
  }
  const m = meter(limit)
  await pipeline(req, m, fs.createWriteStream(tmp, { mode: 0o600 }))
  return { ...m.result(), mimetype: ct.split(';')[0].trim() || 'application/octet-stream', cacheControl: String(req.headers['cache-control'] || '').replace(/^max-age=/, ''), userMetadata: req.headers['x-metadata'] ? Buffer.from(String(req.headers['x-metadata']), 'base64').toString() : null }
}

function objectMetadata({ size, etag, mimetype, cacheControl }) {
  return { eTag: etag, size, mimetype, cacheControl: `max-age=${/^\d+$/.test(cacheControl || '') ? cacheControl : 3600}`, lastModified: new Date().toISOString(), contentLength: size, httpStatusCode: 200 }
}

function checkBucketLimits(bucket, { size, mimetype }) {
  if (bucket.file_size_limit && size > Number(bucket.file_size_limit)) throw new ApiError(413, 'Payload too large', 'The object exceeded the maximum allowed size')
  const allowed = bucket.allowed_mime_types
  if (Array.isArray(allowed) && allowed.length && !allowed.some(a => a === mimetype || (a.endsWith('/*') && mimetype.startsWith(a.slice(0, -1))))) {
    throw new ApiError(415, 'invalid_mime_type', `mime type ${mimetype} is not supported`)
  }
}

/** Upload: write to a temp file, insert/upsert the row as the caller (RLS), then move the file in place. */
async function upload(req, claims, bucketId, name, { upsert, ownerOverride = null }) {
  const bucket = await getBucket(bucketId)
  const limit = Math.min(FILE_SIZE_LIMIT, Number(bucket.file_size_limit) || Infinity)
  await fsp.mkdir(path.join(ROOT, bucketId), { recursive: true, mode: bucket.public ? 0o755 : 0o700 })
  const tmp = path.join(ROOT, bucketId, `.upload-${crypto.randomBytes(8).toString('hex')}`)
  try {
    const body = await receiveBody(req, tmp, limit)
    checkBucketLimits(bucket, body)
    const owner = ownerOverride ?? claims?.sub ?? null
    const cols = ['bucket_id', 'name', 'owner', 'metadata']
    const vals = [bucketId, name, UUID_RE.test(owner || '') ? owner : null, JSON.stringify(objectMetadata(body))]
    if (columns.objects.has('owner_id')) { cols.push('owner_id'); vals.push(owner) }
    if (columns.objects.has('user_metadata') && body.userMetadata) { cols.push('user_metadata'); vals.push(body.userMetadata) }
    const run = async (c) => {
      const row = await writeRow(c, cols, vals, upsert)
      await placeFile(tmp, bucketId, name, bucket.public)
      return row
    }
    const row = ownerOverride !== null ? await asRole(SERVICE, run) : await asRole(claims, run)
    return { Id: row.id, Key: `${bucketId}/${name}` }
  } finally {
    await fsp.rm(tmp, { force: true }).catch(() => {})
  }
}

/** Inserts the object row, or with `upsert` updates the current one first (RLS applies to both). */
async function writeRow(c, cols, vals, upsert) {
  if (upsert) {
    const sets = cols.slice(2).map((col, i) => `${col} = $${i + 3}`).concat(columns.objects.has('updated_at') ? ['updated_at = now()'] : [])
    const u = await c.query(`UPDATE storage.objects SET ${sets.join(', ')} WHERE bucket_id = $1 AND name = $2${CUR()} RETURNING id`, vals)
    if (u.rows[0]) return u.rows[0]
  }
  return (await c.query(`INSERT INTO storage.objects (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`, vals)).rows[0]
}

const objectCols = () => ['id', 'name', 'bucket_id', 'owner', 'created_at', 'updated_at', 'last_accessed_at', 'metadata', 'user_metadata', 'version'].filter(c => columns.objects.has(c))

async function findObject(claims, bucketId, name) {
  const r = await asRole(claims, (c) => c.query(`SELECT ${objectCols().join(', ')} FROM storage.objects WHERE bucket_id = $1 AND name = $2${CUR()}`, [bucketId, name]))
  if (!r.rows[0]) throw notFound()
  return r.rows[0]
}

async function sendFile(req, res, url, bucketId, name, meta) {
  const file = filePath(bucketId, name)
  const st = await fsp.stat(file).catch(() => null)
  if (!st || !st.isFile()) throw notFound()
  const headers = {
    'Content-Type': meta?.mimetype || 'application/octet-stream',
    'Cache-Control': meta?.cacheControl || 'no-cache',
    'Last-Modified': st.mtime.toUTCString(),
    'Accept-Ranges': 'bytes'
  }
  if (meta?.eTag) headers.ETag = meta.eTag
  if (url.searchParams.has('download')) {
    const fname = url.searchParams.get('download') || path.basename(name)
    headers['Content-Disposition'] = `attachment; filename="${fname.replace(/["\r\n]/g, '')}"; filename*=UTF-8''${encodeURIComponent(fname)}`
  }
  if (meta?.eTag && req.headers['if-none-match'] === meta.eTag) { res.writeHead(304, headers); return res.end() }
  let start = 0
  let end = st.size - 1
  let status = 200
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''))
  if (range && st.size) {
    start = range[1] ? Number(range[1]) : Math.max(0, st.size - Number(range[2]))
    end = range[1] && range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1
    if (start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end() }
    status = 206
    headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`
  }
  headers['Content-Length'] = st.size ? end - start + 1 : 0
  res.writeHead(status, headers)
  if (req.method === 'HEAD' || !st.size) return res.end()
  await pipeline(fs.createReadStream(file, { start, end }), res)
}

// ------------------------------------------------------------------ list (one folder level, like storage.search)
async function listObjects(claims, bucketId, body) {
  await getBucket(bucketId)
  let prefix = String(body.prefix || '')
  if (prefix && !prefix.endsWith('/')) prefix += '/'
  const limit = Math.min(Math.max(Number(body.limit) || 100, 1), 1000)
  const offset = Math.max(Number(body.offset) || 0, 0)
  const search = String(body.search || '').toLowerCase()
  const column = ['name', 'created_at', 'updated_at', 'last_accessed_at'].includes(body.sortBy?.column) ? body.sortBy.column : 'name'
  const desc = String(body.sortBy?.order || 'asc').toLowerCase() === 'desc'
  const like = `${prefix.replace(/[\\%_]/g, (m) => `\\${m}`)}%`
  const r = await asRole(claims, (c) => c.query(`SELECT ${objectCols().join(', ')} FROM storage.objects WHERE bucket_id = $1 AND name LIKE $2 ESCAPE '\\'${CUR()} ORDER BY name`, [bucketId, like]))
  const entries = new Map()
  for (const row of r.rows) {
    const rest = row.name.slice(prefix.length)
    const slash = rest.indexOf('/')
    const entryName = slash === -1 ? rest : rest.slice(0, slash)
    if (!entryName || (search && !entryName.toLowerCase().startsWith(search))) continue
    if (slash === -1) entries.set(`f:${entryName}`, { name: entryName, id: row.id, updated_at: row.updated_at, created_at: row.created_at, last_accessed_at: row.last_accessed_at, metadata: row.metadata })
    else if (!entries.has(`d:${entryName}`)) entries.set(`d:${entryName}`, { name: entryName, id: null, updated_at: null, created_at: null, last_accessed_at: null, metadata: null })
  }
  const items = [...entries.values()].sort((a, b) => {
    const av = a[column] ?? ''
    const bv = b[column] ?? ''
    const cmp = av instanceof Date || bv instanceof Date ? new Date(av) - new Date(bv) : String(av).localeCompare(String(bv))
    return desc ? -cmp : cmp
  })
  return items.slice(offset, offset + limit)
}

// ------------------------------------------------------------------ HTTP plumbing
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-upsert, cache-control, range, x-metadata',
  'Access-Control-Expose-Headers': 'content-range, content-length, etag, content-disposition'
}

function json(res, status, data) {
  const body = JSON.stringify(data)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
}

async function readJson(req) {
  let size = 0
  const chunks = []
  for await (const c of req) {
    size += c.length
    if (size > 1024 * 1024) throw new ApiError(413, 'Payload too large', 'Request body too large')
    chunks.push(c)
  }
  if (!size) return {}
  try { return JSON.parse(Buffer.concat(chunks).toString()) } catch { throw new ApiError(400, 'invalid_request', 'Body is not valid JSON') }
}

/** "bucket/some/object name" (already URL-decoded) → [bucket, name]. */
function splitKey(rest) {
  const i = rest.indexOf('/')
  if (i === -1) return [safeBucket(rest), null]
  return [safeBucket(rest.slice(0, i)), safeName(rest.slice(i + 1))]
}

const decodePath = (p) => p.split('/').map((s) => { try { return decodeURIComponent(s) } catch { throw new ApiError(400, 'InvalidKey', 'Invalid key') } }).join('/')
const signedUrlPath = (kind, bucketId, name, token) => `/object/${kind}/${bucketId}/${name}?token=${token}`
const expiresIn = (v) => { const n = Number(v); if (!Number.isFinite(n) || n < 1) throw new ApiError(400, 'invalid_request', 'expiresIn must be a positive number'); return Math.floor(n) }

async function route(req, res, url) {
  const method = req.method
  const p = decodePath(url.pathname.replace(/^\/+/, ''))
  let m

  if (p === 'status' || p === 'health') return json(res, 200, { status: 'ok' })

  // Public objects need no credentials
  if ((m = /^(?:object|render\/image)\/public\/(.+)$/.exec(p)) && (method === 'GET' || method === 'HEAD')) {
    const [bucketId, name] = splitKey(m[1])
    const bucket = await getBucket(bucketId)
    if (!bucket.public || !name) throw notFound('Object')
    const obj = await asRole(SERVICE, (c) => c.query(`SELECT metadata FROM storage.objects WHERE bucket_id = $1 AND name = $2${CUR()}`, [bucketId, name]))
    if (!obj.rows[0]) throw notFound()
    return sendFile(req, res, url, bucketId, name, obj.rows[0].metadata)
  }

  // Signed download: the token carries the object key
  if ((m = /^(?:object|render\/image)\/sign\/(.+)$/.exec(p)) && (method === 'GET' || method === 'HEAD')) {
    const claims = verifyJwt(url.searchParams.get('token'))
    const [bucketId, name] = splitKey(m[1])
    if (!claims || claims.url !== `${bucketId}/${name}`) throw new ApiError(400, 'InvalidSignature', 'The signature is invalid or has expired')
    const obj = await asRole(SERVICE, (c) => c.query(`SELECT metadata FROM storage.objects WHERE bucket_id = $1 AND name = $2${CUR()}`, [bucketId, name]))
    if (!obj.rows[0]) throw notFound()
    return sendFile(req, res, url, bucketId, name, obj.rows[0].metadata)
  }

  // Upload with a signed upload URL
  if ((m = /^object\/upload\/sign\/(.+)$/.exec(p)) && method === 'PUT') {
    const claims = verifyJwt(url.searchParams.get('token'))
    const [bucketId, name] = splitKey(m[1])
    if (!claims || claims.url !== `${bucketId}/${name}` || claims.kind !== 'upload') throw new ApiError(400, 'InvalidSignature', 'The signature is invalid or has expired')
    return json(res, 200, await upload(req, null, bucketId, name, { upsert: !!claims.upsert, ownerOverride: claims.owner || '' }))
  }

  const claims = requireClaims(callerClaims(req))

  // ---- buckets
  if (p === 'bucket' && method === 'GET') {
    const r = await asRole(claims, (c) => c.query(`SELECT ${bucketCols().join(', ')} FROM storage.buckets ORDER BY name`))
    return json(res, 200, r.rows)
  }
  if (p === 'bucket' && method === 'POST') {
    const b = await readJson(req)
    const id = safeBucket(b.id || b.name)
    const cols = ['id', 'name', 'public']
    const vals = [id, String(b.name || id), !!b.public]
    if (columns.buckets.has('owner') && UUID_RE.test(claims.sub || '')) { cols.push('owner'); vals.push(claims.sub) }
    if (columns.buckets.has('file_size_limit') && b.file_size_limit) { cols.push('file_size_limit'); vals.push(parseSize(b.file_size_limit)) }
    if (columns.buckets.has('allowed_mime_types') && Array.isArray(b.allowed_mime_types)) { cols.push('allowed_mime_types'); vals.push(b.allowed_mime_types.map(String)) }
    await asRole(claims, (c) => c.query(`INSERT INTO storage.buckets (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, vals))
    await fsp.mkdir(path.join(ROOT, id), { recursive: true, mode: b.public ? 0o755 : 0o700 })
    return json(res, 200, { name: id })
  }
  if ((m = /^bucket\/([^/]+)$/.exec(p))) {
    const id = safeBucket(m[1])
    if (method === 'GET') {
      const r = await asRole(claims, (c) => c.query(`SELECT ${bucketCols().join(', ')} FROM storage.buckets WHERE id = $1`, [id]))
      if (!r.rows[0]) throw notFound('Bucket')
      return json(res, 200, r.rows[0])
    }
    if (method === 'PUT') {
      const b = await readJson(req)
      const sets = []
      const vals = [id]
      if (b.public !== undefined) { vals.push(!!b.public); sets.push(`public = $${vals.length}`) }
      if (b.file_size_limit !== undefined && columns.buckets.has('file_size_limit')) { vals.push(b.file_size_limit ? parseSize(b.file_size_limit) : null); sets.push(`file_size_limit = $${vals.length}`) }
      if (b.allowed_mime_types !== undefined && columns.buckets.has('allowed_mime_types')) { vals.push(Array.isArray(b.allowed_mime_types) ? b.allowed_mime_types.map(String) : null); sets.push(`allowed_mime_types = $${vals.length}`) }
      if (sets.length) {
        const r = await asRole(claims, (c) => c.query(`UPDATE storage.buckets SET ${sets.join(', ')} WHERE id = $1 RETURNING id`, vals))
        if (!r.rows[0]) throw notFound('Bucket')
      }
      if (b.public !== undefined) await fsp.chmod(path.join(ROOT, id), b.public ? 0o755 : 0o700).catch(() => {})
      return json(res, 200, { message: 'Successfully updated' })
    }
    if (method === 'DELETE') {
      await asRole(claims, async (c) => {
        const n = await c.query('SELECT 1 FROM storage.objects WHERE bucket_id = $1 LIMIT 1', [id])
        if (n.rows.length) throw new ApiError(409, 'InvalidRequest', 'The bucket you tried to delete is not empty')
        const r = await c.query('DELETE FROM storage.buckets WHERE id = $1 RETURNING id', [id])
        if (!r.rows[0]) throw notFound('Bucket')
      })
      await fsp.rm(path.join(ROOT, id), { recursive: true, force: true })
      return json(res, 200, { message: 'Successfully deleted' })
    }
  }
  if ((m = /^bucket\/([^/]+)\/empty$/.exec(p)) && method === 'POST') {
    const id = safeBucket(m[1])
    const removed = await asRole(claims, (c) => c.query('DELETE FROM storage.objects WHERE bucket_id = $1 RETURNING name', [id]))
    for (const r of removed.rows) await removeFile(id, r.name)
    return json(res, 200, { message: 'Successfully emptied' })
  }

  // ---- objects
  if ((m = /^object\/list\/([^/]+)$/.exec(p)) && method === 'POST') {
    return json(res, 200, await listObjects(claims, safeBucket(m[1]), await readJson(req)))
  }
  if (p === 'object/move' && method === 'POST') {
    const b = await readJson(req)
    const from = safeBucket(b.bucketId)
    const to = safeBucket(b.destinationBucket || b.bucketId)
    const src = safeName(b.sourceKey)
    const dst = safeName(b.destinationKey)
    const target = await getBucket(to)
    await asRole(claims, async (c) => {
      const r = await c.query(`UPDATE storage.objects SET bucket_id = $3, name = $4${columns.objects.has('updated_at') ? ', updated_at = now()' : ''} WHERE bucket_id = $1 AND name = $2${CUR()} RETURNING id`, [from, src, to, dst])
      if (!r.rows[0]) throw notFound()
      const dest = filePath(to, dst)
      await fsp.mkdir(path.dirname(dest), { recursive: true, mode: target.public ? 0o755 : 0o700 })
      await fsp.rename(filePath(from, src), dest)
    })
    return json(res, 200, { message: 'Successfully moved' })
  }
  if (p === 'object/copy' && method === 'POST') {
    const b = await readJson(req)
    const from = safeBucket(b.bucketId)
    const to = safeBucket(b.destinationBucket || b.bucketId)
    const src = safeName(b.sourceKey)
    const dst = safeName(b.destinationKey)
    const target = await getBucket(to)
    const row = await asRole(claims, async (c) => {
      const s = await c.query(`SELECT metadata FROM storage.objects WHERE bucket_id = $1 AND name = $2${CUR()}`, [from, src])
      if (!s.rows[0]) throw notFound()
      const owner = UUID_RE.test(claims.sub || '') ? claims.sub : null
      const r = await c.query('INSERT INTO storage.objects (bucket_id, name, owner, metadata) VALUES ($1, $2, $3, $4) RETURNING id', [to, dst, owner, s.rows[0].metadata])
      const dest = filePath(to, dst)
      await fsp.mkdir(path.dirname(dest), { recursive: true, mode: target.public ? 0o755 : 0o700 })
      await fsp.copyFile(filePath(from, src), dest)
      await fsp.chmod(dest, target.public ? 0o644 : 0o600)
      return r.rows[0]
    })
    return json(res, 200, { Id: row.id, Key: `${to}/${dst}` })
  }
  if ((m = /^object\/sign\/([^/]+)$/.exec(p)) && method === 'POST') {
    // createSignedUrls: several paths of one bucket
    const bucketId = safeBucket(m[1])
    const b = await readJson(req)
    const exp = expiresIn(b.expiresIn)
    const paths = Array.isArray(b.paths) ? b.paths.slice(0, 1000).map(String) : []
    const found = await asRole(claims, (c) => c.query(`SELECT name FROM storage.objects WHERE bucket_id = $1 AND name = ANY($2::text[])${CUR()}`, [bucketId, paths]))
    const ok = new Set(found.rows.map(r => r.name))
    const now = Math.floor(Date.now() / 1000)
    return json(res, 200, paths.map(name => ok.has(name)
      ? { error: null, path: name, signedURL: signedUrlPath('sign', bucketId, name, signJwt({ url: `${bucketId}/${name}`, iat: now, exp: now + exp })) }
      : { error: 'Either the object does not exist or you do not have access to it', path: name, signedURL: null }))
  }
  if ((m = /^object\/sign\/(.+)$/.exec(p)) && method === 'POST') {
    const [bucketId, name] = splitKey(m[1])
    if (!name) throw notFound()
    const exp = expiresIn((await readJson(req)).expiresIn)
    await findObject(claims, bucketId, name)
    const now = Math.floor(Date.now() / 1000)
    return json(res, 200, { signedURL: signedUrlPath('sign', bucketId, name, signJwt({ url: `${bucketId}/${name}`, iat: now, exp: now + exp })) })
  }
  if ((m = /^object\/upload\/sign\/(.+)$/.exec(p)) && method === 'POST') {
    const [bucketId, name] = splitKey(m[1])
    if (!name) throw new ApiError(400, 'InvalidKey', 'Missing object name')
    await getBucket(bucketId)
    const upsert = String(req.headers['x-upsert'] || '') === 'true'
    // The caller must be allowed to create this object: try the insert, then roll it back
    const owner = UUID_RE.test(claims.sub || '') ? claims.sub : null
    await asRole(claims, (c) => writeRow(c, ['bucket_id', 'name', 'owner', 'metadata'], [bucketId, name, owner, '{}'], upsert), { dryRun: true })
    const now = Math.floor(Date.now() / 1000)
    const token = signJwt({ url: `${bucketId}/${name}`, kind: 'upload', upsert, owner: claims.sub || null, iat: now, exp: now + 7200 })
    return json(res, 200, { url: signedUrlPath('upload/sign', bucketId, name, token), token })
  }
  if ((m = /^object\/info\/(?:public\/|authenticated\/)?(.+)$/.exec(p)) && method === 'GET') {
    const [bucketId, name] = splitKey(m[1])
    if (!name) throw notFound()
    const o = await findObject(claims, bucketId, name)
    return json(res, 200, {
      id: o.id, name: o.name, bucket_id: o.bucket_id, version: o.version || null, size: o.metadata?.size ?? null,
      content_type: o.metadata?.mimetype ?? null, cache_control: o.metadata?.cacheControl ?? null, etag: o.metadata?.eTag ?? null,
      metadata: o.user_metadata ?? null, last_modified: o.updated_at, created_at: o.created_at
    })
  }
  if ((m = /^object\/([^/]+)$/.exec(p)) && method === 'DELETE') {
    // remove(): { prefixes: [names] }
    const bucketId = safeBucket(m[1])
    const b = await readJson(req)
    const names = Array.isArray(b.prefixes) ? b.prefixes.slice(0, 1000).map(String) : []
    const r = await asRole(claims, (c) => c.query(`DELETE FROM storage.objects WHERE bucket_id = $1 AND name = ANY($2::text[])${CUR()} RETURNING ${objectCols().join(', ')}`, [bucketId, names]))
    for (const row of r.rows) await removeFile(bucketId, row.name)
    return json(res, 200, r.rows)
  }
  if ((m = /^(?:object\/authenticated|render\/image\/authenticated|object)\/(.+)$/.exec(p))) {
    const [bucketId, name] = splitKey(m[1])
    if (!name) throw notFound()
    if (method === 'GET' || method === 'HEAD') {
      const o = await findObject(claims, bucketId, name)
      return sendFile(req, res, url, bucketId, name, o.metadata)
    }
    if (/^object\//.test(p) && !/^object\/authenticated\//.test(p) && (method === 'POST' || method === 'PUT')) {
      const upsert = method === 'PUT' || String(req.headers['x-upsert'] || '') === 'true'
      return json(res, 200, await upload(req, claims, bucketId, name, { upsert }))
    }
    if (method === 'DELETE') {
      const r = await asRole(claims, (c) => c.query(`DELETE FROM storage.objects WHERE bucket_id = $1 AND name = $2${CUR()} RETURNING name`, [bucketId, name]))
      if (!r.rows[0]) throw notFound()
      await removeFile(bucketId, name)
      return json(res, 200, { message: 'Successfully deleted' })
    }
  }
  throw new ApiError(404, 'not_found', 'Route not found')
}

function parseSize(v) {
  if (typeof v === 'number') return Math.floor(v)
  const m = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i.exec(String(v).trim())
  if (!m) throw new ApiError(400, 'invalid_request', 'Invalid file_size_limit')
  return Math.floor(Number(m[1]) * { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 }[(m[2] || 'b').toLowerCase()])
}

// ------------------------------------------------------------------ --sync: files on disk → rows
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', ico: 'image/x-icon', pdf: 'application/pdf', json: 'application/json', txt: 'text/plain', csv: 'text/csv', html: 'text/html', css: 'text/css', js: 'text/javascript', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', zip: 'application/zip', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }

async function* walk(dir, rel = '') {
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.upload-')) continue
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) yield* walk(path.join(dir, e.name), r)
    else if (e.isFile()) yield r
  }
}

async function sync() {
  await loadColumns()
  let declared = []
  try { declared = JSON.parse(await fsp.readFile(process.env.BUCKETS_FILE, 'utf8')) } catch { /* optional */ }
  const publicOf = new Map(declared.map(b => [b.name, !!b.public]))
  const dirs = (await fsp.readdir(ROOT, { withFileTypes: true }).catch(() => [])).filter(d => d.isDirectory() && BUCKET_RE.test(d.name)).map(d => d.name)
  for (const name of new Set([...dirs, ...publicOf.keys()])) {
    await asRole(SERVICE, (c) => c.query('INSERT INTO storage.buckets (id, name, public) VALUES ($1, $1, $2) ON CONFLICT (id) DO NOTHING', [name, publicOf.get(name) ?? false]))
  }
  let added = 0
  for (const bucket of dirs) {
    const known = new Set((await asRole(SERVICE, (c) => c.query(`SELECT name FROM storage.objects WHERE bucket_id = $1${CUR()}`, [bucket]))).rows.map(r => r.name))
    for await (const name of walk(path.join(ROOT, bucket))) {
      if (known.has(name)) continue
      const st = await fsp.stat(path.join(ROOT, bucket, name))
      const meta = objectMetadata({ size: st.size, etag: `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`, mimetype: MIME[name.split('.').pop().toLowerCase()] || 'application/octet-stream' })
      await asRole(SERVICE, (c) => c.query(`INSERT INTO storage.objects (bucket_id, name, metadata) SELECT $1, $2, $3 WHERE NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = $1 AND name = $2${CUR()})`, [bucket, name, JSON.stringify(meta)]))
      added++
    }
  }
  console.log(`Registered ${added} file(s) in ${dirs.length} bucket(s)`)
}

// ------------------------------------------------------------------ main
if (process.argv.includes('--sync')) {
  sync().then(() => pool.end()).catch((e) => { console.error(e.message); process.exit(1) })
} else {
  await loadColumns()
  http.createServer(async (req, res) => {
    for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v)
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }
    const url = new URL(req.url, 'http://storage')
    try {
      await route(req, res, url)
    } catch (e) {
      const err = e instanceof ApiError ? e : dbError(e)
      if (res.headersSent) return res.destroy()
      req.resume()
      json(res, err.status, { statusCode: String(err.status), error: err.error, message: err.message })
    }
  }).listen(PORT, '127.0.0.1', () => console.log(`Storage API on 127.0.0.1:${PORT}, files in ${ROOT}`))
}
