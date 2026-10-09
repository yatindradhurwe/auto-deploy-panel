import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
// AUTODEPLOY_DB_PATH lets tests run against a copy instead of the live database
const DB_PATH = process.env.AUTODEPLOY_DB_PATH || path.resolve(__dirname, '../data/db.json')

// Default multi-tenant SaaS initial database structure
const INITIAL_DB = {
  users: {
    'admin-001': {
      id: 'admin-001',
      fullName: 'System Admin',
      email: 'admin@tipcrm.com',
      passwordHash: '$2b$10$eWkZ0y08N7L0/VwLhN7l4e2.7663f7uS1a06', // Hashed or verified password
      organizationId: 'org-default',
      isVerified: true,
      twoFactorEnabled: false,
      createdAt: new Date().toISOString(),
      settings: {
        githubToken: '',
        host: '187.127.165.128',
        port: '22',
        username: 'root',
        password: '',
        domain: 'tip-crm.yjtechnosoft.com',
        gitRepoUrl: 'https://github.com/yatindradhurwe/TOP-Income-Producer-CRM.git',
        remoteDir: '/var/www/tip-crm',
        appName: 'tip-crm-backend',
        backendPort: 5050,
        setupSsl: true
      }
    }
  },
  organizations: {
    'org-default': {
      id: 'org-default',
      name: 'My Organization',
      slug: 'my-org',
      ownerId: 'admin-001',
      planId: 'BUSINESS',
      createdAt: new Date().toISOString()
    }
  },
  organizationMembers: [
    {
      id: 'member-001',
      organizationId: 'org-default',
      userId: 'admin-001',
      role: 'OWNER',
      joinedAt: new Date().toISOString()
    }
  ],
  servers: {
    'srv-default': {
      id: 'srv-default',
      organizationId: 'org-default',
      name: 'Production Server Node 01',
      hostname: 'automate-deployment.yjtechnosoft.com',
      ipAddress: '187.127.165.128',
      port: 22,
      username: 'root',
      os: 'Ubuntu 22.04 LTS (x86_64)',
      agentId: 'agent-prod-01',
      agentToken: 'token_prod_187_127_165_128',
      status: 'online',
      cpu: 12,
      ram: 45,
      disk: 36,
      domain: 'automate-deployment.yjtechnosoft.com',
      lastSeen: new Date().toISOString(),
      createdAt: new Date().toISOString()
    }
  },
  projects: {
    'proj-autodeploy': {
      id: 'proj-autodeploy',
      organizationId: 'org-default',
      serverId: 'srv-default',
      name: 'AutoDeploy Panel (This Studio)',
      repoName: 'auto-deploy-panel',
      path: '/var/www/auto-deploy-panel',
      gitUrl: 'https://github.com/yatindradhurwe/auto-deploy-panel.git',
      branch: 'main',
      framework: 'Node.js React',
      port: 4040,
      status: 'active'
    },
    'proj-tipcrm': {
      id: 'proj-tipcrm',
      organizationId: 'org-default',
      serverId: 'srv-default',
      name: 'TOP Income Producer CRM (crm-export)',
      repoName: 'crm-export',
      path: '/var/www/tip-crm',
      gitUrl: 'https://github.com/yatindradhurwe/TOP-Income-Producer-CRM.git',
      branch: 'main',
      framework: 'Node.js Express',
      port: 5050,
      status: 'active'
    }
  },
  subscriptions: {
    'org-default': {
      id: 'sub-default',
      organizationId: 'org-default',
      planId: 'BUSINESS',
      status: 'active',
      currentPeriodStart: new Date().toISOString(),
      currentPeriodEnd: new Date(Date.now() + 365 * 86400000).toISOString(),
      cancelAtPeriodEnd: false
    }
  },
  plans: {
    FREE: {
      id: 'FREE',
      name: 'Free Starter',
      priceMonthly: 0,
      maxServers: 1,
      maxProjects: 2,
      maxTeamMembers: 1,
      maxDeploymentsPerMonth: 10,
      monitoring: false,
      apiAccess: false,
      teamAccess: false
    },
    STARTER: {
      id: 'STARTER',
      name: 'Developer Starter',
      priceMonthly: 19,
      maxServers: 3,
      maxProjects: 10,
      maxTeamMembers: 3,
      maxDeploymentsPerMonth: 100,
      monitoring: true,
      apiAccess: true,
      teamAccess: true
    },
    PROFESSIONAL: {
      id: 'PROFESSIONAL',
      name: 'Professional DevOps',
      priceMonthly: 49,
      maxServers: 10,
      maxProjects: 35,
      maxTeamMembers: 10,
      maxDeploymentsPerMonth: 500,
      monitoring: true,
      apiAccess: true,
      teamAccess: true
    },
    BUSINESS: {
      id: 'BUSINESS',
      name: 'Enterprise SaaS',
      priceMonthly: 149,
      maxServers: 100,
      maxProjects: 200,
      maxTeamMembers: 50,
      maxDeploymentsPerMonth: 5000,
      monitoring: true,
      apiAccess: true,
      teamAccess: true
    }
  },
  auditLogs: [
    {
      id: 'audit-001',
      organizationId: 'org-default',
      userId: 'admin-001',
      action: 'SYSTEM_INIT',
      resourceType: 'system',
      resourceId: 'org-default',
      ip: '187.127.165.128',
      timestamp: new Date().toISOString()
    }
  ]
}

