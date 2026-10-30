import path from 'path'
import crypto from 'crypto'
import {
  SUPABASE_HOME,
  STACK_SERVICES,
  stackDir,
  stackFile,
  processName,
  mintKeys,
  signJwt,
  setupSupabaseStack,
  removeStackScript
} from './supabase-stack.service.js'
import { discoverDatabases, runQuery, createDatabase } from './database.service.js'
import { q } from './host.service.js'

/**
 * List all self-hosted Supabase projects on the server host,
 * plus all discovered database instances (PostgreSQL, MySQL, Mongo, Redis).
 */
export async function listAllSupabaseAndDatabases(host, { force = false, registered = [] } = {}) {
  // 1. Discover all databases across the server
  const dbDiscovery = await discoverDatabases(host, { force, registered })

  // 2. Discover self-hosted Supabase stacks in /opt/autodeploy-supabase/apps
  const stacks = []
  try {
    const listCmd = `if [ -d ${q(`${SUPABASE_HOME}/apps`)} ]; then ls -1 ${q(`${SUPABASE_HOME}/apps`)}; fi`
    const { stdout: appList } = await host.exec(listCmd)
    const appNames = (appList || '').split('\n').map(s => s.trim()).filter(Boolean)

    // Get live PM2 processes
    let pm2List = []
    try {
      const { stdout: pm2Out } = await host.exec('pm2 jlist 2>/dev/null || true')
      pm2List = JSON.parse(pm2Out || '[]')
    } catch {
      pm2List = []
    }

    for (const app of appNames) {
      try {
        const stackFilePath = stackFile(app)
        const exists = await host.exists(stackFilePath)
        if (!exists) continue

        const content = await host.readFile(stackFilePath)
        const stackData = JSON.parse(content)

        // Match PM2 processes for this stack
        const servicesStatus = STACK_SERVICES.map(svc => {
          const pName = processName(app, svc)
          const pm = pm2List.find(p => p.name === pName)
          return {
            service: svc,
            processName: pName,
            status: pm ? (pm.pm2_env?.status || 'stopped') : 'inactive',
            memory: pm?.monit?.memory || 0,
            cpu: pm?.monit?.cpu || 0,
            uptime: pm?.pm2_env?.pm_uptime ? Math.floor((Date.now() - pm.pm2_env.pm_uptime) / 1000) : 0,
            restarts: pm?.pm2_env?.restart_time || 0
          }
        })

        const isHealthy = servicesStatus.some(s => s.status === 'online')

        stacks.push({
          id: `supabase-${app}`,
          appName: app,
          ref: stackData.ref || app,
          publicUrl: stackData.url || `http://127.0.0.1:${stackData.ports?.gateway || 54100}`,
          ports: stackData.ports || {},
          keys: stackData.keys || {},
          jwtSecret: stackData.jwtSecret || '',
          db: stackData.db || { name: app, user: app },
          services: servicesStatus,
          status: isHealthy ? 'online' : 'stopped',
          functions: stackData.functions || [],
          versions: stackData.versions || {},
          createdAt: stackData.createdAt || null,
          updatedAt: stackData.updatedAt || null,
          isSupabaseStack: true
        })
      } catch (err) {
        console.error(`Error reading stack for ${app}:`, err.message)
      }
    }
  } catch (err) {
    console.error('Error listing Supabase stacks:', err.message)
  }

  // Flatten discovered databases for easy access
  const allDbs = []
  if (dbDiscovery?.projects) {
    for (const proj of dbDiscovery.projects) {
      for (const db of proj.databases || []) {
        allDbs.push({ ...db, projectName: proj.name, projectPath: proj.path })
      }
    }
  }
  if (dbDiscovery?.unassigned) {
    for (const db of dbDiscovery.unassigned) {
      allDbs.push({ ...db, projectName: null, projectPath: null })
    }
  }

  return {
    supabaseStacks: stacks,
    databases: allDbs,
    engines: dbDiscovery?.engines || {},
    counts: {
      supabase: stacks.length,
      databases: allDbs.length,
      postgresql: allDbs.filter(d => d.engine === 'postgresql').length,
      mysql: allDbs.filter(d => d.engine === 'mysql').length,
      mongodb: allDbs.filter(d => d.engine === 'mongodb').length,
      redis: allDbs.filter(d => d.engine === 'redis').length
    }
  }
}

/**
 * Get detailed Supabase Project info including tables, auth users, and storage buckets.
 */
