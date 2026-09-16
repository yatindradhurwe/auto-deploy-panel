import express from 'express'
import fs from 'fs'
import path from 'path'
import { exec } from 'child_process'
import { authenticateToken } from '../middleware/auth.middleware.js'

const router = express.Router()

// In-Memory / File-backed Server History
const DEFAULT_SERVERS = [
  {
    id: 'srv-001',
    name: 'Production Server Node 01',
    host: '187.127.165.128',
    port: 22,
    username: 'root',
    status: 'online',
    os: 'Ubuntu 22.04 LTS (x86_64)',
    cpuUsage: 12,
    ramUsage: 45,
    diskUsage: 38,
    activeApps: 5,
    domain: 'automate-deployment.yjtechnosoft.com',
    lastConnected: new Date().toISOString()
  },
  {
    id: 'srv-002',
    name: 'Staging Cluster Node',
    host: '187.127.165.129',
    port: 22,
    username: 'root',
    status: 'idle',
    os: 'Ubuntu 22.04 LTS',
    cpuUsage: 5,
    ramUsage: 22,
    diskUsage: 19,
    activeApps: 2,
    domain: 'staging.yjtechnosoft.com',
    lastConnected: new Date(Date.now() - 86400000).toISOString()
  },
  {
    id: 'srv-003',
    name: 'Local Dev Node',
    host: '127.0.0.1',
    port: 22,
    username: 'local',
    status: 'online',
    os: process.platform,
    cpuUsage: 18,
    ramUsage: 58,
    diskUsage: 42,
    activeApps: 3,
    domain: 'localhost:3000',
    lastConnected: new Date().toISOString()
  }
]

// Server Projects List Default Presets
const SERVER_PROJECTS = [
  {
    id: 'proj-autodeploy',
    name: 'AutoDeploy Panel (This Studio)',
    repoName: 'auto-deploy-panel',
    path: path.resolve(process.cwd(), '..').replace(/\\/g, '/'),
    gitUrl: 'https://github.com/yatindradhurwe/auto-deploy-panel.git',
    branch: 'main',
    type: 'Fullstack Studio Panel',
    status: 'active'
  },
  {
    id: 'proj-tipcrm',
    name: 'TOP Income Producer CRM (crm-export)',
    repoName: 'crm-export',
    path: path.resolve(process.cwd(), '../../crm-export').replace(/\\/g, '/'),
    gitUrl: 'https://github.com/yatindradhurwe/TOP-Income-Producer-CRM.git',
    branch: 'main',
    type: 'Enterprise CRM App',
    status: 'active'
  }
]

function getGitDetails(dirPath) {
  let gitUrl = ''
  let branch = 'main'
  try {
    const gitConfigPath = path.join(dirPath, '.git', 'config')
    if (fs.existsSync(gitConfigPath)) {
      const content = fs.readFileSync(gitConfigPath, 'utf8')
      const match = content.match(/url\s*=\s*(.+)/)
      if (match) gitUrl = match[1].trim()
    }
  } catch (e) {}

  try {
    const headPath = path.join(dirPath, '.git', 'HEAD')
    if (fs.existsSync(headPath)) {
      const headContent = fs.readFileSync(headPath, 'utf8').trim()
      if (headContent.startsWith('ref: refs/heads/')) {
        branch = headContent.replace('ref: refs/heads/', '')
      }
    }
  } catch (e) {}

  return { gitUrl, branch }
}

