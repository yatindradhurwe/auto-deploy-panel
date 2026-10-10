import React, { useEffect, useState } from 'react'
import { Bot, Coins, Plus, Trash2, History, Gift } from 'lucide-react'
import { adminApi, formatDate, timeAgo } from './adminApi'
import { Card, Badge, Button, Modal, Field, TextInput, Alert, Loading, EmptyState, StatCard, useAdminData } from './AdminUI'

const PROVIDER_TONE = { claude: 'amber', openai: 'green', gemini: 'cyan' }
const fmt = (n) => Number(n || 0).toLocaleString()

function ProviderCard({ p, isDefault, apiBaseUrl, onSaved }) {
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(p.model)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  useEffect(() => { setModel(p.model) }, [p.model])

  const save = async (key, body) => {
    setBusy(key)
    setError('')
    try {
      await adminApi(`/ai/providers/${p.id}`, { method: 'PUT', body, apiBaseUrl })
      setApiKey('')
      onSaved()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy('')
    }
  }

  const saveBody = () => ({ ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}), model })

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5 flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge tone={PROVIDER_TONE[p.id]}>{p.label}</Badge>
        {p.configured
          ? <span className="text-[11px] text-emerald-400">Key {p.keyHint}{p.keySource === 'environment' ? ' (env)' : ''}</span>
          : <span className="text-[11px] text-slate-500">No key</span>}
        {isDefault && <Badge tone="purple">Default</Badge>}
        {!p.enabled && <Badge tone="red">Disabled</Badge>}
      </div>
      <Field label="API key" hint={p.keyHelp}>
        <TextInput type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={p.configured ? 'Paste a new key to replace' : 'Paste API key'} />
      </Field>
      <Field label="Model" hint={`Default: ${p.defaultModel}. New conversations use this model.`}>
        <TextInput value={model} onChange={(e) => setModel(e.target.value)} placeholder={p.defaultModel} />
      </Field>
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-wrap gap-2 mt-auto pt-2 border-t border-slate-800">
        <Button size="sm" variant="primary" loading={busy === 'save'} onClick={() => save('save', saveBody())}>Save</Button>
        <Button size="sm" variant={p.enabled ? 'warning' : 'success'} loading={busy === 'enabled'} onClick={() => save('enabled', { enabled: !p.enabled })}>
          {p.enabled ? 'Disable for customers' : 'Enable'}
        </Button>
        {p.configured && p.enabled && !isDefault && <Button size="sm" loading={busy === 'default'} onClick={() => save('default', { makeDefault: true })}>Make default</Button>}
        {p.configured && p.keySource !== 'environment' && (
          <Button size="sm" variant="danger" className="ml-auto" loading={busy === 'remove'} onClick={() => save('remove', { apiKey: '' })} aria-label={`Remove ${p.label} key`}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
    </div>
  )
}

function PricingCard({ billing, providers, apiBaseUrl, onSaved }) {
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    setForm({ packs: billing.packs.map((p) => ({ ...p })), multipliers: { ...billing.multipliers }, signupBonusTokens: billing.signupBonusTokens })
  }, [billing])

  if (!form) return null
  const setPack = (i, key, value) => setForm({ ...form, packs: form.packs.map((p, j) => (j === i ? { ...p, [key]: value } : p)) })

  const save = async () => {
    setBusy(true)
    setMsg(null)
    try {
      await adminApi('/ai/billing', { method: 'PUT', body: form, apiBaseUrl })
      setMsg({ tone: 'success', text: 'Token pricing saved.' })
      onSaved()
    } catch (e) {
      setMsg({ tone: 'error', text: e.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Token packs & pricing" icon={Coins} actions={<Button variant="primary" loading={busy} onClick={save}>Save pricing</Button>}>
      <p className="text-xs text-slate-400">
        Organizations buy these packs under Billing and spend them on prompts to the project AI agent. Each model turn is charged
        (input + output + cache writes + cache reads ÷ 10) × the provider multiplier.
      </p>
      <div className="space-y-2">
        {form.packs.map((p, i) => (
          <div key={i} className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_120px_auto] gap-2 items-end">
            <Field label="Pack name"><TextInput value={p.name} onChange={(e) => setPack(i, 'name', e.target.value)} /></Field>
            <Field label="Tokens"><TextInput type="number" min={1000} step={1000} value={p.tokens} onChange={(e) => setPack(i, 'tokens', e.target.value)} /></Field>
            <Field label="Price"><TextInput type="number" min={0} step="0.01" value={p.price} onChange={(e) => setPack(i, 'price', e.target.value)} /></Field>
            <Button variant="danger" aria-label={`Remove ${p.name || 'pack'}`} onClick={() => setForm({ ...form, packs: form.packs.filter((_, j) => j !== i) })}><Trash2 className="w-3.5 h-3.5" /></Button>
          </div>
        ))}
        <Button size="sm" onClick={() => setForm({ ...form, packs: [...form.packs, { name: '', tokens: 1000000, price: 10 }] })}><Plus className="w-3.5 h-3.5" />Add pack</Button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-3 border-t border-slate-800">
        {providers.map((p) => (
          <Field key={p.id} label={`${p.label} multiplier`}>
            <TextInput type="number" min={0.01} step="0.1" value={form.multipliers[p.id] ?? 1} onChange={(e) => setForm({ ...form, multipliers: { ...form.multipliers, [p.id]: e.target.value } })} />
          </Field>
        ))}
        <Field label="Signup bonus tokens" hint="Given to each newly registered organization.">
          <TextInput type="number" min={0} step={1000} value={form.signupBonusTokens} onChange={(e) => setForm({ ...form, signupBonusTokens: e.target.value })} />
        </Field>
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
    </Card>
  )
}

function AdjustModal({ org, onClose, onSaved, apiBaseUrl }) {
  const [tokens, setTokens] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { setTokens(''); setNote(''); setError('') }, [org])

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      await adminApi(`/organizations/${org.organizationId}/ai-tokens`, { method: 'POST', body: { tokens: Number(tokens), note }, apiBaseUrl })
      onSaved()
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={!!org} title={`Adjust AI tokens — ${org?.name || ''}`} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Apply</Button></>}>
      <p className="text-xs text-slate-400">Current balance: <span className="text-white font-bold tabular-nums">{fmt(org?.balance)}</span> tokens</p>
      <Field label="Tokens" hint="Positive to grant, negative to deduct.">
        <TextInput type="number" step={1000} value={tokens} onChange={(e) => setTokens(e.target.value)} placeholder="500000" autoFocus />
      </Field>
      <Field label="Note"><TextInput value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Refund for failed run" /></Field>
      {error && <Alert>{error}</Alert>}
    </Modal>
  )
}

