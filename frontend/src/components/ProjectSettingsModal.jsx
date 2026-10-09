import React, { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft, Search, Sliders, Globe, Palette, Languages, Code, Braces, Building, CreditCard, Truck,
  Mail, ShieldCheck, TrendingUp, BarChart3, X, Save, Plus, Trash2, Lock, Power, RefreshCw, Link2,
  CheckCircle2, AlertCircle, Loader2, Smartphone
} from 'lucide-react'
import { useApi } from '../hooks/useApi'
import PwaSettings from './PwaSettings'

/**
 * Project settings, applied to the real app on its server (see backend project-settings.service):
 *  - .env sections: the app reads these keys (restart to load them)
 *  - nginx sections (owners/admins): SEO tags, analytics, code injection, redirects, domains
 */

const ENV_FIELDS = {
  languages: [
    ['DEFAULT_LOCALE', 'Default locale', 'en-US'],
    ['SUPPORTED_LOCALES', 'Supported locales (comma separated)', 'en-US,hi-IN,fr-FR'],
    ['TZ', 'Time zone', 'Asia/Kolkata']
  ],
  business: [
    ['COMPANY_NAME', 'Company / business name', 'Acme Pvt Ltd'],
    ['BUSINESS_EMAIL', 'Business email', 'hello@example.com'],
    ['BUSINESS_PHONE', 'Business phone', '+91 98765 43210'],
    ['BUSINESS_ADDRESS', 'Business address', 'Street, City, Country'],
    ['DEFAULT_CURRENCY', 'Currency code', 'INR']
  ],
  payments: [
    ['STRIPE_PUBLISHABLE_KEY', 'Stripe publishable key', 'pk_live_…'],
    ['STRIPE_SECRET_KEY', 'Stripe secret key', 'sk_live_…', true],
    ['STRIPE_WEBHOOK_SECRET', 'Stripe webhook secret', 'whsec_…', true],
    ['PAYPAL_CLIENT_ID', 'PayPal client ID', ''],
    ['PAYPAL_CLIENT_SECRET', 'PayPal client secret', '', true],
    ['PAYPAL_MODE', 'PayPal mode (sandbox or live)', 'live'],
    ['RAZORPAY_KEY_ID', 'Razorpay key ID', 'rzp_live_…'],
    ['RAZORPAY_KEY_SECRET', 'Razorpay key secret', '', true]
  ],
  shipping: [
    ['SHIPPO_API_KEY', 'Shippo API key', 'shippo_live_…', true],
    ['EASYPOST_API_KEY', 'EasyPost API key', '', true],
    ['SHIPROCKET_EMAIL', 'Shiprocket email', ''],
    ['SHIPROCKET_PASSWORD', 'Shiprocket password', '', true]
  ],
  email: [
    ['SMTP_HOST', 'SMTP host', 'smtp.example.com'],
    ['SMTP_PORT', 'SMTP port', '587'],
    ['SMTP_SECURE', 'Use TLS from the start (true for port 465)', 'false'],
    ['SMTP_USER', 'SMTP username', ''],
    ['SMTP_PASS', 'SMTP password', '', true],
    ['MAIL_FROM', 'From address', 'App <noreply@example.com>'],
    ['RESEND_API_KEY', 'Resend API key (instead of SMTP)', 're_…', true]
  ],
  spam: [
    ['RECAPTCHA_SITE_KEY', 'reCAPTCHA site key', ''],
    ['RECAPTCHA_SECRET_KEY', 'reCAPTCHA secret key', '', true],
    ['TURNSTILE_SITE_KEY', 'Cloudflare Turnstile site key', ''],
    ['TURNSTILE_SECRET_KEY', 'Cloudflare Turnstile secret key', '', true]
  ]
}

