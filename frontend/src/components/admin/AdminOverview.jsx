import React, { useState } from 'react'
import { Users, Building, Server, CreditCard, UserX, UserPlus, Activity, FolderGit2, DollarSign, ShieldCheck, Megaphone, Wrench, LifeBuoy } from 'lucide-react'
import { adminApi, timeAgo } from './adminApi'
import { Card, StatCard, Badge, StatusBadge, Loading, Alert, EmptyState, Button, useAdminData } from './AdminUI'

/**
 * Daily signups for the last 14 days: single-series bars with a hover tooltip.
 */
function SignupChart({ trend }) {
  const [hover, setHover] = useState(null)
  const max = Math.max(1, ...trend.map((d) => d.count))
  const total = trend.reduce((sum, d) => sum + d.count, 0)

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <span className="text-2xl font-black text-white tabular-nums">{total}</span>
        <span className="text-[11px] text-slate-500">new accounts · last 14 days</span>
      </div>
      <div className="relative" role="img" aria-label={`Daily signups: ${trend.map((d) => `${d.date} ${d.count}`).join(', ')}`}>
        <div className="flex items-end gap-[2px] h-32 border-b border-slate-700">
          {trend.map((d, i) => (
            <div
              key={d.date}
              className="flex-1 h-full flex items-end cursor-default"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <div
                className={`w-full rounded-t-[4px] transition-colors ${hover === i ? 'bg-purple-300' : 'bg-purple-500'}`}
                style={{ height: d.count ? `${Math.max(4, (d.count / max) * 100)}%` : '0%' }}
              />
            </div>
          ))}
        </div>
        {hover !== null && (
          <div
            className="absolute -top-2 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-[11px] whitespace-nowrap pointer-events-none shadow-xl"
            style={{ left: `${((hover + 0.5) / trend.length) * 100}%`, transform: 'translate(-50%, -100%)' }}
          >
            <div className="text-slate-400">{new Date(trend[hover].date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>
            <div className="text-white font-bold">{trend[hover].count} signup{trend[hover].count === 1 ? '' : 's'}</div>
          </div>
        )}
        <div className="flex justify-between text-[10px] text-slate-500 mt-1.5">
          <span>{new Date(trend[0].date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
          <span>Today</span>
        </div>
      </div>
    </div>
  )
}

function PlanBreakdown({ breakdown }) {
  const entries = Object.entries(breakdown).sort((a, b) => b[1] - a[1])
  const max = Math.max(1, ...entries.map(([, n]) => n))
  if (entries.length === 0) return <EmptyState>No active subscriptions yet.</EmptyState>
  return (
    <div className="space-y-3">
      {entries.map(([plan, count]) => (
        <div key={plan} className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-slate-300 font-semibold">{plan}</span>
            <span className="text-white font-bold tabular-nums">{count}</span>
          </div>
          <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full bg-purple-500 rounded-full" style={{ width: `${(count / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function AdminOverview({ apiBaseUrl, onNavigate }) {
  const { data, loading, error, reload } = useAdminData(() => adminApi('/overview', { apiBaseUrl }), [])

  if (loading && !data) return <Loading />
  if (error) return <Alert>{error}</Alert>

  const m = data.metrics
  const s = data.settings || {}

  return (
    <div className="space-y-6">
      {(s.maintenanceMode || !s.allowSignups || s.announcement) && (
        <div className="flex flex-wrap gap-2">
          {s.maintenanceMode && (
            <button onClick={() => onNavigate('settings')} className="cursor-pointer">
              <Badge tone="amber"><Wrench className="w-3 h-3 mr-1" />Maintenance mode is ON — customers are locked out</Badge>
            </button>
          )}
          {!s.allowSignups && (
            <button onClick={() => onNavigate('settings')} className="cursor-pointer">
              <Badge tone="slate">Signups closed</Badge>
            </button>
          )}
          {s.announcement && (
            <Badge tone="cyan"><Megaphone className="w-3 h-3 mr-1" />Announcement live</Badge>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="Total users" value={m.totalUsers} hint={`${m.newUsersLast7Days} new this week`} icon={Users} />
        <StatCard label="Active last 7 days" value={m.activeLast7Days} hint={`${m.platformAdmins} super admin${m.platformAdmins === 1 ? '' : 's'}`} icon={Activity} tone="text-emerald-400" />
        <StatCard label="Organizations" value={m.totalOrganizations} hint={m.suspendedOrganizations ? `${m.suspendedOrganizations} suspended` : 'All active'} icon={Building} tone="text-purple-400" />
        <StatCard label="Est. monthly revenue" value={`$${m.estimatedMrr.toLocaleString()}`} hint={`${m.activeSubscriptions} active subscriptions · list price`} icon={DollarSign} tone="text-amber-400" />
        <StatCard label="Suspended users" value={m.suspendedUsers} icon={UserX} tone="text-rose-400" />
        <StatCard label="Servers" value={m.totalServers} icon={Server} tone="text-cyan-400" />
        <StatCard label="Projects" value={m.totalProjects} icon={FolderGit2} tone="text-cyan-400" />
        <StatCard label="Open support tickets" value={m.openSupportTickets || 0} hint={`${m.totalSubscriptions} subscriptions`} icon={LifeBuoy} tone="text-amber-400" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card title="Signups" icon={UserPlus} className="lg:col-span-2">
          <SignupChart trend={data.signupTrend} />
        </Card>
        <Card title="Active subscriptions by plan" icon={CreditCard}>
          <PlanBreakdown breakdown={data.planBreakdown} />
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Newest users" icon={Users} actions={<Button size="sm" onClick={() => onNavigate('users')}>View all</Button>}>
          <div className="divide-y divide-slate-800/70">
            {data.recentUsers.map((u) => (
              <div key={u.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                <div className="min-w-0">
                  <div className="font-bold text-white truncate">{u.fullName || u.email}</div>
                  <div className="text-slate-500 truncate">{u.email}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {u.platformRole === 'superadmin' && <Badge tone="purple">Super admin</Badge>}
                  <StatusBadge status={u.status} />
                  <span className="text-slate-500 hidden sm:inline">{timeAgo(u.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Recent admin actions" icon={ShieldCheck} actions={<Button size="sm" onClick={() => onNavigate('audit-logs')}>Audit trail</Button>}>
          {data.recentAdminActions.length === 0 ? (
            <EmptyState>No admin actions recorded yet.</EmptyState>
          ) : (
            <div className="divide-y divide-slate-800/70">
              {data.recentAdminActions.map((l) => (
                <div key={l.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <div className="font-mono font-bold text-slate-200 truncate">{l.action.replace(/^ADMIN_/, '').replace(/_/g, ' ')}</div>
                    <div className="text-slate-500 truncate">{l.details?.email || l.details?.name || l.resourceId} · by {l.details?.adminEmail || l.userId}</div>
                  </div>
                  <span className="text-slate-500 shrink-0">{timeAgo(l.timestamp)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="flex justify-end">
        <Button size="sm" onClick={reload} loading={loading}>Refresh</Button>
      </div>
    </div>
  )
}
