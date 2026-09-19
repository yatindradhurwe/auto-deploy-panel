import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import nodemailer from 'nodemailer'

// Outbound Internet Mail MTA Transporter (Postfix / Local Sendmail)
let mailTransporter = null
try {
  mailTransporter = nodemailer.createTransport({
    sendmail: true,
    newline: 'unix',
    path: '/usr/sbin/sendmail'
  })
} catch (e) {
  console.warn('[NODEMAILER INIT NOTICE]:', e.message)
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DB_PATH = path.resolve(__dirname, '../data/db.json')

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
        password: 'Yatindra@1223',
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
    return parsed
  } catch (e) {
    console.error('[DB-SERVICE] Error reading db.json, returning default:', e)
    return INITIAL_DB
  }
}

/**
 * Write updated DB JSON object
 */
export function writeDb(dbData) {
  ensureDbExists()
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(dbData, null, 2), 'utf-8')
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

/**
 * Get all created professional email mailboxes
 */
export function getEmailAccounts(orgId) {
  const db = readDb()
  if (!db.emailAccounts) {
    db.emailAccounts = [
      {
        id: 'mail-1',
        email: 'admin@litigation.yjtechnosoft.com',
        username: 'admin',
        domain: 'litigation.yjtechnosoft.com',
        quotaMb: 5000,
        usedMb: 124,
        status: 'active',
        createdAt: new Date(Date.now() - 86400000 * 5).toISOString()
      },
      {
        id: 'mail-2',
        email: 'support@tip-crm.yjtechnosoft.com',
        username: 'support',
        domain: 'tip-crm.yjtechnosoft.com',
        quotaMb: 2000,
        usedMb: 45,
        status: 'active',
        createdAt: new Date(Date.now() - 86400000 * 2).toISOString()
      }
    ]
    writeDb(db)
  }
  if (orgId && orgId !== 'org-default') {
    return db.emailAccounts.filter(a => a.organizationId === orgId)
  }
  return db.emailAccounts
}

/**
 * Save/Create a new email mailbox
 */
export function saveEmailAccount(accountData) {
  const db = readDb()
  if (!db.emailAccounts) db.emailAccounts = []

  const cleanUser = (accountData.username || '').trim().toLowerCase()
  const cleanDomain = (accountData.domain || '').trim().toLowerCase()
  const fullEmail = `${cleanUser}@${cleanDomain}`

  // Check if already exists
  const existing = db.emailAccounts.find(a => a.email === fullEmail)
  if (existing) {
    return existing
  }

  const newAccount = {
    id: `mail-${Date.now()}`,
    email: fullEmail,
    username: cleanUser,
    domain: cleanDomain,
    quotaMb: Number(accountData.quotaMb) || 1000,
    usedMb: 0,
    status: 'active',
    createdAt: new Date().toISOString()
  }

  db.emailAccounts.unshift(newAccount)

  // Auto-seed welcome message in new mailbox inbox
  if (!db.emailMessages) db.emailMessages = []
  db.emailMessages.unshift({
    id: `msg-welcome-${Date.now()}`,
    mailbox: fullEmail,
    folder: 'inbox',
    from: 'system@yjtechnosoft.com',
    to: fullEmail,
    subject: `Welcome to Your New Domain Mailbox (${fullEmail})!`,
    body: `Congratulations! Your professional email mailbox '${fullEmail}' has been successfully provisioned.\n\nYou can read incoming emails, compose new messages, and manage your outbox directly inside this Webmail Console.`,
    timestamp: new Date().toISOString(),
    read: false
  })

  writeDb(db)
  return newAccount
}

/**
 * Delete an email mailbox by ID
 */
export function deleteEmailAccount(emailId) {
  const db = readDb()
  if (!db.emailAccounts) db.emailAccounts = []
  db.emailAccounts = db.emailAccounts.filter(a => a.id !== emailId && a.email !== emailId)
  writeDb(db)
  return true
}

/**
 * Get webmail messages for a specific mailbox and folder
 */