const NAV = [
  { category: 'OVERVIEW', items: [{ id: 'overview', label: 'Overview', icon: Sliders }] },
  {
    category: 'SITE',
    items: [
      { id: 'general', label: 'General', icon: Globe, desc: 'Display name and publishing status (online/offline)' },
      { id: 'brand', label: 'Brand & AI', icon: Palette, desc: 'App name, brand color and the brief the AI agent follows' },
      { id: 'languages', label: 'Languages', icon: Languages, desc: 'Default locale, supported locales and time zone' },
      { id: 'global-vars', label: 'Global Variables', icon: Braces, desc: 'Custom environment variables for your app' },
      { id: 'code-injection', label: 'Code Injection', icon: Code, desc: 'Add code to the head or body of every page', server: true }
    ]
  },
  {
    category: 'SALES & LEADS',
    items: [
      { id: 'business', label: 'Business Details', icon: Building, desc: 'Company name, contact and currency' },
      { id: 'payments', label: 'Payment Processing', icon: CreditCard, desc: 'Stripe, PayPal and Razorpay keys' },
      { id: 'shipping', label: 'Shipping Carriers', icon: Truck, desc: 'Shippo, EasyPost and Shiprocket credentials' },
      { id: 'email', label: 'Email Integrations', icon: Mail, desc: 'SMTP or Resend for transactional email' },
      { id: 'spam', label: 'Spam Protection', icon: ShieldCheck, desc: 'reCAPTCHA and Cloudflare Turnstile keys' }
    ]
  },
  {
    category: 'SEARCH & MARKETING',
    items: [
      { id: 'seo', label: 'SEO', icon: Search, desc: 'Meta description and social sharing card', server: true },
      { id: 'redirects', label: 'Redirects', icon: TrendingUp, desc: '301 and 302 redirect rules', server: true },
      { id: 'analytics', label: 'Analytics', icon: BarChart3, desc: 'Google Analytics 4 and PostHog', server: true }
    ]
  },
  { category: 'MOBILE APP', items: [{ id: 'pwa', label: 'App (PWA) · Android & iOS', icon: Smartphone, desc: 'Turn this website into an installable app for Android, iPhone and desktop', server: true }] },
  { category: 'DOMAINS', items: [{ id: 'domains', label: 'Domains', icon: Link2, desc: 'Domains that serve this site', server: true }] }
]

const inputCls = 'w-full px-3.5 py-2.5 bg-slate-950/80 border border-white/10 rounded-xl text-white text-xs focus:outline-none focus:border-cyan-500 font-mono disabled:opacity-50'
const appNamesOf = (project) => (project?.pm2Processes || []).map((p) => p.name).filter(Boolean)

function Field({ label, children, hint }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-slate-300 font-bold block text-xs">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-500">{hint}</span>}
    </label>
  )
}

