import React, { useEffect, useState } from 'react'
import { CreditCard, Plus, Pencil, Trash2, Check, X, EyeOff } from 'lucide-react'
import { adminApi } from './adminApi'
import { Card, Badge, Button, Modal, ConfirmDialog, Field, TextInput, Alert, Loading, useAdminData } from './AdminUI'

const LIMITS = [
  ['maxServers', 'Servers'],
  ['maxProjects', 'Projects'],
  ['maxTeamMembers', 'Team members'],
  ['maxDeploymentsPerMonth', 'Deploys / month']
]
const FEATURES = [
  ['monitoring', 'Monitoring'],
  ['apiAccess', 'API access'],
  ['teamAccess', 'Team access']
]

function PlanModal({ plan, isNew, open, onClose, onSaved, apiBaseUrl }) {
  const [form, setForm] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setForm(plan ? { ...plan } : { id: '', name: '', priceMonthly: 0, maxServers: 1, maxProjects: 3, maxTeamMembers: 1, maxDeploymentsPerMonth: 50, monitoring: false, apiAccess: false, teamAccess: false, isPublic: true })
      setError('')
    }
  }, [open, plan])

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      if (isNew) await adminApi('/plans', { method: 'POST', body: form, apiBaseUrl })
      else await adminApi(`/plans/${plan.id}`, { method: 'PUT', body: form, apiBaseUrl })
      onSaved()
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const num = (key) => (e) => setForm({ ...form, [key]: e.target.value })

  return (
    <Modal open={open} title={isNew ? 'New plan' : `Edit ${plan?.name}`} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save plan</Button></>}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Plan ID" hint={isNew ? 'Uppercase letters, numbers and _ only. Cannot be changed later.' : 'Cannot be changed.'}>
          <TextInput value={form.id || ''} disabled={!isNew} onChange={(e) => setForm({ ...form, id: e.target.value.toUpperCase() })} placeholder="AGENCY" />
        </Field>
        <Field label="Display name"><TextInput value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Agency" /></Field>
        <Field label="Price per month (USD)"><TextInput type="number" min={0} step="0.01" value={form.priceMonthly ?? ''} onChange={num('priceMonthly')} /></Field>
        {LIMITS.map(([key, label]) => (
          <Field key={key} label={label}><TextInput type="number" min={0} value={form[key] ?? ''} onChange={num(key)} /></Field>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {[...FEATURES, ['isPublic', 'Shown to customers']].map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
            <input type="checkbox" className="accent-purple-500" checked={!!form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.checked })} />
            {label}
          </label>
        ))}
      </div>
      <p className="text-[11px] text-slate-500">Hidden plans aren't offered for self-service upgrades; assign them to organizations manually.</p>
      {error && <Alert>{error}</Alert>}
    </Modal>
  )
}

export default function AdminPlans({ apiBaseUrl }) {
  const { data, loading, error, reload } = useAdminData(() => adminApi('/plans', { apiBaseUrl }), [])
  const [editing, setEditing] = useState(null)
  const [creating, setCreating] = useState(false)
  const [confirm, setConfirm] = useState(null)

  const plans = (data?.plans || []).slice().sort((a, b) => a.priceMonthly - b.priceMonthly)

  return (
    <Card title="Plans & pricing" icon={CreditCard} actions={<Button variant="primary" onClick={() => setCreating(true)}><Plus className="w-3.5 h-3.5" />New plan</Button>}>
      {error && <Alert>{error}</Alert>}
      {loading && !data ? <Loading /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {plans.map((p) => (
            <div key={p.id} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5 flex flex-col gap-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-white truncate">{p.name}</div>
                  <div className="text-[11px] font-mono text-slate-500">{p.id}</div>
                </div>
                {!p.isPublic && <Badge tone="amber"><EyeOff className="w-3 h-3 mr-1" />Hidden</Badge>}
              </div>
              <div>
                <span className="text-3xl font-black text-white tabular-nums">${p.priceMonthly}</span>
                <span className="text-xs text-slate-500"> / month</span>
              </div>
              <ul className="space-y-1.5 text-xs">
                {LIMITS.map(([key, label]) => (
                  <li key={key} className="flex justify-between gap-2">
                    <span className="text-slate-400">{label}</span>
                    <span className="text-slate-200 font-semibold tabular-nums">{p[key]}</span>
                  </li>
                ))}
                {FEATURES.map(([key, label]) => (
                  <li key={key} className="flex justify-between gap-2">
                    <span className="text-slate-400">{label}</span>
                    {p[key] ? <Check className="w-3.5 h-3.5 text-emerald-400" aria-label="Included" /> : <X className="w-3.5 h-3.5 text-slate-600" aria-label="Not included" />}
                  </li>
                ))}
              </ul>
              <div className="mt-auto flex items-center justify-between gap-2 pt-2 border-t border-slate-800">
                <span className="text-[11px] text-slate-500">{p.subscriberCount} subscriber{p.subscriberCount === 1 ? '' : 's'}</span>
                <div className="flex gap-1.5">
                  <Button size="sm" onClick={() => setEditing(p)} aria-label={`Edit ${p.name}`}><Pencil className="w-3.5 h-3.5" /></Button>
                  {p.id !== 'FREE' && (
                    <Button size="sm" variant="danger" aria-label={`Delete ${p.name}`} onClick={() => setConfirm({
                      title: `Delete ${p.name}?`, message: 'Plans in use or set as the default signup plan cannot be deleted.', confirmLabel: 'Delete plan',
                      onConfirm: async () => { await adminApi(`/plans/${p.id}`, { method: 'DELETE', apiBaseUrl }); reload() }
                    })}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <PlanModal open={creating} isNew onClose={() => setCreating(false)} onSaved={reload} apiBaseUrl={apiBaseUrl} />
      <PlanModal open={!!editing} plan={editing} onClose={() => setEditing(null)} onSaved={reload} apiBaseUrl={apiBaseUrl} />
      <ConfirmDialog open={!!confirm} {...(confirm || {})} onClose={() => setConfirm(null)} />
    </Card>
  )
}