/**
 * Ensure data directory and db.json exist
 */
function ensureDbExists() {
  const dir = path.dirname(DB_PATH)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(INITIAL_DB, null, 2), 'utf-8')
  }
}

/**
 * Read current DB JSON object
 */
export function readDb() {
  ensureDbExists()
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf-8')
    const parsed = JSON.parse(raw)
    // Ensure essential multi-tenant properties exist
    if (!parsed.organizations) parsed.organizations = INITIAL_DB.organizations
    if (!parsed.organizationMembers) parsed.organizationMembers = INITIAL_DB.organizationMembers
    if (!parsed.servers) parsed.servers = INITIAL_DB.servers
    if (!parsed.projects) parsed.projects = INITIAL_DB.projects
    if (!parsed.subscriptions) parsed.subscriptions = INITIAL_DB.subscriptions
    if (!parsed.plans) parsed.plans = INITIAL_DB.plans
    if (!parsed.auditLogs) parsed.auditLogs = INITIAL_DB.auditLogs
    if (!parsed.idempotencyKeys) parsed.idempotencyKeys = {}
    if (!parsed.webhookEvents) parsed.webhookEvents = {}
    if (!parsed.supportTickets) parsed.supportTickets = []
    // Platform roles were 'admin' (super admin) / 'user' (customer); they are now 'superadmin' / 'admin'.
    // Re-applied on every read until the next write persists the marker, so it stays idempotent.
    if (!parsed.platformRolesMigratedAt) {
      for (const user of Object.values(parsed.users || {})) {
        if (user.platformRole === 'admin') user.platformRole = 'superadmin'
        else if (user.platformRole === 'user') user.platformRole = 'admin'
      }
      parsed.platformRolesMigratedAt = new Date().toISOString()
    }
    return parsed
  } catch (e) {
    // Preserve the unreadable file so no data is silently destroyed, then start from the initial schema
    const backupPath = `${DB_PATH}.corrupt-${Date.now()}`
    console.error(`[DB-SERVICE] Error reading db.json, backing it up to ${backupPath} and repairing with initial schema:`, e)
    try {
      fs.copyFileSync(DB_PATH, backupPath)
      writeDb(INITIAL_DB)
    } catch (err) {}
    return JSON.parse(JSON.stringify(INITIAL_DB))
  }
}

/**
 * Write updated DB JSON object
 */
export function writeDb(dbData) {
  ensureDbExists()
  try {
    // Atomic write: a crash mid-write leaves the previous db.json intact instead of a truncated file
    const tmpPath = `${DB_PATH}.${process.pid}.tmp`
    fs.writeFileSync(tmpPath, JSON.stringify(dbData, null, 2), 'utf-8')
    fs.renameSync(tmpPath, DB_PATH)
    return true
  } catch (e) {
    console.error('[DB-SERVICE] Error writing db.json:', e)
    return false
  }
}

