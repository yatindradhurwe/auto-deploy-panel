import React, { useState, useEffect } from 'react'
import { CreditCard, Check, Zap, Shield, Sparkles, AlertCircle, ArrowUpRight, CheckCircle2 } from 'lucide-react'

export default function BillingManager({ apiBaseUrl = '' }) {
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [upgrading, setUpgrading] = useState('')
  const [message, setMessage] = useState('')

  const fetchBillingSummary = async () => {
    setLoading(true)
    try {
      const token = localStorage.getItem('autodeploy_token')
      const res = await fetch(`${apiBaseUrl}/api/billing/summary`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json()
      setSummary(data)
    } catch (err) {
      console.error('Failed to fetch billing summary:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchBillingSummary()
  }, [])

  const handleUpgrade = async (planId) => {
    setUpgrading(planId)
    setMessage('')
    try {
      const token = localStorage.getItem('autodeploy_token')
      const res = await fetch(`${apiBaseUrl}/api/billing/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ planId })
      })
      const data = await res.json()
      if (data.success) {
        setMessage(`Successfully updated plan to ${planId}!`)
        fetchBillingSummary()
      } else {
        alert(data.error || 'Failed to update plan.')
      }
    } catch (err) {
      alert('Upgrade error: ' + err.message)
    } finally {
      setUpgrading('')
    }
  }

  if (loading) {
    return (
      <div className="p-8 text-center text-slate-400 font-mono flex items-center justify-center space-x-2">
        <Zap className="w-5 h-5 animate-spin text-cyan-400" />
        <span>Loading subscription & entitlement status...</span>
      </div>
    )
  }

  const { subscription, plan, plans, usage } = summary || {}

  return (
    <div className="p-6 space-y-8 max-w-7xl mx-auto">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-900/90 to-cyan-950/40 border border-slate-800 rounded-3xl p-8 relative overflow-hidden backdrop-blur-xl">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-semibold mb-3">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Current Subscription: {plan?.name || 'Starter'} Plan</span>
            </div>
            <h1 className="text-3xl font-black text-white tracking-tight">Billing & Quota Entitlements</h1>
            <p className="text-slate-400 text-sm mt-1">Manage your organization's subscription tier, server limits, and deployment quotas.</p>
          </div>

          <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-5 flex items-center space-x-4">
            <div className="p-3 bg-cyan-500/10 border border-cyan-500/20 rounded-xl text-cyan-400">
              <CreditCard className="w-6 h-6" />
            </div>
            <div>
              <div className="text-xs text-slate-400 uppercase font-semibold">Active Tier</div>
              <div className="text-xl font-bold text-white">{plan?.name} (${plan?.priceMonthly}/mo)</div>
              <div className="text-[11px] text-emerald-400 flex items-center space-x-1 mt-0.5">
                <CheckCircle2 className="w-3 h-3" />
                <span>Renews on {new Date(subscription?.currentPeriodEnd || Date.now()).toLocaleDateString()}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {message && (
        <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm font-semibold flex items-center space-x-2">
          <CheckCircle2 className="w-5 h-5" />
          <span>{message}</span>
        </div>
      )}

      {/* Quota Usage Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
        {[
          { label: 'VPS Servers', current: usage?.servers?.current, max: usage?.servers?.max },
          { label: 'Deployed Projects', current: usage?.projects?.current, max: usage?.projects?.max },
          { label: 'Team Members', current: usage?.teamMembers?.current, max: usage?.teamMembers?.max }
        ].map((item, idx) => {
          const pct = Math.min(100, Math.round((item.current / item.max) * 100))
          return (
            <div key={idx} className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 backdrop-blur-xl space-y-3">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-400">
                <span>{item.label}</span>
                <span className="font-mono text-cyan-400">{item.current} / {item.max} ({pct}%)</span>
              </div>
              <div className="w-full bg-slate-950 h-2.5 rounded-full overflow-hidden border border-slate-800">
                <div
                  className={`h-full transition-all duration-500 rounded-full ${
                    pct >= 90 ? 'bg-rose-500' : pct >= 70 ? 'bg-amber-400' : 'bg-cyan-500'
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>

      {/* Available Plans Pricing Grid */}
      <div>
        <h2 className="text-xl font-bold text-white mb-4">Select Subscription Tier</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          {Object.values(plans || {}).map((p) => {
            const isCurrent = p.id === plan?.id
            return (
              <div
                key={p.id}
                className={`bg-slate-900/80 border rounded-3xl p-6 flex flex-col justify-between transition-all relative ${
                  isCurrent
                    ? 'border-cyan-500 bg-cyan-950/10 shadow-xl shadow-cyan-500/10'
                    : 'border-slate-800 hover:border-slate-700'
                }`}
              >
                {isCurrent && (
                  <span className="absolute -top-3 right-6 px-3 py-1 bg-cyan-500 text-slate-950 text-[10px] font-black uppercase rounded-full tracking-wider shadow">
                    Current Active Plan
                  </span>
                )}
                <div>
                  <h3 className="text-lg font-bold text-white mb-1">{p.name}</h3>
                  <div className="flex items-baseline space-x-1 my-3">
                    <span className="text-3xl font-black text-white">${p.priceMonthly}</span>
                    <span className="text-xs text-slate-400 font-medium">/month</span>
                  </div>

                  <ul className="text-xs text-slate-300 space-y-2.5 my-6 font-medium border-t border-b border-slate-800/80 py-6">
                    <li className="flex items-center space-x-2.5">
                      <Check className="w-4 h-4 text-cyan-400" />
                      <span><strong>{p.maxServers}</strong> VPS Servers</span>
                    </li>
                    <li className="flex items-center space-x-2.5">
                      <Check className="w-4 h-4 text-cyan-400" />
                      <span><strong>{p.maxProjects}</strong> Deployed Projects</span>
                    </li>
                    <li className="flex items-center space-x-2.5">
                      <Check className="w-4 h-4 text-cyan-400" />
                      <span><strong>{p.maxTeamMembers}</strong> Team Members</span>
                    </li>
                    <li className="flex items-center space-x-2.5">
                      <Check className="w-4 h-4 text-cyan-400" />
                      <span>{p.monitoring ? '24/7 PM2 Monitoring' : 'Basic Telemetry'}</span>
                    </li>
                  </ul>
                </div>

                <button
                  disabled={isCurrent || upgrading === p.id}
                  onClick={() => handleUpgrade(p.id)}
                  className={`w-full py-3 rounded-xl font-bold text-xs transition-all flex items-center justify-center space-x-1.5 ${
                    isCurrent
                      ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                      : 'bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white shadow-lg shadow-cyan-500/20'
                  }`}
                >
                  {upgrading === p.id ? (
                    <Zap className="w-4 h-4 animate-spin" />
                  ) : isCurrent ? (
                    <span>Current Plan</span>
                  ) : (
                    <><span>Upgrade to {p.name}</span><ArrowUpRight className="w-4 h-4" /></>
                  )}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
