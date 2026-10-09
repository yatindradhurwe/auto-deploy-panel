import { getHost } from './host.service.js'
import { updateProject } from './project-ops.service.js'
import {
  getProjectAutoUpdateConfig,
  saveProjectAutoUpdateConfig,
  getAllProjectAutoUpdateConfigs,
  recordWebhookAuditLog,
  getUserSettings,
  getServerById,
  readDb
} from './db.service.js'

let isAutoUpdateRunning = false

/**
 * Execute Antigravity Auto-Update for a specific project
 * @param {string} appName
 * @param {string} triggerSource 'webhook' | 'periodic' | 'manual'
 * @param {object} extraMeta Optional payload metadata (e.g. pusher, commitMsg)
 */
export async function executeProjectAutoUpdate(appName, triggerSource = 'manual', extraMeta = {}) {
  const config = getProjectAutoUpdateConfig(appName)
  // Use the SSH credentials of the user who owns this project (legacy configs without an owner belong to the admin).
  // Never fall back to another user's credentials: that would send the admin's root password to a tenant's server.
  const ownerSettings = getUserSettings(config.ownerUserId || 'admin-001') || {}

  const host = config.host || ownerSettings.host || '187.127.165.128'
  const port = Number(ownerSettings.port || 22)
  const username = ownerSettings.username || 'root'
  const password = ownerSettings.password || ''
  const projectPath = config.projectPath || `/var/www/${appName}`
  const branch = config.branch || 'main'
  const gitRepoUrl = config.gitRepoUrl || ownerSettings.gitRepoUrl || ''

  console.log(`[ANTIGRAVITY AUTO-UPDATE] Executing update for project '${appName}' triggered via '${triggerSource}'...`)

  let outputLog = ''
  let status = 'success'

  try {
    // Prefer the connected server record (stored credentials); fall back to the owner's saved SSH settings
    const server = (config.serverId && getServerById(config.serverId)) ||
      Object.values(readDb().servers || {}).find(s => (s.ipAddress === host || s.hostname === host) && (!config.organizationId || s.organizationId === config.organizationId)) ||
      { id: `auto-${host}`, name: host, ipAddress: host, port, username, password }
    await updateProject(getHost(server), {
      projectPath,
      appName,
      branch,
      gitRepoUrl,
      githubToken: (ownerSettings.githubToken || '').trim()
    }, (text) => { outputLog += text })
    status = 'success'
  } catch (err) {
    status = 'failed'
    outputLog += `\n❌ AUTO-UPDATE ERROR: ${err.message}`
    console.error(`[ANTIGRAVITY AUTO-UPDATE] Failed for project '${appName}':`, err.message)
  }

  // Update DB config state
  saveProjectAutoUpdateConfig(appName, {
    lastAutoUpdate: new Date().toISOString(),
    lastStatus: status,
    lastLog: outputLog.slice(-2000) // Keep last 2000 chars of output
  })

  // Record audit trail log
  recordWebhookAuditLog({
    appName,
    triggerSource,
    status,
    pusher: extraMeta.pusher || 'Antigravity Engine',
    commitMsg: extraMeta.commitMsg || `Auto-Sync Triggered (${triggerSource})`,
    branch,
    outputSnippet: outputLog.slice(-300)
  })

  return {
    success: status === 'success',
    appName,
    status,
    output: outputLog
  }
}

/**
 * Initialize background interval poller for all projects with periodic auto-update enabled
 */
export function initAutoUpdateService() {
  console.log('[ANTIGRAVITY AUTO-UPDATE SERVICE] Initialized background auto-sync worker.')

  // Check every 2 minutes
  setInterval(async () => {
    if (isAutoUpdateRunning) return
    isAutoUpdateRunning = true

    try {
      const allConfigs = getAllProjectAutoUpdateConfigs()
      const now = Date.now()

      for (const [appName, config] of Object.entries(allConfigs)) {
        if (!config || !config.enabled) continue
        
        const intervalMinutes = Number(config.autoSyncInterval) || 0
        if (intervalMinutes <= 0) continue // 0 = Webhook trigger only

        const lastRun = config.lastAutoUpdate ? new Date(config.lastAutoUpdate).getTime() : 0
        const elapsedMinutes = (now - lastRun) / (1000 * 60)

        if (elapsedMinutes >= intervalMinutes) {
          console.log(`[ANTIGRAVITY AUTO-UPDATE WORKER] Interval of ${intervalMinutes}m reached for '${appName}'. Triggering auto-update...`)
          await executeProjectAutoUpdate(appName, 'periodic')
        }
      }
    } catch (e) {
      console.error('[ANTIGRAVITY AUTO-UPDATE WORKER] Error in background worker loop:', e)
    } finally {
      isAutoUpdateRunning = false
    }
  }, 2 * 60 * 1000) // 2 minutes
}
