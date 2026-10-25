import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { fileURLToPath } from 'url'
import { Readable } from 'stream'
import { q } from './host.service.js'
import { bareToken } from './github.service.js'
import { getStoredSettings, saveStoredSettings, settingsKey, pwaDir } from './project-settings.service.js'

/**
 * Native Android and iOS apps from a project's website (Settings → Mobile app → Native app).
 *
 * The panel generates a React Native (Expo) project: a full-screen WebView of the site plus a
 * `window.NativeApp` bridge to native features (share sheet, haptics, push notifications,
 * Face ID / fingerprint, camera, location, deep links). It is then built with the platform SDKs:
 *  - GitHub Actions in the user's own repository: Android with Gradle on Linux, iOS with Xcode on
 *    macOS (the only way to build iOS from a Linux server), signed with keys kept in the
 *    repository's Actions secrets
 *  - this server (Android only): JDK 17 + Android SDK, signed with an upload key generated and
 *    kept on the server
 *  - or downloaded as source, to build in Android Studio / Xcode
 * Settings are stored in db.projectSettings[...].mobile; the icon in backend/data/mobile-apps/.
 */

const exec = promisify(execFile)
const httpError = (status, message) => Object.assign(new Error(message), { status })

const TEMPLATE_DIR = fileURLToPath(new URL('../mobile-template', import.meta.url))
const ICON_ROOT = fileURLToPath(new URL('../data/mobile-apps', import.meta.url))
const EXPO_SDK = '~54.0.0'
const WORKFLOW_FILE = 'autodeploy-mobile.yml'
const GITHUB_API = 'https://api.github.com'
const UA = 'AutoDeploy-Console-App'

const HEX = /^#[0-9a-fA-F]{6}$/
const DOMAIN_RE = /^(?!-)[a-zA-Z0-9-]{1,63}(?<!-)(\.(?!-)[a-zA-Z0-9-]{1,63}(?<!-))+$/
// Valid as both an Android package and an iOS bundle ID: dot-separated segments of letters and digits
const BUNDLE_ID_RE = /^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*)+$/
const JAVA_KEYWORDS = new Set('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null'.split(' '))
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export const FEATURES = ['push', 'biometrics', 'haptics', 'camera', 'location', 'deepLinks', 'externalLinks', 'pullToRefresh']
const DEFAULT_FEATURES = { push: false, biometrics: false, haptics: true, camera: true, location: false, deepLinks: true, externalLinks: true, pullToRefresh: true }
// Payment and sign-in pages that must stay inside the app so the flow can return to the site
const DEFAULT_HOSTS = ['checkout.stripe.com', 'api.razorpay.com', 'checkout.razorpay.com', 'www.paypal.com']

// ---------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------

const baseDomain = (domain) => String(domain || '').toLowerCase().replace(/^www\./, '')
const slugOf = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'app'

function text(value, max, label) {
  const v = String(value ?? '').trim()
  if (/[\r\n\0]/.test(v)) throw httpError(400, `${label} cannot contain line breaks.`)
  if (v.length > max) throw httpError(400, `${label} must be ${max} characters or fewer.`)
  return v
}

/** Luminance-based status bar text color for the theme color behind it. */
function statusBarStyle(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? 'dark' : 'light'
}

export function defaultMobileConfig(project = {}, pwa = {}) {
  const domain = baseDomain(project.domain)
  const name = (pwa.name || project.name || domain.split('.')[0] || 'App').slice(0, 30)
  const bundleId = domain ? domain.split('.').reverse().map((s) => s.replace(/[^a-zA-Z0-9]/g, '')).filter(Boolean).map((s) => (/^[a-zA-Z]/.test(s) ? s : `a${s}`)).join('.') : 'com.example.app'
  return {
    appName: name,
    bundleId: bundleId.includes('.') ? bundleId.toLowerCase() : `com.${bundleId.toLowerCase()}`,
    version: '1.0.0',
    buildNumber: 1,
    startUrl: pwa.startUrl || '/',
    themeColor: pwa.themeColor || '#0891b2',
    backgroundColor: pwa.backgroundColor || '#ffffff',
    orientation: pwa.orientation === 'portrait' || pwa.orientation === 'landscape' ? pwa.orientation : 'default',
    offlineMessage: pwa.offlineMessage || '',
    features: { ...DEFAULT_FEATURES },
    extraHosts: [...DEFAULT_HOSTS],
    googleServices: '',
    hasIcon: false
  }
}

const iconDir = (server, dir) => path.join(ICON_ROOT, crypto.createHash('sha1').update(settingsKey(server, dir)).digest('hex').slice(0, 16))

function decodePng(dataUrl, label) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''))
  if (!m) throw httpError(400, `${label} must be a PNG image.`)
  const buf = Buffer.from(m[1], 'base64')
  if (buf.length > 3 * 1024 * 1024) throw httpError(400, `${label} is larger than 3 MB.`)
  if (!buf.subarray(0, 8).equals(PNG_MAGIC)) throw httpError(400, `${label} is not a valid PNG.`)
  return buf
}

/** The saved settings (with defaults), the icon as a data URL for the preview, and the GitHub link. */
export function getMobileApp(server, dir, project) {
  const stored = getStoredSettings(server, dir)
  const config = { ...defaultMobileConfig(project, stored.pwa || {}), ...(stored.mobile || {}) }
  let icon = null
  if (config.hasIcon) {
    try { icon = `data:image/png;base64,${fs.readFileSync(path.join(iconDir(server, dir), 'icon.png')).toString('base64')}` } catch { /* removed */ }
  }
  return { config, icon, pwaIcon: !!stored.pwa?.hasIcons, saved: !!stored.mobile }
}