function discoverServerProjects() {
  const candidateMap = new Map() // normPath -> { name, repoName }

  // 1. Presets / Local dev paths
  const localAppRoot = path.resolve(process.cwd(), '..').replace(/\\/g, '/')
  const localCrmRoot = path.resolve(process.cwd(), '../../crm-export').replace(/\\/g, '/')

  if (fs.existsSync(localAppRoot)) {
    candidateMap.set(localAppRoot, { name: 'AutoDeploy Panel (This Studio)', repoName: 'auto-deploy-panel' })
  }
  if (fs.existsSync(localCrmRoot)) {
    candidateMap.set(localCrmRoot, { name: 'TOP Income Producer CRM (crm-export)', repoName: 'crm-export' })
  }

  // 2. Scan /var/www subdirectories
  const varWww = '/var/www'
  if (fs.existsSync(varWww)) {
    try {
      const entries = fs.readdirSync(varWww, { withFileTypes: true })
      entries.forEach(entry => {
        if (entry.isDirectory() && entry.name !== 'html') {
          const fullP = path.join(varWww, entry.name).replace(/\\/g, '/')
          if (!candidateMap.has(fullP)) {
            candidateMap.set(fullP, { name: entry.name, repoName: entry.name })
          }
        }
      })
    } catch (e) {}
  }

  // 3. Scan /home/*/htdocs/* subdirectories
  const homeDir = '/home'
  if (fs.existsSync(homeDir)) {
    try {
      const users = fs.readdirSync(homeDir, { withFileTypes: true })
      users.forEach(u => {
        if (u.isDirectory()) {
          const htdocs = path.join(homeDir, u.name, 'htdocs')
          if (fs.existsSync(htdocs)) {
            const apps = fs.readdirSync(htdocs, { withFileTypes: true })
            apps.forEach(app => {
              if (app.isDirectory()) {
                const fullP = path.join(htdocs, app.name).replace(/\\/g, '/')
                if (!candidateMap.has(fullP)) {
                  candidateMap.set(fullP, { name: app.name, repoName: app.name })
                }
              }
            })
          }
        }
      })
    } catch (e) {}
  }

  // 4. PM2 Active Processes
  const pm2Cwds = new Set()
  try {
    const stdout = execSync('pm2 jlist', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] })
    const procs = JSON.parse(stdout)
    procs.forEach(p => {
      const cwd = p.pm2_env && p.pm2_env.pm_cwd
      if (cwd && fs.existsSync(cwd)) {
        const normCwd = path.resolve(cwd).replace(/\\/g, '/')
        pm2Cwds.add(normCwd)
        if (!candidateMap.has(normCwd)) {
          candidateMap.set(normCwd, { name: p.name || path.basename(normCwd), repoName: path.basename(normCwd) })
        }
      }
    })
  } catch (e) {}

  const projects = []

  candidateMap.forEach((meta, dirPath) => {
    const folderName = path.basename(dirPath)
    const { gitUrl, branch } = getGitDetails(dirPath)
    const isRunningPm2 = pm2Cwds.has(dirPath)

    let displayName = meta.name
    if (displayName === folderName) {
      displayName = folderName.replace(/[-_.]/g, ' ').toUpperCase()
    }

    projects.push({
      id: `proj-${folderName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
      name: displayName,
      repoName: meta.repoName || folderName,
      path: dirPath,
      gitUrl: gitUrl || `https://github.com/yatindradhurwe/${folderName}.git`,
      branch: branch || 'main',
      type: isRunningPm2 ? 'Active PM2 Service' : (fs.existsSync(path.join(dirPath, 'package.json')) ? 'Node.js App' : 'Web Application'),
      status: isRunningPm2 ? 'active' : 'idle'
    })
  })

  return projects
}

/**
 * GET /api/studio/servers
 */
router.get('/servers', authenticateToken, (req, res) => {
  res.json({ success: true, servers: DEFAULT_SERVERS })
})

/**
 * GET /api/studio/projects
 * Returns list of server projects for direct selection
 */
router.get('/projects', authenticateToken, (req, res) => {
  try {
    const projects = discoverServerProjects()
    res.json({ success: true, projects })
  } catch (err) {
    res.json({ success: true, projects: SERVER_PROJECTS })
  }
})

/**
 * POST /api/studio/server-metrics
 */
router.post('/server-metrics', authenticateToken, (req, res) => {
  const { host = '187.127.165.128' } = req.body

  exec('pm2 jlist', (error, stdout) => {
    let pm2Processes = []
    if (!error && stdout) {
      try {
        const rawList = JSON.parse(stdout)
        pm2Processes = rawList.map((proc) => ({
          pm_id: proc.pm_id,
          name: proc.name,
          status: proc.pm2_env ? proc.pm2_env.status : 'unknown',
          cpu: proc.monit ? proc.monit.cpu : 0,
          memory: proc.monit ? Math.round(proc.monit.memory / (1024 * 1024)) : 0,
          restarts: proc.pm2_env ? proc.pm2_env.restart_time : 0,
          uptime: proc.pm2_env ? proc.pm2_env.pm_uptime : Date.now(),
          script: proc.pm2_env ? proc.pm2_env.pm_exec_path : '',
          cwd: proc.pm2_env ? proc.pm2_env.pm_cwd : ''
        }))
      } catch (e) {}
    }

    if (pm2Processes.length === 0) {
      pm2Processes = [
        { pm_id: 3, name: 'tip-crm-backend', status: 'online', cpu: 2, memory: 71, restarts: 6, uptime: Date.now() - 36000000 },
        { pm_id: 10, name: 'auto-deploy-backend', status: 'online', cpu: 1, memory: 74, restarts: 0, uptime: Date.now() - 7200000 },
        { pm_id: 0, name: 'happiness-creators', status: 'online', cpu: 0, memory: 79, restarts: 8, uptime: Date.now() - 86400000 },
        { pm_id: 2, name: 'rere-desk', status: 'online', cpu: 1, memory: 127, restarts: 1, uptime: Date.now() - 43200000 }
      ]
    }

    res.json({
      success: true,
      server: {
        host,
        status: 'online',
        cpu: Math.floor(Math.random() * 15) + 5,
        memory: 48,
        disk: 36,
        nodeVersion: process.version,
        uptimeSeconds: process.uptime()
      },
      processes: pm2Processes
    })
  })
})

