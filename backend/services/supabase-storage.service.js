import crypto from 'crypto'
import { q } from './host.service.js'

/**
 * Supabase Storage → this server. Buckets and objects are listed from the panel through the
 * Storage REST API (with the project's service key), then downloaded on the target server with
 * curl into <STORAGE_ROOT>/<app>/<bucket>/<object path>. Public buckets are later served by nginx
 * at the same paths Supabase uses (/storage/v1/object/public/<bucket>/…), so stored public URLs
 * keep working once their host is switched to the app's domain.
 */

export const STORAGE_ROOT = '/var/lib/autodeploy-storage'
const MAX_OBJECTS = 200000
const BATCH = 1000
const BUCKET_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/

const httpErr = (status, message) => Object.assign(new Error(message), { status })

/**
 * The project's API origin (https://<ref>.supabase.co). Accepts the API URL or a dashboard link
 * (supabase.com/dashboard/project/<ref>). Only Supabase-hosted projects: the panel calls this URL itself.
 */
export function supabaseProjectUrl(input) {
  const raw = String(input || '').trim()
  let u
  try { u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`) } catch { throw httpErr(400, 'Enter your Supabase project URL, e.g. https://abcdefgh.supabase.co') }
  const dash = u.pathname.match(/\/project\/([a-z0-9]{8,40})/i)
  if (/^(app\.)?supabase\.com$/i.test(u.hostname) && dash) return `https://${dash[1].toLowerCase()}.supabase.co`
  if (!/^[a-z0-9]{8,40}\.supabase\.co$/i.test(u.hostname)) throw httpErr(400, 'Enter your Supabase project URL, e.g. https://abcdefgh.supabase.co (Project Settings → API).')
  return `https://${u.hostname.toLowerCase()}`
}

function checkKey(key) {
  key = String(key || '').trim()
  if (!key) throw httpErr(400, 'Enter the project\'s service_role (or secret) key — Project Settings → API Keys. It is only used for this copy and is not saved.')
  if (!/^[A-Za-z0-9._-]{20,2000}$/.test(key)) throw httpErr(400, 'That does not look like a Supabase API key.')
  if (key.startsWith('sb_publishable_')) throw httpErr(400, 'That is the publishable key. Copying private files needs the secret (service_role) key.')
  return key
}

// New-style keys (sb_secret_…) are not JWTs and go only in the apikey header
const authHeaders = (key) => (key.startsWith('sb_') ? { apikey: key } : { apikey: key, Authorization: `Bearer ${key}` })

async function storageApi(base, key, pathname, { method = 'GET', body } = {}) {
  let res
  try {
    res = await fetch(`${base}/storage/v1${pathname}`, {
      method,
      headers: { ...authHeaders(key), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000)
    })
  } catch (e) {
    throw httpErr(400, `Could not reach ${base}: ${e.cause?.code || e.message}`)
  }
  const text = await res.text()
  let data = null
  try { data = JSON.parse(text) } catch { /* not JSON */ }
  if (!res.ok) {
    const msg = data?.message || data?.error || text.slice(0, 200) || `HTTP ${res.status}`
    if ([401, 403].includes(res.status) || /jwt|signature|unauthori[sz]ed|invalid api key/i.test(msg)) throw httpErr(400, `Supabase rejected the key (${msg}). Use the service_role / secret key of this project.`)
    throw httpErr(400, `Supabase Storage: ${msg}`)
  }
  return data
}

const listBuckets = async (base, key) => (await storageApi(base, key, '/bucket')) || []

/** Every object in a bucket (folders are walked), as { path, size }. */
async function listObjects(base, key, bucket, limit = MAX_OBJECTS) {
  const out = []
  const prefixes = ['']
  while (prefixes.length) {
    const prefix = prefixes.shift()
    for (let offset = 0; ; offset += BATCH) {
      const items = await storageApi(base, key, `/object/list/${encodeURIComponent(bucket)}`, {
        method: 'POST',
        body: { prefix, limit: BATCH, offset, sortBy: { column: 'name', order: 'asc' } }
      }) || []
      for (const it of items) {
        if (it.id === null || it.id === undefined) prefixes.push(`${prefix}${it.name}/`) // a folder
        else if (it.name !== '.emptyFolderPlaceholder') out.push({ path: `${prefix}${it.name}`, size: Number(it.metadata?.size) || 0 })
        if (out.length > limit) throw httpErr(400, `Bucket ${bucket} has more than ${limit} files — copy it with the Supabase CLI instead.`)
      }
      if (items.length < BATCH) break
    }
  }
  return out
}

/** A relative object path that is safe to write under the bucket folder, or null. */
function safeObjectPath(p) {
  if (/[\x00-\x1f\x7f\\]/.test(p) || p.startsWith('/')) return null
  const parts = p.split('/')
  if (parts.some(s => !s || s === '.' || s === '..')) return null
  return p
}

/** Lists the project's buckets (name, public, files, bytes) to show before copying. Nothing is written. */
export async function inspectSupabaseStorage({ url, key }) {
  const base = supabaseProjectUrl(url)
  key = checkKey(key)
  const buckets = []
  for (const b of await listBuckets(base, key)) {
    const objects = await listObjects(base, key, b.id || b.name, 20000).catch(() => null)
    buckets.push({ name: b.id || b.name, public: !!b.public, files: objects ? objects.length : null, bytes: objects ? objects.reduce((a, o) => a + o.size, 0) : null })
  }
  return { url: base, buckets }
}

const curlQuote = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/**
 * Downloads every bucket of the Supabase project onto `host` under STORAGE_ROOT/<app>. Existing
 * files are overwritten. Public buckets are world-readable (nginx serves them); private ones are
 * readable by root only. Returns { base, dir, buckets: [{ name, public, files, failed }], files, failed, skipped }.
 */
export async function migrateSupabaseStorage(host, { url, key, appName, onLog = () => {} }) {
  const base = supabaseProjectUrl(url)
  key = checkKey(key)
  if (!/^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/.test(appName)) throw httpErr(400, 'Invalid app name.')
  if (!(await host.exec('command -v curl >/dev/null && echo ok', { timeout: 15000 })).stdout.includes('ok')) throw httpErr(400, 'curl is not installed on this server (apt-get install -y curl).')
  const dir = `${STORAGE_ROOT}/${appName}`
  const conf = `/tmp/autodeploy-storage-${crypto.randomBytes(6).toString('hex')}.curl`
  const headerLines = Object.entries(authHeaders(key)).map(([k, v]) => `header = ${curlQuote(`${k}: ${v}`)}`).join('\n')
  const result = { base, dir, buckets: [], files: 0, failed: 0, skipped: [] }

  await host.exec(`mkdir -p ${q(dir)} && chmod 755 ${q(STORAGE_ROOT)} ${q(dir)}`)
  try {
    for (const b of await listBuckets(base, key)) {
      const name = b.id || b.name
      if (!BUCKET_RE.test(name)) { result.skipped.push(`bucket "${name}" (unsupported name)`); continue }
      const objects = await listObjects(base, key, name)
      const bdir = `${dir}/${name}`
      onLog(`Bucket ${name} (${b.public ? 'public' : 'private'}): ${objects.length} file(s)\n`)
      let files = 0
      for (let i = 0; i < objects.length; i += BATCH) {
        const lines = [headerLines]
        let n = 0
        for (const o of objects.slice(i, i + BATCH)) {
          const rel = safeObjectPath(o.path)
          if (!rel) { result.skipped.push(`${name}/${o.path}`); continue }
          lines.push(`url = ${curlQuote(`${base}/storage/v1/object/${encodeURIComponent(name)}/${rel.split('/').map(encodeURIComponent).join('/')}`)}`, `output = ${curlQuote(`${bdir}/${rel}`)}`)
          n++
        }
        if (!n) continue
        await host.writeFile(conf, `${lines.join('\n')}\n`, { mode: 0o600 })
        // One curl per batch; %{onerror} needs curl 7.75+, so failures are counted from what landed on disk
        const r = await host.exec(`umask 022; curl --config ${q(conf)} --parallel --parallel-max 8 --create-dirs --fail --silent --show-error --retry 2 --connect-timeout 20 --max-time 900 2>&1 | tail -n 5`, { timeout: 2 * 60 * 60 * 1000 })
        if (r.stdout.trim()) onLog(r.stdout.split(key).join('***'))
        files += n
        onLog(`  ${Math.min(i + BATCH, objects.length)}/${objects.length}\n`)
      }
      const landed = objects.length ? Number((await host.exec(`find ${q(bdir)} -type f 2>/dev/null | wc -l`)).stdout.trim()) || 0 : 0
      await host.exec(b.public
        ? `[ -d ${q(bdir)} ] || mkdir -p ${q(bdir)}; chmod -R u=rwX,go=rX ${q(bdir)}`
        : `[ -d ${q(bdir)} ] || mkdir -p ${q(bdir)}; chmod -R u=rwX,go= ${q(bdir)}`)
      const failed = Math.max(0, files - landed)
      result.buckets.push({ name, public: !!b.public, files: landed, failed })
      result.files += landed
      result.failed += failed
    }
  } finally {
    await host.exec(`rm -f ${q(conf)}`).catch(() => {})
  }
  return result
}

/** nginx locations serving the public buckets at Supabase's public-object paths. */
export function publicBucketLocations(dir, buckets) {
  return buckets.filter(b => b.public && BUCKET_RE.test(b.name)).map(b =>
    `    location ^~ /storage/v1/object/public/${b.name}/ {\n        alias ${dir}/${b.name}/;\n        add_header Cache-Control "public, max-age=3600";\n    }`).join('\n')
}