export async function getSupabaseProjectDetails(host, appName) {
  const stackFilePath = stackFile(appName)
  const exists = await host.exists(stackFilePath)
  if (!exists) {
    throw Object.assign(new Error(`Supabase project '${appName}' not found.`), { status: 404 })
  }

  const stackContent = await host.readFile(stackFilePath)
  const stack = JSON.parse(stackContent)

  // Live PM2 status
  let pm2List = []
  try {
    const { stdout: pm2Out } = await host.exec('pm2 jlist 2>/dev/null || true')
    pm2List = JSON.parse(pm2Out || '[]')
  } catch {
    pm2List = []
  }

  const services = STACK_SERVICES.map(svc => {
    const pName = processName(appName, svc)
    const pm = pm2List.find(p => p.name === pName)
    return {
      service: svc,
      processName: pName,
      status: pm ? (pm.pm2_env?.status || 'stopped') : 'inactive',
      memory: pm?.monit?.memory || 0,
      cpu: pm?.monit?.cpu || 0,
      uptime: pm?.pm2_env?.pm_uptime ? Math.floor((Date.now() - pm.pm2_env.pm_uptime) / 1000) : 0,
      restarts: pm?.pm2_env?.restart_time || 0
    }
  })

  // Read tables from PostgreSQL
  let tables = []
  let authUsers = []
  let storageBuckets = []

  const dbName = stack.db?.name || appName
  try {
    // List tables via psql peer
    const psqlTablesCmd = `runuser -u postgres -- psql -X -q -d ${q(dbName)} -t -A -c "
      SELECT table_schema, table_name,
        pg_total_relation_size(quote_ident(table_schema) || '.' || quote_ident(table_name)) AS bytes
      FROM information_schema.tables
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY table_schema, table_name;
    " 2>/dev/null || true`
    const { stdout: tOut } = await host.exec(psqlTablesCmd)
    if (tOut) {
      tables = tOut.trim().split('\n').filter(Boolean).map(line => {
        const [schema, name, bytes] = line.split('|')
        return {
          schema: schema || 'public',
          name: name || '',
          bytes: Number(bytes || 0)
        }
      })
    }

    // Try reading auth.users if GoTrue is present
    const psqlUsersCmd = `runuser -u postgres -- psql -X -q -d ${q(dbName)} -t -A -c "
      SELECT id, email, role, created_at, last_sign_in_at, email_confirmed_at
      FROM auth.users ORDER BY created_at DESC LIMIT 50;
    " 2>/dev/null || true`
    const { stdout: uOut } = await host.exec(psqlUsersCmd)
    if (uOut && !uOut.includes('does not exist')) {
      authUsers = uOut.trim().split('\n').filter(Boolean).map(line => {
        const [id, email, role, created_at, last_sign_in_at, email_confirmed_at] = line.split('|')
        return { id, email, role, created_at, last_sign_in_at, email_confirmed_at }
      })
    }

    // Try reading storage.buckets if storage is present
    const psqlBucketsCmd = `runuser -u postgres -- psql -X -q -d ${q(dbName)} -t -A -c "
      SELECT id, name, public, created_at
      FROM storage.buckets ORDER BY created_at DESC LIMIT 50;
    " 2>/dev/null || true`
    const { stdout: bOut } = await host.exec(psqlBucketsCmd)
    if (bOut && !bOut.includes('does not exist')) {
      storageBuckets = bOut.trim().split('\n').filter(Boolean).map(line => {
        const [id, name, isPublic, created_at] = line.split('|')
        return { id, name, public: isPublic === 't' || isPublic === 'true', created_at }
      })
    }
  } catch (err) {
    console.error(`Error querying database for ${appName}:`, err.message)
  }

  // Host address for connection string
  const hostIp = host.ipAddress || host.host || '127.0.0.1'
  const dbUser = stack.db?.user || appName
  const pgPort = 5432
  const poolerPort = 6543
  const directConnectionString = `postgresql://${dbUser}:[PASSWORD]@${hostIp}:${pgPort}/${dbName}`
  const poolerConnectionString = `postgresql://${dbUser}:[PASSWORD]@${hostIp}:${poolerPort}/${dbName}?pgbouncer=true`

  return {
    appName,
    ref: stack.ref || appName,
    publicUrl: stack.url,
    ports: stack.ports || {},
    keys: stack.keys || {},
    jwtSecret: stack.jwtSecret || '',
    db: stack.db || { name: dbName, user: dbUser },
    directConnectionString,
    poolerConnectionString,
    services,
    tables,
    authUsers,
    storageBuckets,
    functions: stack.functions || [],
    versions: stack.versions || {},
    createdAt: stack.createdAt,
    updatedAt: stack.updatedAt
  }
}

