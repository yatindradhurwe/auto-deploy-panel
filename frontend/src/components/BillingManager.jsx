import React, { useState, useEffect } from 'react'
import { CreditCard, Check, Zap, Shield, Sparkles, AlertCircle, ArrowUpRight, CheckCircle2, Bot, Coins } from 'lucide-react'
import { useAuth } from '../store/AuthContext'
import { purchase, formatMoney } from '../utils/razorpay'

const fmtTokens = (n) => Number(n || 0).toLocaleString()

/**
 * AI token balance and packs. Tokens are spent by the project AI agent (Claude, ChatGPT, Gemini)
 * when it modifies a website or project from a prompt.
 */
function AiTokensSection({ apiBaseUrl, token }) {
  const [data, setData] = useState(null)
  const [buying, setBuying] = useState('')
  const [notice, setNotice] = useState(null)

  const load = async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/api/billing/ai-tokens`, { headers: { Authorization: `Bearer ${token}` } })
      const json = await res.json()
      if (res.ok) setData(json)
    } catch (err) {
      console.error('Failed to load AI tokens:', err)
    }
  }

  useEffect(() => { load() }, [])

  const buy = async (pack) => {
    setBuying(pack.id)
    setNotice(null)
    try {
      const msg = await purchase({ apiBaseUrl, token, startUrl: `${apiBaseUrl}/api/billing/ai-tokens/purchase`, body: { packId: pack.id } })
      if (msg) {
        setNotice({ ok: true, text: msg })
        load()
      }
    } catch (err) {
      setNotice({ ok: false, text: err.message })
    } finally {
      setBuying('')
    }
  }

  if (!data) return null
  const recent = (data.ledger || []).slice(0, 8)

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2"><Bot className="w-5 h-5 text-cyan-400" /> AI Agent Tokens</h2>
          <p className="text-slate-400 text-sm mt-1">Tokens are used when the AI agent changes your website or project from a prompt.</p>
        </div>
        <div className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl border ${data.balance > 0 ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'border-rose-500/30 bg-rose-500/10 text-rose-300'}`}>
          <Coins className="w-5 h-5" />
          <span className="text-lg font-black tabular-nums">{fmtTokens(Math.max(data.balance, 0))}</span>
          <span className="text-xs font-semibold">tokens left</span>
        </div>
      </div>

      {notice && (
        <div className={`p-3 rounded-xl border text-sm font-semibold ${notice.ok ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-rose-500/10 border-rose-500/30 text-rose-300'}`}>{notice.text}</div>
      )}

      {data.packs.length === 0 ? (
        <p className="text-sm text-slate-500">No token packs are on sale right now.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {data.packs.map((pack) => (
            <div key={pack.id} className="bg-slate-900/80 border border-slate-800 hover:border-slate-700 rounded-3xl p-5 flex flex-col gap-3">
              <h3 className="text-base font-bold text-white">{pack.name}</h3>
              <div className="text-2xl font-black text-white tabular-nums">{fmtTokens(pack.tokens)} <span className="text-xs text-slate-400 font-medium">tokens</span></div>
              <div className="text-sm text-slate-300">{formatMoney(pack.price, data.currency)}</div>
              <button
                disabled={buying === pack.id}
                onClick={() => buy(pack)}
                className="mt-auto w-full py-2.5 rounded-xl font-bold text-xs bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {buying === pack.id ? <Zap className="w-4 h-4 animate-spin" /> : <><Coins className="w-4 h-4" /><span>Buy tokens</span></>}
              </button>
            </div>
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-xs text-slate-300">
            <thead className="text-slate-500 uppercase text-[10px] tracking-wider border-b border-slate-800">
              <tr><th className="px-4 py-2.5">When</th><th className="px-4 py-2.5">Activity</th><th className="px-4 py-2.5 text-right">Tokens</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {recent.map((e) => (
                <tr key={e.id}>
                  <td className="px-4 py-2 text-slate-400 whitespace-nowrap">{new Date(e.at).toLocaleString()}</td>
                  <td className="px-4 py-2">{e.type === 'usage' ? `AI agent · ${e.projectName || 'project'}` : e.type === 'purchase' ? `Bought ${e.packName}` : e.note || (e.type === 'grant' ? 'Added by platform' : 'Removed by platform')}</td>
                  <td className={`px-4 py-2 text-right tabular-nums font-semibold ${e.delta > 0 ? 'text-emerald-300' : ''}`}>{e.delta > 0 ? '+' : ''}{fmtTokens(e.delta)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function BillingManager({ apiBaseUrl = '' }) {
  const { token: jwtToken } = useAuth()
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [upgrading, setUpgrading] = useState('')
  const [message, setMessage] = useState('')

  const fetchBillingSummary = async () => {
    setLoading(true)
    try {
      const token = jwtToken
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
      const msg = await purchase({ apiBaseUrl, token: jwtToken, startUrl: `${apiBaseUrl}/api/billing/checkout`, body: { planId } })
      if (msg) {
        setMessage(msg)
        fetchBillingSummary()
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
              <div className="text-xl font-bold text-white">{plan?.name} ({formatMoney(plan?.priceMonthly, summary?.currency)}/mo)</div>
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

      <AiTokensSection apiBaseUrl={apiBaseUrl} token={jwtToken} />

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
                    <span className="text-3xl font-black text-white">{formatMoney(p.priceMonthly, summary?.currency)}</span>
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
