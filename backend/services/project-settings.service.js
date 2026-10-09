import path from 'path'
import { readDb, writeDb } from './db.service.js'

/**
 * Project settings from the studio, applied to the real app on its server:
 *  - integration keys (payments, email, spam protection, analytics, business details, custom
 *    variables) are written to the project's .env, where the app reads them
 *  - code injection, SEO tags, analytics snippets and redirects are applied by nginx in front of
 *    the site (server-level include, validated with `nginx -t` and rolled back on failure)
 *  - publishing status starts/stops the project's PM2 processes
 *  - the brand brief is given to the project's AI agent
 * Panel-only values (display name, brief, injection, redirects) are kept in db.projectSettings.
 */

const httpError = (status, message) => Object.assign(new Error(message), { status })

/** .env keys each settings section may write. */
export const ENV_SECTIONS = {
  brand: ['APP_NAME', 'BRAND_PRIMARY_COLOR'],
  languages: ['DEFAULT_LOCALE', 'SUPPORTED_LOCALES', 'TZ'],
  business: ['COMPANY_NAME', 'BUSINESS_EMAIL', 'BUSINESS_PHONE', 'BUSINESS_ADDRESS', 'DEFAULT_CURRENCY'],
  payments: ['STRIPE_PUBLISHABLE_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_MODE', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'],
  email: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM', 'RESEND_API_KEY'],
  spam: ['RECAPTCHA_SITE_KEY', 'RECAPTCHA_SECRET_KEY', 'TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY'],
  shipping: ['SHIPPO_API_KEY', 'EASYPOST_API_KEY', 'SHIPROCKET_EMAIL', 'SHIPROCKET_PASSWORD'],
  analytics: ['GA_MEASUREMENT_ID', 'POSTHOG_KEY', 'POSTHOG_HOST']
}
const KNOWN_ENV_KEYS = new Set(Object.values(ENV_SECTIONS).flat())
const ENV_KEY_RE = /^[A-Z][A-Z0-9_]{0,63}$/
const MAX_INJECT = 20000

// ---------------------------------------------------------------------------------------------
// Stored settings
// ---------------------------------------------------------------------------------------------

export function settingsKey(server, projectPath) {
  return `${server?.id || 'local'}::${path.posix.resolve(projectPath)}`
}

export function getStoredSettings(server, projectPath) {
  return (readDb().projectSettings || {})[settingsKey(server, projectPath)] || {}
}

function saveStoredSettings(server, projectPath, patch, userId) {
  const db = readDb()
  if (!db.projectSettings) db.projectSettings = {}
  const key = settingsKey(server, projectPath)
  db.projectSettings[key] = { ...(db.projectSettings[key] || {}), ...patch, updatedAt: new Date().toISOString(), updatedBy: userId }
  writeDb(db)
  return db.projectSettings[key]
}

// ---------------------------------------------------------------------------------------------
// .env
// ---------------------------------------------------------------------------------------------

async function envFile(host, dir) {
  for (const f of ['.env', '.env.production', '.env.local']) {
    if (await host.exists(`${dir}/${f}`)) return `${dir}/${f}`
  }
  return `${dir}/.env`
}

function parseEnvValue(raw) {
  const v = raw.trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    const inner = v.slice(1, -1)
    return v.startsWith('"') ? inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\') : inner
  }
  return v.replace(/\s+#.*$/, '')
}

function formatEnvValue(value) {
  const v = String(value)
  return /^[A-Za-z0-9_./:@+,-]*$/.test(v) ? v : `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export async function readEnv(host, dir) {
  const file = await envFile(host, dir)
  const raw = (await host.exists(file)) ? await host.readFile(file) : ''
  const values = {}
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/)
    if (m) values[m[1]] = parseEnvValue(m[2])
  }
  return { file, raw, values }
}

/**
 * Sets (or with null/'' removes) keys in the project's .env, keeping comments, order and other keys.
 */
async function writeEnvKeys(host, dir, updates) {
  const { file, raw } = await readEnv(host, dir)
  const pending = new Map(Object.entries(updates))
  const out = []
  for (const line of raw ? raw.split('\n') : []) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)
    if (m && pending.has(m[1])) {
      const v = pending.get(m[1])
      pending.delete(m[1])
      if (v !== null && v !== '') out.push(`${m[1]}=${formatEnvValue(v)}`)
      continue
    }
    out.push(line)
  }
  while (out.length && out[out.length - 1] === '') out.pop()
  for (const [k, v] of pending) if (v !== null && v !== '') out.push(`${k}=${formatEnvValue(v)}`)
  await host.writeFile(file, out.join('\n') + '\n', { mode: 0o600 })
  return file
}

function cleanEnvValue(key, value) {
  if (value === null || value === undefined) return ''
  const v = String(value)
  if (/[\r\n\0]/.test(v)) throw httpError(400, `${key} cannot contain line breaks.`)
  if (v.length > 4000) throw httpError(400, `${key} is too long.`)
  return v.trim()
}

// ---------------------------------------------------------------------------------------------
// nginx: injection, SEO, analytics, redirects, domains
// ---------------------------------------------------------------------------------------------

const SNIPPET_DIR = '/etc/nginx/autodeploy'
const VARS_CONF = '/etc/nginx/conf.d/autodeploy-vars.conf'
const INCLUDE_MARK = '# autodeploy:project-settings'
const DOMAIN_RE = /^(?!-)[a-zA-Z0-9-]{1,63}(?<!-)(\.(?!-)[a-zA-Z0-9-]{1,63}(?<!-))+$/

/** nginx single-quoted string: escape \ and ', and keep $ literal via a variable set to "$". */
function nginxString(text) {
  return `'${String(text).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\$/g, '${autodeploy_dollar}')}'`
}

const escapeHtmlAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export async function findSiteConfig(host, domain) {
  if (!domain || !DOMAIN_RE.test(domain)) return null
  const direct = `/etc/nginx/sites-available/${domain}.conf`
  if (await host.exists(direct)) return direct
  const r = await host.run('grep', ['-rlE', `server_name[^;]*[[:space:]]${domain.replace(/\./g, '\\.')}([[:space:]]|;)`, '/etc/nginx/sites-available'])
  const first = (r.stdout || '').split('\n').map((l) => l.trim()).find(Boolean)
  return first || null
}

export function serverNames(conf) {
  const names = new Set()
  for (const m of conf.matchAll(/server_name\s+([^;]+);/g)) for (const n of m[1].split(/\s+/)) if (n && n !== '_') names.add(n)
  return [...names]
}

// ---------------------------------------------------------------------------------------------
// Progressive Web App: manifest, service worker, offline page, icons, Android asset links
// Files live in /var/www/autodeploy-pwa/<domain>/ and are served by nginx in front of the site,
// so any website or panel becomes installable without changing its code.
// ---------------------------------------------------------------------------------------------

const PWA_ROOT = '/var/www/autodeploy-pwa'
const PWA_DISPLAYS = ['standalone', 'fullscreen', 'minimal-ui', 'browser']
const PWA_ORIENTATIONS = ['any', 'portrait', 'landscape']
const ICON_FILES = { icon192: 'icon-192.png', icon512: 'icon-512.png', maskable512: 'maskable-512.png', apple180: 'apple-touch-icon.png' }
const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function pwaDir(domain) {
  return `${PWA_ROOT}/${domain}`
}

function pwaManifest(pwa) {
  return JSON.stringify({
    id: '/',
    name: pwa.name,
    short_name: pwa.shortName,
    description: pwa.description || undefined,
    start_url: pwa.startUrl || '/',
    scope: '/',
    display: pwa.display,
    orientation: pwa.orientation,
    theme_color: pwa.themeColor,
    background_color: pwa.backgroundColor,
    icons: [
      { src: '/autodeploy-pwa/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/autodeploy-pwa/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/autodeploy-pwa/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  }, null, 2)
}

function pwaServiceWorker(pwa) {
  return `// Generated by AutoDeploy. Version ${pwa.version}
const CACHE = 'autodeploy-pwa-${pwa.version}'
const OFFLINE = '/autodeploy-pwa/offline.html'
const CACHE_ASSETS = ${pwa.strategy === 'assets' ? 'true' : 'false'}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll([OFFLINE, '/autodeploy-pwa/icons/icon-192.png'])).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('autodeploy-pwa-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()))
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  // Never touch other sites, APIs or live connections: the app always talks to the server
  if (url.origin !== self.location.origin || /^\\/(api|socket\\.io|ws)(\\/|$)/.test(url.pathname)) return

  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE)))
    return
  }
  if (CACHE_ASSETS && ['style', 'script', 'image', 'font'].includes(req.destination)) {
    event.respondWith(caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req)
      const network = fetch(req).then((res) => {
        if (res.ok && res.type === 'basic') cache.put(req, res.clone())
        return res
      }).catch(() => cached)
      return cached || network
    }))
  }
})
`
}

// Served after the PWA is turned off: removes itself and its caches from every visitor's browser
const PWA_KILL_SWITCH = `// Generated by AutoDeploy: this site is no longer an installable app.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('autodeploy-pwa-')).map((k) => caches.delete(k))))
    .then(() => self.registration.unregister())
    .then(() => self.clients.matchAll({ type: 'window' }))
    .then((clients) => clients.forEach((c) => c.navigate(c.url))))
})
`

function pwaOfflinePage(pwa) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="${pwa.themeColor}">
<title>${escapeHtml(pwa.name)} — offline</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background: ${pwa.backgroundColor}; color: #111; }
  .card { max-width: 360px; margin: 24px; padding: 32px 24px; border-radius: 20px; background: #fff; box-shadow: 0 10px 40px rgba(0,0,0,.12); text-align: center; }
  img { width: 72px; height: 72px; border-radius: 16px; }
  h1 { font-size: 20px; margin: 16px 0 8px; }
  p { color: #555; line-height: 1.5; margin: 0 0 20px; }
  button { border: 0; border-radius: 999px; padding: 12px 22px; font-weight: 600; font-size: 15px; color: #fff; background: ${pwa.themeColor}; cursor: pointer; }
</style>
</head>
<body>
  <div class="card">
    <img src="/autodeploy-pwa/icons/icon-192.png" alt="">
    <h1>${escapeHtml(pwa.name)}</h1>
    <p>${escapeHtml(pwa.offlineMessage || 'You are offline. Check your connection and try again.')}</p>
    <button onclick="location.reload()">Try again</button>
  </div>
</body>
</html>
`
}