export function saveMobileApp(server, dir, project, values = {}, userId) {
  const stored = getStoredSettings(server, dir)
  const current = { ...defaultMobileConfig(project, stored.pwa || {}), ...(stored.mobile || {}) }

  const appName = text(values.appName, 30, 'App name')
  if (!appName) throw httpError(400, 'App name is required.')
  const bundleId = String(values.bundleId || '').trim()
  if (!BUNDLE_ID_RE.test(bundleId)) throw httpError(400, 'App ID looks like com.example.app: letters and digits, separated by dots, each part starting with a letter (no hyphens or underscores, so it works on both Android and iOS).')
  const keyword = bundleId.split('.').find((s) => JAVA_KEYWORDS.has(s.toLowerCase()))
  if (keyword) throw httpError(400, `"${keyword}" can't be part of an Android app ID. Pick another word.`)
  const version = String(values.version || '').trim()
  if (!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(version)) throw httpError(400, 'Version looks like 1.0.0.')
  const buildNumber = Number(values.buildNumber)
  if (!Number.isInteger(buildNumber) || buildNumber < 1 || buildNumber > 2100000000) throw httpError(400, 'Build number must be a whole number of 1 or more. Raise it for every store upload.')
  const startUrl = String(values.startUrl || '/').trim()
  if (!/^\/[A-Za-z0-9._~\/?=&%#-]*$/.test(startUrl)) throw httpError(400, 'Start page must be a path on this site, like / or /dashboard.')

  const features = {}
  for (const f of FEATURES) features[f] = values.features?.[f] === undefined ? !!current.features?.[f] : !!values.features[f]

  const extraHosts = [...new Set((Array.isArray(values.extraHosts) ? values.extraHosts : String(values.extraHosts || '').split(/[\s,]+/))
    .map((h) => String(h).trim().toLowerCase()).filter(Boolean))]
  for (const h of extraHosts) if (!DOMAIN_RE.test(h)) throw httpError(400, `${h} is not a valid host name.`)
  if (extraHosts.length > 30) throw httpError(400, 'At most 30 extra hosts.')

  let googleServices = String(values.googleServices || '').trim()
  if (googleServices) {
    if (googleServices.length > 50000) throw httpError(400, 'google-services.json is too large.')
    let parsed
    try { parsed = JSON.parse(googleServices) } catch { throw httpError(400, 'google-services.json is not valid JSON.') }
    const packages = (parsed.client || []).map((c) => c.client_info?.android_client_info?.package_name).filter(Boolean)
    if (!parsed.project_info || !packages.length) throw httpError(400, 'That is not a google-services.json file from Firebase (Project settings → Your apps → Android).')
    if (!packages.includes(bundleId)) throw httpError(400, `google-services.json is for ${packages.join(', ')}, not ${bundleId}. Add an Android app with package name ${bundleId} in Firebase and download its file.`)
    googleServices = JSON.stringify(parsed, null, 2)
  }

  let hasIcon = !!current.hasIcon
  if (values.icon) {
    const icon = decodePng(values.icon, 'App icon')
    const adaptive = decodePng(values.adaptiveIcon || values.icon, 'Android adaptive icon')
    const dirPath = iconDir(server, dir)
    fs.mkdirSync(dirPath, { recursive: true })
    fs.writeFileSync(path.join(dirPath, 'icon.png'), icon)
    fs.writeFileSync(path.join(dirPath, 'adaptive-icon.png'), adaptive)
    hasIcon = true
  }

  const mobile = {
    ...(stored.mobile || {}),
    appName,
    bundleId,
    version,
    buildNumber,
    startUrl,
    themeColor: HEX.test(values.themeColor || '') ? values.themeColor : current.themeColor,
    backgroundColor: HEX.test(values.backgroundColor || '') ? values.backgroundColor : current.backgroundColor,
    orientation: ['default', 'portrait', 'landscape'].includes(values.orientation) ? values.orientation : 'default',
    offlineMessage: text(values.offlineMessage, 200, 'Offline message'),
    features,
    extraHosts,
    googleServices,
    hasIcon
  }
  saveStoredSettings(server, dir, { mobile }, userId)
  return mobile
}

const saveMobilePatch = (server, dir, patch, userId) => {
  const mobile = { ...(getStoredSettings(server, dir).mobile || {}), ...patch }
  saveStoredSettings(server, dir, { mobile }, userId)
  return mobile
}

// ---------------------------------------------------------------------------------------------
// Project generation
// ---------------------------------------------------------------------------------------------

/** Removes `// @feature x` … `// @end` blocks for features that are off, and the markers of those that are on. */
function applyFeatureBlocks(source, features) {
  const out = []
  let skipping = false
  for (const line of source.split('\n')) {
    const start = line.match(/^\s*\/\/ @feature (\w+)\s*$/)
    if (start) { skipping = !features[start[1]]; continue }
    if (/^\s*\/\/ @end\s*$/.test(line)) { skipping = false; continue }
    if (!skipping) out.push(line)
  }
  return out.join('\n')
}

const template = (file) => fs.readFileSync(path.join(TEMPLATE_DIR, file), 'utf8')

function readme(cfg, domain) {
  return `# ${cfg.appName} — Android & iOS app

Generated by AutoDeploy from https://${domain}. A React Native (Expo) app that shows the website
full-screen and gives it native features through \`window.NativeApp\`.

## Build

| | Command | Needs |
|---|---|---|
| Android APK + Play bundle | \`bash scripts/build-android.sh\` | Node 20+, JDK 17, Android SDK (\`ANDROID_HOME\`) |
| iOS | \`bash scripts/build-ios.sh\` | macOS with Xcode, CocoaPods |
| Both, in the cloud | Actions → **Build mobile app** → Run workflow | This repository on GitHub |

For development: \`bash scripts/install-deps.sh\`, then \`npx expo run:android\` or \`npx expo run:ios\`.

## Signing (GitHub Actions secrets)

- Android (Google Play): \`ANDROID_KEYSTORE_BASE64\` (\`base64 -w0 upload.jks\`), \`ANDROID_KEYSTORE_PASSWORD\`,
  \`ANDROID_KEY_ALIAS\` (default \`upload\`), \`ANDROID_KEY_PASSWORD\` (default: the keystore password).
  Without them the APK is signed with a debug key: fine for testing, not for Play.
- iOS: \`IOS_P12_BASE64\` (distribution certificate exported from Keychain as .p12), \`IOS_P12_PASSWORD\`,
  \`IOS_PROFILE_BASE64\` (App Store or Ad Hoc provisioning profile for \`${cfg.bundleId}\`).
  Optional upload to TestFlight: \`APP_STORE_CONNECT_KEY_ID\`, \`APP_STORE_CONNECT_ISSUER_ID\`,
  \`APP_STORE_CONNECT_KEY_BASE64\` (the .p8 API key). Optional variable \`IOS_EXPORT_METHOD\`
  (\`app-store-connect\` by default, \`release-testing\` for Ad Hoc).
  Without them iOS builds an unsigned simulator app, to check that it builds.

## Using native features from the website

\`\`\`js
if (window.NativeApp) {                       // running inside the app
  NativeApp.platform                          // 'android' | 'ios'
  NativeApp.has('push')                       // which features this build has
  await NativeApp.share({ title, text, url })
  await NativeApp.haptic('success')           // light | medium | heavy | selection | success | warning | error
  const { token, type } = await NativeApp.getPushToken()   // FCM (android) / APNs (ios) device token
  const { success } = await NativeApp.authenticate('Confirm payment')  // Face ID / fingerprint
  await NativeApp.openExternal('https://…')   // system browser
}
document.addEventListener('nativeappready', () => { /* NativeApp is ready */ })
\`\`\`

The app's user agent ends with \`AutoDeployApp/<version>\`, so the server can tell app visits apart.
A push notification whose data has \`{ "url": "https://${domain}/…" }\` opens that page when tapped.
`
}

/**
 * Every file of the generated project, as { path: string | Buffer }.
 * `icons` = { icon, adaptive } PNG buffers.
 */
export function buildProjectFiles(cfg, domain, icons) {
  const f = cfg.features || {}
  const base = baseDomain(domain)
  const slug = slugOf(cfg.appName)
  const origin = `https://${domain}`
  const nativePackages = [
    'react', 'react-native', 'react-native-webview', 'react-native-safe-area-context',
    'expo-status-bar', 'expo-splash-screen', 'expo-web-browser',
    ...(f.haptics ? ['expo-haptics'] : []),
    ...(f.push ? ['expo-notifications'] : []),
    ...(f.biometrics ? ['expo-local-authentication'] : [])
  ]
  const bridgeFeatures = ['share', 'openExternal', ...(f.haptics ? ['haptics'] : []), ...(f.push ? ['push'] : []), ...(f.biometrics ? ['biometrics'] : [])]
  const runtime = {
    name: cfg.appName,
    slug,
    version: cfg.version,
    buildNumber: cfg.buildNumber,
    domain: base,
    origin,
    startUrl: origin + cfg.startUrl,
    hosts: [...new Set([domain, ...(cfg.extraHosts || [])])],
    themeColor: cfg.themeColor,
    backgroundColor: cfg.backgroundColor,
    statusBarStyle: statusBarStyle(cfg.themeColor),
    offlineMessage: cfg.offlineMessage || 'You are offline. Check your connection and try again.',
    externalLinks: !!f.externalLinks,
    pullToRefresh: !!f.pullToRefresh,
    camera: !!f.camera,
    location: !!f.location,
    bridgeFeatures,
    nativePackages
  }

  const androidPermissions = [
    ...(f.camera ? ['android.permission.CAMERA', 'android.permission.RECORD_AUDIO', 'android.permission.MODIFY_AUDIO_SETTINGS'] : []),
    ...(f.location ? ['android.permission.ACCESS_COARSE_LOCATION', 'android.permission.ACCESS_FINE_LOCATION'] : [])
  ]
  const infoPlist = {
    // File inputs on the site can take a photo or pick one
    NSCameraUsageDescription: `${cfg.appName} uses the camera when you take a photo or video to upload.`,
    NSPhotoLibraryUsageDescription: `${cfg.appName} lets you choose photos to upload.`,
    ITSAppUsesNonExemptEncryption: false,
    ...(f.camera ? { NSMicrophoneUsageDescription: `${cfg.appName} uses the microphone for audio and video features.` } : {}),
    ...(f.location ? { NSLocationWhenInUseUsageDescription: `${cfg.appName} uses your location for location-based features.` } : {})
  }
  const plugins = [
    ['expo-splash-screen', { image: './assets/splash-icon.png', imageWidth: 160, resizeMode: 'contain', backgroundColor: cfg.backgroundColor }],
    ...(f.push ? [['expo-notifications', { color: cfg.themeColor }]] : []),
    ...(f.biometrics ? [['expo-local-authentication', { faceIDPermission: `Allow ${cfg.appName} to use Face ID to confirm it's you.` }]] : []),
    './plugins/withReleaseSigning'
  ]
  const appJson = {
    expo: {
      name: cfg.appName,
      slug,
      scheme: slug,
      version: cfg.version,
      orientation: cfg.orientation || 'default',
      icon: './assets/icon.png',
      backgroundColor: cfg.backgroundColor,
      ios: {
        bundleIdentifier: cfg.bundleId,
        buildNumber: String(cfg.buildNumber),
        supportsTablet: true,
        infoPlist
      },
      android: {
        package: cfg.bundleId,
        versionCode: cfg.buildNumber,
        adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: cfg.backgroundColor },
        permissions: androidPermissions,
        ...(f.push && cfg.googleServices ? { googleServicesFile: './google-services.json' } : {}),
        ...(f.deepLinks ? {
          intentFilters: [{
            action: 'VIEW',
            autoVerify: true,
            data: [...new Set([domain, base, ...(base.split('.').length === 2 ? [`www.${base}`] : [])])].map((host) => ({ scheme: 'https', host })),
            category: ['BROWSABLE', 'DEFAULT']
          }]
        } : {})
      },
      plugins
    }
  }
  const pkg = {
    name: slug,
    version: cfg.version,
    private: true,
    main: 'index.js',
    scripts: { start: 'expo start', android: 'expo run:android', ios: 'expo run:ios', 'build:android': 'bash scripts/build-android.sh', 'build:ios': 'bash scripts/build-ios.sh' },
    dependencies: { expo: EXPO_SDK }
  }

  const files = {
    'package.json': JSON.stringify(pkg, null, 2) + '\n',
    'app.json': JSON.stringify(appJson, null, 2) + '\n',
    'autodeploy.config.json': JSON.stringify(runtime, null, 2) + '\n',
    'index.js': template('index.js'),
    'App.js': applyFeatureBlocks(template('App.js'), f),
    'plugins/withReleaseSigning.js': template('plugins/withReleaseSigning.js'),
    'scripts/install-deps.sh': template('scripts/install-deps.sh'),
    'scripts/build-android.sh': template('scripts/build-android.sh'),
    'scripts/build-ios.sh': template('scripts/build-ios.sh'),
    [`.github/workflows/${WORKFLOW_FILE}`]: template(`.github/workflows/${WORKFLOW_FILE}`),
    '.gitignore': template('gitignore.txt'),
    'README.md': readme(cfg, domain),
    'assets/icon.png': icons.icon,
    'assets/adaptive-icon.png': icons.adaptive,
    'assets/splash-icon.png': icons.icon
  }
  if (f.push && cfg.googleServices) files['google-services.json'] = cfg.googleServices + '\n'
  return files
}

const EXECUTABLE = (p) => p.startsWith('scripts/') && p.endsWith('.sh')

/** Settings + icons → project files; throws when the app has never been saved or has no icon. */
async function projectFilesFor(host, server, dir, domain) {
  const stored = getStoredSettings(server, dir)
  const cfg = stored.mobile
  if (!cfg) throw httpError(400, 'Save the app settings first.')
  if (!domain) throw httpError(400, 'This project has no domain.')
  let icons = null
  if (cfg.hasIcon) {
    const d = iconDir(server, dir)
    try { icons = { icon: fs.readFileSync(path.join(d, 'icon.png')), adaptive: fs.readFileSync(path.join(d, 'adaptive-icon.png')) } } catch { /* fall back */ }
  }
  if (!icons && stored.pwa?.hasIcons) {
    // The installable-app (PWA) icon; less sharp at App Store size than a 1024×1024 upload
    const icon = await host.readFile(`${pwaDir(domain)}/icons/icon-512.png`, { encoding: null }).catch(() => null)
    const adaptive = await host.readFile(`${pwaDir(domain)}/icons/maskable-512.png`, { encoding: null }).catch(() => null)
    if (icon) icons = { icon, adaptive: adaptive || icon }
  }
  if (!icons) throw httpError(400, 'Upload an app icon (a square PNG or JPG, ideally 1024×1024) and save.')
  return { cfg, files: buildProjectFiles(cfg, domain, icons) }
}

async function writeTree(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, rel)
    await fs.promises.mkdir(path.dirname(p), { recursive: true })
    await fs.promises.writeFile(p, content, { mode: EXECUTABLE(rel) ? 0o755 : 0o644 })
  }
}

