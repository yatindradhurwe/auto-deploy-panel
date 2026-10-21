import { isSystemAdminUser } from '../config/secrets.js'
import { getOrganizationById, getOrganizationsByUserId, getOrganizationMembers, getServerById, getServersByOrgId, getUserById } from '../services/db.service.js'

/**
 * Tenant Context Middleware
 * Enforces organization_id isolation and populates req.tenant
 */
export const requireTenant = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required before tenant scoping.' })
  }

  try {
    const user = getUserById(req.user.id) || req.user
    
    // Resolve organizationId from header > query > body > user default
    let orgId = req.headers['x-organization-id'] || req.query.orgId || req.query.organizationId || (req.body && req.body.organizationId)
    
    if (!orgId) {
      orgId = user.organizationId
    }

    if (!orgId) {
      const userOrgs = getOrganizationsByUserId(user.id)
      if (userOrgs.length > 0) {
        orgId = userOrgs[0].id
      } else {
        orgId = 'org-default'
      }
    }

    // Verify organization existence
    const organization = getOrganizationById(orgId)
    if (!organization) {
      return res.status(404).json({ error: `Organization '${orgId}' not found.` })
    }
    if (organization.status === 'suspended' && !isSystemAdminUser(req.user)) {
      return res.status(403).json({ error: `This organization has been suspended.${organization.suspendedReason ? ` Reason: ${organization.suspendedReason}` : ''}`, code: 'ORGANIZATION_SUSPENDED' })
    }

    // Verify membership (Super Admin / Admin gets override access)
    const members = getOrganizationMembers(orgId)
    const memberRecord = members.find(m => m.userId === user.id)
    const isSystemAdmin = isSystemAdminUser(req.user)
    
    if (!memberRecord && !isSystemAdmin) {
      return res.status(403).json({ error: 'Access denied: You are not a member of this organization.' })
    }

    const memberRole = memberRecord ? memberRecord.role : (isSystemAdmin ? 'OWNER' : 'VIEWER')

    // Resolve active serverId from header > query > body > first org server
    let serverId = req.headers['x-server-id'] || req.query.serverId || (req.body && req.body.serverId)
    let server = null
    // A server the client explicitly selected but that no longer exists. Never swap in another
    // server for it: the caller would get a different server's projects and data.
    let serverMissing = false

    if (serverId) {
      server = getServerById(serverId)
      // A server from another organization is never usable, whatever id the client sends
      if (server && server.organizationId && server.organizationId !== orgId && !isSystemAdmin) {
        return res.status(403).json({ error: 'Access denied: this server belongs to another organization.', code: 'SERVER_FORBIDDEN' })
      }
      if (!server) {
        serverMissing = true
        serverId = null
      }
    }

    if (!server && !serverMissing) {
      const orgServers = getServersByOrgId(orgId).filter(s => !s.blocked)
      if (orgServers.length > 0) {
        server = orgServers[0]
        serverId = server.id
      } else {
        serverId = null
        server = null
      }
    }

    // Attach tenant context to request
    req.tenant = {
      organizationId: orgId,
      organization,
      serverId,
      server,
      serverMissing,
      memberRole
    }

    next()
  } catch (err) {
    console.error('[TENANT MIDDLEWARE ERROR]:', err)
    res.status(500).json({ error: 'Internal tenant context initialization error.' })
  }
}

/**
 * Answers a request that targets a selected server which no longer exists. The X-Server-Missing
 * header lets the panel refresh its server list without parsing every response.
 */
export const sendServerNotFound = (res) => res.status(404).set('X-Server-Missing', '1').json({
  success: false,
  error: 'The selected server was not found. It may have been removed; select another server.',
  code: 'SERVER_NOT_FOUND'
})

/** Rejects the request when it targets a server that does not exist (see requireTenant). */
export const requireSelectedServer = (req, res, next) => {
  if (req.tenant?.serverMissing) return sendServerNotFound(res)
  next()
}

/**
 * RBAC Role Enforcement Middleware
 * Usage: router.post('/team/invite', requireTenant, requireRole(['OWNER', 'ADMIN']), handler)
 */
export const requireRole = (allowedRoles = []) => {
  return (req, res, next) => {
    if (!req.tenant || !req.tenant.memberRole) {
      return res.status(403).json({ error: 'Tenant context missing for role verification.' })
    }

    const role = (req.tenant.memberRole || '').toUpperCase()
    const allowedUpper = allowedRoles.map(r => r.toUpperCase())
    const isSuperAdmin = isSystemAdminUser(req.user)

    if (allowedUpper.includes(role) || isSuperAdmin) {
      return next()
    }

    return res.status(403).json({
      error: `Access denied. Action requires one of the following roles: ${allowedRoles.join(', ')} (Your role: ${role})`
    })
  }
}

/**
 * Validates that target resource (e.g. server, project) belongs to requesting tenant organization
 */
export const validateResourceOwnership = (resource, req) => {
  if (!resource) return false
  if (isSystemAdminUser(req.user)) {
    return true
  }
  if (!req.tenant || !req.tenant.organizationId) return false
  return resource.organizationId === req.tenant.organizationId
}