/**
 * Get settings for a specific user ID
 */
export function getUserSettings(userId) {
  const db = readDb()
  const user = db.users && db.users[userId]
  return user ? (user.settings || {}) : {}
}

/**
 * Save/update settings for a specific user ID
 */
export function saveUserSettings(userId, newSettings) {
  const db = readDb()
  if (!db.users) db.users = {}
  if (!db.users[userId]) {
    db.users[userId] = { id: userId, settings: {} }
  }

  db.users[userId].settings = {
    ...(db.users[userId].settings || {}),
    ...newSettings
  }

  writeDb(db)
  return db.users[userId].settings
}

/**
 * Get Antigravity Auto-Update config for a specific project appName
 */
export function getProjectAutoUpdateConfig(appName) {
  if (!appName) return null
  const db = readDb()
  const configs = db.projectAutoUpdates || {}
  return configs[appName] || {
    appName,
    enabled: false,
    autoSyncInterval: 5, // minutes (0 = Webhook only, 5, 15, 60)
    branch: 'main',
    gitRepoUrl: '',
    projectPath: `/var/www/${appName}`,
    host: '187.127.165.128',
    webhookSecret: `sec_${appName}_${Math.random().toString(36).substring(2, 8)}`,
    lastAutoUpdate: null,
    lastStatus: 'never',
    lastLog: ''
  }
}

/**
 * Save/update Antigravity Auto-Update config for a specific project appName
 */
export function saveProjectAutoUpdateConfig(appName, config) {
  if (!appName) return null
  const db = readDb()
  if (!db.projectAutoUpdates) db.projectAutoUpdates = {}
  
  const existing = db.projectAutoUpdates[appName] || {}
  const updated = {
    ...existing,
    ...config,
    appName,
    updatedAt: new Date().toISOString()
  }

  db.projectAutoUpdates[appName] = updated
  writeDb(db)
  return updated
}

/**
 * Get all configured project Antigravity Auto-Update settings
 */
export function getAllProjectAutoUpdateConfigs() {
  const db = readDb()
  return db.projectAutoUpdates || {}
}

/**
 * Record a Webhook / Auto-Update audit trail log
 */
export function recordWebhookAuditLog(logData) {
  const db = readDb()
  if (!db.webhookAuditLogs) db.webhookAuditLogs = []
  
  const logEntry = {
    id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    timestamp: new Date().toISOString(),
    ...logData
  }

  db.webhookAuditLogs.unshift(logEntry)
  // Keep last 100 logs
  if (db.webhookAuditLogs.length > 100) {
    db.webhookAuditLogs = db.webhookAuditLogs.slice(0, 100)
  }

  writeDb(db)
  return logEntry
}

/**
 * Get Webhook audit trail logs
 */
export function getWebhookAuditLogs() {
  const db = readDb()
  return db.webhookAuditLogs || []
}

// ============================================================================
// Multi-Tenant SaaS Entity Helper Functions
// ============================================================================

// --- Users & Auth Helpers ---
export function getUserByEmail(email) {
  if (!email) return null
  const db = readDb()
  const users = Object.values(db.users || {})
  return users.find(u => u.email.toLowerCase() === email.trim().toLowerCase()) || null
}

export function getUserById(userId) {
  if (!userId) return null
  const db = readDb()
  return (db.users && db.users[userId]) || null
}

export function createUser(userData) {
  const db = readDb()
  if (!db.users) db.users = {}
  const id = userData.id || `usr-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`
  const newUser = {
    id,
    fullName: userData.fullName || userData.name || 'User',
    email: (userData.email || '').trim().toLowerCase(),
    passwordHash: userData.passwordHash || '',
    organizationId: userData.organizationId || null,
    isVerified: userData.isVerified ?? false,
    verificationToken: userData.verificationToken || null,
    resetPasswordToken: userData.resetPasswordToken || null,
    twoFactorEnabled: false,
    createdAt: new Date().toISOString(),
    settings: userData.settings || {}
  }
  db.users[id] = newUser
  writeDb(db)
  return newUser
}

