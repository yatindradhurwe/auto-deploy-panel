import React, { useState, useEffect } from 'react'
import {
  Mail, Globe, Key, Plus, Trash2, Copy, Check, RefreshCw, Server, Eye, EyeOff, X, Send, Inbox,
  FileText, Paperclip, AlertTriangle, CheckCircle2, XCircle, ChevronLeft, ChevronRight, Reply,
  Activity, Settings, Lock, Search
} from 'lucide-react'

const FOLDERS = [
  { id: 'inbox', label: 'Inbox', icon: Inbox },
  { id: 'sent', label: 'Sent', icon: Send },
  { id: 'drafts', label: 'Drafts', icon: FileText },
  { id: 'junk', label: 'Junk', icon: AlertTriangle },
  { id: 'trash', label: 'Trash', icon: Trash2 }
]

const STATUS_COLORS = {
  sent: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
  deferred: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
  bounced: 'text-rose-300 bg-rose-500/10 border-rose-500/30'
}

const inputCls = 'w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-cyan-500/50'
const btnCls = 'px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition disabled:opacity-50 disabled:cursor-default'
const card = 'bg-slate-900/60 backdrop-blur-2xl border border-white/10 rounded-3xl shadow-2xl shadow-slate-950/50'

function formatSize(bytes) {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

function formatDate(iso) {
  const d = new Date(iso)
  const today = new Date()
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined })
}

const readFileBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
  reader.onerror = reject
  reader.readAsDataURL(file)
})

