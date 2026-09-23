import { Client } from 'ssh2'

const SYSTEM_PATH_EXPORT = `export PATH=$PATH:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:~/.nvm/versions/node/$(ls ~/.nvm/versions/node 2>/dev/null | tail -n 1)/bin`

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
      host: config.host || '187.127.165.128',
      port: parseInt(config.port || 22, 10),
      username: config.username || 'root',
      readyTimeout: 15000,
    }

    if (config.privateKey) {
      connConfig.privateKey = config.privateKey
    } else {
      connConfig.password = config.password || 'Yatindra@1223'
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
      conn.exec(`${SYSTEM_PATH_EXPORT}\nuname -a && uptime && df -h /`, (err, stream) => {
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
      ${SYSTEM_PATH_EXPORT}
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
                cwd: app.pm2_env?.pm_cwd || null
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
    const fullCmd = `${SYSTEM_PATH_EXPORT}\n${command}`
    conn.exec(fullCmd, (err, stream) => {
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
    const fullCmd = `${SYSTEM_PATH_EXPORT}\n${command}`
    conn.exec(fullCmd, (err, stream) => {
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
    let gitRepoUrl = (config.gitRepoUrl || config.gitUrl || '').trim()
    const appName = (config.appName || 'my-app').trim()
    const backendPort = config.backendPort || 5050
    let remoteDir = (config.remoteDir || `/var/www/${appName}`).trim()
    const branch = config.branch || 'main'
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
    onLog(`\n==========================================\n[STEP 1/6] Syncing Codebase from Repository (${branch})...\n==========================================\n`, false, 'GIT')
    const gitCmd = `
      if [ -d "${remoteDir}/.git" ]; then
        echo "Updating existing repository at ${remoteDir} (branch: ${branch})..."
        cd ${remoteDir} && git fetch --all && (git checkout ${branch} 2>/dev/null || git checkout -b ${branch} origin/${branch} 2>/dev/null || true) && git reset --hard origin/${branch} && git pull origin ${branch}
      else
        echo "Cloning repository ${gitRepoUrl} (branch: ${branch}) into ${remoteDir}..."
        mkdir -p ${remoteDir}
        git clone -b ${branch} ${gitRepoUrl} ${remoteDir} || git clone ${gitRepoUrl} ${remoteDir}
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

    // Persist Environment Variables (.env) if provided
    if (config.envVars && config.envVars.trim()) {
      onLog(`Persisting environment configuration (.env) on remote server...\n`, false, 'ENV')
      const envContent = config.envVars.trim()
      const writeEnvCmd = `cat << 'EOF' > ${remoteDir}/.env\n${envContent}\nEOF`
      await runCommandStream(conn, writeEnvCmd, onLog)

      if (hasBackendDir) {
        const writeBackendEnvCmd = `cat << 'EOF' > ${remoteDir}/backend/.env\n${envContent}\nEOF`
        await runCommandStream(conn, writeBackendEnvCmd, onLog)
      }
    }

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

/**
 * Fast Update pipeline for existing live server deployment
 */
export async function updateExistingDeployment(config, onLog) {
  let conn
  try {
    onLog(`[SSH UPDATE] Connecting to live server ${config.username || 'root'}@${config.host}:${config.port || 22}...\n`, false, 'INIT')
    conn = await connectSsh(config)
    onLog(`[SSH UPDATE] Connection established cleanly!\n`, false, 'INIT')

    const remoteDir = (config.remoteDir || `/var/www/${config.appName || 'my-app'}`).trim()
    const appName = (config.appName || 'my-app').trim()
    const branch = config.branch || 'main'

    onLog(`\n==========================================\n[STEP 1/3] Pulling Latest Changes from GitHub (${branch})...\n==========================================\n`, false, 'GIT')
    const pullCmd = `
      if [ -d "${remoteDir}/.git" ]; then
        cd ${remoteDir}
        echo "Working Directory: ${remoteDir}"
        CURRENT_ORIGIN=$(git remote get-url origin 2>/dev/null || echo "")
        if [ -n "$CURRENT_ORIGIN" ]; then
          CLEAN_ORIGIN=$(echo "$CURRENT_ORIGIN" | sed -E 's#https://[^@]+@#https://#')
          GH_TOKEN="${config.githubToken || ''}"
          if [ -n "$GH_TOKEN" ]; then
            AUTH_ORIGIN=$(echo "$CLEAN_ORIGIN" | sed "s#https://#https://$GH_TOKEN@#")
            git remote set-url origin "$AUTH_ORIGIN" 2>/dev/null || true
          else
            git remote set-url origin "$CLEAN_ORIGIN" 2>/dev/null || true
          fi
        fi
        git fetch --all --tags 2>/dev/null || true
        git stash --include-untracked 2>/dev/null || true
        git checkout ${branch} 2>/dev/null || git checkout -b ${branch} origin/${branch} 2>/dev/null || true
        git reset --hard origin/${branch}
        git pull origin ${branch}
      elif [ -n "${config.gitRepoUrl}" ]; then
        echo "Repository directory missing .git. Re-cloning ${config.gitRepoUrl} into ${remoteDir}..."
        mkdir -p ${remoteDir}
        git clone ${config.gitRepoUrl} ${remoteDir}
      else
        echo "Error: Directory ${remoteDir} is not a git repository."
        exit 1
      fi
    `
    await runCommandStream(conn, pullCmd, onLog)

    onLog(`\n==========================================\n[STEP 2/3] Installing Dependencies & Building Production Code...\n==========================================\n`, false, 'BUILD')
    const buildCmd = `
      cd ${remoteDir}
      if [ -d "frontend" ]; then
        echo "Building frontend workspace in ${remoteDir}/frontend..."
        cd frontend && npm install --production=false && npm run build && cd ..
      fi
      if [ -d "backend" ]; then
        echo "Installing backend dependencies in ${remoteDir}/backend..."
        cd backend && npm install && cd ..
      elif [ -f "package.json" ]; then
        echo "Installing root npm packages in ${remoteDir}..."
        npm install
      fi
    `
    await runCommandStream(conn, buildCmd, onLog)

    onLog(`\n==========================================\n[STEP 3/3] Reloading PM2 Service (${appName})...\n==========================================\n`, false, 'PM2')
    const pm2Cmd = `
      if pm2 describe ${appName} > /dev/null 2>&1; then
        echo "Reloading existing PM2 process '${appName}' without downtime..."
        pm2 reload ${appName} --update-env || pm2 restart ${appName} --update-env
      else
        echo "Starting PM2 process '${appName}'..."
        if [ -d "${remoteDir}/backend" ]; then
          cd ${remoteDir}/backend && (pm2 start server.js --name ${appName} --update-env || pm2 start index.js --name ${appName} --update-env)
        else
          cd ${remoteDir} && (pm2 start server.js --name ${appName} --update-env || pm2 start index.js --name ${appName} --update-env)
        fi
      fi
      pm2 save
      echo "Testing Nginx syntax & reloading web server..."
      nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null || true
    `
    await runCommandStream(conn, pm2Cmd, onLog)

    onLog(`\n==========================================\n🎉 LIVE SERVER UPDATED & RELOADED SUCCESSFULLY!\nApp Name: ${appName}\nRemote Path: ${remoteDir}\n==========================================\n`, false, 'COMPLETE')

  } catch (err) {
    onLog(`\n❌ LIVE SERVER UPDATE FAILED: ${err.message}\n`, true, 'ERROR')
    throw err
  } finally {
    if (conn) conn.end()
  }
}

/**
 * Deletes a project, duplicate website directory, PM2 service, and Nginx config from remote server.
 */
export async function deleteServerProject(config) {
  let conn
  try {
    conn = await connectSsh(config)
    const appName = (config.appName || '').trim()
    let remoteDir = (config.projectPath || config.remoteDir || '').trim()
    let domain = (config.domain || '').trim()
    const deletePm2 = config.deletePm2 !== false
    const deleteFiles = config.deleteFiles !== false
    const deleteNginx = config.deleteNginx !== false

    // Clean domain name (remove http://, https://, ports, slashes)
    if (domain) {
      domain = domain.replace(/^https?:\/\//i, '').split('/')[0].split(':')[0].trim()
    }

    // Clean remote directory path (remove trailing slashes)
    if (remoteDir) {
      remoteDir = remoteDir.replace(/\/+$/, '')
    }

    let cmd = `${SYSTEM_PATH_EXPORT}\n`
    cmd += `echo "=== DELETING PROJECT / WEBSITE FROM LIVE SERVER ==="\n`

    if (deletePm2 && appName) {
      cmd += `echo "Stopping & deleting PM2 process '${appName}'..."\n`
      cmd += `pm2 delete "${appName}" 2>&1 || pm2 stop "${appName}" 2>&1 || true\n`
      cmd += `pm2 save 2>&1 || true\n`
    }

    if (deleteNginx && domain) {
      cmd += `echo "Removing Nginx site configuration files for domain '${domain}'..."\n`
      cmd += `rm -f /etc/nginx/sites-available/${domain}.conf /etc/nginx/sites-enabled/${domain}.conf 2>&1 || true\n`
      cmd += `rm -f /etc/nginx/sites-available/${domain} /etc/nginx/sites-enabled/${domain} 2>&1 || true\n`
      cmd += `nginx -t 2>&1 && systemctl reload nginx 2>&1 || true\n`
    }

    // Protected directories safety check
    const protectedDirs = [
      '/var/www', '/var/www/', '/var/www/html', '/var/www/html/',
      '/', '/root', '/home',
      '/var/www/auto-deploy-panel', '/var/www/auto-deploy-panel/'
    ]
    const isProtected = protectedDirs.includes(remoteDir)

    if (deleteFiles && remoteDir && !isProtected && (remoteDir.startsWith('/var/www/') || remoteDir.startsWith('/root/') || remoteDir.startsWith('/home/'))) {
      cmd += `echo "Removing project directory '${remoteDir}'..."\n`
      cmd += `rm -rf "${remoteDir}" 2>&1 || true\n`
    } else if (deleteFiles && remoteDir && isProtected) {
      cmd += `echo "⚠️ Protected system directory '${remoteDir}' skipped for safety."\n`
    }

    cmd += `echo "=== PROJECT DELETION COMPLETE ==="\n`

    return new Promise((resolve, reject) => {
      conn.exec(cmd, (err, stream) => {
        if (err) {
          conn.end()
          return reject(err)
        }
        let output = ''
        stream.on('data', d => output += d.toString())
        stream.stderr.on('data', d => output += d.toString())
        stream.on('close', code => {
          conn.end()
          resolve({ success: true, message: `Successfully deleted project '${appName || remoteDir || domain}' from server`, output })
        })
      })
    })
  } catch (err) {
    if (conn) conn.end()
    throw err
  }
}
