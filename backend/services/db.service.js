import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

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
