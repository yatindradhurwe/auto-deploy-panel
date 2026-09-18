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

    // Verify membership (Super Admin admin-001 gets override access)
    const members = getOrganizationMembers(orgId)
    const memberRecord = members.find(m => m.userId === user.id)
    
    if (!memberRecord && user.id !== 'admin-001' && user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied: You are not a member of this organization.' })
    }

    const memberRole = memberRecord ? memberRecord.role : (user.id === 'admin-001' ? 'OWNER' : 'VIEWER')

    // Resolve active serverId from header > query > body > first org server
    let serverId = req.headers['x-server-id'] || req.query.serverId || (req.body && req.body.serverId)
    let server = null

    if (serverId) {
      server = getServerById(serverId)
    }

    if (!server) {
      const orgServers = getServersByOrgId(orgId)
      if (orgServers.length > 0) {
        server = orgServers[0]
        serverId = server.id
      } else {
        serverId = 'srv-default'
        server = getServerById('srv-default')
      }
    }

    // Attach tenant context to request
    req.tenant = {
      organizationId: orgId,
      organization,
      serverId,
      server,
      memberRole
    }

    next()
  } catch (err) {
    console.error('[TENANT MIDDLEWARE ERROR]:', err)
    res.status(500).json({ error: 'Internal tenant context initialization error.' })
  }
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

    const role = req.tenant.memberRole
    if (allowedRoles.includes(role) || req.user.id === 'admin-001') {
      return next()
    }

    return res.status(403).json({
      error: `Access denied. Action requires one of the following roles: ${allowedRoles.join(', ')} (Your role: ${role})`
    })
  }
}