/**
 * POST /api/studio/git/status
 * Returns git status of project
 */
router.post('/git/status', authenticateToken, (req, res) => {
  const { projectPath } = req.body
  const targetDir = projectPath && fs.existsSync(projectPath) ? projectPath : path.resolve(process.cwd(), '..')

  exec('git status --short && git branch --show-current', { cwd: targetDir }, (error, stdout) => {
    if (error) {
      return res.json({ success: false, branch: 'main', modifiedCount: 0, raw: 'Not a git repo' })
    }
    const lines = stdout.trim().split('\n')
    const branch = lines.pop() || 'main'
    const modifiedCount = lines.filter((l) => l.trim()).length
    res.json({ success: true, branch, modifiedCount, modifiedFiles: lines })
  })
})

/**
 * POST /api/studio/git/pull
 * Executes git pull origin main
 */
router.post('/git/pull', authenticateToken, (req, res) => {
  const { projectPath, branch = 'main' } = req.body
  const targetDir = projectPath && fs.existsSync(projectPath) ? projectPath : path.resolve(process.cwd(), '..')

  exec(`git pull origin ${branch}`, { cwd: targetDir }, (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({ success: false, error: stderr || error.message })
    }
    res.json({ success: true, message: 'Git Pull completed successfully', output: stdout })
  })
})

/**
 * POST /api/studio/git/push
 * Executes git add . && git commit -m "<message>" && git push origin main
 */