export default function ProjectSettingsModal({ isOpen, project, onClose }) {
  const api = useApi()
  const [activeTab, setActiveTab] = useState('overview')
  const [searchQuery, setSearchQuery] = useState('')
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [form, setForm] = useState({})
  const [restart, setRestart] = useState(true)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null) // { tone, text }
  const [revealed, setRevealed] = useState({})

  const base = useMemo(() => ({ projectPath: project?.path, domain: project?.domain || '', appNames: appNamesOf(project) }), [project])

  const load = async () => {
    setLoadError('')
    try {
      const d = await api('/api/studio/project-settings/get', { method: 'POST', body: base })
      setData(d)
      const s = d.stored || {}
      setForm({
        ...d.env,
        displayName: s.displayName || project?.name || '',
        brief: s.brief || '',
        vars: d.customVars?.length ? d.customVars : [{ key: '', value: '' }],
        head: s.code?.head || '',
        body: s.code?.body || '',
        seoTitle: s.seo?.title || '',
        seoDescription: s.seo?.description || '',
        seoImage: s.seo?.ogImage || '',
        seoNoindex: !!s.seo?.noindex,
        injectAnalytics: s.analytics ? !!(s.analytics.gaId || s.analytics.posthogKey) || !(d.env.GA_MEASUREMENT_ID || d.env.POSTHOG_KEY) : true,
        redirects: s.redirects?.length ? s.redirects : [],
        domains: d.site?.domains?.length ? d.site.domains : (project?.domain ? [project.domain] : [])
      })
    } catch (err) {
      setLoadError(err.message)
    }
  }

  useEffect(() => {
    if (isOpen && project?.path) {
      setData(null)
      setResult(null)
      load()
    }
  }, [isOpen, project?.path])

  if (!isOpen) return null

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }))
  const canEditServer = !!data?.canEditServer
  const activeItem = NAV.flatMap((g) => g.items).find((i) => i.id === activeTab)
  const locked = activeItem?.server && !canEditServer

  const save = async (section, values, { withRestart = false } = {}) => {
    setBusy(true)
    setResult(null)
    try {
      const r = await api('/api/studio/project-settings/save', { method: 'POST', body: { ...base, section, values, restart: withRestart && restart } })
      setResult({ tone: 'success', text: r.message })
      await load()
      return true
    } catch (err) {
      setResult({ tone: 'error', text: err.message })
      return false
    } finally {
      setBusy(false)
    }
  }

  const saveCurrent = () => {
    const envValues = (keys) => Object.fromEntries(keys.map((k) => [k, form[k] ?? '']))
    switch (activeTab) {
      case 'general': return save('general', { displayName: form.displayName })
      case 'brand': return save('brand', { APP_NAME: form.APP_NAME, BRAND_PRIMARY_COLOR: form.BRAND_PRIMARY_COLOR, brief: form.brief }, { withRestart: true })
      case 'global-vars': return save('global-vars', { vars: form.vars.filter((v) => v.key) }, { withRestart: true })
      case 'code-injection': return save('code-injection', { head: form.head, body: form.body })
      case 'seo': return save('seo', { title: form.seoTitle, description: form.seoDescription, ogImage: form.seoImage, noindex: form.seoNoindex })
      case 'analytics': return save('analytics', { GA_MEASUREMENT_ID: form.GA_MEASUREMENT_ID, POSTHOG_KEY: form.POSTHOG_KEY, POSTHOG_HOST: form.POSTHOG_HOST, inject: form.injectAnalytics }, { withRestart: true })
      case 'redirects': return save('redirects', { redirects: form.redirects })
      case 'domains': return save('domains', { domains: form.domains })
      default:
        if (ENV_FIELDS[activeTab]) return save(activeTab, envValues(ENV_FIELDS[activeTab].map((f) => f[0])), { withRestart: true })
    }
  }

  const filteredNav = NAV.map((cat) => ({
    ...cat,
    items: cat.items.filter((i) => !searchQuery.trim() || `${i.label} ${i.desc || ''}`.toLowerCase().includes(searchQuery.toLowerCase()))
  })).filter((c) => c.items.length)

  const envForm = (section) => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {ENV_FIELDS[section].map(([key, label, placeholder, secret]) => (
        <Field key={key} label={label} hint={<span className="font-mono">{key}</span>}>
          <div className="relative">
            <input
              type={secret && !revealed[key] ? 'password' : 'text'}
              value={form[key] || ''}
              onChange={(e) => set(key, e.target.value)}
              placeholder={placeholder}
              autoComplete="off"
              className={inputCls}
            />
            {secret && (
              <button type="button" onClick={() => setRevealed((r) => ({ ...r, [key]: !r[key] }))} className="absolute right-2 top-2 text-[10px] text-slate-400 hover:text-white font-mono cursor-pointer">
                {revealed[key] ? 'hide' : 'show'}
              </button>
            )}
          </div>
        </Field>
      ))}
    </div>
  )

  const isEnvTab = ['brand', 'languages', 'business', 'payments', 'shipping', 'email', 'spam', 'global-vars', 'analytics'].includes(activeTab)
  const procs = data?.processes || []
  const online = procs.length > 0 && procs.every((p) => p.status === 'online')

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-2xl flex flex-col font-sans text-slate-100 overflow-hidden animate-in fade-in duration-200">
      <header className="h-14 bg-[#0B0E17]/90 border-b border-white/10 px-4 sm:px-6 flex items-center justify-between shrink-0 z-20 shadow-md">
        <button onClick={onClose} className="flex items-center space-x-2 text-slate-400 hover:text-white font-mono text-xs font-bold transition cursor-pointer">
          <ArrowLeft className="w-4 h-4 text-cyan-400" />
          <span>Back to project</span>
        </button>
        <div className="font-extrabold text-white text-sm tracking-tight truncate px-2">Settings · {project?.name}</div>
        <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-white rounded-lg transition cursor-pointer"><X className="w-5 h-5" /></button>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <aside className="w-64 hidden md:flex bg-[#080B12] border-r border-white/10 flex-col shrink-0 overflow-y-auto p-4 space-y-6">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-3" />
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search settings..." className="w-full pl-9 pr-3 py-2 bg-slate-950/80 border border-white/10 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono" />
          </div>
          <nav className="space-y-6">
            {filteredNav.map((group) => (
              <div key={group.category} className="space-y-1.5">
                <span className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-widest px-3 block">{group.category}</span>
                {group.items.map((item) => {
                  const Icon = item.icon
                  const isActive = activeTab === item.id
                  return (
                    <button
                      key={item.id}
                      onClick={() => { setActiveTab(item.id); setResult(null) }}
                      className={`w-full px-3 py-2 rounded-xl text-xs flex items-center justify-between transition cursor-pointer ${isActive ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 font-bold' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
                    >
                      <span className="flex items-center space-x-2.5"><Icon className={`w-4 h-4 ${isActive ? 'text-cyan-400' : 'text-slate-500'}`} /><span>{item.label}</span></span>
                      {item.server && !canEditServer && data && <Lock className="w-3 h-3 text-slate-600" />}
                    </button>
                  )
                })}
              </div>
            ))}
          </nav>
        </aside>

        <main className="flex-1 overflow-y-auto p-4 sm:p-8">
          {/* Mobile section picker */}
          <select value={activeTab} onChange={(e) => { setActiveTab(e.target.value); setResult(null) }} className={`${inputCls} md:hidden mb-6`}>
            {NAV.flatMap((g) => g.items).map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
          </select>

          {loadError ? (
            <div className="max-w-xl mx-auto p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-sm flex gap-2"><AlertCircle className="w-5 h-5 shrink-0" />{loadError}</div>
          ) : !data ? (
            <div className="flex items-center justify-center gap-2 text-slate-400 text-xs py-20"><Loader2 className="w-4 h-4 animate-spin" />Loading settings from the server…</div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-6">
              <div>
                <h3 className="text-xl font-extrabold text-white">{activeItem?.label}</h3>
                {activeItem?.desc && <p className="text-xs text-slate-400 mt-1">{activeItem.desc}</p>}
              </div>

              {locked && (
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex gap-2">
                  <Lock className="w-4 h-4 shrink-0" />These settings change the web server (nginx), so only organization owners and admins can edit them.
                </div>
              )}

              {activeTab === 'overview' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  {[
                    ['Project folder', project?.path],
                    ['Domains', (data.site?.domains || [project?.domain]).filter(Boolean).join(', ') || 'None'],
                    ['nginx site', data.site?.config || 'Not found'],
                    ['Environment file', data.envFile],
                    ['Your access', { super: 'Super admin', owner: 'Owner / admin', manager: 'Manager' }[data.access] || data.access],
                    ['Status', procs.length ? procs.map((p) => `${p.name}: ${p.status}`).join(', ') : 'No PM2 process (static site)']
                  ].map(([k, v]) => (
                    <div key={k} className="bg-slate-900/60 border border-white/10 rounded-2xl p-4">
                      <div className="text-slate-500 font-mono text-[10px] uppercase tracking-wider">{k}</div>
                      <div className="text-slate-200 font-semibold mt-1 break-all">{v}</div>
                    </div>
                  ))}
                  <p className="sm:col-span-2 text-slate-500">
                    Integration keys are written to the project's environment file, where your app reads them (process.env / $_ENV / os.environ). Web settings are applied by nginx in front of the site.
                  </p>
                </div>
              )}

              {activeTab === 'general' && (
                <div className="space-y-6">
                  <Field label="Display name" hint="How this project is named in the panel.">
                    <input value={form.displayName || ''} onChange={(e) => set('displayName', e.target.value)} className={inputCls} />
                  </Field>
                  <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4 space-y-3">
                    <div className="font-bold text-sm flex items-center gap-2"><Power className="w-4 h-4 text-cyan-400" />Publishing status</div>
                    {procs.length === 0 ? (
                      <p className="text-xs text-slate-400">This project has no PM2 process (it is served directly by nginx), so it is always online while its domain is configured.</p>
                    ) : (
                      <>
                        <p className="text-xs text-slate-400">Currently <strong className={online ? 'text-emerald-300' : 'text-rose-300'}>{online ? 'online' : 'offline'}</strong>. Taking it offline stops {procs.map((p) => p.name).join(', ')}.</p>
                        <div className="flex gap-2">
                          <button disabled={busy || online} onClick={() => save('publishing', { status: 'online' })} className="px-4 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs font-bold disabled:opacity-40 cursor-pointer">Publish (start)</button>
                          <button disabled={busy || !online} onClick={() => save('publishing', { status: 'offline' })} className="px-4 py-2 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs font-bold disabled:opacity-40 cursor-pointer">Take offline (stop)</button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'brand' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Field label="App name" hint={<span className="font-mono">APP_NAME</span>}>
                      <input value={form.APP_NAME || ''} onChange={(e) => set('APP_NAME', e.target.value)} className={inputCls} />
                    </Field>
                    <Field label="Primary brand color" hint={<span className="font-mono">BRAND_PRIMARY_COLOR</span>}>
                      <div className="flex gap-2">
                        <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(form.BRAND_PRIMARY_COLOR || '') ? form.BRAND_PRIMARY_COLOR : '#06b6d4'} onChange={(e) => set('BRAND_PRIMARY_COLOR', e.target.value)} className="h-10 w-12 bg-transparent cursor-pointer" />
                        <input value={form.BRAND_PRIMARY_COLOR || ''} onChange={(e) => set('BRAND_PRIMARY_COLOR', e.target.value)} placeholder="#06B6D4" className={inputCls} />
                      </div>
                    </Field>
                  </div>
                  <Field label="Brand & style brief for the AI agent" hint="The project's AI agent follows this when it changes your site.">
                    <textarea rows={6} value={form.brief || ''} onChange={(e) => set('brief', e.target.value)} placeholder="Tone, colors, fonts, do's and don'ts…" className={inputCls} />
                  </Field>
                </div>
              )}

              {ENV_FIELDS[activeTab] && envForm(activeTab)}

              {activeTab === 'global-vars' && (
                <div className="space-y-3">
                  {form.vars.map((v, i) => (
                    <div key={i} className="flex gap-2">
                      <input value={v.key} onChange={(e) => set('vars', form.vars.map((x, j) => (j === i ? { ...x, key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') } : x)))} placeholder="MY_VARIABLE" className={`${inputCls} w-1/3`} />
                      <input value={v.value} onChange={(e) => set('vars', form.vars.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} placeholder="value" className={inputCls} />
                      <button onClick={() => set('vars', form.vars.filter((_, j) => j !== i))} className="p-2 text-rose-400 hover:bg-rose-500/10 rounded-xl cursor-pointer"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  ))}
                  <button onClick={() => set('vars', [...form.vars, { key: '', value: '' }])} className="text-xs text-cyan-300 font-bold flex items-center gap-1 cursor-pointer"><Plus className="w-3.5 h-3.5" />Add variable</button>
                  <p className="text-[11px] text-slate-500">Removing a variable here also removes it from the environment file.</p>
                </div>
              )}

              {activeTab === 'code-injection' && (
                <div className="space-y-4">
                  <Field label="Before </head> on every page" hint="Meta tags, stylesheets, tracking scripts.">
                    <textarea rows={8} disabled={locked} value={form.head} onChange={(e) => set('head', e.target.value)} className={inputCls} placeholder="<link rel=&quot;stylesheet&quot; href=&quot;…&quot;>" />
                  </Field>
                  <Field label="Before </body> on every page" hint="Chat widgets, deferred scripts.">
                    <textarea rows={8} disabled={locked} value={form.body} onChange={(e) => set('body', e.target.value)} className={inputCls} placeholder="<script src=&quot;…&quot;></script>" />
                  </Field>
                  <p className="text-[11px] text-slate-500">Injected by nginx into HTML pages. If your app compresses its own responses, turn that off (let nginx compress) so the code can be inserted.</p>
                </div>
              )}

              {activeTab === 'seo' && (
                <div className="space-y-4">
                  <Field label="Social title (og:title)"><input disabled={locked} value={form.seoTitle} onChange={(e) => set('seoTitle', e.target.value)} className={inputCls} /></Field>
                  <Field label="Meta description"><textarea rows={3} disabled={locked} value={form.seoDescription} onChange={(e) => set('seoDescription', e.target.value)} className={inputCls} /></Field>
                  <Field label="Social image URL (og:image)"><input disabled={locked} value={form.seoImage} onChange={(e) => set('seoImage', e.target.value)} placeholder="https://example.com/share.png" className={inputCls} /></Field>
                  <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" disabled={locked} checked={form.seoNoindex} onChange={(e) => set('seoNoindex', e.target.checked)} />Hide this site from search engines (noindex)</label>
                </div>
              )}

              {activeTab === 'analytics' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Field label="Google Analytics 4 measurement ID" hint={<span className="font-mono">GA_MEASUREMENT_ID</span>}><input disabled={locked} value={form.GA_MEASUREMENT_ID || ''} onChange={(e) => set('GA_MEASUREMENT_ID', e.target.value)} placeholder="G-XXXXXXXXXX" className={inputCls} /></Field>
                    <Field label="PostHog project key" hint={<span className="font-mono">POSTHOG_KEY</span>}><input disabled={locked} value={form.POSTHOG_KEY || ''} onChange={(e) => set('POSTHOG_KEY', e.target.value)} placeholder="phc_…" className={inputCls} /></Field>
                    <Field label="PostHog host" hint={<span className="font-mono">POSTHOG_HOST</span>}><input disabled={locked} value={form.POSTHOG_HOST || ''} onChange={(e) => set('POSTHOG_HOST', e.target.value)} placeholder="https://us.i.posthog.com" className={inputCls} /></Field>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" disabled={locked} checked={form.injectAnalytics} onChange={(e) => set('injectAnalytics', e.target.checked)} />Add the tracking scripts to every page automatically</label>
                </div>
              )}

              {activeTab === 'redirects' && (
                <div className="space-y-3">
                  {form.redirects.length === 0 && <p className="text-xs text-slate-500">No redirects yet.</p>}
                  {form.redirects.map((r, i) => (
                    <div key={i} className="flex flex-wrap sm:flex-nowrap gap-2 items-center">
                      <input disabled={locked} value={r.from} onChange={(e) => set('redirects', form.redirects.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))} placeholder="/old-page" className={inputCls} />
                      <span className="text-slate-500">→</span>
                      <input disabled={locked} value={r.to} onChange={(e) => set('redirects', form.redirects.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))} placeholder="/new-page or https://…" className={inputCls} />
                      <select disabled={locked} value={r.type} onChange={(e) => set('redirects', form.redirects.map((x, j) => (j === i ? { ...x, type: Number(e.target.value) } : x)))} className={`${inputCls} sm:w-32`}>
                        <option value={301}>301 permanent</option>
                        <option value={302}>302 temporary</option>
                      </select>
                      <button disabled={locked} onClick={() => set('redirects', form.redirects.filter((_, j) => j !== i))} className="p-2 text-rose-400 hover:bg-rose-500/10 rounded-xl cursor-pointer"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  ))}
                  <button disabled={locked} onClick={() => set('redirects', [...form.redirects, { from: '', to: '', type: 301 }])} className="text-xs text-cyan-300 font-bold flex items-center gap-1 cursor-pointer disabled:opacity-40"><Plus className="w-3.5 h-3.5" />Add redirect</button>
                </div>
              )}

              {activeTab === 'pwa' && (
                <PwaSettings
                  key={`${project?.path}-${data.stored?.pwa?.version || 'new'}`}
                  project={project}
                  stored={data.stored?.pwa}
                  locked={locked}
                  busy={busy}
                  onSave={save}
                  api={api}
                  base={base}
                />
              )}

              {activeTab === 'domains' && (
                <div className="space-y-3">
                  {!data.site && <p className="text-xs text-amber-300">No nginx site was found for this project's domain, so domains can't be edited here.</p>}
                  {form.domains.map((d, i) => (
                    <div key={i} className="flex gap-2">
                      <input disabled={locked || i === 0} value={d} onChange={(e) => set('domains', form.domains.map((x, j) => (j === i ? e.target.value.trim().toLowerCase() : x)))} placeholder="www.example.com" className={inputCls} />
                      {i === 0 ? <span className="px-3 py-2 text-[10px] font-mono text-cyan-300 border border-cyan-500/30 rounded-xl">primary</span> : (
                        <button disabled={locked} onClick={() => set('domains', form.domains.filter((_, j) => j !== i))} className="p-2 text-rose-400 hover:bg-rose-500/10 rounded-xl cursor-pointer"><Trash2 className="w-4 h-4" /></button>
                      )}
                    </div>
                  ))}
                  <button disabled={locked || !data.site} onClick={() => set('domains', [...form.domains, ''])} className="text-xs text-cyan-300 font-bold flex items-center gap-1 cursor-pointer disabled:opacity-40"><Plus className="w-3.5 h-3.5" />Add domain</button>
                  <p className="text-[11px] text-slate-500">Point each domain's DNS A record at this server, save, then issue SSL again from SSL & Domains so HTTPS covers the new names.</p>
                </div>
              )}

              {result && (
                <div className={`p-3 rounded-xl text-xs flex gap-2 whitespace-pre-wrap ${result.tone === 'error' ? 'bg-rose-500/10 border border-rose-500/30 text-rose-200' : 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-200'}`}>
                  {result.tone === 'error' ? <AlertCircle className="w-4 h-4 shrink-0" /> : <CheckCircle2 className="w-4 h-4 shrink-0" />}{result.text}
                </div>
              )}

              {activeTab !== 'overview' && activeTab !== 'pwa' && (
                <div className="flex flex-wrap items-center justify-end gap-3 pt-2 border-t border-white/10">
                  {isEnvTab && procs.length > 0 && (
                    <label className="flex items-center gap-2 text-xs text-slate-400 mr-auto">
                      <input type="checkbox" checked={restart} onChange={(e) => setRestart(e.target.checked)} />
                      Restart the app so it loads the new values
                    </label>
                  )}
                  <button onClick={load} disabled={busy} className="px-3 py-2 text-xs text-slate-300 bg-slate-800 rounded-xl flex items-center gap-1.5 cursor-pointer"><RefreshCw className="w-3.5 h-3.5" />Reload</button>
                  <button onClick={saveCurrent} disabled={busy || locked} className="px-4 py-2 bg-gradient-to-r from-cyan-500 via-indigo-600 to-purple-600 text-white font-extrabold rounded-xl text-xs flex items-center gap-1.5 disabled:opacity-50 cursor-pointer">
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}Save {activeItem?.label}
                  </button>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