function pwaAssetLinks(android) {
  return JSON.stringify([{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: android.packageName, sha256_cert_fingerprints: android.fingerprints }
  }], null, 2)
}

/** Text files of an enabled PWA, by file name. */
export function pwaFiles(pwa) {
  const files = {
    'manifest.webmanifest': pwaManifest(pwa),
    'autodeploy-sw.js': pwaServiceWorker(pwa),
    'offline.html': pwaOfflinePage(pwa)
  }
  if (pwa.android?.packageName && pwa.android?.fingerprints?.length) files['assetlinks.json'] = pwaAssetLinks(pwa.android)
  return files
}

function pwaHeadTags(pwa) {
  return [
    '<link rel="manifest" href="/manifest.webmanifest">',
    `<meta name="theme-color" content="${pwa.themeColor}">`,
    '<meta name="mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-capable" content="yes">',
    `<meta name="apple-mobile-web-app-title" content="${escapeHtml(pwa.shortName)}">`,
    `<meta name="apple-mobile-web-app-status-bar-style" content="${pwa.display === 'fullscreen' ? 'black-translucent' : 'default'}">`,
    '<link rel="apple-touch-icon" href="/autodeploy-pwa/icons/apple-touch-icon.png">',
    "<script>if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/autodeploy-sw.js',{scope:'/'}).catch(function(){})})}</script>"
  ].join('\n')
}

