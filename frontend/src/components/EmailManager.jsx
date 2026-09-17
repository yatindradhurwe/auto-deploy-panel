import React, { useState, useEffect } from 'react'
import {
  Mail, Globe, ShieldCheck, Key, Plus, Trash2, Copy, Check,
  RefreshCw, Server, ExternalLink, HardDrive, CheckCircle2, Lock, Eye, EyeOff, Info, HelpCircle
} from 'lucide-react'

export default function EmailManager({ jwtToken, activeServer }) {
  const [domains, setDomains] = useState([])
  const [accounts, setAccounts] = useState([])
  const [clientConfig, setClientConfig] = useState(null)
  const [loading, setLoading] = useState(true)

  // Create Email Modal State
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newEmailForm, setNewEmailForm] = useState({
    username: '',
    domain: '',
    password: '',
    quotaMb: 2000
  })
  const [showPassword, setShowPassword] = useState(false)
  const [creating, setCreating] = useState(false)
  const [copiedAccountEmail, setCopiedAccountEmail] = useState(null)

  // Setup Guide Modal State
  const [showGuideModal, setShowGuideModal] = useState(false)

  useEffect(() => {
    fetchEmailData()
  }, [jwtToken])

  const fetchEmailData = async () => {
    setLoading(true)
    try {
      const [domRes, accRes, cfgRes] = await Promise.all([
        fetch('/api/studio/email/domains', { headers: { 'Authorization': `Bearer ${jwtToken}` } }),
        fetch('/api/studio/email/accounts', { headers: { 'Authorization': `Bearer ${jwtToken}` } }),
        fetch('/api/studio/email/client-config', { headers: { 'Authorization': `Bearer ${jwtToken}` } })
      ])

      const domData = await domRes.json()
      const accData = await accRes.json()
      const cfgData = await cfgRes.json()

      if (domData.success && domData.domains) {
        setDomains(domData.domains)
        if (domData.domains.length > 0 && !newEmailForm.domain) {
          setNewEmailForm((prev) => ({ ...prev, domain: domData.domains[0].name }))
        }
      }
      if (accData.success && accData.accounts) {
        setAccounts(accData.accounts)
      }
      if (cfgData.success && cfgData.settings) {
        setClientConfig(cfgData.settings)
      }
    } catch (e) {
      console.error('Failed to load email panel data:', e)
    } finally {
      setLoading(false)
    }
  }

  const handleGeneratePassword = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*'
    let pass = ''
    for (let i = 0; i < 14; i++) {
      pass += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    setNewEmailForm((prev) => ({ ...prev, password: pass }))
  }

  const handleCreateEmail = async (e) => {
    e.preventDefault()
    if (!newEmailForm.username || !newEmailForm.domain) {
      alert('Please fill in email username and select a domain.')
      return
    }

    setCreating(true)
    try {
      const res = await fetch('/api/studio/email/accounts/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify(newEmailForm)
      })

      const data = await res.json()
      if (data.success) {
        alert(`🎉 ${data.message}`)
        setShowCreateModal(false)
        setNewEmailForm({ username: '', domain: domains[0]?.name || '', password: '', quotaMb: 2000 })
        fetchEmailData()
      } else {
        alert(`Create Error: ${data.error}`)
      }
    } catch (err) {
      alert(`Request Failed: ${err.message}`)
    } finally {
      setCreating(false)
    }
  }

  const handleDeleteEmail = async (emailId, emailAddress) => {
    if (!window.confirm(`Are you sure you want to delete mailbox '${emailAddress}'?`)) return
    try {
      const res = await fetch('/api/studio/email/accounts/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify({ emailId })
      })
      const data = await res.json()
      if (data.success) {
        fetchEmailData()
      } else {
        alert(`Delete Error: ${data.error}`)
      }
    } catch (err) {
      alert(`Delete Failed: ${err.message}`)
    }
  }

  return (
    <div className="space-y-6 text-slate-100 font-sans">
      {/* Header Banner - Mail Server Telemetry */}
      <div className="bg-slate-900/80 border border-white/10 backdrop-blur-2xl rounded-3xl p-6 shadow-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center space-x-4">
          <div className="p-3.5 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 ring-1 ring-cyan-500/20 shadow-md">
            <Mail className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-extrabold text-white tracking-tight flex items-center gap-2.5">
              Domain Email & Professional Mailbox Panel
              <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-cyan-950/90 border border-cyan-800 text-cyan-300 font-mono font-bold">
                Postfix + Dovecot Engine
              </span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5 font-mono">
              Server Host: <span className="text-cyan-300 font-bold">{activeServer ? activeServer.host : '187.127.165.128'}</span> ({domains.length} Registered Server Domains · {accounts.length} Professional Mailboxes)
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={() => setShowGuideModal(true)}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10 rounded-2xl transition cursor-pointer text-xs font-semibold flex items-center gap-2 shadow-sm"
          >
            <HelpCircle className="w-4 h-4 text-cyan-400" />
            <span>SMTP / IMAP Settings</span>
          </button>

          <button
            onClick={() => {
              setShowCreateModal(true)
              if (!newEmailForm.password) handleGeneratePassword()
            }}
            className="px-5 py-2 bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-extrabold rounded-2xl transition cursor-pointer text-xs flex items-center gap-2 shadow-lg shadow-cyan-950/50"
          >
            <Plus className="w-4 h-4" />
            <span>Create Professional Email</span>
          </button>
        </div>
      </div>

      {/* Grid: Registered Server Domains Cards */}
      <div className="bg-slate-900/80 border border-white/10 rounded-3xl p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <h3 className="text-sm font-bold text-white font-mono flex items-center gap-2">
            <Globe className="w-4 h-4 text-cyan-400" />
            Registered Domains Available for Custom Email Mailboxes ({domains.length})
          </h3>
          <span className="text-[11px] text-slate-400 font-mono">SSL Certbot Enabled</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {domains.map((dom) => (
            <div
              key={dom.name}
              className="bg-slate-950/80 border border-white/10 hover:border-cyan-500/40 rounded-2xl p-4 space-y-3 transition group relative"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span className="font-extrabold text-xs text-white font-mono truncate">{dom.name}</span>
                </div>
                <span className="text-[9px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full font-mono font-bold">
                  SSL ACTIVE
                </span>
              </div>

              <div className="text-[11px] text-slate-400 font-mono">
                Mail Node: <span className="text-cyan-300">{dom.mailServer}</span>
              </div>

              <button
                onClick={() => {
                  setNewEmailForm((prev) => ({ ...prev, domain: dom.name }))
                  setShowCreateModal(true)
                  if (!newEmailForm.password) handleGeneratePassword()
                }}
                className="w-full py-1.5 bg-slate-900 hover:bg-cyan-600/20 text-cyan-300 border border-white/10 hover:border-cyan-500/40 rounded-xl text-xs font-mono font-semibold transition cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Email on {dom.name}</span>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Active Mailboxes Table */}
      <div className="bg-slate-900/80 border border-white/10 rounded-3xl overflow-hidden shadow-2xl">
        <div className="p-4 border-b border-white/10 bg-slate-950/90 flex items-center justify-between text-xs">
          <div className="flex items-center space-x-2">
            <Mail className="w-4 h-4 text-cyan-400" />
            <span className="font-extrabold text-white tracking-wider uppercase font-mono">Active Domain Professional Mailboxes ({accounts.length})</span>
          </div>

          <button
            onClick={fetchEmailData}
            className="text-slate-400 hover:text-white transition flex items-center gap-1 font-mono text-[11px]"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh List</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950/80 text-slate-400 font-mono border-b border-white/10 uppercase text-[10px] tracking-wider font-bold">
              <tr>
                <th className="py-3.5 px-5">Professional Email Address</th>
                <th className="py-3.5 px-5">Domain</th>
                <th className="py-3.5 px-5">Storage Quota</th>
                <th className="py-3.5 px-5">Mail Server Status</th>
                <th className="py-3.5 px-5">Created Date</th>
                <th className="py-3.5 px-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 font-mono">
              {accounts.length === 0 ? (
                <tr>
                  <td colSpan="6" className="py-8 text-center text-slate-500">
                    No custom domain email mailboxes created yet. Click <strong className="text-cyan-400 font-bold">"Create Professional Email"</strong> above to add mailboxes.
                  </td>
                </tr>
              ) : (
                accounts.map((acc) => (
                  <tr key={acc.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-4 px-5">
                      <div className="font-extrabold text-white text-xs flex items-center space-x-2">
                        <span>{acc.email}</span>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(acc.email)
                            setCopiedAccountEmail(acc.email)
                            setTimeout(() => setCopiedAccountEmail(null), 2000)
                          }}
                          className="p-1 text-slate-400 hover:text-cyan-300 transition"
                          title="Copy Email Address"
                        >
                          {copiedAccountEmail === acc.email ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        </button>
                      </div>
                    </td>
                    <td className="py-4 px-5 text-cyan-300 font-bold">{acc.domain}</td>
                    <td className="py-4 px-5 text-slate-300">
                      <span>{acc.usedMb || 0} MB / </span>
                      <span className="font-bold text-cyan-400">{acc.quotaMb >= 999999 ? 'Unlimited' : `${acc.quotaMb} MB`}</span>
                    </td>
                    <td className="py-4 px-5">
                      <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-800/80 inline-flex items-center gap-1.5 shadow-sm">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                        ACTIVE
                      </span>
                    </td>
                    <td className="py-4 px-5 text-slate-400 text-[11px]">
                      {new Date(acc.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-4 px-5 text-right space-x-2">
                      <button
                        onClick={() => setShowGuideModal(true)}
                        className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10 rounded-xl text-[11px] transition cursor-pointer font-bold inline-flex items-center gap-1 shadow-sm"
                        title="View Outlook / Apple Mail / SMTP Client connection settings"
                      >
                        <Key className="w-3.5 h-3.5 text-cyan-400" />
                        <span>Client Settings</span>
                      </button>

                      <button
                        onClick={() => handleDeleteEmail(acc.id, acc.email)}
                        className="px-3 py-1.5 bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 border border-rose-800/80 rounded-xl text-[11px] transition cursor-pointer font-bold inline-flex items-center gap-1 shadow-sm"
                        title="Delete mailbox"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                        <span>Delete</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Professional Email Account Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-cyan-500/40 rounded-3xl max-w-lg w-full p-6 space-y-5 shadow-2xl shadow-cyan-950/50 animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 rounded-2xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
                  <Mail className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-extrabold text-white text-base">Create Professional Domain Email</h3>
                  <p className="text-xs text-slate-400 font-mono">Provision a custom mailbox on your live server</p>
                </div>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateEmail} className="space-y-4">
              {/* Select Registered Domain */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">Target Registered Domain</label>
                <select
                  value={newEmailForm.domain}
                  onChange={(e) => setNewEmailForm({ ...newEmailForm, domain: e.target.value })}
                  className="w-full bg-slate-950 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-cyan-400"
                >
                  {domains.map((d) => (
                    <option key={d.name} value={d.name}>{d.name}</option>
                  ))}
                </select>
              </div>

              {/* Email Username & Preview */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">Email Username Prefix</label>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    value={newEmailForm.username}
                    onChange={(e) => setNewEmailForm({ ...newEmailForm, username: e.target.value })}
                    placeholder="e.g. admin, support, info, sales"
                    className="flex-1 bg-slate-950 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-cyan-400"
                  />
                  <span className="text-xs font-mono text-cyan-300 font-bold">@{newEmailForm.domain || 'domain.com'}</span>
                </div>
              </div>

              {/* Generated Email Address Card */}
              {newEmailForm.username && (
                <div className="bg-slate-950 p-3 rounded-xl border border-cyan-500/30 text-xs font-mono text-cyan-300 flex items-center justify-between">
                  <span>Full Email: <strong className="text-white font-bold">{newEmailForm.username}@{newEmailForm.domain}</strong></span>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                </div>
              )}

              {/* Password & Generator */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">Mailbox Password</label>
                  <button
                    type="button"
                    onClick={handleGeneratePassword}
                    className="text-[10px] text-cyan-400 hover:underline font-mono"
                  >
                    ⚡ Generate Strong Password
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={newEmailForm.password}
                    onChange={(e) => setNewEmailForm({ ...newEmailForm, password: e.target.value })}
                    placeholder="Enter secure password"
                    className="w-full bg-slate-950 border border-white/10 rounded-xl px-3.5 py-2.5 pr-10 text-xs text-white font-mono focus:outline-none focus:border-cyan-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-white"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Mailbox Quota */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">Storage Quota</label>
                <select
                  value={newEmailForm.quotaMb}
                  onChange={(e) => setNewEmailForm({ ...newEmailForm, quotaMb: Number(e.target.value) })}
                  className="w-full bg-slate-950 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-cyan-400"
                >
                  <option value={1000}>1 GB (1,000 MB)</option>
                  <option value={2000}>2 GB (2,000 MB)</option>
                  <option value={5000}>5 GB (5,000 MB)</option>
                  <option value={10000}>10 GB (10,000 MB)</option>
                  <option value={999999}>Unlimited Storage</option>
                </select>
              </div>

              {/* Modal Buttons */}
              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-5 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-extrabold rounded-xl text-xs flex items-center gap-1.5 transition shadow-lg shadow-cyan-950/40 disabled:opacity-50"
                >
                  {creating ? <RefreshCw className="w-3.5 h-3.5 animate-spin text-slate-950" /> : <Mail className="w-3.5 h-3.5" />}
                  <span>{creating ? 'Creating Mailbox...' : 'Create Email Mailbox'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SMTP / IMAP Client Connection Guide Modal */}
      {showGuideModal && clientConfig && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-xl w-full p-6 space-y-5 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 rounded-2xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/30">
                  <Key className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-extrabold text-white text-base">Client Mail Connection Settings</h3>
                  <p className="text-xs text-slate-400 font-mono">Use these parameters for Outlook, Apple Mail & Mobile</p>
                </div>
              </div>
              <button
                onClick={() => setShowGuideModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 font-mono text-xs">
              {/* Incoming Server */}
              <div className="bg-slate-950 p-4 rounded-2xl border border-white/10 space-y-2">
                <div className="font-bold text-cyan-300 flex items-center justify-between">
                  <span>📥 Incoming Mail Server (IMAP / POP3)</span>
                  <span className="text-[10px] bg-cyan-950 text-cyan-400 px-2 py-0.5 rounded border border-cyan-800 font-bold">SSL / TLS</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-300 pt-1">
                  <div>Server Host: <strong className="text-white">{clientConfig.incomingServer}</strong></div>
                  <div>IMAP Port: <strong className="text-cyan-400">{clientConfig.imapPort}</strong> (SSL)</div>
                  <div>POP3 Port: <strong className="text-cyan-400">{clientConfig.pop3Port}</strong> (SSL)</div>
                  <div>Authentication: <strong className="text-emerald-400">Password / Normal</strong></div>
                </div>
              </div>

              {/* Outgoing Server */}
              <div className="bg-slate-950 p-4 rounded-2xl border border-white/10 space-y-2">
                <div className="font-bold text-indigo-300 flex items-center justify-between">
                  <span>📤 Outgoing Mail Server (SMTP)</span>
                  <span className="text-[10px] bg-indigo-950 text-indigo-400 px-2 py-0.5 rounded border border-indigo-800 font-bold">SSL / STARTTLS</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-300 pt-1">
                  <div>Server Host: <strong className="text-white">{clientConfig.outgoingServer}</strong></div>
                  <div>SMTP Port: <strong className="text-indigo-400">{clientConfig.smtpPort}</strong> (STARTTLS / TLS)</div>
                  <div>Username: <strong className="text-slate-200">Your Full Email Address</strong></div>
                  <div>Password: <strong className="text-slate-200">Your Mailbox Password</strong></div>
                </div>
              </div>

              {/* Webmail Client Button */}
              <div className="pt-2 flex items-center justify-between">
                <a
                  href={clientConfig.webmailUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl font-bold flex items-center gap-1.5 transition text-xs shadow-md"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span>Open Webmail Login Interface</span>
                </a>

                <button
                  onClick={() => setShowGuideModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-semibold transition"
                >
                  Close Window
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
