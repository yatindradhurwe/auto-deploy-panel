import path from 'path'
import {
  isSuperSession,
  isOrgAdmin,
  isPlatformHost,
  projectLevel,
  hasLevel,
  normalizeProjectPath
} from '../services/project-access.service.js'
import { isLocalServer } from '../services/host.service.js'
import { getSessionOwner } from '../services/project-agent.service.js'

/**
 * Authorization for /api/studio (runs after authenticateToken + requireTenant).
 *
 * Deny by default: an endpoint missing from POLICIES stays super-admin-only.
 *  - list            any organization member (results are filtered per project in the route)
 *  - project:viewer  read-only project actions
 *  - project:manager project changes (deploy, restart, env, files, git)
 *  - org-admin       organization OWNER/ADMIN on their own servers
 *  - agent-session   an AI agent session of the caller's organization, on a project they manage
 * AI provider settings (/ai/agent/settings) are intentionally absent: super admin only.
 * Organization users never reach the panel's own host.
 */
const POLICIES = [
  [/^\/servers$/, 'list', { needsServer: false }],
  [/^\/(projects|projects\/realtime-fetch|server-metrics|logs\/telemetry)$/, 'list'],
  [/^\/(pm2\/logs|git\/status|git\/history)$/, 'project:viewer'],
  [/^\/(git\/(pull|push|pull-and-update|rollback)|pm2\/control|env\/(get|save)|files\/(tree|read|save|create|delete|upload)|project-settings\/(get|save|pwa-check))$/, 'project:manager'],
  [/^\/servers\/(test|add|update|delete)$/, 'org-admin', { needsServer: false }],
  [/^\/(webhooks\/logs|email\/.+)$/, 'org-admin', { needsServer: false }],
  [/^\/ai\/agent\/status$/, 'list', { needsServer: false }],
  [/^\/ai\/agent\/sessions$/, 'project:manager'],
  [/^\/ai\/agent\/sessions\/[^/]+(\/(delete|message|stop|changes|revert|deploy))?$/, 'agent-session'],
  [/^\/(servers\/scan|terminal\/exec|nginx\/config|ssl\/(issue|certificates)|cron\/(list|save)|databases(\/[a-z-]+)?|projects\/delete)$/, 'org-admin']
]

const deny = (res, status, error, code) => res.status(status).json({ success: false, error, ...(code ? { code } : {}) })

function insideProject(dir, target) {
  return target === dir || target.startsWith(dir.endsWith('/') ? dir : `${dir}/`)
}

/**
 * Paths a shared member's file operation touches, resolved the same way the routes resolve them.
 */
function touchedPaths(route, body, dir) {
  const resolveIn = (p) => (path.posix.isAbsolute(p) ? path.posix.normalize(p) : path.posix.resolve(dir, p))
  switch (route) {
    case '/files/read':
    case '/files/save':
      return [resolveIn(String(body.filePath || ''))]
    case '/files/delete':
      return [path.posix.normalize(String(body.filePath || ''))]
    case '/files/create':
      return [path.posix.resolve(dir, String(body.relativePath || ''))]
    case '/files/upload': {
      const base = body.targetDir ? path.posix.resolve(dir, String(body.targetDir)) : dir
      return [base, ...(Array.isArray(body.files) ? body.files : []).map((f) => path.posix.resolve(base, String(f?.relativePath || '')))]
    }
    default:
      return []
  }
}

export function requireStudioAccess(req, res, next) {
  if (isSuperSession(req)) {
    req.studioAccess = { level: 'super' }
    return next()
  }

  const route = req.path
  const match = POLICIES.find(([re]) => re.test(route))
  if (!match) return deny(res, 403, 'Access denied. This action requires platform administrator privileges.')
  const [, policy, { needsServer = true } = {}] = match

  if (needsServer && isPlatformHost(req.tenant?.server)) {
    return deny(res, 403, 'Select one of your organization\'s servers. The platform host is managed by platform staff.', 'PLATFORM_HOST')
  }

  if (policy === 'list') {
    req.studioAccess = { level: isOrgAdmin(req) ? 'owner' : 'member' }
    return next()
  }

  if (policy === 'org-admin') {
    if (!isOrgAdmin(req)) return deny(res, 403, 'Only organization owners and admins can do this.')
    req.studioAccess = { level: 'owner' }
    return next()
  }

  if (policy === 'agent-session') {
    let owner
    try { owner = getSessionOwner(route.split('/')[4]) } catch { return deny(res, 404, 'Session not found.') }
    if (!owner.metered || owner.organizationId !== req.tenant?.organizationId || owner.serverId !== (req.tenant?.server?.id || null)) {
      return deny(res, 404, 'Session not found.')
    }
    const level = projectLevel(req, { projectPath: owner.projectPath })
    if (!hasLevel(level, 'manager')) return deny(res, 403, level ? 'Your access to this project is read-only.' : 'You do not have access to this project.')
    req.studioAccess = { level }
    return next()
  }

  // Project actions
  const body = { ...(req.query || {}), ...(req.body || {}) }
  const required = policy === 'project:manager' ? 'manager' : 'viewer'
  const dir = normalizeProjectPath(body.projectPath)
  const isPm2 = route.startsWith('/pm2/')
  const appName = isPm2 || route === '/git/pull-and-update' ? (body.appName ? String(body.appName) : null) : null

  if (isOrgAdmin(req)) {
    req.studioAccess = { level: 'owner' }
    return next()
  }

  // Shared members: always name the project (and the PM2 process for PM2 actions)
  if (isPm2 && (body.processId !== undefined && body.processId !== null && body.processId !== '')) {
    return deny(res, 400, 'Use the app name to control processes.')
  }
  if (!dir && !(isPm2 && appName)) return deny(res, 403, 'You do not have access to this project.')
  if (isPm2 && !appName) return deny(res, 400, 'appName is required.')

  const level = projectLevel(req, { projectPath: dir, appName })
  if (!hasLevel(level, required)) {
    return deny(res, 403, level ? 'Your access to this project is read-only.' : 'You do not have access to this project.')
  }

  if (route.startsWith('/files/')) {
    const paths = touchedPaths(route, body, dir)
    if (paths.some((p) => !p || !insideProject(dir, p)) || (route === '/files/delete' && paths[0] === dir)) {
      return deny(res, 403, 'You can only change files inside the shared project.')
    }
  }

  req.studioAccess = { level }
  next()
}

// Deploy helpers any organization member may use; they don't touch a server
const DEPLOY_MEMBER_PATHS = /^\/(analyze-git|detect-stack|get-github-token|save-github-token|github-repos|ai-copilot)$/

/**
 * Authorization for /api/deploy: deploying and SSH helpers are for organization owners/admins,
 * and only ever against the organization's own servers (never the panel host).
 */
export function requireDeployAccess(req, res, next) {
  if (isSuperSession(req) || DEPLOY_MEMBER_PATHS.test(req.path)) return next()
  if (!isOrgAdmin(req)) return deny(res, 403, 'Only organization owners and admins can deploy or connect to servers.')

  const body = req.body || {}
  const target = body.config && typeof body.config === 'object' ? body.config : body
  const address = target.host || target.ipAddress || target.ip
  if (address && isLocalServer({ ipAddress: String(address) })) {
    return deny(res, 403, 'The platform host cannot be targeted from an organization account.', 'PLATFORM_HOST')
  }
  if (req.path === '/deploy' && isPlatformHost(req.tenant?.server)) {
    return deny(res, 403, 'Connect one of your own servers before deploying. The platform host is managed by platform staff.', 'PLATFORM_HOST')
  }
  next()
}
