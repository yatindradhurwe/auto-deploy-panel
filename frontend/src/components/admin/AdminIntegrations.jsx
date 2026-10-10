import React, { useEffect, useState } from 'react'
import { CreditCard, Mail, MessageSquare, MessageCircle, Bell, Receipt, Send } from 'lucide-react'
import { adminApi, formatDate } from './adminApi'
import { Card, Badge, Button, Field, TextInput, Select, Toggle, Alert, Loading, EmptyState, useAdminData } from './AdminUI'
import { formatMoney } from '../../utils/razorpay'

const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj)
function set(obj, path, value) {
  const [head, ...rest] = path.split('.')
  return { ...obj, [head]: rest.length ? set(obj[head] || {}, rest.join('.'), value) : value }
}

const SECTIONS = {
  razorpay: {
    title: 'Razorpay payments',
    icon: CreditCard,
    intro: 'Customers pay for plan upgrades and AI token packs with Razorpay Checkout. Keys are in the Razorpay Dashboard → Account & Settings → API Keys.',
    test: { label: 'Test connection' },
    fields: [
      { key: 'keyId', label: 'Key ID', placeholder: 'rzp_live_…' },
      { key: 'keySecret', label: 'Key Secret', type: 'secret' },
      { key: 'webhookSecret', label: 'Webhook secret', type: 'secret', hint: 'The secret you enter when creating the webhook in Razorpay.' },
      { key: 'currency', label: 'Currency', type: 'select', options: 'currencies', hint: 'Plan and token pack prices are charged in this currency.' },
      { key: 'businessName', label: 'Name shown in Checkout' }
    ]
  },
  email: {
    title: 'Email (SMTP)',
    icon: Mail,
    intro: 'Used for receipts, welcome emails and support replies. Works with any SMTP service (Gmail/Google Workspace, Zoho, Amazon SES, SendGrid, Brevo, your own mail server).',
    test: { label: 'Send test email', to: 'Recipient email', placeholder: 'you@example.com' },
    fields: [
      { key: 'host', label: 'SMTP host', placeholder: 'smtp.gmail.com' },
      { key: 'port', label: 'Port', type: 'number', placeholder: '587' },
      { key: 'secure', label: 'Use SSL/TLS (usually port 465; leave off for STARTTLS on 587)', type: 'checkbox' },
      { key: 'user', label: 'Username' },
      { key: 'pass', label: 'Password / app password', type: 'secret' },
      { key: 'fromName', label: 'From name' },
      { key: 'fromEmail', label: 'From email', placeholder: 'no-reply@yourdomain.com' }
    ]
  },
  sms: {
    title: 'SMS',
    icon: MessageSquare,
    intro: 'Text messages to the phone number on a user\'s profile.',
    test: { label: 'Send test SMS', to: 'Phone number', placeholder: '+91 98765 43210' },
    fields: [
      { key: 'provider', label: 'Provider', type: 'select', options: [{ value: 'twilio', label: 'Twilio' }, { value: 'msg91', label: 'MSG91 (India, DLT)' }] },
      { key: 'twilio.accountSid', label: 'Account SID', show: (f) => f.provider === 'twilio' },
      { key: 'twilio.authToken', label: 'Auth Token', type: 'secret', show: (f) => f.provider === 'twilio' },
      { key: 'twilio.from', label: 'From number or Messaging Service SID', placeholder: '+15551234567', show: (f) => f.provider === 'twilio' },
      { key: 'msg91.authKey', label: 'Auth key', type: 'secret', show: (f) => f.provider === 'msg91' },
      { key: 'msg91.templateId', label: 'Flow template ID', hint: 'A DLT-approved Flow template with one variable for the message.', show: (f) => f.provider === 'msg91' },
      { key: 'msg91.variableName', label: 'Template variable name', placeholder: 'var1', show: (f) => f.provider === 'msg91' }
    ]
  },
  whatsapp: {
    title: 'WhatsApp',
    icon: MessageCircle,
    intro: 'WhatsApp messages to the phone number on a user\'s profile.',
    test: { label: 'Send test message', to: 'WhatsApp number', placeholder: '+91 98765 43210' },
    fields: [
      { key: 'provider', label: 'Provider', type: 'select', options: [{ value: 'meta', label: 'Meta WhatsApp Cloud API' }, { value: 'twilio', label: 'Twilio WhatsApp' }] },
      { key: 'meta.phoneNumberId', label: 'Phone number ID', hint: 'Meta for Developers → WhatsApp → API Setup.', show: (f) => f.provider === 'meta' },
      { key: 'meta.accessToken', label: 'Permanent access token', type: 'secret', show: (f) => f.provider === 'meta' },
      { key: 'meta.templateName', label: 'Message template name', hint: 'An approved template whose body is {{1}}. Required to message users who haven\'t written to you in the last 24 hours.', show: (f) => f.provider === 'meta' },
      { key: 'meta.languageCode', label: 'Template language code', placeholder: 'en', show: (f) => f.provider === 'meta' },
      { key: 'twilio.accountSid', label: 'Account SID', show: (f) => f.provider === 'twilio' },
      { key: 'twilio.authToken', label: 'Auth Token', type: 'secret', show: (f) => f.provider === 'twilio' },
      { key: 'twilio.from', label: 'WhatsApp sender', placeholder: '+14155238886', show: (f) => f.provider === 'twilio' }
    ]
  }
}