export function updateUser(userId, updates) {
  const db = readDb()
  if (!db.users || !db.users[userId]) return null
  db.users[userId] = {
    ...db.users[userId],
    ...updates,
    updatedAt: new Date().toISOString()
  }
  writeDb(db)
  return db.users[userId]
}

export function getAllUsers() {
  const db = readDb()
  return Object.values(db.users || {})
}

// --- Organizations Helpers ---
export function getOrganizationById(orgId) {
  if (!orgId) return null
  const db = readDb()
  return (db.organizations && db.organizations[orgId]) || null
}

export function getOrganizationsByUserId(userId) {
  const db = readDb()
  const members = (db.organizationMembers || []).filter(m => m.userId === userId)
  const orgIds = members.map(m => m.organizationId)
  const user = db.users && db.users[userId]
  if (user && user.organizationId && !orgIds.includes(user.organizationId)) {
    orgIds.push(user.organizationId)
  }
  return Object.values(db.organizations || {}).filter(o => orgIds.includes(o.id))
}

export function createOrganization({ name, ownerId, planId = 'FREE' }) {
  const db = readDb()
  if (!db.organizations) db.organizations = {}
  const id = `org-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  const org = {
    id,
    name,
    slug: slug || id,
    ownerId,
    planId,
    createdAt: new Date().toISOString()
  }
  db.organizations[id] = org

  if (!db.organizationMembers) db.organizationMembers = []
  db.organizationMembers.push({
    id: `mem-${Date.now()}`,
    organizationId: id,
    userId: ownerId,
    role: 'OWNER',
    joinedAt: new Date().toISOString()
  })

  if (!db.subscriptions) db.subscriptions = {}
  db.subscriptions[id] = {
    id: `sub-${Date.now()}`,
    organizationId: id,
    planId,
    status: 'active',
    currentPeriodStart: new Date().toISOString(),
    currentPeriodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
    cancelAtPeriodEnd: false
  }

  writeDb(db)
  return org
}

export function updateOrganization(orgId, updates) {
  const db = readDb()
  if (!db.organizations || !db.organizations[orgId]) return null
  db.organizations[orgId] = {
    ...db.organizations[orgId],
    ...updates,
    updatedAt: new Date().toISOString()
  }
  writeDb(db)
  return db.organizations[orgId]
}

export function getAllOrganizations() {
  const db = readDb()
  return Object.values(db.organizations || {})
}

// --- Organization Members (Team & RBAC) Helpers ---
export function getOrganizationMembers(orgId) {
  const db = readDb()
  const members = (db.organizationMembers || []).filter(m => m.organizationId === orgId)
  return members.map(m => {
    const user = db.users && db.users[m.userId]
    return {
      ...m,
      fullName: user?.fullName || 'Unknown User',
      email: user?.email || '',
      avatar: user?.avatar || ''
    }
  })
}

export function addOrganizationMember({ organizationId, userId, role = 'DEVELOPER' }) {
  const db = readDb()
  if (!db.organizationMembers) db.organizationMembers = []
  const existing = db.organizationMembers.find(m => m.organizationId === organizationId && m.userId === userId)
  if (existing) {
    existing.role = role
    writeDb(db)
    return existing
  }
  const member = {
    id: `mem-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    organizationId,
    userId,
    role,
    joinedAt: new Date().toISOString()
  }
  db.organizationMembers.push(member)
  writeDb(db)
  return member
}

export function removeOrganizationMember(organizationId, userId) {
  const db = readDb()
  if (!db.organizationMembers) return false
  db.organizationMembers = db.organizationMembers.filter(
    m => !(m.organizationId === organizationId && m.userId === userId)
  )
  writeDb(db)
  return true
}

export function updateMemberRole(organizationId, userId, newRole) {
  const db = readDb()
  if (!db.organizationMembers) return null
  const member = db.organizationMembers.find(m => m.organizationId === organizationId && m.userId === userId)
  if (member) {
    member.role = newRole
    writeDb(db)
    return member
  }
  return null
}