/** Zip of the project source for Android Studio / Xcode. Returns { localPath, fileName, cleanup }. */
export async function sourceZip(host, server, dir, domain) {
  const { cfg, files } = await projectFilesFor(host, server, dir, domain)
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ad-mobile-'))
  const name = `${slugOf(cfg.appName)}-mobile`
  await writeTree(path.join(tmp, name), files)
  const zip = path.join(tmp, `${name}.zip`)
  await exec('zip', ['-qr', zip, name], { cwd: tmp })
  return { localPath: zip, fileName: `${name}.zip`, cleanup: () => fs.promises.rm(tmp, { recursive: true, force: true }) }
}

// ---------------------------------------------------------------------------------------------
// GitHub: repository, push, build (Actions), artifacts
// ---------------------------------------------------------------------------------------------

async function gh(token, method, pathAndQuery, body) {
  if (!token) throw httpError(400, 'Connect your GitHub account first (Settings → Git Repository → Sign in with GitHub, or a token).')
  const r = await fetch(`${GITHUB_API}${pathAndQuery}`, {
    method,
    headers: { Authorization: `Bearer ${bareToken(token)}`, 'User-Agent': UA, Accept: 'application/vnd.github+json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000)
  })
  const data = r.status === 204 ? {} : await r.json().catch(() => ({}))
  if (!r.ok) {
    const msg = data.message || `HTTP ${r.status}`
    if (/workflow/i.test(msg) && /scope|permission|refusing/i.test(msg)) {
      throw httpError(403, 'GitHub refused to add the build workflow: your GitHub connection lacks the "workflow" permission. Sign in with GitHub again (Settings → Git Repository), or use a personal access token with the repo and workflow scopes.')
    }
    throw Object.assign(httpError(r.status === 401 ? 401 : r.status === 404 ? 404 : 502, `GitHub: ${msg}`), { githubStatus: r.status })
  }
  return data
}

const repoPath = (g) => `/repos/${encodeURIComponent(g.owner)}/${encodeURIComponent(g.repo)}`

/**
 * Links the app to a GitHub repository: creates a new private one (`name`, optionally under an
 * organization `owner`) or uses an existing `owner/repo`.
 */
export async function connectRepo(server, dir, token, { mode, name, owner, repo, userId }) {
  let data
  if (mode === 'existing') {
    const m = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(String(repo || '').trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, ''))
    if (!m) throw httpError(400, 'Repository looks like owner/name.')
    data = await gh(token, 'GET', `/repos/${m[1]}/${m[2]}`)
    if (!data.permissions?.push) throw httpError(403, `Your GitHub account can't push to ${data.full_name}.`)
  } else {
    const repoName = String(name || '').trim()
    if (!/^[A-Za-z0-9_.-]{1,100}$/.test(repoName)) throw httpError(400, 'Repository name may use letters, digits, - _ and .')
    const me = await gh(token, 'GET', '/user')
    const org = String(owner || '').trim()
    const body = { name: repoName, private: true, auto_init: true, description: 'Android & iOS app generated by AutoDeploy' }
    data = org && org !== me.login ? await gh(token, 'POST', `/orgs/${encodeURIComponent(org)}/repos`, body) : await gh(token, 'POST', '/user/repos', body)
  }
  const github = { owner: data.owner.login, repo: data.name, branch: data.default_branch || 'main', htmlUrl: data.html_url, private: !!data.private, pushedFiles: [] }
  saveMobilePatch(server, dir, { github }, userId)
  return github
}

