/**
 * Server health (live CPU, memory, disk, top processes, services) and maintenance tasks
 * (cache clean-up, updates, service restarts, reboot) through a host executor.
 * Every task is a fixed script: callers pick a task id, never a command.
 */

// Root runs commands directly; other SSH users go through passwordless sudo when it is set up
const AS_ROOT = 'S=; [ "$(id -u)" = 0 ] || S="sudo -n"'

// Services shown on the health screen and the only ones that may be restarted
export const SERVICES = ['nginx', 'apache2', 'mysql', 'mariadb', 'postgresql', 'redis-server', 'docker', 'cron', 'ssh', 'fail2ban', 'postfix', 'dovecot', 'php8.3-fpm', 'php8.2-fpm', 'php8.1-fpm', 'php7.4-fpm']
const SERVICE_REGEX = /^[a-z0-9][a-z0-9.@-]{0,63}$/

/** Bytes of each clean-able cache; used for the health screen and to report what a task freed. */
const CACHE_SIZES = `
b() { du -sb "$@" 2>/dev/null | awk '{s+=$1} END{print s+0}'; }
echo "cache.page=$(awk '/^(Cached|Buffers):/{s+=$2} END{print s*1024}' /proc/meminfo)"
echo "cache.apt=$(b /var/cache/apt/archives)"
echo "cache.journal=$(b /var/log/journal /run/log/journal)"
echo "cache.pm2logs=$(b "$HOME/.pm2/logs")"
echo "cache.npm=$(b "$HOME/.npm/_cacache")"
echo "cache.tmp=$(find /tmp /var/tmp -xdev -type f -atime +7 -printf '%s\\n' 2>/dev/null | awk '{s+=$1} END{print s+0}')"
echo "cache.oldlogs=$(find /var/log -xdev -type f \\( -name '*.gz' -o -name '*.[0-9]' -o -name '*.old' \\) -printf '%s\\n' 2>/dev/null | awk '{s+=$1} END{print s+0}')"
`