export function getEmailMessages(mailbox, folder = 'inbox') {
  const db = readDb()
  if (!db.emailMessages) {
    db.emailMessages = [
      {
        id: 'msg-welcome-1',
        mailbox: 'admin@litigation.yjtechnosoft.com',
        folder: 'inbox',
        from: 'system@yjtechnosoft.com',
        to: 'admin@litigation.yjtechnosoft.com',
        subject: 'Welcome to Your Litigation CRM Domain Mailbox!',
        body: 'Your professional domain mailbox admin@litigation.yjtechnosoft.com is active.\n\nYou can compose and receive emails directly from this Webmail Console.',
        timestamp: new Date(Date.now() - 3600000 * 2).toISOString(),
        read: false
      },
      {
        id: 'msg-welcome-2',
        mailbox: 'support@tip-crm.yjtechnosoft.com',
        folder: 'inbox',
        from: 'system@yjtechnosoft.com',
        to: 'support@tip-crm.yjtechnosoft.com',
        subject: 'TOP Income Producer CRM Support Mailbox Activated',
        body: 'Your support@tip-crm.yjtechnosoft.com mailbox is online.\n\nUse this webmail client to manage customer inquiries.',
        timestamp: new Date(Date.now() - 3600000 * 5).toISOString(),
        read: true
      }
    ]
    writeDb(db)
  }

  return db.emailMessages.filter(
    (m) => (!mailbox || m.mailbox === mailbox || m.to === mailbox) && m.folder === folder
  )
}

/**
 * Send an email message (saves in sent for sender, and in inbox for recipient)
 */
export function sendEmailMessage({ from, to, subject, body }) {
  const db = readDb()
  if (!db.emailMessages) db.emailMessages = []

  const msgId = `msg-${Date.now()}`
  const now = new Date().toISOString()

  // Save in sender's 'sent' folder
  const sentMsg = {
    id: `${msgId}-sent`,
    mailbox: from,
    folder: 'sent',
    from,
    to,
    subject: subject || '(No Subject)',
    body: body || '',
    timestamp: now,
    read: true
  }

  // Save in recipient's 'inbox' folder
  const inboxMsg = {
    id: `${msgId}-inbox`,
    mailbox: to,
    folder: 'inbox',
    from,
    to,
    subject: subject || '(No Subject)',
    body: body || '',
    timestamp: now,
    read: false
  }

  db.emailMessages.unshift(sentMsg, inboxMsg)
  writeDb(db)

  // Dispatch real outbound email over Internet MTA (Google, Yahoo, Outlook, custom domains)
  if (mailTransporter) {
    mailTransporter.sendMail({
      from,
      to,
      subject: subject || '(No Subject)',
      text: body || ''
    }).then((info) => {
      console.log(`[OUTBOUND INTERNET EMAIL DISPATCHED] From: ${from} -> To: ${to} | ID: ${info.messageId}`)
    }).catch((err) => {
      console.error(`[MTA SENDMAIL DISPATCH FAILED] From: ${from} -> To: ${to}:`, err.message)
    })
  }

  return { success: true, sentMsg }
}

/**
 * Mark a message as read
 */
export function markEmailAsRead(messageId) {
  const db = readDb()
  if (!db.emailMessages) return false

  const msg = db.emailMessages.find((m) => m.id === messageId)
  if (msg) {
    msg.read = true
    writeDb(db)
    return true
  }
  return false
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
    name: serverData.name || 'New VPS Server',
    hostname: serverData.hostname || serverData.ipAddress,
    ipAddress: serverData.ipAddress || '',
    port: serverData.port || 22,
    username: serverData.username || 'root',
    os: serverData.os || 'Linux Ubuntu 22.04',
    agentId: serverData.agentId || `agent-${id}`,
    agentToken: serverData.agentToken || `token_${Math.random().toString(36).substring(2, 15)}`,
    status: serverData.status || 'pending',
    cpu: serverData.cpu || 0,
    ram: serverData.ram || 0,
    disk: serverData.disk || 0,
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