export function disconnectRepo(server, dir, userId) {
  saveMobilePatch(server, dir, { github: null }, userId)
}

/** Commits the generated project to the repository's branch (one commit, only when something changed). */
async function pushSource(token, g, files, message) {
  const base = repoPath(g)
  let head
  try {
    head = (await gh(token, 'GET', `${base}/git/ref/heads/${encodeURIComponent(g.branch)}`)).object.sha
  } catch (err) {
    if (![404, 409].includes(err.githubStatus)) throw err
    // Empty repository: the Git data API needs a first commit
    await gh(token, 'PUT', `${base}/contents/README.md`, { message: 'Initial commit', content: Buffer.from(String(files['README.md'])).toString('base64'), branch: g.branch })
    head = (await gh(token, 'GET', `${base}/git/ref/heads/${encodeURIComponent(g.branch)}`)).object.sha
  }
  const headCommit = await gh(token, 'GET', `${base}/git/commits/${head}`)

  const tree = []
  for (const [p, content] of Object.entries(files)) {
    const blob = await gh(token, 'POST', `${base}/git/blobs`, { content: Buffer.from(content).toString('base64'), encoding: 'base64' })
    tree.push({ path: p, mode: EXECUTABLE(p) ? '100755' : '100644', type: 'blob', sha: blob.sha })
  }
  // Files an earlier push added that are no longer generated (e.g. google-services.json)
  for (const p of g.pushedFiles || []) if (!(p in files)) tree.push({ path: p, mode: '100644', type: 'blob', sha: null })

  let newTree
  try {
    newTree = await gh(token, 'POST', `${base}/git/trees`, { base_tree: headCommit.tree.sha, tree })
  } catch (err) {
    // Deleting a path that is already gone fails the whole tree; retry without deletions
    if (!tree.some((t) => t.sha === null)) throw err
    newTree = await gh(token, 'POST', `${base}/git/trees`, { base_tree: headCommit.tree.sha, tree: tree.filter((t) => t.sha !== null) })
  }
  if (newTree.sha === headCommit.tree.sha) return { changed: false, sha: head }
  const commit = await gh(token, 'POST', `${base}/git/commits`, { message, tree: newTree.sha, parents: [head] })
  await gh(token, 'PATCH', `${base}/git/refs/heads/${encodeURIComponent(g.branch)}`, { sha: commit.sha })
  return { changed: true, sha: commit.sha }
}

