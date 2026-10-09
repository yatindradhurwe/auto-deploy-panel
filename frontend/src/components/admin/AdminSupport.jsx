import React, { useState } from 'react'
import { LifeBuoy, Send, ArrowLeft } from 'lucide-react'
import { adminApi, formatDate, timeAgo } from './adminApi'
import { Card, Badge, Button, SearchInput, Select, Alert, EmptyState, Loading, useAdminData } from './AdminUI'

export const TICKET_STATUS_TONES = { open: 'amber', pending: 'cyan', resolved: 'green', closed: 'slate' }
export const TICKET_PRIORITY_TONES = { low: 'slate', medium: 'cyan', high: 'amber', urgent: 'red' }

const STATUS_OPTIONS = ['open', 'pending', 'resolved', 'closed'].map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))
const PRIORITY_OPTIONS = ['low', 'medium', 'high', 'urgent'].map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1) }))

function TicketThread({ ticketId, apiBaseUrl, onBack }) {
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState('')
  const [actionError, setActionError] = useState('')
  const { data, loading, error, reload } = useAdminData(() => adminApi(`/support/tickets/${ticketId}`, { apiBaseUrl }), [ticketId])
  const ticket = data?.ticket

  const run = async (key, fn) => {
    setBusy(key)
    setActionError('')
    try {
      await fn()
      await reload()
    } catch (e) {
      setActionError(e.message)
    } finally {
      setBusy('')
    }
  }

  const sendReply = (e) => {
    e.preventDefault()
    if (!reply.trim()) return
    run('reply', async () => {
      await adminApi(`/support/tickets/${ticketId}/replies`, { method: 'POST', body: { body: reply }, apiBaseUrl })
      setReply('')
    })
  }

  const patch = (key, body) => run(key, () => adminApi(`/support/tickets/${ticketId}`, { method: 'PATCH', body, apiBaseUrl }))

  return (
    <Card
      title={ticket ? `#${ticket.number} · ${ticket.subject}` : 'Ticket'}
      icon={LifeBuoy}
      actions={<Button size="sm" onClick={onBack}><ArrowLeft className="w-3.5 h-3.5" />All tickets</Button>}
    >
      {(error || actionError) && <Alert>{error || actionError}</Alert>}
      {loading && !ticket ? <Loading /> : ticket && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span className="font-bold text-slate-200">{ticket.organizationName}</span>
            <span>·</span>
            <span>{ticket.createdByName} {ticket.createdByEmail && `<${ticket.createdByEmail}>`}</span>
            <span>·</span>
            <span>{ticket.category}</span>
            <span>·</span>
            <span>Opened {formatDate(ticket.createdAt, true)}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-slate-400 uppercase font-semibold">Status</span>
            <Select value={ticket.status} onChange={(status) => patch('status', { status })} options={STATUS_OPTIONS} />
            <span className="text-[11px] text-slate-400 uppercase font-semibold ml-2">Priority</span>
            <Select value={ticket.priority} onChange={(priority) => patch('priority', { priority })} options={PRIORITY_OPTIONS} />
          </div>

          <div className="space-y-3">
            {ticket.messages.map((m) => (
              <div
                key={m.id}
                className={`rounded-2xl border p-3 text-xs ${m.authorRole === 'staff' ? 'bg-purple-500/10 border-purple-500/30 sm:ml-10' : 'bg-slate-950 border-slate-800 sm:mr-10'}`}
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="font-bold text-slate-200">{m.authorName}{m.authorRole === 'staff' && <span className="ml-2"><Badge tone="purple">Support</Badge></span>}</span>
                  <span className="text-slate-500" title={formatDate(m.createdAt, true)}>{timeAgo(m.createdAt)}</span>
                </div>
                <p className="text-slate-300 whitespace-pre-wrap break-words">{m.body}</p>
              </div>
            ))}
          </div>

          <form onSubmit={sendReply} className="space-y-2">
            <textarea
              rows={4}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Write a reply to the customer…"
              className="w-full bg-slate-950 border border-slate-800 focus:border-purple-500/60 outline-none rounded-xl p-3 text-xs text-slate-200 placeholder:text-slate-600"
            />
            <div className="flex justify-end gap-2">
              {ticket.status !== 'resolved' && (
                <Button type="button" size="sm" variant="success" loading={busy === 'resolve'} onClick={() => patch('resolve', { status: 'resolved' })}>Mark resolved</Button>
              )}
              <Button type="submit" size="sm" variant="primary" loading={busy === 'reply'} disabled={!reply.trim()}>
                <Send className="w-3.5 h-3.5" />Send reply
              </Button>
            </div>
          </form>
        </>
      )}
    </Card>
  )
}

export default function AdminSupport({ apiBaseUrl }) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [openId, setOpenId] = useState(null)
  const { data, loading, error, reload } = useAdminData(
    () => adminApi(`/support/tickets?${new URLSearchParams({ status })}`, { apiBaseUrl }),
    [status]
  )

  if (openId) {
    return <TicketThread ticketId={openId} apiBaseUrl={apiBaseUrl} onBack={() => { setOpenId(null); reload() }} />
  }

  const q = search.trim().toLowerCase()
  const tickets = (data?.tickets || []).filter((t) => !q || `#${t.number} ${t.subject} ${t.organizationName} ${t.createdByEmail}`.toLowerCase().includes(q))
  return (
    <Card
      title={`Support tickets (${tickets.length})`}
      icon={LifeBuoy}
      actions={
        <>
          <SearchInput value={search} onChange={setSearch} placeholder="Search #, subject, org, email…" />
          <Select value={status} onChange={setStatus} options={[{ value: '', label: 'All statuses' }, ...STATUS_OPTIONS]} />
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      {loading && !data ? <Loading /> : tickets.length === 0 ? <EmptyState>No support tickets.</EmptyState> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-slate-500 uppercase text-[10px] tracking-wide">
              <tr>
                <th className="px-3 py-2">Ticket</th>
                <th className="px-3 py-2">Organization</th>
                <th className="px-3 py-2">Priority</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {tickets.map((t) => (
                <tr key={t.id} onClick={() => setOpenId(t.id)} className="cursor-pointer hover:bg-slate-950/50">
                  <td className="px-3 py-2.5">
                    <div className="font-bold text-white">#{t.number} {t.subject}</div>
                    <div className="text-slate-500">{t.createdByEmail} · {t.messageCount} message{t.messageCount === 1 ? '' : 's'}{t.awaitingStaff && t.status !== 'closed' ? ' · awaiting reply' : ''}</div>
                  </td>
                  <td className="px-3 py-2.5 text-slate-300">{t.organizationName}</td>
                  <td className="px-3 py-2.5"><Badge tone={TICKET_PRIORITY_TONES[t.priority]}>{t.priority}</Badge></td>
                  <td className="px-3 py-2.5"><Badge tone={TICKET_STATUS_TONES[t.status]}>{t.status}</Badge></td>
                  <td className="px-3 py-2.5 text-slate-400" title={formatDate(t.updatedAt, true)}>{timeAgo(t.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