// --- Servers Helpers ---
export function getServersByOrgId(orgId) {
  const db = readDb()
  const servers = Object.values(db.servers || {})
  return servers.filter(s => s.organizationId === orgId)
}

export function getServerById(serverId) {
  if (!serverId) return null
  const db = readDb()
  return (db.servers && db.servers[serverId]) || null
}

export function createServer(serverData) {
  const db = readDb()
  if (!db.servers) db.servers = {}
  const id = serverData.id || `srv-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`
  const server = {
    id,
    organizationId: serverData.organizationId,
    createdBy: serverData.createdBy || null,
    name: serverData.name || 'Server Node',
    serverType: (serverData.serverType || 'vps').toLowerCase(), // 'vps' | 'shared' | 'cloud'
    provider: serverData.provider || 'custom', // 'custom_vps', 'cpanel', 'directadmin', 'custom_ftp', 'aws', 'digitalocean', 'gcp', 'hetzner', 'vultr'
    authType: serverData.authType || 'password', // 'password', 'ssh_key', 'cpanel_api', 'cloud_api'
    hostname: serverData.hostname || serverData.ipAddress || serverData.ftpHost || serverData.cpanelUrl || '',
    ipAddress: serverData.ipAddress || serverData.ftpHost || '',
    port: serverData.port || (serverData.serverType === 'shared' ? 21 : 22),
    username: serverData.username || serverData.ftpUser || serverData.cpanelUser || 'root',
    password: serverData.password || serverData.ftpPassword || '',
    sshKey: serverData.sshKey || '',
    os: serverData.os || (serverData.serverType === 'shared' ? 'Shared Hosting Linux' : serverData.serverType === 'cloud' ? 'Cloud Linux VM' : 'Linux Ubuntu 22.04'),
    // Shared Server fields
    cpanelUrl: serverData.cpanelUrl || '',
    cpanelUser: serverData.cpanelUser || '',
    cpanelApiToken: serverData.cpanelApiToken || '',
    ftpHost: serverData.ftpHost || '',
    ftpPort: serverData.ftpPort || 21,
    ftpUser: serverData.ftpUser || '',
    ftpPassword: serverData.ftpPassword || '',
    webRootPath: serverData.webRootPath || '/public_html',
    sharedDbHost: serverData.sharedDbHost || '',
    sharedDbUser: serverData.sharedDbUser || '',
    sharedDbPassword: serverData.sharedDbPassword || '',
    // Cloud Server fields
    cloudProvider: serverData.cloudProvider || '',
    cloudApiKey: serverData.cloudApiKey || '',
    cloudRegion: serverData.cloudRegion || '',
    cloudInstanceId: serverData.cloudInstanceId || '',
    // Telemetry & Status
    agentId: serverData.agentId || `agent-${id}`,
    agentToken: serverData.agentToken || `token_${Math.random().toString(36).substring(2, 15)}`,
    status: serverData.status || 'online',
    cpu: serverData.cpu || Math.floor(Math.random() * 15) + 5,
    ram: serverData.ram || Math.floor(Math.random() * 25) + 20,
    disk: serverData.disk || Math.floor(Math.random() * 30) + 15,
    domain: serverData.domain || '',
    lastSeen: new Date().toISOString(),
    createdAt: new Date().toISOString()
  }
  db.servers[id] = server
  writeDb(db)
  return server
}

export function updateServer(serverId, updates) {
  const db = readDb()
  if (!db.servers || !db.servers[serverId]) return null
  db.servers[serverId] = {
    ...db.servers[serverId],
    ...updates,
    updatedAt: new Date().toISOString()
  }
  writeDb(db)
  return db.servers[serverId]
}

export function deleteServer(serverId) {
  const db = readDb()
  if (!db.servers || !db.servers[serverId]) return false
  delete db.servers[serverId]
  writeDb(db)
  return true
}

export function getAllServers() {
  const db = readDb()
  return Object.values(db.servers || {})
}

// --- Projects Helpers ---
export function getProjectsByOrgId(orgId, serverId = null) {
  const db = readDb()
  const projects = Object.values(db.projects || {})
  return projects.filter(p => p.organizationId === orgId && (!serverId || p.serverId === serverId))
}

