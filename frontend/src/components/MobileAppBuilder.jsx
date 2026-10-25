import React, { useCallback, useEffect, useState } from 'react'
import {
  Smartphone, Upload, Save, Loader2, CheckCircle2, XCircle, AlertTriangle, ExternalLink, Download, Github, Server, Package,
  Bell, Fingerprint, Vibrate, Camera, MapPin, Link2, RefreshCw, KeyRound, Code, Hammer, Clock, Apple, Play
} from 'lucide-react'
import { useAuth } from '../store/AuthContext'

/**
 * Native Android & iOS app from the project's website (backend mobile-app.service): a React
 * Native (Expo) shell with native features, built with the Android SDK / Xcode on GitHub Actions,
 * with the Android SDK on this server, or downloaded as source.
 */

const inputCls = 'w-full px-3.5 py-2.5 bg-slate-950/80 border border-white/10 rounded-xl text-white text-xs focus:outline-none focus:border-cyan-500 font-mono disabled:opacity-50'
const cardCls = 'p-4 rounded-2xl bg-slate-900/60 border border-white/10 space-y-3 text-xs'
const btnCls = 'px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50'
const primaryCls = 'px-4 py-2 bg-gradient-to-r from-cyan-500 via-indigo-600 to-purple-600 text-onaccent font-extrabold rounded-xl text-xs flex items-center gap-1.5 disabled:opacity-50 cursor-pointer'

const FEATURES = [
  ['push', Bell, 'Push notifications', 'Ask for permission and get the device token (FCM on Android, APNs on iOS) for your server to send to. Tapping a notification opens its url.'],
  ['biometrics', Fingerprint, 'Face ID / fingerprint', 'NativeApp.authenticate() to confirm a login or payment.'],
  ['haptics', Vibrate, 'Haptic feedback', 'NativeApp.haptic() for taps, success and error buzzes.'],
  ['camera', Camera, 'Camera & microphone', 'Video calls and live camera (getUserMedia) on the site. Photo uploads work without this.'],
  ['location', MapPin, 'Location', 'navigator.geolocation on the site.'],
  ['deepLinks', Link2, 'Open site links in the app', 'Links to your domain open the app on Android (verified with your signing fingerprint) and via the app scheme on both.'],
  ['externalLinks', ExternalLink, 'Other websites open in the browser', 'Links to other sites open in an in-app browser sheet instead of replacing your app.'],
  ['pullToRefresh', RefreshCw, 'Pull to refresh', 'Swipe down at the top of a page to reload it.']
]

const ANDROID_SECRETS = ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD']
const IOS_SECRETS = ['IOS_P12_BASE64', 'IOS_P12_PASSWORD', 'IOS_PROFILE_BASE64']
const TESTFLIGHT_SECRETS = ['APP_STORE_CONNECT_KEY_ID', 'APP_STORE_CONNECT_ISSUER_ID', 'APP_STORE_CONNECT_KEY_BASE64']

function Field({ label, hint, children }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-slate-300 font-bold block text-xs">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-500">{hint}</span>}
    </label>
  )
}

const loadImage = (file) => new Promise((resolve, reject) => {
  const img = new Image()
  img.onload = () => resolve(img)
  img.onerror = () => reject(new Error('That file is not an image the browser can read.'))
  img.src = URL.createObjectURL(file)
})

/** Square PNG; `inset` shrinks the artwork (Android adaptive icons crop to the middle ~66%). */
function renderIcon(img, size, { background = null, inset = 0 } = {}) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  if (background) {
    ctx.fillStyle = background
    ctx.fillRect(0, 0, size, size)
  }
  const box = size * (1 - inset * 2)
  const scale = Math.min(box / img.width, box / img.height)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, (size - img.width * scale) / 2, (size - img.height * scale) / 2, img.width * scale, img.height * scale)
  return canvas.toDataURL('image/png')
}

const formatSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const when = (iso) => (iso ? new Date(iso).toLocaleString() : '')

