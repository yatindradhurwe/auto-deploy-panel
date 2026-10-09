import path from 'path'
import crypto from 'crypto'
import { readDb, writeDb, getOrganizationMembers } from './db.service.js'
import { isSystemAdminUser } from '../config/secrets.js'
import { isLocalServer } from './host.service.js'

/**
 * Who may do what with a project on an organization's server.
 *
 * Levels, strongest first:
 *  - 'super'   platform super admin (console session): everything, including the panel host
 *  - 'owner'   organization OWNER/ADMIN: every project on the organization's own servers
 *  - 'manager' shared with a DEVELOPER/VIEWER: deploy, restart, logs, env, files, git for that project
 *  - 'viewer'  shared read-only: status, logs, git history
 *
 * A project is identified by its server and directory (projects are discovered on the server,
 * so not every project has a database record).
 */

export const SHARE_ROLES = ['manager', 'viewer']
export const ORG_ADMIN_ROLES = ['OWNER', 'ADMIN']
const RANK = { viewer: 1, manager: 2, owner: 3, super: 4 }

const httpError = (status, message) => Object.assign(new Error(message), { status })

export function normalizeProjectPath(projectPath) {
  if (!projectPath || typeof projectPath !== 'string' || !projectPath.startsWith('/')) return null
  return path.posix.resolve(projectPath)
}

export function isSuperSession(req) {
  return isSystemAdminUser(req.user) && !req.user.impersonatedBy && req.user.portal === 'console'
}

export function memberRole(req) {
  return String(req.tenant?.memberRole || '').toUpperCase()
}

export function isOrgAdmin(req) {
  return isSuperSession(req) || ORG_ADMIN_ROLES.includes(memberRole(req))
}

/** The panel's own host is root on the platform; only super admins may touch it. */
export function isPlatformHost(server) {
  return !server || isLocalServer(server) || !server.organizationId || server.organizationId === 'org-default'
}

function allShares() {
  return readDb().projectShares || []
}

export function sharesForUser(userId, organizationId, serverId = null) {
  return allShares().filter((s) => s.userId === userId && s.organizationId === organizationId && (!serverId || s.serverId === serverId))
}

export function sharesForProject(organizationId, serverId, projectPath) {
  const dir = normalizeProjectPath(projectPath)
  const db = readDb()
  return (db.projectShares || [])
    .filter((s) => s.organizationId === organizationId && s.serverId === serverId && s.projectPath === dir)
    .map((s) => {
      const u = (db.users || {})[s.userId]
      return { ...s, fullName: u ? u.fullName : 'Deleted user', email: u ? u.email : '' }
    })
}

/**
 * The caller's level for one project on the selected server, or null for no access.
 * Pass `projectPath`, or `appName` for PM2 actions: a shared member may only act on the PM2
 * processes recorded on their share.
 */
export function projectLevel(req, { projectPath = null, appName = null } = {}) {
  if (isSuperSession(req)) return 'super'
  const server = req.tenant?.server
  if (!server || isPlatformHost(server)) return null
  if (ORG_ADMIN_ROLES.includes(memberRole(req))) return 'owner'
  const dir = normalizeProjectPath(projectPath)
  const share = sharesForUser(req.user.id, req.tenant.organizationId, server.id)
    .find((s) => (!dir || s.projectPath === dir) && (!appName || (s.appNames || []).includes(String(appName))))
  return share && (dir || appName) ? share.role : null
}

export function hasLevel(level, required) {
  return !!level && RANK[level] >= RANK[required]
}

/**
 * Adds `access` to each discovered project and drops the ones the caller can't see.
 */
export function filterProjectsForUser(req, projects) {
  return projects
    .map((p) => ({ ...p, access: projectLevel(req, { projectPath: p.path || p.projectPath }) }))
    .filter((p) => p.access)
}

export function grantShare(req, { projectPath, appNames = [], projectName, userId, role }) {
  if (!isOrgAdmin(req)) throw httpError(403, 'Only organization owners and admins can share projects.')
  const server = req.tenant?.server
  if (!server) throw httpError(400, 'Select a server first.')
  if (isPlatformHost(server) && !isSuperSession(req)) throw httpError(403, 'Projects on the platform host cannot be shared.')
  const dir = normalizeProjectPath(projectPath)
  if (!dir) throw httpError(400, 'A valid absolute projectPath is required.')
  if (!SHARE_ROLES.includes(role)) throw httpError(400, 'role must be "manager" or "viewer".')

  const orgId = req.tenant.organizationId
  const member = getOrganizationMembers(orgId).find((m) => m.userId === userId)
  if (!member) throw httpError(400, 'Projects can only be shared with members of your organization. Invite them from Team first.')
  if (ORG_ADMIN_ROLES.includes(String(member.role).toUpperCase())) throw httpError(400, `${member.email} is an organization ${member.role} and already has full access to every project.`)
  if (userId === req.user.id) throw httpError(400, 'You cannot share a project with yourself.')

  const db = readDb()
  if (!db.projectShares) db.projectShares = []
  const now = new Date().toISOString()
  const names = (Array.isArray(appNames) ? appNames : [appNames]).map(String).filter((n) => /^[a-zA-Z0-9._-]{1,100}$/.test(n)).slice(0, 20)
  let share = db.projectShares.find((s) => s.organizationId === orgId && s.serverId === server.id && s.projectPath === dir && s.userId === userId)
  if (share) {
    Object.assign(share, { role, updatedAt: now, appNames: names.length ? names : share.appNames || [], projectName: projectName || share.projectName || null })
  } else {
    share = {
      id: `shr-${crypto.randomBytes(8).toString('hex')}`,
      organizationId: orgId,
      serverId: server.id,
      projectPath: dir,
      appNames: names,
      projectName: projectName ? String(projectName).slice(0, 100) : path.posix.basename(dir),
      userId,
      role,
      grantedBy: req.user.id,
      grantedAt: now
    }
    db.projectShares.push(share)
  }
  writeDb(db)
  return { share, member }
}

function requireOwnShare(req, shareId) {
  if (!isOrgAdmin(req)) throw httpError(403, 'Only organization owners and admins can change project sharing.')
  const share = allShares().find((s) => s.id === shareId)
  if (!share || (share.organizationId !== req.tenant.organizationId && !isSuperSession(req))) throw httpError(404, 'Share not found.')
  return share
}

export function updateShareRole(req, shareId, role) {
  const share = requireOwnShare(req, shareId)
  if (!SHARE_ROLES.includes(role)) throw httpError(400, 'role must be "manager" or "viewer".')
  const db = readDb()
  const saved = db.projectShares.find((s) => s.id === share.id)
  saved.role = role
  saved.updatedAt = new Date().toISOString()
  writeDb(db)
  return saved
}

export function revokeShare(req, shareId) {
  const share = requireOwnShare(req, shareId)
  const db = readDb()
  db.projectShares = db.projectShares.filter((s) => s.id !== share.id)
  writeDb(db)
  return share
}

/** Called when someone leaves an organization so their project access goes with them. */
export function removeSharesForMember(organizationId, userId) {
  const db = readDb()
  const before = (db.projectShares || []).length
  db.projectShares = (db.projectShares || []).filter((s) => !(s.organizationId === organizationId && s.userId === userId))
  if (db.projectShares.length !== before) writeDb(db)
}