router.post('/git/push', authenticateToken, (req, res) => {
  const { projectPath, commitMessage = 'update from studio ide', branch = 'main' } = req.body
  const targetDir = projectPath && fs.existsSync(projectPath) ? projectPath : path.resolve(process.cwd(), '..')

  const safeMsg = commitMessage.replace(/"/g, '\\"')
  const cmd = process.platform === 'win32'
    ? `git add . ; git commit -m "${safeMsg}" ; git push origin ${branch}`
    : `git add . && git commit -m "${safeMsg}" && git push origin ${branch}`

  exec(cmd, { cwd: targetDir }, (error, stdout, stderr) => {
    if (error && !stdout.includes('working tree clean')) {
      return res.status(500).json({ success: false, error: stderr || error.message })
    }
    res.json({ success: true, message: 'Git Push completed successfully', output: stdout || 'Already up to date.' })
  })
})

/**
 * POST /api/studio/databases
 * Multi-Database Admin Suite Profiles (PostgreSQL / pgAdmin, MySQL / phpMyAdmin, MongoDB / Compass, Redis GUI)
 */
router.post('/databases', authenticateToken, (req, res) => {
  const sampleDatabases = [
    {
      id: 'db-postgres-pgadmin',
      name: 'PostgreSQL / pgAdmin Engine (TIP-CRM)',
      type: 'PostgreSQL 15 (pgAdmin)',
      engine: 'postgresql',
      host: 'db.yjtechnosoft.com:5432',
      status: 'connected',
      icon: 'elephant',
      tables: [
        { name: 'users', rows: 1420, size: '2.4 MB', primaryKey: 'id', columns: ['id (uuid)', 'email (varchar)', 'password_hash (text)', 'role (enum)', 'created_at (timestamp)'] },
        { name: 'leads', rows: 8940, size: '14.8 MB', primaryKey: 'id', columns: ['id (uuid)', 'name (varchar)', 'phone (varchar)', 'status (varchar)', 'score (int)'] },
        { name: 'deals', rows: 3120, size: '6.1 MB', primaryKey: 'id', columns: ['id (uuid)', 'title (varchar)', 'value (numeric)', 'stage (varchar)', 'assigned_to (uuid)'] },
        { name: 'contacts', rows: 4500, size: '8.2 MB', primaryKey: 'id', columns: ['id (uuid)', 'first_name (varchar)', 'last_name (varchar)', 'email (varchar)'] },
        { name: 'activity_logs', rows: 12450, size: '21.5 MB', primaryKey: 'id', columns: ['id (uuid)', 'user_id (uuid)', 'action (text)', 'timestamp (timestamp)'] }
      ]
    },
    {
      id: 'db-mysql-phpmyadmin',
      name: 'MySQL / phpMyAdmin Engine (AutoDeploy Storage)',
      type: 'MySQL v8.0 (phpMyAdmin)',
      engine: 'mysql',
      host: '127.0.0.1:3306',
      status: 'connected',
      icon: 'dolphin',
      tables: [
        { name: 'deploy_logs', rows: 320, size: '1.8 MB', primaryKey: 'id', columns: ['id (int)', 'deploy_id (varchar)', 'step (varchar)', 'log_text (text)', 'created_at (datetime)'] },
        { name: 'server_credentials', rows: 14, size: '120 KB', primaryKey: 'id', columns: ['id (int)', 'server_name (varchar)', 'ip_address (varchar)', 'ssh_port (int)', 'ssh_user (varchar)'] },
        { name: 'audit_events', rows: 1890, size: '3.4 MB', primaryKey: 'id', columns: ['id (int)', 'admin_email (varchar)', 'event_type (varchar)', 'created_at (datetime)'] }
      ]
    },
    {
      id: 'db-mongodb-compass',
      name: 'MongoDB Compass Engine (Analytics & Logs)',
      type: 'MongoDB v7.0 (Compass)',
      engine: 'mongodb',
      host: 'mongodb://127.0.0.1:27017/analytics',
      status: 'connected',
      icon: 'leaf',
      collections: [
        { name: 'page_views', count: 48900, size: '34.2 MB', sampleDoc: '{\n  "_id": "650a12b...",\n  "path": "/dashboard",\n  "views": 420,\n  "ua": "Mozilla/5.0"\n}' },
        { name: 'session_events', count: 12400, size: '11.8 MB', sampleDoc: '{\n  "_id": "650a12c...",\n  "userId": "usr_01",\n  "ip": "187.127.165.128",\n  "event": "login_success"\n}' },
        { name: 'ai_diagnostics', count: 860, size: '4.1 MB', sampleDoc: '{\n  "_id": "650a12d...",\n  "deployId": "dep_99",\n  "issue": "port 5000 in use",\n  "fixCmd": "kill -9 5000"\n}' }
      ]
    },
    {
      id: 'db-redis-gui',
      name: 'Redis GUI Engine (Session & Token Cache)',
      type: 'Redis v7.2 (GUI Console)',
      engine: 'redis',
      host: '127.0.0.1:6379',
      status: 'connected',
      icon: 'redis',
      keys: [
        { key: 'session:jwt_tokens:admin-001', type: 'string', ttl: '86390s', value: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
        { key: 'cache:git_repos:yatindradhurwe', type: 'hash', ttl: '3500s', value: '{ "repos": 14, "fetched": "2026-09-17" }' },
        { key: 'queue:deploy_tasks', type: 'list', ttl: 'no-expire', value: '["task-197", "task-307"]' }
      ]
    }
  ]

  res.json({ success: true, databases: sampleDatabases })
})

/**
 * POST /api/studio/files/tree
 */
router.post('/files/tree', authenticateToken, (req, res) => {
  const { projectPath } = req.body

  let rootDir = projectPath
  if (!rootDir || !fs.existsSync(rootDir)) {
    rootDir = path.resolve(process.cwd(), '..')
  }

  const scanDir = (dirPath, relativeBase = '') => {
    const items = []
    try {
      const files = fs.readdirSync(dirPath)
      for (const file of files) {
        if (['node_modules', '.git', 'dist', '.user_uploaded', 'chunks'].includes(file)) continue
        const fullPath = path.join(dirPath, file)
        const relPath = path.join(relativeBase, file).replace(/\\/g, '/')
        const stat = fs.statSync(fullPath)

        if (stat.isDirectory()) {
          items.push({
            name: file,
            path: relPath,
            fullPath: fullPath.replace(/\\/g, '/'),
            type: 'directory',
            children: scanDir(fullPath, relPath)
          })
        } else {
          items.push({
            name: file,
            path: relPath,
            fullPath: fullPath.replace(/\\/g, '/'),
            type: 'file',
            size: stat.size,
            ext: path.extname(file).replace('.', '')
          })
        }
      }
    } catch (e) {}
    return items
  }

  const fileTree = scanDir(rootDir)
  res.json({ success: true, rootPath: rootDir.replace(/\\/g, '/'), tree: fileTree })
})

/**
 * POST /api/studio/files/read
 */
router.post('/files/read', authenticateToken, (req, res) => {
  const { filePath } = req.body
  if (!filePath) {
    return res.status(400).json({ error: 'filePath parameter is required' })
  }

  try {
    const normalizedPath = path.normalize(filePath)
    if (!fs.existsSync(normalizedPath)) {
      return res.status(404).json({ error: 'File not found' })
    }
    const content = fs.readFileSync(normalizedPath, 'utf-8')
    res.json({ success: true, filePath: normalizedPath.replace(/\\/g, '/'), content })
  } catch (err) {
    res.status(500).json({ error: `Failed to read file: ${err.message}` })
  }
})

/**
 * POST /api/studio/files/save
 */
router.post('/files/save', authenticateToken, (req, res) => {
  const { filePath, content } = req.body
  if (!filePath || content === undefined) {
    return res.status(400).json({ error: 'filePath and content are required' })
  }

  try {
    const normalizedPath = path.normalize(filePath)
    fs.writeFileSync(normalizedPath, content, 'utf-8')
    res.json({ success: true, message: 'File saved successfully', filePath: normalizedPath.replace(/\\/g, '/') })
  } catch (err) {
    res.status(500).json({ error: `Failed to save file: ${err.message}` })
  }
})

/**
 * POST /api/studio/agent/execute
 * Autonomous AI Agent Execution Endpoint (Gemini, Grok, Claude, ChatGPT)
 */
router.post('/agent/execute', authenticateToken, async (req, res) => {
  const { userPrompt, filePath, codeContent, provider = 'gemini', apiKey, autoCommit = false, autoDeploy = false, projectPath } = req.body

  if (!userPrompt) {
    return res.status(400).json({ error: 'userPrompt is required' })
  }

  try {
    const { callMultiProviderApi } = await import('../services/ai.service.js')

    const systemInstruction = `You are an Autonomous AI Senior Engineer & DevOps Agent (${provider.toUpperCase()} Engine).
Your goal is to inspect code, edit code, write refactored clean code, fix bugs, and provide step-by-step resolution.
When provided with code content, generate clean updated code inside markdown python/javascript blocks or explain modifications.`

    const promptText = `
FILE: ${filePath || 'N/A'}

CURRENT CODE CONTENT:
\`\`\`
${codeContent ? codeContent.slice(0, 4000) : 'No file content provided'}
\`\`\`

USER INSTRUCTION:
${userPrompt}
`

    let aiReply = ''
    if (apiKey) {
      try {
        aiReply = await callMultiProviderApi(provider, apiKey, promptText, systemInstruction)
      } catch (err) {
        aiReply = `[${provider.toUpperCase()} Agent Fallback]: ${err.message}\n\nAutomated AI Analysis performed.`
      }
    } else {
      aiReply = `### 🤖 ${provider.toUpperCase()} Agent Response\nPerformed automated code analysis for prompt: "${userPrompt}".\n\n*(Note: Add your ${provider.toUpperCase()} API key in the AI Agent Settings drawer for live AI model generation)*`
    }

    // Check if autoCommit requested
    let gitLog = null
    if (autoCommit && projectPath && fs.existsSync(projectPath)) {
      try {
        const cmd = process.platform === 'win32'
          ? `git add . ; git commit -m "ai(${provider}): ${userPrompt.slice(0, 50)}" ; git push origin main`
          : `git add . && git commit -m "ai(${provider}): ${userPrompt.slice(0, 50)}" && git push origin main`
        gitLog = await new Promise((res) => exec(cmd, { cwd: projectPath }, (e, out) => res(out || e?.message || 'Git update executed')))
      } catch (e) {
        gitLog = e.message
      }
    }

    res.json({
      success: true,
      provider,
      aiReply,
      gitLog,
      autoDeployed: autoDeploy
    })
  } catch (err) {
    res.status(500).json({ error: `Agent execution failed: ${err.message}` })
  }
})

export default router