export const TASKS = {
  'drop-page-cache': {
    label: 'Free RAM cache',
    cache: 'page',
    script: `${AS_ROOT}; sync && echo 3 | $S tee /proc/sys/vm/drop_caches >/dev/null && echo "Page cache, dentries and inodes dropped."`
  },
  'apt-clean': {
    label: 'Clear package cache',
    cache: 'apt',
    script: `${AS_ROOT}; command -v apt-get >/dev/null || { echo "apt is not available on this server."; exit 0; }; $S apt-get clean && $S apt-get autoclean -y`
  },
  'journal-vacuum': {
    label: 'Trim system journal',
    cache: 'journal',
    script: `${AS_ROOT}; command -v journalctl >/dev/null || { echo "journald is not available."; exit 0; }; $S journalctl --vacuum-time=7d --vacuum-size=200M`
  },
  'pm2-flush': {
    label: 'Flush PM2 logs',
    cache: 'pm2logs',
    script: 'command -v pm2 >/dev/null || { echo "PM2 is not installed."; exit 0; }; pm2 flush'
  },
  'npm-cache': {
    label: 'Clear npm cache',
    cache: 'npm',
    script: 'command -v npm >/dev/null || { echo "npm is not installed."; exit 0; }; npm cache clean --force 2>&1 && echo "npm cache cleared."'
  },
  'tmp-clean': {
    label: 'Remove old temp files',
    cache: 'tmp',
    script: `${AS_ROOT}; n=$($S find /tmp /var/tmp -xdev -type f -atime +7 -print -delete 2>/dev/null | wc -l); echo "Removed $n temp files not used for 7+ days."`
  },
  'old-logs': {
    label: 'Delete rotated logs',
    cache: 'oldlogs',
    script: `${AS_ROOT}; n=$($S find /var/log -xdev -type f \\( -name '*.gz' -o -name '*.[0-9]' -o -name '*.old' \\) -print -delete 2>/dev/null | wc -l); echo "Deleted $n rotated log files. Current logs were kept."`
  },
  'clear-all-caches': {
    label: 'Clear all caches',
    cache: 'all',
    script: null // runs every cache task above in turn
  },
  'nginx-reload': {
    label: 'Test & reload nginx',
    script: `${AS_ROOT}; command -v nginx >/dev/null || { echo "nginx is not installed."; exit 1; }; $S nginx -t 2>&1 && $S systemctl reload nginx && echo "nginx reloaded."`
  },
  'check-updates': {
    label: 'Check for updates',
    timeout: 300000,
    script: `${AS_ROOT}; command -v apt-get >/dev/null || { echo "apt is not available on this server."; exit 0; }; $S apt-get update -qq 2>&1 | tail -n 5; n=$(apt list --upgradable 2>/dev/null | tail -n +2 | wc -l); echo "$n package(s) can be upgraded."; apt list --upgradable 2>/dev/null | tail -n +2 | head -n 40`
  },
  'apt-upgrade': {
    label: 'Install updates',
    timeout: 1800000,
    script: `${AS_ROOT}; command -v apt-get >/dev/null || { echo "apt is not available on this server."; exit 1; }; A="$S env DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=120"; $A update -qq && $A -y -o Dpkg::Options::=--force-confold -o Dpkg::Options::=--force-confdef upgrade 2>&1 | tail -n 40; [ -f /var/run/reboot-required ] && echo "A reboot is required to finish the updates."`
  },
  'apt-autoremove': {
    label: 'Remove unused packages',
    timeout: 600000,
    script: `${AS_ROOT}; command -v apt-get >/dev/null || { echo "apt is not available on this server."; exit 0; }; $S env DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=120 -y autoremove 2>&1 | tail -n 20`
  },
  'restart-service': {
    label: 'Restart service',
    script: null // built from the validated service name
  },
  reboot: {
    label: 'Reboot server',
    script: `${AS_ROOT}; nohup $S sh -c 'sleep 3; systemctl reboot || reboot' >/dev/null 2>&1 & echo "Reboot scheduled in 3 seconds. The server will be offline for a minute or two."`
  }
}

const CACHE_TASKS = Object.entries(TASKS).filter(([, t]) => t.cache && t.cache !== 'all').map(([id]) => id)

function parseKv(stdout) {
  return Object.fromEntries(stdout.split('\n').map(l => l.split(/=(.*)/s)).filter(p => p.length > 1).map(([k, v]) => [k.trim(), v.trim()]))
}

/** Bytes held by each clean-able cache (slower: walks the cache folders). */
export async function cacheSizes(host) {
  const { stdout } = await host.exec(CACHE_SIZES, { timeout: 60000 })
  const v = parseKv(stdout)
  return Object.fromEntries(Object.entries(v).filter(([k]) => k.startsWith('cache.')).map(([k, n]) => [k.slice(6), Number(n) || 0]))
}

/**
 * Live health in one round trip: CPU sampled over one second (overall and per core),
 * load, memory, swap, disks, top processes, service states and pending updates.
 * Cache sizes are separate (cacheSizes) so this stays cheap enough to poll.
 */
