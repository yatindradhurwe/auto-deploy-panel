import { REF_RE } from './supabase-stack.service.js'

/**
 * Supabase Management API (api.supabase.com) with the user's personal access token, to fill in a
 * migration: the projects the token can see, then one project's pooler address, API keys, JWT
 * secret, Auth settings, Edge Function list and secret names. The token is used for the request only
 * and never saved. Database passwords cannot be read back from Supabase: the user types it.
 */

const API = 'https://api.supabase.com/v1'
const httpErr = (status, message) => Object.assign(new Error(message), { status })

function checkToken(token) {
  token = String(token || '').trim()
  if (!token) throw httpErr(400, 'Enter a Supabase access token (supabase.com → Account → Access Tokens).')
  if (!/^[A-Za-z0-9_.-]{20,400}$/.test(token)) throw httpErr(400, 'That does not look like a Supabase access token (it starts with sbp_).')
  return token
}

async function call(token, pathname, { optional = false } = {}) {
  let res
  try {
    res = await fetch(`${API}${pathname}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) })
  } catch (e) {
    throw httpErr(502, `Could not reach the Supabase API: ${e.cause?.code || e.message}`)
  }
  const text = await res.text()
  let data = null
  try { data = JSON.parse(text) } catch { /* not JSON */ }
  if (res.ok) return data
  if (optional) return null
  if (res.status === 401) throw httpErr(400, 'Supabase rejected the access token. Create a new one at supabase.com → Account → Access Tokens.')
  if (res.status === 403) throw httpErr(400, `The access token may not read this project (${data?.message || 'forbidden'}).`)
  if (res.status === 404) throw httpErr(404, 'Supabase project not found.')
  throw httpErr(502, `Supabase API: ${data?.message || text.slice(0, 200) || `HTTP ${res.status}`}`)
}

/** Projects the token can access: [{ ref, name, region, status, organization }] */
export async function listSupabaseProjects(token) {
  token = checkToken(token)
  const projects = await call(token, '/projects') || []
  return projects.map(p => ({ ref: p.ref || p.id, name: p.name, region: p.region, status: p.status, organization: p.organization_slug || p.organization_id || null, postgres: p.database?.version || null }))
    .filter(p => REF_RE.test(p.ref || ''))
}

/**
 * The session pooler connection string with a {password} placeholder. pg_dump needs session mode, so
 * a transaction pooler entry (port 6543) is switched to the same host's session port 5432.
 */
export function poolerTemplate(entries, ref) {
  const list = Array.isArray(entries) ? entries : []
  const e = list.find(x => x.database_type === 'PRIMARY' && x.pool_mode === 'session') || list.find(x => x.database_type === 'PRIMARY') || list[0]
  if (!e?.db_host) return `postgresql://postgres.${ref}:{password}@aws-0-<region>.pooler.supabase.com:5432/postgres`
  return `postgresql://${encodeURIComponent(e.db_user || `postgres.${ref}`)}:{password}@${e.db_host}:5432/${encodeURIComponent(e.db_name || 'postgres')}`
}

/** What the wizard needs to migrate project `ref`. */
export async function supabaseProjectDetails(token, ref) {
  token = checkToken(token)
  ref = String(ref || '').trim().toLowerCase()
  if (!REF_RE.test(ref)) throw httpErr(400, 'Invalid Supabase project reference.')
  const [project, keys, postgrest, auth, pooler, functions, secrets] = await Promise.all([
    call(token, `/projects/${ref}`),
    call(token, `/projects/${ref}/api-keys?reveal=true`, { optional: true }),
    call(token, `/projects/${ref}/postgrest`, { optional: true }),
    call(token, `/projects/${ref}/config/auth`, { optional: true }),
    call(token, `/projects/${ref}/config/database/pooler`, { optional: true }),
    call(token, `/projects/${ref}/functions`, { optional: true }),
    call(token, `/projects/${ref}/secrets`, { optional: true })
  ])
  const key = (pred) => (keys || []).find(pred)?.api_key || null
  const anon = key(k => k.name === 'anon' && /^eyJ/.test(k.api_key || ''))
  const serviceRole = key(k => k.name === 'service_role' && /^eyJ/.test(k.api_key || ''))
  const secretKey = key(k => k.type === 'secret' && /^sb_secret_/.test(k.api_key || ''))
  return {
    ref,
    name: project?.name || ref,
    region: project?.region || null,
    status: project?.status || null,
    url: `https://${ref}.supabase.co`,
    poolerTemplate: poolerTemplate(pooler, ref),
    keys: { anon, service_role: serviceRole },
    // Storage files are copied with the service key (legacy JWT) or a new-style secret key
    storageKey: serviceRole || secretKey,
    jwtSecret: typeof postgrest?.jwt_secret === 'string' && postgrest.jwt_secret.length >= 32 ? postgrest.jwt_secret : null,
    auth: auth || null,
    functions: (functions || []).map(f => ({ slug: f.slug, name: f.name, verifyJwt: f.verify_jwt !== false, status: f.status })),
    // Supabase returns only a digest of each secret: the names tell the user what to fill in
    secretNames: (secrets || []).map(s => s.name).filter(n => n && !/^SUPABASE_/.test(n))
  }
}