/**
 * Restart a specific service (or all services) of a Supabase stack.
 */
export async function restartSupabaseService(host, appName, serviceName = 'all') {
  if (serviceName === 'all') {
    for (const svc of STACK_SERVICES) {
      await host.exec(`pm2 restart ${q(processName(appName, svc))} >/dev/null 2>&1 || true`)
    }
  } else {
    await host.exec(`pm2 restart ${q(processName(appName, serviceName))} >/dev/null 2>&1 || true`)
  }
  return { success: true, message: `Restarted ${serviceName} for ${appName}` }
}

/**
 * Rotate JWT secret and mint new anon and service_role keys.
 */
export async function rotateSupabaseKeys(host, appName) {
  const stackFilePath = stackFile(appName)
  const content = await host.readFile(stackFilePath)
  const stack = JSON.parse(content)

  const newSecret = crypto.randomBytes(32).toString('hex')
  const newKeys = mintKeys(newSecret, stack.ref || appName)

  stack.jwtSecret = newSecret
  stack.keys = newKeys
  stack.updatedAt = new Date().toISOString()

  await host.writeFile(stackFilePath, JSON.stringify(stack, null, 2))

  // Update auth.env and rest.conf
  const dir = stackDir(appName)
  try {
    await host.exec(`sed -i 's/^GOTRUE_JWT_SECRET=.*/GOTRUE_JWT_SECRET=${newSecret}/' ${q(`${dir}/auth.env`)} 2>/dev/null || true`)
    await host.exec(`sed -i 's/^jwt-secret = .*/jwt-secret = "${newSecret}"/' ${q(`${dir}/rest.conf`)} 2>/dev/null || true`)
  } catch {}

  // Restart services
  await restartSupabaseService(host, appName, 'all')

  return {
    jwtSecret: newSecret,
    keys: newKeys
  }
}

/**
 * Create or manage GoTrue Auth user in PostgreSQL auth.users
 */
export async function manageGoTrueUser(host, appName, action, payload = {}) {
  const stackFilePath = stackFile(appName)
  const stack = JSON.parse(await host.readFile(stackFilePath))
  const dbName = stack.db?.name || appName

  if (action === 'create') {
    const email = String(payload.email || '').trim().toLowerCase()
    const password = String(payload.password || '')
    const role = String(payload.role || 'authenticated')
    if (!email || !password) throw Object.assign(new Error('Email and password are required'), { status: 400 })

    // Generate bcrypt password hash via node script or psql pgcrypto
    const insertCmd = `runuser -u postgres -- psql -X -q -d ${q(dbName)} -c "
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      VALUES (
        gen_random_uuid(),
        ${q(email)},
        crypt(${q(password)}, gen_salt('bf')),
        NOW(),
        ${q(role)},
        '{\\"provider\\":\\"email\\",\\"providers\\":[\\"email\\"]}',
        '{}',
        NOW(),
        NOW()
      );
    "`
    await host.exec(insertCmd)
    return { success: true, message: `Created user ${email}` }
  }

  if (action === 'delete') {
    const userId = String(payload.userId || '').trim()
    if (!userId) throw Object.assign(new Error('User ID is required'), { status: 400 })

    const deleteCmd = `runuser -u postgres -- psql -X -q -d ${q(dbName)} -c "
      DELETE FROM auth.users WHERE id = ${q(userId)}::uuid;
    "`
    await host.exec(deleteCmd)
    return { success: true, message: `Deleted user ${userId}` }
  }

  if (action === 'update_password') {
    const userId = String(payload.userId || '').trim()
    const newPassword = String(payload.newPassword || '')
    if (!userId || !newPassword) throw Object.assign(new Error('User ID and new password are required'), { status: 400 })

    const updateCmd = `runuser -u postgres -- psql -X -q -d ${q(dbName)} -c "
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      UPDATE auth.users
      SET encrypted_password = crypt(${q(newPassword)}, gen_salt('bf')), updated_at = NOW()
      WHERE id = ${q(userId)}::uuid;
    "`
    await host.exec(updateCmd)
    return { success: true, message: `Password updated for user ${userId}` }
  }

  throw Object.assign(new Error(`Unknown auth action: ${action}`), { status: 400 })
}

/**
 * Manage Supabase storage buckets
 */
