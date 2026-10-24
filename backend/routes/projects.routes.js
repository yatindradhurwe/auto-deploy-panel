import express from 'express'
import { authenticateToken } from '../middleware/auth.middleware.js'
import { requireTenant, requireSelectedServer } from '../middleware/tenant.middleware.js'
import { recordAuditLog, getOrganizationMembers, getServersByOrgId } from '../services/db.service.js'
import {
  ORG_ADMIN_ROLES,
  isOrgAdmin,
  isPlatformHost,
  sharesForProject,
  sharesForUser,
  grantShare,
  updateShareRole,
  revokeShare
} from '../services/project-access.service.js'
import { listTokens, createToken, revokeToken } from '../services/mcp.service.js'

/**
 * Project sharing: organization owners/admins give team members Manager or Viewer access to a
 * project on one of the organization's servers. Enforcement lives in studioAccess.middleware.
 */
const router = express.Router()

router.use(authenticateToken, requireTenant)
// Listing and granting shares act on the selected server; never fall back to another one
router.use('/shares', (req, res, next) => (req.path === '/' ? requireSelectedServer(req, res, next) : next()))
router.use('/mcp', requireSelectedServer)

const handle = (fn) => (req, res) => {
  try {
    res.json(fn(req))
  } catch (err) {
    const status = err.status || 400
    if (status >= 500) console.error('[PROJECTS API ERROR]:', err)
    res.status(status).json({ success: false, error: err.message })
  }
}

const handleAsync = (fn) => async (req, res) => {
  try {
    res.json(await fn(req))
  } catch (err) {
    const status = err.status || 400
    if (status >= 500) console.error('[PROJECTS API ERROR]:', err)
    res.status(status).json({ success: false, error: err.message })
  }
}

const httpError = (status, message) => Object.assign(new Error(message), { status })

const audit = (req, action, resourceId, details = {}) => recordAuditLog({
  organizationId: req.tenant.organizationId,
  userId: req.user.id,
  action,
  resourceType: 'project_share',
  resourceId,
  ip: String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim(),
  details: { email: req.user.email, ...details }
})

function requireOrgAdmin(req) {
  if (!isOrgAdmin(req)) throw httpError(403, 'Only organization owners and admins can manage project sharing.')
}

/**
 * GET /api/projects/shares?projectPath=… — who has access to a project on the selected server,
 * plus the team members it can still be shared with.
 */
router.get('/shares', handle((req) => {
  requireOrgAdmin(req)
  const serverId = req.tenant.server?.id
  if (!serverId) throw httpError(400, 'Select a server first.')
  const shares = sharesForProject(req.tenant.organizationId, serverId, req.query.projectPath)
  const sharedIds = new Set(shares.map((s) => s.userId))
  const members = getOrganizationMembers(req.tenant.organizationId).map((m) => ({
    userId: m.userId,
    fullName: m.fullName,
    email: m.email,
    role: m.role,
    fullAccess: ORG_ADMIN_ROLES.includes(String(m.role).toUpperCase()),
    shared: sharedIds.has(m.userId)
  }))
  return { success: true, shares, members, shareable: !isPlatformHost(req.tenant.server) }
}))

router.post('/shares', handle((req) => {
  const { projectPath, appNames, projectName, userId, role = 'manager' } = req.body || {}
  const { share, member } = grantShare(req, { projectPath, appNames, projectName, userId, role })
  audit(req, 'PROJECT_SHARED', share.id, { projectPath: share.projectPath, serverId: share.serverId, member: member.email, role })
  return { success: true, share: { ...share, fullName: member.fullName, email: member.email } }
}))

router.patch('/shares/:id', handle((req) => {
  const share = updateShareRole(req, req.params.id, (req.body || {}).role)
  audit(req, 'PROJECT_SHARE_UPDATED', share.id, { projectPath: share.projectPath, role: share.role })
  return { success: true, share }
}))

router.delete('/shares/:id', handle((req) => {
  const share = revokeShare(req, req.params.id)
  audit(req, 'PROJECT_SHARE_REVOKED', share.id, { projectPath: share.projectPath, userId: share.userId })
  return { success: true }
}))

/**
 * GET /api/projects/shared-with-me — projects shared with the caller across the organization's servers.
 */
router.get('/shared-with-me', handle((req) => {
  const servers = new Map(getServersByOrgId(req.tenant.organizationId).map((s) => [s.id, s]))
  const shares = sharesForUser(req.user.id, req.tenant.organizationId).map((s) => ({
    ...s,
    serverName: servers.get(s.serverId)?.name || s.serverId
  }))
  return { success: true, shares, fullAccess: isOrgAdmin(req) }
}))

/**
 * MCP access tokens: let an AI client (Claude Code, Claude Desktop, Cursor…) work on a project
 * through the panel's MCP endpoint, /api/mcp (services/mcp.service.js).
 */
function mcpEndpoint(req) {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim()
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim()
  return `${proto}://${host}/api/mcp`
}

router.get('/mcp/tokens', handle((req) => ({ success: true, endpoint: mcpEndpoint(req), tokens: listTokens(req, req.query.projectPath) })))

router.post('/mcp/tokens', handleAsync(async (req) => {
  const { projectPath, projectName, name, access, expiresInDays } = req.body || {}
  const { token, secret } = await createToken(req, { projectPath, projectName, name, access, expiresInDays })
  recordAuditLog({
    organizationId: req.tenant.organizationId,
    userId: req.user.id,
    action: 'MCP_TOKEN_CREATED',
    resourceType: 'mcp_token',
    resourceId: token.id,
    ip: String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim(),
    details: { email: req.user.email, projectPath: token.projectPath, access: token.access, name: token.name, expiresAt: token.expiresAt }
  })
  return { success: true, endpoint: mcpEndpoint(req), token, secret }
}))

router.delete('/mcp/tokens/:id', handle((req) => {
  const token = revokeToken(req, req.params.id)
  recordAuditLog({
    organizationId: req.tenant.organizationId,
    userId: req.user.id,
    action: 'MCP_TOKEN_REVOKED',
    resourceType: 'mcp_token',
    resourceId: token.id,
    ip: String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim(),
    details: { email: req.user.email, projectPath: token.projectPath, name: token.name }
  })
  return { success: true }
}))

export default router