// Optional floating "Install app" button for browsers that support the install prompt (Android/desktop Chrome, Edge)
function pwaInstallButton(pwa) {
  return `<script>(function(){var p;window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();p=e;if(document.getElementById('autodeploy-install'))return;var b=document.createElement('button');b.id='autodeploy-install';b.type='button';b.textContent=${JSON.stringify(pwa.installLabel || 'Install app')};b.style.cssText='position:fixed;right:16px;bottom:16px;z-index:2147483647;padding:10px 18px;border:0;border-radius:999px;background:${pwa.themeColor};color:#fff;font:600 14px system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.3);cursor:pointer';b.onclick=function(){p.prompt();p.userChoice.then(function(){b.remove()})};document.body.appendChild(b)});window.addEventListener('appinstalled',function(){var b=document.getElementById('autodeploy-install');if(b)b.remove()})})();</script>`
}

/** Head/body HTML generated from the SEO, analytics and code-injection settings. */
function buildInjection(settings) {
  const head = []
  const seo = settings.seo || {}
  if (seo.description) {
    head.push(`<meta name="description" content="${escapeHtmlAttr(seo.description)}">`)
    head.push(`<meta property="og:description" content="${escapeHtmlAttr(seo.description)}">`)
  }
  if (seo.title) head.push(`<meta property="og:title" content="${escapeHtmlAttr(seo.title)}">`)
  if (seo.ogImage) {
    head.push(`<meta property="og:image" content="${escapeHtmlAttr(seo.ogImage)}">`)
    head.push('<meta name="twitter:card" content="summary_large_image">')
  }
  if (seo.noindex) head.push('<meta name="robots" content="noindex, nofollow">')
  const a = settings.analytics || {}
  if (a.gaId) {
    head.push(`<script async src="https://www.googletagmanager.com/gtag/js?id=${a.gaId}"></script>`)
    head.push(`<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${a.gaId}');</script>`)
  }
  if (a.posthogKey) {
    const host = a.posthogHost || 'https://us.i.posthog.com'
    head.push(`<script>!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.async=!0,p.src=s.api_host+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},o="capture identify alias people.set people.set_once set_config register register_once unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset isFeatureEnabled onFeatureFlags".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);posthog.init('${a.posthogKey}',{api_host:'${host}'});</script>`)
  }
  if (settings.pwa?.enabled) head.push(pwaHeadTags(settings.pwa))
  const code = settings.code || {}
  if (code.head) head.push(code.head)
  const body = [code.body, settings.pwa?.enabled && settings.pwa.installButton ? pwaInstallButton(settings.pwa) : ''].filter(Boolean).join('\n')
  return { head: head.join('\n'), body }
}

