import path from 'path'
import { parsePm2List } from './server.service.js'

/**
 * Finds the projects that live on a server — /var/www/*, /home/*\/htdocs/*, PM2 apps and the
 * nginx sites that point at them — with one script, so discovery costs a single round trip
 * on a remote server.
 */

const DISCOVERY_SCRIPT = `
echo "##PM2"; pm2 jlist 2>/dev/null
echo; echo "##NGINX"
for f in /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf; do
  [ -f "$f" ] || continue
  echo "@@FILE $f"
  grep -E '^[[:space:]]*(server_name|root|proxy_pass)[[:space:]]' "$f" 2>/dev/null
done
echo "##META"
CWDS=$(pm2 jlist 2>/dev/null | grep -o '"pm_cwd":"[^"]*"' | sed 's/"pm_cwd":"//; s/"$//' | sort -u)
for d in /var/www/*/ /home/*/htdocs/*/ $CWDS; do
  d="\${d%/}"
  [ -d "$d" ] || continue
  echo "@@DIR $d"
  git -C "$d" config --get remote.origin.url 2>/dev/null | sed 's/^/git=/'
  git -C "$d" rev-parse --abbrev-ref HEAD 2>/dev/null | sed 's/^/branch=/'
  grep -m1 -E '^PORT[[:space:]]*=' "$d/.env" 2>/dev/null | sed 's/^/env/'
  [ -f "$d/package.json" ] && echo "pkg=1"
  [ -f "$d/composer.json" ] || [ -f "$d/index.php" ] && echo "php=1"
done
`

const redactUrl = (u) => String(u || '').replace(/(https?:\/\/)[^@/\s]+@/, '$1')

function parseOutput(stdout) {
  const sections = {}
  let current = null
  for (const line of stdout.split('\n')) {
    const m = line.match(/^##(\w+)$/)
    if (m) { current = m[1]; sections[current] = []; continue }
    if (current) sections[current].push(line)
  }

  const pm2 = parsePm2List((sections.PM2 || []).join('\n'))

  const byPath = new Map()
  const byPort = new Map()
  let site = null
  const flush = () => {
    if (!site?.domain) return
    for (const r of site.roots) {
      byPath.set(r.toLowerCase(), site.domain)
      byPath.set(r.replace(/\/(dist|build|public|frontend\/dist|frontend|public_html)\/?$/, '').toLowerCase(), site.domain)
    }
    for (const p of site.ports) byPort.set(p, site.domain)
  }
  for (const line of sections.NGINX || []) {
    if (line.startsWith('@@FILE')) { flush(); site = { domain: null, roots: [], ports: [] }; continue }
    if (!site) continue
    const t = line.trim().replace(/;$/, '')
    if (t.startsWith('server_name') && !site.domain) {
      site.domain = t.split(/\s+/).slice(1).find(n => n && !n.includes('_') && n !== 'localhost' && !n.startsWith('$'))?.replace(/^www\./, '') || null
    } else if (t.startsWith('root')) site.roots.push(t.split(/\s+/)[1])
    else if (t.startsWith('proxy_pass')) {
      const port = t.match(/(?:127\.0\.0\.1|localhost):(\d+)/)?.[1]
      if (port) site.ports.push(port)
    }
  }
  flush()

  const meta = new Map()
  let dir = null
  for (const line of sections.META || []) {
    if (line.startsWith('@@DIR ')) { dir = line.slice(6).trim(); meta.set(dir, {}); continue }
    if (!dir) continue
    const [k, ...rest] = line.split('=')
    const v = rest.join('=').trim()
    if (k === 'git') meta.get(dir).gitUrl = redactUrl(v)
    else if (k === 'branch') meta.get(dir).branch = v
    else if (k === 'envPORT') meta.get(dir).port = v.replace(/["']/g, '')
    else if (k === 'pkg') meta.get(dir).node = true
    else if (k === 'php') meta.get(dir).php = true
  }
  return { pm2, byPath, byPort, meta }
}

/**
 * @param host       executor from host.service
 * @param registered projects recorded in db.json for this server (from deployments)
 * @param options    { panelRoot } — the panel's own install, labelled specially on the panel host
 */
export async function discoverProjects(host, registered = [], { panelRoot = null } = {}) {
  const { stdout } = await host.exec(DISCOVERY_SCRIPT, { timeout: 30000 })
  const { pm2, byPath, byPort, meta } = parseOutput(stdout)

  // Candidate project folders: /var/www/*, /home/*/htdocs/*, PM2 working dirs, registered paths
  const candidates = new Map()
  for (const d of meta.keys()) {
    if (d === '/var/www/html' || d === '/var/www') continue
    candidates.set(d, { name: path.basename(d) })
  }
  for (const p of pm2) if (p.cwd && !candidates.has(p.cwd) && meta.has(p.cwd)) candidates.set(p.cwd, { name: p.name })
  for (const r of registered) if (r.path && !candidates.has(r.path)) candidates.set(r.path, { name: r.name, registered: r })

  // Fold sub-folders (an app's backend/ run by PM2) into their project folder
  for (const d of [...candidates.keys()]) {
    const parent = [...candidates.keys()].find(o => o !== d && d.startsWith(o + '/'))
    if (parent) {
      const child = candidates.get(d)
      candidates.get(parent).pm2Name ||= child.name
      candidates.delete(d)
    }
  }

  const projects = []
  for (const [dir, c] of candidates) {
    const m = meta.get(dir) || {}
    const reg = c.registered || registered.find(r => r.path === dir)
    const procs = pm2.filter(p => p.cwd === dir || p.cwd.startsWith(dir + '/'))
    const folder = path.basename(dir)
    let domain = reg?.domain || byPath.get(dir.toLowerCase()) || null
    if (!domain) for (const [p, dom] of byPath) if (p.startsWith(dir.toLowerCase() + '/')) { domain = dom; break }
    const port = m.port || procs.find(p => p.port)?.port || reg?.port || null
    if (!domain && port && byPort.has(String(port))) domain = byPort.get(String(port))
    const running = procs.some(p => p.status === 'online')
    const isPanel = panelRoot && dir === panelRoot

    projects.push({
      id: reg?.id || `proj-${folder.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
      name: isPanel ? 'AutoDeploy Panel (This Studio)' : (reg?.name || folder),
      repoName: folder,
      path: dir,
      domain: domain ? domain.replace(/^www\./, '') : null,
      gitUrl: m.gitUrl || reg?.gitUrl || '',
      branch: m.branch && m.branch !== 'HEAD' ? m.branch : (reg?.branch || 'main'),
      port: port ? String(port) : null,
      framework: reg?.framework || null,
      pm2Processes: procs.map(p => ({ name: p.name, status: p.status, memory: p.memory, cpu: p.cpu, restarts: p.restarts })),
      type: procs.length ? 'Active PM2 Service' : m.php ? 'PHP Website' : m.node ? 'Node.js App' : 'Web Application',
      status: running ? 'active' : procs.length ? 'stopped' : 'idle',
      registered: !!reg
    })
  }
  return projects.sort((a, b) => (b.status === 'active') - (a.status === 'active') || a.name.localeCompare(b.name))
}
