import { Client } from 'ssh2'

/**
 * Connects to a remote Linux server using ssh2 and returns an active Client instance.
 */
function connectSsh(config) {
  return new Promise((resolve, reject) => {
    const conn = new Client()
    const timeoutTimer = setTimeout(() => {
      conn.end()
      reject(new Error('SSH connection timed out (15s)'))
    }, 15000)

    conn.on('ready', () => {
      clearTimeout(timeoutTimer)
      resolve(conn)
    })

    conn.on('error', (err) => {
      clearTimeout(timeoutTimer)
      reject(err)
    })

    const connConfig = {
      host: config.host,
      port: parseInt(config.port || 22, 10),
      username: config.username || 'root',
      readyTimeout: 15000,
    }

    if (config.privateKey) {
      connConfig.privateKey = config.privateKey
    } else {
      connConfig.password = config.password
    }

    conn.connect(connConfig)
  })
}

/**
 * Tests SSH connectivity and retrieves basic OS system stats.
 */
export async function testSshConnection(config) {
  let conn
  try {
    conn = await connectSsh(config)
    return new Promise((resolve, reject) => {
      conn.exec('uname -a && uptime && df -h /', (err, stream) => {
        if (err) {
          conn.end()
          return reject(err)
        }
        let output = ''
        stream.on('data', (data) => { output += data.toString() })
        stream.on('close', () => {
          conn.end()
          resolve({
            success: true,
            rawInfo: output.trim(),
            host: config.host,
            username: config.username,
          })
        })
      })
    })
  } catch (err) {
    if (conn) conn.end()
    throw new Error(`SSH Connection Failed: ${err.message}`)
  }
}

/**
 * Scans active listening ports and PM2 processes on the remote server.
 */
export async function scanPortsAndServices(config) {
  let conn
  try {
    conn = await connectSsh(config)
    const cmd = `
      echo "=== PORTS ==="
      ss -tulpn 2>/dev/null || netstat -tulpn 2>/dev/null || true
      echo "=== PM2 ==="
      pm2 jlist 2>/dev/null || echo "[]"
    `
    return new Promise((resolve, reject) => {
      conn.exec(cmd, (err, stream) => {
        if (err) {
          conn.end()
          return reject(err)
        }
        let output = ''
        stream.on('data', (data) => { output += data.toString() })
        stream.on('close', () => {
          conn.end()

          const parts = output.split('=== PM2 ===')
          const portsRaw = parts[0] || ''
          const pm2Raw = parts[1] || '[]'

          // Extract listening ports
          const activePorts = new Set()
          const portMatches = portsRaw.match(/:(\d+)\s/g) || []
          portMatches.forEach((m) => {
            const p = parseInt(m.replace(/[:\s]/g, ''), 10)
            if (p > 0 && p < 65535) activePorts.add(p)
          })

          // Parse PM2 process list
          let pm2Apps = []
          try {
            const parsed = JSON.parse(pm2Raw.trim())
            if (Array.isArray(parsed)) {
              pm2Apps = parsed.map((app) => ({
                id: app.pm_id,
                name: app.name,
                status: app.pm2_env?.status || 'unknown',
                memory: app.monit?.memory ? `${Math.round(app.monit.memory / 1024 / 1024)}MB` : '0MB',
                cpu: app.monit?.cpu !== undefined ? `${app.monit.cpu}%` : '0%',
                port: app.pm2_env?.PORT || app.pm2_env?.env?.PORT || null,
              }))
            }
          } catch (e) {
            // Ignore parse error if pm2 is not installed
          }

          // Find safe, unused backend port starting from 5050
          let suggestedPort = 5050
          while (activePorts.has(suggestedPort)) {
            suggestedPort++
          }

          resolve({
            success: true,
            activePorts: Array.from(activePorts).sort((a, b) => a - b),
            pm2Apps,
            suggestedPort,
          })
        })
      })
    })
  } catch (err) {
    if (conn) conn.end()
    throw new Error(`Port Scan Failed: ${err.message}`)
  }
}

/**
 * Runs a single SSH command and streams stdout/stderr chunks via callback.
 * Rejects if command exits with non-zero exit code.
 */
function runCommandStream(conn, command, onLog, allowFailure = false) {
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) return reject(err)
      
      stream.on('data', (data) => {
        onLog(data.toString('utf-8'), false)
      })
      stream.stderr.on('data', (data) => {
        onLog(data.toString('utf-8'), true)
      })
      stream.on('close', (code) => {
        if (code === 0 || allowFailure) {
          resolve(code)
        } else {
          reject(new Error(`Command failed with exit code ${code}`))
        }
      })
    })
  })
}

/**
 * Helper to run a silent query command on remote server and get output string.
 */
