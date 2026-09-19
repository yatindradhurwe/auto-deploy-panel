import React, { useState, useEffect } from 'react'
import {
  Crown, Users, Building, Server, RefreshCw, Zap, ShieldAlert, BarChart3,
  CreditCard, ShieldCheck, Trash2, Eye, ExternalLink, Check, AlertCircle, Search
} from 'lucide-react'

export default function SuperAdminPortal({ activeTab = 'dashboard', apiBaseUrl = '' }) {
  const [data, setData] = useState(null)
  const [userList, setUserList] = useState([])
  const [orgList, setOrgList] = useState([])
  const [serverList, setServerList] = useState([])
  const [subList, setSubList] = useState([])
  const [auditLogs, setAuditLogs] = useState([])
  const [auditSearch, setAuditSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(null)

  const getToken = () => localStorage.getItem('autodeploy_token') || localStorage.getItem('autodeploy_jwt_token') || ''

  const fetchAdminData = async () => {
    setLoading(true)
    const token = getToken()
    const headers = { Authorization: `Bearer ${token}` }

    try {
      if (activeTab === 'dashboard') {
        const res = await fetch(`${apiBaseUrl}/api/admin/overview`, { headers })
        const result = await res.json()
        setData(result)
      } else if (activeTab === 'users') {
        const res = await fetch(`${apiBaseUrl}/api/admin/users`, { headers })
        const result = await res.json()
        setUserList(result.users || [])
      } else if (activeTab === 'organizations') {
        const res = await fetch(`${apiBaseUrl}/api/admin/organizations`, { headers })
        const result = await res.json()
        setOrgList(result.organizations || [])
      } else if (activeTab === 'servers') {
        const res = await fetch(`${apiBaseUrl}/api/admin/servers`, { headers })
        const result = await res.json()
        setServerList(result.servers || [])
      } else if (activeTab === 'subscriptions') {
        const res = await fetch(`${apiBaseUrl}/api/admin/subscriptions`, { headers })
        const result = await res.json()
        setSubList(result.subscriptions || [])
      } else if (activeTab === 'audit-logs') {
        const res = await fetch(`${apiBaseUrl}/api/admin/audit-logs`, { headers })
        const result = await res.json()
        setAuditLogs(result.logs || [])
      }
    } catch (err) {
      console.error('Failed to fetch superadmin data:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAdminData()
  }, [activeTab])

  const handleDeleteUser = async (userId) => {
    if (!window.confirm(`Are you sure you want to delete user ${userId}?`)) return
    setActionLoading(`delete-user-${userId}`)
    try {
      const res = await fetch(`${apiBaseUrl}/api/admin/users/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`
        },
        body: JSON.stringify({ userId })
      })
      const result = await res.json()
      if (result.success) {
        fetchAdminData()
      } else {
        alert(result.error || 'Failed to delete user.')
      }
    } catch (e) {
      alert('Error: ' + e.message)
    } finally {
      setActionLoading(null)
    }
  }

  if (loading) {
    return (
      <div className="p-12 text-center text-slate-400 font-mono flex flex-col items-center justify-center space-y-3">
        <Zap className="w-6 h-6 animate-spin text-purple-400" />
        <span className="text-xs">Querying database for live platform telemetry...</span>
      </div>
    )
  }

  const { metrics, recentUsers, recentOrganizations } = data || {}

  return (
    <div className="p-2 max-w-7xl mx-auto space-y-8 font-sans">
      {/* Super Admin Banner */}
      <div className="bg-gradient-to-r from-purple-950/80 via-slate-900 to-indigo-950/80 border border-purple-500/30 rounded-3xl p-8 backdrop-blur-xl relative overflow-hidden shadow-2xl">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-purple-500/20 border border-purple-500/40 text-purple-300 text-xs font-bold mb-3">
              <Crown className="w-3.5 h-3.5 text-amber-400" />
              <span>Platform Super Admin Control</span>
            </div>
            <h1 className="text-3xl font-black text-white tracking-tight">AutoDeploy SaaS Master Console</h1>
            <p className="text-slate-400 text-sm mt-1">Cross-tenant infrastructure analytics, live user management & database records</p>
          </div>

          <button
            onClick={fetchAdminData}
            className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-purple-300 rounded-xl font-semibold text-xs transition flex items-center space-x-2 border border-slate-700 cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Refresh Database</span>
          </button>
        </div>
      </div>

      {/* VIEW 1: Dashboard Overview */}
      {activeTab === 'dashboard' && (
        <div className="space-y-8">
          {/* Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            {[
              { label: 'Total Users', value: metrics?.totalUsers || 0, icon: Users, color: 'text-cyan-400' },
              { label: 'Organizations', value: metrics?.totalOrganizations || 0, icon: Building, color: 'text-purple-400' },
              { label: 'Connected Servers', value: metrics?.totalServers || 0, icon: Server, color: 'text-emerald-400' },
              { label: 'Active Subscriptions', value: metrics?.activeSubscriptions || 0, icon: BarChart3, color: 'text-amber-400' }
            ].map((m, idx) => (
              <div key={idx} className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 backdrop-blur-xl flex items-center justify-between shadow-lg">
                <div>
                  <div className="text-xs text-slate-400 font-semibold uppercase">{m.label}</div>
                  <div className="text-3xl font-black text-white mt-2">{m.value}</div>
                </div>
                <div className={`p-3.5 bg-slate-950 border border-slate-800 rounded-xl ${m.color}`}>
                  <m.icon className="w-6 h-6" />
                </div>
              </div>
            ))}
          </div>

          {/* Recent Activity Tables */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 backdrop-blur-xl space-y-4">
              <h3 className="text-base font-bold text-white flex items-center space-x-2">
                <Users className="w-4 h-4 text-cyan-400" />
                <span>Recent Signed Up Accounts ({recentUsers?.length || 0})</span>
              </h3>
              <div className="space-y-3">
                {(recentUsers || []).map((u) => (
                  <div key={u.id} className="p-3.5 bg-slate-950 border border-slate-800/80 rounded-2xl flex items-center justify-between text-xs font-mono">
                    <div>
                      <div className="font-bold text-white">{u.fullName || u.email}</div>
                      <div className="text-slate-400 text-[11px]">{u.email}</div>
                    </div>
                    <span className="px-2.5 py-1 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 text-[10px] font-bold">
                      {u.organizationId || 'org-default'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 backdrop-blur-xl space-y-4">
              <h3 className="text-base font-bold text-white flex items-center space-x-2">
                <Building className="w-4 h-4 text-purple-400" />
                <span>Active Tenant Organizations ({recentOrganizations?.length || 0})</span>
              </h3>
              <div className="space-y-3">
                {(recentOrganizations || []).map((o) => (
                  <div key={o.id} className="p-3.5 bg-slate-950 border border-slate-800/80 rounded-2xl flex items-center justify-between text-xs font-mono">
                    <div>
                      <div className="font-bold text-white">{o.name}</div>
                      <div className="text-slate-400 text-[11px]">Owner ID: {o.ownerId}</div>
                    </div>
                    <span className="px-2.5 py-1 rounded-full bg-purple-500/10 border border-purple-500/30 text-purple-300 text-[10px] font-bold">
                      {o.planId || 'BUSINESS'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2: Registered Users */}
      {activeTab === 'users' && (
        <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 backdrop-blur-xl space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-white flex items-center space-x-2">
              <Users className="w-4 h-4 text-cyan-400" />
              <span>All Registered Accounts ({userList.length})</span>
            </h3>
            <span className="text-xs text-slate-400 font-mono">Database Query Result</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300 font-mono">
              <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
                <tr>
                  <th className="p-3">User ID</th>
                  <th className="p-3">Full Name</th>
                  <th className="p-3">Email Address</th>
                  <th className="p-3">Organization ID</th>
                  <th className="p-3">Registered Date</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {userList.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-950/60 transition">
                    <td className="p-3 text-cyan-300 font-bold">{u.id}</td>
                    <td className="p-3 text-white font-sans font-bold">{u.fullName || 'N/A'}</td>
                    <td className="p-3 text-slate-300">{u.email}</td>
                    <td className="p-3">
                      <span className="bg-purple-950 text-purple-300 px-2 py-0.5 rounded border border-purple-800 text-[10px]">
                        {u.organizationId || 'org-default'}
                      </span>
                    </td>
                    <td className="p-3 text-slate-400">{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : 'Active'}</td>
                    <td className="p-3 text-right">
                      {u.id !== 'admin-001' ? (
                        <button
                          onClick={() => handleDeleteUser(u.id)}
                          disabled={actionLoading === `delete-user-${u.id}`}
                          className="px-2.5 py-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-lg text-[10px] font-bold transition cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3 inline mr-1" />
                          Delete
                        </button>
                      ) : (
                        <span className="text-[10px] text-amber-400 font-bold">System Admin</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* VIEW 3: Customer Organizations */}
      {activeTab === 'organizations' && (
        <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 backdrop-blur-xl space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-white flex items-center space-x-2">
              <Building className="w-4 h-4 text-purple-400" />
              <span>Registered Tenant Organizations ({orgList.length})</span>
            </h3>
            <span className="text-xs text-slate-400 font-mono">Multi-Tenant Isolation</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300 font-mono">
              <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
                <tr>
                  <th className="p-3">Org ID</th>
                  <th className="p-3">Organization Name</th>
                  <th className="p-3">Owner ID</th>
                  <th className="p-3">Subscription Plan</th>
                  <th className="p-3">Created Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {orgList.map((o) => (
                  <tr key={o.id} className="hover:bg-slate-950/60 transition">
                    <td className="p-3 text-purple-300 font-bold">{o.id}</td>
                    <td className="p-3 text-white font-sans font-bold">{o.name}</td>
                    <td className="p-3 text-slate-400">{o.ownerId}</td>
                    <td className="p-3">
                      <span className="bg-emerald-950 text-emerald-300 px-2 py-0.5 rounded border border-emerald-800 text-[10px] font-bold">
                        {o.planId || 'BUSINESS'}
                      </span>
                    </td>
                    <td className="p-3 text-slate-400">{o.createdAt ? new Date(o.createdAt).toLocaleDateString() : 'Active'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* VIEW 4: Global Server Inventory */}
      {activeTab === 'servers' && (
        <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 backdrop-blur-xl space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-white flex items-center space-x-2">
              <Server className="w-4 h-4 text-emerald-400" />
              <span>Global Server Node Inventory ({serverList.length})</span>
            </h3>
            <span className="text-xs text-slate-400 font-mono">Cross-Tenant VPS Nodes</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300 font-mono">
              <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
                <tr>
                  <th className="p-3">Server ID</th>
                  <th className="p-3">Node Name</th>
                  <th className="p-3">IP Address</th>
                  <th className="p-3">SSH Port</th>
                  <th className="p-3">Owner Org</th>
                  <th className="p-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {serverList.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-950/60 transition">
                    <td className="p-3 text-emerald-300 font-bold">{s.id}</td>
                    <td className="p-3 text-white font-sans font-bold">{s.name}</td>
                    <td className="p-3 text-cyan-300">{s.ipAddress || s.host || '187.127.165.128'}</td>
                    <td className="p-3 text-slate-400">{s.port || 22}</td>
                    <td className="p-3 text-slate-400">{s.organizationId || 'org-default'}</td>
                    <td className="p-3">
                      <span className="bg-emerald-950 text-emerald-300 px-2 py-0.5 rounded border border-emerald-800 text-[10px] font-bold">
                        {(s.status || 'ONLINE').toUpperCase()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* VIEW 5: Active Subscriptions */}
      {activeTab === 'subscriptions' && (
        <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 backdrop-blur-xl space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-white flex items-center space-x-2">
              <CreditCard className="w-4 h-4 text-amber-400" />
              <span>Active Billing Subscriptions ({subList.length})</span>
            </h3>
            <span className="text-xs text-slate-400 font-mono">Revenue Telemetry</span>
          </div>

          {subList.length === 0 ? (
            <div className="p-8 text-center text-slate-400 font-mono text-xs bg-slate-950 rounded-2xl border border-slate-800">
              No active subscription records in database. Defaulting to Enterprise Master Access.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300 font-mono">
                <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
                  <tr>
                    <th className="p-3">Subscription ID</th>
                    <th className="p-3">Org ID</th>
                    <th className="p-3">Plan</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {subList.map((sub) => (
                    <tr key={sub.id} className="hover:bg-slate-950/60 transition">
                      <td className="p-3 text-amber-300 font-bold">{sub.id}</td>
                      <td className="p-3 text-slate-300">{sub.organizationId}</td>
                      <td className="p-3 text-white font-bold">{sub.planId}</td>
                      <td className="p-3">
                        <span className="bg-emerald-950 text-emerald-300 px-2 py-0.5 rounded border border-emerald-800 text-[10px] font-bold">
                          {(sub.status || 'ACTIVE').toUpperCase()}
                        </span>
                      </td>
                      <td className="p-3 text-slate-400">{new Date(sub.createdAt || Date.now()).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* VIEW 6: Audit Logs */}
      {activeTab === 'audit-logs' && (() => {
        const safeLogs = Array.isArray(auditLogs) ? auditLogs : []
        const filteredLogs = safeLogs.filter(log => {
          if (!auditSearch.trim()) return true
          const term = auditSearch.toLowerCase()
          const action = (log.action || '').toLowerCase()
          const user = (log.userId || '').toLowerCase()
          const org = (log.organizationId || '').toLowerCase()
          const ip = (log.ip || '').toLowerCase()
          const detailsStr = typeof log.details === 'string' 
            ? log.details.toLowerCase() 
            : (log.details && typeof log.details === 'object' ? JSON.stringify(log.details).toLowerCase() : '')
          return action.includes(term) || user.includes(term) || org.includes(term) || ip.includes(term) || detailsStr.includes(term)
        })

        const formatLogText = (log) => {
          if (!log) return 'Platform event logged.'
          if (typeof log.details === 'string') return log.details
          if (log.details && typeof log.details === 'object' && Object.keys(log.details).length > 0) {
            try {
              return JSON.stringify(log.details)
            } catch {
              return log.message || 'Platform event logged.'
            }
          }
          return log.message || 'Platform event logged.'
        }

        return (
          <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 backdrop-blur-xl space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-bold text-white flex items-center space-x-2">
                  <ShieldCheck className="w-5 h-5 text-purple-400" />
                  <span>Platform Audit Trail ({filteredLogs.length})</span>
                </h3>
                <p className="text-xs text-slate-400 mt-1">Immutable platform security log and system events audit stream</p>
              </div>

              <div className="relative w-full md:w-64">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Search audit trail..."
                  value={auditSearch}
                  onChange={(e) => setAuditSearch(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-4 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-purple-500/50"
                />
              </div>
            </div>

            {loading ? (
              <div className="text-center py-12 text-slate-400 text-sm font-mono flex items-center justify-center space-x-2">
                <RefreshCw className="w-4 h-4 animate-spin text-purple-400" />
                <span>Loading platform audit records...</span>
              </div>
            ) : filteredLogs.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-sm font-mono bg-slate-950/40 rounded-2xl border border-slate-800/60">
                No platform audit entries found matching your query.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-slate-800/80 bg-slate-950/60">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-[11px] font-mono text-slate-400 uppercase bg-slate-900/60">
                      <th className="py-3 px-4">Timestamp</th>
                      <th className="py-3 px-4">Action</th>
                      <th className="py-3 px-4">User / Org</th>
                      <th className="py-3 px-4">IP Address</th>
                      <th className="py-3 px-4">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50 text-xs font-mono">
                    {filteredLogs.map((log, idx) => (
                      <tr key={log.id || idx} className="hover:bg-slate-900/40 transition">
                        <td className="py-3 px-4 text-slate-400 text-[11px] whitespace-nowrap">
                          {log.timestamp ? new Date(log.timestamp).toLocaleString() : 'Just now'}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className="px-2 py-0.5 rounded bg-purple-500/10 border border-purple-500/20 text-purple-300 font-bold text-[10px]">
                            {log.action || 'AUDIT'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-300 text-[11px] whitespace-nowrap">
                          <div>{log.userId || 'system'}</div>
                          {log.organizationId && (
                            <div className="text-[10px] text-slate-500">{log.organizationId}</div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-slate-400 text-[11px] whitespace-nowrap">
                          {log.ip || '127.0.0.1'}
                        </td>
                        <td className="py-3 px-4 text-slate-300 text-[11px] break-all max-w-xs">
                          {formatLogText(log)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}
