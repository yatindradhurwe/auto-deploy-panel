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

// Default structure if db.json does not exist
const INITIAL_DB = {
  users: {
    'admin-001': {
      id: 'admin-001',
      name: 'System Admin',
      email: 'admin@tipcrm.com',
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
  }
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
    return JSON.parse(raw)
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
export function getEmailAccounts() {
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



