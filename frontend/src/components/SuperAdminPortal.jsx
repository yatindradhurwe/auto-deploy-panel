import React, { useState, useEffect } from 'react'
import { Crown, Users, Building, Server, RefreshCw, Zap, ShieldAlert, BarChart3 } from 'lucide-react'

export default function SuperAdminPortal({ apiBaseUrl = '' }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  const fetchAdminOverview = async () => {
    setLoading(true)
    try {
      const token = localStorage.getItem('autodeploy_token')
      const res = await fetch(`${apiBaseUrl}/api/admin/overview`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const result = await res.json()
      setData(result)
    } catch (err) {
      console.error('Failed to fetch admin overview:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAdminOverview()
  }, [])

  if (loading) {
    return (
      <div className="p-8 text-center text-slate-400 font-mono flex items-center justify-center space-x-2">
        <Zap className="w-5 h-5 animate-spin text-purple-400" />
        <span>Loading Super Admin Control Portal...</span>
      </div>
    )
  }

  const { metrics, recentUsers, recentOrganizations } = data || {}

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* Super Admin Banner */}
      <div className="bg-gradient-to-r from-purple-950/60 via-slate-900 to-indigo-950/60 border border-purple-500/30 rounded-3xl p-8 backdrop-blur-xl relative overflow-hidden">
        <div className="flex items-center justify-between">
          <div>
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-purple-500/20 border border-purple-500/40 text-purple-300 text-xs font-bold mb-3">
              <Crown className="w-3.5 h-3.5 text-amber-400" />
              <span>Platform Super Admin Privilege</span>
            </div>
            <h1 className="text-3xl font-black text-white tracking-tight">AutoDeploy SaaS Master Console</h1>
            <p className="text-slate-400 text-sm mt-1">Cross-tenant infrastructure analytics and SaaS platform health</p>
          </div>

          <button
            onClick={fetchAdminOverview}
            className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-purple-300 rounded-xl font-semibold text-xs transition flex items-center space-x-2 border border-slate-700"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Refresh Analytics</span>
          </button>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {[
          { label: 'Total Users', value: metrics?.totalUsers || 0, icon: Users, color: 'text-cyan-400' },
          { label: 'Organizations', value: metrics?.totalOrganizations || 0, icon: Building, color: 'text-purple-400' },
          { label: 'Connected Servers', value: metrics?.totalServers || 0, icon: Server, color: 'text-emerald-400' },
          { label: 'Active Subscriptions', value: metrics?.activeSubscriptions || 0, icon: BarChart3, color: 'text-amber-400' }
        ].map((m, idx) => (
          <div key={idx} className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 backdrop-blur-xl flex items-center justify-between">
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
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 backdrop-blur-xl">
          <h3 className="text-base font-bold text-white mb-4 flex items-center space-x-2">
            <Users className="w-4 h-4 text-cyan-400" />
            <span>Recent Signed Up Accounts</span>
          </h3>
          <div className="space-y-3">
            {(recentUsers || []).map((u) => (
              <div key={u.id} className="p-3 bg-slate-950 border border-slate-800/80 rounded-xl flex items-center justify-between text-xs">
                <div>
                  <div className="font-bold text-white">{u.fullName}</div>
                  <div className="text-slate-400 font-mono text-[11px]">{u.email}</div>
                </div>
                <span className="px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 text-[10px] font-bold">
                  {u.organizationId}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 backdrop-blur-xl">
          <h3 className="text-base font-bold text-white mb-4 flex items-center space-x-2">
            <Building className="w-4 h-4 text-purple-400" />
            <span>Active Tenant Organizations</span>
          </h3>
          <div className="space-y-3">
            {(recentOrganizations || []).map((o) => (
              <div key={o.id} className="p-3 bg-slate-950 border border-slate-800/80 rounded-xl flex items-center justify-between text-xs">
                <div>
                  <div className="font-bold text-white">{o.name}</div>
                  <div className="text-slate-400 font-mono text-[11px]">Owner ID: {o.ownerId}</div>
                </div>
                <span className="px-2.5 py-1 rounded-full bg-purple-500/10 border border-purple-500/30 text-purple-300 text-[10px] font-bold">
                  {o.planId || 'FREE'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