export default function EmailManager({ jwtToken, activeServer }) {
  const [tab, setTab] = useState('mailboxes')
  const [status, setStatus] = useState(null)
  const [domains, setDomains] = useState([])
  const [accounts, setAccounts] = useState([])
  const [clientConfig, setClientConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [copied, setCopied] = useState(null)

  // Mailbox modals
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({ username: '', domain: '', password: '', quotaMb: 2000 })
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [editAccount, setEditAccount] = useState(null)
  const [editForm, setEditForm] = useState({ password: '', quotaMb: 2000 })

  // Domains
  const [newDomain, setNewDomain] = useState('')
  const [dnsDomain, setDnsDomain] = useState(null)
  const [dnsInfo, setDnsInfo] = useState(null)
  const [dnsLoading, setDnsLoading] = useState(false)

  // Webmail
  const [mailbox, setMailbox] = useState('')
  const [folder, setFolder] = useState('inbox')
  const [list, setList] = useState({ messages: [], total: 0, unread: 0, page: 1, pageSize: 50 })
  const [page, setPage] = useState(1)
  const [mailSearch, setMailSearch] = useState('')
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [openMessage, setOpenMessage] = useState(null)
  const [showCompose, setShowCompose] = useState(false)
  const [compose, setCompose] = useState({ to: '', cc: '', subject: '', text: '', inReplyTo: '', files: [] })
  const [sending, setSending] = useState(false)

  // Delivery log
  const [logEntries, setLogEntries] = useState([])
  const [logFilter, setLogFilter] = useState('')
  const [logLoading, setLogLoading] = useState(false)

  const api = async (url, { method = 'GET', body } = {}) => {
    const res = await fetch(`/api/studio/email${url}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwtToken || localStorage.getItem('autodeploy_token') || ''}`,
        'X-Server-Id': activeServer?.id || ''
      },
      body: body ? JSON.stringify(body) : undefined
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.success === false) throw new Error(data.error || `Request failed (${res.status})`)
    return data
  }

  const flash = (msg) => {
    setNotice(msg)
    setTimeout(() => setNotice(null), 4000)
  }

  const copy = (text, key) => {
    navigator.clipboard?.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 1500)
  }

  const loadAll = async () => {
    setLoading(true)
    setError(null)
    try {
      const [s, d, a, c] = await Promise.all([api('/status'), api('/domains'), api('/accounts'), api('/client-config')])
      setStatus(s.status)
      setDomains(d.domains)
      setAccounts(a.accounts)
      setClientConfig(c.settings)
      const usable = a.accounts.filter(x => x.status === 'active')
      if (!mailbox && usable[0]) setMailbox(usable[0].email)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadAll() }, [jwtToken, activeServer?.id])

  // ------------------------------------------------------------------ mailboxes
  const handleCreate = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const data = await api('/accounts/create', { method: 'POST', body: createForm })
      flash(data.message)
      setShowCreate(false)
      setCreateForm({ username: '', domain: createForm.domain, password: '', quotaMb: 2000 })
      await loadAll()
      if (!mailbox) setMailbox(data.account.email)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const handleUpdate = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const body = { emailId: editAccount.id, quotaMb: editForm.quotaMb }
      if (editForm.password) body.password = editForm.password
      if (editAccount.status === 'needs_password' && editForm.password) body.status = 'active'
      const data = await api('/accounts/update', { method: 'POST', body })
      flash(data.message)
      setEditAccount(null)
      loadAll()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const toggleSuspend = async (acc) => {
    try {
      const data = await api('/accounts/update', { method: 'POST', body: { emailId: acc.id, status: acc.status === 'suspended' ? 'active' : 'suspended' } })
      flash(data.message)
      loadAll()
    } catch (e) {
      setError(e.message)
    }
  }

  const handleDelete = async (acc) => {
    if (!window.confirm(`Delete mailbox ${acc.email}?\n\nIt will stop receiving mail immediately. Stored mail is archived on the server, not erased.`)) return
    try {
      const data = await api('/accounts/delete', { method: 'POST', body: { emailId: acc.id } })
      flash(data.message)
      if (mailbox === acc.email) setMailbox('')
      loadAll()
    } catch (e) {
      setError(e.message)
    }
  }

  const generatePassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#%^&*-_'
    const arr = new Uint32Array(18)
    crypto.getRandomValues(arr)
    return Array.from(arr, n => chars[n % chars.length]).join('')
  }

  // ------------------------------------------------------------------ domains
  const handleAddDomain = async (e) => {
    e.preventDefault()
    try {
      const data = await api('/domains', { method: 'POST', body: { domain: newDomain } })
      flash(data.message)
      setNewDomain('')
      await loadAll()
      openDns(data.domain.domain)
    } catch (err) {
      setError(err.message)
    }
  }

  const handleRemoveDomain = async (domain) => {
    if (!window.confirm(`Remove ${domain} from the mail server? Mail for it will be rejected.`)) return
    try {
      const data = await api('/domains/delete', { method: 'POST', body: { domain } })
      flash(data.message)
      if (dnsDomain === domain) { setDnsDomain(null); setDnsInfo(null) }
      loadAll()
    } catch (e) {
      setError(e.message)
    }
  }

  const handleCatchAll = async (domain, catchAll) => {
    try {
      const data = await api('/domains/update', { method: 'POST', body: { domain, catchAll } })
      flash(data.message)
      loadAll()
    } catch (e) {
      setError(e.message)
    }
  }

  const openDns = async (domain) => {
    setDnsDomain(domain)
    setDnsLoading(true)
    setDnsInfo(null)
    try {
      setDnsInfo(await api(`/domains/dns?domain=${encodeURIComponent(domain)}`))
    } catch (e) {
      setError(e.message)
    } finally {
      setDnsLoading(false)
    }
  }

  // ------------------------------------------------------------------ webmail
  const loadMessages = async () => {
    if (!mailbox) return
    setLoadingMessages(true)
    try {
      const data = await api(`/messages?mailbox=${encodeURIComponent(mailbox)}&folder=${folder}&page=${page}&search=${encodeURIComponent(mailSearch)}`)
      setList(data)
    } catch (e) {
      setError(e.message)
      setList({ messages: [], total: 0, unread: 0, page: 1, pageSize: 50 })
    } finally {
      setLoadingMessages(false)
    }
  }

  useEffect(() => {
    if (tab === 'webmail') loadMessages()
  }, [tab, mailbox, folder, page])

  const openMail = async (m) => {
    try {
      const data = await api(`/message?mailbox=${encodeURIComponent(mailbox)}&folder=${folder}&id=${encodeURIComponent(m.id)}`)
      setOpenMessage(data.message)
      if (!m.read) setList(l => ({ ...l, unread: Math.max(0, l.unread - 1), messages: l.messages.map(x => x.id === m.id ? { ...x, read: true } : x) }))
    } catch (e) {
      setError(e.message)
    }
  }

  const deleteMail = async (msg) => {
    try {
      const data = await api('/messages/delete', { method: 'POST', body: { mailbox, folder, messageId: msg.id } })
      flash(data.message)
      setOpenMessage(null)
      loadMessages()
    } catch (e) {
      setError(e.message)
    }
  }

  const downloadAttachment = async (att) => {
    const res = await fetch(`/api/studio/email/attachment?mailbox=${encodeURIComponent(mailbox)}&folder=${folder}&id=${encodeURIComponent(openMessage.id)}&index=${att.index}`, {
      headers: { 'Authorization': `Bearer ${jwtToken || localStorage.getItem('autodeploy_token') || ''}`, 'X-Server-Id': activeServer?.id || '' }
    })
    if (!res.ok) return setError('Attachment download failed.')
    const url = URL.createObjectURL(await res.blob())
    const a = document.createElement('a')
    a.href = url
    a.download = att.filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const startCompose = (reply = null) => {
    if (reply) {
      const quoted = (reply.text || '').split('\n').map(l => `> ${l}`).join('\n')
      setCompose({
        to: reply.replyTo || reply.from,
        cc: '',
        subject: reply.subject.match(/^re:/i) ? reply.subject : `Re: ${reply.subject}`,
        text: `\n\nOn ${new Date(reply.date).toLocaleString()}, ${reply.from} wrote:\n${quoted}`,
        inReplyTo: reply.messageId || '',
        files: []
      })
    } else {
      setCompose({ to: '', cc: '', subject: '', text: '', inReplyTo: '', files: [] })
    }
    setShowCompose(true)
  }

  const handleSend = async (e) => {
    e.preventDefault()
    setSending(true)
    setError(null)
    try {
      const totalSize = compose.files.reduce((s, f) => s + f.size, 0)
      if (totalSize > 7 * 1024 * 1024) throw new Error('Attachments are limited to 7 MB in total.')
      const attachments = await Promise.all(compose.files.map(async f => ({ filename: f.name, contentType: f.type, contentBase64: await readFileBase64(f) })))
      const data = await api('/send', { method: 'POST', body: { from: mailbox, to: compose.to, cc: compose.cc, subject: compose.subject, text: compose.text, inReplyTo: compose.inReplyTo, attachments } })
      flash(data.message)
      setShowCompose(false)
      if (folder === 'sent') loadMessages()
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  // ------------------------------------------------------------------ delivery log
  const loadLog = async () => {
    setLogLoading(true)
    try {
      const data = await api(`/delivery-log?limit=200&address=${encodeURIComponent(logFilter)}`)
      setLogEntries(data.entries || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLogLoading(false)
    }
  }

  useEffect(() => { if (tab === 'log') loadLog() }, [tab])

  // ------------------------------------------------------------------ render
  const serverReady = status?.configured && status.services.postfix && status.services.dovecot
  const activeAccounts = accounts.filter(a => a.status === 'active')
  const missingPorts = status ? Object.entries(status.ports).filter(([, p]) => !p.listening).map(([k, p]) => `${k} ${p.port}`) : []

  const settingRow = (label, value, key) => (
    <div className="flex items-center justify-between gap-3 py-1.5 border-b border-white/5 last:border-0">
      <span className="text-slate-400">{label}</span>
      <button onClick={() => copy(String(value), key)} className="font-mono text-slate-200 hover:text-cyan-300 flex items-center gap-1.5 cursor-pointer">
        {value} {copied === key ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-slate-600" />}
      </button>
    </div>
  )

  return (
    <div className="space-y-6 font-sans">
      {/* Header */}
      <div className={`${card} p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4`}>
        <div className="flex items-center gap-3.5">
          <div className="p-3 rounded-2xl bg-gradient-to-tr from-cyan-500/20 to-blue-600/20 text-cyan-400 border border-cyan-500/30">
            <Mail className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-white">Domain Email</h1>
            <p className="text-xs text-slate-400 font-mono mt-0.5">
              {accounts.length} mailbox{accounts.length === 1 ? '' : 'es'} · {domains.length} domain{domains.length === 1 ? '' : 's'} · IMAP / POP3 / SMTP on {status?.mailHost || '…'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {notice && <div className="px-3.5 py-1.5 bg-emerald-950/90 border border-emerald-700/80 text-emerald-300 rounded-xl text-xs font-mono font-semibold max-w-md">{notice}</div>}
          <button onClick={loadAll} className={`${btnCls} bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10`}>
            <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <button onClick={() => setShowCreate(true)} className={`${btnCls} bg-cyan-600 hover:bg-cyan-500 text-white`}>
            <Plus className="w-3.5 h-3.5" /> New Mailbox
          </button>
        </div>
      </div>

      {/* Server status */}
      {status && (
        serverReady && missingPorts.length === 0 ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 rounded-2xl border border-emerald-700/40 bg-emerald-950/30 text-xs">
            <span className="flex items-center gap-1.5 text-emerald-300 font-semibold"><CheckCircle2 className="w-4 h-4" /> Mail server running</span>
            {Object.entries(status.services).map(([k, v]) => (
              <span key={k} className={`font-mono ${v ? 'text-emerald-400/80' : 'text-rose-400'}`}>{k} {v ? '●' : '○'}</span>
            ))}
            <span className="font-mono text-slate-400">HELO {status.heloHost} · IP {status.publicIp}</span>
          </div>
        ) : (
          <div className="px-4 py-3.5 rounded-2xl border border-amber-700/50 bg-amber-950/40 text-xs space-y-2">
            <div className="flex items-center gap-2 text-amber-200 font-semibold">
              <AlertTriangle className="w-4 h-4" />
              {status.configured ? 'Mail server is not fully running' : 'Mail server is not set up yet — mailboxes cannot send or receive until it is'}
            </div>
            <div className="font-mono text-amber-200/70 flex flex-wrap gap-x-4">
              {Object.entries(status.services).map(([k, v]) => <span key={k}>{k}: {v ? 'running' : 'stopped'}</span>)}
              {missingPorts.length > 0 && <span>not listening: {missingPorts.join(', ')}</span>}
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-slate-200 overflow-x-auto whitespace-nowrap">{status.setupCommand}</code>
              <button onClick={() => copy(status.setupCommand, 'setup')} className={`${btnCls} bg-slate-800 border border-white/10 text-slate-200`}>
                {copied === 'setup' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
            <p className="text-amber-200/60">Run this once on the server as root. It configures Postfix, Dovecot and DKIM, and is safe to re-run.</p>
          </div>
        )
      )}

      {error && (
        <div className="flex items-start gap-3 p-3.5 bg-rose-950/60 border border-rose-700/50 rounded-2xl text-rose-200 text-xs font-mono">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-rose-400" />
          <pre className="whitespace-pre-wrap break-all flex-1">{error}</pre>
          <button onClick={() => setError(null)} className="text-rose-400 hover:text-white cursor-pointer"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs font-semibold">
        {[['mailboxes', 'Mailboxes', Mail], ['webmail', 'Webmail', Inbox], ['domains', 'Domains & DNS', Globe], ['log', 'Delivery Log', Activity]].map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2.5 rounded-2xl border flex items-center gap-2 whitespace-nowrap cursor-pointer transition ${tab === id ? 'bg-cyan-950/90 text-cyan-300 border-cyan-500/60' : 'bg-slate-900/70 text-slate-400 border-white/10 hover:text-slate-200'}`}
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {/* ------------------------------------------------------------ Mailboxes */}
      {tab === 'mailboxes' && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
          <div className={`${card} xl:col-span-2 p-4 space-y-2`}>
            {accounts.length === 0 && !loading && (
              <div className="p-8 text-center text-slate-500 text-sm">
                No mailboxes yet. <button onClick={() => setShowCreate(true)} className="text-cyan-400 hover:underline cursor-pointer">Create one</button> — e.g. info@yourdomain.com.
              </div>
            )}
            {accounts.map(acc => {
              const pct = Math.min(100, (acc.usedMb / (acc.quotaMb || 1)) * 100)
              return (
                <div key={acc.id} className="p-3.5 rounded-2xl bg-slate-950/60 border border-white/5 flex flex-col md:flex-row md:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-mono font-bold text-white truncate">{acc.email}</span>
                      {acc.status === 'active' && <span className="text-[10px] px-2 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 font-bold">ACTIVE</span>}
                      {acc.status === 'suspended' && <span className="text-[10px] px-2 py-0.5 rounded-full border border-slate-500/30 bg-slate-500/10 text-slate-300 font-bold">SUSPENDED</span>}
                      {acc.status === 'needs_password' && <span className="text-[10px] px-2 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-300 font-bold">SET PASSWORD TO ACTIVATE</span>}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-1.5 flex-1 max-w-[220px] rounded-full bg-slate-800 overflow-hidden">
                        <div className={`h-full ${pct > 90 ? 'bg-rose-500' : 'bg-cyan-500'}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[11px] text-slate-500 font-mono">{acc.usedMb} / {acc.quotaMb} MB</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {acc.status === 'active' && (
                      <button onClick={() => { setMailbox(acc.email); setFolder('inbox'); setPage(1); setTab('webmail') }} className={`${btnCls} bg-slate-800 hover:bg-slate-700 border border-white/10 text-slate-200`}>
                        <Inbox className="w-3.5 h-3.5" /> Open
                      </button>
                    )}
                    <button onClick={() => { setEditAccount(acc); setEditForm({ password: '', quotaMb: acc.quotaMb }) }} className={`${btnCls} bg-slate-800 hover:bg-slate-700 border border-white/10 text-slate-200`}>
                      <Key className="w-3.5 h-3.5" /> {acc.status === 'needs_password' ? 'Set password' : 'Edit'}
                    </button>
                    {acc.status !== 'needs_password' && (
                      <button onClick={() => toggleSuspend(acc)} className={`${btnCls} bg-slate-800 hover:bg-slate-700 border border-white/10 text-slate-300`}>
                        <Lock className="w-3.5 h-3.5" /> {acc.status === 'suspended' ? 'Resume' : 'Suspend'}
                      </button>
                    )}
                    <button onClick={() => handleDelete(acc)} className={`${btnCls} bg-rose-950/50 hover:bg-rose-900/60 border border-rose-700/40 text-rose-300`}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Client settings */}
          {clientConfig && (
            <div className={`${card} p-5 text-xs space-y-4`}>
              <div className="flex items-center gap-2 text-white font-bold text-sm"><Settings className="w-4 h-4 text-cyan-400" /> Mail app settings</div>
              <p className="text-slate-400">Use these in Outlook, Apple Mail, Thunderbird, Gmail app or your website's SMTP config.</p>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Incoming (IMAP)</div>
                {settingRow('Server', clientConfig.incomingServer, 'imap-host')}
                {settingRow('Port', `${clientConfig.imapPort} · ${clientConfig.imapSecurity}`, 'imap-port')}
                {settingRow('POP3', `${clientConfig.pop3Port} · ${clientConfig.pop3Security}`, 'pop-port')}
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Outgoing (SMTP)</div>
                {settingRow('Server', clientConfig.outgoingServer, 'smtp-host')}
                {settingRow('Port', `${clientConfig.smtpPort} · ${clientConfig.smtpSecurity}`, 'smtp-port')}
                {settingRow('Alt. port', `${clientConfig.smtpsPort} · ${clientConfig.smtpsSecurity}`, 'smtps-port')}
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Login</div>
                {settingRow('Username', clientConfig.username, 'user')}
                {settingRow('Auth', clientConfig.authentication, 'auth')}
              </div>
              <div className="p-3 rounded-xl bg-slate-950 border border-white/10 font-mono text-[11px] text-slate-300 space-y-0.5">
                <div className="text-slate-500 mb-1"># .env for apps (Nodemailer etc.)</div>
                <div>SMTP_HOST={clientConfig.outgoingServer}</div>
                <div>SMTP_PORT={clientConfig.smtpPort}</div>
                <div>SMTP_SECURE=false</div>
                <div>SMTP_USER=you@yourdomain.com</div>
                <div>SMTP_PASS=••••••••</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------ Webmail */}
      {tab === 'webmail' && (
        activeAccounts.length === 0 ? (
          <div className={`${card} p-10 text-center text-slate-500 text-sm`}>Create an active mailbox first.</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
            <div className={`${card} p-4 space-y-3`}>
              <select value={mailbox} onChange={(e) => { setMailbox(e.target.value); setPage(1); setOpenMessage(null) }} className={inputCls}>
                {activeAccounts.map(a => <option key={a.id} value={a.email}>{a.email}</option>)}
              </select>
              <button onClick={() => startCompose()} className={`${btnCls} w-full justify-center bg-cyan-600 hover:bg-cyan-500 text-white`}>
                <Send className="w-3.5 h-3.5" /> Compose
              </button>
              <div className="space-y-1">
                {FOLDERS.map(f => (
                  <button
                    key={f.id}
                    onClick={() => { setFolder(f.id); setPage(1); setOpenMessage(null) }}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs cursor-pointer ${folder === f.id ? 'bg-cyan-500/10 text-cyan-200 border border-cyan-500/30' : 'text-slate-400 hover:bg-white/5 border border-transparent'}`}
                  >
                    <f.icon className="w-3.5 h-3.5" /> <span className="flex-1 text-left">{f.label}</span>
                    {folder === f.id && list.unread > 0 && <span className="text-[10px] bg-cyan-600 text-white rounded-full px-1.5">{list.unread}</span>}
                  </button>
                ))}
              </div>
            </div>

            <div className={`${card} lg:col-span-3 flex flex-col h-[680px] overflow-hidden`}>
              {openMessage ? (
                <>
                  <div className="px-5 py-3 border-b border-white/10 flex items-center gap-2">
                    <button onClick={() => setOpenMessage(null)} className={`${btnCls} bg-slate-800 border border-white/10 text-slate-200`}><ChevronLeft className="w-3.5 h-3.5" /> Back</button>
                    <button onClick={() => startCompose(openMessage)} className={`${btnCls} bg-slate-800 border border-white/10 text-slate-200`}><Reply className="w-3.5 h-3.5" /> Reply</button>
                    <button onClick={() => deleteMail(openMessage)} className={`${btnCls} bg-rose-950/50 border border-rose-700/40 text-rose-300 ml-auto`}><Trash2 className="w-3.5 h-3.5" /> {folder === 'trash' ? 'Delete forever' : 'Delete'}</button>
                  </div>
                  <div className="px-5 py-4 border-b border-white/5 space-y-1 text-xs">
                    <h2 className="text-base font-bold text-white mb-2">{openMessage.subject}</h2>
                    <div className="text-slate-300"><span className="text-slate-500">From:</span> {openMessage.from}</div>
                    <div className="text-slate-300"><span className="text-slate-500">To:</span> {openMessage.to}</div>
                    {openMessage.cc && <div className="text-slate-300"><span className="text-slate-500">Cc:</span> {openMessage.cc}</div>}
                    <div className="text-slate-500">{new Date(openMessage.date).toLocaleString()}</div>
                    {openMessage.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-2 pt-2">
                        {openMessage.attachments.map(a => (
                          <button key={a.index} onClick={() => downloadAttachment(a)} className="px-2.5 py-1 rounded-lg bg-slate-800 border border-white/10 text-slate-200 flex items-center gap-1.5 cursor-pointer hover:bg-slate-700">
                            <Paperclip className="w-3 h-3" /> {a.filename} <span className="text-slate-500">{formatSize(a.size)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 overflow-auto bg-white">
                    {openMessage.html ? (
                      // Sandboxed: no scripts, no same-origin access to the panel
                      <iframe title="message" sandbox="" srcDoc={openMessage.html} className="w-full h-full min-h-[400px] border-0" />
                    ) : (
                      <pre className="p-5 text-sm text-slate-800 whitespace-pre-wrap font-sans">{openMessage.text}</pre>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="px-5 py-3 border-b border-white/10 flex items-center gap-2">
                    <form onSubmit={(e) => { e.preventDefault(); setPage(1); loadMessages() }} className="relative flex-1">
                      <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input value={mailSearch} onChange={(e) => setMailSearch(e.target.value)} placeholder="Search from, to, subject — Enter" className={`${inputCls} pl-8`} />
                    </form>
                    <button onClick={loadMessages} className={`${btnCls} bg-slate-800 border border-white/10 text-slate-200`}>
                      <RefreshCw className={`w-3.5 h-3.5 ${loadingMessages ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                  <div className="flex-1 overflow-auto">
                    {!loadingMessages && list.messages.length === 0 && <div className="p-8 text-center text-xs text-slate-500">No messages in {folder}.</div>}
                    {list.messages.map(m => (
                      <button key={m.id} onClick={() => openMail(m)} className="w-full text-left px-5 py-3 border-b border-white/5 hover:bg-white/[0.03] flex items-start gap-3 cursor-pointer">
                        <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${m.read ? 'bg-transparent' : 'bg-cyan-400'}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-3">
                            <span className={`text-xs truncate ${m.read ? 'text-slate-400' : 'text-white font-bold'}`}>{folder === 'sent' ? `To: ${m.to}` : m.from}</span>
                            <span className="text-[11px] text-slate-500 font-mono shrink-0">{formatDate(m.date)}</span>
                          </div>
                          <div className={`text-xs truncate mt-0.5 ${m.read ? 'text-slate-500' : 'text-slate-200'}`}>{m.subject}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                  <div className="px-5 py-2.5 border-t border-white/10 flex items-center justify-between text-xs text-slate-400 font-mono">
                    <span>{list.total} message{list.total === 1 ? '' : 's'}</span>
                    <div className="flex items-center gap-2">
                      <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="p-1.5 rounded-lg bg-slate-800 border border-white/10 disabled:opacity-30 cursor-pointer"><ChevronLeft className="w-3.5 h-3.5" /></button>
                      <span>{page} / {Math.max(1, Math.ceil(list.total / list.pageSize))}</span>
                      <button disabled={page * list.pageSize >= list.total} onClick={() => setPage(p => p + 1)} className="p-1.5 rounded-lg bg-slate-800 border border-white/10 disabled:opacity-30 cursor-pointer"><ChevronRight className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )
      )}

      {/* ------------------------------------------------------------ Domains */}
      {tab === 'domains' && (
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-6 items-start">
          <div className={`${card} xl:col-span-2 p-4 space-y-3`}>
            <form onSubmit={handleAddDomain} className="flex gap-2">
              <input value={newDomain} onChange={(e) => setNewDomain(e.target.value)} placeholder="yourdomain.com" className={inputCls} />
              <button className={`${btnCls} bg-cyan-600 hover:bg-cyan-500 text-white whitespace-nowrap`}><Plus className="w-3.5 h-3.5" /> Add</button>
            </form>
            {domains.length === 0 && <div className="text-xs text-slate-500 p-3">No mail domains yet.</div>}
            {domains.map(d => (
              <div key={d.domain} className={`p-3.5 rounded-2xl border ${dnsDomain === d.domain ? 'border-cyan-500/40 bg-cyan-500/5' : 'border-white/5 bg-slate-950/60'}`}>
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span className="text-sm font-mono text-white truncate flex-1">{d.domain}</span>
                  <span className="text-[10px] text-slate-500 font-mono">{d.mailboxes} mailbox{d.mailboxes === 1 ? '' : 'es'}</span>
                </div>
                <div className="flex items-center gap-2 mt-2.5 text-xs">
                  <span className="text-slate-500 whitespace-nowrap">Catch-all →</span>
                  <select
                    value={d.catchAll || ''}
                    onChange={(e) => handleCatchAll(d.domain, e.target.value || null)}
                    className="flex-1 bg-slate-950 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-slate-200 font-mono"
                  >
                    <option value="">off (reject unknown addresses)</option>
                    {activeAccounts.map(a => <option key={a.id} value={a.email}>{a.email}</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-2 mt-2.5">
                  <button onClick={() => openDns(d.domain)} className={`${btnCls} bg-slate-800 hover:bg-slate-700 border border-white/10 text-slate-200`}>
                    <Server className="w-3.5 h-3.5" /> DNS records
                  </button>
                  {!d.dkimReady && <span className="text-[10px] text-amber-300">DKIM key pending</span>}
                  <button onClick={() => handleRemoveDomain(d.domain)} className="ml-auto text-slate-500 hover:text-rose-400 cursor-pointer" title="Remove domain"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            ))}
          </div>

          <div className={`${card} xl:col-span-3 p-5`}>
            {!dnsDomain ? (
              <div className="text-xs text-slate-500 p-6 text-center">Select a domain to see the DNS records it needs. Mail will be rejected or land in spam until MX, SPF, DKIM and DMARC are in place.</div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-bold text-white">DNS for {dnsDomain}</div>
                  <button onClick={() => openDns(dnsDomain)} className={`${btnCls} bg-slate-800 border border-white/10 text-slate-200`}>
                    <RefreshCw className={`w-3.5 h-3.5 ${dnsLoading ? 'animate-spin' : ''}`} /> Re-check
                  </button>
                </div>
                <p className="text-[11px] text-slate-500">Add these at your DNS provider (for these domains: Hostinger → Domains → DNS / Nameservers). Changes can take up to an hour to show here.</p>
                {dnsLoading && !dnsInfo && <div className="text-xs text-slate-500 font-mono">Checking public DNS…</div>}
                {dnsInfo?.records.map((r, i) => (
                  <div key={i} className={`p-3 rounded-xl border text-xs ${r.ok ? 'border-emerald-700/40 bg-emerald-950/20' : 'border-amber-700/40 bg-amber-950/20'}`}>
                    <div className="flex items-center gap-2 mb-2">
                      {r.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <XCircle className="w-4 h-4 text-amber-400" />}
                      <span className="font-semibold text-slate-200">{r.purpose}</span>
                      <span className="ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">{r.type}</span>
                    </div>
                    <div className="grid grid-cols-[70px_1fr_auto] gap-x-2 gap-y-1 font-mono text-[11px] items-start">
                      <span className="text-slate-500">Name</span>
                      <span className="text-slate-200 break-all">{r.host}</span>
                      <button onClick={() => copy(r.host, `h${i}`)} className="text-slate-500 hover:text-cyan-300 cursor-pointer">{copied === `h${i}` ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}</button>
                      <span className="text-slate-500">Value</span>
                      <span className="text-slate-200 break-all">{r.priority ? `${r.priority} ` : ''}{r.value}</span>
                      <button onClick={() => copy(r.value, `v${i}`)} className="text-slate-500 hover:text-cyan-300 cursor-pointer">{copied === `v${i}` ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}</button>
                      <span className="text-slate-500">Current</span>
                      <span className={`break-all col-span-2 ${r.current ? 'text-slate-400' : 'text-slate-600 italic'}`}>{r.current || 'not found'}</span>
                    </div>
                    {r.note && <div className="mt-1.5 text-amber-300/80 text-[11px]">{r.note}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------ Delivery log */}
      {tab === 'log' && (
        <div className={`${card} p-4`}>
          <div className="flex items-center gap-2 mb-3">
            <form onSubmit={(e) => { e.preventDefault(); loadLog() }} className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={logFilter} onChange={(e) => setLogFilter(e.target.value)} placeholder="Filter by address — Enter" className={`${inputCls} pl-8`} />
            </form>
            <button onClick={loadLog} className={`${btnCls} bg-slate-800 border border-white/10 text-slate-200`}>
              <RefreshCw className={`w-3.5 h-3.5 ${logLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <p className="text-[11px] text-slate-500 mb-3">Every delivery attempt from the server's mail log. "deferred" is retried automatically; "bounced" failed permanently — the detail column says why.</p>
          <div className="overflow-auto max-h-[600px] border border-white/10 rounded-xl">
            <table className="w-full text-[11px] font-mono">
              <thead className="sticky top-0 bg-slate-900">
                <tr>{['Time', 'From', 'To', 'Status', 'Detail'].map(h => <th key={h} className="text-left px-3 py-2 text-slate-300 border-b border-white/10">{h}</th>)}</tr>
              </thead>
              <tbody>
                {logEntries.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500">{logLoading ? 'Loading…' : 'No delivery attempts logged yet.'}</td></tr>}
                {logEntries.map((e, i) => (
                  <tr key={i} className="border-b border-white/5 align-top">
                    <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap">{new Date(e.time).toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-slate-300">{e.from || '—'}</td>
                    <td className="px-3 py-1.5 text-slate-300">{e.to}</td>
                    <td className="px-3 py-1.5"><span className={`px-1.5 py-0.5 rounded border ${STATUS_COLORS[e.status] || 'text-slate-300 border-white/10'}`}>{e.status}</span></td>
                    <td className="px-3 py-1.5 text-slate-400 break-all">{e.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------ Modals */}
      {showCreate && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <form onSubmit={handleCreate} className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-md">
            <div className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between">
              <span className="text-sm font-bold text-white">New mailbox</span>
              <button type="button" onClick={() => setShowCreate(false)} className="text-slate-400 hover:text-white cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-3 text-xs">
              <label className="block">
                <span className="text-slate-400">Address</span>
                <div className="flex items-center gap-1.5 mt-1">
                  <input required value={createForm.username} onChange={(e) => setCreateForm(f => ({ ...f, username: e.target.value.toLowerCase() }))} placeholder="info" className={inputCls} />
                  <span className="text-slate-500">@</span>
                  <input required list="mail-domains" value={createForm.domain} onChange={(e) => setCreateForm(f => ({ ...f, domain: e.target.value.toLowerCase() }))} placeholder="yourdomain.com" className={inputCls} />
                  <datalist id="mail-domains">{domains.map(d => <option key={d.domain} value={d.domain} />)}</datalist>
                </div>
              </label>
              <label className="block">
                <span className="text-slate-400">Password (min. 8 characters)</span>
                <div className="flex items-center gap-1.5 mt-1">
                  <input required minLength={8} type={showPassword ? 'text' : 'password'} value={createForm.password} onChange={(e) => setCreateForm(f => ({ ...f, password: e.target.value }))} className={inputCls} />
                  <button type="button" onClick={() => setShowPassword(s => !s)} className="text-slate-400 hover:text-white cursor-pointer p-1.5">{showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                  <button type="button" onClick={() => { setCreateForm(f => ({ ...f, password: generatePassword() })); setShowPassword(true) }} className={`${btnCls} bg-slate-800 border border-white/10 text-slate-200 whitespace-nowrap`}>Generate</button>
                </div>
              </label>
              <label className="block">
                <span className="text-slate-400">Quota (MB)</span>
                <input type="number" min={50} max={102400} value={createForm.quotaMb} onChange={(e) => setCreateForm(f => ({ ...f, quotaMb: e.target.value }))} className={`${inputCls} mt-1`} />
              </label>
              <p className="text-slate-500">A new domain is registered automatically and gets a DKIM key — then add its DNS records (Domains & DNS tab).</p>
            </div>
            <div className="px-5 py-3.5 border-t border-white/10 flex justify-end gap-2">
              <button type="button" onClick={() => setShowCreate(false)} className={`${btnCls} bg-slate-800 text-slate-200`}>Cancel</button>
              <button disabled={busy} className={`${btnCls} bg-cyan-600 hover:bg-cyan-500 text-white`}>{busy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Create</button>
            </div>
          </form>
        </div>
      )}

      {editAccount && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <form onSubmit={handleUpdate} className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-md">
            <div className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between">
              <span className="text-sm font-bold text-white font-mono">{editAccount.email}</span>
              <button type="button" onClick={() => setEditAccount(null)} className="text-slate-400 hover:text-white cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-3 text-xs">
              <label className="block">
                <span className="text-slate-400">{editAccount.status === 'needs_password' ? 'Password (required to activate)' : 'New password (leave empty to keep)'}</span>
                <div className="flex items-center gap-1.5 mt-1">
                  <input required={editAccount.status === 'needs_password'} minLength={8} type={showPassword ? 'text' : 'password'} value={editForm.password} onChange={(e) => setEditForm(f => ({ ...f, password: e.target.value }))} className={inputCls} />
                  <button type="button" onClick={() => setShowPassword(s => !s)} className="text-slate-400 hover:text-white cursor-pointer p-1.5">{showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                  <button type="button" onClick={() => { setEditForm(f => ({ ...f, password: generatePassword() })); setShowPassword(true) }} className={`${btnCls} bg-slate-800 border border-white/10 text-slate-200 whitespace-nowrap`}>Generate</button>
                </div>
              </label>
              <label className="block">
                <span className="text-slate-400">Quota (MB)</span>
                <input type="number" min={50} max={102400} value={editForm.quotaMb} onChange={(e) => setEditForm(f => ({ ...f, quotaMb: e.target.value }))} className={`${inputCls} mt-1`} />
              </label>
            </div>
            <div className="px-5 py-3.5 border-t border-white/10 flex justify-end gap-2">
              <button type="button" onClick={() => setEditAccount(null)} className={`${btnCls} bg-slate-800 text-slate-200`}>Cancel</button>
              <button disabled={busy} className={`${btnCls} bg-cyan-600 hover:bg-cyan-500 text-white`}>Save</button>
            </div>
          </form>
        </div>
      )}

      {showCompose && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <form onSubmit={handleSend} className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between">
              <span className="text-sm font-bold text-white">New message</span>
              <button type="button" onClick={() => setShowCompose(false)} className="text-slate-400 hover:text-white cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-2.5 text-xs overflow-y-auto">
              <div className="grid grid-cols-[60px_1fr] items-center gap-2">
                <span className="text-slate-500">From</span>
                <span className="font-mono text-slate-200">{mailbox}</span>
                <span className="text-slate-500">To</span>
                <input required value={compose.to} onChange={(e) => setCompose(c => ({ ...c, to: e.target.value }))} placeholder="name@example.com, other@example.com" className={inputCls} />
                <span className="text-slate-500">Cc</span>
                <input value={compose.cc} onChange={(e) => setCompose(c => ({ ...c, cc: e.target.value }))} className={inputCls} />
                <span className="text-slate-500">Subject</span>
                <input value={compose.subject} onChange={(e) => setCompose(c => ({ ...c, subject: e.target.value }))} className={inputCls} />
              </div>
              <textarea value={compose.text} onChange={(e) => setCompose(c => ({ ...c, text: e.target.value }))} rows={12} className={`${inputCls} font-sans text-sm resize-y`} />
              <div className="flex items-center gap-2 flex-wrap">
                <label className={`${btnCls} bg-slate-800 border border-white/10 text-slate-200`}>
                  <Paperclip className="w-3.5 h-3.5" /> Attach
                  <input type="file" multiple className="hidden" onChange={(e) => setCompose(c => ({ ...c, files: [...c.files, ...Array.from(e.target.files || [])] }))} />
                </label>
                {compose.files.map((f, i) => (
                  <span key={i} className="px-2 py-1 rounded-lg bg-slate-800 border border-white/10 text-slate-300 flex items-center gap-1.5">
                    {f.name} <span className="text-slate-500">{formatSize(f.size)}</span>
                    <button type="button" onClick={() => setCompose(c => ({ ...c, files: c.files.filter((_, j) => j !== i) }))} className="text-slate-500 hover:text-rose-400 cursor-pointer"><X className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
            </div>
            <div className="px-5 py-3.5 border-t border-white/10 flex justify-end gap-2">
              <button type="button" onClick={() => setShowCompose(false)} className={`${btnCls} bg-slate-800 text-slate-200`}>Cancel</button>
              <button disabled={sending} className={`${btnCls} bg-cyan-600 hover:bg-cyan-500 text-white`}>{sending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Send</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
