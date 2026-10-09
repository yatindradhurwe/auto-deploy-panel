import { Client } from 'ssh2'

const SYSTEM_PATH_EXPORT = `export PATH=$PATH:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:~/.nvm/versions/node/$(ls ~/.nvm/versions/node 2>/dev/null | tail -n 1)/bin`

/**
 * Connects to a remote Linux server using ssh2 and returns an active Client instance.
 */
export function connectSsh(config) {
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