export function buildSnippet(settings) {
  const lines = ['# Managed by AutoDeploy project settings. Changes made here are overwritten.']
  for (const r of settings.redirects || []) {
    const from = r.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\/$/, '')
    lines.push(`rewrite ^${from || ''}/?$ ${r.to} ${r.type === 302 ? 'redirect' : 'permanent'};`)
  }
  const pwa = settings.pwa
  if (pwa?.dir && (pwa.enabled || pwa.killSwitch)) {
    lines.push(`location = /autodeploy-sw.js {\n    alias ${pwa.dir}/autodeploy-sw.js;\n    add_header Service-Worker-Allowed "/";\n    add_header Cache-Control "no-cache";\n}`)
  }
  if (pwa?.dir && pwa.enabled) {
    lines.push(`location = /manifest.webmanifest {\n    alias ${pwa.dir}/manifest.webmanifest;\n    types { }\n    default_type application/manifest+json;\n    add_header Cache-Control "no-cache";\n}`)
    lines.push(`location ^~ /autodeploy-pwa/ {\n    alias ${pwa.dir}/;\n    expires 7d;\n}`)
    if (pwa.android?.packageName && pwa.android?.fingerprints?.length) {
      lines.push(`location = /.well-known/assetlinks.json {\n    alias ${pwa.dir}/assetlinks.json;\n    types { }\n    default_type application/json;\n}`)
    }
  }
  const { head, body } = buildInjection(settings)
  if (head || body) {
    lines.push('sub_filter_once on;')
    if (head) lines.push(`sub_filter '</head>' ${nginxString(`${head}\n</head>`)};`)
    if (body) lines.push(`sub_filter '</body>' ${nginxString(`${body}\n</body>`)};`)
  }
  return lines.join('\n') + '\n'
}

/**
 * Writes the site's snippet, makes sure every server block of the site includes it,
 * then `nginx -t` + reload. Everything is restored if nginx rejects the result.
 */
