import React, { useState } from 'react'
import { Users, Building, Server, CreditCard, UserX, UserPlus, Activity, FolderGit2, DollarSign, ShieldCheck, Megaphone, Wrench, LifeBuoy, AlertTriangle, CheckCircle2, ChevronRight, Ban, Clock, RefreshCw } from 'lucide-react'
import { adminApi, timeAgo, formatDate } from './adminApi'
import { Card, StatCard, Badge, StatusBadge, Loading, Alert, EmptyState, Button, Avatar, useAdminData } from './AdminUI'
import { formatMoney } from '../../utils/razorpay'

/**
 * Things a super admin should act on, each linking to the screen that fixes it.
 */
function NeedsAttention({ data, onNavigate }) {
  const m = data.metrics
  const items = [
    m.pastDueSubscriptions > 0 && { tone: 'amber', icon: Clock, text: `${m.pastDueSubscriptions} subscription${m.pastDueSubscriptions === 1 ? ' is' : 's are'} past due`, tab: 'subscriptions' },
    m.lapsedSubscriptions > 0 && { tone: 'rose', icon: CreditCard, text: `${m.lapsedSubscriptions} subscription${m.lapsedSubscriptions === 1 ? ' has' : 's have'} expired or been canceled`, tab: 'subscriptions' },
    ...data.expiringSoon.map((s) => ({ tone: 'amber', icon: CreditCard, text: `${s.organizationName} (${s.planId}) ${s.cancelAtPeriodEnd ? 'cancels' : 'renews'} ${s.daysLeft <= 0 ? 'today' : `in ${s.daysLeft}d`} · ${formatDate(s.currentPeriodEnd)}`, tab: 'subscriptions' })),
    m.openSupportTickets > 0 && { tone: 'cyan', icon: LifeBuoy, text: `${m.openSupportTickets} open support ticket${m.openSupportTickets === 1 ? '' : 's'}`, tab: 'support' },
    m.suspendedUsers > 0 && { tone: 'slate', icon: UserX, text: `${m.suspendedUsers} blocked user${m.suspendedUsers === 1 ? '' : 's'}`, tab: 'users' },
    m.blockedServers > 0 && { tone: 'slate', icon: Ban, text: `${m.blockedServers} blocked server${m.blockedServers === 1 ? '' : 's'}`, tab: 'servers' }
  ].filter(Boolean)
  const tones = { amber: 'text-amber-300 bg-amber-500/10 border-amber-500/30', rose: 'text-rose-300 bg-rose-500/10 border-rose-500/30', cyan: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/30', slate: 'text-slate-300 bg-slate-800 border-slate-700' }

  return (
    <Card title="Needs attention" subtitle={items.length ? `${items.length} item${items.length === 1 ? '' : 's'}` : 'Nothing waiting on you'} icon={AlertTriangle}>
      {items.length === 0 ? (
        <div className="flex items-center gap-2 text-xs text-emerald-300"><CheckCircle2 className="w-4 h-4" />All subscriptions are current and no tickets are open.</div>
      ) : (
        <div className="space-y-2">
          {items.map((it, i) => (
            <button key={i} onClick={() => onNavigate(it.tab)} className="w-full flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/50 hover:border-purple-500/40 px-3 py-2.5 text-left text-xs cursor-pointer transition">
              <span className={`p-1.5 rounded-lg border ${tones[it.tone]}`}><it.icon className="w-3.5 h-3.5" /></span>
              <span className="flex-1 min-w-0 text-slate-200 truncate">{it.text}</span>
              <ChevronRight className="w-4 h-4 text-slate-600 shrink-0" />
            </button>
          ))}
        </div>
      )}
    </Card>
  )
}

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
        <StatCard label="Total users" value={m.totalUsers} hint={`${m.newUsersLast7Days} new this week`} icon={Users} onClick={() => onNavigate('users')} />
        <StatCard label="Active last 7 days" value={m.activeLast7Days} hint={`${m.platformAdmins} super admin${m.platformAdmins === 1 ? '' : 's'}`} icon={Activity} tone="text-emerald-400" onClick={() => onNavigate('users')} />
        <StatCard label="Organizations" value={m.totalOrganizations} hint={m.suspendedOrganizations ? `${m.suspendedOrganizations} suspended` : 'All active'} icon={Building} tone="text-purple-400" onClick={() => onNavigate('organizations')} />
        <StatCard label="Est. monthly revenue" value={formatMoney(m.estimatedMrr, data.currency)} hint={`${m.activeSubscriptions} active subscriptions · list price`} icon={DollarSign} tone="text-amber-400" onClick={() => onNavigate('subscriptions')} />
        <StatCard label="Blocked users" value={m.suspendedUsers} icon={UserX} tone="text-rose-400" onClick={() => onNavigate('users')} />
        <StatCard label="Servers" value={m.totalServers} hint={m.blockedServers ? `${m.blockedServers} blocked` : 'None blocked'} icon={Server} tone="text-cyan-400" onClick={() => onNavigate('servers')} />
        <StatCard label="Projects" value={m.totalProjects} icon={FolderGit2} tone="text-cyan-400" />
        <StatCard label="Open support tickets" value={m.openSupportTickets || 0} hint={`${m.totalSubscriptions} subscriptions`} icon={LifeBuoy} tone="text-amber-400" alert={m.openSupportTickets > 0} onClick={() => onNavigate('support')} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card title="Signups" icon={UserPlus} className="lg:col-span-2">
          <SignupChart trend={data.signupTrend} />
        </Card>
        <NeedsAttention data={data} onNavigate={onNavigate} />
      </div>

      <Card title="Active subscriptions by plan" icon={CreditCard} actions={<Button size="sm" onClick={() => onNavigate('subscriptions')}>Manage</Button>}>
        <PlanBreakdown breakdown={data.planBreakdown} />
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Newest users" icon={Users} actions={<Button size="sm" onClick={() => onNavigate('users')}>View all</Button>}>
          <div className="divide-y divide-slate-800/70">
            {data.recentUsers.map((u) => (
              <div key={u.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Avatar name={u.fullName || u.email} size="sm" />
                  <div className="min-w-0">
                    <div className="font-bold text-white truncate">{u.fullName || u.email}</div>
                    <div className="text-slate-500 truncate">{u.email}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {u.platformRole === 'superadmin' && <Badge tone="purple">Super admin</Badge>}
                  <StatusBadge status={u.status} suspendedLabel="Blocked" />
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
        <Button size="sm" onClick={reload} loading={loading}><RefreshCw className="w-3.5 h-3.5" />Refresh</Button>
      </div>
    </div>
  )
}