export async function getServerHealth(host) {
  const { stdout } = await host.exec(`
${AS_ROOT}
s1=$(grep '^cpu' /proc/stat); sleep 1; s2=$(grep '^cpu' /proc/stat)
echo "--CPU--"; printf '%s\\n' "$s1" | sed 's/^/a /'; printf '%s\\n' "$s2" | sed 's/^/b /'
echo "--INFO--"
echo "cores=$(nproc 2>/dev/null || echo 1)"
echo "load=$(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null)"
awk '/^(MemTotal|MemAvailable|SwapTotal|SwapFree|Cached|Buffers):/{gsub(":","",$1); print "mem."$1"="$2}' /proc/meminfo
echo "uptime=$(cut -d. -f1 /proc/uptime 2>/dev/null)"
. /etc/os-release 2>/dev/null; echo "os=$PRETTY_NAME"
echo "kernel=$(uname -r)"
echo "hostname=$(hostname)"
echo "cpuModel=$(awk -F: '/model name/{gsub(/^ +/,"",$2); print $2; exit}' /proc/cpuinfo)"
echo "rebootRequired=$([ -f /var/run/reboot-required ] && echo 1 || echo 0)"
echo "updates=$(command -v apt >/dev/null && apt list --upgradable 2>/dev/null | tail -n +2 | wc -l || echo -1)"
echo "sudo=$([ "$(id -u)" = 0 ] && echo root || ($S true 2>/dev/null && echo sudo || echo none))"
echo "--DISKS--"
df -P -B1 -x tmpfs -x devtmpfs -x squashfs -x overlay 2>/dev/null | tail -n +2
echo "--PROCS--"
ps -eo pid=,user=,pcpu=,pmem=,rss=,etimes=,comm= --sort=-pcpu 2>/dev/null | head -n 12
echo "--SERVICES--"
for s in ${SERVICES.join(' ')}; do
  st=$(systemctl show -p LoadState -p ActiveState -p SubState "$s" 2>/dev/null | tr '\\n' ' ')
  case "$st" in *LoadState=loaded*) echo "$s $st";; esac
done
echo "--FAILED--"
systemctl --failed --no-legend --plain 2>/dev/null | awk '{print $1}' | head -n 20
`, { timeout: 30000 })

  const section = (name) => {
    const m = stdout.split(`--${name}--\n`)[1]
    return (m ? m.split(/\n--[A-Z]+--\n/)[0] : '').split('\n').filter(Boolean)
  }

  // CPU: busy share between the two /proc/stat samples
  const samples = { a: {}, b: {} }
  section('CPU').forEach(l => {
    const [which, name, ...nums] = l.trim().split(/\s+/)
    const n = nums.map(Number)
    const idle = (n[3] || 0) + (n[4] || 0)
    const total = n.slice(0, 8).reduce((x, y) => x + y, 0)
    if (samples[which]) samples[which][name] = { idle, total }
  })
  const usage = (name) => {
    const a = samples.a[name], b = samples.b[name]
    if (!a || !b || b.total <= a.total) return 0
    return Math.round((1 - (b.idle - a.idle) / (b.total - a.total)) * 1000) / 10
  }
  const coreNames = Object.keys(samples.b).filter(n => n !== 'cpu').sort((x, y) => Number(x.slice(3)) - Number(y.slice(3)))

  const v = parseKv(section('INFO').join('\n'))
  const kb = (k) => (Number(v[`mem.${k}`]) || 0) * 1024
  const [load1, load5, load15] = String(v.load || '0 0 0').split(' ').map(Number)
  const memTotal = kb('MemTotal'), memAvail = kb('MemAvailable'), swapTotal = kb('SwapTotal'), swapFree = kb('SwapFree')

  const disks = section('DISKS').map(l => {
    const [fs, size, used, avail, pct, mount] = l.trim().split(/\s+/)
    return { filesystem: fs, mount, size: Number(size) || 0, used: Number(used) || 0, available: Number(avail) || 0, percent: parseInt(pct, 10) || 0 }
  }).filter(d => d.size > 0)

  const processes = section('PROCS').map(l => {
    const [pid, user, cpu, mem, rss, etimes, ...cmd] = l.trim().split(/\s+/)
    return { pid: Number(pid), user, cpu: Number(cpu) || 0, memory: Number(mem) || 0, rssBytes: (Number(rss) || 0) * 1024, uptimeSeconds: Number(etimes) || 0, command: cmd.join(' ') }
  })

  const services = section('SERVICES').map(l => {
    const [name] = l.split(' ')
    return { name, active: l.match(/ActiveState=(\S+)/)?.[1] || 'unknown', sub: l.match(/SubState=(\S+)/)?.[1] || '' }
  })

  return {
    cpu: {
      usage: usage('cpu'),
      cores: coreNames.map(n => ({ name: n, usage: usage(n) })),
      count: Number(v.cores) || coreNames.length || 1,
      model: v.cpuModel || null,
      load: { load1, load5, load15 }
    },
    memory: { total: memTotal, available: memAvail, used: memTotal - memAvail, cached: kb('Cached') + kb('Buffers'), percent: memTotal ? Math.round((memTotal - memAvail) / memTotal * 1000) / 10 : 0 },
    swap: { total: swapTotal, used: swapTotal - swapFree, percent: swapTotal ? Math.round((swapTotal - swapFree) / swapTotal * 1000) / 10 : 0 },
    disks,
    processes,
    services,
    failedUnits: section('FAILED'),
    system: {
      hostname: v.hostname || null,
      os: v.os || 'Linux',
      kernel: v.kernel || null,
      uptimeSeconds: Number(v.uptime) || 0,
      rebootRequired: v.rebootRequired === '1',
      pendingUpdates: Number(v.updates) >= 0 ? Number(v.updates) : null,
      privileges: v.sudo || 'none'
    },
    sampledAt: new Date().toISOString()
  }
}