export async function applySiteSnippet(host, domain, settings, { names = null } = {}) {
  const conf = await findSiteConfig(host, domain)
  if (!conf) throw httpError(400, `No nginx site found for ${domain}. Deploy the project or set up its domain first.`)
  const snippet = `${SNIPPET_DIR}/${domain}.conf`
  const original = await host.readFile(conf)
  const previousSnippet = (await host.exists(snippet)) ? await host.readFile(snippet) : null
  const hadVars = await host.exists(VARS_CONF)

  let updated = original
  if (names) {
    updated = updated.replace(/server_name\s+[^;]+;/g, (line) => {
      const current = line.replace(/^server_name\s+|;$/g, '').split(/\s+/)
      return current.includes(domain) ? `server_name ${names.join(' ')};` : line
    })
  }
  if (!updated.includes(INCLUDE_MARK)) {
    updated = updated.replace(/(server_name\s+[^;]+;)/g, `$1\n    include ${snippet}; ${INCLUDE_MARK}`)
  }

  await host.mkdir(SNIPPET_DIR)
  if (!hadVars) await host.writeFile(VARS_CONF, '# AutoDeploy: lets project settings put a literal $ in injected code\ngeo $autodeploy_dollar { default "$"; }\n')
  await host.writeFile(snippet, buildSnippet(settings))
  if (updated !== original) await host.writeFile(conf, updated)

  const test = await host.run('nginx', ['-t'])
  if (test.code !== 0) {
    await host.writeFile(conf, original)
    if (previousSnippet !== null) await host.writeFile(snippet, previousSnippet)
    else await host.rm(snippet)
    if (!hadVars) await host.rm(VARS_CONF)
    throw httpError(400, `nginx rejected the change, nothing was applied:\n${(test.stderr || test.stdout || '').trim()}`)
  }
  const reload = await host.run('systemctl', ['reload', 'nginx'])
  if (reload.code !== 0) throw httpError(500, `nginx reload failed: ${reload.stderr || reload.stdout}`)
  return conf
}

// ---------------------------------------------------------------------------------------------
// Validation per section
// ---------------------------------------------------------------------------------------------

function text(v, max, label) {
  const s = String(v ?? '').trim()
  if (s.length > max) throw httpError(400, `${label} must be at most ${max} characters.`)
  return s
}

function cleanRedirects(list) {
  if (!Array.isArray(list)) return []
  if (list.length > 100) throw httpError(400, 'At most 100 redirects.')
  return list.filter((r) => r && (r.from || r.to)).map((r, i) => {
    const from = String(r.from || '').trim()
    const to = String(r.to || '').trim()
    if (!/^\/[A-Za-z0-9._~\/-]*$/.test(from)) throw httpError(400, `Redirect ${i + 1}: "from" must be a path like /old-page.`)
    if (!/^(\/[A-Za-z0-9._~\/?=&%-]*|https?:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~\/?=&%-]*)?)$/.test(to)) throw httpError(400, `Redirect ${i + 1}: "to" must be a path or an http(s) URL.`)
    return { from, to, type: Number(r.type) === 302 ? 302 : 301 }
  })
}

// ---------------------------------------------------------------------------------------------
// Load / save
// ---------------------------------------------------------------------------------------------

export const SERVER_SECTIONS = ['seo', 'analytics', 'code-injection', 'redirects', 'domains', 'pwa']

export async function loadSettings(host, server, dir, domain) {
  const stored = getStoredSettings(server, dir)
  const env = await readEnv(host, dir)
  const known = {}
  for (const k of KNOWN_ENV_KEYS) known[k] = env.values[k] ?? ''
  const custom = (stored.customVars || []).map((k) => ({ key: k, value: env.values[k] ?? '' }))
  let site = null
  if (domain) {
    const conf = await findSiteConfig(host, domain).catch(() => null)
    if (conf) site = { config: conf, domains: serverNames(await host.readFile(conf)) }
  }
  return { stored, env: known, customVars: custom, envFile: env.file, site }
}

/**
 * Applies one section. `level` is the caller's project access ('super'|'owner'|'manager').
 */
