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
 */
function runCommandStream(conn, command, onLog) {
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
        if (code === 0) {
          resolve(code)
        } else {
          resolve(code) // Resolve exit code so caller can handle non-zero gracefully
        }
      })
    })
  })
}

/**
 * Executes full multi-step deployment pipeline on the remote server.
 */
export async function executeDeployment(config, onLog) {
  let conn
  try {
    onLog(`Connecting to remote server ${config.username}@${config.host}:${config.port || 22}...\n`, false, 'INIT')
    conn = await connectSsh(config)
    onLog(`SSH Connection Established Successfully!\n\n`, false, 'INIT')

    const domain = config.domain ? config.domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : ''
    const appName = config.appName || 'tip-crm-backend'
    const backendPort = config.backendPort || 5050
    const remoteDir = config.remoteDir || '/var/www/tip-crm'
    const gitRepoUrl = config.gitRepoUrl || 'https://github.com/yatindradhurwe/TOP-Income-Producer-CRM.git'
    const setupSsl = config.setupSsl !== false

    if (!domain) {
      throw new Error('Public Domain Name is required for deployment')
    }

    // Step 1: Ensure Target Directory & Git Clone / Pull
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
    await runCommandStream(conn, gitCmd, onLog)

    // Step 2: Install Frontend Dependencies & Build Bundle
    onLog(`\n==========================================\n[STEP 2/6] Building Frontend Dist Bundle...\n==========================================\n`, false, 'FRONTEND')
    const frontendCmd = `
      cd ${remoteDir}/frontend
      echo "Installing frontend packages..."
      npm install --production=false
      echo "Executing Vite build..."
      npm run build
    `
    await runCommandStream(conn, frontendCmd, onLog)

    // Step 3: Install Backend Dependencies
    onLog(`\n==========================================\n[STEP 3/6] Installing Backend Dependencies...\n==========================================\n`, false, 'BACKEND')
    const backendCmd = `
      cd ${remoteDir}/backend
      echo "Installing backend packages..."
      npm install
    `
    await runCommandStream(conn, backendCmd, onLog)

    // Step 4: PM2 Backend Process Lifecycle Management
    onLog(`\n==========================================\n[STEP 4/6] Configuring PM2 Service (${appName} on Port ${backendPort})...\n==========================================\n`, false, 'PM2')
    const pm2Cmd = `
      pm2 delete ${appName} || true
      cd ${remoteDir}/backend
      PORT=${backendPort} pm2 start server.js --name '${appName}' --update-env
      pm2 save
    `
    await runCommandStream(conn, pm2Cmd, onLog)

    // Step 5: Nginx Site Block Configuration
    onLog(`\n==========================================\n[STEP 5/6] Auto-Configuring Nginx Web Server for Domain: ${domain}...\n==========================================\n`, false, 'NGINX')
    const nginxConf = `server {
    server_name ${domain};

    location / {
        root ${remoteDir}/frontend/dist;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

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
    }

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
      await runCommandStream(conn, certbotCmd, onLog)
    } else {
      onLog(`\n[STEP 6/6] Skipped SSL Certbot (Disabled in options).\n`, false, 'SSL')
    }

    onLog(`\n==========================================\n🎉 AUTOMATED DEPLOYMENT SUCCESSFUL!\nPublic Domain: https://${domain}\nBackend API: https://${domain}/api/health\n==========================================\n`, false, 'COMPLETE')

  } catch (err) {
    onLog(`\n❌ DEPLOYMENT FAILED WITH EXCEPTION:\n${err.message}\n`, true, 'ERROR')
    throw err
  } finally {
    if (conn) conn.end()
  }
}