function runQuery(conn, command) {
  return new Promise((resolve) => {
    conn.exec(command, (err, stream) => {
      if (err) return resolve('')
      let out = ''
      stream.on('data', (d) => { out += d.toString() })
      stream.on('close', () => resolve(out.trim()))
    })
  })
}

/**
 * Executes full multi-step deployment pipeline on the remote server with strict step validation & layout detection.
 */
export async function executeDeployment(config, onLog) {
  let conn
  try {
    onLog(`Connecting to remote server ${config.username}@${config.host}:${config.port || 22}...\n`, false, 'INIT')
    conn = await connectSsh(config)
    onLog(`SSH Connection Established Successfully!\n\n`, false, 'INIT')

    let domain = (config.domain || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    let gitRepoUrl = (config.gitRepoUrl || '').trim()
    const appName = (config.appName || 'my-app').trim()
    const backendPort = config.backendPort || 5050
    let remoteDir = (config.remoteDir || `/var/www/${appName}`).trim()
    const setupSsl = config.setupSsl !== false

    if (!domain) {
      throw new Error('Public Domain Name is required for deployment')
    }
    if (!gitRepoUrl) {
      throw new Error('Git Repository URL is required for deployment')
    }

    // Clean up domain (remove trailing slashes)
    domain = domain.replace(/\/$/, '')

    // Step 1: Sync Codebase from Git
    onLog(`\n==========================================\n[STEP 1/6] Syncing Codebase from Repository...\n==========================================\n`, false, 'GIT')
    const gitCmd = `
      if [ -d "${remoteDir}/.git" ]; then
        echo "Updating existing repository at ${remoteDir}..."
        cd ${remoteDir} && git fetch --all && git reset --hard origin/main && git pull origin main
      else
        echo "Cloning repository ${gitRepoUrl} into ${remoteDir}..."
        mkdir -p ${remoteDir}
        git clone ${gitRepoUrl} ${remoteDir}
      fi
    `
    try {
      await runCommandStream(conn, gitCmd, onLog)
    } catch (gitErr) {
      onLog(`\n❌ GIT CLONE / SYNC FAILED!\n`, true, 'GIT')
      onLog(`Possible Causes:\n`, true, 'GIT')
      onLog(` 1. Typo in Git Repository URL: ${gitRepoUrl}\n`, true, 'GIT')
      onLog(` 2. Private Repository: For private GitHub repos, format your URL as:\n`, true, 'GIT')
      onLog(`    https://<YOUR_GITHUB_PAT_TOKEN>@github.com/<USERNAME>/<REPO>.git\n\n`, true, 'GIT')
      throw new Error(`Git Sync Failed: ${gitErr.message}`)
    }

    // Inspect repository layout on server
    onLog(`\nAnalyzing project layout in ${remoteDir}...\n`, false, 'LAYOUT')
    const hasFrontendDir = (await runQuery(conn, `[ -d "${remoteDir}/frontend" ] && echo "YES" || echo "NO"`)) === 'YES'
    const hasBackendDir = (await runQuery(conn, `[ -d "${remoteDir}/backend" ] && echo "YES" || echo "NO"`)) === 'YES'
    const hasRootPackageJson = (await runQuery(conn, `[ -f "${remoteDir}/package.json" ] && echo "YES" || echo "NO"`)) === 'YES'

    onLog(`Layout detected: Monorepo Frontend=${hasFrontendDir}, Backend=${hasBackendDir}, Root Package=${hasRootPackageJson}\n`, false, 'LAYOUT')

    let webRootDir = `${remoteDir}`
    let backendEntryDir = null

    // Step 2: Build Frontend
    onLog(`\n==========================================\n[STEP 2/6] Building Frontend Production Assets...\n==========================================\n`, false, 'FRONTEND')
    if (hasFrontendDir) {
      onLog(`Building frontend inside ${remoteDir}/frontend...\n`, false, 'FRONTEND')
      const frontendCmd = `cd ${remoteDir}/frontend && npm install --production=false && npm run build`
      await runCommandStream(conn, frontendCmd, onLog)
      
      const hasFrontendDist = (await runQuery(conn, `[ -d "${remoteDir}/frontend/dist" ] && echo "YES" || echo "NO"`)) === 'YES'
      if (hasFrontendDist) {
        webRootDir = `${remoteDir}/frontend/dist`
      } else {
        webRootDir = `${remoteDir}/frontend`
      }
    } else if (hasRootPackageJson) {
      onLog(`Building project at root ${remoteDir}...\n`, false, 'FRONTEND')
      const rootBuildCmd = `cd ${remoteDir} && npm install --production=false && (npm run build || true)`
      await runCommandStream(conn, rootBuildCmd, onLog)

      const hasDist = (await runQuery(conn, `[ -d "${remoteDir}/dist" ] && echo "YES" || echo "NO"`)) === 'YES'
      const hasBuild = (await runQuery(conn, `[ -d "${remoteDir}/build" ] && echo "YES" || echo "NO"`)) === 'YES'
      const hasPublic = (await runQuery(conn, `[ -d "${remoteDir}/public" ] && echo "YES" || echo "NO"`)) === 'YES'

      if (hasDist) webRootDir = `${remoteDir}/dist`
      else if (hasBuild) webRootDir = `${remoteDir}/build`
      else if (hasPublic) webRootDir = `${remoteDir}/public`
      else webRootDir = remoteDir
    } else {
      onLog(`No package.json build script required. Using static root ${remoteDir}.\n`, false, 'FRONTEND')
      webRootDir = remoteDir
    }

    onLog(`Selected Nginx Static Web Root: ${webRootDir}\n`, false, 'FRONTEND')

    // Step 3 & Step 4: Backend Setup & PM2 Service
    onLog(`\n==========================================\n[STEP 3 & 4/6] Backend Setup & PM2 Service Management...\n==========================================\n`, false, 'BACKEND')
    if (hasBackendDir) {
      backendEntryDir = `${remoteDir}/backend`
    } else if (hasRootPackageJson) {
      const hasServerJs = (await runQuery(conn, `[ -f "${remoteDir}/server.js" -o -f "${remoteDir}/index.js" -o -f "${remoteDir}/app.js" ] && echo "YES" || echo "NO"`)) === 'YES'
      if (hasServerJs) backendEntryDir = remoteDir
    }

    if (backendEntryDir) {
      onLog(`Installing backend packages in ${backendEntryDir}...\n`, false, 'BACKEND')
      await runCommandStream(conn, `cd ${backendEntryDir} && npm install`, onLog)

      const serverFile = (await runQuery(conn, `
        if [ -f "${backendEntryDir}/server.js" ]; then echo "server.js";
        elif [ -f "${backendEntryDir}/index.js" ]; then echo "index.js";
        elif [ -f "${backendEntryDir}/app.js" ]; then echo "app.js";
        else echo ""; fi
      `)) || 'server.js'

      onLog(`Starting PM2 backend service (${appName} -> ${serverFile} on Port ${backendPort})...\n`, false, 'PM2')
      const pm2Cmd = `
        pm2 delete ${appName} || true
        cd ${backendEntryDir}
        PORT=${backendPort} pm2 start ${serverFile} --name '${appName}' --update-env
        pm2 save
      `
      await runCommandStream(conn, pm2Cmd, onLog)
    } else {
      onLog(`No Node.js backend entry point (server.js/index.js) found. Skipping PM2 backend service.\n`, false, 'PM2')
    }

    // Step 5: Nginx Site Block Configuration
    onLog(`\n==========================================\n[STEP 5/6] Auto-Configuring Nginx Web Server for Domain: ${domain}...\n==========================================\n`, false, 'NGINX')
    
    let proxyLocation = ''
    if (backendEntryDir) {
      proxyLocation = `
    location /api/ {
        proxy_pass http://127.0.0.1:${backendPort}/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }`
    }

    const nginxConf = `server {
    server_name ${domain};

    location / {
        root ${webRootDir};
        index index.html index.htm;
        try_files $uri $uri/ /index.html;
    }
${proxyLocation}

    listen 80;
}`

    const nginxCmd = `
      cat << 'EOF' > /etc/nginx/sites-available/${domain}.conf
${nginxConf}
EOF
      ln -sf /etc/nginx/sites-available/${domain}.conf /etc/nginx/sites-enabled/${domain}.conf
      echo "Testing Nginx configuration syntax..."
      nginx -t
      echo "Reloading Nginx service..."
      systemctl reload nginx
    `
    await runCommandStream(conn, nginxCmd, onLog)

    // Step 6: SSL Provisioning via Certbot
    if (setupSsl) {
      onLog(`\n==========================================\n[STEP 6/6] Auto-Provisioning SSL Certificate via Certbot...\n==========================================\n`, false, 'SSL')
      const certbotCmd = `
        echo "Running Certbot SSL setup for ${domain}..."
        certbot --nginx -d ${domain} --non-interactive --agree-tos --register-unsafely-without-email --redirect || true
        systemctl reload nginx
      `
      await runCommandStream(conn, certbotCmd, onLog, true)
    } else {
      onLog(`\n[STEP 6/6] Skipped SSL Certbot (Disabled in options).\n`, false, 'SSL')
    }

    onLog(`\n==========================================\n🎉 AUTOMATED DEPLOYMENT SUCCESSFUL!\nPublic Domain: https://${domain}\nWeb Root: ${webRootDir}\n==========================================\n`, false, 'COMPLETE')

  } catch (err) {
    onLog(`\n❌ DEPLOYMENT FAILED WITH EXCEPTION:\n${err.message}\n`, true, 'ERROR')
    throw err
  } finally {
    if (conn) conn.end()
  }
}
