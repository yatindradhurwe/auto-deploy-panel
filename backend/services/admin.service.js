import crypto from 'crypto'
import { readDb, writeDb } from './db.service.js'

export const PRIMARY_ADMIN_ID = 'admin-001'

const DEFAULT_PLATFORM_SETTINGS = {
  allowSignups: true,
  defaultSignupPlanId: 'FREE',
  maintenanceMode: false,
  maintenanceMessage: 'The platform is undergoing scheduled maintenance. Please check back shortly.',
  announcement: ''
}

/**
 * Platform role of a user:
 *  - 'superadmin': runs the platform (users, subscriptions, support, plans, settings, audit)
 *  - 'admin': a customer who manages their own servers and projects in the panel
 * The primary account is always a super admin.
 */
export const PLATFORM_ROLES = ['superadmin', 'admin']

export function getPlatformRole(user) {
  if (!user) return 'admin'
  if (user.id === PRIMARY_ADMIN_ID) return 'superadmin'
  return user.platformRole === 'superadmin' ? 'superadmin' : 'admin'
}

export function getUserStatus(user) {
  return user && user.status === 'suspended' ? 'suspended' : 'active'
}

/**
 * Strips secrets (password hash, tokens, saved SSH credentials) before a user leaves the server.
 */
export function sanitizeUser(user) {
  if (!user) return null
  const settings = user.settings || {}
  return {
    id: user.id,
    fullName: user.fullName || user.name || '',
    email: user.email,
    organizationId: user.organizationId || null,
    platformRole: getPlatformRole(user),
    status: getUserStatus(user),
    suspendedReason: user.suspendedReason || null,
    suspendedAt: user.suspendedAt || null,
    isVerified: !!user.isVerified,
    twoFactorEnabled: !!user.twoFactorEnabled,
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null,
    lastLoginAt: user.lastLoginAt || null,
    lastLoginIp: user.lastLoginIp || null,
    hasSshCredentials: !!(settings.password || settings.privateKey),
    hasGithubToken: !!settings.githubToken
  }
}

/**
 * Strips SSH passwords, private keys and agent tokens from a server record.
 */
export function sanitizeServer(server) {
  if (!server) return null
  const { password, privateKey, agentToken, ftpPassword, ...safe } = server
  return { ...safe, hasPassword: !!password, hasPrivateKey: !!privateKey, hasAgentToken: !!agentToken }
}

