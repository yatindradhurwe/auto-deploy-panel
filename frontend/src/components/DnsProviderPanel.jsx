import React, { useState, useEffect } from 'react'
import { Globe, RefreshCw, ExternalLink, Loader2, CheckCircle2, AlertTriangle, Unplug, Zap } from 'lucide-react'
import { useAuth } from '../store/AuthContext'
import { useServers } from '../store/ServersContext'

/**
 * Connect the organization's Hostinger (or Cloudflare) account once; the panel then writes DNS
 * itself — A records for deployed sites and the email records. Same connection as Email → DNS
 * and the deploy wizard. Also points any domain in the account at the selected server.
 */

const STEPS = {
  hostinger: [
    'Log in to hPanel and open Account (profile icon) → API.',
    'Click "Generate token", name it (e.g. AutoDeploy) and pick an expiry.',
    'Copy the token and paste it below.'
  ],
  cloudflare: [
    'Open My Profile → API Tokens → Create Token.',
    'Use the "Edit zone DNS" template with Zone Resources: All zones.',
    'Copy the token and paste it below.'
  ]
}

export default function DnsProviderPanel({ apiBaseUrl = '' }) {
  const { token: jwtToken } = useAuth()
  const { activeServer } = useServers()

  const api = async (url, { method = 'GET', body } = {}) => {
    const res = await fetch(`${apiBaseUrl}/api/deploy${url}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jwtToken}`, 'X-Server-Id': activeServer?.id || '' },
      body: body ? JSON.stringify(body) : undefined
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.success === false) throw new Error(data.error || `Request failed (${res.status})`)
    return data
  }

  const [conn, setConn] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [form, setForm] = useState({ provider: 'hostinger', token: '' })
  const [busy, setBusy] = useState('') // 'connect' | 'refresh' | 'disconnect' | 'check' | 'point'
  const [notice, setNotice] = useState(null) // { type: 'success'|'error', message }

  const [domain, setDomain] = useState('')
  const [check, setCheck] = useState(null) // { ip, check }
  const [replace, setReplace] = useState(false)

  useEffect(() => {
    api('/dns').then(d => { setConn(d.connection); setLoadError(null) }).catch(e => setLoadError(e.message))
  }, [jwtToken, activeServer])

  const run = async (kind, fn) => {
    setBusy(kind)
    setNotice(null)
    try { await fn() } catch (e) { setNotice({ type: 'error', message: e.message }) } finally { setBusy('') }
  }

  const connect = () => run('connect', async () => {
    const d = await api('/dns/connect', { method: 'POST', body: { provider: form.provider, token: form.token.trim() } })
    setConn(d.connection)
    setForm(f => ({ ...f, token: '' }))
    setNotice({ type: 'success', message: d.message })
  })
  const refresh = () => run('refresh', async () => setConn((await api('/dns/refresh', { method: 'POST', body: {} })).connection))
  const disconnect = () => {
    if (!window.confirm(`Disconnect ${conn.label}? Existing DNS records stay as they are; new deploys and mail domains will need DNS set by hand.`)) return
    run('disconnect', async () => {
      const d = await api('/dns/disconnect', { method: 'POST', body: {} })
      setConn(d.connection)
      setCheck(null)
      setNotice({ type: 'success', message: d.message })
    })
  }

  const cleanDomain = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  const doCheck = () => run('check', async () => {
    setReplace(false)
    setCheck(await api('/dns/check', { method: 'POST', body: { domain: cleanDomain } }))
  })
  const point = () => run('point', async () => {
    const d = await api('/dns/point', { method: 'POST', body: { domain: cleanDomain, replace } })
    setNotice({ type: 'success', message: d.message })
    setCheck(await api('/dns/check', { method: 'POST', body: { domain: cleanDomain } }))
  })

  const input = 'w-full bg-slate-950 border border-white/10 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-cyan-500/50'
  const btn = 'px-4 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50'
  const provider = conn?.providers?.[form.provider]

  return (
    <div className="bg-slate-900/80 border border-white/10 rounded-3xl p-6 shadow-2xl space-y-4 font-mono text-xs">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center space-x-3">
          <div className="p-2 rounded-xl bg-violet-500/10 text-violet-400"><Globe className="w-5 h-5" /></div>
          <div>
            <h3 className="font-bold text-sm text-white font-sans">DNS provider {conn?.connected ? `· ${conn.label}` : '· Hostinger'}</h3>
            <p className="text-slate-400">
              {conn?.connected
                ? `Connected (token ${conn.tokenHint}) · ${conn.zones.length} domain(s) · DNS records are written automatically`
                : 'Connect your Hostinger account so deploys and email set their DNS records automatically.'}
            </p>
          </div>
        </div>
        {conn?.connected && (
          <div className="flex gap-2">
            <button onClick={refresh} disabled={!!busy} className={`${btn} bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10 px-3 py-2`} title="Re-read the domains in the account">
              <RefreshCw className={`w-3.5 h-3.5 ${busy === 'refresh' ? 'animate-spin' : ''}`} /> Domains
            </button>
            <button onClick={disconnect} disabled={!!busy} className={`${btn} bg-slate-800 hover:bg-rose-900/60 text-slate-200 border border-white/10 px-3 py-2`}>
              <Unplug className="w-3.5 h-3.5" /> Disconnect
            </button>
          </div>
        )}
      </div>

      {loadError && <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-500/40 text-rose-300">{loadError}</div>}

      {conn && !conn.connected && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div className="flex rounded-xl bg-slate-950 border border-white/10 p-1 w-fit">
              {Object.entries(conn.providers || {}).map(([id, p]) => (
                <button key={id} onClick={() => setForm(f => ({ ...f, provider: id }))} className={`px-3 py-1.5 rounded-lg cursor-pointer ${form.provider === id ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-300 hover:text-white'}`}>{p.label}</button>
              ))}
            </div>
            <ol className="list-decimal list-inside space-y-1 text-slate-300">
              {(STEPS[form.provider] || []).map(s => <li key={s}>{s}</li>)}
            </ol>
            {provider?.tokenUrl && (
              <a href={provider.tokenUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-cyan-400 hover:underline">
                Open {provider.label} API tokens <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
          <div className="space-y-3">
            <label className="block">
              <span className="text-slate-400 block mb-1">{provider?.label || 'Provider'} API token</span>
              <input type="password" autoComplete="off" value={form.token} onChange={(e) => setForm(f => ({ ...f, token: e.target.value }))} placeholder="Paste token" className={input} />
            </label>
            <button onClick={connect} disabled={!!busy || !form.token.trim()} className={`${btn} w-full bg-gradient-to-r from-violet-600 to-cyan-600 hover:from-violet-500 hover:to-cyan-500 text-onaccent`}>
              {busy === 'connect' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />} Connect {provider?.label}
            </button>
            <p className="text-slate-500">The token is checked against your account, kept on the panel only, and never shown again.</p>
          </div>
        </div>
      )}

      {conn?.connected && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {conn.zones.map(z => (
              <button key={z} onClick={() => { setDomain(z); setCheck(null) }} className="px-2.5 py-1 rounded-full bg-slate-950 border border-white/10 text-cyan-300 hover:border-cyan-500/40 cursor-pointer">{z}</button>
            ))}
          </div>

          <div className="pt-3 border-t border-white/5 space-y-2">
            <span className="text-slate-400 block">Point a domain or subdomain at {activeServer?.name || 'this server'}</span>
            <div className="flex flex-col sm:flex-row gap-2">
              <input value={domain} onChange={(e) => { setDomain(e.target.value); setCheck(null) }} placeholder={`shop.${conn.zones[0] || 'example.com'}`} className={input} />
              <button onClick={doCheck} disabled={!!busy || !cleanDomain} className={`${btn} bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10 shrink-0`}>
                {busy === 'check' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Check'}
              </button>
            </div>

            {check?.check && (
              <div className={`p-3 rounded-xl border space-y-2 ${check.check.status === 'taken' ? 'bg-amber-950/40 border-amber-500/30 text-amber-200' : 'bg-slate-950 border-white/10 text-slate-300'}`}>
                <div className="flex items-start gap-2">
                  {check.check.status === 'taken' ? <AlertTriangle className="w-4 h-4 shrink-0" /> : <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />}
                  <span>{check.check.detail}{check.ip && check.check.status !== 'here' ? ` This server is ${check.ip}.` : ''}</span>
                </div>
                {check.check.status === 'taken' && (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Replace its current record and point it here
                  </label>
                )}
                {check.check.status !== 'here' && (
                  <button onClick={point} disabled={!!busy || (check.check.status === 'taken' && !replace)} className={`${btn} bg-gradient-to-r from-violet-600 to-cyan-600 hover:from-violet-500 hover:to-cyan-500 text-onaccent`}>
                    {busy === 'point' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />} Point {cleanDomain} here
                  </button>
                )}
              </div>
            )}
            <p className="text-slate-500">Deploying a new app? The deploy wizard does this for you — then issue SSL below once it resolves.</p>
          </div>
        </>
      )}

      {notice && (
        <div className={`p-3 rounded-xl border ${notice.type === 'success' ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300' : 'bg-rose-950/60 border-rose-500/40 text-rose-300'}`}>{notice.message}</div>
      )}
    </div>
  )
}
