import React, { useEffect, useState } from 'react'
import { Building, Ban, CheckCircle2, Trash2, CreditCard, Pencil, Server, FolderGit2, Users } from 'lucide-react'
import { adminApi, formatDate, timeAgo } from './adminApi'
import {
  Card, Badge, StatusBadge, Button, SearchInput, Select, Modal, ConfirmDialog, Field, TextInput,
  Alert, EmptyState, Loading, useAdminData
} from './AdminUI'

const ORG_ROLES = ['OWNER', 'ADMIN', 'DEVELOPER', 'VIEWER']

function OrgDetailModal({ orgId, plans, onClose, onChanged, apiBaseUrl }) {
  const { data, loading, error, reload } = useAdminData(
    () => (orgId ? adminApi(`/organizations/${orgId}`, { apiBaseUrl }) : Promise.resolve(null)),
    [orgId]
  )
  const [planForm, setPlanForm] = useState({ planId: 'FREE', status: 'active', periodDays: 30 })
  const [name, setName] = useState('')
  const [editingName, setEditingName] = useState(false)
  const [confirm, setConfirm] = useState(null)
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState('')

  const org = data?.organization
  const isPlatformOrg = org?.id === 'org-default'

  useEffect(() => {
    if (data) {
      setPlanForm({ planId: data.organization.planId, status: data.subscription?.status || 'active', periodDays: 30 })
      setName(data.organization.name)
    }
  }, [data])

  useEffect(() => {
    setMessage(null)
    setEditingName(false)
  }, [orgId])

  const run = async (key, fn, successText) => {
    setBusy(key)
    setMessage(null)
    try {
      await fn()
      setMessage({ tone: 'success', text: successText })
      await reload()
      onChanged()
    } catch (e) {
      setMessage({ tone: 'error', text: e.message })
      throw e
    } finally {
      setBusy('')
    }
  }

  const api = (path, method = 'POST', body = {}) => adminApi(`/organizations/${org.id}${path}`, { method, body, apiBaseUrl })

  return (
    <Modal open={!!orgId} title={org ? org.name : 'Organization'} onClose={onClose} wide>
      {loading && !data ? <Loading /> : error ? <Alert>{error}</Alert> : org && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={org.status} />
            <Badge tone="purple">{org.planId}</Badge>
            <Badge tone={org.subscriptionStatus === 'active' ? 'green' : 'amber'}>Subscription: {org.subscriptionStatus}</Badge>
            {isPlatformOrg && <Badge tone="amber">Platform organization</Badge>}
          </div>
          {org.status === 'suspended' && <Alert>Suspended {formatDate(org.suspendedAt, true)}{org.suspendedReason ? ` — ${org.suspendedReason}` : ''}. Members can't use the panel for this organization.</Alert>}
          {message && <Alert tone={message.tone}>{message.text}</Alert>}

          {editingName ? (
            <div className="flex flex-col sm:flex-row gap-2">
              <TextInput value={name} onChange={(e) => setName(e.target.value)} />
              <div className="flex gap-2 shrink-0">
                <Button onClick={() => setEditingName(false)}>Cancel</Button>
                <Button variant="primary" loading={busy === 'name'} onClick={() => run('name', () => api('', 'PATCH', { name }), 'Organization renamed.').then(() => setEditingName(false)).catch(() => {})}>Save</Button>
              </div>
            </div>
          ) : (
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 text-xs">
              {[
                ['Owner', org.ownerEmail || '—'],
                ['Created', formatDate(org.createdAt)],
                ['Period ends', formatDate(org.currentPeriodEnd)],
                ['ID', <span className="font-mono">{org.id}</span>]
              ].map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className="text-slate-200 font-semibold break-all">{v}</dd>
                </div>
              ))}
            </dl>
          )}

          <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4 space-y-3">
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 flex items-center gap-1.5"><CreditCard className="w-3.5 h-3.5" />Subscription</h4>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
              <Field label="Plan">
                <Select value={planForm.planId} onChange={(v) => setPlanForm({ ...planForm, planId: v })} className="w-full"
                  options={plans.map((p) => ({ value: p.id, label: `${p.name} ($${p.priceMonthly})` }))} />
              </Field>
              <Field label="Status">
                <Select value={planForm.status} onChange={(v) => setPlanForm({ ...planForm, status: v })} className="w-full"
                  options={['active', 'trialing', 'past_due', 'canceled'].map((s) => ({ value: s, label: s.replace('_', ' ') }))} />
              </Field>
              <Field label="Period (days)">
                <TextInput type="number" min={1} max={3650} value={planForm.periodDays} onChange={(e) => setPlanForm({ ...planForm, periodDays: e.target.value })} />
              </Field>
              <Button variant="primary" loading={busy === 'plan'} onClick={() => run('plan', () => api('/plan', 'POST', planForm), 'Subscription updated.').catch(() => {})}>Apply</Button>
            </div>
            <p className="text-[11px] text-slate-500">Manual assignment — no payment is taken. Use it for comped, trial or invoiced customers.</p>
          </div>

          <div className="space-y-2">
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 flex items-center gap-1.5"><Users className="w-3.5 h-3.5" />Members ({data.members.length})</h4>
            <div className="divide-y divide-slate-800/70 text-xs">
              {data.members.map((m) => (
                <div key={m.userId} className="py-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-slate-200 font-semibold truncate">{m.fullName}</div>
                    <div className="text-slate-500 truncate">{m.email}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {m.status === 'suspended' && <Badge tone="red">Suspended</Badge>}
                    <Select
                      value={m.role}
                      onChange={(role) => {
                        if (role === 'OWNER') {
                          setConfirm({
                            title: 'Transfer ownership?', message: `${m.email} will become the owner of ${org.name}. The current owner becomes an ADMIN.`,
                            confirmLabel: 'Transfer', variant: 'warning',
                            onConfirm: () => run('role', () => api(`/members/${m.userId}/role`, 'POST', { role }), 'Ownership transferred.')
                          })
                        } else {
                          run('role', () => api(`/members/${m.userId}/role`, 'POST', { role }), 'Member role updated.').catch(() => {})
                        }
                      }}
                      options={ORG_ROLES.map((r) => ({ value: r, label: r }))}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 flex items-center gap-1.5"><Server className="w-3.5 h-3.5" />Servers ({data.servers.length})</h4>
              {data.servers.length === 0 ? <EmptyState>No servers.</EmptyState> : data.servers.map((s) => (
                <div key={s.id} className="text-xs flex justify-between gap-2 py-1">
                  <span className="text-slate-200 truncate">{s.name}</span>
                  <span className="text-slate-500 font-mono shrink-0">{s.ipAddress}</span>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 flex items-center gap-1.5"><FolderGit2 className="w-3.5 h-3.5" />Projects ({data.projects.length})</h4>
              {data.projects.length === 0 ? <EmptyState>No projects.</EmptyState> : data.projects.map((p) => (
                <div key={p.id} className="text-xs flex justify-between gap-2 py-1">
                  <span className="text-slate-200 truncate">{p.name}</span>
                  <span className="text-slate-500 truncate">{p.domain || p.path}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            {!editingName && <Button size="sm" onClick={() => setEditingName(true)}><Pencil className="w-3.5 h-3.5" />Rename</Button>}
            {!isPlatformOrg && (org.status === 'suspended' ? (
              <Button size="sm" variant="success" loading={busy === 'activate'} onClick={() => run('activate', () => api('/activate'), 'Organization reactivated.').catch(() => {})}>
                <CheckCircle2 className="w-3.5 h-3.5" />Reactivate
              </Button>
            ) : (
              <Button size="sm" variant="danger" onClick={() => setConfirm({
                title: 'Suspend organization?', message: `Members of ${org.name} will be blocked from using the panel for this organization. Their sites keep running.`,
                confirmLabel: 'Suspend', withReason: true,
                onConfirm: (reason) => run('suspend', () => api('/suspend', 'POST', { reason }), 'Organization suspended.')
              })}>
                <Ban className="w-3.5 h-3.5" />Suspend
              </Button>
            ))}
            {!isPlatformOrg && (
              <Button size="sm" variant="danger" onClick={() => setConfirm({
                title: 'Delete organization?',
                message: `This removes ${org.name} with its memberships, subscription, and server and project records from the platform. Nothing on the actual servers is changed. This cannot be undone.`,
                confirmLabel: 'Delete organization', requireText: org.name,
                onConfirm: async () => { await api('', 'DELETE'); onChanged(); onClose() }
              })}>
                <Trash2 className="w-3.5 h-3.5" />Delete
              </Button>
            )}
          </div>

          <div className="space-y-2">
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Recent activity</h4>
            {data.activity.length === 0 ? <EmptyState>No activity recorded.</EmptyState> : (
              <div className="divide-y divide-slate-800/70 text-xs max-h-48 overflow-y-auto">
                {data.activity.map((l) => (
                  <div key={l.id} className="py-2 flex items-center justify-between gap-3">
                    <span className="font-mono text-slate-300 truncate">{l.action}</span>
                    <span className="text-slate-500 shrink-0">{timeAgo(l.timestamp)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      <ConfirmDialog open={!!confirm} {...(confirm || {})} onClose={() => setConfirm(null)} />
    </Modal>
  )
}

export default function AdminOrganizations({ apiBaseUrl }) {
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [status, setStatus] = useState('')
  const [planId, setPlanId] = useState('')
  const [selectedId, setSelectedId] = useState(null)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250)
    return () => clearTimeout(t)
  }, [search])

  const { data, loading, error, reload } = useAdminData(
    () => adminApi(`/organizations?${new URLSearchParams({ search: debounced, status, planId })}`, { apiBaseUrl }),
    [debounced, status, planId]
  )
  const { data: planData } = useAdminData(() => adminApi('/plans', { apiBaseUrl }), [])
  const plans = planData?.plans || []
  const orgs = data?.organizations || []

  return (
    <Card
      title={`Organizations (${orgs.length})`}
      icon={Building}
      actions={
        <>
          <SearchInput value={search} onChange={setSearch} placeholder="Search name, owner or ID" />
          <Select value={status} onChange={setStatus} options={[{ value: '', label: 'All statuses' }, { value: 'active', label: 'Active' }, { value: 'suspended', label: 'Suspended' }]} />
          <Select value={planId} onChange={setPlanId} options={[{ value: '', label: 'All plans' }, ...plans.map((p) => ({ value: p.id, label: p.name }))]} />
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      {loading && !data ? <Loading /> : orgs.length === 0 ? <EmptyState>No organizations match these filters.</EmptyState> : (
        <div className="overflow-x-auto -mx-4 sm:mx-0">
          <table className="w-full min-w-[760px] text-left text-xs text-slate-300">
            <thead className="text-slate-500 uppercase text-[10px] tracking-wider border-b border-slate-800">
              <tr>
                <th className="px-3 py-2.5">Organization</th>
                <th className="px-3 py-2.5">Owner</th>
                <th className="px-3 py-2.5">Plan</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5 text-right">Members</th>
                <th className="px-3 py-2.5 text-right">Servers</th>
                <th className="px-3 py-2.5 text-right">Projects</th>
                <th className="px-3 py-2.5">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {orgs.map((o) => (
                <tr key={o.id} onClick={() => setSelectedId(o.id)} className="hover:bg-slate-950/60 cursor-pointer transition">
                  <td className="px-3 py-2.5 font-bold text-white">{o.name}</td>
                  <td className="px-3 py-2.5 text-slate-400">{o.ownerEmail || '—'}</td>
                  <td className="px-3 py-2.5"><Badge tone="purple">{o.planId}</Badge></td>
                  <td className="px-3 py-2.5"><StatusBadge status={o.status} /></td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{o.memberCount}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{o.serverCount}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{o.projectCount}</td>
                  <td className="px-3 py-2.5 text-slate-400">{formatDate(o.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <OrgDetailModal orgId={selectedId} plans={plans} onClose={() => setSelectedId(null)} onChanged={reload} apiBaseUrl={apiBaseUrl} />
    </Card>
  )
}
