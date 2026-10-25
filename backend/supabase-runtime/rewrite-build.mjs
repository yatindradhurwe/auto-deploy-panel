#!/usr/bin/env node
/**
 * Points a built frontend at the app's own Supabase stack. Apps often hardcode the Supabase project
 * URL and anon key (src/integrations/supabase/client.ts, fallbacks after import.meta.env…), so the
 * built files are rewritten after every build: https://<ref>.supabase.co → the app's domain, and,
 * when the stack signs with a new JWT secret, the old project's keys → the new keys.
 *
 *   node rewrite-build.mjs <stack.json> <project folder>
 *
 * stack.json: { ref, url, keys: { anon, service_role }, keysChanged }
 * Only build output folders are touched (dist, build, out, .next, .output, .svelte-kit), never sources.
 */
import fs from 'fs'
import path from 'path'

const [stackFile, projectDir] = process.argv.slice(2)
if (!stackFile || !projectDir) { console.error('usage: rewrite-build.mjs <stack.json> <project folder>'); process.exit(2) }
const stack = JSON.parse(fs.readFileSync(stackFile, 'utf8'))
const OUTPUT_DIRS = new Set(['dist', 'build', 'out', '.next', '.output', '.svelte-kit'])
const SKIP_DIRS = new Set(['node_modules', '.git', 'venv', 'vendor', 'supabase', 'cache'])
const EXTS = new Set(['.js', '.mjs', '.cjs', '.html', '.htm', '.css', '.json', '.txt', '.rsc', '.body', '.map'])
const MAX_BYTES = 30 * 1024 * 1024

export function rewriter({ ref, url, keys, keysChanged }) {
  if (!/^[a-z0-9]{8,40}$/.test(ref || '')) throw new Error('stack.json has no valid project ref')
  const target = new URL(url)
  const pairs = [
    [`https://${ref}.supabase.co`, target.origin],
    [`http://${ref}.supabase.co`, target.origin],
    [`wss://${ref}.supabase.co`, target.origin.replace(/^http/, 'ws')],
    [`${ref}.supabase.co`, target.host]
  ]
  const jwtRe = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}/g
  return (text) => {
    let out = text
    for (const [from, to] of pairs) if (out.includes(from)) out = out.split(from).join(to)
    if (keysChanged && keys) {
      out = out.replace(jwtRe, (jwt) => {
        try {
          const claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString())
          if (claims.iss === 'supabase' && claims.ref === ref && keys[claims.role]) return keys[claims.role]
        } catch { /* not a JWT */ }
        return jwt
      })
      // New-style project keys are opaque: map them by kind
      out = out.replace(/sb_publishable_[A-Za-z0-9_-]{10,}/g, keys.anon).replace(/sb_secret_[A-Za-z0-9_-]{10,}/g, keys.service_role)
    }
    return out
  }
}

function* outputFiles(dir, depth = 0, inOutput = false) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue
      if (inOutput) yield* outputFiles(p, depth + 1, true)
      else if (OUTPUT_DIRS.has(e.name)) yield* outputFiles(p, depth + 1, true)
      else if (depth < 3) yield* outputFiles(p, depth + 1, false)
    } else if (inOutput && e.isFile() && EXTS.has(path.extname(e.name))) {
      yield p
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rewrite = rewriter(stack)
  let changed = 0
  for (const file of outputFiles(path.resolve(projectDir))) {
    const st = fs.statSync(file)
    if (st.size > MAX_BYTES) continue
    const before = fs.readFileSync(file, 'utf8')
    const after = rewrite(before)
    if (after === before) continue
    fs.writeFileSync(file, after, { mode: st.mode })
    // Pre-compressed copies would still serve the old values
    for (const ext of ['.gz', '.br']) fs.rmSync(`${file}${ext}`, { force: true })
    changed++
  }
  console.log(changed ? `Pointed ${changed} built file(s) at ${stack.url} instead of ${stack.ref}.supabase.co` : `No built files referenced ${stack.ref}.supabase.co`)
}