export async function saveSection(host, server, dir, { section, values = {}, domain, userId, level }) {
  const stored = getStoredSettings(server, dir)
  const result = { section, applied: [] }

  if (SERVER_SECTIONS.includes(section) && !['super', 'owner'].includes(level)) {
    throw httpError(403, 'Only organization owners and admins can change nginx-level settings (domains, SEO, analytics, code injection, redirects).')
  }

  if (section === 'general') {
    saveStoredSettings(server, dir, { displayName: text(values.displayName, 80, 'Display name') }, userId)
    result.applied.push('Display name saved')
    return result
  }

  if (section === 'brand') {
    await writeEnvKeys(host, dir, {
      APP_NAME: cleanEnvValue('APP_NAME', values.APP_NAME),
      BRAND_PRIMARY_COLOR: (() => {
        const c = cleanEnvValue('BRAND_PRIMARY_COLOR', values.BRAND_PRIMARY_COLOR)
        if (c && !/^#[0-9a-fA-F]{3,8}$/.test(c)) throw httpError(400, 'Primary color must be a hex color like #06B6D4.')
        return c
      })()
    })
    saveStoredSettings(server, dir, { brief: text(values.brief, 4000, 'AI brief') }, userId)
    result.applied.push('APP_NAME and BRAND_PRIMARY_COLOR written to .env', 'AI brief saved for the project agent')
    return result
  }

  if (ENV_SECTIONS[section] && section !== 'analytics') {
    const updates = {}
    for (const key of ENV_SECTIONS[section]) if (values[key] !== undefined) updates[key] = cleanEnvValue(key, values[key])
    if (updates.BUSINESS_EMAIL && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updates.BUSINESS_EMAIL)) throw httpError(400, 'Business email is not valid.')
    if (updates.SMTP_PORT && !/^\d{2,5}$/.test(updates.SMTP_PORT)) throw httpError(400, 'SMTP port must be a number.')
    const file = await writeEnvKeys(host, dir, updates)
    result.applied.push(`${Object.keys(updates).length} value(s) written to ${path.posix.basename(file)}`)
    return result
  }

  if (section === 'global-vars') {
    const vars = Array.isArray(values.vars) ? values.vars : []
    if (vars.length > 100) throw httpError(400, 'At most 100 variables.')
    const updates = {}
    const keys = []
    for (const { key, value } of vars) {
      const k = String(key || '').trim().toUpperCase()
      if (!k) continue
      if (!ENV_KEY_RE.test(k)) throw httpError(400, `"${key}" is not a valid variable name (letters, numbers and _ only).`)
      if (KNOWN_ENV_KEYS.has(k)) throw httpError(400, `${k} is managed in its own settings section.`)
      updates[k] = cleanEnvValue(k, value)
      keys.push(k)
    }
    // Variables removed from the list are removed from .env too
    for (const old of stored.customVars || []) if (!keys.includes(old)) updates[old] = null
    await writeEnvKeys(host, dir, updates)
    saveStoredSettings(server, dir, { customVars: keys }, userId)
    result.applied.push(`${keys.length} custom variable(s) saved to .env`)
    return result
  }

  // nginx-level sections
  if (!domain || !DOMAIN_RE.test(domain)) throw httpError(400, 'This project has no domain yet, so nginx settings cannot be applied.')
  // Fail before writing anything when nginx doesn't serve this site
  if (!await findSiteConfig(host, domain)) throw httpError(400, `No nginx site found for ${domain}. Deploy the project or set up its domain first.`)
  const next = { seo: stored.seo, analytics: stored.analytics, code: stored.code, redirects: stored.redirects, pwa: stored.pwa }
  let names = null

  if (section === 'seo') {
    const ogImage = text(values.ogImage, 500, 'Social image URL')
    if (ogImage && !/^https?:\/\/\S+$/.test(ogImage)) throw httpError(400, 'Social image must be an http(s) URL.')
    next.seo = { title: text(values.title, 120, 'Title'), description: text(values.description, 300, 'Description'), ogImage, noindex: !!values.noindex }
  } else if (section === 'analytics') {
    const gaId = text(values.GA_MEASUREMENT_ID, 30, 'GA4 ID')
    if (gaId && !/^G-[A-Z0-9]{4,20}$/.test(gaId)) throw httpError(400, 'GA4 measurement ID looks like G-XXXXXXXXXX.')
    const posthogKey = text(values.POSTHOG_KEY, 100, 'PostHog key')
    if (posthogKey && !/^phc_[A-Za-z0-9]+$/.test(posthogKey)) throw httpError(400, 'PostHog project key starts with phc_.')
    const posthogHost = text(values.POSTHOG_HOST, 200, 'PostHog host')
    if (posthogHost && !/^https:\/\/[A-Za-z0-9.-]+$/.test(posthogHost)) throw httpError(400, 'PostHog host must be like https://us.i.posthog.com')
    next.analytics = { gaId, posthogKey, posthogHost, inject: values.inject !== false }
    await writeEnvKeys(host, dir, { GA_MEASUREMENT_ID: gaId, POSTHOG_KEY: posthogKey, POSTHOG_HOST: posthogHost })
    result.applied.push('Analytics IDs written to .env')
    if (values.inject === false) next.analytics = { ...next.analytics, gaId: '', posthogKey: '' }
  } else if (section === 'code-injection') {
    const head = String(values.head || '')
    const body = String(values.body || '')
    if (head.length > MAX_INJECT || body.length > MAX_INJECT) throw httpError(400, `Injected code is limited to ${MAX_INJECT} characters per slot.`)
    if (/[\0]/.test(head + body)) throw httpError(400, 'Injected code contains invalid characters.')
    next.code = { head: head.trim(), body: body.trim() }
  } else if (section === 'redirects') {
    next.redirects = cleanRedirects(values.redirects)
  } else if (section === 'pwa') {
    next.pwa = await savePwa(host, domain, stored.pwa, values)
    result.applied.push(next.pwa.enabled ? 'App manifest, service worker, offline page and icons published' : 'Installable app turned off (visitors\' browsers remove it on their next visit)')
  } else if (section === 'domains') {
    const list = (Array.isArray(values.domains) ? values.domains : []).map((d) => String(d).trim().toLowerCase()).filter(Boolean)
    if (!list.includes(domain)) list.unshift(domain)
    for (const d of list) if (!DOMAIN_RE.test(d)) throw httpError(400, `${d} is not a valid domain.`)
    if (list.length > 20) throw httpError(400, 'At most 20 domains per site.')
    names = [...new Set(list)]
  } else {
    throw httpError(400, 'Unknown settings section.')
  }

  const conf = await applySiteSnippet(host, domain, next, { names })
  saveStoredSettings(server, dir, next, userId)
  result.applied.push(`nginx updated (${path.posix.basename(conf)}) and reloaded`)
  if (names) {
    result.domains = names
    result.applied.push('Issue SSL again from SSL & Domains to cover new domains')
  }
  return result
}