export function generateTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#%+='
  let pw = ''
  while (!(/[A-Z]/.test(pw) && /[a-z]/.test(pw) && /[0-9]/.test(pw) && /[@#%+=]/.test(pw))) {
    pw = Array.from(crypto.randomBytes(16), (b) => chars[b % chars.length]).join('')
  }
  return pw
}

// --- Platform settings ---

export function getPlatformSettings() {
  const db = readDb()
  return { ...DEFAULT_PLATFORM_SETTINGS, ...(db.platformSettings || {}) }
}

export function savePlatformSettings(updates) {
  const db = readDb()
  const allowed = {}
  if (typeof updates.allowSignups === 'boolean') allowed.allowSignups = updates.allowSignups
  if (typeof updates.maintenanceMode === 'boolean') allowed.maintenanceMode = updates.maintenanceMode
  if (typeof updates.maintenanceMessage === 'string') allowed.maintenanceMessage = updates.maintenanceMessage.slice(0, 500)
  if (typeof updates.announcement === 'string') allowed.announcement = updates.announcement.slice(0, 500)
  if (typeof updates.defaultSignupPlanId === 'string') {
    if (!(db.plans || {})[updates.defaultSignupPlanId]) {
      throw new Error(`Plan '${updates.defaultSignupPlanId}' does not exist.`)
    }
    allowed.defaultSignupPlanId = updates.defaultSignupPlanId
  }
  db.platformSettings = { ...DEFAULT_PLATFORM_SETTINGS, ...(db.platformSettings || {}), ...allowed, updatedAt: new Date().toISOString() }
  writeDb(db)
  return db.platformSettings
}

// --- Aggregates ---

/**
 * Builds per-organization usage and membership lookups in a single DB read.
 */
function buildIndexes(db) {
  const membersByOrg = {}
  const orgsByUser = {}
  for (const m of db.organizationMembers || []) {
    ;(membersByOrg[m.organizationId] ||= []).push(m)
    ;(orgsByUser[m.userId] ||= []).push(m)
  }
  const serversByOrg = {}
  for (const s of Object.values(db.servers || {})) (serversByOrg[s.organizationId] ||= []).push(s)
  const projectsByOrg = {}
  for (const p of Object.values(db.projects || {})) (projectsByOrg[p.organizationId] ||= []).push(p)
  return { membersByOrg, orgsByUser, serversByOrg, projectsByOrg }
}

function summarizeOrg(org, db, idx) {
  const sub = (db.subscriptions || {})[org.id] || null
  const owner = (db.users || {})[org.ownerId]
  return {
    ...org,
    status: org.status === 'suspended' ? 'suspended' : 'active',
    planId: (sub && sub.planId) || org.planId || 'FREE',
    subscriptionStatus: sub ? sub.status : 'none',
    currentPeriodEnd: sub ? sub.currentPeriodEnd : null,
    ownerName: owner ? owner.fullName : null,
    ownerEmail: owner ? owner.email : null,
    memberCount: (idx.membersByOrg[org.id] || []).length,
    serverCount: (idx.serversByOrg[org.id] || []).length,
    projectCount: (idx.projectsByOrg[org.id] || []).length
  }
}

export function getPlatformOverview() {
  const db = readDb()
  const users = Object.values(db.users || {})
  const orgs = Object.values(db.organizations || {})
  const subs = Object.values(db.subscriptions || {})
  const plans = db.plans || {}
  const now = Date.now()
  const dayMs = 86400000

  const activeSubs = subs.filter((s) => s.status === 'active')
  const planBreakdown = {}
  let mrr = 0
  for (const s of activeSubs) {
    planBreakdown[s.planId] = (planBreakdown[s.planId] || 0) + 1
    mrr += Number((plans[s.planId] || {}).priceMonthly || 0)
  }

  // Signups per day for the last 14 days (oldest first)
  const signupTrend = []
  for (let i = 13; i >= 0; i--) {
    const dayStart = new Date(now - i * dayMs)
    dayStart.setHours(0, 0, 0, 0)
    const dayEnd = dayStart.getTime() + dayMs
    signupTrend.push({
      date: dayStart.toISOString().slice(0, 10),
      count: users.filter((u) => {
        const t = new Date(u.createdAt || 0).getTime()
        return t >= dayStart.getTime() && t < dayEnd
      }).length
    })
  }

  const idx = buildIndexes(db)
  const byNewest = (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)

  return {
    metrics: {
      totalUsers: users.length,
      activeUsers: users.filter((u) => getUserStatus(u) === 'active').length,
      suspendedUsers: users.filter((u) => getUserStatus(u) === 'suspended').length,
      platformAdmins: users.filter((u) => getPlatformRole(u) === 'superadmin').length,
      newUsersLast7Days: users.filter((u) => now - new Date(u.createdAt || 0).getTime() < 7 * dayMs).length,
      activeLast7Days: users.filter((u) => u.lastLoginAt && now - new Date(u.lastLoginAt).getTime() < 7 * dayMs).length,
      totalOrganizations: orgs.length,
      suspendedOrganizations: orgs.filter((o) => o.status === 'suspended').length,
      totalServers: Object.keys(db.servers || {}).length,
      totalProjects: Object.keys(db.projects || {}).length,
      totalSubscriptions: subs.length,
      activeSubscriptions: activeSubs.length,
      estimatedMrr: mrr,
      openSupportTickets: (db.supportTickets || []).filter((t) => t.status === 'open').length
    },
    planBreakdown,
    signupTrend,
    recentUsers: [...users].sort(byNewest).slice(0, 6).map(sanitizeUser),
    recentOrganizations: [...orgs].sort(byNewest).slice(0, 6).map((o) => summarizeOrg(o, db, idx)),
    recentAdminActions: (db.auditLogs || []).filter((l) => String(l.action || '').startsWith('ADMIN_')).slice(0, 8),
    settings: getPlatformSettings()
  }
}

export function listUsersForAdmin({ search = '', status = '', role = '' } = {}) {
  const db = readDb()
  const idx = buildIndexes(db)
  const q = search.trim().toLowerCase()
  return Object.values(db.users || {})
    .map((u) => ({ ...sanitizeUser(u), organizationCount: (idx.orgsByUser[u.id] || []).length }))
    .filter((u) => !q || `${u.fullName} ${u.email} ${u.id}`.toLowerCase().includes(q))
    .filter((u) => !status || u.status === status)
    .filter((u) => !role || u.platformRole === role)
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
}

export function getUserDetailForAdmin(userId) {
  const db = readDb()
  const user = (db.users || {})[userId]
  if (!user) return null
  const idx = buildIndexes(db)
  const memberships = (idx.orgsByUser[userId] || []).map((m) => {
    const org = (db.organizations || {})[m.organizationId]
    return {
      organizationId: m.organizationId,
      organizationName: org ? org.name : m.organizationId,
      role: m.role,
      isOwner: org ? org.ownerId === userId : false,
      planId: org ? summarizeOrg(org, db, idx).planId : null,
      joinedAt: m.joinedAt
    }
  })
  const activity = (db.auditLogs || []).filter((l) => l.userId === userId || l.resourceId === userId).slice(0, 25)
  return { user: sanitizeUser(user), memberships, activity }
}

export function listOrganizationsForAdmin({ search = '', status = '', planId = '' } = {}) {
  const db = readDb()
  const idx = buildIndexes(db)
  const q = search.trim().toLowerCase()
  return Object.values(db.organizations || {})
    .map((o) => summarizeOrg(o, db, idx))
    .filter((o) => !q || `${o.name} ${o.id} ${o.ownerEmail || ''}`.toLowerCase().includes(q))
    .filter((o) => !status || o.status === status)
    .filter((o) => !planId || o.planId === planId)
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
}

export function getOrganizationDetailForAdmin(orgId) {
  const db = readDb()
  const org = (db.organizations || {})[orgId]
  if (!org) return null
  const idx = buildIndexes(db)
  return {
    organization: summarizeOrg(org, db, idx),
    subscription: (db.subscriptions || {})[orgId] || null,
    members: (idx.membersByOrg[orgId] || []).map((m) => {
      const u = (db.users || {})[m.userId]
      return { userId: m.userId, role: m.role, joinedAt: m.joinedAt, fullName: u ? u.fullName : 'Deleted user', email: u ? u.email : '', status: getUserStatus(u) }
    }),
    servers: (idx.serversByOrg[orgId] || []).map(sanitizeServer),
    projects: (idx.projectsByOrg[orgId] || []).map((p) => ({ id: p.id, name: p.name, domain: p.domain, path: p.path, status: p.status, framework: p.framework })),
    activity: (db.auditLogs || []).filter((l) => l.organizationId === orgId).slice(0, 25)
  }
}

export function listServersForAdmin() {
  const db = readDb()
  return Object.values(db.servers || {}).map((s) => ({
    ...sanitizeServer(s),
    organizationName: ((db.organizations || {})[s.organizationId] || {}).name || s.organizationId
  }))
}

export function listSubscriptionsForAdmin() {
  const db = readDb()
  return Object.values(db.subscriptions || {}).map((s) => {
    const org = (db.organizations || {})[s.organizationId]
    const plan = (db.plans || {})[s.planId]
    return { ...s, organizationName: org ? org.name : s.organizationId, planName: plan ? plan.name : s.planId, priceMonthly: plan ? plan.priceMonthly : 0 }
  })
}

// --- Destructive operations (single read/write so related records stay consistent) ---

/**
 * Deletes an organization's platform records: memberships, subscription, server and project entries.
 * Does not touch anything on the actual servers.
 */
function removeOrganizationRecords(db, orgId) {
  delete (db.organizations || {})[orgId]
  delete (db.subscriptions || {})[orgId]
  db.organizationMembers = (db.organizationMembers || []).filter((m) => m.organizationId !== orgId)
  for (const [id, s] of Object.entries(db.servers || {})) if (s.organizationId === orgId) delete db.servers[id]
  for (const [id, p] of Object.entries(db.projects || {})) if (p.organizationId === orgId) delete db.projects[id]
  for (const u of Object.values(db.users || {})) if (u.organizationId === orgId) u.organizationId = null
}

export function deleteOrganizationCascade(orgId) {
  const db = readDb()
  if (!(db.organizations || {})[orgId]) throw new Error('Organization not found.')
  removeOrganizationRecords(db, orgId)
  writeDb(db)
}

/**
 * Deletes a user. Organizations they own are transferred to another member (promoted to OWNER),
 * or deleted when the user was the only member.
 */
export function deleteUserCascade(userId) {
  const db = readDb()
  if (!(db.users || {})[userId]) throw new Error('User not found.')
  const transferred = []
  const deletedOrgs = []

  for (const org of Object.values(db.organizations || {})) {
    if (org.ownerId !== userId) continue
    const others = (db.organizationMembers || []).filter((m) => m.organizationId === org.id && m.userId !== userId && (db.users || {})[m.userId])
    if (others.length === 0) {
      removeOrganizationRecords(db, org.id)
      deletedOrgs.push(org.id)
    } else {
      const heir = others.find((m) => m.role === 'OWNER') || others.find((m) => m.role === 'ADMIN') || others[0]
      heir.role = 'OWNER'
      org.ownerId = heir.userId
      transferred.push({ organizationId: org.id, newOwnerId: heir.userId })
    }
  }

  db.organizationMembers = (db.organizationMembers || []).filter((m) => m.userId !== userId)
  delete db.users[userId]
  writeDb(db)
  return { transferred, deletedOrgs }
}

/**
 * Changes a member's role. Making someone OWNER transfers ownership; the previous owner becomes ADMIN.
 */
export function setOrganizationMemberRole(orgId, userId, role) {
  const db = readDb()
  const org = (db.organizations || {})[orgId]
  if (!org) throw new Error('Organization not found.')
  const member = (db.organizationMembers || []).find((m) => m.organizationId === orgId && m.userId === userId)
  if (!member) throw new Error('This user is not a member of the organization.')
  if (org.ownerId === userId && role !== 'OWNER') {
    throw new Error("Make another member the OWNER before changing the current owner's role.")
  }
  if (role === 'OWNER') {
    for (const m of db.organizationMembers) {
      if (m.organizationId === orgId && m.userId !== userId && m.role === 'OWNER') m.role = 'ADMIN'
    }
    org.ownerId = userId
  }
  member.role = role
  writeDb(db)
}

// --- Plans ---

const PLAN_NUMBER_FIELDS = ['priceMonthly', 'maxServers', 'maxProjects', 'maxTeamMembers', 'maxDeploymentsPerMonth']
const PLAN_BOOLEAN_FIELDS = ['monitoring', 'apiAccess', 'teamAccess']

export function upsertPlan(planId, data, { isNew = false } = {}) {
  const db = readDb()
  if (!db.plans) db.plans = {}
  const id = String(planId || '').trim().toUpperCase()
  if (!/^[A-Z0-9_]{2,32}$/.test(id)) throw new Error('Plan ID must be 2-32 characters: A-Z, 0-9 or _.')
  if (isNew && db.plans[id]) throw new Error(`Plan '${id}' already exists.`)
  if (!isNew && !db.plans[id]) throw new Error(`Plan '${id}' not found.`)

  const plan = { ...(db.plans[id] || {}), id }
  if (typeof data.name === 'string' && data.name.trim()) plan.name = data.name.trim().slice(0, 60)
  if (!plan.name) throw new Error('Plan name is required.')
  for (const f of PLAN_NUMBER_FIELDS) {
    if (data[f] !== undefined && data[f] !== '') {
      const n = Number(data[f])
      if (!Number.isFinite(n) || n < 0) throw new Error(`${f} must be a non-negative number.`)
      plan[f] = n
    } else if (plan[f] === undefined) {
      plan[f] = 0
    }
  }
  for (const f of PLAN_BOOLEAN_FIELDS) {
    if (data[f] !== undefined) plan[f] = !!data[f]
    else if (plan[f] === undefined) plan[f] = false
  }
  if (data.isPublic !== undefined) plan.isPublic = !!data.isPublic
  else if (plan.isPublic === undefined) plan.isPublic = true

  db.plans[id] = plan
  writeDb(db)
  return plan
}

export function deletePlan(planId) {
  const db = readDb()
  if (!(db.plans || {})[planId]) throw new Error('Plan not found.')
  if (planId === 'FREE') throw new Error('The FREE plan is the fallback for all organizations and cannot be deleted.')
  const inUse = Object.values(db.subscriptions || {}).filter((s) => s.planId === planId).length
  if (inUse > 0) throw new Error(`Plan is used by ${inUse} subscription(s). Move them to another plan first.`)
  if ((db.platformSettings || {}).defaultSignupPlanId === planId) throw new Error('Plan is the default signup plan. Change the default first.')
  delete db.plans[planId]
  writeDb(db)
}