/** Pushes the current app source and starts the Actions build for `platform` (all | android | ios). */
export async function publishAndBuild(host, server, dir, domain, token, { platform = 'all', userId }) {
  if (!['all', 'android', 'ios'].includes(platform)) throw httpError(400, 'Platform is all, android or ios.')
  const { cfg, files } = await projectFilesFor(host, server, dir, domain)
  const g = cfg.github
  if (!g?.owner) throw httpError(400, 'Connect a GitHub repository first.')
  const push = await pushSource(token, g, files, `Update ${cfg.appName} ${cfg.version} (${cfg.buildNumber}) from AutoDeploy`)
  saveMobilePatch(server, dir, { github: { ...g, pushedFiles: Object.keys(files), lastPush: { sha: push.sha, at: new Date().toISOString() } } }, userId)

  // A just-added workflow can take a few seconds before GitHub accepts dispatches for it
  const dispatch = `${repoPath(g)}/actions/workflows/${WORKFLOW_FILE}/dispatches`
  for (let attempt = 0; ; attempt++) {
    try {
      await gh(token, 'POST', dispatch, { ref: g.branch, inputs: { platform } })
      break
    } catch (err) {
      if (attempt >= 5 || ![404, 422].includes(err.githubStatus)) throw err
      await new Promise((r) => setTimeout(r, 3000))
    }
  }
  return { pushed: push.changed, sha: push.sha, actionsUrl: `${g.htmlUrl}/actions/workflows/${WORKFLOW_FILE}` }
}

