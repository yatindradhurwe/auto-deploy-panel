import React, { useEffect, useState } from 'react'
import { Users, UserPlus, KeyRound, LogOut, Ban, CheckCircle2, Trash2, Eye, Crown, Pencil, Building } from 'lucide-react'
import { adminApi, formatDate, timeAgo, startImpersonation } from './adminApi'
import {
  Card, Badge, StatusBadge, Button, SearchInput, Select, Modal, ConfirmDialog, Field, TextInput,
  Alert, SecretReveal, EmptyState, Loading, useAdminData
} from './AdminUI'

function CreateUserModal({ open, onClose, onCreated, plans, apiBaseUrl }) {
  const empty = { fullName: '', email: '', password: '', platformRole: 'user', createOrganization: true, organizationName: '', planId: 'FREE' }
  const [form, setForm] = useState(empty)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  useEffect(() => {
    if (open) {
      setForm(empty)
      setError('')
      setResult(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const set = (key) => (e) => setForm({ ...form, [key]: e && e.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e })

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await adminApi('/users', { method: 'POST', body: form, apiBaseUrl })
      setResult(res)
      onCreated()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title={result ? 'User created' : 'Create user'}
      onClose={onClose}
      footer={result ? <Button variant="primary" onClick={onClose}>Done</Button> : (
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={submit}>Create user</Button>
        </>
      )}
    >
      {result ? (
        <div className="space-y-4">
          <Alert tone="success">{result.user.email} can now sign in{result.organization ? ` and owns "${result.organization.name}"` : ''}.</Alert>
          {result.tempPassword && <SecretReveal label="Temporary password" value={result.tempPassword} />}
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Full name"><TextInput value={form.fullName} onChange={set('fullName')} placeholder="Jane Doe" /></Field>
            <Field label="Email"><TextInput type="email" required value={form.email} onChange={set('email')} placeholder="jane@company.com" /></Field>
          </div>
          <Field label="Password" hint="Leave empty to generate a secure temporary password.">
            <TextInput type="password" value={form.password} onChange={set('password')} placeholder="At least 8 characters" autoComplete="new-password" />
          </Field>
          <Field label="Platform role">
            <Select value={form.platformRole} onChange={set('platformRole')} className="w-full" options={[
              { value: 'user', label: 'Customer — uses the panel for their own organization' },
              { value: 'admin', label: 'Platform admin — full access to this console and the server' }
            ]} />
          </Field>
          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
            <input type="checkbox" checked={form.createOrganization} onChange={set('createOrganization')} className="accent-purple-500" />
            Create an organization for this user
          </label>
          {form.createOrganization && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Organization name"><TextInput value={form.organizationName} onChange={set('organizationName')} placeholder="Defaults to “<name>'s Workspace”" /></Field>
              <Field label="Plan">
                <Select value={form.planId} onChange={set('planId')} className="w-full" options={plans.map((p) => ({ value: p.id, label: `${p.name} ($${p.priceMonthly}/mo)` }))} />
              </Field>
            </div>
          )}
          {error && <Alert>{error}</Alert>}
        </form>
      )}
    </Modal>
  )
}

function UserDetailModal({ userId, onClose, onChanged, currentUser, apiBaseUrl }) {
  const { data, loading, error, reload } = useAdminData(
    () => (userId ? adminApi(`/users/${userId}`, { apiBaseUrl }) : Promise.resolve(null)),
    [userId]
  )
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ fullName: '', email: '' })
  const [confirm, setConfirm] = useState(null)
  const [message, setMessage] = useState(null)
  const [secret, setSecret] = useState(null)
  const [busy, setBusy] = useState('')

  useEffect(() => {
    setEditing(false)
    setMessage(null)
    setSecret(null)
  }, [userId])

  const user = data?.user
  const isPrimary = user?.id === 'admin-001'
  const isSelf = user?.id === currentUser?.id
  const protectedAccount = isPrimary || isSelf

  const run = async (key, fn, successText) => {
    setBusy(key)
    setMessage(null)
    try {
      const res = await fn()
      setMessage({ tone: 'success', text: successText || res.message || 'Done.' })
      await reload()
      onChanged()
      return res
    } catch (e) {
      setMessage({ tone: 'error', text: e.message })
      throw e
    } finally {
      setBusy('')
    }
  }

  const post = (path, body) => adminApi(`/users/${user.id}${path}`, { method: 'POST', body: body || {}, apiBaseUrl })

  const saveEdit = () => run('edit', () => adminApi(`/users/${user.id}`, { method: 'PATCH', body: form, apiBaseUrl }), 'Profile updated.')
    .then(() => setEditing(false)).catch(() => {})

  const impersonate = async () => {
    setBusy('impersonate')
    try {
      const res = await post('/impersonate')
      startImpersonation(res.token, res.user)
    } catch (e) {
      setMessage({ tone: 'error', text: e.message })
      setBusy('')
    }
  }

  return (
    <Modal open={!!userId} title={user ? (user.fullName || user.email) : 'User'} onClose={onClose} wide>
      {loading && !data ? <Loading /> : error ? <Alert>{error}</Alert> : user && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={user.status} />
            {user.platformRole === 'admin' ? <Badge tone="purple"><Crown className="w-3 h-3 mr-1" />Platform admin</Badge> : <Badge>Customer</Badge>}
            {isPrimary && <Badge tone="amber">Primary admin</Badge>}
            {isSelf && <Badge tone="cyan">You</Badge>}
            {user.hasSshCredentials && <Badge tone="slate">SSH credentials saved</Badge>}
          </div>

          {user.status === 'suspended' && (
            <Alert>Suspended {formatDate(user.suspendedAt, true)}{user.suspendedReason ? ` — ${user.suspendedReason}` : ''}</Alert>
          )}
          {message && <Alert tone={message.tone}>{message.text}</Alert>}
          {secret && <SecretReveal label="New temporary password" value={secret} />}

          {editing ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Full name"><TextInput value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></Field>
              <Field label="Email"><TextInput type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
              <div className="sm:col-span-2 flex justify-end gap-2">
                <Button onClick={() => setEditing(false)}>Cancel</Button>
                <Button variant="primary" loading={busy === 'edit'} onClick={saveEdit}>Save</Button>
              </div>
            </div>
          ) : (
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-xs">
              {[
                ['Email', user.email],
                ['User ID', <span className="font-mono">{user.id}</span>],
                ['Joined', formatDate(user.createdAt, true)],
                ['Last login', user.lastLoginAt ? `${timeAgo(user.lastLoginAt)}${user.lastLoginIp ? ` · ${user.lastLoginIp}` : ''}` : 'Never'],
              ].map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className="text-slate-200 font-semibold break-all">{v}</dd>
                </div>
              ))}
            </dl>
          )}

          <div className="space-y-2">
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Actions</h4>
            <div className="flex flex-wrap gap-2">
              {!editing && (
                <Button size="sm" onClick={() => { setForm({ fullName: user.fullName, email: user.email }); setEditing(true) }}>
                  <Pencil className="w-3.5 h-3.5" />Edit profile
                </Button>
              )}
              {user.platformRole !== 'admin' && user.status === 'active' && (
                <Button size="sm" loading={busy === 'impersonate'} onClick={impersonate}>
                  <Eye className="w-3.5 h-3.5" />Log in as user
                </Button>
              )}
              <Button size="sm" onClick={() => setConfirm({
                title: 'Reset password?',
                message: `A new temporary password will be generated for ${user.email} and all of their sessions will be signed out.`,
                confirmLabel: 'Reset password', variant: 'warning',
                onConfirm: async () => { const res = await post('/reset-password'); setSecret(res.tempPassword); setMessage({ tone: 'success', text: res.message }) }
              })}>
                <KeyRound className="w-3.5 h-3.5" />Reset password
              </Button>
              <Button size="sm" loading={busy === 'revoke'} onClick={() => run('revoke', () => post('/revoke-sessions')).catch(() => {})}>
                <LogOut className="w-3.5 h-3.5" />Sign out everywhere
              </Button>
              {!protectedAccount && (user.platformRole === 'admin' ? (
                <Button size="sm" variant="warning" onClick={() => setConfirm({
                  title: 'Remove admin access?', message: `${user.email} will lose access to this console and to server tools immediately.`,
                  confirmLabel: 'Remove admin', variant: 'warning',
                  onConfirm: () => run('role', () => adminApi(`/users/${user.id}`, { method: 'PATCH', body: { platformRole: 'user' }, apiBaseUrl }), 'Admin access removed.')
                })}>
                  <Crown className="w-3.5 h-3.5" />Remove admin
                </Button>
              ) : (
                <Button size="sm" variant="warning" onClick={() => setConfirm({
                  title: 'Make platform admin?',
                  message: `${user.email} will get full control of this platform, including the root terminal, files and databases on the server. Only grant this to people you fully trust.`,
                  confirmLabel: 'Make admin', variant: 'warning', requireText: 'MAKE ADMIN',
                  onConfirm: () => run('role', () => adminApi(`/users/${user.id}`, { method: 'PATCH', body: { platformRole: 'admin' }, apiBaseUrl }), 'User is now a platform admin.')
                })}>
                  <Crown className="w-3.5 h-3.5" />Make admin
                </Button>
              ))}
              {!protectedAccount && (user.status === 'suspended' ? (
                <Button size="sm" variant="success" loading={busy === 'activate'} onClick={() => run('activate', () => post('/activate'), 'Account reactivated.').catch(() => {})}>
                  <CheckCircle2 className="w-3.5 h-3.5" />Reactivate
                </Button>
              ) : (
                <Button size="sm" variant="danger" onClick={() => setConfirm({
                  title: 'Suspend account?', message: `${user.email} will be signed out immediately and won't be able to log in until reactivated. Their data is kept.`,
                  confirmLabel: 'Suspend', withReason: true,
                  onConfirm: (reason) => run('suspend', () => post('/suspend', { reason }), 'Account suspended.')
                })}>
                  <Ban className="w-3.5 h-3.5" />Suspend
                </Button>
              ))}
              {!protectedAccount && (
                <Button size="sm" variant="danger" onClick={() => setConfirm({
                  title: 'Delete user permanently?',
                  message: `This deletes ${user.email}. Organizations they own are transferred to another member, or deleted (with their server and project records) if they were the only member. Nothing on the actual servers is changed. This cannot be undone.`,
                  confirmLabel: 'Delete user', requireText: user.email,
                  onConfirm: async () => { await adminApi(`/users/${user.id}`, { method: 'DELETE', apiBaseUrl }); onChanged(); onClose() }
                })}>
                  <Trash2 className="w-3.5 h-3.5" />Delete
                </Button>
              )}
            </div>
            {protectedAccount && <p className="text-[11px] text-slate-500">{isPrimary ? 'The primary admin account cannot be suspended, demoted or deleted.' : 'You cannot suspend, demote or delete your own account.'}</p>}
          </div>

          <div className="space-y-2">
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 flex items-center gap-1.5"><Building className="w-3.5 h-3.5" />Organizations</h4>
            {data.memberships.length === 0 ? <EmptyState>Not a member of any organization.</EmptyState> : (
              <div className="divide-y divide-slate-800/70 text-xs">
                {data.memberships.map((m) => (
                  <div key={m.organizationId} className="py-2 flex items-center justify-between gap-3">
                    <span className="text-slate-200 font-semibold truncate">{m.organizationName}</span>
                    <span className="flex gap-1.5 shrink-0">
                      <Badge tone={m.role === 'OWNER' ? 'amber' : 'slate'}>{m.role}</Badge>
                      {m.planId && <Badge tone="purple">{m.planId}</Badge>}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Recent activity</h4>
            {data.activity.length === 0 ? <EmptyState>No activity recorded.</EmptyState> : (
              <div className="divide-y divide-slate-800/70 text-xs max-h-56 overflow-y-auto">
                {data.activity.map((l) => (
                  <div key={l.id} className="py-2 flex items-center justify-between gap-3">
                    <span className="font-mono text-slate-300 truncate">{l.action}</span>
                    <span className="text-slate-500 shrink-0">{timeAgo(l.timestamp)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      <ConfirmDialog open={!!confirm} {...(confirm || {})} onClose={() => setConfirm(null)} />
    </Modal>
  )
}

export default function AdminUsers({ apiBaseUrl, currentUser }) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [role, setRole] = useState('')
  const [debounced, setDebounced] = useState('')
  const [creating, setCreating] = useState(false)
  const [selectedId, setSelectedId] = useState(null)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250)
    return () => clearTimeout(t)
  }, [search])

  const { data, loading, error, reload } = useAdminData(
    () => adminApi(`/users?${new URLSearchParams({ search: debounced, status, role })}`, { apiBaseUrl }),
    [debounced, status, role]
  )
  const { data: planData } = useAdminData(() => adminApi('/plans', { apiBaseUrl }), [])
  const users = data?.users || []

  return (
    <Card
      title={`Users (${users.length})`}
      icon={Users}
      actions={
        <>
          <SearchInput value={search} onChange={setSearch} placeholder="Search name, email or ID" />
          <Select value={status} onChange={setStatus} options={[{ value: '', label: 'All statuses' }, { value: 'active', label: 'Active' }, { value: 'suspended', label: 'Suspended' }]} />
          <Select value={role} onChange={setRole} options={[{ value: '', label: 'All roles' }, { value: 'user', label: 'Customers' }, { value: 'admin', label: 'Admins' }]} />
          <Button variant="primary" onClick={() => setCreating(true)}><UserPlus className="w-3.5 h-3.5" />Create user</Button>
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      {loading && !data ? <Loading /> : users.length === 0 ? <EmptyState>No users match these filters.</EmptyState> : (
        <div className="overflow-x-auto -mx-4 sm:mx-0">
          <table className="w-full min-w-[720px] text-left text-xs text-slate-300">
            <thead className="text-slate-500 uppercase text-[10px] tracking-wider border-b border-slate-800">
              <tr>
                <th className="px-3 py-2.5">User</th>
                <th className="px-3 py-2.5">Role</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">Orgs</th>
                <th className="px-3 py-2.5">Last login</th>
                <th className="px-3 py-2.5">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {users.map((u) => (
                <tr key={u.id} onClick={() => setSelectedId(u.id)} className="hover:bg-slate-950/60 cursor-pointer transition">
                  <td className="px-3 py-2.5">
                    <div className="font-bold text-white">{u.fullName || '—'}{u.id === currentUser?.id && <span className="text-cyan-400 font-normal"> (you)</span>}</div>
                    <div className="text-slate-500">{u.email}</div>
                  </td>
                  <td className="px-3 py-2.5">{u.platformRole === 'admin' ? <Badge tone="purple">Admin</Badge> : <Badge>Customer</Badge>}</td>
                  <td className="px-3 py-2.5"><StatusBadge status={u.status} /></td>
                  <td className="px-3 py-2.5 tabular-nums">{u.organizationCount}</td>
                  <td className="px-3 py-2.5 text-slate-400">{timeAgo(u.lastLoginAt)}</td>
                  <td className="px-3 py-2.5 text-slate-400">{formatDate(u.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateUserModal open={creating} onClose={() => setCreating(false)} onCreated={reload} plans={planData?.plans || []} apiBaseUrl={apiBaseUrl} />
      <UserDetailModal userId={selectedId} onClose={() => setSelectedId(null)} onChanged={reload} currentUser={currentUser} apiBaseUrl={apiBaseUrl} />
    </Card>
  )
}