export async function manageStorageBucket(host, appName, action, payload = {}) {
  const stackFilePath = stackFile(appName)
  const stack = JSON.parse(await host.readFile(stackFilePath))
  const dbName = stack.db?.name || appName

  if (action === 'create') {
    const bucketName = String(payload.name || '').trim().toLowerCase()
    const isPublic = payload.public === true || payload.public === 'true'
    if (!bucketName) throw Object.assign(new Error('Bucket name is required'), { status: 400 })

    const createCmd = `runuser -u postgres -- psql -X -q -d ${q(dbName)} -c "
      INSERT INTO storage.buckets (id, name, public, created_at, updated_at)
      VALUES (${q(bucketName)}, ${q(bucketName)}, ${isPublic ? 'true' : 'false'}, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;
    "`
    await host.exec(createCmd)
    return { success: true, message: `Created bucket ${bucketName}` }
  }

  if (action === 'delete') {
    const bucketId = String(payload.bucketId || '').trim()
    if (!bucketId) throw Object.assign(new Error('Bucket ID is required'), { status: 400 })

    const deleteCmd = `runuser -u postgres -- psql -X -q -d ${q(dbName)} -c "
      DELETE FROM storage.objects WHERE bucket_id = ${q(bucketId)};
      DELETE FROM storage.buckets WHERE id = ${q(bucketId)};
    "`
    await host.exec(deleteCmd)
    return { success: true, message: `Deleted bucket ${bucketId}` }
  }

  throw Object.assign(new Error(`Unknown bucket action: ${action}`), { status: 400 })
}

/**
 * Delete a self-hosted Supabase stack and clean up services
 */
export async function deleteSupabaseStack(host, appName, dropDb = false) {
  const script = removeStackScript(appName)
  await host.exec(script)

  if (dropDb) {
    const dropCmd = `runuser -u postgres -- psql -X -q -c "DROP DATABASE IF EXISTS \\"${appName}\\"; DROP ROLE IF EXISTS \\"${appName}\\";" 2>/dev/null || true`
    await host.exec(dropCmd)
  }

  return { success: true, message: `Removed Supabase stack for ${appName}` }
}


/**
 * Detect database configuration for a list of projects:
 * Whether each project uses a Self-Hosted Supabase stack, a Self-Hosted Local Database,
 * an External/Cloud Supabase, or has No Database.
 */