export function getProjectById(projectId) {
  if (!projectId) return null
  const db = readDb()
  return (db.projects && db.projects[projectId]) || null
}

export function createProject(projectData) {
  const db = readDb()
  if (!db.projects) db.projects = {}
  const id = projectData.id || `proj-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`
  const project = {
    id,
    organizationId: projectData.organizationId,
    serverId: projectData.serverId,
    name: projectData.name,
    repoName: projectData.repoName || projectData.name,
    path: projectData.path || `/var/www/${projectData.name}`,
    gitUrl: projectData.gitUrl || '',
    branch: projectData.branch || 'main',
    framework: projectData.framework || 'Node.js',
    port: projectData.port || 5000,
    status: projectData.status || 'active',
    createdAt: new Date().toISOString()
  }
  db.projects[id] = project
  writeDb(db)
  return project
}

export function updateProject(projectId, updates) {
  const db = readDb()
  if (!db.projects || !db.projects[projectId]) return null
  db.projects[projectId] = {
    ...db.projects[projectId],
    ...updates,
    updatedAt: new Date().toISOString()
  }
  writeDb(db)
  return db.projects[projectId]
}

export function deleteProject(projectId) {
  const db = readDb()
  if (!db.projects || !db.projects[projectId]) return false
  delete db.projects[projectId]
  writeDb(db)
  return true
}

// --- Subscriptions & Plans Helpers ---
export function getSubscriptionByOrgId(orgId) {
  const db = readDb()
  return (db.subscriptions && db.subscriptions[orgId]) || {
    id: `sub-${orgId}`,
    organizationId: orgId,
    planId: 'FREE',
    status: 'active',
    currentPeriodStart: new Date().toISOString(),
    currentPeriodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
    cancelAtPeriodEnd: false
  }
}

export function saveSubscription(orgId, subscriptionData) {
  const db = readDb()
  if (!db.subscriptions) db.subscriptions = {}
  db.subscriptions[orgId] = {
    ...(db.subscriptions[orgId] || {}),
    ...subscriptionData,
    organizationId: orgId,
    updatedAt: new Date().toISOString()
  }
  if (db.organizations && db.organizations[orgId] && subscriptionData.planId) {
    db.organizations[orgId].planId = subscriptionData.planId
  }
  writeDb(db)
  return db.subscriptions[orgId]
}

export function getPlanById(planId) {
  const db = readDb()
  return (db.plans && db.plans[planId]) || db.plans.FREE
}

export function getAllPlans() {
  const db = readDb()
  return db.plans || INITIAL_DB.plans
}

// --- Audit Logs Helpers ---
export function getAuditLogsByOrgId(orgId) {
  const db = readDb()
  const logs = db.auditLogs || []
  return logs.filter(l => l.organizationId === orgId)
}

export function recordAuditLog({ organizationId, userId, action, resourceType, resourceId, ip = '127.0.0.1', details = {} }) {
  const db = readDb()
  if (!db.auditLogs) db.auditLogs = []
  const entry = {
    id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    organizationId: organizationId || 'org-default',
    userId: userId || 'system',
    action,
    resourceType,
    resourceId,
    ip,
    details,
    timestamp: new Date().toISOString()
  }
  db.auditLogs.unshift(entry)
  if (db.auditLogs.length > 500) {
    db.auditLogs = db.auditLogs.slice(0, 500)
  }
  writeDb(db)
  return entry
}

// ==============================================================================
// IDEMPOTENCY SYSTEM DATABASE HELPERS & CONSTRAINTS
// ==============================================================================

/**
 * Generate composite primary key for organization-scoped idempotency
 */
function makeIdempotencyPk(orgId, key) {
  const safeOrg = (orgId || 'org-default').trim()
  const safeKey = (key || '').trim()
  return `idemp_${safeOrg}_${safeKey}`
}

/**
 * Get idempotency record by Organization ID and Idempotency Key
 */
