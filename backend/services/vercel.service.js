/**
 * Vercel REST API with the user's access token, to import a Vercel project into the deployment
 * wizard: its Git repository and production branch, build settings, production environment
 * variables and domains. The token is used for the request only and never saved.
 */

const API = 'https://api.vercel.com'
const httpErr = (status, message) => Object.assign(new Error(message), { status })
const ID_RE = /^[A-Za-z0-9_-]{1,100}$/
// The wizard's command overrides allow one plain command (see deploy-pipeline safeCommand)
const PLAIN_COMMAND = /^[^\n\r`$;|&<>]{1,300}$/

function checkToken(token) {
  token = String(token || '').trim()
  if (!token) throw httpErr(400, 'Enter a Vercel access token (vercel.com → Account Settings → Tokens).')
  if (!/^[A-Za-z0-9_-]{16,200}$/.test(token)) throw httpErr(400, 'That does not look like a Vercel access token.')
  return token
}

async function call(token, pathname, params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString()
  let res
  try {
    res = await fetch(`${API}${pathname}${qs ? `?${qs}` : ''}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) })
  } catch (e) {
    throw httpErr(502, `Could not reach the Vercel API: ${e.cause?.code || e.message}`)
  }
  const text = await res.text()
  let data = null
  try { data = JSON.parse(text) } catch { /* not JSON */ }
  if (res.ok) return data
  if (res.status === 401 || res.status === 403) throw httpErr(400, `Vercel rejected the token (${data?.error?.message || 'forbidden'}). Create one with access to the project's team.`)
  if (res.status === 404) throw httpErr(404, 'Vercel project not found.')
  throw httpErr(502, `Vercel API: ${data?.error?.message || text.slice(0, 200) || `HTTP ${res.status}`}`)
}

const repoUrl = (link) => {
  if (!link?.repo) return null
  const host = { github: 'github.com', gitlab: 'gitlab.com', bitbucket: 'bitbucket.org' }[link.type]
  if (!host) return null
  const full = link.org && !String(link.repo).includes('/') ? `${link.org}/${link.repo}` : link.projectNamespace && link.projectName ? `${link.projectNamespace}/${link.projectName}` : link.repo
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.\/-]+$/.test(full) ? `https://${host}/${full}.git` : null
}

/** Projects of the personal account and every team the token reaches. */
export async function listVercelProjects(token) {
  token = checkToken(token)
  const teams = (await call(token, '/v2/teams', { limit: 100 }).catch(() => null))?.teams || []
  const scopes = [{ id: null, name: 'Personal' }, ...teams.map(t => ({ id: t.id, name: t.name || t.slug }))]
  const out = []
  for (const s of scopes) {
    const data = await call(token, '/v10/projects', { limit: 100, teamId: s.id || undefined }).catch((e) => (s.id ? null : Promise.reject(e)))
    for (const p of data?.projects || []) {
      out.push({ id: p.id, name: p.name, framework: p.framework || null, teamId: s.id, team: s.name, repo: repoUrl(p.link), branch: p.link?.productionBranch || null, updatedAt: p.updatedAt || null })
    }
  }
  return out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
}

const quoteEnv = (v) => (/^[A-Za-z0-9_.:/@+,=-]*$/.test(v) ? v : `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n')}"`)

/** Supabase project ref an app's environment points at (https://<ref>.supabase.co), if any. */
export function supabaseRefFromEnv(env) {
  for (const { value } of env) {
    const m = /https?:\/\/([a-z0-9]{8,40})\.supabase\.co/i.exec(value || '')
    if (m) return m[1].toLowerCase()
  }
  return null
}

/**
 * One project: { name, framework, gitUrl, branch, overrides: { appDir, buildCommand, outputDir },
 * envText, env: [{ key, hasValue }], missingEnv, domains, supabaseRef, notes }
 */
export async function vercelProjectDetails(token, id, teamId = null) {
  token = checkToken(token)
  if (!ID_RE.test(String(id || ''))) throw httpErr(400, 'Invalid Vercel project.')
  if (teamId && !ID_RE.test(String(teamId))) throw httpErr(400, 'Invalid Vercel team.')
  const scope = { teamId: teamId || undefined }
  const [project, envData, domainData] = await Promise.all([
    call(token, `/v9/projects/${encodeURIComponent(id)}`, scope),
    call(token, `/v10/projects/${encodeURIComponent(id)}/env`, { ...scope, decrypt: 'true' }),
    call(token, `/v9/projects/${encodeURIComponent(id)}/domains`, { ...scope, limit: 50 }).catch(() => null)
  ])
  const notes = []
  // Production values; sensitive ones cannot be read back and must be typed in
  const env = []
  for (const e of envData?.envs || []) {
    const targets = Array.isArray(e.target) ? e.target : [e.target]
    if (!targets.includes('production') || e.type === 'system' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(e.key || '')) continue
    if (env.some(x => x.key === e.key)) continue
    const readable = e.type !== 'sensitive' && e.type !== 'secret' && typeof e.value === 'string' && (e.decrypted !== false || e.type === 'plain')
    env.push({ key: e.key, value: readable ? e.value : '', hasValue: readable })
  }
  const missingEnv = env.filter(e => !e.hasValue).map(e => e.key)
  const envText = [
    `# Imported from Vercel project ${project.name} (production)`,
    ...env.map(e => (e.hasValue ? `${e.key}=${quoteEnv(e.value)}` : `# ${e.key} is a sensitive variable on Vercel: enter its value\n${e.key}=`))
  ].join('\n')

  const overrides = { appDir: '', buildCommand: '', outputDir: '' }
  if (project.rootDirectory && /^[A-Za-z0-9._\/-]{1,120}$/.test(project.rootDirectory) && !project.rootDirectory.split('/').includes('..')) overrides.appDir = project.rootDirectory.replace(/^\.\/|\/+$/g, '')
  if (project.buildCommand) {
    if (PLAIN_COMMAND.test(project.buildCommand)) overrides.buildCommand = project.buildCommand
    else notes.push(`The Vercel build command "${project.buildCommand}" chains several commands; put it in a package.json script and set that as the build command.`)
  }
  if (project.outputDirectory && /^[A-Za-z0-9._\/-]{1,120}$/.test(project.outputDirectory)) overrides.outputDir = project.outputDirectory
  const gitUrl = repoUrl(project.link)
  if (!gitUrl) notes.push('The project is not connected to a Git repository on Vercel: upload the code instead.')

  const domains = (domainData?.domains || []).filter(d => !d.redirect && !/\.vercel\.app$/i.test(d.name)).map(d => d.name)
  return {
    id: project.id,
    name: project.name,
    framework: project.framework || null,
    nodeVersion: project.nodeVersion || null,
    gitUrl,
    branch: project.link?.productionBranch || 'main',
    overrides,
    env: env.map(({ key, hasValue }) => ({ key, hasValue })),
    envText,
    missingEnv,
    domains,
    supabaseRef: supabaseRefFromEnv(env),
    notes
  }
}
