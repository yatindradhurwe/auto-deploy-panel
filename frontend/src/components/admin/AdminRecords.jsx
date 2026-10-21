import React, { useEffect, useState } from 'react'
import {
  Server, CreditCard, ShieldCheck, ChevronDown, ChevronRight, Ban, CheckCircle2, Trash2, Pencil, FolderGit2,
  Stethoscope, Wrench, CalendarPlus, XCircle, RotateCcw, ArrowRightLeft, AlertTriangle, Clock, DollarSign, Building
} from 'lucide-react'
import { adminApi, formatDate, timeAgo } from './adminApi'
import {
  Card, Badge, Button, SearchInput, Select, Alert, EmptyState, Loading, Modal, ConfirmDialog, Field, TextInput,
  StatCard, UsageBar, useAdminData
} from './AdminUI'
import { formatMoney } from '../../utils/razorpay'

function useDebounced(value, ms = 250) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

const SERVER_FILTERS = [
  { value: '', label: 'All servers' },
  { value: 'online', label: 'Online' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'orphaned', label: 'No organization' }
]

function ServerStatusBadge({ server }) {
  if (server.blocked) return <Badge tone="red"><Ban className="w-3 h-3 mr-1" />Blocked</Badge>
  return <Badge tone={server.status === 'online' ? 'green' : 'slate'}>{server.status || 'unknown'}</Badge>
}