// ---------------------------------------------------------------------------------------------
// PWA save + checks
// ---------------------------------------------------------------------------------------------

const HEX = /^#[0-9a-fA-F]{6}$/
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function decodePng(dataUrl, label) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''))
  if (!m) throw httpError(400, `${label} must be a PNG image.`)
  const buf = Buffer.from(m[1], 'base64')
  if (buf.length > 1024 * 1024) throw httpError(400, `${label} is larger than 1 MB.`)
  if (!buf.subarray(0, 8).equals(PNG_MAGIC)) throw httpError(400, `${label} is not a valid PNG.`)
  return buf
}

export async function savePwa(host, domain, current = {}, values = {}) {
  const dir = pwaDir(domain)
  const enabled = !!values.enabled

  if (!enabled) {
    // Keep serving a self-removing service worker so installed copies clean themselves up
    if (!current?.enabled) return { ...(current || {}), enabled: false }
    await host.mkdir(dir)
    await host.writeFile(`${dir}/autodeploy-sw.js`, PWA_KILL_SWITCH)
    return { ...current, enabled: false, killSwitch: true, dir }
  }

  const name = text(values.name, 45, 'App name')
  const shortName = text(values.shortName || name, 12, 'Short name (home screen label)')
  if (!name) throw httpError(400, 'App name is required.')
  const themeColor = HEX.test(values.themeColor || '') ? values.themeColor : (current.themeColor || '#0891b2')
  const backgroundColor = HEX.test(values.backgroundColor || '') ? values.backgroundColor : (current.backgroundColor || '#ffffff')
  const startUrl = String(values.startUrl || '/').trim()
  if (!/^\/[A-Za-z0-9._~\/?=&%-]*$/.test(startUrl)) throw httpError(400, 'Start page must be a path on this site, like / or /dashboard.')

  const android = { packageName: '', fingerprints: [] }
  if (values.androidPackage) {
    android.packageName = String(values.androidPackage).trim()
    if (!/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(android.packageName)) throw httpError(400, 'Android package name looks like com.example.app.')
    android.fingerprints = String(values.androidFingerprints || '').split(/[\s,]+/).map((f) => f.trim().toUpperCase()).filter(Boolean)
    for (const f of android.fingerprints) if (!/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f)) throw httpError(400, `"${f}" is not a SHA-256 certificate fingerprint (32 hex pairs separated by colons).`)
    if (android.fingerprints.length > 5) throw httpError(400, 'At most 5 signing fingerprints.')
  }

  const icons = values.icons || {}
  const hasNewIcons = Object.keys(ICON_FILES).some((k) => icons[k])
  if (!hasNewIcons && !current.hasIcons) throw httpError(400, 'Upload an app icon (a square PNG or JPG, at least 512×512).')
  const iconBuffers = hasNewIcons ? Object.fromEntries(Object.keys(ICON_FILES).map((k) => [k, decodePng(icons[k], `Icon ${ICON_FILES[k]}`)])) : null

  const pwa = {
    enabled: true,
    killSwitch: false,
    dir,
    name,
    shortName,
    description: text(values.description, 200, 'Description'),
    themeColor,
    backgroundColor,
    display: PWA_DISPLAYS.includes(values.display) ? values.display : 'standalone',
    orientation: PWA_ORIENTATIONS.includes(values.orientation) ? values.orientation : 'any',
    startUrl,
    strategy: values.strategy === 'assets' ? 'assets' : 'offline',
    offlineMessage: text(values.offlineMessage, 200, 'Offline message'),
    installButton: values.installButton !== false,
    installLabel: text(values.installLabel || 'Install app', 30, 'Install button label'),
    android,
    hasIcons: true,
    version: Date.now().toString(36)
  }

  await host.mkdir(`${dir}/icons`)
  if (iconBuffers) for (const [k, file] of Object.entries(ICON_FILES)) await host.writeFile(`${dir}/icons/${file}`, iconBuffers[k])
  for (const [file, content] of Object.entries(pwaFiles(pwa))) await host.writeFile(`${dir}/${file}`, content)
  return pwa
}