/** Latest builds with their downloadable files, and which signing secrets the repository has. */
export async function githubBuilds(server, dir, token) {
  const g = getStoredSettings(server, dir).mobile?.github
  if (!g?.owner) return { connected: false }
  const base = repoPath(g)
  let runs = []
  try {
    runs = (await gh(token, 'GET', `${base}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=5`)).workflow_runs || []
  } catch (err) {
    if (err.githubStatus !== 404) throw err // workflow not pushed yet
  }
  const builds = []
  for (const run of runs) {
    let artifacts = []
    if (run.status === 'completed') {
      artifacts = ((await gh(token, 'GET', `${base}/actions/runs/${run.id}/artifacts`)).artifacts || [])
        .map((a) => ({ id: a.id, name: a.name, size: a.size_in_bytes, expired: a.expired, expiresAt: a.expires_at }))
    }
    builds.push({ id: run.id, status: run.status, conclusion: run.conclusion, createdAt: run.created_at, url: run.html_url, sha: run.head_sha?.slice(0, 7), artifacts })
  }
  let secrets = null
  try {
    secrets = ((await gh(token, 'GET', `${base}/actions/secrets?per_page=100`)).secrets || []).map((s) => s.name)
  } catch { /* needs admin rights on the repository */ }
  return { connected: true, github: g, builds, secrets, secretsUrl: `${g.htmlUrl}/settings/secrets/actions` }
}

/** Streams a build artifact (a .zip from GitHub) to the response. */
export async function streamArtifact(server, dir, token, artifactId, res) {
  const g = getStoredSettings(server, dir).mobile?.github
  if (!g?.owner) throw httpError(400, 'No GitHub repository is connected.')
  if (!/^\d{1,15}$/.test(String(artifactId))) throw httpError(400, 'Invalid artifact.')
  const meta = await gh(token, 'GET', `${repoPath(g)}/actions/artifacts/${artifactId}`)
  // GitHub redirects to short-lived storage; fetch drops the Authorization header on that hop
  const r = await fetch(`${GITHUB_API}${repoPath(g)}/actions/artifacts/${artifactId}/zip`, {
    headers: { Authorization: `Bearer ${bareToken(token)}`, 'User-Agent': UA, Accept: 'application/vnd.github+json' },
    redirect: 'follow'
  })
  if (!r.ok || !r.body) throw httpError(502, `GitHub: download failed (${r.status}).`)
  res.setHeader('Content-Type', 'application/zip')
  res.setHeader('Content-Disposition', `attachment; filename="${String(meta.name).replace(/[^A-Za-z0-9._-]/g, '_')}-${artifactId}.zip"`)
  if (r.headers.get('content-length')) res.setHeader('Content-Length', r.headers.get('content-length'))
  Readable.fromWeb(r.body).pipe(res)
}

// ---------------------------------------------------------------------------------------------
// Android build on the server (JDK 17 + Android SDK)
// ---------------------------------------------------------------------------------------------

// Outside /var/www so project discovery never lists it, and never served by nginx (it holds the upload key)
const SERVER_ROOT = '/opt/autodeploy-mobile'
const SDK_DIR = '/opt/android-sdk'
const CMDLINE_TOOLS_URL = 'https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip'
const MIN_MEMORY_MB = 3800 // RAM + swap that a React Native Gradle build needs
const MIN_DISK_MB = 12000 // SDK, NDK, Gradle and npm caches

const appRoot = (domain) => {
  if (!DOMAIN_RE.test(domain || '')) throw httpError(400, 'This project has no domain.')
  return `${SERVER_ROOT}/${domain.toLowerCase()}`
}

const ENV_SETUP = `export ANDROID_HOME=\${ANDROID_HOME:-${SDK_DIR}}; export ANDROID_SDK_ROOT="$ANDROID_HOME"
J=$(ls -d /usr/lib/jvm/*17* 2>/dev/null | head -1 || true); [ -n "$J" ] && export JAVA_HOME="$J" && export PATH="$J/bin:$PATH"
export PATH="$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools"
`