function ServerDetailModal({ serverId, organizations, onClose, onChanged, apiBaseUrl }) {
  const { data, loading, error, reload } = useAdminData(
    () => (serverId ? adminApi(`/servers/${serverId}`, { apiBaseUrl }) : Promise.resolve(null)),
    [serverId]
  )
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ name: '', organizationId: '', notes: '' })
  const [message, setMessage] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => { setEditing(false); setMessage(null) }, [serverId])

  const server = data?.server
  const run = async (fn) => {
    const res = await fn()
    setMessage({ tone: 'success', text: res.message || 'Done.' })
    await reload()
    onChanged()
  }

  const save = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const body = { name: form.name, notes: form.notes }
      if (form.organizationId !== server.organizationId) body.organizationId = form.organizationId
      await run(() => adminApi(`/servers/${server.id}`, { method: 'PATCH', body, apiBaseUrl }))
      setEditing(false)
    } catch (e) {
      setMessage({ tone: 'error', text: e.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={!!serverId} title={server ? (server.name || server.id) : 'Server'} onClose={onClose} wide>
      {loading && !data ? <Loading /> : error ? <Alert>{error}</Alert> : server && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <ServerStatusBadge server={server} />
            {server.isLocal && <Badge tone="amber">Platform host</Badge>}
            {server.orphaned && <Badge tone="red">Organization deleted</Badge>}
            {server.hasPrivateKey && <Badge tone="green">SSH key</Badge>}
            {server.hasPassword && <Badge tone="amber">Password</Badge>}
            {server.hasAgentToken && <Badge tone="cyan">Agent</Badge>}
          </div>

          {server.blocked && (
            <Alert>Blocked {formatDate(server.blockedAt, true)}{server.blockedReason ? ` — ${server.blockedReason}` : ''}. Nothing can connect to it until it is unblocked.</Alert>
          )}
          {message && <Alert tone={message.tone}>{message.text}</Alert>}

          {editing ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Name"><TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="Organization" hint={form.organizationId !== server.organizationId ? 'Its project records move with it.' : undefined}>
                <Select
                  value={form.organizationId}
                  onChange={(v) => setForm({ ...form, organizationId: v })}
                  className="w-full"
                  options={[
                    ...(server.orphaned ? [{ value: server.organizationId || '', label: `${server.organizationId || 'none'} (deleted)` }] : []),
                    ...organizations.map((o) => ({ value: o.id, label: o.name }))
                  ]}
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Admin notes" hint="Only visible in this console.">
                  <textarea
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    rows={3}
                    maxLength={1000}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-purple-500/60 outline-none rounded-xl px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600"
                    placeholder="e.g. Customer asked us to pause this box until invoice #120 is paid"
                  />
                </Field>
              </div>
              <div className="sm:col-span-2 flex justify-end gap-2">
                <Button onClick={() => setEditing(false)}>Cancel</Button>
                <Button variant="primary" loading={busy} onClick={save}>Save</Button>
              </div>
            </div>
          ) : (
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-xs">
              {[
                ['Address', <span className="font-mono">{server.username ? `${server.username}@` : ''}{server.ipAddress || server.hostname || '—'}{server.port ? `:${server.port}` : ''}</span>],
                ['Organization', server.organizationName],
                ['Operating system', server.os || '—'],
                ['Type', server.serverType || 'vps'],
                ['Server ID', <span className="font-mono">{server.id}</span>],
                ['Added', formatDate(server.createdAt, true)],
                ['Last seen', timeAgo(server.lastSeen)],
                ['Projects', server.projectCount]
              ].map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className="text-slate-200 font-semibold break-all">{v}</dd>
                </div>
              ))}
              {server.adminNotes && (
                <div className="sm:col-span-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                  <dt className="text-slate-500 mb-1">Admin notes</dt>
                  <dd className="text-slate-300 whitespace-pre-wrap">{server.adminNotes}</dd>
                </div>
              )}
            </dl>
          )}

          <div className="space-y-2">
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Actions</h4>
            <div className="flex flex-wrap gap-2">
              {!editing && (
                <Button size="sm" onClick={() => { setForm({ name: server.name || '', organizationId: server.organizationId || '', notes: server.adminNotes || '' }); setEditing(true) }}>
                  <Pencil className="w-3.5 h-3.5" />Edit
                </Button>
              )}
              {!server.isLocal && (server.blocked ? (
                <Button size="sm" variant="success" onClick={() => setConfirm({
                  title: 'Unblock server?', message: `${server.name} can be used again from the panel, SSH console, deploys and auto-updates.`,
                  confirmLabel: 'Unblock', variant: 'success',
                  onConfirm: () => run(() => adminApi(`/servers/${server.id}/unblock`, { method: 'POST', body: {}, apiBaseUrl }))
                })}>
                  <CheckCircle2 className="w-3.5 h-3.5" />Unblock
                </Button>
              ) : (
                <Button size="sm" variant="warning" onClick={() => setConfirm({
                  title: 'Block server?', message: `Every connection to ${server.name} (studio, SSH console, deploys, auto-updates) will be refused for its organization until you unblock it. Apps already running on it keep running.`,
                  confirmLabel: 'Block server', variant: 'warning', withReason: true,
                  onConfirm: (reason) => run(() => adminApi(`/servers/${server.id}/block`, { method: 'POST', body: { reason }, apiBaseUrl }))
                })}>
                  <Ban className="w-3.5 h-3.5" />Block
                </Button>
              ))}
              {!(server.isLocal && server.ipAddress) && (
                <Button size="sm" variant="danger" onClick={() => setConfirm({
                  title: 'Remove server?',
                  message: `This removes ${server.name || server.id} and its ${server.projectCount} project record(s) from the platform. Nothing on the machine itself is changed, and its apps keep running.`,
                  confirmLabel: 'Remove server', requireText: server.name || server.id,
                  onConfirm: async () => { await adminApi(`/servers/${server.id}`, { method: 'DELETE', apiBaseUrl }); onChanged(); onClose() }
                })}>
                  <Trash2 className="w-3.5 h-3.5" />Remove
                </Button>
              )}
            </div>
            {server.isLocal && server.ipAddress && <p className="text-[11px] text-slate-500">This is the machine the panel runs on, so it can't be blocked, moved or removed.</p>}
          </div>

          <div className="space-y-2">
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 flex items-center gap-1.5"><FolderGit2 className="w-3.5 h-3.5" />Projects</h4>
            {data.projects.length === 0 ? <EmptyState>No projects registered on this server.</EmptyState> : (
              <div className="divide-y divide-slate-800/70 text-xs">
                {data.projects.map((p) => (
                  <div key={p.id} className="py-2 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-slate-200 font-semibold truncate">{p.name}</div>
                      <div className="text-slate-500 font-mono truncate">{p.domain || p.path}</div>
                    </div>
                    <span className="flex gap-1.5 shrink-0">
                      {p.framework && <Badge>{p.framework}</Badge>}
                      <Badge tone={p.status === 'active' ? 'green' : 'slate'}>{p.status || 'unknown'}</Badge>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {data.activity.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Admin activity</h4>
              <div className="divide-y divide-slate-800/70 text-xs max-h-48 overflow-y-auto">
                {data.activity.map((l) => (
                  <div key={l.id} className="py-2 flex items-center justify-between gap-3">
                    <span className="font-mono text-slate-300 truncate">{l.action}</span>
                    <span className="text-slate-500 shrink-0">{timeAgo(l.timestamp)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      <ConfirmDialog open={!!confirm} {...(confirm || {})} onClose={() => setConfirm(null)} />
    </Modal>
  )
}

export function AdminServers({ apiBaseUrl }) {
  const { data, loading, error, reload } = useAdminData(() => adminApi('/servers', { apiBaseUrl }), [])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const q = search.toLowerCase()
  const all = data?.servers || []
  const servers = all
    .filter((s) => !q || `${s.name} ${s.ipAddress} ${s.hostname} ${s.organizationName} ${s.id}`.toLowerCase().includes(q))
    .filter((s) => !filter || (filter === 'blocked' ? s.blocked : filter === 'orphaned' ? s.orphaned : !s.blocked && s.status === filter))

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="Servers" value={all.length} icon={Server} onClick={() => setFilter('')} />
        <StatCard label="Online" value={all.filter((s) => !s.blocked && s.status === 'online').length} icon={CheckCircle2} tone="text-emerald-400" onClick={() => setFilter('online')} />
        <StatCard label="Blocked" value={all.filter((s) => s.blocked).length} icon={Ban} tone="text-rose-400" onClick={() => setFilter('blocked')} />
        <StatCard label="No organization" value={all.filter((s) => s.orphaned).length} hint="Leftover records" icon={AlertTriangle} tone="text-amber-400" alert={all.some((s) => s.orphaned)} onClick={() => setFilter('orphaned')} />
      </div>

      <Card
        title={`Servers (${servers.length})`}
        subtitle="Click a server to edit, block, move or remove it"
        icon={Server}
        actions={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder="Search name, IP or org" />
            <Select value={filter} onChange={setFilter} options={SERVER_FILTERS} />
          </>
        }
      >
        {error && <Alert>{error}</Alert>}
        {loading && !data ? <Loading /> : servers.length === 0 ? <EmptyState icon={Server}>No servers match.</EmptyState> : (
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full min-w-[760px] text-left text-xs text-slate-300">
              <thead className="text-slate-500 uppercase text-[10px] tracking-wider border-b border-slate-800">
                <tr>
                  <th className="px-3 py-2.5">Server</th>
                  <th className="px-3 py-2.5">Address</th>
                  <th className="px-3 py-2.5">Organization</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5 text-right">Projects</th>
                  <th className="px-3 py-2.5">Last seen</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {servers.map((s) => (
                  <tr key={s.id} onClick={() => setSelectedId(s.id)} className={`hover:bg-slate-950/60 cursor-pointer transition ${s.blocked ? 'opacity-80' : ''}`}>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <span className={`p-2 rounded-xl border ${s.blocked ? 'bg-rose-500/10 border-rose-500/30 text-rose-300' : 'bg-slate-950 border-slate-800 text-cyan-400'}`}><Server className="w-3.5 h-3.5" /></span>
                        <div className="min-w-0">
                          <div className="font-bold text-white truncate">{s.name || <span className="text-slate-500 font-mono">{s.id}</span>}</div>
                          <div className="text-slate-500 truncate">{s.os || '—'}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 font-mono">{s.ipAddress || s.hostname ? <>{s.username ? `${s.username}@` : ''}{s.ipAddress || s.hostname}{s.port ? `:${s.port}` : ''}</> : '—'}</td>
                    <td className="px-3 py-2.5">{s.orphaned ? <Badge tone="red">deleted · {s.organizationId || 'none'}</Badge> : <span className="text-slate-400">{s.organizationName}</span>}</td>
                    <td className="px-3 py-2.5"><ServerStatusBadge server={s} /></td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{s.projectCount}</td>
                    <td className="px-3 py-2.5 text-slate-400">{timeAgo(s.lastSeen)}</td>
                    <td className="px-3 py-2.5 text-right"><ChevronRight className="w-4 h-4 text-slate-600 inline" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ServerDetailModal serverId={selectedId} organizations={data?.organizations || []} onClose={() => setSelectedId(null)} onChanged={reload} apiBaseUrl={apiBaseUrl} />
    </div>
  )
}

const SUB_TONES = { active: 'green', trialing: 'cyan', past_due: 'amber', canceled: 'red', expired: 'red' }
const SEVERITY_TONES = { high: 'red', medium: 'amber', low: 'slate' }

function SubscriptionHealth({ apiBaseUrl, onFixed }) {
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const check = async () => {
    setBusy('check'); setError(''); setMessage('')
    try { setResult(await adminApi('/subscriptions/health', { apiBaseUrl })) } catch (e) { setError(e.message) } finally { setBusy('') }
  }
  const fix = async () => {
    setBusy('fix'); setError('')
    try {
      const res = await adminApi('/subscriptions/health/fix', { method: 'POST', body: {}, apiBaseUrl })
      setResult(res)
      setMessage(res.message)
      onFixed()
    } catch (e) { setError(e.message) } finally { setBusy('') }
  }

  useEffect(() => { check() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const issues = result?.issues || []
  return (
    <Card
      title="Subscription health check"
      subtitle={result ? `Last checked ${timeAgo(result.checkedAt)}` : 'Looks for expired, broken and orphaned billing records'}
      icon={Stethoscope}
      actions={
        <>
          <Button size="sm" loading={busy === 'check'} onClick={check}><Stethoscope className="w-3.5 h-3.5" />Run check</Button>
          {result?.fixableCount > 0 && (
            <Button size="sm" variant="primary" loading={busy === 'fix'} onClick={fix}><Wrench className="w-3.5 h-3.5" />Fix {result.fixableCount} issue{result.fixableCount === 1 ? '' : 's'}</Button>
          )}
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      {message && <Alert tone="success">{message}</Alert>}
      {!result ? <Loading /> : issues.length === 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5 text-xs text-emerald-200">
          <CheckCircle2 className="w-4 h-4" />Every organization has a valid subscription and no billing records are orphaned.
        </div>
      ) : (
        <div className="divide-y divide-slate-800/70 text-xs">
          {issues.map((i, n) => (
            <div key={n} className="py-2.5 flex items-start gap-3">
              <Badge tone={SEVERITY_TONES[i.severity]}>{i.severity}</Badge>
              <span className="flex-1 min-w-0 text-slate-300">{i.message}</span>
              <span className="shrink-0 text-[10px] text-slate-500">{i.fixable ? 'auto-fixable' : 'review manually'}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function ChangePlanModal({ sub, plans, onClose, onSaved, apiBaseUrl }) {
  const [form, setForm] = useState({ planId: '', status: 'active', periodDays: 30 })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (sub) { setForm({ planId: sub.planId, status: 'active', periodDays: 30 }); setError('') }
  }, [sub])

  const save = async () => {
    setBusy(true); setError('')
    try {
      await adminApi(`/organizations/${sub.organizationId}/plan`, { method: 'POST', body: form, apiBaseUrl })
      onSaved(`${sub.organizationName} is now on ${plans.find((p) => p.id === form.planId)?.name || form.planId}.`)
      onClose()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  return (
    <Modal
      open={!!sub}
      title={sub ? `Change plan · ${sub.organizationName}` : ''}
      onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save plan</Button></>}
    >
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Plan">
          <Select value={form.planId} onChange={(v) => setForm({ ...form, planId: v })} className="w-full" options={plans.map((p) => ({ value: p.id, label: p.name }))} />
        </Field>
        <Field label="Status">
          <Select value={form.status} onChange={(v) => setForm({ ...form, status: v })} className="w-full" options={['active', 'trialing', 'past_due', 'canceled'].map((s) => ({ value: s, label: s.replace('_', ' ') }))} />
        </Field>
        <Field label="Period (days)">
          <TextInput type="number" min={1} max={3650} value={form.periodDays} onChange={(e) => setForm({ ...form, periodDays: e.target.value })} />
        </Field>
      </div>
      <p className="text-[11px] text-slate-500">Starts a new billing period from today. Use “Extend” instead to add days to the current period.</p>
      {error && <Alert>{error}</Alert>}
    </Modal>
  )
}

function DaysLeft({ sub }) {
  if (sub.daysLeft === null || sub.daysLeft === undefined) return <span className="text-slate-500">—</span>
  if (sub.daysLeft < 0) return <span className="text-rose-300 font-semibold">ended {Math.abs(sub.daysLeft)}d ago</span>
  return <span className={sub.daysLeft <= 7 ? 'text-amber-300 font-semibold' : 'text-slate-400'}>{sub.daysLeft}d left</span>
}

export function AdminSubscriptions({ apiBaseUrl }) {
  const { data, loading, error, reload } = useAdminData(() => adminApi('/subscriptions', { apiBaseUrl }), [])
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [changing, setChanging] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [notice, setNotice] = useState('')
  const currency = data?.currency || 'INR'
  const all = data?.subscriptions || []
  const q = search.toLowerCase()
  const subs = all
    .filter((s) => !status || s.status === status)
    .filter((s) => !q || `${s.organizationName} ${s.ownerEmail || ''} ${s.planName}`.toLowerCase().includes(q))
  const customers = all.filter((s) => s.organizationId !== 'org-default')
  const mrr = customers.filter((s) => s.status === 'active').reduce((sum, s) => sum + Number(s.priceMonthly || 0), 0)

  const act = (path, body) => async () => {
    const res = await adminApi(path, { method: 'POST', body: body || {}, apiBaseUrl })
    setNotice(res.message || 'Done.')
    await reload()
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="Monthly revenue" value={formatMoney(mrr, currency)} hint="Active paid plans · list price" icon={DollarSign} tone="text-amber-400" onClick={() => setStatus('active')} />
        <StatCard label="Active" value={all.filter((s) => s.status === 'active' || s.status === 'trialing').length} icon={CheckCircle2} tone="text-emerald-400" onClick={() => setStatus('active')} />
        <StatCard label="Past due" value={all.filter((s) => s.status === 'past_due').length} hint={`${data?.graceDays || 7}-day grace before Free limits`} icon={Clock} tone="text-amber-400" alert={all.some((s) => s.status === 'past_due')} onClick={() => setStatus('past_due')} />
        <StatCard label="Expired / canceled" value={all.filter((s) => s.status === 'expired' || s.status === 'canceled').length} hint="Running on Free limits" icon={XCircle} tone="text-rose-400" onClick={() => setStatus('expired')} />
      </div>

      <SubscriptionHealth apiBaseUrl={apiBaseUrl} onFixed={reload} />

      <Card
        title={`Subscriptions (${subs.length})`}
        subtitle="Paid upgrades come through Razorpay; you can also assign, extend or cancel plans here"
        icon={CreditCard}
        actions={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder="Search organization or owner" />
            <Select value={status} onChange={setStatus} options={[{ value: '', label: 'All statuses' }, ...Object.keys(SUB_TONES).map((s) => ({ value: s, label: s.replace('_', ' ') }))]} />
          </>
        }
      >
        {error && <Alert>{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}
        {loading && !data ? <Loading /> : subs.length === 0 ? <EmptyState icon={CreditCard}>No subscriptions match.</EmptyState> : (
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full min-w-[980px] text-left text-xs text-slate-300">
              <thead className="text-slate-500 uppercase text-[10px] tracking-wider border-b border-slate-800">
                <tr>
                  <th className="px-3 py-2.5">Organization</th>
                  <th className="px-3 py-2.5">Plan</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">Period ends</th>
                  <th className="px-3 py-2.5 w-56">Usage</th>
                  <th className="px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {subs.map((s) => {
                  const ended = s.status === 'expired' || s.status === 'canceled'
                  return (
                    <tr key={s.organizationId} className="align-top">
                      <td className="px-3 py-3">
                        <div className="font-bold text-white flex items-center gap-1.5">
                          <Building className="w-3.5 h-3.5 text-slate-500" />{s.organizationName}
                          {s.organizationId === 'org-default' && <Badge tone="amber">Platform</Badge>}
                          {s.organizationStatus === 'suspended' && <Badge tone="red">Org suspended</Badge>}
                        </div>
                        <div className="text-slate-500 mt-0.5">{s.ownerEmail || '—'}</div>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone="purple">{s.planName}</Badge>
                        <div className="text-slate-500 mt-1 tabular-nums">{formatMoney(s.priceMonthly, currency)}/mo</div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          <Badge tone={SUB_TONES[s.status] || 'slate'}>{s.status.replace('_', ' ')}</Badge>
                          {s.cancelAtPeriodEnd && !ended && <Badge tone="amber">cancels at end</Badge>}
                        </div>
                        {s.storedStatus !== s.status && <div className="text-[10px] text-slate-500 mt-1">stored as {s.storedStatus}</div>}
                      </td>
                      <td className="px-3 py-3">
                        <div className="text-slate-300">{formatDate(s.currentPeriodEnd)}</div>
                        <div className="mt-0.5"><DaysLeft sub={s} /></div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="space-y-1.5">
                          <UsageBar label="Servers" {...s.usage.servers} />
                          <UsageBar label="Projects" {...s.usage.projects} />
                          <UsageBar label="Team" {...s.usage.teamMembers} />
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <Button size="sm" onClick={() => setChanging(s)}><ArrowRightLeft className="w-3.5 h-3.5" />Plan</Button>
                          <Button size="sm" onClick={() => setConfirm({
                            title: `Extend ${s.organizationName}?`, message: `Adds 30 days to the current period${ended || (s.daysLeft ?? 0) < 0 ? ' (counted from today, since it already ended)' : ''} and marks the subscription active.`,
                            confirmLabel: 'Extend 30 days', variant: 'primary', onConfirm: act(`/subscriptions/${s.organizationId}/extend`, { days: 30 })
                          })}><CalendarPlus className="w-3.5 h-3.5" />+30d</Button>
                          {ended || s.cancelAtPeriodEnd ? (
                            <Button size="sm" variant="success" onClick={() => setConfirm({
                              title: `Reactivate ${s.organizationName}?`, message: ended ? 'Starts a new 30-day period on the same plan.' : 'Removes the pending cancellation so the subscription renews as normal.',
                              confirmLabel: 'Reactivate', variant: 'success', onConfirm: act(`/subscriptions/${s.organizationId}/reactivate`)
                            })}><RotateCcw className="w-3.5 h-3.5" />Reactivate</Button>
                          ) : s.organizationId !== 'org-default' && (
                            <Button size="sm" variant="danger" onClick={() => setConfirm({
                              title: `Cancel ${s.organizationName}'s subscription?`,
                              message: `It stays on ${s.planName} until ${formatDate(s.currentPeriodEnd)}, then drops to Free plan limits. Nothing is deleted.`,
                              confirmLabel: 'Cancel at period end', onConfirm: act(`/subscriptions/${s.organizationId}/cancel`, { immediately: false })
                            })}><XCircle className="w-3.5 h-3.5" />Cancel</Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ChangePlanModal sub={changing} plans={data?.plans || []} onClose={() => setChanging(null)} onSaved={(m) => { setNotice(m); reload() }} apiBaseUrl={apiBaseUrl} />
      <ConfirmDialog open={!!confirm} {...(confirm || {})} onClose={() => setConfirm(null)} />
    </div>
  )
}

export function AdminAuditLog({ apiBaseUrl }) {
  const [search, setSearch] = useState('')
  const [scope, setScope] = useState('')
  const [expanded, setExpanded] = useState(null)
  const debounced = useDebounced(search)
  const { data, loading, error } = useAdminData(
    () => adminApi(`/audit-logs?${new URLSearchParams({ search: debounced, limit: 500 })}`, { apiBaseUrl }),
    [debounced]
  )
  const logs = (data?.logs || []).filter((l) => !scope || (scope === 'admin' ? l.action.startsWith('ADMIN_') : !l.action.startsWith('ADMIN_')))

  return (
    <Card
      title={`Audit trail (${logs.length})`}
      icon={ShieldCheck}
      actions={
        <>
          <SearchInput value={search} onChange={setSearch} placeholder="Search action, email, ID…" />
          <Select value={scope} onChange={setScope} options={[{ value: '', label: 'All events' }, { value: 'admin', label: 'Admin actions' }, { value: 'user', label: 'User activity' }]} />
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      {loading && !data ? <Loading /> : logs.length === 0 ? <EmptyState>No events match.</EmptyState> : (
        <div className="divide-y divide-slate-800/60 text-xs">
          {logs.map((l) => {
            const open = expanded === l.id
            const hasDetails = l.details && Object.keys(l.details).length > 0
            return (
              <div key={l.id}>
                <button
                  onClick={() => hasDetails && setExpanded(open ? null : l.id)}
                  className={`w-full py-2.5 flex items-center gap-3 text-left ${hasDetails ? 'cursor-pointer hover:bg-slate-950/50' : 'cursor-default'}`}
                >
                  <span className="w-3.5 shrink-0 text-slate-500">{hasDetails && (open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />)}</span>
                  <span className={`font-mono font-bold truncate ${l.action.startsWith('ADMIN_') ? 'text-purple-300' : 'text-slate-200'}`}>{l.action}</span>
                  <span className="text-slate-500 truncate hidden md:inline">{l.details?.email || l.resourceId}</span>
                  <span className="ml-auto text-slate-500 shrink-0 hidden sm:inline">{l.ip}</span>
                  <span className="text-slate-400 shrink-0" title={formatDate(l.timestamp, true)}>{timeAgo(l.timestamp)}</span>
                </button>
                {open && (
                  <pre className="mb-3 ml-6 p-3 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-slate-300 overflow-x-auto">
                    {JSON.stringify({ user: l.userId, organization: l.organizationId, resource: `${l.resourceType}:${l.resourceId}`, at: l.timestamp, ...l.details }, null, 2)}
                  </pre>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