function StatusPill({ status, conclusion }) {
  const s = status === 'completed' ? conclusion : status
  const tone = s === 'success' ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30'
    : ['failure', 'failed', 'interrupted', 'cancelled', 'timed_out'].includes(s) ? 'text-rose-300 bg-rose-500/10 border-rose-500/30'
      : 'text-amber-200 bg-amber-500/10 border-amber-500/30'
  return <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase ${tone}`}>{(s || 'idle').replace('_', ' ')}</span>
}

function Check({ ok, label, detail }) {
  return (
    <li className="flex gap-2">
      {ok ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> : <XCircle className="w-4 h-4 text-rose-400 shrink-0" />}
      <span><span className={ok ? 'text-slate-200' : 'text-rose-200'}>{label}</span>{detail && <span className="block text-slate-500">{detail}</span>}</span>
    </li>
  )
}

export default function MobileAppBuilder({ project, api, base, locked }) {
  const { token } = useAuth()
  const body = { ...base, name: project?.name || '' }
  const [data, setData] = useState(null)
  const [form, setForm] = useState(null)
  const [icons, setIcons] = useState(null)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState(null) // { tone, text }
  const [tab, setTab] = useState('cloud')

  const say = (tone, text) => setNotice({ tone, text })
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const setFeature = (k, v) => setForm((f) => ({ ...f, features: { ...f.features, [k]: v } }))

  const load = useCallback(async () => {
    try {
      const d = await api('/api/studio/mobile-app/get', { method: 'POST', body })
      setData(d)
      setForm({ ...d.config, extraHosts: (d.config.extraHosts || []).join('\n') })
    } catch (err) {
      say('error', err.message)
    }
  }, [api, base.projectPath, base.domain]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  const run = async (label, fn) => {
    setBusy(label)
    setNotice(null)
    try {
      const r = await fn()
      if (r?.message) say('success', r.message)
      return r
    } catch (err) {
      say('error', err.message)
      return null
    } finally {
      setBusy('')
    }
  }

  const download = (path, extra, fallbackName) => run(`download:${fallbackName}`, async () => {
    const res = await fetch(path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, ...extra })
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      throw new Error(d.error || `Download failed (${res.status})`)
    }
    const name = (res.headers.get('Content-Disposition') || '').match(/filename="?([^";]+)"?/)?.[1] || fallbackName
    const url = URL.createObjectURL(await res.blob())
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  })

  const onIcon = async (file) => {
    if (!file) return
    try {
      const img = await loadImage(file)
      if (Math.min(img.width, img.height) < 512) throw new Error('Use an image at least 1024×1024 pixels (512×512 minimum).')
      setIcons({
        icon: renderIcon(img, 1024, { background: form.backgroundColor }),
        adaptiveIcon: renderIcon(img, 1024, { inset: 0.19 }),
        warnSmall: Math.min(img.width, img.height) < 1024
      })
    } catch (err) {
      say('error', err.message)
    }
  }

  const onGoogleServices = async (file) => {
    if (file) set('googleServices', await file.text())
  }

  const save = () => run('save', async () => {
    const values = { ...form, extraHosts: form.extraHosts.split(/[\s,]+/).filter(Boolean), buildNumber: Number(form.buildNumber) }
    if (icons) Object.assign(values, { icon: icons.icon, adaptiveIcon: icons.adaptiveIcon })
    const r = await api('/api/studio/mobile-app/save', { method: 'POST', body: { ...body, values } })
    setIcons(null)
    await load()
    return r
  })

  if (!project?.domain) {
    return <p className="text-xs text-amber-300">This project has no domain yet. Give it a domain and SSL first — the app opens your website.</p>
  }
  if (!form) {
    return notice ? <p className="text-xs text-rose-300">{notice.text}</p> : <div className="flex items-center gap-2 text-xs text-slate-400"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>
  }

  const preview = icons?.icon || data?.icon
  const saved = data?.saved

  return (
    <div className="space-y-6">
      <div className="p-4 rounded-2xl bg-slate-900/60 border border-white/10">
        <div className="font-bold text-sm flex items-center gap-2"><Smartphone className="w-4 h-4 text-cyan-400" />Native Android & iOS app</div>
        <p className="text-xs text-slate-400 mt-1">
          Turns https://{project.domain} into a real app for Google Play and the App Store: a React Native shell that shows your site full-screen,
          with native push notifications, Face ID / fingerprint, haptics, the share sheet, camera and deep links. It is built with the Android SDK
          and Xcode. Your site keeps working as it is; when you update the website, the app shows the new version straight away.
        </p>
      </div>

      {/* Identity */}
      <div className="grid grid-cols-1 md:grid-cols-[auto,1fr] gap-6">
        <div className="space-y-2">
          <div className="w-28 h-28 rounded-[28px] overflow-hidden border border-white/10 flex items-center justify-center" style={{ background: form.backgroundColor }}>
            {preview ? <img src={preview} alt="" className="w-full h-full object-contain" /> : <Smartphone className="w-10 h-10 text-slate-400" />}
          </div>
          <div className="text-center text-[11px] text-slate-300 truncate w-28">{form.appName || 'App'}</div>
          <label className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-dashed border-slate-600 text-[11px] text-slate-300 ${locked ? 'opacity-50' : 'hover:border-cyan-500 cursor-pointer'}`}>
            <Upload className="w-3.5 h-3.5" />{preview ? 'Change icon' : 'Upload icon'}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" disabled={locked} onChange={(e) => onIcon(e.target.files?.[0])} />
          </label>
          {!preview && data?.pwaIcon && <p className="text-[10px] text-slate-500 w-28">Uses your installable-app icon until you upload a 1024×1024 one.</p>}
          {icons?.warnSmall && <p className="text-[10px] text-amber-300 w-28">Under 1024px — the App Store icon may look soft.</p>}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="App name" hint="Under the icon and in the stores, 30 characters max"><input disabled={locked} value={form.appName} maxLength={30} onChange={(e) => set('appName', e.target.value)} className={inputCls} /></Field>
          <Field label="App ID" hint="Android package and iOS bundle ID. Can't change after the first store release."><input disabled={locked} value={form.bundleId} onChange={(e) => set('bundleId', e.target.value.trim())} placeholder="com.example.app" className={inputCls} /></Field>
          <Field label="Version" hint="Shown in the stores, e.g. 1.2.0"><input disabled={locked} value={form.version} onChange={(e) => set('version', e.target.value.trim())} className={inputCls} /></Field>
          <Field label="Build number" hint="Raise it for every store upload">
            <div className="flex gap-2">
              <input type="number" min={1} disabled={locked} value={form.buildNumber} onChange={(e) => set('buildNumber', e.target.value)} className={inputCls} />
              <button type="button" disabled={locked} onClick={() => set('buildNumber', Number(form.buildNumber || 0) + 1)} className={btnCls}>+1</button>
            </div>
          </Field>
          <Field label="Start page" hint="Page the app opens on, e.g. / or /app"><input disabled={locked} value={form.startUrl} onChange={(e) => set('startUrl', e.target.value)} className={inputCls} /></Field>
          <Field label="Orientation">
            <select disabled={locked} value={form.orientation} onChange={(e) => set('orientation', e.target.value)} className={inputCls}>
              <option value="default">Rotate freely</option><option value="portrait">Portrait</option><option value="landscape">Landscape</option>
            </select>
          </Field>
          <Field label="Status bar color">
            <div className="flex gap-2"><input type="color" disabled={locked} value={form.themeColor} onChange={(e) => set('themeColor', e.target.value)} className="h-10 w-12 bg-transparent cursor-pointer" /><input disabled={locked} value={form.themeColor} onChange={(e) => set('themeColor', e.target.value)} className={inputCls} /></div>
          </Field>
          <Field label="Splash / background color">
            <div className="flex gap-2"><input type="color" disabled={locked} value={form.backgroundColor} onChange={(e) => set('backgroundColor', e.target.value)} className="h-10 w-12 bg-transparent cursor-pointer" /><input disabled={locked} value={form.backgroundColor} onChange={(e) => set('backgroundColor', e.target.value)} className={inputCls} /></div>
          </Field>
          <div className="sm:col-span-2"><Field label="No-connection message"><input disabled={locked} value={form.offlineMessage} maxLength={200} onChange={(e) => set('offlineMessage', e.target.value)} placeholder="You are offline. Check your connection and try again." className={inputCls} /></Field></div>
        </div>
      </div>

      {/* Native features */}
      <div className="space-y-3">
        <div className="text-xs font-bold text-slate-300">Native features</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {FEATURES.map(([id, Icon, label, desc]) => (
            <label key={id} className={`flex gap-3 p-3 rounded-xl border cursor-pointer ${form.features[id] ? 'border-cyan-500/40 bg-cyan-500/5' : 'border-white/10 bg-slate-900/40'}`}>
              <input type="checkbox" disabled={locked} checked={!!form.features[id]} onChange={(e) => setFeature(id, e.target.checked)} className="mt-0.5" />
              <span><span className="flex items-center gap-1.5 text-xs font-bold text-slate-200"><Icon className="w-3.5 h-3.5 text-cyan-400" />{label}</span><span className="block text-[11px] text-slate-500 mt-0.5">{desc}</span></span>
            </label>
          ))}
        </div>
        {form.features.push && (
          <Field label="Firebase google-services.json (Android push)" hint={`Firebase console → Project settings → Add app → Android, package name ${form.bundleId}. iOS push needs the Push Notifications capability on your App ID and an APNs key on your push server.`}>
            <textarea disabled={locked} rows={3} value={form.googleServices} onChange={(e) => set('googleServices', e.target.value)} placeholder='{ "project_info": { … }, "client": [ … ] }' className={inputCls} />
            <input type="file" accept="application/json,.json" disabled={locked} onChange={(e) => onGoogleServices(e.target.files?.[0])} className="text-[11px] text-slate-400 mt-1" />
          </Field>
        )}
        <Field label="Other sites that stay inside the app" hint="Payment and sign-in pages your site sends people to and expects back from, one per line. Everything else opens in the browser. (Google sign-in refuses to run inside apps, so it always opens in the browser.)">
          <textarea disabled={locked} rows={3} value={form.extraHosts} onChange={(e) => set('extraHosts', e.target.value)} className={inputCls} />
        </Field>
      </div>

      <div className="flex justify-end">
        <button onClick={save} disabled={!!busy || locked} className={primaryCls}>
          {busy === 'save' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}Save app settings
        </button>
      </div>

      {notice && (
        <div className={`p-3 rounded-xl text-xs whitespace-pre-wrap ${notice.tone === 'error' ? 'bg-rose-500/10 border border-rose-500/30 text-rose-200' : 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-200'}`}>{notice.text}</div>
      )}

      {/* Build */}
      {saved ? (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {[['cloud', Github, 'Android + iOS (GitHub Actions)'], ['server', Server, 'Android on this server'], ['source', Package, 'Source code']].map(([id, Icon, label]) => (
              <button key={id} onClick={() => setTab(id)} className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer border ${tab === id ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-200' : 'bg-slate-900/60 border-white/10 text-slate-400'}`}>
                <Icon className="w-3.5 h-3.5" />{label}
              </button>
            ))}
          </div>
          {tab === 'cloud' && <CloudBuild api={api} body={body} data={data} busy={busy} run={run} download={download} reload={load} defaultRepo={`${form.appName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'app'}-mobile`} />}
          {tab === 'server' && <ServerBuild api={api} body={body} busy={busy} run={run} download={download} />}
          {tab === 'source' && (
            <div className={cardCls}>
              <p className="text-slate-400">The complete React Native (Expo) project, to build yourself: Android with Android Studio or <span className="font-mono">scripts/build-android.sh</span>, iOS on a Mac with Xcode and <span className="font-mono">scripts/build-ios.sh</span>. The README explains signing and the website bridge.</p>
              <button onClick={() => download('/api/studio/mobile-app/source', {}, 'mobile-app.zip')} disabled={!!busy} className={btnCls}>
                {busy === 'download:mobile-app.zip' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}Download source (.zip)
              </button>
            </div>
          )}
          <BridgeHelp />
        </div>
      ) : (
        <p className="text-xs text-slate-500">Save the app settings to build it.</p>
      )}
    </div>
  )
}