/** What the server has for Android builds. */
export async function checkServerTools(host) {
  const r = await host.exec(`${ENV_SETUP}
command -v java >/dev/null && echo "java=$(java -version 2>&1 | head -1)"
echo "node=$(node -v 2>/dev/null)"
[ -d "$ANDROID_HOME/platform-tools" ] && [ -d "$ANDROID_HOME/licenses" ] && echo "sdk=1"
echo "mem=$(awk '/^(MemTotal|SwapTotal):/ {s+=$2} END {print int(s/1024)}' /proc/meminfo)"
mkdir -p ${SERVER_ROOT} 2>/dev/null; echo "disk=$(df -Pm ${SERVER_ROOT} 2>/dev/null | awk 'NR==2 {print $4}')"
echo "root=$( [ "$(id -u)" = 0 ] || sudo -n true 2>/dev/null && echo 1)"`, { timeout: 30000 })
  const v = Object.fromEntries((r.stdout || '').split('\n').map((l) => l.split(/=(.*)/s)).filter((p) => p.length > 1))
  const javaMajor = Number((/version "(\d+)/.exec(v.java || '') || [])[1] || 0)
  const nodeMajor = Number((/^v(\d+)/.exec(v.node || '') || [])[1] || 0)
  const memoryMb = Number(v.mem || 0)
  const diskMb = Number(v.disk || 0)
  return {
    java: { ok: javaMajor >= 17 && javaMajor <= 21, version: v.java || null },
    node: { ok: nodeMajor >= 20, version: v.node || null },
    sdk: { ok: v.sdk === '1', path: SDK_DIR },
    memory: { ok: memoryMb >= MIN_MEMORY_MB, mb: memoryMb, needMb: MIN_MEMORY_MB },
    disk: { ok: diskMb >= MIN_DISK_MB, mb: diskMb, needMb: MIN_DISK_MB },
    root: v.root === '1',
    ready: javaMajor >= 17 && javaMajor <= 21 && nodeMajor >= 20 && v.sdk === '1'
  }
}

/**
 * Runs `script` detached on the server as job `name` (survives panel restarts and dropped SSH
 * connections): output in <root>/<name>.log, state in <root>/<name>.status.
 */
async function startJob(host, root, name, script) {
  const state = await jobState(host, root, name)
  if (state.status === 'running') throw httpError(409, name === 'build' ? 'A build is already running.' : 'The installation is already running.')
  await host.mkdir(root)
  await host.writeFile(`${root}/${name}.sh`, `set -eo pipefail
trap 'echo failed > ${q(`${root}/${name}.status`)}; date +%s > ${q(`${root}/${name}.finished`)}' ERR
echo running > ${q(`${root}/${name}.status`)}
echo $$ > ${q(`${root}/${name}.pid`)}
${script}
echo success > ${q(`${root}/${name}.status`)}
date +%s > ${q(`${root}/${name}.finished`)}
`, { mode: 0o700 })
  const r = await host.exec(`cd ${q(root)} && rm -f ${name}.finished && date +%s > ${name}.started && echo running > ${name}.status && (nohup setsid bash ${name}.sh > ${name}.log 2>&1 < /dev/null & echo $! > ${name}.pid)`, { timeout: 30000 })
  if (r.code !== 0) throw httpError(500, r.stderr || 'Could not start the job.')
}

async function jobState(host, root, name) {
  const r = await host.exec(`cd ${q(root)} 2>/dev/null || exit 0
S=$(cat ${name}.status 2>/dev/null); P=$(cat ${name}.pid 2>/dev/null)
if [ "$S" = running ] && { [ -z "$P" ] || ! kill -0 "$P" 2>/dev/null; }; then S=interrupted; fi
echo "status=$S"; echo "started=$(cat ${name}.started 2>/dev/null)"; echo "finished=$(cat ${name}.finished 2>/dev/null)"
echo "@@LOG"; tail -n 150 ${name}.log 2>/dev/null`, { timeout: 30000 })
  const [head, log = ''] = (r.stdout || '').split('@@LOG\n')
  const v = Object.fromEntries(head.split('\n').map((l) => l.split(/=(.*)/s)).filter((p) => p.length > 1))
  const ts = (s) => (Number(s) ? new Date(Number(s) * 1000).toISOString() : null)
  return { status: v.status || 'idle', startedAt: ts(v.started), finishedAt: ts(v.finished), log }
}

/** Installs JDK 17 (apt/dnf/yum) and the Android SDK command-line tools in /opt/android-sdk. */
export async function installServerTools(host, domain) {
  const root = appRoot(domain)
  await startJob(host, root, 'tools', `S=; [ "$(id -u)" = 0 ] || S="sudo -n"
${ENV_SETUP}
if ! java -version 2>&1 | grep -qE 'version "(17|18|19|20|21)'; then
  echo "== Installing JDK 17"
  if command -v apt-get >/dev/null; then $S env DEBIAN_FRONTEND=noninteractive apt-get update -q && $S env DEBIAN_FRONTEND=noninteractive apt-get install -y -q openjdk-17-jdk-headless unzip curl
  elif command -v dnf >/dev/null; then $S dnf install -y java-17-openjdk-devel unzip curl
  elif command -v yum >/dev/null; then $S yum install -y java-17-openjdk-devel unzip curl
  else echo "No supported package manager: install JDK 17 yourself."; exit 1; fi
fi
${ENV_SETUP}
command -v unzip >/dev/null || { echo "unzip is missing"; exit 1; }
if [ ! -x "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" ]; then
  echo "== Downloading Android SDK command-line tools"
  $S mkdir -p "$ANDROID_HOME/cmdline-tools"
  T=$(mktemp -d); curl -fsSL -o "$T/tools.zip" ${q(CMDLINE_TOOLS_URL)}
  unzip -q "$T/tools.zip" -d "$T" && $S rm -rf "$ANDROID_HOME/cmdline-tools/latest" && $S mv "$T/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"; rm -rf "$T"
fi
$S chown -R "$(id -u):$(id -g)" "$ANDROID_HOME"
echo "== Accepting SDK licenses and installing platform tools"
yes | sdkmanager --sdk_root="$ANDROID_HOME" --licenses >/dev/null || true
sdkmanager --sdk_root="$ANDROID_HOME" "platform-tools"
echo "== Done. Gradle downloads the Android platform, build tools and NDK it needs on the first build."`)
  return { started: true }
}

/** Generates the project on the server and builds a signed APK + App Bundle in the background. */
export async function startServerBuild(host, server, dir, domain, { force = false } = {}) {
  const tools = await checkServerTools(host)
  if (!tools.ready) throw httpError(400, 'Install the Android build tools on this server first.')
  if (!force && !tools.memory.ok) throw httpError(400, `This server has ${tools.memory.mb} MB of memory (RAM + swap); an Android build needs about ${MIN_MEMORY_MB} MB and could slow down or stop the sites on it. Build with GitHub Actions instead, or confirm to build anyway.`)
  if (!tools.disk.ok) throw httpError(400, `Only ${tools.disk.mb} MB free under ${SERVER_ROOT}; the Android SDK and build caches need about ${MIN_DISK_MB} MB.`)

  const { cfg, files } = await projectFilesFor(host, server, dir, domain)
  const root = appRoot(domain)
  if ((await jobState(host, root, 'build')).status === 'running') throw httpError(409, 'A build is already running.')

  // Fresh source (keeps node_modules and the Gradle cache of the previous build)
  await host.exec(`mkdir -p ${q(`${root}/source`)} ${q(`${root}/keystore`)} ${q(`${root}/outputs`)} && chmod 700 ${q(`${root}/keystore`)} && cd ${q(`${root}/source`)} && find . -mindepth 1 -maxdepth 1 ! -name node_modules ! -name android -exec rm -rf {} +`, { timeout: 60000 })
  for (const [rel, content] of Object.entries(files)) {
    const p = `${root}/source/${rel}`
    await host.mkdir(path.posix.dirname(p))
    await host.writeFile(p, content, { mode: EXECUTABLE(rel) ? 0o755 : 0o644 })
  }

  const ks = `${root}/keystore`
  const dname = `CN=${cfg.appName.replace(/[,=+<>#;"\\]/g, ' ')}, O=${cfg.appName.replace(/[,=+<>#;"\\]/g, ' ')}`
  await startJob(host, root, 'build', `${ENV_SETUP}
cd ${q(root)}
if [ ! -f keystore/upload.jks ]; then
  echo "== Creating the Android upload key (keep a backup: Google Play only accepts updates signed with it)"
  PW=$(od -An -tx1 -N16 /dev/urandom | tr -d ' \\n')
  keytool -genkeypair -storetype PKCS12 -keystore keystore/upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000 -storepass "$PW" -keypass "$PW" -dname ${q(dname)}
  printf 'export ANDROID_KEYSTORE_PASSWORD=%s\\nexport ANDROID_KEY_PASSWORD=%s\\nexport ANDROID_KEY_ALIAS=upload\\n' "$PW" "$PW" > keystore/keystore.env
  chmod 600 keystore/upload.jks keystore/keystore.env
fi
. keystore/keystore.env
export ANDROID_KEYSTORE_FILE=${q(`${ks}/upload.jks`)}
export NODE_OPTIONS=--max-old-space-size=1536
export GRADLE_OPTS="-Xmx1536m -Dorg.gradle.jvmargs=-Xmx2048m -Dorg.gradle.daemon=false"
echo "== Building ${cfg.appName.replace(/[^A-Za-z0-9 ._-]/g, '')} ${cfg.version} (${cfg.buildNumber})"
cd source && nice -n 15 bash scripts/build-android.sh
cp build/android-out/* ../outputs/
echo "== Done"`)
  return { started: true }
}

/** Build state, log tail, built files and the upload key fingerprint. */
export async function serverBuildStatus(host, domain) {
  const root = appRoot(domain)
  const [build, tools] = await Promise.all([jobState(host, root, 'build'), jobState(host, root, 'tools')])
  const r = await host.exec(`cd ${q(root)} 2>/dev/null || exit 0
ls -1t outputs 2>/dev/null | head -20 | while read f; do echo "file=$f|$(stat -c '%s|%Y' "outputs/$f")"; done
if [ -f keystore/upload.jks ] && [ -f keystore/keystore.env ]; then . keystore/keystore.env
${ENV_SETUP}
  echo "sha256=$(keytool -list -v -keystore keystore/upload.jks -storepass "$ANDROID_KEYSTORE_PASSWORD" 2>/dev/null | grep -m1 'SHA256:' | sed 's/.*SHA256: *//')"
fi`, { timeout: 30000 })
  const files = []
  let sha256 = null
  for (const line of (r.stdout || '').split('\n')) {
    if (line.startsWith('file=')) {
      const [name, size, mtime] = line.slice(5).split('|')
      files.push({ name, size: Number(size), builtAt: new Date(Number(mtime) * 1000).toISOString() })
    } else if (line.startsWith('sha256=')) sha256 = line.slice(7).trim() || null
  }
  return { build, tools, files, keystore: sha256 ? { sha256 } : null }
}

/**
 * A built file (`outputs/<name>`) or, with name 'upload-key', the upload key and its passwords
 * as a .tar.gz. Returns { localPath, fileName, cleanup }.
 */
export async function serverDownload(host, domain, name) {
  const root = appRoot(domain)
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ad-mobile-'))
  const cleanup = () => fs.promises.rm(tmp, { recursive: true, force: true })
  try {
    let remote
    let fileName
    if (name === 'upload-key') {
      remote = `/tmp/.ad-upload-key-${crypto.randomBytes(6).toString('hex')}.tar.gz`
      const r = await host.exec(`umask 077; cd ${q(`${root}/keystore`)} && tar czf ${q(remote)} upload.jks keystore.env`, { timeout: 30000 })
      if (r.code !== 0) throw httpError(404, 'No upload key has been created yet. Run a build first.')
      fileName = `${domain}-android-upload-key.tar.gz`
    } else {
      if (!/^[A-Za-z0-9._-]+\.(apk|aab)$/.test(String(name || ''))) throw httpError(400, 'Invalid file.')
      remote = `${root}/outputs/${name}`
      if (!(await host.exists(remote))) throw httpError(404, 'That build file no longer exists.')
      fileName = name
    }
    const local = path.join(tmp, fileName)
    await host.fetchFile(remote, local)
    if (name === 'upload-key') await host.rm(remote)
    return { localPath: local, fileName, cleanup }
  } catch (err) {
    await cleanup()
    throw err
  }
}