function SecretInput({ field, masked, value, onChange, onClear }) {
  return (
    <div className="flex gap-2">
      <TextInput type="password" autoComplete="new-password" value={value || ''} onChange={(e) => onChange(e.target.value)}
        placeholder={masked?.set ? `Saved (${masked.hint}) — type to replace` : 'Not set'} />
      {masked?.set && <Button size="sm" variant="danger" onClick={onClear} aria-label={`Clear ${field.label}`}>Clear</Button>}
    </div>
  )
}

function SectionCard({ id, config, currencies, apiBaseUrl, onSaved, extra }) {
  const spec = SECTIONS[id]
  const [form, setForm] = useState(config)
  const [secrets, setSecrets] = useState({})
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState(null)
  const [to, setTo] = useState('')

  useEffect(() => { setForm(config); setSecrets({}) }, [config])

  const visible = spec.fields.filter((f) => !f.show || f.show(form))

  const payload = (overrides = {}) => {
    let body = { enabled: form.enabled }
    for (const f of spec.fields) {
      if (f.type === 'secret') {
        if (overrides[f.key] !== undefined) body = set(body, f.key, overrides[f.key])
        else if (secrets[f.key]) body = set(body, f.key, secrets[f.key])
      } else {
        body = set(body, f.key, get(form, f.key))
      }
    }
    return body
  }

  const save = async (overrides, okText = 'Saved.') => {
    setBusy('save')
    setMsg(null)
    try {
      await adminApi(`/integrations/${id}`, { method: 'PUT', body: payload(overrides), apiBaseUrl })
      setMsg({ tone: 'success', text: okText })
      onSaved()
    } catch (e) {
      setMsg({ tone: 'error', text: e.message })
    } finally {
      setBusy('')
    }
  }

  const test = async () => {
    setBusy('test')
    setMsg(null)
    try {
      const res = await adminApi(`/integrations/${id}/test`, { method: 'POST', body: { to }, apiBaseUrl })
      setMsg({ tone: 'success', text: res.message })
    } catch (e) {
      setMsg({ tone: 'error', text: e.message })
    } finally {
      setBusy('')
    }
  }

  const renderField = (f) => {
    const value = get(form, f.key)
    if (f.type === 'checkbox') {
      return (
        <label key={f.key} className="sm:col-span-2 flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
          <input type="checkbox" className="accent-purple-500" checked={!!value} onChange={(e) => setForm(set(form, f.key, e.target.checked))} />
          {f.label}
        </label>
      )
    }
    let input
    if (f.type === 'secret') {
      input = <SecretInput field={f} masked={value} value={secrets[f.key]} onChange={(v) => setSecrets({ ...secrets, [f.key]: v })}
        onClear={() => save({ [f.key]: null }, `${f.label} cleared.`)} />
    } else if (f.type === 'select') {
      const options = f.options === 'currencies' ? currencies.map((c) => ({ value: c, label: c })) : f.options
      input = <Select value={value} onChange={(v) => setForm(set(form, f.key, v))} options={options} className="w-full" />
    } else {
      input = <TextInput type={f.type === 'number' ? 'number' : 'text'} value={value ?? ''} placeholder={f.placeholder}
        onChange={(e) => setForm(set(form, f.key, f.type === 'number' ? e.target.value : e.target.value))} />
    }
    return <Field key={f.key} label={f.label} hint={f.hint}>{input}</Field>
  }

  return (
    <Card title={spec.title} icon={spec.icon} actions={<Badge tone={config.enabled ? 'green' : 'slate'}>{config.enabled ? 'Enabled' : 'Off'}</Badge>}>
      <p className="text-xs text-slate-400">{spec.intro}</p>
      <Toggle checked={!!form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} label={`Enable ${spec.title}`} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{visible.map(renderField)}</div>
      {extra}
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="flex flex-wrap items-end gap-2 pt-3 border-t border-slate-800">
        <Button variant="primary" loading={busy === 'save'} onClick={() => save()}>Save</Button>
        <div className="flex flex-wrap items-end gap-2 sm:ml-auto">
          {spec.test.to && <TextInput value={to} onChange={(e) => setTo(e.target.value)} placeholder={spec.test.placeholder} aria-label={spec.test.to} className="sm:w-56" />}
          <Button loading={busy === 'test'} onClick={test}><Send className="w-3.5 h-3.5" />{spec.test.label}</Button>
        </div>
      </div>
      <p className="text-[11px] text-slate-500">Save before testing — tests use the saved settings.</p>
    </Card>
  )
}