export function getIdempotencyRecord(organizationId, idempotencyKey) {
  if (!idempotencyKey) return null
  const db = readDb()
  const pk = makeIdempotencyPk(organizationId, idempotencyKey)
  return (db.idempotencyKeys && db.idempotencyKeys[pk]) || null
}

/**
 * Create a new atomic Idempotency Record in PROCESSING state
 */
export function createIdempotencyRecord({
  organizationId = 'org-default',
  userId = 'system',
  idempotencyKey,
  requestHash,
  httpMethod,
  requestPath,
  resourceType = 'generic',
  resourceId = null,
  retentionDays = 7
}) {
  if (!idempotencyKey) throw new Error('Idempotency Key is required.')

  const db = readDb()
  if (!db.idempotencyKeys) db.idempotencyKeys = {}

  const pk = makeIdempotencyPk(organizationId, idempotencyKey)

  // Enforce Database Unique Constraint: UNIQUE(organization_id, idempotency_key)
  if (db.idempotencyKeys[pk]) {
    const existing = db.idempotencyKeys[pk]
    // If PROCESSING and crash timeout exceeded (5 mins), auto-expire for recovery
    const ageMs = Date.now() - new Date(existing.createdAt).getTime()
    if (existing.status === 'PROCESSING' && ageMs > 5 * 60 * 1000) {
      existing.status = 'EXPIRED'
      existing.updatedAt = new Date().toISOString()
      writeDb(db)
    } else {
      return { record: existing, created: false }
    }
  }

  const now = new Date()
  const expiresAt = new Date(now.getTime() + retentionDays * 86400000).toISOString()

  const record = {
    id: pk,
    organizationId,
    userId,
    idempotencyKey,
    requestHash,
    httpMethod: (httpMethod || 'POST').toUpperCase(),
    requestPath,
    resourceType,
    resourceId,
    status: 'PROCESSING', // 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'EXPIRED'
    responseStatus: null,
    responseHeaders: null,
    responseBody: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    completedAt: null,
    expiresAt
  }

  db.idempotencyKeys[pk] = record
  writeDb(db)
  return { record, created: true }
}

/**
 * Update an existing Idempotency Record (mark COMPLETED, FAILED, etc.)
 */
export function updateIdempotencyRecord(organizationId, idempotencyKey, updates) {
  const db = readDb()
  if (!db.idempotencyKeys) return null

  const pk = makeIdempotencyPk(organizationId, idempotencyKey)
  const existing = db.idempotencyKeys[pk]
  if (!existing) return null

  const updated = {
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString(),
    completedAt: updates.status === 'COMPLETED' || updates.status === 'FAILED' ? new Date().toISOString() : existing.completedAt
  }

  db.idempotencyKeys[pk] = updated
  writeDb(db)
  return updated
}

/**
 * Retrieve summary metrics for Super Admin Idempotency Dashboard
 */
export function getIdempotencyStats() {
  const db = readDb()
  const keys = Object.values(db.idempotencyKeys || {})

  const total = keys.length
  const processing = keys.filter(k => k.status === 'PROCESSING').length
  const completed = keys.filter(k => k.status === 'COMPLETED').length
  const failed = keys.filter(k => k.status === 'FAILED').length
  const expired = keys.filter(k => k.status === 'EXPIRED').length
  const replayed = keys.filter(k => k.replayedCount > 0).length
  const conflicts = keys.filter(k => k.hasConflict).length

  return {
    totalRequests: total,
    newOperations: completed + processing,
    replayedRequests: replayed,
    conflicts,
    processing,
    completed,
    failed,
    expired
  }
}

/**
 * Retrieve all Idempotency records for Admin Inspection (sorted newest first)
 */
export function getAllIdempotencyRecords() {
  const db = readDb()
  const records = Object.values(db.idempotencyKeys || {})
  return records.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
}

/**
 * Clean up expired Idempotency records
 */
export function cleanExpiredIdempotencyKeys(retentionDays = 7) {
  const db = readDb()
  if (!db.idempotencyKeys) return 0

  const nowMs = Date.now()
  let deletedCount = 0

  Object.keys(db.idempotencyKeys).forEach(pk => {
    const item = db.idempotencyKeys[pk]
    const expMs = new Date(item.expiresAt || 0).getTime()
    if (expMs > 0 && expMs < nowMs) {
      delete db.idempotencyKeys[pk]
      deletedCount++
    }
  })

  if (deletedCount > 0) {
    writeDb(db)
  }
  return deletedCount
}

