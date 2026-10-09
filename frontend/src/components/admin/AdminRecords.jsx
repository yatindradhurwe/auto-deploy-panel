import React, { useEffect, useState } from 'react'
import { Server, CreditCard, ShieldCheck, ChevronDown, ChevronRight } from 'lucide-react'
import { adminApi, formatDate, timeAgo } from './adminApi'
import { Card, Badge, SearchInput, Select, Alert, EmptyState, Loading, useAdminData } from './AdminUI'

function useDebounced(value, ms = 250) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

export function AdminServers({ apiBaseUrl }) {
  const { data, loading, error } = useAdminData(() => adminApi('/servers', { apiBaseUrl }), [])
  const [search, setSearch] = useState('')
  const q = search.toLowerCase()
  const servers = (data?.servers || []).filter((s) => !q || `${s.name} ${s.ipAddress} ${s.hostname} ${s.organizationName}`.toLowerCase().includes(q))

  return (
    <Card title={`Servers (${servers.length})`} icon={Server} actions={<SearchInput value={search} onChange={setSearch} placeholder="Search name, IP or org" />}>
      {error && <Alert>{error}</Alert>}
      {loading && !data ? <Loading /> : servers.length === 0 ? <EmptyState>No servers.</EmptyState> : (
        <div className="overflow-x-auto -mx-4 sm:mx-0">
          <table className="w-full min-w-[720px] text-left text-xs text-slate-300">
            <thead className="text-slate-500 uppercase text-[10px] tracking-wider border-b border-slate-800">
              <tr>
                <th className="px-3 py-2.5">Server</th>
                <th className="px-3 py-2.5">Address</th>
                <th className="px-3 py-2.5">Organization</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">Auth</th>
                <th className="px-3 py-2.5">Last seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {servers.map((s) => (
                <tr key={s.id}>
                  <td className="px-3 py-2.5">
                    <div className="font-bold text-white">{s.name}</div>
                    <div className="text-slate-500">{s.os || '—'}</div>
                  </td>
                  <td className="px-3 py-2.5 font-mono">{s.username ? `${s.username}@` : ''}{s.ipAddress}{s.port ? `:${s.port}` : ''}</td>
                  <td className="px-3 py-2.5 text-slate-400">{s.organizationName}</td>
                  <td className="px-3 py-2.5"><Badge tone={s.status === 'online' ? 'green' : 'slate'}>{s.status || 'unknown'}</Badge></td>
                  <td className="px-3 py-2.5">
                    <span className="flex gap-1">
                      {s.hasPrivateKey && <Badge tone="green">SSH key</Badge>}
                      {s.hasPassword && <Badge tone="amber">Password</Badge>}
                      {s.hasAgentToken && <Badge tone="cyan">Agent</Badge>}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-slate-400">{timeAgo(s.lastSeen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

const SUB_TONES = { active: 'green', trialing: 'cyan', past_due: 'amber', canceled: 'red' }

export function AdminSubscriptions({ apiBaseUrl }) {
  const { data, loading, error } = useAdminData(() => adminApi('/subscriptions', { apiBaseUrl }), [])
  const [status, setStatus] = useState('')
  const subs = (data?.subscriptions || []).filter((s) => !status || s.status === status)
  const mrr = subs.filter((s) => s.status === 'active').reduce((sum, s) => sum + Number(s.priceMonthly || 0), 0)

  return (
    <Card
      title={`Subscriptions (${subs.length})`}
      icon={CreditCard}
      actions={
        <>
          <span className="text-xs text-slate-400">Active list-price MRR: <span className="text-white font-bold">${mrr.toLocaleString()}</span></span>
          <Select value={status} onChange={setStatus} options={[{ value: '', label: 'All statuses' }, ...Object.keys(SUB_TONES).map((s) => ({ value: s, label: s.replace('_', ' ') }))]} />
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      <p className="text-[11px] text-slate-500">No payment gateway is connected yet; plans are assigned manually from Organizations. Change a plan by opening the organization.</p>
      {loading && !data ? <Loading /> : subs.length === 0 ? <EmptyState>No subscriptions.</EmptyState> : (
        <div className="overflow-x-auto -mx-4 sm:mx-0">
          <table className="w-full min-w-[640px] text-left text-xs text-slate-300">
            <thead className="text-slate-500 uppercase text-[10px] tracking-wider border-b border-slate-800">
              <tr>
                <th className="px-3 py-2.5">Organization</th>
                <th className="px-3 py-2.5">Plan</th>
                <th className="px-3 py-2.5 text-right">Price</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">Period ends</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {subs.map((s) => (
                <tr key={s.organizationId}>
                  <td className="px-3 py-2.5 font-bold text-white">{s.organizationName}</td>
                  <td className="px-3 py-2.5"><Badge tone="purple">{s.planName}</Badge></td>
                  <td className="px-3 py-2.5 text-right tabular-nums">${s.priceMonthly}</td>
                  <td className="px-3 py-2.5"><Badge tone={SUB_TONES[s.status] || 'slate'}>{s.status}</Badge></td>
                  <td className="px-3 py-2.5 text-slate-400">{formatDate(s.currentPeriodEnd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
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