const LEDGER_LABEL = { purchase: ['Purchase', 'green'], usage: ['Usage', 'slate'], grant: ['Grant', 'purple'], deduct: ['Deduct', 'red'] }

export default function AdminAI({ apiBaseUrl }) {
  const { data, loading, error, reload } = useAdminData(() => adminApi('/ai', { apiBaseUrl }), [])
  const [adjusting, setAdjusting] = useState(null)

  if (loading && !data) return <Loading />
  if (error && !data) return <Alert>{error}</Alert>

  const { status, billing, organizations, ledger } = data
  const orgName = Object.fromEntries(organizations.map((o) => [o.organizationId, o.name]))
  const totals = organizations.reduce((t, o) => ({ balance: t.balance + Math.max(o.balance, 0), used: t.used + o.used, revenue: t.revenue + o.revenue }), { balance: 0, used: 0, revenue: 0 })

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Tokens used" value={fmt(totals.used)} hint="All organizations" icon={Bot} />
        <StatCard label="Outstanding balance" value={fmt(totals.balance)} hint="Tokens bought, not yet used" icon={Coins} tone="text-amber-400" />
        <StatCard label="Token sales" value={`$${totals.revenue.toFixed(2)}`} hint="From pack purchases" icon={Gift} tone="text-emerald-400" />
      </div>

      <Card title="AI models & API keys" icon={Bot}>
        <p className="text-xs text-slate-400">
          These keys power the project AI agent for every organization. Keys stay on the server and are never shown to customers.
          Disabled providers can't be picked by organizations.
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {status.providers.map((p) => <ProviderCard key={p.id} p={p} isDefault={status.defaultProvider === p.id} apiBaseUrl={apiBaseUrl} onSaved={reload} />)}
        </div>
      </Card>

      <PricingCard billing={billing} providers={status.providers} apiBaseUrl={apiBaseUrl} onSaved={reload} />

      <Card title="Organization balances" icon={Coins}>
        {organizations.length === 0 ? <EmptyState>No organizations yet.</EmptyState> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs text-slate-300">
              <thead className="text-slate-500 uppercase text-[10px] tracking-wider border-b border-slate-800">
                <tr>
                  <th className="px-3 py-2.5">Organization</th>
                  <th className="px-3 py-2.5 text-right">Balance</th>
                  <th className="px-3 py-2.5 text-right">Purchased</th>
                  <th className="px-3 py-2.5 text-right">Used</th>
                  <th className="px-3 py-2.5">Last used</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {organizations.slice().sort((a, b) => b.used - a.used || b.balance - a.balance).map((o) => (
                  <tr key={o.organizationId}>
                    <td className="px-3 py-2.5 text-white font-semibold">{o.name}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums font-bold ${o.balance > 0 ? 'text-emerald-300' : 'text-slate-500'}`}>{fmt(o.balance)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmt(o.purchased)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmt(o.used)}</td>
                    <td className="px-3 py-2.5 text-slate-400">{o.lastUsedAt ? timeAgo(o.lastUsedAt) : '—'}</td>
                    <td className="px-3 py-2.5 text-right"><Button size="sm" onClick={() => setAdjusting(o)}>Adjust</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Recent token activity" icon={History}>
        {ledger.length === 0 ? <EmptyState>No purchases or usage yet.</EmptyState> : (
          <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
            <table className="w-full min-w-[640px] text-left text-xs text-slate-300">
              <thead className="text-slate-500 uppercase text-[10px] tracking-wider border-b border-slate-800">
                <tr>
                  <th className="px-3 py-2.5">When</th>
                  <th className="px-3 py-2.5">Organization</th>
                  <th className="px-3 py-2.5">Type</th>
                  <th className="px-3 py-2.5">Details</th>
                  <th className="px-3 py-2.5 text-right">Tokens</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {ledger.map((e) => {
                  const [label, tone] = LEDGER_LABEL[e.type] || [e.type, 'slate']
                  return (
                    <tr key={e.id}>
                      <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{formatDate(e.at, true)}</td>
                      <td className="px-3 py-2">{orgName[e.organizationId] || e.organizationId}</td>
                      <td className="px-3 py-2"><Badge tone={tone}>{label}</Badge></td>
                      <td className="px-3 py-2 text-slate-400 truncate max-w-[260px]">
                        {e.type === 'usage' ? `${e.projectName || ''} · ${e.model || e.provider}` : e.type === 'purchase' ? `${e.packName} · $${e.amount}` : e.note || ''}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums font-semibold ${e.delta > 0 ? 'text-emerald-300' : 'text-slate-300'}`}>{e.delta > 0 ? '+' : ''}{fmt(e.delta)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <AdjustModal org={adjusting} onClose={() => setAdjusting(null)} onSaved={reload} apiBaseUrl={apiBaseUrl} />
    </div>
  )
}