/**
 * Checks the live site from its own server (DNS is not needed: requests are pinned to 127.0.0.1).
 */
export async function checkPwa(host, domain) {
  if (!DOMAIN_RE.test(domain || '')) throw httpError(400, 'This project has no domain.')
  const conf = await findSiteConfig(host, domain)
  const https = !!conf && /ssl_certificate/.test(await host.readFile(conf))
  const scheme = https ? 'https' : 'http'
  const port = https ? 443 : 80
  const get = async (p, extra = []) => {
    const r = await host.run('curl', ['-sk', '-m', '10', '--resolve', `${domain}:${port}:127.0.0.1`, '-o', '/dev/null', '-w', '%{http_code} %{content_type}', ...extra, `${scheme}://${domain}${p}`], { timeout: 20000 })
    const [code, type = ''] = (r.stdout || '').trim().split(' ')
    return { ok: code === '200', code, type }
  }
  const page = await host.run('curl', ['-sk', '-m', '10', '--resolve', `${domain}:${port}:127.0.0.1`, `${scheme}://${domain}/`], { timeout: 20000 })
  const html = page.stdout || ''
  const manifest = await get('/manifest.webmanifest')
  const sw = await get('/autodeploy-sw.js')
  const icon = await get('/autodeploy-pwa/icons/icon-512.png')
  const assetlinks = await get('/.well-known/assetlinks.json')
  return {
    url: `${scheme}://${domain}/`,
    checks: [
      { id: 'https', ok: https, label: 'Served over HTTPS', fix: 'Issue an SSL certificate from SSL & Domains. Browsers only install apps from HTTPS sites.' },
      { id: 'manifest', ok: manifest.ok && /json/.test(manifest.type), label: 'Web app manifest is reachable', fix: `GET /manifest.webmanifest returned ${manifest.code || 'no answer'}.` },
      { id: 'sw', ok: sw.ok, label: 'Service worker is reachable', fix: `GET /autodeploy-sw.js returned ${sw.code || 'no answer'}.` },
      { id: 'icons', ok: icon.ok, label: 'App icons are reachable', fix: `GET /autodeploy-pwa/icons/icon-512.png returned ${icon.code || 'no answer'}.` },
      { id: 'linked', ok: /rel="manifest"/.test(html) && /autodeploy-sw\.js/.test(html), label: 'Pages link the manifest and register the service worker', fix: 'The home page did not contain the injected tags. If your app compresses its own HTML, turn that off so nginx can insert them.' },
      { id: 'android', ok: assetlinks.ok, optional: true, label: 'Android app links (assetlinks.json) for the Play Store app', fix: 'Add your Android package name and signing fingerprint to verify a Play Store app.' }
    ]
  }
}