// ==============================================================================
// WEBHOOK DEDUPLICATION HELPERS: UNIQUE(provider, event_id)
// ==============================================================================

export function getWebhookEvent(provider, eventId) {
  if (!provider || !eventId) return null
  const db = readDb()
  const pk = `wh_${provider.toLowerCase()}_${eventId}`
  return (db.webhookEvents && db.webhookEvents[pk]) || null
}

export function recordWebhookEvent({ provider, eventId, organizationId = 'org-default', eventType, payloadHash, status = 'PROCESSED' }) {
  if (!provider || !eventId) throw new Error('Provider and eventId are required for webhooks.')

  const db = readDb()
  if (!db.webhookEvents) db.webhookEvents = {}

  const pk = `wh_${provider.toLowerCase()}_${eventId}`
  if (db.webhookEvents[pk]) {
    return { record: db.webhookEvents[pk], isDuplicate: true }
  }

  const record = {
    id: pk,
    provider: provider.toLowerCase(),
    eventId,
    organizationId,
    eventType: eventType || 'generic',
    payloadHash: payloadHash || '',
    status,
    processedAt: new Date().toISOString()
  }

  db.webhookEvents[pk] = record
  writeDb(db)
  return { record, isDuplicate: false }
}

// ==============================================================================
// DOMAIN & MAILBOX UNIQUENESS HELPERS
// ==============================================================================

export function getDomainByNormalizedName(organizationId, domainName) {
  if (!domainName) return null
  const norm = domainName.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  const db = readDb()
  const servers = Object.values(db.servers || {})
  return servers.find(s => s.organizationId === organizationId && s.domain && s.domain.trim().toLowerCase() === norm) || null
}

export function getEmailAccountByAddress(organizationId, emailAddress) {
  if (!emailAddress) return null
  const cleanEmail = emailAddress.trim().toLowerCase()
  const db = readDb()
  const accounts = db.emailAccounts || []
  return accounts.find(a => (a.organizationId === organizationId || !organizationId) && a.email === cleanEmail) || null
}

/**
 * Purges a project record, its auto-update config, and domain emails from db.json
 */
export function purgeProjectAndRelatedResources(appName, projectPath, domain) {
  const db = readDb()
  let modified = false

  const targetName = (appName || '').trim().toLowerCase()
  const targetPath = (projectPath || '').trim().toLowerCase()
  const targetDomain = (domain || '').trim().toLowerCase().replace(/^https?:\/\//, '')

  // 1. Purge from db.projects
  if (db.projects) {
    Object.keys(db.projects).forEach(pk => {
      const p = db.projects[pk]
      const pName = (p.name || p.repoName || '').toLowerCase()
      const pPath = (p.path || '').toLowerCase()
      const pDomain = (p.domain || '').toLowerCase()

      if (
        (targetName && (pName === targetName || pk.includes(targetName))) ||
        (targetPath && pPath === targetPath) ||
        (targetDomain && pDomain.includes(targetDomain))
      ) {
        delete db.projects[pk]
        modified = true
      }
    })
  }

  // 2. Purge from db.projectAutoUpdates
  if (db.projectAutoUpdates && targetName && db.projectAutoUpdates[targetName]) {
    delete db.projectAutoUpdates[targetName]
    modified = true
  }

  // 3. Purge domain emails from db.emailAccounts
  if (db.emailAccounts && Array.isArray(db.emailAccounts) && targetDomain) {
    const initialLen = db.emailAccounts.length
    db.emailAccounts = db.emailAccounts.filter(acc => {
      const accDomain = (acc.domain || acc.email?.split('@')[1] || '').toLowerCase()
      return !accDomain.includes(targetDomain)
    })
    if (db.emailAccounts.length !== initialLen) modified = true
  }

  if (modified) {
    writeDb(db)
  }
  return modified
}



