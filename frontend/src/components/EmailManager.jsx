import React, { useState, useEffect } from 'react'
import {
  Mail, Globe, ShieldCheck, Key, Plus, Trash2, Copy, Check,
  RefreshCw, Server, ExternalLink, HardDrive, CheckCircle2, Lock, Eye, EyeOff, Info, HelpCircle,
  X, Send, SendHorizontal, Inbox, FileText, User, Paperclip, CheckCheck, Clock
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

  // Webmail Inbox Client State
  const [selectedMailbox, setSelectedMailbox] = useState('')
  const [activeFolder, setActiveFolder] = useState('inbox')
  const [messages, setMessages] = useState([])
  const [selectedMessage, setSelectedMessage] = useState(null)
  const [loadingMessages, setLoadingMessages] = useState(false)

  // Webmail Compose Modal State
  const [showComposeModal, setShowComposeModal] = useState(false)
  const [composeForm, setComposeForm] = useState({
    from: '',
    to: '',
    subject: '',
    body: ''
  })
  const [sendingEmail, setSendingEmail] = useState(false)

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
        if (accData.accounts.length > 0 && !selectedMailbox) {
          setSelectedMailbox(accData.accounts[0].email)
        }
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

  // Fetch Webmail Messages when selectedMailbox or activeFolder changes
  useEffect(() => {
    if (selectedMailbox) {
      fetchMessages(selectedMailbox, activeFolder)
    }
  }, [selectedMailbox, activeFolder, jwtToken])

  const fetchMessages = async (mailbox, folder) => {
    setLoadingMessages(true)
    try {
      const res = await fetch(`/api/studio/email/messages?mailbox=${encodeURIComponent(mailbox)}&folder=${folder}`, {
        headers: { 'Authorization': `Bearer ${jwtToken}` }
      })
      const data = await res.json()
      if (data.success && data.messages) {
        setMessages(data.messages)
        if (data.messages.length > 0 && !selectedMessage) {
          setSelectedMessage(data.messages[0])
        } else if (data.messages.length === 0) {
          setSelectedMessage(null)
        }
      }
    } catch (err) {
      console.error('Failed to fetch email messages:', err)
    } finally {
      setLoadingMessages(false)
    }
  }

  const handleSelectMessage = async (msg) => {
    setSelectedMessage(msg)
    if (!msg.read) {
      msg.read = true
      try {
        await fetch('/api/studio/email/read-mark', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${jwtToken}`
          },
          body: JSON.stringify({ messageId: msg.id })
        })
      } catch (err) {
        console.error('Failed to mark read:', err)
      }
    }
  }

  const handleSendEmail = async (e) => {
    e.preventDefault()
    if (!composeForm.from || !composeForm.to) {
      alert('Please select sender mailbox and specify recipient email address.')
      return
    }

    setSendingEmail(true)
    try {
      const res = await fetch('/api/studio/email/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify(composeForm)
      })

      const data = await res.json()
      if (data.success) {
        alert(`📧 ${data.message}`)
        setShowComposeModal(false)
        setComposeForm({ from: selectedMailbox || accounts[0]?.email || '', to: '', subject: '', body: '' })
        // Refresh inbox/sent folder
        fetchMessages(selectedMailbox, activeFolder)
      } else {
        alert(`Send Error: ${data.error}`)
      }
    } catch (err) {
      alert(`Send Failed: ${err.message}`)
    } finally {
      setSendingEmail(false)
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
        if (selectedMailbox === emailAddress) {
          setSelectedMailbox('')
        }
        fetchEmailData()
      } else {
        alert(`Delete Error: ${data.error}`)
      }
    } catch (err) {
      alert(`Delete Failed: ${err.message}`)
    }
  }

  const unreadCount = messages.filter((m) => !m.read && m.folder === 'inbox').length

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
                          className="p-1 text-slate-400 hover:text-cyan-300 transition cursor-pointer"
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
                        onClick={() => {
                          setSelectedMailbox(acc.email)
                          document.getElementById('webmail-client-section')?.scrollIntoView({ behavior: 'smooth' })
                        }}
                        className="px-3 py-1.5 bg-cyan-950/80 hover:bg-cyan-900 text-cyan-300 border border-cyan-800/80 rounded-xl text-[11px] transition cursor-pointer font-bold inline-flex items-center gap-1 shadow-sm"
                        title="Open Webmail Inbox for this address"
                      >
                        <Inbox className="w-3.5 h-3.5 text-cyan-400" />
                        <span>Open Inbox</span>
                      </button>

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

      {/* EMBEDDED GMAIL-STYLE WEBMAIL CLIENT & INBOX CONSOLE */}
      <div id="webmail-client-section" className="bg-slate-900/90 border border-cyan-500/30 rounded-3xl overflow-hidden shadow-2xl space-y-0">
        {/* Webmail Top Toolbar */}
        <div className="p-4 bg-slate-950 border-b border-white/10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-white text-base tracking-tight flex items-center gap-2">
                Interactive Webmail Console
                {unreadCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] bg-rose-500 text-white font-mono font-bold animate-pulse">
                    {unreadCount} Unread
                  </span>
                )}
              </h3>
              <p className="text-xs text-slate-400 font-mono">Send & receive emails live from your custom server mailboxes</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Mailbox Picker */}
            <div className="flex items-center space-x-2">
              <label className="text-[10px] font-mono text-slate-400 font-bold uppercase">Select Mailbox:</label>
              <select
                value={selectedMailbox}
                onChange={(e) => setSelectedMailbox(e.target.value)}
                className="bg-slate-900 border border-cyan-500/40 rounded-xl px-3 py-1.5 text-xs font-mono text-cyan-300 font-bold focus:outline-none focus:border-cyan-400"
              >
                {accounts.length === 0 ? (
                  <option value="">No mailboxes created</option>
                ) : (
                  accounts.map((acc) => (
                    <option key={acc.id} value={acc.email}>
                      {acc.email}
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* Refresh Messages */}
            <button
              onClick={() => selectedMailbox && fetchMessages(selectedMailbox, activeFolder)}
              className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition cursor-pointer text-xs font-mono"
              title="Refresh Messages"
            >
              <RefreshCw className={`w-4 h-4 ${loadingMessages ? 'animate-spin' : ''}`} />
            </button>

            {/* Compose Button */}
            <button
              onClick={() => {
                setComposeForm({
                  from: selectedMailbox || accounts[0]?.email || '',
                  to: '',
                  subject: '',
                  body: ''
                })
                setShowComposeModal(true)
              }}
              className="px-4 py-2 bg-gradient-to-r from-emerald-500 via-teal-600 to-cyan-600 hover:from-emerald-400 hover:to-cyan-500 text-white font-extrabold rounded-xl transition cursor-pointer text-xs flex items-center gap-1.5 shadow-lg shadow-emerald-950/40"
            >
              <SendHorizontal className="w-4 h-4" />
              <span>Compose Email</span>
            </button>
          </div>
        </div>

        {/* Webmail Body: Left Sidebar + Mail List + Message Reader */}
        <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[480px]">
          {/* Left Folder Nav */}
          <div className="lg:col-span-3 bg-slate-950/60 border-r border-white/10 p-4 space-y-4 font-mono text-xs">
            <div className="space-y-1">
              <button
                onClick={() => {
                  setActiveFolder('inbox')
                  setSelectedMessage(null)
                }}
                className={`w-full text-left px-3.5 py-2.5 rounded-xl font-bold transition flex items-center justify-between ${
                  activeFolder === 'inbox'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                    : 'text-slate-400 hover:bg-slate-800/60 hover:text-white'
                }`}
              >
                <div className="flex items-center space-x-2.5">
                  <Inbox className="w-4 h-4" />
                  <span>Inbox</span>
                </div>
                {unreadCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-cyan-950 border border-cyan-800 text-cyan-300 text-[10px] font-bold">
                    {unreadCount}
                  </span>
                )}
              </button>

              <button
                onClick={() => {
                  setActiveFolder('sent')
                  setSelectedMessage(null)
                }}
                className={`w-full text-left px-3.5 py-2.5 rounded-xl font-bold transition flex items-center justify-between ${
                  activeFolder === 'sent'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                    : 'text-slate-400 hover:bg-slate-800/60 hover:text-white'
                }`}
              >
                <div className="flex items-center space-x-2.5">
                  <Send className="w-4 h-4" />
                  <span>Sent Items</span>
                </div>
              </button>
            </div>

            <div className="pt-4 border-t border-white/10 text-[11px] text-slate-500 space-y-2">
              <div className="font-bold text-slate-400 uppercase tracking-wider text-[9px]">Mailbox Telemetry</div>
              <div>Connected: <span className="text-emerald-400 font-bold">{selectedMailbox || 'None'}</span></div>
              <div>Folder: <span className="text-cyan-300 font-bold">{activeFolder.toUpperCase()}</span></div>
              <div>Messages Total: <span className="text-white font-bold">{messages.length}</span></div>
            </div>
          </div>

          {/* Middle: Mail List */}
          <div className="lg:col-span-4 border-r border-white/10 bg-slate-900/50 overflow-y-auto max-h-[520px]">
            {loadingMessages ? (
              <div className="p-8 text-center text-slate-400 font-mono text-xs flex flex-col items-center gap-2">
                <RefreshCw className="w-5 h-5 animate-spin text-cyan-400" />
                <span>Loading messages...</span>
              </div>
            ) : messages.length === 0 ? (
              <div className="p-8 text-center text-slate-500 font-mono text-xs space-y-2">
                <Inbox className="w-8 h-8 text-slate-600 mx-auto" />
                <div>No messages in <strong className="text-slate-400">{activeFolder}</strong></div>
                <div className="text-[10px] text-slate-600">Click "Compose Email" to send out your first message!</div>
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                {messages.map((msg) => {
                  const isSelected = selectedMessage?.id === msg.id
                  return (
                    <div
                      key={msg.id}
                      onClick={() => handleSelectMessage(msg)}
                      className={`p-3.5 transition cursor-pointer ${
                        isSelected
                          ? 'bg-cyan-950/70 border-l-4 border-cyan-400'
                          : msg.read
                          ? 'hover:bg-slate-800/40 opacity-85'
                          : 'bg-slate-800/80 hover:bg-slate-800 font-semibold'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[11px] font-mono mb-1">
                        <span className={`truncate max-w-[170px] ${!msg.read ? 'text-white font-extrabold' : 'text-slate-300'}`}>
                          {activeFolder === 'inbox' ? `From: ${msg.from}` : `To: ${msg.to}`}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>

                      <div className="text-xs font-bold text-cyan-200 truncate">{msg.subject}</div>

                      <div className="text-[11px] text-slate-400 truncate mt-1 line-clamp-1 font-sans">
                        {msg.body}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Right: Selected Message Content Reader */}
          <div className="lg:col-span-5 bg-slate-950/90 p-5 overflow-y-auto max-h-[520px]">
            {selectedMessage ? (
              <div className="space-y-4">
                <div className="border-b border-white/10 pb-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="text-base font-extrabold text-white tracking-tight">{selectedMessage.subject}</h4>
                    <span className="text-[10px] font-mono text-slate-400 bg-slate-900 border border-white/10 px-2 py-1 rounded-lg">
                      {new Date(selectedMessage.timestamp).toLocaleString()}
                    </span>
                  </div>

                  <div className="text-xs font-mono space-y-1 text-slate-300">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500 uppercase text-[10px] font-bold w-10">From:</span>
                      <span className="text-cyan-300 font-bold bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800">{selectedMessage.from}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500 uppercase text-[10px] font-bold w-10">To:</span>
                      <span className="text-slate-200 bg-slate-900 px-2 py-0.5 rounded border border-white/10">{selectedMessage.to}</span>
                    </div>
                  </div>
                </div>

                <div className="text-xs text-slate-200 whitespace-pre-wrap leading-relaxed font-sans bg-slate-900/60 p-4 rounded-2xl border border-white/5">
                  {selectedMessage.body}
                </div>

                <div className="pt-4 border-t border-white/10 flex items-center justify-between font-mono text-xs">
                  <span className="text-slate-500 text-[10px]">Message ID: {selectedMessage.id}</span>
                  <button
                    onClick={() => {
                      setComposeForm({
                        from: selectedMessage.to || selectedMailbox,
                        to: selectedMessage.from,
                        subject: `Re: ${selectedMessage.subject}`,
                        body: `\n\n--- Original Message ---\nFrom: ${selectedMessage.from}\nDate: ${selectedMessage.timestamp}\nSubject: ${selectedMessage.subject}\n\n${selectedMessage.body}`
                      })
                      setShowComposeModal(true)
                    }}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 rounded-xl transition text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Reply to Message</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center p-8 text-slate-500 space-y-3 min-h-[300px]">
                <FileText className="w-10 h-10 text-slate-600" />
                <div className="font-mono text-xs">Select an email message from the list to view full content</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* COMPOSE EMAIL MODAL */}
      {showComposeModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-emerald-500/40 rounded-3xl max-w-xl w-full p-6 space-y-5 shadow-2xl shadow-emerald-950/50 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 rounded-2xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                  <SendHorizontal className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-extrabold text-white text-base">Compose Professional Email</h3>
                  <p className="text-xs text-slate-400 font-mono">Send email from your custom domain mailbox</p>
                </div>
              </div>
              <button
                onClick={() => setShowComposeModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSendEmail} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">From Mailbox</label>
                <select
                  value={composeForm.from}
                  onChange={(e) => setComposeForm({ ...composeForm, from: e.target.value })}
                  className="w-full bg-slate-950 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-emerald-400"
                >
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.email}>{acc.email}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">Recipient Email (To)</label>
                <input
                  type="email"
                  value={composeForm.to}
                  onChange={(e) => setComposeForm({ ...composeForm, to: e.target.value })}
                  placeholder="recipient@domain.com"
                  required
                  className="w-full bg-slate-950 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-emerald-400"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">Subject Line</label>
                <input
                  type="text"
                  value={composeForm.subject}
                  onChange={(e) => setComposeForm({ ...composeForm, subject: e.target.value })}
                  placeholder="Enter email subject"
                  required
                  className="w-full bg-slate-950 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-emerald-400"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">Email Body</label>
                <textarea
                  rows={6}
                  value={composeForm.body}
                  onChange={(e) => setComposeForm({ ...composeForm, body: e.target.value })}
                  placeholder="Write your email message here..."
                  required
                  className="w-full bg-slate-950 border border-white/10 rounded-xl p-3.5 text-xs text-white font-sans focus:outline-none focus:border-emerald-400 leading-relaxed"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowComposeModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={sendingEmail}
                  className="px-5 py-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 font-extrabold rounded-xl text-xs flex items-center gap-1.5 transition shadow-lg shadow-emerald-950/40 disabled:opacity-50"
                >
                  {sendingEmail ? <RefreshCw className="w-3.5 h-3.5 animate-spin text-slate-950" /> : <SendHorizontal className="w-3.5 h-3.5" />}
                  <span>{sendingEmail ? 'Sending...' : 'Send Email Now'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CREATE PROFESSIONAL EMAIL ACCOUNT MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-cyan-500/40 rounded-3xl max-w-lg w-full p-6 space-y-5 shadow-2xl shadow-cyan-950/50 animate-in zoom-in-95 duration-200">
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

              {newEmailForm.username && (
                <div className="bg-slate-950 p-3 rounded-xl border border-cyan-500/30 text-xs font-mono text-cyan-300 flex items-center justify-between">
                  <span>Full Email: <strong className="text-white font-bold">{newEmailForm.username}@{newEmailForm.domain}</strong></span>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                </div>
              )}

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

      {/* SMTP / IMAP CLIENT CONNECTION GUIDE MODAL */}
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

              <div className="bg-slate-950 p-4 rounded-2xl border border-emerald-500/30 space-y-2">
                <div className="font-bold text-emerald-300 flex items-center justify-between">
                  <span>🌐 DNS Records for Google, Yahoo & External Email Deliverability</span>
                  <span className="text-[10px] bg-emerald-950 text-emerald-400 px-2 py-0.5 rounded border border-emerald-800 font-bold">REQUIRED FOR INTERNET MAIL</span>
                </div>
                <div className="text-[11px] text-slate-300 space-y-1 pt-1">
                  <div>1. <strong>MX Record:</strong> Type: <code className="text-cyan-300">MX</code> | Host: <code className="text-cyan-300">@</code> | Points to: <code className="text-cyan-300">187.127.165.128</code> (Priority 10)</div>
                  <div>2. <strong>SPF Record:</strong> Type: <code className="text-cyan-300">TXT</code> | Host: <code className="text-cyan-300">@</code> | Value: <code className="text-emerald-300">v=spf1 ip4:187.127.165.128 ~all</code></div>
                  <div>3. <strong>DMARC Record:</strong> Type: <code className="text-cyan-300">TXT</code> | Host: <code className="text-cyan-300">_dmarc</code> | Value: <code className="text-indigo-300">v=DMARC1; p=none; sp=none</code></div>
                </div>
              </div>

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