export async function enrichProjectsWithDatabaseInfo(host, projects = []) {
  if (!projects || !projects.length) return projects

  // 1. Get all self-hosted Supabase stacks
  const stackMap = new Map()
  try {
    const listCmd = `if [ -d ${q(`${SUPABASE_HOME}/apps`)} ]; then ls -1 ${q(`${SUPABASE_HOME}/apps`)}; fi`
    const { stdout: appList } = await host.exec(listCmd)
    const appNames = (appList || '').split('\n').map(s => s.trim()).filter(Boolean)
    for (const app of appNames) {
      try {
        const content = await host.readFile(stackFile(app))
        stackMap.set(app.toLowerCase(), JSON.parse(content))
      } catch {}
    }
  } catch {}

  // 2. Scan .env of each project via a single fast shell command
  const paths = projects.map(p => p.path).filter(Boolean)
  const envMap = new Map()
  if (paths.length) {
    try {
      const scanScript = paths.map(p => `echo "@@PROJ ${p}"; grep -E '^(DATABASE_URL|SUPABASE_URL|SUPABASE_ANON_KEY|DB_HOST|DB_CONNECTION|DB_DATABASE)=' "${p}/.env" 2>/dev/null || true`).join('\n')
      const { stdout: scanOut } = await host.exec(scanScript, { timeout: 15000 })
      let curPath = null
      let lines = []
      for (const line of (scanOut || '').split('\n')) {
        if (line.startsWith('@@PROJ ')) {
          if (curPath) envMap.set(curPath, lines)
          curPath = line.slice(7).trim()
          lines = []
        } else if (line.trim() && !line.startsWith('#')) {
          lines.push(line.trim())
        }
      }
      if (curPath) envMap.set(curPath, lines)
    } catch {}
  }

  // 3. Enrich each project
  return projects.map(p => {
    const folder = path.basename(p.path || '').toLowerCase()
    const pName = (p.name || '').toLowerCase()
    const appCandidates = [folder, pName, (p.repoName || '').toLowerCase()].filter(Boolean)

    // Check if directly matches a self-hosted Supabase stack
    const matchingStackName = appCandidates.find(c => stackMap.has(c))
    if (matchingStackName) {
      const stack = stackMap.get(matchingStackName)
      return {
        ...p,
        dbInfo: {
          type: 'self-hosted-supabase',
          label: 'Self-Hosted Supabase',
          engine: 'postgresql',
          isSelfHosted: true,
          stackApp: stack.app || matchingStackName,
          database: stack.db?.name || matchingStackName,
          url: stack.url,
          ports: stack.ports
        }
      }
    }

    // Check .env lines
    const envLines = envMap.get(p.path) || []
    const envVars = {}
    for (const l of envLines) {
      const idx = l.indexOf('=')
      if (idx > 0) envVars[l.slice(0, idx).trim()] = l.slice(idx + 1).replace(/^["']|["']$/g, '').trim()
    }

    const sbUrl = envVars.SUPABASE_URL || ''
    const dbUrl = envVars.DATABASE_URL || ''
    const dbHost = envVars.DB_HOST || ''

    if (sbUrl) {
      if (sbUrl.includes('127.0.0.1') || sbUrl.includes('localhost') || sbUrl.includes('54100') || sbUrl.includes(host.ipAddress || '___')) {
        return {
          ...p,
          dbInfo: {
            type: 'self-hosted-supabase',
            label: 'Self-Hosted Supabase',
            engine: 'postgresql',
            isSelfHosted: true,
            url: sbUrl
          }
        }
      }
      return {
        ...p,
        dbInfo: {
          type: 'cloud-supabase',
          label: 'Supabase Cloud',
          engine: 'postgresql',
          isSelfHosted: false,
          url: sbUrl
        }
      }
    }

    if (dbUrl) {
      const isLocal = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost') || dbUrl.includes('@/')
      const engine = dbUrl.startsWith('mysql') ? 'mysql' : 'postgresql'
      const dbMatch = dbUrl.match(/\/([a-zA-Z0-9_-]+)(?:\?|$)/)
      const dbName = dbMatch ? dbMatch[1] : 'database'
      return {
        ...p,
        dbInfo: {
          type: isLocal ? 'self-hosted-db' : 'external-db',
          label: isLocal ? (engine === 'mysql' ? 'Self-Hosted MySQL' : 'Self-Hosted PostgreSQL') : 'External Database',
          engine,
          isSelfHosted: isLocal,
          database: dbName
        }
      }
    }

    if (dbHost) {
      const isLocal = dbHost === '127.0.0.1' || dbHost === 'localhost'
      const engine = (envVars.DB_CONNECTION || '').includes('mysql') ? 'mysql' : 'postgresql'
      return {
        ...p,
        dbInfo: {
          type: isLocal ? 'self-hosted-db' : 'external-db',
          label: isLocal ? (engine === 'mysql' ? 'Self-Hosted MySQL' : 'Self-Hosted PostgreSQL') : 'External Database',
          engine,
          isSelfHosted: isLocal,
          database: envVars.DB_DATABASE || 'database'
        }
      }
    }

    return {
      ...p,
      dbInfo: {
        type: 'none',
        label: 'No Database',
        isSelfHosted: false
      }
    }
  })
}

/**
 * Provision / Attach a Self-Hosted Database or Supabase Stack to an Existing Project
 */
export async function attachSelfHostedDatabase(host, {
  projectPath,
  appName,
  mode = 'supabase', // 'supabase' | 'postgresql' | 'mysql' | 'existing'
  dbName,
  dbUser,
  dbPassword,
  domain = '',
  existingStack = null,
  restart = true
}) {
  const dir = path.posix.resolve(String(projectPath || '/'))
  const exists = await host.exists(dir)
  if (!exists) throw Object.assign(new Error(`Project directory not found: ${dir}`), { status: 404 })

  const envFile = `${dir}/.env`
  let envBefore = ''
  try {
    if (await host.exists(envFile)) {
      envBefore = await host.readFile(envFile)
    }
  } catch {}

  const targetDbName = String(dbName || appName || path.basename(dir)).trim().toLowerCase().replace(/[^a-z0-9_]/g, '_')
  const targetDbUser = String(dbUser || targetDbName).trim().toLowerCase().replace(/[^a-z0-9_]/g, '_')
  const targetPassword = String(dbPassword || crypto.randomBytes(12).toString('hex'))
  const hostIp = host.ipAddress || host.host || '127.0.0.1'

  let newEnvVars = {}
  let resultSummary = {}

  if (mode === 'supabase') {
    try {
      await createDatabase(host, { engine: 'postgresql', name: targetDbName, user: targetDbUser, password: targetPassword })
    } catch (e) {
      console.log('[Attach DB] createDatabase note:', e.message)
    }

    const sbAppName = String(appName || path.basename(dir)).trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
    const publicUrl = domain ? `https://${domain}` : `http://${hostIp}:54100`
    const ref = crypto.randomBytes(8).toString('hex')

    const stackResult = await setupSupabaseStack(host, {
      appName: sbAppName,
      publicUrl,
      projectDir: dir,
      db: { name: targetDbName, user: targetDbUser, password: targetPassword },
      ref,
      onLog: (msg) => console.log(`[Attach Supabase to ${sbAppName}] ${msg}`)
    })

    const directPgUrl = `postgresql://${targetDbUser}:${targetPassword}@127.0.0.1:5432/${targetDbName}`
    newEnvVars = {
      DATABASE_URL: directPgUrl,
      SUPABASE_URL: stackResult.url || `http://127.0.0.1:${stackResult.ports?.gateway || 54100}`,
      SUPABASE_ANON_KEY: stackResult.keys?.anon || '',
      SUPABASE_SERVICE_ROLE_KEY: stackResult.keys?.service_role || '',
      JWT_SECRET: stackResult.jwtSecret || '',
      DB_HOST: '127.0.0.1',
      DB_PORT: '5432',
      DB_DATABASE: targetDbName,
      DB_USER: targetDbUser,
      DB_PASSWORD: targetPassword
    }

    resultSummary = {
      type: 'self-hosted-supabase',
      stack: stackResult,
      message: `Deployed and attached full Self-Hosted Supabase stack to ${path.basename(dir)}!`
    }
  } else if (mode === 'postgresql' || mode === 'mysql') {
    await createDatabase(host, { engine: mode, name: targetDbName, user: targetDbUser, password: targetPassword })

    const port = mode === 'postgresql' ? 5432 : 3306
    const scheme = mode === 'postgresql' ? 'postgresql' : 'mysql'
    const directUrl = `${scheme}://${targetDbUser}:${targetPassword}@127.0.0.1:${port}/${targetDbName}`

    newEnvVars = {
      DATABASE_URL: directUrl,
      DB_CONNECTION: mode === 'postgresql' ? 'pgsql' : 'mysql',
      DB_HOST: '127.0.0.1',
      DB_PORT: String(port),
      DB_DATABASE: targetDbName,
      DB_USER: targetDbUser,
      DB_PASSWORD: targetPassword
    }

    resultSummary = {
      type: 'self-hosted-db',
      engine: mode,
      database: targetDbName,
      message: `Created and attached Self-Hosted ${mode === 'postgresql' ? 'PostgreSQL' : 'MySQL'} database to ${path.basename(dir)}!`
    }
  } else if (mode === 'existing') {
    if (existingStack?.isSupabaseStack) {
      newEnvVars = {
        DATABASE_URL: `postgresql://${existingStack.db?.user || 'postgres'}:${existingStack.db?.password || ''}@127.0.0.1:5432/${existingStack.db?.name || existingStack.appName}`,
        SUPABASE_URL: existingStack.publicUrl || `http://127.0.0.1:54100`,
        SUPABASE_ANON_KEY: existingStack.keys?.anon || '',
        SUPABASE_SERVICE_ROLE_KEY: existingStack.keys?.service_role || '',
        JWT_SECRET: existingStack.jwtSecret || ''
      }
    } else if (existingStack?.id) {
      newEnvVars = {
        DATABASE_URL: `postgresql://${existingStack.user || 'postgres'}:${existingStack.password || ''}@127.0.0.1:5432/${existingStack.database}`
      }
    }
    resultSummary = {
      type: 'linked-existing',
      message: `Linked existing database to ${path.basename(dir)}!`
    }
  }

  let updatedEnv = envBefore || ''
  for (const [k, v] of Object.entries(newEnvVars)) {
    const regex = new RegExp(`^${k}=.*$`, 'm')
    if (regex.test(updatedEnv)) {
      updatedEnv = updatedEnv.replace(regex, `${k}="${v}"`)
    } else {
      updatedEnv = updatedEnv.trim() + `\n${k}="${v}"\n`
    }
  }

  await host.writeFile(envFile, updatedEnv.trim() + '\n')

  const restarted = []
  if (restart) {
    try {
      const pm2Name = path.basename(dir)
      await host.exec(`pm2 restart ${q(pm2Name)} 2>/dev/null || true`)
      restarted.push(pm2Name)
    } catch {}
  }

  return {
    success: true,
    ...resultSummary,
    restarted
  }
}
