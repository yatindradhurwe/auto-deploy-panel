import React, { useState, useEffect } from 'react'
import {
  Globe, ShieldCheck, Lock, RefreshCw, Plus, CheckCircle2,
  AlertTriangle, Server, Code, Zap, ExternalLink, Sliders
} from 'lucide-react'

export default function DomainSSLManager({ jwtToken }) {
  const [certificates, setCertificates] = useState([])
  const [loading, setLoading] = useState(true)

  // SSL Request Form State
  const [newDomain, setNewDomain] = useState('')
  const [email, setEmail] = useState('admin@yjtechnosoft.com')
  const [issuing, setIssuing] = useState(false)
  const [issueResult, setIssueResult] = useState(null)

  // Nginx Configurator State
  const [configDomain, setConfigDomain] = useState('automate-deployment.yjtechnosoft.com')
  const [proxyPort, setProxyPort] = useState('4040')
  const [savingNginx, setSavingNginx] = useState(false)
  const [nginxResult, setNginxResult] = useState(null)

  const fetchCertificates = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/studio/ssl/certificates', {
        headers: { 'Authorization': jwtToken ? `Bearer ${jwtToken}` : '' }
      })
      const data = await res.json()
      if (data.success && data.certificates) {
        setCertificates(data.certificates)
      }
    } catch (e) {
      console.error('Failed to fetch certificates:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchCertificates()
  }, [jwtToken])

  const handleIssueSsl = async (e) => {
    e.preventDefault()
    if (!newDomain) return
    setIssuing(true)
    setIssueResult(null)
    try {
      const res = await fetch('/api/studio/ssl/issue', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': jwtToken ? `Bearer ${jwtToken}` : ''
        },
        body: JSON.stringify({ domain: newDomain, email })
      })
      const data = await res.json()
      if (data.success) {
        setIssueResult({ type: 'success', message: data.message })
        setNewDomain('')
        await fetchCertificates()
      } else {
        setIssueResult({ type: 'error', message: data.error })
      }
    } catch (err) {
      setIssueResult({ type: 'error', message: err.message })
    } finally {
      setIssuing(false)
    }
  }

  const handleSaveNginx = async (e) => {
    e.preventDefault()
    if (!configDomain || !proxyPort) return
    setSavingNginx(true)
    setNginxResult(null)
    try {
      const res = await fetch('/api/studio/nginx/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': jwtToken ? `Bearer ${jwtToken}` : ''
        },
        body: JSON.stringify({ domain: configDomain, proxyPort })
      })
      const data = await res.json()
      if (data.success) {
        setNginxResult({ type: 'success', message: data.message, config: data.config })
      } else {
        setNginxResult({ type: 'error', message: data.error })
      }
    } catch (err) {
      setNginxResult({ type: 'error', message: err.message })
    } finally {
      setSavingNginx(false)
    }
  }

  return (
    <div className="space-y-6 text-slate-100 font-sans">
      {/* Top Header */}
      <div className="bg-slate-900/80 border border-white/10 backdrop-blur-2xl rounded-3xl p-6 shadow-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-2xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-inner">
              <Globe className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-black text-white tracking-tight flex items-center gap-2">
                Domain Routing & Let's Encrypt SSL Manager
                <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2.5 py-0.5 rounded-full font-mono font-bold">HTTPS ENCRYPTION</span>
              </h2>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                Issue automatic free SSL certificates and configure Nginx reverse proxy routing rules.
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={fetchCertificates}
          className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10 px-4 py-2 rounded-xl font-mono flex items-center space-x-2 transition cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Sync Certbot</span>
        </button>
      </div>

      {/* SSL Certificates List */}
      <div className="bg-slate-900/80 border border-white/10 rounded-3xl p-6 shadow-2xl space-y-4">
        <h3 className="text-sm font-bold text-white flex items-center gap-2 font-mono">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          Active Server SSL Certificates ({certificates.length})
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {certificates.map((cert) => (
            <div
              key={cert.id}
              className="bg-slate-950/80 border border-white/10 rounded-2xl p-4 space-y-3 relative overflow-hidden"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Lock className="w-4 h-4 text-emerald-400" />
                  <span className="font-bold text-xs text-white font-mono truncate">{cert.name}</span>
                </div>
                <span className="text-[9px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full font-mono font-semibold">
                  HTTPS SECURE
                </span>
              </div>

              <div className="text-[11px] font-mono text-slate-400 space-y-1">
                <div>Domains: <span className="text-cyan-300">{cert.domains}</span></div>
                <div>Expiry: <span className="text-slate-300">{cert.expiry}</span></div>
              </div>

              <div className="pt-2 border-t border-white/5 flex items-center justify-between">
                <span className="text-[10px] text-slate-500 font-mono">Issuer: Let's Encrypt</span>
                <a
                  href={`https://${cert.domains}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] text-cyan-400 hover:underline flex items-center gap-1 font-mono"
                >
                  Visit Domain <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Grid: 1-Click SSL Issuer & Nginx Configurator */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* SSL Issue Form */}
        <div className="bg-slate-900/80 border border-white/10 rounded-3xl p-6 shadow-2xl space-y-4">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">Issue New SSL Certificate</h3>
              <p className="text-xs text-slate-400 font-mono">Certbot automated Let's Encrypt challenge</p>
            </div>
          </div>

          <form onSubmit={handleIssueSsl} className="space-y-3 font-mono text-xs">
            <div>
              <label className="text-slate-400 block mb-1">Target Domain Name</label>
              <input
                type="text"
                placeholder="e.g. app.mycompany.com"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                className="w-full bg-slate-950 border border-white/10 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-cyan-500/50"
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1">Admin Email (Expiration alerts)</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-slate-950 border border-white/10 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-cyan-500/50"
              />
            </div>

            <button
              type="submit"
              disabled={issuing || !newDomain}
              className="w-full bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white font-bold py-2.5 rounded-xl shadow-lg transition flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-50"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>{issuing ? 'Executing Certbot...' : 'Issue Free SSL Certificate'}</span>
            </button>
          </form>

          {issueResult && (
            <div className={`p-3.5 rounded-xl text-xs font-mono border ${
              issueResult.type === 'success' ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300' : 'bg-rose-950/60 border-rose-500/40 text-rose-300'
            }`}>
              {issueResult.message}
            </div>
          )}
        </div>

        {/* Nginx Reverse Proxy Configurator */}
        <div className="bg-slate-900/80 border border-white/10 rounded-3xl p-6 shadow-2xl space-y-4">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-blue-500/10 text-blue-400">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">Nginx Reverse Proxy Configurator</h3>
              <p className="text-xs text-slate-400 font-mono">Map domain name to local backend port</p>
            </div>
          </div>

          <form onSubmit={handleSaveNginx} className="space-y-3 font-mono text-xs">
            <div>
              <label className="text-slate-400 block mb-1">Public Domain Name</label>
              <input
                type="text"
                value={configDomain}
                onChange={(e) => setConfigDomain(e.target.value)}
                className="w-full bg-slate-950 border border-white/10 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-cyan-500/50"
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1">Target Local Port (proxy_pass)</label>
              <input
                type="number"
                placeholder="4040"
                value={proxyPort}
                onChange={(e) => setProxyPort(e.target.value)}
                className="w-full bg-slate-950 border border-white/10 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-cyan-500/50"
              />
            </div>

            <button
              type="submit"
              disabled={savingNginx || !configDomain || !proxyPort}
              className="w-full bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white font-bold py-2.5 rounded-xl shadow-lg transition flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-50"
            >
              <Zap className="w-4 h-4" />
              <span>{savingNginx ? 'Reloading Nginx...' : 'Generate & Activate Nginx Rule'}</span>
            </button>
          </form>

          {nginxResult && (
            <div className={`p-3.5 rounded-xl text-xs font-mono border ${
              nginxResult.type === 'success' ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300' : 'bg-rose-950/60 border-rose-500/40 text-rose-300'
            }`}>
              <div>{nginxResult.message}</div>
              {nginxResult.config && (
                <pre className="mt-2 text-[10px] bg-slate-950 p-2 rounded border border-white/5 overflow-x-auto text-slate-300">
                  {nginxResult.config}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
