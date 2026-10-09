/**
 * Live server telemetry through a host executor (see host.service.js), so the same code
 * reports on the panel's own machine and on any connected server.
 */

/** CPU, memory, disk, OS and uptime in one round trip. */
export async function getRealHostMetrics(host) {
  const { stdout } = await host.exec(`
echo "cores=$(nproc 2>/dev/null || echo 1)"
echo "load=$(cut -d' ' -f1 /proc/loadavg 2>/dev/null)"
awk '/^MemTotal:/{print "memTotal="$2} /^MemAvailable:/{print "memAvail="$2}' /proc/meminfo 2>/dev/null
echo "disk=$(df -P / 2>/dev/null | awk 'NR==2{gsub("%","",$5); print $5}')"
echo "uptime=$(cut -d. -f1 /proc/uptime 2>/dev/null)"
. /etc/os-release 2>/dev/null; echo "os=$PRETTY_NAME ($(uname -m))"
echo "node=$(node -v 2>/dev/null)"
echo "hostname=$(hostname)"`, { timeout: 20000 })
  const v = Object.fromEntries(stdout.split('\n').map(l => l.split(/=(.*)/s)).filter(p => p.length > 1).map(([k, val]) => [k.trim(), val.trim()]))
  const cores = Number(v.cores) || 1
  const totalKb = Number(v.memTotal) || 0
  const availKb = Number(v.memAvail) || 0
  return {
    status: 'online',
    cpu: Math.min(100, Math.max(0, Math.round((Number(v.load) || 0) / cores * 100))),
    memory: totalKb ? Math.round((totalKb - availKb) / totalKb * 100) : 0,
    disk: Number(v.disk) || 0,
    totalRamMb: Math.round(totalKb / 1024),
    freeRamMb: Math.round(availKb / 1024),
    usedRamMb: Math.round((totalKb - availKb) / 1024),
    cpuCores: cores,
    osType: v.os || 'Linux',
    nodeVersion: v.node || null,
    hostname: v.hostname || null,
    uptimeSeconds: Number(v.uptime) || 0,
    lastUpdated: new Date().toISOString()
  }
}

function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000)
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m ${seconds % 60}s`
}

export function parsePm2List(output) {
  const start = output.indexOf('[')
  const end = output.lastIndexOf(']')
  if (start === -1 || end <= start) return []
  try {
    return JSON.parse(output.slice(start, end + 1)).map((proc) => {
      const env = proc.pm2_env || {}
      const monit = proc.monit || {}
      return {
        pm_id: proc.pm_id,
        name: proc.name,
        status: env.status || 'unknown',
        cpu: monit.cpu !== undefined ? `${monit.cpu}%` : '0%',
        memory: monit.memory ? `${Math.round(monit.memory / 1048576)} MB` : '0 MB',
        restarts: env.restart_time || 0,
        uptime: env.pm_uptime ? Date.now() - env.pm_uptime : 0,
        uptimeFormatted: env.pm_uptime ? formatUptime(Date.now() - env.pm_uptime) : '0s',
        script: env.pm_exec_path || '',
        cwd: env.pm_cwd || '',
        port: env.PORT || env.env?.PORT || null
      }
    })
  } catch {
    return []
  }
}

export async function getRealPm2Processes(host) {
  const { stdout } = await host.exec('pm2 jlist 2>/dev/null', { timeout: 20000 })
  return parsePm2List(stdout)
}

export async function getRealSslCertificates(host) {
  const { stdout } = await host.exec('certbot certificates 2>/dev/null || true; echo "--LIVE--"; ls /etc/letsencrypt/live 2>/dev/null', { timeout: 60000 })
  const [certbotOut, liveOut = ''] = stdout.split('--LIVE--')
  const certs = []
  certbotOut.split('Certificate Name:').slice(1).forEach((block, idx) => {
    const name = block.split('\n')[0].trim()
    const domains = block.match(/Domains:\s*(.+)/)?.[1].trim() || name
    const expiry = block.match(/Expiry Date:\s*(\S+ \S+)/)?.[1]?.replace(/([+-]\d\d:\d\d)$/, '$1')
    const days = Number(block.match(/VALID:\s*(\d+)\s*day/)?.[1])
    const invalid = /INVALID|EXPIRED/.test(block)
    certs.push({
      id: `cert-${idx}`,
      name,
      domain: domains,
      issuer: "Let's Encrypt",
      status: invalid ? 'expired' : days < 15 ? 'expiring' : 'valid',
      expiresInDays: Number.isFinite(days) ? days : null,
      expiresAt: (() => { const d = expiry ? new Date(expiry.replace(' ', 'T')) : null; return d && !isNaN(d) ? d.toISOString() : null })(),
      autoRenew: true
    })
  })
  if (!certs.length) {
    liveOut.split('\n').map(s => s.trim()).filter(d => d && d !== 'README').forEach((d, idx) => {
      certs.push({ id: `cert-live-${idx}`, name: d, domain: d, issuer: "Let's Encrypt", status: 'valid', expiresInDays: null, expiresAt: null, autoRenew: true })
    })
  }
  return certs
}

export async function getRealCronJobs(host) {
  const { stdout } = await host.exec('crontab -l 2>/dev/null', { timeout: 15000 })
  const jobs = []
  stdout.split('\n').forEach((line, idx) => {
    const t = line.trim()
    if (!t || t.startsWith('#')) return
    const parts = t.split(/\s+/)
    if (t.startsWith('@')) {
      jobs.push({ id: `cron-${idx}`, name: `Cron task #${jobs.length + 1}`, schedule: parts[0], command: parts.slice(1).join(' '), status: 'active', lastRun: null })
    } else if (parts.length >= 6) {
      jobs.push({ id: `cron-${idx}`, name: `Cron task #${jobs.length + 1}`, schedule: parts.slice(0, 5).join(' '), command: parts.slice(5).join(' '), status: 'active', lastRun: null })
    }
  })
  return jobs
}
