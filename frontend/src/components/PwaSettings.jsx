import React, { useState } from 'react'
import {
  Smartphone, Upload, CheckCircle2, XCircle, Loader2, ExternalLink, Apple, Play, Copy, Check, Save, ShieldCheck, Info
} from 'lucide-react'

/**
 * Turns the project's site into an installable app (PWA) and helps publish it to Android and iOS.
 * Icons are resized in the browser (no image tools needed on the server).
 */

const inputCls = 'w-full px-3.5 py-2.5 bg-slate-950/80 border border-white/10 rounded-xl text-white text-xs focus:outline-none focus:border-cyan-500 font-mono disabled:opacity-50'

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
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.onload = () => resolve(img)
  img.onerror = () => reject(new Error('That file is not an image the browser can read.'))
  img.src = url
})

/** Square PNG of `size`; `inset` shrinks the artwork (maskable safe zone) over `background`. */
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
  const w = img.width * scale
  const h = img.height * scale
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h)
  return canvas.toDataURL('image/png')
}

function CopyText({ text }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() => { navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
      className="inline-flex items-center gap-1 text-[11px] text-cyan-300 hover:text-cyan-200 cursor-pointer"
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}{copied ? 'Copied' : 'Copy'}
    </button>
  )
}

export default function PwaSettings({ project, stored, locked, busy, onSave, api, base }) {
  const domain = project?.domain || ''
  const siteUrl = domain ? `https://${domain}/` : ''
  const [form, setForm] = useState(() => ({
    enabled: !!stored?.enabled,
    name: stored?.name || project?.name || '',
    shortName: stored?.shortName || (project?.name || '').slice(0, 12),
    description: stored?.description || '',
    themeColor: stored?.themeColor || '#0891b2',
    backgroundColor: stored?.backgroundColor || '#ffffff',
    display: stored?.display || 'standalone',
    orientation: stored?.orientation || 'any',
    startUrl: stored?.startUrl || '/',
    strategy: stored?.strategy || 'offline',
    offlineMessage: stored?.offlineMessage || '',
    installButton: stored?.installButton !== false,
    installLabel: stored?.installLabel || 'Install app',
    androidPackage: stored?.android?.packageName || (domain ? domain.split('.').reverse().join('.').replace(/-/g, '_') : ''),
    androidFingerprints: (stored?.android?.fingerprints || []).join('\n')
  }))
  const [icons, setIcons] = useState(null) // generated data URLs
  const [iconError, setIconError] = useState('')
  const [checks, setChecks] = useState(null)
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState('')

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const onIcon = async (file) => {
    setIconError('')
    if (!file) return
    try {
      const img = await loadImage(file)
      if (Math.min(img.width, img.height) < 192) throw new Error('Use an image at least 512×512 pixels (192×192 minimum).')
      setIcons({
        icon192: renderIcon(img, 192),
        icon512: renderIcon(img, 512),
        maskable512: renderIcon(img, 512, { background: form.backgroundColor, inset: 0.1 }),
        apple180: renderIcon(img, 180, { background: form.backgroundColor }),
        warnSmall: Math.min(img.width, img.height) < 512
      })
    } catch (err) {
      setIconError(err.message)
    }
  }

  const save = () => {
    const values = { ...form }
    if (icons) values.icons = { icon192: icons.icon192, icon512: icons.icon512, maskable512: icons.maskable512, apple180: icons.apple180 }
    return onSave('pwa', values).then((ok) => { if (ok) setIcons(null) })
  }

  const runCheck = async () => {
    setChecking(true)
    setCheckError('')
    try {
      setChecks(await api('/api/studio/project-settings/pwa-check', { method: 'POST', body: base }))
    } catch (err) {
      setCheckError(err.message)
    } finally {
      setChecking(false)
    }
  }

  const previewIcon = icons?.icon192 || (stored?.hasIcons && domain ? `https://${domain}/autodeploy-pwa/icons/icon-192.png?v=${stored.version || ''}` : null)
  const pwabuilder = `https://www.pwabuilder.com/reportcard?site=${encodeURIComponent(siteUrl)}`

  if (!domain) {
    return <p className="text-xs text-amber-300">This project has no domain yet. Give it a domain (and SSL) first — apps can only be installed from a website address.</p>
  }

  return (
    <div className="space-y-6">
      {/* Enable */}
      <div className="flex items-start justify-between gap-4 p-4 rounded-2xl bg-slate-900/60 border border-white/10">
        <div>
          <div className="font-bold text-sm flex items-center gap-2"><Smartphone className="w-4 h-4 text-cyan-400" />Installable app</div>
          <p className="text-xs text-slate-400 mt-1">Visitors can install {domain} on Android, iPhone/iPad and desktop. It opens full-screen with its own icon and shows an offline page instead of an error.</p>
        </div>
        <button
          type="button"
          disabled={locked}
          onClick={() => set('enabled', !form.enabled)}
          className={`relative shrink-0 w-11 h-6 rounded-full transition ${form.enabled ? 'bg-cyan-500' : 'bg-slate-700'} disabled:opacity-50 cursor-pointer`}
          role="switch"
          aria-checked={form.enabled}
        >
          <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${form.enabled ? 'left-6' : 'left-1'}`} />
        </button>
      </div>

      {form.enabled && (
        <>
          {/* Identity + icon */}
          <div className="grid grid-cols-1 md:grid-cols-[auto,1fr] gap-6">
            <div className="space-y-2">
              <div className="w-28 h-28 rounded-[28px] overflow-hidden border border-white/10 flex items-center justify-center" style={{ background: form.backgroundColor }}>
                {previewIcon ? <img src={previewIcon} alt="" className="w-full h-full object-contain" /> : <Smartphone className="w-10 h-10 text-slate-400" />}
              </div>
              <div className="text-center text-[11px] text-slate-300 truncate w-28">{form.shortName || 'App'}</div>
              <label className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-dashed border-slate-600 text-[11px] text-slate-300 ${locked ? 'opacity-50' : 'hover:border-cyan-500 cursor-pointer'}`}>
                <Upload className="w-3.5 h-3.5" />{stored?.hasIcons || icons ? 'Change icon' : 'Upload icon'}
                <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" disabled={locked} onChange={(e) => onIcon(e.target.files?.[0])} />
              </label>
              {icons?.warnSmall && <p className="text-[10px] text-amber-300 w-28">Under 512px — it may look soft on large screens.</p>}
              {iconError && <p className="text-[10px] text-rose-300 w-28">{iconError}</p>}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="App name"><input disabled={locked} value={form.name} maxLength={45} onChange={(e) => set('name', e.target.value)} className={inputCls} /></Field>
              <Field label="Home screen label" hint="12 characters or fewer"><input disabled={locked} value={form.shortName} maxLength={12} onChange={(e) => set('shortName', e.target.value)} className={inputCls} /></Field>
              <div className="sm:col-span-2"><Field label="Description"><input disabled={locked} value={form.description} maxLength={200} onChange={(e) => set('description', e.target.value)} className={inputCls} /></Field></div>
              <Field label="Theme color" hint="Status bar and title bar">
                <div className="flex gap-2"><input type="color" disabled={locked} value={form.themeColor} onChange={(e) => set('themeColor', e.target.value)} className="h-10 w-12 bg-transparent cursor-pointer" /><input disabled={locked} value={form.themeColor} onChange={(e) => set('themeColor', e.target.value)} className={inputCls} /></div>
              </Field>
              <Field label="Splash / background color" hint="Shown while the app opens">
                <div className="flex gap-2"><input type="color" disabled={locked} value={form.backgroundColor} onChange={(e) => set('backgroundColor', e.target.value)} className="h-10 w-12 bg-transparent cursor-pointer" /><input disabled={locked} value={form.backgroundColor} onChange={(e) => set('backgroundColor', e.target.value)} className={inputCls} /></div>
              </Field>
            </div>
          </div>

          {/* Behaviour */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Open as">
              <select disabled={locked} value={form.display} onChange={(e) => set('display', e.target.value)} className={inputCls}>
                <option value="standalone">App window (recommended)</option>
                <option value="fullscreen">Full screen (games, kiosks)</option>
                <option value="minimal-ui">App window with back/reload</option>
                <option value="browser">Browser tab</option>
              </select>
            </Field>
            <Field label="Orientation">
              <select disabled={locked} value={form.orientation} onChange={(e) => set('orientation', e.target.value)} className={inputCls}>
                <option value="any">Any</option><option value="portrait">Portrait</option><option value="landscape">Landscape</option>
              </select>
            </Field>
            <Field label="Start page" hint="Page the app opens on, e.g. / or /dashboard"><input disabled={locked} value={form.startUrl} onChange={(e) => set('startUrl', e.target.value)} className={inputCls} /></Field>
            <Field label="Offline behaviour">
              <select disabled={locked} value={form.strategy} onChange={(e) => set('strategy', e.target.value)} className={inputCls}>
                <option value="offline">Always live, offline page when there's no connection</option>
                <option value="assets">Also cache styles, scripts, images and fonts (faster repeat visits)</option>
              </select>
            </Field>
            <div className="sm:col-span-2"><Field label="Offline message"><input disabled={locked} value={form.offlineMessage} maxLength={200} onChange={(e) => set('offlineMessage', e.target.value)} placeholder="You are offline. Check your connection and try again." className={inputCls} /></Field></div>
            <label className="flex items-center gap-2 text-xs text-slate-300 sm:col-span-2">
              <input type="checkbox" disabled={locked} checked={form.installButton} onChange={(e) => set('installButton', e.target.checked)} />
              Show a floating
              <input disabled={locked || !form.installButton} value={form.installLabel} maxLength={30} onChange={(e) => set('installLabel', e.target.value)} className="px-2 py-1 bg-slate-950 border border-white/10 rounded-lg text-xs w-32" />
              button where the browser supports installing
            </label>
          </div>
        </>
      )}

      <div className="flex justify-end">
        <button onClick={save} disabled={busy || locked} className="px-4 py-2 bg-gradient-to-r from-cyan-500 via-indigo-600 to-purple-600 text-white font-extrabold rounded-xl text-xs flex items-center gap-1.5 disabled:opacity-50 cursor-pointer">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}{form.enabled ? 'Publish app' : stored?.enabled ? 'Turn off app' : 'Save'}
        </button>
      </div>

      {stored?.enabled && (
        <>
          {/* Installability check */}
          <div className="p-4 rounded-2xl bg-slate-900/60 border border-white/10 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="font-bold text-sm flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-emerald-400" />Install readiness</div>
              <button onClick={runCheck} disabled={checking} className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 rounded-xl flex items-center gap-1.5 cursor-pointer">
                {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}Check live site
              </button>
            </div>
            {checkError && <p className="text-xs text-rose-300">{checkError}</p>}
            {checks && (
              <ul className="space-y-2 text-xs">
                {checks.checks.map((c) => (
                  <li key={c.id} className="flex gap-2">
                    {c.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> : c.optional ? <Info className="w-4 h-4 text-slate-500 shrink-0" /> : <XCircle className="w-4 h-4 text-rose-400 shrink-0" />}
                    <span><span className={c.ok ? 'text-slate-200' : c.optional ? 'text-slate-400' : 'text-rose-200'}>{c.label}</span>{!c.ok && <span className="block text-slate-500">{c.fix}</span>}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Android + iOS */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="p-4 rounded-2xl bg-slate-900/60 border border-white/10 space-y-3 text-xs">
              <div className="font-bold text-sm flex items-center gap-2"><Play className="w-4 h-4 text-emerald-400" />Android</div>
              <p className="text-slate-400"><strong className="text-slate-200">Install now:</strong> open {siteUrl} in Chrome and tap <em>Install app</em> (or menu → <em>Add to Home screen</em>).</p>
              <p className="text-slate-400"><strong className="text-slate-200">Google Play:</strong> generate an Android package (Trusted Web Activity) with PWABuilder, then paste its package name and SHA-256 signing fingerprint here so Android opens your site full-screen without a browser bar.</p>
              <Field label="Package name"><input disabled={locked} value={form.androidPackage} onChange={(e) => set('androidPackage', e.target.value)} placeholder="com.example.app" className={inputCls} /></Field>
              <Field label="SHA-256 signing fingerprint(s)" hint="From PWABuilder's signing key or Play Console → App integrity. One per line.">
                <textarea disabled={locked} rows={2} value={form.androidFingerprints} onChange={(e) => set('androidFingerprints', e.target.value)} placeholder="AB:CD:…:EF" className={inputCls} />
              </Field>
              <div className="flex flex-wrap gap-2">
                <a href={pwabuilder} target="_blank" rel="noopener noreferrer" className="px-3 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 font-bold flex items-center gap-1.5"><ExternalLink className="w-3.5 h-3.5" />Build Android package</a>
                <button onClick={save} disabled={busy || locked} className="px-3 py-2 rounded-xl bg-slate-800 text-slate-200 font-bold cursor-pointer disabled:opacity-50">Save Android link</button>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-slate-900/60 border border-white/10 space-y-3 text-xs">
              <div className="font-bold text-sm flex items-center gap-2"><Apple className="w-4 h-4 text-slate-200" />iPhone & iPad</div>
              <p className="text-slate-400"><strong className="text-slate-200">Install now:</strong> open {siteUrl} in Safari, tap <em>Share</em> → <em>Add to Home Screen</em>. It opens full-screen with your icon and name (iOS 16.4+ also supports web push for installed apps).</p>
              <p className="text-slate-400"><strong className="text-slate-200">App Store:</strong> PWABuilder generates an Xcode project that wraps this site. Building and submitting it needs a Mac with Xcode and an Apple Developer account.</p>
              <a href={pwabuilder} target="_blank" rel="noopener noreferrer" className="inline-flex px-3 py-2 rounded-xl bg-slate-800 border border-white/10 text-slate-200 font-bold items-center gap-1.5"><ExternalLink className="w-3.5 h-3.5" />Build iOS package</a>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-900/40 border border-white/10 text-[11px] text-slate-400 flex flex-wrap items-center gap-2">
            Share this link to install: <span className="font-mono text-slate-200">{siteUrl}</span><CopyText text={siteUrl} />
            <span className="w-full">Manifest: <span className="font-mono">{siteUrl}manifest.webmanifest</span></span>
          </div>
        </>
      )}
    </div>
  )
}