const running = new Set() // server key while a task runs there

/**
 * Runs one maintenance task. Cache tasks report how many bytes they freed.
 * `serverKey` serialises tasks per server (apt and reboots must never overlap).
 */
export async function runMaintenanceTask(host, serverKey, taskId, { service } = {}) {
  const task = TASKS[taskId]
  if (!task) throw Object.assign(new Error('Unknown maintenance task.'), { status: 400 })
  if (taskId === 'reboot' && host.isLocal) {
    throw Object.assign(new Error('This is the server the panel runs on. Reboot it over SSH so the panel is not cut off mid-request.'), { status: 400 })
  }
  let script = task.script
  if (taskId === 'restart-service') {
    if (!SERVICE_REGEX.test(String(service || '')) || !SERVICES.includes(service)) throw Object.assign(new Error('Choose one of the listed services.'), { status: 400 })
    script = `${AS_ROOT}; $S systemctl restart ${service} && sleep 1 && echo "${service}: $(systemctl is-active ${service})"`
  }
  if (running.has(serverKey)) throw Object.assign(new Error('Another maintenance task is still running on this server.'), { status: 409 })

  running.add(serverKey)
  try {
    if (taskId === 'clear-all-caches') {
      const before = await cacheSizes(host)
      const lines = []
      let ok = true
      for (const id of CACHE_TASKS) {
        const r = await host.exec(TASKS[id].script, { timeout: 300000 })
        ok = ok && r.code === 0
        lines.push(`▸ ${TASKS[id].label}\n${(r.stdout + r.stderr).trim() || 'done'}`)
      }
      const after = await cacheSizes(host)
      const freed = Object.keys(before).reduce((s, k) => s + Math.max(0, before[k] - (after[k] || 0)), 0)
      return { success: ok, label: task.label, output: lines.join('\n\n'), freedBytes: freed }
    }

    const before = task.cache ? (await cacheSizes(host))[task.cache] : null
    const r = await host.exec(script, { timeout: task.timeout || 300000 })
    const output = (r.stdout + (r.stderr ? `\n${r.stderr}` : '')).trim()
    let freedBytes = null
    if (task.cache && r.code === 0) freedBytes = Math.max(0, before - (await cacheSizes(host))[task.cache])
    const needsSudo = /sudo: a password is required|a terminal is required/.test(output)
    return {
      success: r.code === 0,
      label: task.label,
      output: needsSudo ? `${output}\n\nThis task needs root. Connect the server as root or allow passwordless sudo for this user.` : output,
      freedBytes
    }
  } finally {
    running.delete(serverKey)
  }
}
