/**
 * Supabase Edge Functions for one app, installed by the panel with the app's local Supabase stack.
 * Every supabase/functions/<name>/index.ts is loaded into this one Deno process: the function's
 * Deno.serve(handler) call is captured instead of opening a port, and requests for /<name>/… are
 * dispatched to it (nginx maps https://<domain>/functions/v1/ here, as Supabase does).
 *
 * Like Supabase, a request needs a valid JWT (the anon key, a user's access token or the service key)
 * unless the function was deployed with verify_jwt = false.
 *
 * Environment: FUNCTIONS_PORT, FUNCTIONS_DIR, FUNCTIONS_JWT_SECRET, FUNCTIONS_NO_VERIFY_JWT
 * (comma-separated names), plus the functions' own secrets and SUPABASE_URL / keys.
 */

type Handler = (req: Request, info?: unknown) => Response | Promise<Response>

const PORT = Number(Deno.env.get('FUNCTIONS_PORT') || 9000)
const DIR = Deno.env.get('FUNCTIONS_DIR') || Deno.cwd()
const SECRET = Deno.env.get('FUNCTIONS_JWT_SECRET') || ''
const NO_VERIFY = new Set((Deno.env.get('FUNCTIONS_NO_VERIFY_JWT') || '').split(',').map(s => s.trim()).filter(Boolean))
const ENTRIES = ['index.ts', 'index.js', 'index.tsx', 'index.mjs', 'index.jsx']

const handlers = new Map<string, Handler>()
let loading: string | null = null
const listen = Deno.serve.bind(Deno)
const idleServer = { finished: new Promise<void>(() => {}), shutdown: async () => {}, ref() {}, unref() {}, addr: { transport: 'tcp', hostname: '127.0.0.1', port: PORT } }

// A function's top-level Deno.serve(...) registers its handler with the router
Object.defineProperty(Deno, 'serve', {
  configurable: true,
  writable: true,
  value: (a: unknown, b?: unknown) => {
    const h = (typeof a === 'function' ? a : typeof b === 'function' ? b : (a as { handler?: Handler })?.handler) as Handler | undefined
    if (loading && h) handlers.set(loading, h)
    else if (h) console.error('Deno.serve() called outside of a function\'s module load; ignored')
    return idleServer
  }
})
// Supabase's runtime global for background work after the response
;(globalThis as Record<string, unknown>).EdgeRuntime = { waitUntil: (p: Promise<unknown>) => Promise.resolve(p).catch(e => console.error(e)) }
addEventListener('unhandledrejection', (e) => { e.preventDefault(); console.error('Unhandled rejection:', e.reason) })
addEventListener('error', (e) => { e.preventDefault(); console.error('Uncaught error:', e.error) })

const names: string[] = []
for await (const entry of Deno.readDir(DIR)) {
  if (entry.isDirectory && !/^[._]/.test(entry.name)) names.push(entry.name)
}
for (const name of names.sort()) {
  let file: string | null = null
  for (const e of ENTRIES) {
    try { if ((await Deno.stat(`${DIR}/${name}/${e}`)).isFile) { file = `${DIR}/${name}/${e}`; break } } catch { /* not this one */ }
  }
  if (!file) continue
  loading = name
  try {
    await import(new URL(`file://${file}`).href)
    console.log(handlers.has(name) ? `Loaded ${name}` : `${name}: loaded, but it never called Deno.serve(); requests to it will get 404`)
  } catch (e) {
    console.error(`${name}: failed to load: ${(e as Error)?.stack || e}`)
  } finally {
    loading = null
  }
}

const enc = new TextEncoder()
let hmacKey: CryptoKey | null = null
const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0))

async function validJwt(token: string): Promise<boolean> {
  const parts = token.split('.')
  if (parts.length !== 3 || !SECRET) return false
  try {
    if (JSON.parse(new TextDecoder().decode(b64url(parts[0]))).alg !== 'HS256') return false
    hmacKey ??= await crypto.subtle.importKey('raw', enc.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
    if (!await crypto.subtle.verify('HMAC', hmacKey, b64url(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`))) return false
    const claims = JSON.parse(new TextDecoder().decode(b64url(parts[1])))
    return !claims.exp || Date.now() / 1000 < claims.exp
  } catch {
    return false
  }
}

const json = (data: unknown, status: number) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

listen({ port: PORT, hostname: '127.0.0.1', onListen: () => console.log(`Edge functions on 127.0.0.1:${PORT}: ${[...handlers.keys()].join(', ') || 'none'}`) }, async (req, info) => {
  const url = new URL(req.url)
  const name = decodeURIComponent(url.pathname.split('/')[1] || '')
  const handler = handlers.get(name)
  if (!handler) return json({ code: 'NOT_FOUND', message: 'Requested function was not found' }, 404)
  if (req.method !== 'OPTIONS' && !NO_VERIFY.has(name)) {
    const auth = req.headers.get('authorization') || ''
    if (!auth) return json({ code: 401, message: 'Missing authorization header' }, 401)
    if (!await validJwt(auth.replace(/^Bearer\s+/i, ''))) return json({ code: 401, message: 'Invalid JWT' }, 401)
  }
  // The function sees its public URL (https://<domain>/<name>/…), as on Supabase
  const proto = req.headers.get('x-forwarded-proto') || 'http'
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || `127.0.0.1:${PORT}`
  try {
    return await handler(new Request(new URL(url.pathname + url.search, `${proto}://${host}`), req), info)
  } catch (e) {
    console.error(`${name}:`, e)
    return json({ code: 500, message: 'The function threw an error' }, 500)
  }
})
