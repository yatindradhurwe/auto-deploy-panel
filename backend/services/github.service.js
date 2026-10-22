import crypto from 'crypto'
import { getIntegrations } from './integrations.service.js'
import { saveUserSettings } from './db.service.js'

/**
 * GitHub access for deployments: "Sign in with GitHub" through the platform's GitHub OAuth App
 * (configured by the super admin under Integrations), or a personal access token pasted by the
 * user. Either way the resulting token is saved in the user's settings as `githubToken`, and
 * `githubAuthType` records which one it is ('oauth' | 'token').
 */

const API = 'https://api.github.com'
const UA = 'AutoDeploy-Console-App'
const STATE_TTL_MS = 10 * 60 * 1000
const MAX_REPO_PAGES = 30 // 3000 repositories
// repo: clone/pull private repositories; read:org: list repositories of the user's organizations
export const OAUTH_SCOPES = 'repo read:user read:org'

const pending = new Map() // state -> { userId, redirectUri, expires }

const httpError = (status, message) => Object.assign(new Error(message), { status })
export const bareToken = (t) => String(t || '').trim().replace(/^(bearer|token) /i, '')

/** Callback URL of the panel as the browser reaches it (https://panel.example.com/api/github/oauth/callback). */
export const callbackUrl = (req) => `${req.protocol}://${req.get('host')}/api/github/oauth/callback`

function oauthConfig() {
  const c = getIntegrations().github || {}
  return c.enabled && c.clientId && c.clientSecret ? c : null
}

export const githubOAuthAvailable = () => !!oauthConfig()

/** GitHub's authorize URL for this user. The state ties the callback back to the user and expires after 10 minutes. */
export function startGithubOAuth(userId, redirectUri) {
  const cfg = oauthConfig()
  if (!cfg) throw httpError(400, 'Sign in with GitHub is not set up on this platform yet. Connect with a personal access token instead.')
  const now = Date.now()
  for (const [s, p] of pending) if (p.expires < now) pending.delete(s)
  const state = crypto.randomBytes(24).toString('hex')
  pending.set(state, { userId, redirectUri, expires: now + STATE_TTL_MS })
  const params = new URLSearchParams({ client_id: cfg.clientId, redirect_uri: redirectUri, scope: OAUTH_SCOPES, state, allow_signup: 'true' })
  return `https://github.com/login/oauth/authorize?${params}`
}

/** Exchanges the callback's code for a token and saves it to the user who started the sign-in. */
export async function finishGithubOAuth({ code, state, error, error_description: errorDescription }) {
  const p = pending.get(String(state || ''))
  pending.delete(String(state || ''))
  if (!p || p.expires < Date.now()) throw httpError(400, 'This sign-in link has expired. Close this window and click "Sign in with GitHub" again.')
  if (error) throw httpError(400, error === 'access_denied' ? 'GitHub access was not granted.' : `GitHub: ${errorDescription || error}`)
  const cfg = oauthConfig()
  if (!cfg) throw httpError(400, 'Sign in with GitHub is not set up on this platform.')
  const r = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code: String(code || ''), redirect_uri: p.redirectUri }),
    signal: AbortSignal.timeout(15000)
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || !data.access_token) throw httpError(400, `GitHub sign-in failed: ${data.error_description || data.error || r.status}`)
  const user = await githubUser(data.access_token)
  saveUserSettings(p.userId, { githubToken: data.access_token, githubAuthType: 'oauth' })
  return { userId: p.userId, login: user.login }
}

async function gh(token, pathAndQuery, { method = 'GET' } = {}) {
  const r = await fetch(`${API}${pathAndQuery}`, {
    method,
    headers: { Authorization: `Bearer ${bareToken(token)}`, 'User-Agent': UA, Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(20000)
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw httpError(r.status === 401 ? 401 : 502, `GitHub: ${data.message || r.status}`)
  return { data, link: r.headers.get('link') || '' }
}

export async function githubUser(token) {
  return (await gh(token, '/user')).data
}

/** Every repository the account can reach: its own, collaborations and its organizations' (newest activity first). */
export async function listGithubRepos(token) {
  const repos = []
  for (let page = 1; page <= MAX_REPO_PAGES; page++) {
    const { data, link } = await gh(token, `/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`)
    if (!Array.isArray(data)) throw httpError(502, 'Unexpected response from GitHub.')
    repos.push(...data)
    if (!/rel="next"/.test(link)) break
  }
  return repos.map(repo => ({
    id: repo.id,
    name: repo.name,
    full_name: repo.full_name,
    owner: repo.owner?.login || '',
    private: repo.private,
    description: repo.description,
    html_url: repo.html_url,
    clone_url: repo.clone_url || '',
    default_branch: repo.default_branch || 'main',
    updated_at: repo.pushed_at || repo.updated_at,
    language: repo.language
  }))
}

/** Revokes an OAuth sign-in on GitHub (best effort), so disconnecting really removes the panel's access. */
export async function revokeGithubOAuth(token) {
  const cfg = getIntegrations().github || {}
  if (!cfg.clientId || !cfg.clientSecret || !token) return
  await fetch(`${API}/applications/${encodeURIComponent(cfg.clientId)}/grant`, {
    method: 'DELETE',
    headers: {
      Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')}`,
      'User-Agent': UA,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ access_token: bareToken(token) }),
    signal: AbortSignal.timeout(15000)
  }).catch(() => {})
}

/**
 * Checks the saved OAuth App credentials: GitHub answers 404 (token not found) for a valid
 * Client ID and secret checking a made-up token, and 401 for wrong credentials.
 */
export async function testGithubApp() {
  const cfg = getIntegrations().github || {}
  if (!cfg.clientId || !cfg.clientSecret) throw httpError(400, 'Save the Client ID and Client secret first.')
  const r = await fetch(`${API}/applications/${encodeURIComponent(cfg.clientId)}/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')}`,
      'User-Agent': UA,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ access_token: `gho_${crypto.randomBytes(18).toString('hex')}` }),
    signal: AbortSignal.timeout(15000)
  })
  if (r.status === 404 || r.status === 422) return { message: `GitHub accepted the Client ID and secret.${cfg.enabled ? '' : ' Turn on "Enable" and save so users see Sign in with GitHub.'}` }
  if (r.status === 401) throw httpError(400, 'GitHub rejected the Client ID or Client secret.')
  throw httpError(502, `Unexpected answer from GitHub (${r.status}).`)
}
