import { q } from './host.service.js'

/**
 * Project lifecycle operations (update from Git, delete) through a host executor, so they run
 * the same way on the panel host and on any connected server.
 */

const APP_RE = /^[A-Za-z0-9._-]{1,100}$/
const BRANCH_RE = /^[A-Za-z0-9._\/-]{1,100}$/
const DOMAIN_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i
const PROTECTED_DIRS = new Set(['/', '/root', '/home', '/var', '/var/www', '/var/www/html', '/etc', '/usr'])
const httpError = (status, message) => Object.assign(new Error(message), { status })

function checkDir(dir) {
  dir = String(dir || '').trim().replace(/\/+$/, '')
  if (!/^\/[A-Za-z0-9._\/-]+$/.test(dir) || dir.split('/').includes('..')) throw httpError(400, 'Invalid project path.')
  return dir
}

/**
 * Pull the latest code, install/build, reload PM2.  onLog(text, isError)
 */
export async function updateProject(host, { projectPath, appName, branch = 'main', gitRepoUrl = '', githubToken = '' }, onLog = () => {}) {
  const dir = checkDir(projectPath || (appName ? `/var/www/${appName}` : ''))
  if (!BRANCH_RE.test(branch)) throw httpError(400, 'Invalid branch name.')
  const app = appName && APP_RE.test(appName) ? appName : dir.split('/').pop()
  const step = (t) => onLog(`\n=== ${t} ===\n`)
  const run = async (script) => {
    const r = await host.exec(script, { cwd: dir, timeout: 20 * 60 * 1000, onData: (d, isErr) => onLog(d.replace(/(https:\/\/)[^@\s/]+@/g, '$1***@'), isErr) })
    if (r.code !== 0) throw new Error(`Command failed (exit ${r.code})`)
  }

  step(`Pulling ${branch} from Git`)
  if (!await host.exists(`${dir}/.git`)) {
    if (!gitRepoUrl) throw httpError(400, `${dir} is not a Git repository.`)
    await host.exec(`git clone --branch ${q(branch)} ${q(gitRepoUrl)} ${q(dir)}`, { timeout: 600000, onData: onLog })
  } else {
    await run(`
set -e
ORIGIN=$(git remote get-url origin 2>/dev/null | sed -E 's#https://[^@]+@#https://#')
TOKEN=${q(githubToken)}
if [ -n "$TOKEN" ] && echo "$ORIGIN" | grep -q '^https://github.com/'; then
  git -c credential.helper= fetch "$(echo "$ORIGIN" | sed "s#https://#https://x-access-token:$TOKEN@#")" ${q(branch)}
else
  git fetch origin ${q(branch)}
fi
git stash --include-untracked >/dev/null 2>&1 || true
git checkout -B ${q(branch)} FETCH_HEAD
git reset --hard FETCH_HEAD
git log -1 --format='Now at %h — %s'`)
  }

  step('Installing dependencies and building')
  await run(`
set -e
npm_install() { if [ -f package-lock.json ]; then npm ci --include=dev --no-audit --no-fund || npm install --include=dev --legacy-peer-deps --no-audit --no-fund; else npm install --include=dev --legacy-peer-deps --no-audit --no-fund; fi; }
has_build() { [ -f package.json ] && grep -q '"build"[[:space:]]*:' package.json; }
if [ -f frontend/package.json ]; then (cd frontend && npm_install && npm run build); fi
if [ -f backend/package.json ]; then (cd backend && npm_install && if has_build; then npm run build; fi); fi
if [ -f package.json ] && [ ! -f frontend/package.json ] && [ ! -f backend/package.json ]; then npm_install; if has_build; then npm run build; fi; fi
if [ -f composer.json ]; then COMPOSER_ALLOW_SUPERUSER=1 composer install --no-dev --optimize-autoloader --no-interaction; fi
if [ -f artisan ]; then php artisan migrate --force || true; php artisan config:cache || true; fi
if [ -f requirements.txt ] && [ -d venv ]; then venv/bin/pip install -r requirements.txt; fi`)

  step(`Reloading ${app}`)
  await run(`
if pm2 describe ${q(app)} >/dev/null 2>&1; then pm2 reload ${q(app)} --update-env || pm2 restart ${q(app)} --update-env; pm2 save >/dev/null
else
  APPS=$(pm2 jlist 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s.slice(s.indexOf("[")));console.log(a.filter(p=>(p.pm2_env.pm_cwd||"").startsWith(process.argv[1])).map(p=>p.name).join(" "))}catch(e){}})' ${q(dir)} 2>/dev/null)
  if [ -n "$APPS" ]; then for a in $APPS; do pm2 reload "$a" --update-env || pm2 restart "$a" --update-env; done; pm2 save >/dev/null
  else echo "No PM2 process runs from this project (static or PHP site) — nothing to reload."; fi
fi
nginx -t >/dev/null 2>&1 && systemctl reload nginx 2>/dev/null || true
echo "Update complete."`)
  return { message: `Updated ${app} from ${branch}.` }
}

