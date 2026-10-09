import React, { useEffect, useState } from 'react'
import { Users, Trash2, ShieldAlert } from 'lucide-react'
import { Modal, Button, Select, Badge, Alert, Loading, EmptyState } from './admin/AdminUI'
import { useProjects } from '../store/ProjectsContext'

const ROLE_OPTIONS = [
  { value: 'manager', label: 'Manager — deploy, restart, logs, env, files, git' },
  { value: 'viewer', label: 'Viewer — status, logs, git history' }
]

/**
 * Share a project with organization team members (owners and admins only).
 * Owners/admins of the organization already have full access and aren't listed as options.
 */
export default function ShareProjectModal({ project, onClose }) {
  const { getShares, shareProject, updateShare, revokeShare } = useProjects()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')
  const [form, setForm] = useState({ userId: '', role: 'manager' })

  const load = () => getShares(project).then(setData).catch((err) => setError(err.message))

  useEffect(() => {
    if (project) {
      setData(null)
      setError('')
      setNotice('')
      load()
    }
  }, [project?.path])

  const run = async (key, fn, message) => {
    setBusy(key)
    setError('')
    setNotice('')
    try {
      await fn()
      await load()
      if (message) setNotice(message)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy('')
    }
  }

  const candidates = (data?.members || []).filter((m) => !m.fullAccess && !m.shared)

  return (
    <Modal open={!!project} title={`Share "${project?.name || ''}"`} onClose={onClose} wide>
      {!data && !error ? <Loading /> : (
        <div className="space-y-5 text-xs">
          <p className="text-slate-400">
            Give a team member access to this project only. Organization owners and admins already have full access to every project.
          </p>

          {error && <Alert>{error}</Alert>}
          {notice && <Alert tone="success">{notice}</Alert>}

          <div className="space-y-2">
            <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">People with access</h4>
            {(data?.shares || []).length === 0 ? (
              <EmptyState>Not shared with anyone yet.</EmptyState>
            ) : (
              <ul className="divide-y divide-slate-800 border border-slate-800 rounded-2xl">
                {data.shares.map((s) => (
                  <li key={s.id} className="p-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-200 truncate">{s.fullName}</div>
                      <div className="text-slate-500 truncate">{s.email}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Select
                        value={s.role}
                        onChange={(role) => run(`role-${s.id}`, () => updateShare(s.id, role), 'Access updated.')}
                        options={[{ value: 'manager', label: 'Manager' }, { value: 'viewer', label: 'Viewer' }]}
                      />
                      <Button size="sm" variant="danger" loading={busy === `revoke-${s.id}`} onClick={() => run(`revoke-${s.id}`, () => revokeShare(s.id), `${s.email} no longer has access.`)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-2">
            <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Add a team member</h4>
            {candidates.length === 0 ? (
              <EmptyState>Everyone on your team already has access. Invite more people from Team Members first.</EmptyState>
            ) : (
              <div className="flex flex-col sm:flex-row gap-2">
                <Select
                  className="flex-1"
                  value={form.userId}
                  onChange={(userId) => setForm({ ...form, userId })}
                  options={[{ value: '', label: 'Choose a team member…' }, ...candidates.map((m) => ({ value: m.userId, label: `${m.fullName} (${m.email}) · ${m.role}` }))]}
                />
                <Select value={form.role} onChange={(role) => setForm({ ...form, role })} options={ROLE_OPTIONS} />
                <Button
                  variant="primary"
                  disabled={!form.userId}
                  loading={busy === 'add'}
                  onClick={() => run('add', () => shareProject(project, form.userId, form.role), 'Project shared.').then(() => setForm({ userId: '', role: 'manager' }))}
                >
                  <Users className="w-3.5 h-3.5" /> Share
                </Button>
              </div>
            )}
          </div>

          <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-amber-200">
            <ShieldAlert className="w-4 h-4 shrink-0 mt-px" />
            <span>
              Managers can deploy and change this project's code, which runs on your server. Only share Manager access with people you trust with that server.
              Terminal, nginx, SSL, cron, databases and server settings stay with owners and admins.
            </span>
          </div>
        </div>
      )}
    </Modal>
  )
}