function CloudBuild({ api, body, data, busy, run, download, reload, defaultRepo }) {
  const github = data?.config?.github
  const [mode, setMode] = useState('create')
  const [repoName, setRepoName] = useState(defaultRepo)
  const [owner, setOwner] = useState('')
  const [existing, setExisting] = useState('')
  const [status, setStatus] = useState(null)

  const refresh = useCallback(async () => {
    try {
      setStatus(await api('/api/studio/mobile-app/github/status', { method: 'POST', body }))
    } catch (err) {
      setStatus({ error: err.message })
    }
  }, [api, body.projectPath, body.domain]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (github?.owner) refresh() }, [github?.owner, github?.repo, refresh])
  // Follow running builds
  const running = status?.builds?.some((b) => b.status !== 'completed')
  useEffect(() => {
    if (!running) return undefined
    const t = setInterval(refresh, 15000)
    return () => clearInterval(t)
  }, [running, refresh])

  if (!data?.githubConnected) {
    return <div className={cardCls}><p className="text-amber-200 flex gap-2"><AlertTriangle className="w-4 h-4 shrink-0" />Connect your GitHub account first under Source code → Git Repository (Sign in with GitHub). The app is built in a private repository on your own account, with GitHub's Android (Linux) and iOS (macOS + Xcode) build machines.</p></div>
  }

  if (!github?.owner) {
    return (
      <div className={cardCls}>
        <p className="text-slate-400">The app's source goes into a GitHub repository with a build workflow. GitHub builds Android with Gradle and iOS with Xcode on a Mac, so no Mac is needed. Private repositories use your GitHub Actions minutes (macOS minutes count 10×).</p>
        <div className="flex gap-4">
          <label className="flex items-center gap-1.5 text-slate-300"><input type="radio" checked={mode === 'create'} onChange={() => setMode('create')} />New private repository</label>
          <label className="flex items-center gap-1.5 text-slate-300"><input type="radio" checked={mode === 'existing'} onChange={() => setMode('existing')} />Existing repository</label>
        </div>
        {mode === 'create' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Repository name"><input value={repoName} onChange={(e) => setRepoName(e.target.value)} className={inputCls} /></Field>
            <Field label="Organization (optional)" hint="Leave empty for your own account"><input value={owner} onChange={(e) => setOwner(e.target.value)} className={inputCls} /></Field>
          </div>
        ) : (
          <Field label="Repository" hint="owner/name — an empty repository or one only used for this app"><input value={existing} onChange={(e) => setExisting(e.target.value)} placeholder="acme/shop-mobile" className={inputCls} /></Field>
        )}
        <button
          disabled={!!busy}
          onClick={() => run('connect', async () => {
            const r = await api('/api/studio/mobile-app/github/connect', { method: 'POST', body: { ...body, mode, name: repoName, owner, repo: existing } })
            await reload()
            return r
          })}
          className={primaryCls}
        >
          {busy === 'connect' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Github className="w-3.5 h-3.5" />}{mode === 'create' ? 'Create repository' : 'Connect repository'}
        </button>
      </div>
    )
  }

  const build = (platform) => run(`build:${platform}`, async () => {
    const r = await api('/api/studio/mobile-app/github/build', { method: 'POST', body: { ...body, platform } })
    setTimeout(refresh, 4000)
    return r
  })
  const secrets = status?.secrets
  const hasAll = (list) => secrets && list.every((s) => secrets.includes(s))

  return (
    <div className="space-y-4">
      <div className={cardCls}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <a href={github.htmlUrl} target="_blank" rel="noreferrer" className="font-mono text-cyan-300 hover:underline flex items-center gap-1.5"><Github className="w-3.5 h-3.5" />{github.owner}/{github.repo}</a>
          <button
            disabled={!!busy}
            onClick={() => window.confirm('Unlink this repository? Nothing is deleted on GitHub.') && run('unlink', async () => { const r = await api('/api/studio/mobile-app/github/disconnect', { method: 'POST', body }); await reload(); return r })}
            className="text-[11px] text-slate-500 hover:text-rose-300 cursor-pointer"
          >Unlink</button>
        </div>
        <p className="text-slate-400">Each build pushes the current app settings to the repository, then builds. Save your settings first.</p>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => build('all')} disabled={!!busy} className={primaryCls}>{busy === 'build:all' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Hammer className="w-3.5 h-3.5" />}Build Android + iOS</button>
          <button onClick={() => build('android')} disabled={!!busy} className={btnCls}>{busy === 'build:android' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}Android only</button>
          <button onClick={() => build('ios')} disabled={!!busy} className={btnCls}>{busy === 'build:ios' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Apple className="w-3.5 h-3.5" />}iOS only</button>
          <button onClick={refresh} className={btnCls}><RefreshCw className="w-3.5 h-3.5" />Refresh</button>
        </div>
      </div>

      <div className={cardCls}>
        <div className="font-bold text-sm">Builds</div>
        {status?.error && <p className="text-rose-300">{status.error}</p>}
        {status && !status.error && !status.builds?.length && <p className="text-slate-500">No builds yet.</p>}
        <ul className="space-y-3">
          {(status?.builds || []).map((b) => (
            <li key={b.id} className="border-t border-white/5 pt-3 first:border-0 first:pt-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status={b.status} conclusion={b.conclusion} />
                <span className="text-slate-400 flex items-center gap-1"><Clock className="w-3 h-3" />{when(b.createdAt)}</span>
                <span className="font-mono text-slate-500">{b.sha}</span>
                <a href={b.url} target="_blank" rel="noreferrer" className="text-cyan-300 hover:underline flex items-center gap-1 ml-auto">Log<ExternalLink className="w-3 h-3" /></a>
              </div>
              {b.artifacts.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {b.artifacts.map((a) => (
                    <button key={a.id} disabled={a.expired || !!busy} onClick={() => download('/api/studio/mobile-app/github/artifact', { artifactId: a.id }, `${a.name}.zip`)} className={btnCls}>
                      {busy === `download:${a.name}.zip` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                      {a.name === 'ios' ? 'iOS' : a.name === 'android' ? 'Android (.apk + .aab)' : a.name} · {a.expired ? 'expired' : formatSize(a.size)}
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className={cardCls}>
        <div className="font-bold text-sm flex items-center gap-2"><KeyRound className="w-4 h-4 text-amber-300" />Store signing</div>
        <p className="text-slate-400">Signing keys go in the repository's Actions secrets, never in the panel. Without them you still get a test APK (debug-signed) and an iOS simulator build.</p>
        <ul className="space-y-2">
          <Check ok={hasAll(ANDROID_SECRETS)} label="Google Play: Android upload key" detail={<>Secrets <span className="font-mono">ANDROID_KEYSTORE_BASE64</span> (<span className="font-mono">base64 -w0 upload.jks</span>), <span className="font-mono">ANDROID_KEYSTORE_PASSWORD</span>, optional <span className="font-mono">ANDROID_KEY_ALIAS</span> / <span className="font-mono">ANDROID_KEY_PASSWORD</span>. "Android on this server" can create the key; download its backup there.</>} />
          <Check ok={hasAll(IOS_SECRETS)} label="App Store: iOS distribution certificate + profile" detail={<>Secrets <span className="font-mono">IOS_P12_BASE64</span>, <span className="font-mono">IOS_P12_PASSWORD</span>, <span className="font-mono">IOS_PROFILE_BASE64</span> (App Store profile for <span className="font-mono">{data.config.bundleId}</span>). Needs an Apple Developer account.</>} />
          <Check ok={hasAll(TESTFLIGHT_SECRETS)} label="Optional: upload iOS builds to TestFlight" detail={<>App Store Connect API key: <span className="font-mono">APP_STORE_CONNECT_KEY_ID</span>, <span className="font-mono">APP_STORE_CONNECT_ISSUER_ID</span>, <span className="font-mono">APP_STORE_CONNECT_KEY_BASE64</span>.</>} />
        </ul>
        {secrets === null && <p className="text-slate-500">Your GitHub account can't list this repository's secrets, so they show as missing here.</p>}
        {status?.secretsUrl && <a href={status.secretsUrl} target="_blank" rel="noreferrer" className="inline-flex text-cyan-300 hover:underline items-center gap-1">Open Actions secrets<ExternalLink className="w-3 h-3" /></a>}
      </div>
    </div>
  )
}

function ServerBuild({ api, body, busy, run, download }) {
  const [tools, setTools] = useState(null)
  const [state, setState] = useState(null)

  const refresh = useCallback(async () => {
    try {
      const [t, s] = await Promise.all([
        api('/api/studio/mobile-app/server/check', { method: 'POST', body }),
        api('/api/studio/mobile-app/server/status', { method: 'POST', body })
      ])
      setTools(t)
      setState(s)
    } catch (err) {
      setState({ error: err.message })
    }
  }, [api, body.projectPath, body.domain]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { refresh() }, [refresh])
  const running = state?.build?.status === 'running' || state?.tools?.status === 'running'
  useEffect(() => {
    if (!running) return undefined
    const t = setInterval(refresh, 5000)
    return () => clearInterval(t)
  }, [running, refresh])

  const build = async () => {
    let force = false
    if (tools && !tools.memory.ok) {
      if (!window.confirm(`This server has ${tools.memory.mb} MB of memory (RAM + swap); an Android build needs about ${tools.memory.needMb} MB and may slow down or stop the sites on it while it runs. Build anyway?`)) return
      force = true
    }
    await run('server-build', () => api('/api/studio/mobile-app/server/build', { method: 'POST', body: { ...body, force } }))
    refresh()
  }

  if (state?.error) return <div className={cardCls}><p className="text-rose-300">{state.error}</p></div>
  if (!tools || !state) return <div className="flex items-center gap-2 text-xs text-slate-400"><Loader2 className="w-4 h-4 animate-spin" />Checking this server…</div>

  const job = state.tools.status === 'running' ? state.tools : state.build
  return (
    <div className="space-y-4">
      <div className={cardCls}>
        <p className="text-slate-400">Builds the Android app on this server with JDK 17 and the Android SDK: an <strong className="text-slate-200">.apk</strong> to install directly and an <strong className="text-slate-200">.aab</strong> for Google Play, signed with an upload key kept on this server. iOS apps can only be built on a Mac — use GitHub Actions for those.</p>
        <ul className="space-y-2">
          <Check ok={tools.java.ok} label="JDK 17" detail={tools.java.version || 'Not installed'} />
          <Check ok={tools.sdk.ok} label="Android SDK" detail={tools.sdk.ok ? tools.sdk.path : 'Not installed'} />
          <Check ok={tools.node.ok} label="Node.js 20 or newer" detail={tools.node.version || 'Not installed'} />
          <Check ok={tools.memory.ok} label={`Memory: ${tools.memory.mb} MB RAM + swap`} detail={tools.memory.ok ? null : `About ${tools.memory.needMb} MB is recommended. Add swap, or build with GitHub Actions.`} />
          <Check ok={tools.disk.ok} label={`Disk: ${Math.round(tools.disk.mb / 1024)} GB free`} detail={tools.disk.ok ? null : `About ${Math.round(tools.disk.needMb / 1024)} GB is needed for the SDK and build caches.`} />
        </ul>
        <div className="flex flex-wrap gap-2">
          {(!tools.java.ok || !tools.sdk.ok) && (
            <button onClick={async () => { await run('install', () => api('/api/studio/mobile-app/server/install-tools', { method: 'POST', body })); refresh() }} disabled={!!busy || running || !tools.root} className={primaryCls}>
              {busy === 'install' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}Install build tools
            </button>
          )}
          <button onClick={build} disabled={!!busy || running || !tools.ready || !tools.disk.ok} className={tools.ready ? primaryCls : btnCls}>
            {busy === 'server-build' || state.build.status === 'running' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Hammer className="w-3.5 h-3.5" />}Build Android app
          </button>
          <button onClick={refresh} className={btnCls}><RefreshCw className="w-3.5 h-3.5" />Refresh</button>
        </div>
        {!tools.root && (!tools.java.ok || !tools.sdk.ok) && <p className="text-amber-300">Installing the tools needs root or passwordless sudo on this server.</p>}
      </div>

      {(job.status !== 'idle' || job.log) && (
        <div className={cardCls}>
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm">{job === state.tools ? 'Installing build tools' : 'Last build'}</span>
            <StatusPill status={job.status} />
            <span className="text-slate-500">{when(job.startedAt)}{job.finishedAt ? ` → ${when(job.finishedAt)}` : ''}</span>
          </div>
          <pre className="max-h-72 overflow-auto bg-black/60 rounded-xl p-3 text-[10px] leading-relaxed text-slate-300 whitespace-pre-wrap">{job.log || '…'}</pre>
        </div>
      )}

      {state.files.length > 0 && (
        <div className={cardCls}>
          <div className="font-bold text-sm">Built files</div>
          <div className="flex flex-wrap gap-2">
            {state.files.map((f) => (
              <button key={f.name} disabled={!!busy} onClick={() => download('/api/studio/mobile-app/server/download', { file: f.name }, f.name)} className={btnCls} title={when(f.builtAt)}>
                {busy === `download:${f.name}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}{f.name} · {formatSize(f.size)}
              </button>
            ))}
          </div>
          <p className="text-slate-500">Install the .apk on a phone to test it. Upload the .aab in Google Play Console → your app → Test and release.</p>
        </div>
      )}

      {state.keystore && (
        <div className={cardCls}>
          <div className="font-bold text-sm flex items-center gap-2"><KeyRound className="w-4 h-4 text-amber-300" />Upload key</div>
          <p className="text-slate-400">Google Play only accepts updates signed with this key. <strong className="text-amber-200">Download a backup and keep it safe</strong>; it holds the key file and its password. To also build with GitHub Actions, add the file (base64) and password as repository secrets.</p>
          <div className="font-mono text-[11px] text-slate-200 break-all">SHA-256 {state.keystore.sha256}</div>
          <p className="text-slate-500">For links to {body.domain} to open the app, paste this fingerprint in App (PWA) → Android → SHA-256 signing fingerprint, together with the app ID. If you use Play App Signing, also add the app signing key fingerprint from Play Console → App integrity.</p>
          <button onClick={() => download('/api/studio/mobile-app/server/download', { file: 'upload-key' }, 'android-upload-key.tar.gz')} disabled={!!busy} className={btnCls}>
            <Download className="w-3.5 h-3.5" />Download key backup
          </button>
        </div>
      )}
    </div>
  )
}

function BridgeHelp() {
  return (
    <details className="p-4 rounded-2xl bg-slate-900/40 border border-white/10 text-xs">
      <summary className="font-bold text-sm flex items-center gap-2 cursor-pointer"><Code className="w-4 h-4 text-cyan-400" />Use native features from your website</summary>
      <pre className="mt-3 bg-black/60 rounded-xl p-3 text-[11px] leading-relaxed text-slate-300 overflow-auto">{`if (window.NativeApp) {                    // running inside the app
  NativeApp.platform                       // 'android' | 'ios'
  NativeApp.has('push')                    // features this build has
  await NativeApp.share({ title, text, url })
  await NativeApp.haptic('success')        // light | medium | heavy | selection | success | warning | error
  const { token, type } = await NativeApp.getPushToken()  // send it to your server
  const { success } = await NativeApp.authenticate('Confirm payment')
  await NativeApp.openExternal('https://…')
}
document.addEventListener('nativeappready', () => { /* NativeApp is ready */ })`}</pre>
      <p className="mt-2 text-slate-500">The app's user agent ends with <span className="font-mono">AutoDeployApp/&lt;version&gt;</span>. Send push notifications from your server through Firebase Cloud Messaging (Android) and APNs (iOS); add <span className="font-mono">{'{ "url": "https://…" }'}</span> to the notification data to open that page when it's tapped.</p>
    </details>
  )
}
