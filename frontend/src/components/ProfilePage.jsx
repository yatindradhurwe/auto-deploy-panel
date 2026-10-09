import React, { useEffect, useState } from 'react'
import { UserCircle, Mail, KeyRound, Building, ShieldCheck, Check, X, MonitorSmartphone } from 'lucide-react'
import { getAuthToken, formatDate, timeAgo } from './admin/adminApi'
import { Card, Badge, Button, Field, TextInput, Alert, Loading } from './admin/AdminUI'
import { useAuth } from '../store/AuthContext'

async function profileApi(path, { method = 'GET', body, apiBaseUrl = '' } = {}) {
  const res = await fetch(`${apiBaseUrl}/api/profile${path}`, {
    method,
    headers: { Authorization: `Bearer ${getAuthToken()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

// What each platform role can reach; enforced server-side by requireSystemAdmin / requireTenant / requireRole
const ROLE_ACCESS = {
  superadmin: {
    label: 'Super Admin',
    tone: 'purple',
    allowed: [
      'Super admin console: users, organizations, plans, subscriptions, support tickets, platform settings and audit trail',
      'Root server tools on the panel host: terminal, file manager, databases and code studio',
      'Every customer organization, server and project'
    ],
    denied: []
  },
  admin: {
    label: 'Admin',
    tone: 'cyan',
    allowed: [
      'Your organization\'s servers, projects, deployments, databases, domains, cron jobs and email',
      'Team, billing and firm details (as organization owner or admin)',
      'Support desk for your organization'
    ],
    denied: [
      'Super admin console and other customers\' data',
      'Root tools on the platform host'
    ]
  }
}

const FIRM_FIELDS = [
  ['name', 'Firm / organization name', 'Acme Technologies'],
  ['legalName', 'Registered legal name', 'Acme Technologies Pvt. Ltd.'],
  ['taxId', 'GSTIN / Tax ID', '22AAAAA0000A1Z5'],
  ['website', 'Website', 'https://example.com'],
  ['email', 'Business email', 'billing@example.com'],
  ['phone', 'Business phone', '+91 98765 43210'],
  ['addressLine', 'Address', 'Street, building, floor'],
  ['city', 'City', ''],
  ['state', 'State / province', ''],
  ['postalCode', 'Postal code', ''],
  ['country', 'Country', '']
]

// "Chrome on Windows" style label from a user agent string
function deviceLabel(userAgent) {
  const ua = userAgent || ''
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /curl|node|axios|python/i.test(ua) ? 'API client' : 'Unknown browser'
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS'
    : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : ''
  return os ? `${browser} on ${os}` : browser
}

function firmForm(organization) {
  const details = organization?.details || {}
  return Object.fromEntries(FIRM_FIELDS.map(([key]) => [key, key === 'name' ? organization?.name || '' : details[key] || '']))
}

/**
 * Profile page shared by the super admin console and the admin server panel.
 * Name/email/password changes are pushed into the auth store so the header and token stay current.
 */
export default function ProfilePage({ apiBaseUrl = '' }) {
  const { updateSession: onSessionUpdate } = useAuth()
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState('')
  const [messages, setMessages] = useState({})
  const [personal, setPersonal] = useState({ fullName: '', phone: '', jobTitle: '' })
  const [emailForm, setEmailForm] = useState({ email: '', currentPassword: '' })
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [firm, setFirm] = useState(firmForm(null))
  const [sessions, setSessions] = useState(null)

  const apply = (result) => {
    setData(result)
    setPersonal({ fullName: result.profile.fullName, phone: result.profile.phone, jobTitle: result.profile.jobTitle })
    setFirm(firmForm(result.organization))
  }

  const loadSessions = () => profileApi('/sessions', { apiBaseUrl }).then((r) => setSessions(r.sessions)).catch(() => setSessions([]))

  useEffect(() => {
    profileApi('', { apiBaseUrl }).then(apply).catch((err) => setLoadError(err.message))
    loadSessions()
  }, [apiBaseUrl])

  const run = async (key, fn) => {
    setBusy(key)
    setMessages((m) => ({ ...m, [key]: null }))
    try {
      const text = await fn()
      setMessages((m) => ({ ...m, [key]: { tone: 'success', text } }))
    } catch (err) {
      setMessages((m) => ({ ...m, [key]: { tone: 'error', text: err.message } }))
    } finally {
      setBusy('')
    }
  }

  const savePersonal = () => run('personal', async () => {
    const result = await profileApi('', { method: 'PATCH', body: personal, apiBaseUrl })
    apply(result)
    onSessionUpdate(result.user)
    return 'Profile saved.'
  })

  const saveEmail = () => run('email', async () => {
    const result = await profileApi('/email', { method: 'PUT', body: emailForm, apiBaseUrl })
    apply(result)
    onSessionUpdate(result.user)
    setEmailForm({ email: '', currentPassword: '' })
    return `You now sign in with ${result.profile.email}.`
  })

  const savePassword = () => run('password', async () => {
    if (passwordForm.newPassword !== passwordForm.confirmPassword) throw new Error('New passwords do not match.')
    const result = await profileApi('/password', {
      method: 'PUT',
      body: { currentPassword: passwordForm.currentPassword, newPassword: passwordForm.newPassword },
      apiBaseUrl
    })
    onSessionUpdate(result.user, result.token)
    setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
    loadSessions()
    return result.message
  })

  const revokeDevice = (id) => run('sessions', async () => {
    await profileApi(`/sessions/${id}`, { method: 'DELETE', apiBaseUrl })
    await loadSessions()
    return 'That device has been signed out.'
  })

  const revokeOthers = () => run('sessions', async () => {
    const result = await profileApi('/sessions/revoke-others', { method: 'POST', apiBaseUrl })
    await loadSessions()
    return result.message
  })

  const saveFirm = () => run('firm', async () => {
    const result = await profileApi('/organization', { method: 'PATCH', body: firm, apiBaseUrl })
    apply(result)
    return 'Firm details saved.'
  })

  const notice = (key) => messages[key] && <Alert tone={messages[key].tone}>{messages[key].text}</Alert>

  if (loadError) return <Alert>{loadError}</Alert>
  if (!data) return <Loading />

  const { profile, organization, access } = data
  const role = ROLE_ACCESS[profile.role] || ROLE_ACCESS.admin
  const isSuperAdmin = profile.role === 'superadmin'

  return (
    <div className="space-y-6 font-sans">
      <Card>
        <div className="flex flex-wrap items-center gap-4">
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-black text-slate-950 shrink-0 ${isSuperAdmin ? 'bg-amber-400' : 'bg-cyan-400'}`}>
            {(profile.fullName || profile.email || 'U').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-white truncate">{profile.fullName || profile.email}</h2>
              <Badge tone={role.tone}>{role.label}</Badge>
              {access.memberRole && <Badge>{access.memberRole} of {organization?.name}</Badge>}
            </div>
            <div className="text-xs text-slate-400 mt-1 break-all">{profile.email}{profile.phone ? ` · ${profile.phone}` : ''}</div>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-[11px]">
            <dt className="text-slate-500">Member since</dt><dd className="text-slate-200">{formatDate(profile.createdAt)}</dd>
            <dt className="text-slate-500">Last login</dt><dd className="text-slate-200">{timeAgo(profile.lastLoginAt)}</dd>
            <dt className="text-slate-500">Password changed</dt><dd className="text-slate-200">{profile.passwordChangedAt ? timeAgo(profile.passwordChangedAt) : 'Never'}</dd>
          </dl>
        </div>
        {access.impersonated && (
          <Alert>You are viewing this profile as a super admin. Email and password changes are disabled in this session.</Alert>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Personal details" icon={UserCircle}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Full name"><TextInput value={personal.fullName} onChange={(e) => setPersonal({ ...personal, fullName: e.target.value })} /></Field>
            <Field label="Phone number"><TextInput type="tel" placeholder="+91 98765 43210" value={personal.phone} onChange={(e) => setPersonal({ ...personal, phone: e.target.value })} /></Field>
            <Field label="Job title"><TextInput placeholder="e.g. DevOps Lead" value={personal.jobTitle} onChange={(e) => setPersonal({ ...personal, jobTitle: e.target.value })} /></Field>
          </div>
          {notice('personal')}
          <div className="flex justify-end">
            <Button variant="primary" loading={busy === 'personal'} onClick={savePersonal}>Save details</Button>
          </div>
        </Card>

        <Card title="Access & permissions" icon={ShieldCheck}>
          <ul className="space-y-2 text-xs">
            {role.allowed.map((item) => (
              <li key={item} className="flex items-start gap-2 text-slate-300"><Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-px" />{item}</li>
            ))}
            {role.denied.map((item) => (
              <li key={item} className="flex items-start gap-2 text-slate-500"><X className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-px" />{item}</li>
            ))}
          </ul>
          <p className="text-[11px] text-slate-500">
            {isSuperAdmin ? 'Platform roles are managed from Users in this console.' : 'Contact platform support if you need a different level of access.'}
          </p>
        </Card>

        <Card title="Email address" icon={Mail}>
          <p className="text-xs text-slate-400">Current: <span className="text-slate-200 font-semibold break-all">{profile.email}</span></p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="New email"><TextInput type="email" autoComplete="email" disabled={!access.canChangeCredentials} value={emailForm.email} onChange={(e) => setEmailForm({ ...emailForm, email: e.target.value })} /></Field>
            <Field label="Current password"><TextInput type="password" autoComplete="current-password" disabled={!access.canChangeCredentials} value={emailForm.currentPassword} onChange={(e) => setEmailForm({ ...emailForm, currentPassword: e.target.value })} /></Field>
          </div>
          {notice('email')}
          <div className="flex justify-end">
            <Button variant="primary" loading={busy === 'email'} disabled={!access.canChangeCredentials || !emailForm.email || !emailForm.currentPassword} onClick={saveEmail}>Change email</Button>
          </div>
        </Card>

        <Card title="Password" icon={KeyRound}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Current password"><TextInput type="password" autoComplete="current-password" disabled={!access.canChangeCredentials} value={passwordForm.currentPassword} onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })} /></Field>
            <Field label="New password" hint="At least 8 characters"><TextInput type="password" autoComplete="new-password" disabled={!access.canChangeCredentials} value={passwordForm.newPassword} onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })} /></Field>
            <Field label="Confirm new password"><TextInput type="password" autoComplete="new-password" disabled={!access.canChangeCredentials} value={passwordForm.confirmPassword} onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })} /></Field>
          </div>
          <p className="text-[11px] text-slate-500">Changing your password signs you out on every other device.</p>
          {notice('password')}
          <div className="flex justify-end">
            <Button variant="primary" loading={busy === 'password'} disabled={!access.canChangeCredentials || !passwordForm.currentPassword || !passwordForm.newPassword} onClick={savePassword}>Update password</Button>
          </div>
        </Card>
      </div>

      <Card
        title="Signed-in devices"
        icon={MonitorSmartphone}
        actions={sessions && sessions.length > 1 && !access.impersonated && (
          <Button size="sm" variant="danger" loading={busy === 'sessions'} onClick={revokeOthers}>Sign out other devices</Button>
        )}
      >
        {!sessions ? <Loading /> : (
          <ul className="divide-y divide-slate-800">
            {sessions.map((s) => (
              <li key={s.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="min-w-0">
                  <div className="text-slate-200 font-semibold flex flex-wrap items-center gap-2">
                    {deviceLabel(s.userAgent)}
                    {s.current && <Badge tone="green">This device</Badge>}
                    {s.impersonatedBy && <Badge tone="amber">Support access</Badge>}
                  </div>
                  <div className="text-slate-500 mt-0.5">
                    {s.ip || 'Unknown IP'} · signed in {timeAgo(s.createdAt)} · active {timeAgo(s.lastSeenAt)} · expires {formatDate(s.expiresAt, true)}
                  </div>
                </div>
                {!s.current && !access.impersonated && (
                  <Button size="sm" onClick={() => revokeDevice(s.id)} disabled={busy === 'sessions'}>Sign out</Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {notice('sessions')}
      </Card>

      {organization && (
        <Card
          title={isSuperAdmin ? 'Platform company details' : 'Firm / organization details'}
          icon={Building}
          actions={!access.canEditOrganization && <Badge tone="amber">Read only · owners and admins can edit</Badge>}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {FIRM_FIELDS.map(([key, label, placeholder]) => (
              <Field key={key} label={label}>
                <TextInput
                  placeholder={placeholder}
                  disabled={!access.canEditOrganization}
                  value={firm[key]}
                  onChange={(e) => setFirm({ ...firm, [key]: e.target.value })}
                />
              </Field>
            ))}
          </div>
          <p className="text-[11px] text-slate-500 font-mono">Organization ID: {organization.id} · created {formatDate(organization.createdAt)}</p>
          {notice('firm')}
          {access.canEditOrganization && (
            <div className="flex justify-end">
              <Button variant="primary" loading={busy === 'firm'} onClick={saveFirm}>Save firm details</Button>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