/**
 * Remove a project's PM2 process, nginx site, database and files.
 */
export async function deleteProject(host, opts) {
  const appName = String(opts.appName || '').trim()
  if (appName && !APP_RE.test(appName)) throw httpError(400, 'Invalid app name.')
  const dir = opts.projectPath ? checkDir(opts.projectPath) : ''
  const domain = String(opts.domain || '').replace(/^https?:\/\//i, '').split('/')[0].split(':')[0].trim().toLowerCase()
  if (domain && !DOMAIN_RE.test(domain)) throw httpError(400, 'Invalid domain.')
  const dbName = String(opts.dbName || '').trim()
  if (dbName && !/^[A-Za-z0-9_]{1,63}$/.test(dbName)) throw httpError(400, 'Invalid database name.')

  const lines = ['echo "=== Deleting ' + (appName || domain || dir).replace(/"/g, '') + ' ==="']
  if (opts.deletePm2 !== false && appName) {
    lines.push(`echo "Removing PM2 process ${appName}"`, `pm2 delete ${q(appName)} 2>&1 || true`, 'pm2 save >/dev/null 2>&1 || true')
  }
  if (opts.deleteNginx !== false && domain) {
    lines.push(`echo "Removing nginx site ${domain}"`,
      `rm -f ${['/etc/nginx/sites-available/', '/etc/nginx/sites-enabled/'].flatMap(d => [q(`${d}${domain}.conf`), q(`${d}${domain}`)]).join(' ')}`,
      'nginx -t 2>&1 && systemctl reload nginx 2>&1 || true')
  }
  if (opts.deleteDb !== false && dbName && !['postgres', 'mysql', 'sys', 'information_schema', 'performance_schema'].includes(dbName)) {
    lines.push(`echo "Dropping database ${dbName} (if it exists)"`,
      `runuser -u postgres -- dropdb --if-exists ${q(dbName)} 2>&1 || true`,
      `mysql -e ${q(`DROP DATABASE IF EXISTS \`${dbName}\``)} 2>&1 || true`)
  }
  if (opts.deleteFiles !== false && dir) {
    const isPanel = /\/auto-deploy-panel$/.test(dir)
    if (PROTECTED_DIRS.has(dir) || isPanel || dir.split('/').filter(Boolean).length < 3) {
      lines.push(`echo "Skipped deleting protected folder ${dir}"`)
    } else {
      lines.push(`echo "Removing ${dir}"`, `rm -rf -- ${q(dir)}`)
    }
  }
  lines.push('echo "=== Done ==="')
  const r = await host.exec(lines.join('\n'), { timeout: 300000 })
  return { message: `Deleted ${appName || domain || dir}${host.isLocal ? '' : ` on ${host.label}`}.`, output: r.stdout + r.stderr }
}
