import React, { useEffect, useState } from 'react'
import { HelpCircle, MessageSquare, ArrowLeft, Send, RefreshCw, Loader2 } from 'lucide-react'
import { getAuthToken, timeAgo, formatDate } from './admin/adminApi'

const CATEGORIES = [
  { value: 'server', label: 'Server Connectivity / SSH Error' },
  { value: 'deployment', label: 'Deployment / Build Failure' },
  { value: 'domain', label: 'PM2 Process & Domain Binding' },
  { value: 'database', label: 'MySQL / PostgreSQL Database Import' },
  { value: 'billing', label: 'Billing & Subscription Inquiry' },
  { value: 'account', label: 'Account & Access' },
  { value: 'other', label: 'Something else' }
]
const PRIORITIES = [
  { value: 'low', label: 'Low - General Inquiry' },
  { value: 'medium', label: 'Medium - Standard Issue' },
  { value: 'high', label: 'High - Production Degradation' },
  { value: 'urgent', label: 'Urgent - Server Down' }
]
const STATUS_STYLES = {
  open: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  pending: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30',
  resolved: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  closed: 'bg-slate-800 text-slate-400 border-slate-700'
}
const STATUS_LABELS = { open: 'Waiting on support', pending: 'Support replied', resolved: 'Resolved', closed: 'Closed' }
const EMPTY_FORM = { category: 'server', priority: 'medium', subject: '', message: '' }
const inputClass = 'w-full px-3.5 py-2.5 bg-slate-950 border border-white/10 rounded-xl text-white focus:outline-none focus:border-cyan-500'