function NotificationsCard({ config, events, apiBaseUrl, onSaved }) {
  const [form, setForm] = useState(config)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  useEffect(() => setForm(config), [config])

  const save = async () => {
    setBusy(true)
    setMsg(null)
    try {
      await adminApi('/integrations/notifications', { method: 'PUT', body: form, apiBaseUrl })
      setMsg({ tone: 'success', text: 'Notification settings saved.' })
      onSaved()
    } catch (e) {
      setMsg({ tone: 'error', text: e.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Notifications" icon={Bell} actions={<Button variant="primary" loading={busy} onClick={save}>Save</Button>}>
      <p className="text-xs text-slate-400">Choose which messages go out on each channel. A channel only sends when it is enabled above; SMS and WhatsApp need a phone number on the user's profile.</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-left text-xs text-slate-300">
          <thead className="text-slate-500 uppercase text-[10px] tracking-wider border-b border-slate-800">
            <tr><th className="px-3 py-2.5">Event</th><th className="px-3 py-2.5 text-center">Email</th><th className="px-3 py-2.5 text-center">SMS</th><th className="px-3 py-2.5 text-center">WhatsApp</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70">
            {Object.entries(events).map(([ev, label]) => (
              <tr key={ev}>
                <td className="px-3 py-2.5">{label}</td>
                {['email', 'sms', 'whatsapp'].map((ch) => (
                  <td key={ch} className="px-3 py-2.5 text-center">
                    <input type="checkbox" className="accent-purple-500" aria-label={`${label} by ${ch}`} checked={!!form.events[ev]?.[ch]}
                      onChange={(e) => setForm(set(form, `events.${ev}.${ch}`, e.target.checked))} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Field label="Default country code" hint="Added to phone numbers saved without one, e.g. 91 for India.">
        <TextInput value={form.defaultCountryCode} onChange={(e) => setForm({ ...form, defaultCountryCode: e.target.value })} className="sm:w-32" />
      </Field>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
    </Card>
  )
}

const STATUS_TONE = { paid: 'green', created: 'amber', failed: 'red' }

export default function AdminIntegrations({ apiBaseUrl }) {
  const { data, loading, error, reload } = useAdminData(() => adminApi('/integrations', { apiBaseUrl }), [])

  if (loading && !data) return <Loading />
  if (error && !data) return <Alert>{error}</Alert>

  const { integrations, currencies, events, payments } = data
  const webhookUrl = `${window.location.origin}/api/billing/razorpay/webhook`

  return (
    <div className="space-y-6">
      <SectionCard id="razorpay" config={integrations.razorpay} currencies={currencies} apiBaseUrl={apiBaseUrl} onSaved={reload}
        extra={(
          <div className="space-y-1.5">
            <Field label="Webhook URL (Razorpay Dashboard → Webhooks)">
              <div className="flex gap-2">
                <TextInput readOnly value={webhookUrl} onFocus={(e) => e.target.select()} className="font-mono" />
                <Button size="sm" onClick={() => navigator.clipboard?.writeText(webhookUrl).catch(() => {})}>Copy</Button>
              </div>
            </Field>
            <p className="text-[11px] text-slate-500">Select the events <span className="font-mono">order.paid</span>, <span className="font-mono">payment.captured</span> and <span className="font-mono">payment.failed</span>. The webhook confirms payments even if the customer closes the browser before returning.</p>
          </div>
        )} />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <SectionCard id="email" config={integrations.email} currencies={currencies} apiBaseUrl={apiBaseUrl} onSaved={reload} />
        <NotificationsCard config={integrations.notifications} events={events} apiBaseUrl={apiBaseUrl} onSaved={reload} />
        <SectionCard id="sms" config={integrations.sms} currencies={currencies} apiBaseUrl={apiBaseUrl} onSaved={reload} />
        <SectionCard id="whatsapp" config={integrations.whatsapp} currencies={currencies} apiBaseUrl={apiBaseUrl} onSaved={reload} />
      </div>

      <Card title="Recent payments" icon={Receipt}>
        {payments.length === 0 ? <EmptyState>No payments yet.</EmptyState> : (
          <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
            <table className="w-full min-w-[720px] text-left text-xs text-slate-300">
              <thead className="text-slate-500 uppercase text-[10px] tracking-wider border-b border-slate-800">
                <tr>
                  <th className="px-3 py-2.5">Created</th>
                  <th className="px-3 py-2.5">Organization</th>
                  <th className="px-3 py-2.5">Item</th>
                  <th className="px-3 py-2.5 text-right">Amount</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">Payment ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {payments.map((p) => (
                  <tr key={p.orderId}>
                    <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{formatDate(p.createdAt, true)}</td>
                    <td className="px-3 py-2">{p.organizationName}</td>
                    <td className="px-3 py-2">{p.kind === 'plan' ? `Plan · ${p.itemName}` : `Tokens · ${p.itemName}`}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(p.amount, p.currency)}</td>
                    <td className="px-3 py-2"><Badge tone={STATUS_TONE[p.status] || 'slate'}>{p.status}</Badge></td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-400">{p.paymentId || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
