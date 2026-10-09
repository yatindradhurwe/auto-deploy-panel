import React, { useEffect, useState } from 'react'
import { Settings, Wrench, UserPlus, Megaphone } from 'lucide-react'
import { adminApi } from './adminApi'
import { Card, Button, Field, Select, Toggle, Alert, Loading, ConfirmDialog, useAdminData } from './AdminUI'

export default function AdminSettings({ apiBaseUrl }) {
  const { data, loading, error, reload } = useAdminData(() => adminApi('/settings', { apiBaseUrl }), [])
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const [confirmMaintenance, setConfirmMaintenance] = useState(false)

  useEffect(() => {
    if (data) setForm({ ...data.settings })
  }, [data])

  if (loading && !data) return <Loading />
  if (error) return <Alert>{error}</Alert>
  if (!form) return null

  const dirty = JSON.stringify(form) !== JSON.stringify(data.settings)

  const save = async () => {
    setBusy(true)
    setMessage(null)
    try {
      await adminApi('/settings', { method: 'PUT', body: form, apiBaseUrl })
      setMessage({ tone: 'success', text: 'Settings saved. They apply immediately.' })
      await reload()
    } catch (e) {
      setMessage({ tone: 'error', text: e.message })
    } finally {
      setBusy(false)
    }
  }

  const onSave = () => {
    if (form.maintenanceMode && !data.settings.maintenanceMode) setConfirmMaintenance(true)
    else save()
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {message && <Alert tone={message.tone}>{message.text}</Alert>}

      <Card title="Registration" icon={UserPlus}>
        <Toggle
          checked={form.allowSignups}
          onChange={(v) => setForm({ ...form, allowSignups: v })}
          label="Allow new signups"
          description="When off, the signup form is hidden and only admins can create accounts."
        />
        <Field label="Plan for new signups">
          <Select value={form.defaultSignupPlanId} onChange={(v) => setForm({ ...form, defaultSignupPlanId: v })} className="w-full sm:w-72"
            options={data.plans.map((p) => ({ value: p.id, label: p.name }))} />
        </Field>
      </Card>

      <Card title="Maintenance mode" icon={Wrench}>
        <Toggle
          checked={form.maintenanceMode}
          onChange={(v) => setForm({ ...form, maintenanceMode: v })}
          label="Lock out customers"
          description="Customers are signed out and see the message below. Platform admins keep full access. Hosted websites keep running."
        />
        <Field label="Message shown to customers">
          <textarea
            value={form.maintenanceMessage}
            onChange={(e) => setForm({ ...form, maintenanceMessage: e.target.value })}
            maxLength={500}
            rows={2}
            className="w-full bg-slate-950 border border-slate-800 focus:border-purple-500/60 outline-none rounded-xl px-3 py-2 text-xs text-slate-200"
          />
        </Field>
      </Card>

      <Card title="Announcement banner" icon={Megaphone}>
        <Field label="Shown at the top of the panel and on the sign-in page" hint="Leave empty to hide the banner.">
          <textarea
            value={form.announcement}
            onChange={(e) => setForm({ ...form, announcement: e.target.value })}
            maxLength={500}
            rows={2}
            placeholder="e.g. Scheduled upgrade on Sunday 02:00–03:00 UTC"
            className="w-full bg-slate-950 border border-slate-800 focus:border-purple-500/60 outline-none rounded-xl px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600"
          />
        </Field>
      </Card>

      <div className="flex justify-end gap-2">
        <Button disabled={!dirty || busy} onClick={() => setForm({ ...data.settings })}>Discard</Button>
        <Button variant="primary" disabled={!dirty} loading={busy} onClick={onSave}><Settings className="w-3.5 h-3.5" />Save settings</Button>
      </div>

      <ConfirmDialog
        open={confirmMaintenance}
        title="Turn on maintenance mode?"
        message="Every customer will be locked out of the panel immediately until you turn it off."
        confirmLabel="Turn on maintenance"
        variant="warning"
        onConfirm={save}
        onClose={() => setConfirmMaintenance(false)}
      />
    </div>
  )
}