async function supportApi(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api/support${path}`, {
    method,
    headers: { Authorization: `Bearer ${getAuthToken()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

function StatusPill({ status }) {
  return <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold whitespace-nowrap ${STATUS_STYLES[status] || STATUS_STYLES.closed}`}>{STATUS_LABELS[status] || status}</span>
}

/**
 * Lets an admin open support tickets for their organization and follow the conversation with platform support.
 */
export default function SupportDesk() {
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [active, setActive] = useState(null)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)

  const loadTickets = async () => {
    setLoading(true)
    setError('')
    try {
      setTickets((await supportApi('/tickets')).tickets || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadTickets() }, [])

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value })

  const submitTicket = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const { ticket } = await supportApi('/tickets', { method: 'POST', body: form })
      setForm(EMPTY_FORM)
      setActive(ticket)
      loadTickets()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const openTicket = async (id) => {
    setError('')
    try {
      setActive((await supportApi(`/tickets/${id}`)).ticket)
    } catch (e) {
      setError(e.message)
    }
  }

  const act = async (fn) => {
    setBusy(true)
    setError('')
    try {
      setActive((await fn()).ticket)
      loadTickets()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const sendReply = (e) => {
    e.preventDefault()
    if (!reply.trim()) return
    act(async () => {
      const res = await supportApi(`/tickets/${active.id}/replies`, { method: 'POST', body: { body: reply } })
      setReply('')
      return res
    })
  }

  const card = 'bg-[#0B0F19]/90 border border-white/10 rounded-3xl p-6 space-y-5 backdrop-blur-xl shadow-2xl font-mono'

  if (active) {
    return (
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
          <button onClick={() => setActive(null)} className="text-xs text-cyan-400 hover:text-cyan-300 font-bold flex items-center gap-1.5 cursor-pointer">
            <ArrowLeft className="w-3.5 h-3.5" />My tickets
          </button>
          <StatusPill status={active.status} />
        </div>
        <div>
          <h3 className="text-base font-extrabold text-white break-words">#{active.number} · {active.subject}</h3>
          <p className="text-[11px] text-slate-500 mt-1">Opened {formatDate(active.createdAt, true)}</p>
        </div>
        {error && <p className="text-xs text-rose-300">{error}</p>}
        <div className="space-y-3 text-xs">
          {active.messages.map((m) => (
            <div key={m.id} className={`rounded-2xl border p-3 ${m.authorRole === 'staff' ? 'bg-cyan-500/10 border-cyan-500/30 sm:mr-10' : 'bg-slate-950 border-white/10 sm:ml-10'}`}>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="font-bold text-slate-200">{m.authorRole === 'staff' ? `${m.authorName} (Support)` : m.authorName}</span>
                <span className="text-slate-500" title={formatDate(m.createdAt, true)}>{timeAgo(m.createdAt)}</span>
              </div>
              <p className="text-slate-300 whitespace-pre-wrap break-words">{m.body}</p>
            </div>
          ))}
        </div>
        {active.status === 'closed' ? (
          <p className="text-xs text-slate-400">This ticket is closed. Open a new ticket if you need more help.</p>
        ) : (
          <form onSubmit={sendReply} className="space-y-3 text-xs">
            <textarea rows={3} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Add more details or reply to support…" className={inputClass} />
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => act(() => supportApi(`/tickets/${active.id}/close`, { method: 'POST' }))}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-xl cursor-pointer disabled:opacity-50"
              >
                Close ticket
              </button>
              <button type="submit" disabled={busy || !reply.trim()} className="px-5 py-2 bg-gradient-to-r from-cyan-500 to-indigo-600 text-white font-bold rounded-xl cursor-pointer disabled:opacity-50 flex items-center gap-2">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}Send reply
              </button>
            </div>
          </form>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className={card}>
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center space-x-2">
            <HelpCircle className="w-5 h-5 text-cyan-400" />
            <h3 className="text-base font-extrabold text-white">Create Support Ticket</h3>
          </div>
        </div>
        {error && <p className="text-xs text-rose-300">{error}</p>}
        <form onSubmit={submitTicket} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="space-y-1.5 block">
              <span className="text-slate-300 font-bold block">Issue Category</span>
              <select value={form.category} onChange={set('category')} className={inputClass}>
                {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </label>
            <label className="space-y-1.5 block">
              <span className="text-slate-300 font-bold block">Priority Level</span>
              <select value={form.priority} onChange={set('priority')} className={inputClass}>
                {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </label>
          </div>
          <label className="space-y-1.5 block">
            <span className="text-slate-300 font-bold block">Subject / Issue Summary *</span>
            <input type="text" required maxLength={200} value={form.subject} onChange={set('subject')} placeholder="e.g. Nginx 503 error on domain deployment" className={inputClass} />
          </label>
          <label className="space-y-1.5 block">
            <span className="text-slate-300 font-bold block">Detailed Description / Error Logs *</span>
            <textarea required rows={4} value={form.message} onChange={set('message')} placeholder="Paste error logs, server IP, or step-by-step description of the problem..." className={inputClass} />
          </label>
          <div className="pt-2 flex justify-end">
            <button
              type="submit"
              disabled={submitting}
              className="px-6 py-2.5 bg-gradient-to-r from-emerald-500 via-teal-600 to-emerald-700 hover:from-emerald-400 hover:to-teal-500 text-white font-extrabold rounded-xl shadow-lg shadow-emerald-500/20 transition cursor-pointer flex items-center space-x-2 disabled:opacity-50"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
              <span>Submit Support Ticket</span>
            </button>
          </div>
        </form>
      </div>

      <div className={card}>
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <h3 className="text-base font-extrabold text-white">My Tickets</h3>
          <button onClick={loadTickets} className="text-slate-400 hover:text-white cursor-pointer" title="Refresh">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        {loading && tickets.length === 0 ? (
          <p className="text-xs text-slate-500">Loading…</p>
        ) : tickets.length === 0 ? (
          <p className="text-xs text-slate-500">You haven't opened any tickets yet.</p>
        ) : (
          <div className="divide-y divide-white/5 text-xs">
            {tickets.map((t) => (
              <button key={t.id} onClick={() => openTicket(t.id)} className="w-full py-3 flex items-center gap-3 text-left hover:bg-white/5 rounded-lg px-2 cursor-pointer">
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-white truncate">#{t.number} · {t.subject}</div>
                  <div className="text-slate-500">{t.messageCount} message{t.messageCount === 1 ? '' : 's'} · updated {timeAgo(t.updatedAt)}</div>
                </div>
                <StatusPill status={t.status} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
