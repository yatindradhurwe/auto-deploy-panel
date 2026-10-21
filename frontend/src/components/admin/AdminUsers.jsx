import React, { useEffect, useState } from 'react'
import { Users, UserPlus, KeyRound, LogOut, Ban, CheckCircle2, Trash2, Eye, Crown, Pencil, Building, UserX, ShieldCheck, Activity, X } from 'lucide-react'
import { adminApi, formatDate, timeAgo, startImpersonation } from './adminApi'
import {
  Card, Badge, StatusBadge, Button, SearchInput, Select, Modal, ConfirmDialog, Field, TextInput,
  Alert, SecretReveal, EmptyState, Loading, useAdminData, Avatar, Checkbox, StatCard, Toggle
} from './AdminUI'

function CreateUserModal({ open, onClose, onCreated, plans, apiBaseUrl }) {
  const empty = { fullName: '', email: '', password: '', platformRole: 'admin', createOrganization: true, organizationName: '', planId: 'FREE' }
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
              { value: 'admin', label: 'Admin — manages their own servers and projects in the panel' },
              { value: 'superadmin', label: 'Super admin — full access to this console and the server' }
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
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', jobTitle: '', isVerified: true })
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
          <div className="flex items-center gap-3">
            <Avatar name={user.fullName || user.email} size="lg" />
            <div className="min-w-0">
              <div className="text-base font-bold text-white truncate">{user.fullName || '—'}</div>
              <div className="text-xs text-slate-400 truncate">{user.email}</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={user.status} suspendedLabel="Blocked" />
            {!user.isVerified && <Badge tone="amber">Email not verified</Badge>}
            {user.platformRole === 'superadmin' ? <Badge tone="purple"><Crown className="w-3 h-3 mr-1" />Super admin</Badge> : <Badge>Admin</Badge>}
            {isPrimary && <Badge tone="amber">Primary admin</Badge>}
            {isSelf && <Badge tone="cyan">You</Badge>}
            {user.hasSshCredentials && <Badge tone="slate">SSH credentials saved</Badge>}
          </div>

          {user.status === 'suspended' && (
            <Alert>Blocked {formatDate(user.suspendedAt, true)}{user.suspendedReason ? ` — ${user.suspendedReason}` : ''}</Alert>
          )}
          {message && <Alert tone={message.tone}>{message.text}</Alert>}
          {secret && <SecretReveal label="New temporary password" value={secret} />}

          {editing ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Full name"><TextInput value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></Field>
              <Field label="Email"><TextInput type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
              <Field label="Phone"><TextInput value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91 98765 43210" /></Field>
              <Field label="Job title"><TextInput value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} placeholder="e.g. CTO" /></Field>
              <div className="sm:col-span-2 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                <Toggle checked={form.isVerified} onChange={(v) => setForm({ ...form, isVerified: v })} label="Email verified" description="Unverified accounts are asked to confirm their email address." />
              </div>
              <div className="sm:col-span-2 flex justify-end gap-2">
                <Button onClick={() => setEditing(false)}>Cancel</Button>
                <Button variant="primary" loading={busy === 'edit'} onClick={saveEdit}>Save</Button>
              </div>
            </div>
          ) : (
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-xs">
              {[
                ['Email', user.email],
                ['Phone', user.phone || '—'],
                ['Job title', user.jobTitle || '—'],
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
                <Button size="sm" onClick={() => { setForm({ fullName: user.fullName, email: user.email, phone: user.phone || '', jobTitle: user.jobTitle || '', isVerified: user.isVerified }); setEditing(true) }}>
                  <Pencil className="w-3.5 h-3.5" />Edit profile
                </Button>
              )}
              {user.platformRole !== 'superadmin' && user.status === 'active' && (
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
              {!protectedAccount && (user.platformRole === 'superadmin' ? (
                <Button size="sm" variant="warning" onClick={() => setConfirm({
                  title: 'Remove super admin access?', message: `${user.email} will lose access to this console and to server tools immediately and become a regular admin.`,
                  confirmLabel: 'Remove super admin', variant: 'warning',
                  onConfirm: () => run('role', () => adminApi(`/users/${user.id}`, { method: 'PATCH', body: { platformRole: 'admin' }, apiBaseUrl }), 'Super admin access removed.')
                })}>
                  <Crown className="w-3.5 h-3.5" />Remove super admin
                </Button>
              ) : (
                <Button size="sm" variant="warning" onClick={() => setConfirm({
                  title: 'Make super admin?',
                  message: `${user.email} will get full control of this platform, including the root terminal, files and databases on the server. Only grant this to people you fully trust.`,
                  confirmLabel: 'Make super admin', variant: 'warning', requireText: 'MAKE SUPER ADMIN',
                  onConfirm: () => run('role', () => adminApi(`/users/${user.id}`, { method: 'PATCH', body: { platformRole: 'superadmin' }, apiBaseUrl }), 'User is now a super admin.')
                })}>
                  <Crown className="w-3.5 h-3.5" />Make super admin
                </Button>
              ))}
              {!protectedAccount && (user.status === 'suspended' ? (
                <Button size="sm" variant="success" loading={busy === 'activate'} onClick={() => run('activate', () => post('/activate'), 'User unblocked.').catch(() => {})}>
                  <CheckCircle2 className="w-3.5 h-3.5" />Unblock
                </Button>
              ) : (
                <Button size="sm" variant="danger" onClick={() => setConfirm({
                  title: 'Block user?', message: `${user.email} will be signed out immediately and won't be able to log in until unblocked. Their data, servers and projects are kept.`,
                  confirmLabel: 'Block user', withReason: true,
                  onConfirm: (reason) => run('suspend', () => post('/suspend', { reason }), 'User blocked.')
                })}>
                  <Ban className="w-3.5 h-3.5" />Block
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
            {protectedAccount && <p className="text-[11px] text-slate-500">{isPrimary ? 'The primary admin account cannot be blocked, demoted or deleted.' : 'You cannot block, demote or delete your own account.'}</p>}
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

const BULK_ACTIONS = {
  suspend: { label: 'Block', verb: 'block', variant: 'danger', withReason: true, message: (n) => `${n} user(s) will be signed out immediately and can't log in until unblocked. Your own account and the primary admin are skipped.` },
  activate: { label: 'Unblock', verb: 'unblock', variant: 'success', message: (n) => `${n} user(s) will be able to sign in again.` },
  'revoke-sessions': { label: 'Sign out', verb: 'sign out', variant: 'warning', message: (n) => `${n} user(s) will be signed out on every device.` },
  delete: { label: 'Delete', verb: 'delete', variant: 'danger', requireText: 'DELETE', message: (n) => `${n} user(s) will be deleted permanently. Organizations they own pass to another member, or are deleted with their server and project records if they were the only member. Nothing on the servers themselves changes.` }
}

export default function AdminUsers({ apiBaseUrl, currentUser }) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [role, setRole] = useState('')
  const [debounced, setDebounced] = useState('')
  const [creating, setCreating] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const [checked, setChecked] = useState(() => new Set())
  const [confirm, setConfirm] = useState(null)
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250)
    return () => clearTimeout(t)
  }, [search])

  const { data, loading, error, reload } = useAdminData(
    () => adminApi(`/users?${new URLSearchParams({ search: debounced, status, role })}`, { apiBaseUrl }),
    [debounced, status, role]
  )
  const { data: allData, reload: reloadAll } = useAdminData(() => adminApi('/users', { apiBaseUrl }), [])
  const { data: planData } = useAdminData(() => adminApi('/plans', { apiBaseUrl }), [])
  const users = data?.users || []
  const everyone = allData?.users || []
  const isProtected = (u) => u.id === 'admin-001' || u.id === currentUser?.id

  // Drop selections that are no longer in the list
  useEffect(() => {
    setChecked((prev) => new Set([...prev].filter((id) => users.some((u) => u.id === id))))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const refresh = () => { reload(); reloadAll() }
  const toggle = (id, on) => setChecked((prev) => { const next = new Set(prev); on ? next.add(id) : next.delete(id); return next })
  const allChecked = users.length > 0 && users.every((u) => checked.has(u.id))

  const bulk = (action) => {
    const cfg = BULK_ACTIONS[action]
    const ids = [...checked]
    setConfirm({
      title: `${cfg.label} ${ids.length} user${ids.length === 1 ? '' : 's'}?`,
      message: cfg.message(ids.length),
      confirmLabel: `${cfg.label} ${ids.length}`,
      variant: cfg.variant,
      withReason: cfg.withReason,
      requireText: cfg.requireText,
      onConfirm: async (reason) => {
        const res = await adminApi('/users/bulk', { method: 'POST', body: { ids, action, reason }, apiBaseUrl })
        const skippedText = res.skipped?.length ? ` Skipped: ${res.skipped.map((x) => `${x.email || x.id} (${x.reason})`).join('; ')}` : ''
        setNotice({ tone: res.done.length ? 'success' : 'error', text: `${res.message}${skippedText}` })
        setChecked(new Set())
        refresh()
      }
    })
  }

  const quick = (u, action) => (e) => {
    e.stopPropagation()
    if (action === 'activate') {
      adminApi(`/users/${u.id}/activate`, { method: 'POST', body: {}, apiBaseUrl })
        .then(() => { setNotice({ tone: 'success', text: `${u.email} unblocked.` }); refresh() })
        .catch((err) => setNotice({ tone: 'error', text: err.message }))
      return
    }
    setConfirm(action === 'suspend' ? {
      title: 'Block user?', message: `${u.email} will be signed out immediately and won't be able to log in until unblocked.`,
      confirmLabel: 'Block user', withReason: true,
      onConfirm: async (reason) => { await adminApi(`/users/${u.id}/suspend`, { method: 'POST', body: { reason }, apiBaseUrl }); setNotice({ tone: 'success', text: `${u.email} blocked.` }); refresh() }
    } : {
      title: 'Delete user permanently?', message: `This deletes ${u.email}. Organizations they own are transferred to another member, or deleted if they were the only member. This cannot be undone.`,
      confirmLabel: 'Delete user', requireText: u.email,
      onConfirm: async () => { await adminApi(`/users/${u.id}`, { method: 'DELETE', apiBaseUrl }); setNotice({ tone: 'success', text: `${u.email} deleted.` }); refresh() }
    })
  }

  const weekAgo = Date.now() - 7 * 86400000

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="All users" value={everyone.length} icon={Users} onClick={() => { setStatus(''); setRole('') }} />
        <StatCard label="Active this week" value={everyone.filter((u) => u.lastLoginAt && new Date(u.lastLoginAt).getTime() > weekAgo).length} icon={Activity} tone="text-emerald-400" />
        <StatCard label="Blocked" value={everyone.filter((u) => u.status === 'suspended').length} icon={UserX} tone="text-rose-400" onClick={() => setStatus('suspended')} />
        <StatCard label="Super admins" value={everyone.filter((u) => u.platformRole === 'superadmin').length} icon={ShieldCheck} tone="text-purple-400" onClick={() => setRole('superadmin')} />
      </div>

      <Card
        title={`Users (${users.length})`}
        subtitle="Click a user to edit, block, reset their password or log in as them"
        icon={Users}
        actions={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder="Search name, email or ID" />
            <Select value={status} onChange={setStatus} options={[{ value: '', label: 'All statuses' }, { value: 'active', label: 'Active' }, { value: 'suspended', label: 'Blocked' }]} />
            <Select value={role} onChange={setRole} options={[{ value: '', label: 'All roles' }, { value: 'admin', label: 'Admins' }, { value: 'superadmin', label: 'Super admins' }]} />
            <Button variant="primary" onClick={() => setCreating(true)}><UserPlus className="w-3.5 h-3.5" />Create user</Button>
          </>
        }
      >
        {error && <Alert>{error}</Alert>}
        {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

        {checked.size > 0 && (
          <div className="sticky top-16 z-10 flex flex-wrap items-center gap-2 rounded-2xl border border-purple-500/30 bg-purple-500/10 backdrop-blur-xl px-3 py-2">
            <span className="text-xs font-bold text-purple-200 mr-1">{checked.size} selected</span>
            <Button size="sm" variant="danger" onClick={() => bulk('suspend')}><Ban className="w-3.5 h-3.5" />Block</Button>
            <Button size="sm" variant="success" onClick={() => bulk('activate')}><CheckCircle2 className="w-3.5 h-3.5" />Unblock</Button>
            <Button size="sm" variant="warning" onClick={() => bulk('revoke-sessions')}><LogOut className="w-3.5 h-3.5" />Sign out</Button>
            <Button size="sm" variant="danger" onClick={() => bulk('delete')}><Trash2 className="w-3.5 h-3.5" />Delete</Button>
            <button onClick={() => setChecked(new Set())} className="ml-auto p-1 text-slate-400 hover:text-white cursor-pointer" aria-label="Clear selection"><X className="w-4 h-4" /></button>
          </div>
        )}

        {loading && !data ? <Loading /> : users.length === 0 ? <EmptyState icon={Users}>No users match these filters.</EmptyState> : (
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full min-w-[820px] text-left text-xs text-slate-300">
              <thead className="text-slate-500 uppercase text-[10px] tracking-wider border-b border-slate-800">
                <tr>
                  <th className="px-3 py-2.5 w-8">
                    <Checkbox label="Select all" checked={allChecked} indeterminate={checked.size > 0 && !allChecked} onChange={(on) => setChecked(on ? new Set(users.map((u) => u.id)) : new Set())} />
                  </th>
                  <th className="px-3 py-2.5">User</th>
                  <th className="px-3 py-2.5">Role</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">Orgs</th>
                  <th className="px-3 py-2.5">Last login</th>
                  <th className="px-3 py-2.5">Joined</th>
                  <th className="px-3 py-2.5 text-right">Quick actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {users.map((u) => (
                  <tr key={u.id} onClick={() => setSelectedId(u.id)} className={`hover:bg-slate-950/60 cursor-pointer transition ${checked.has(u.id) ? 'bg-purple-500/5' : ''}`}>
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <Checkbox label={`Select ${u.email}`} checked={checked.has(u.id)} onChange={(on) => toggle(u.id, on)} />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Avatar name={u.fullName || u.email} size="sm" />
                        <div className="min-w-0">
                          <div className="font-bold text-white truncate">{u.fullName || '—'}{u.id === currentUser?.id && <span className="text-cyan-400 font-normal"> (you)</span>}</div>
                          <div className="text-slate-500 truncate">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">{u.platformRole === 'superadmin' ? <Badge tone="purple"><Crown className="w-3 h-3 mr-1" />Super admin</Badge> : <Badge>Admin</Badge>}</td>
                    <td className="px-3 py-2.5"><StatusBadge status={u.status} suspendedLabel="Blocked" /></td>
                    <td className="px-3 py-2.5 tabular-nums">{u.organizationCount}</td>
                    <td className="px-3 py-2.5 text-slate-400">{timeAgo(u.lastLoginAt)}</td>
                    <td className="px-3 py-2.5 text-slate-400">{formatDate(u.createdAt)}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex justify-end gap-1">
                        <button onClick={(e) => { e.stopPropagation(); setSelectedId(u.id) }} title="Edit" className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"><Pencil className="w-3.5 h-3.5" /></button>
                        {!isProtected(u) && (u.status === 'suspended' ? (
                          <button onClick={quick(u, 'activate')} title="Unblock" className="p-1.5 rounded-lg text-emerald-400 hover:bg-emerald-500/10 cursor-pointer"><CheckCircle2 className="w-3.5 h-3.5" /></button>
                        ) : (
                          <button onClick={quick(u, 'suspend')} title="Block" className="p-1.5 rounded-lg text-amber-400 hover:bg-amber-500/10 cursor-pointer"><Ban className="w-3.5 h-3.5" /></button>
                        ))}
                        {!isProtected(u) && (
                          <button onClick={quick(u, 'delete')} title="Delete" className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-500/10 cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <CreateUserModal open={creating} onClose={() => setCreating(false)} onCreated={refresh} plans={planData?.plans || []} apiBaseUrl={apiBaseUrl} />
        <UserDetailModal userId={selectedId} onClose={() => setSelectedId(null)} onChanged={refresh} currentUser={currentUser} apiBaseUrl={apiBaseUrl} />
        <ConfirmDialog open={!!confirm} {...(confirm || {})} onClose={() => setConfirm(null)} />
      </Card>
    </div>
  )
}
