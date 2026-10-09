import React, { useState } from 'react'
import { ShoppingBag, Plus, Pencil, Trash2, GitBranch, Archive, Upload, Eye, EyeOff, Star } from 'lucide-react'
import { adminApi, formatDate } from './adminApi'
import {
  Card, Badge, Button, Select, Modal, ConfirmDialog, Field, TextInput, Toggle, Alert, EmptyState, Loading, useAdminData
} from './AdminUI'
import { chunkedUpload } from '../../utils/chunkedUpload'

const CATEGORIES = [
  ['saas', 'SaaS & panels'], ['web', 'Websites'], ['landing', 'Landing pages'], ['ecommerce', 'E-commerce'],
  ['blog', 'Blogs & CMS'], ['api', 'APIs & backends'], ['other', 'Other']
]
const TYPES = [
  ['auto', 'Auto-detect'], ['static', 'Static website'], ['spa', 'Single-page app'], ['node-ssr', 'Node SSR (Next.js, Nuxt)'],
  ['node-server', 'Node.js server'], ['fullstack', 'Frontend + Node API'], ['php', 'PHP / Laravel / WordPress'],
  ['python', 'Python'], ['go', 'Go'], ['java', 'Java'], ['ruby', 'Ruby']
]
const DATABASES = [['none', 'No database'], ['postgresql', 'PostgreSQL'], ['mysql', 'MySQL / MariaDB'], ['mongodb', 'MongoDB'], ['sqlite', 'SQLite']]
const ACCENTS = ['cyan', 'purple', 'emerald', 'amber', 'rose', 'indigo']

const EMPTY = {
  name: '', description: '', category: 'saas', technologies: '', previewUrl: '', thumbnailUrl: '', accent: 'cyan',
  featured: false, status: 'draft', sourceType: 'git', gitUrl: '', branch: 'main',
  defaults: { type: 'auto', buildCommand: '', startCommand: '', outputDir: '', appDir: '', port: '', envVars: '', database: 'none' }
}

const textarea = 'w-full bg-slate-950 border border-slate-800 focus:border-purple-500/60 outline-none rounded-xl px-3 py-2 text-xs text-slate-200 font-mono'

function TemplateForm({ initial, onClose, onSaved, apiBaseUrl }) {
  const editing = !!initial?.id
  const [form, setForm] = useState(() => initial ? {
    ...EMPTY,
    ...initial,
    technologies: (initial.technologies || []).join(', '),
    sourceType: initial.source?.type === 'archive' ? 'archive' : 'git',
    gitUrl: initial.source?.gitUrl || '',
    branch: initial.source?.branch || 'main',
    defaults: { ...EMPTY.defaults, ...(initial.defaults || {}), port: initial.defaults?.port || '' }
  } : EMPTY)
  const [upload, setUpload] = useState(null) // { name, progress, status, uploadId, analysis }
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const setD = (k, v) => setForm((f) => ({ ...f, defaults: { ...f.defaults, [k]: v } }))

  const onFile = async (file) => {
    if (!file) return
    setError('')
    setUpload({ name: file.name, progress: 0, status: 'uploading' })
    try {
      const done = await chunkedUpload(file, 'source', { onProgress: (p) => setUpload((u) => ({ ...u, progress: p })) })
      setUpload({ name: file.name, progress: 1, status: 'ready', uploadId: done.uploadId, analysis: done.analysis })
    } catch (err) {
      setUpload((u) => ({ ...u, status: 'error' }))
      setError(err.message)
    }
  }

  const submit = async () => {
    setSaving(true)
    setError('')
    try {
      const body = {
        name: form.name, description: form.description, category: form.category, technologies: form.technologies,
        previewUrl: form.previewUrl, thumbnailUrl: form.thumbnailUrl, accent: form.accent, featured: form.featured, status: form.status,
        defaults: { ...form.defaults, port: form.defaults.port ? Number(form.defaults.port) : null }
      }
      const sourceChanged = form.sourceType === 'archive'
        ? !!upload?.uploadId
        : !editing || initial.source?.type !== 'git' || form.gitUrl !== initial.source?.gitUrl || form.branch !== initial.source?.branch
      if (form.sourceType === 'archive' && upload?.uploadId) body.uploadId = upload.uploadId
      if (form.sourceType === 'git' && sourceChanged) Object.assign(body, { gitUrl: form.gitUrl, branch: form.branch })
      if (!editing && form.sourceType === 'archive' && !upload?.uploadId) throw new Error('Upload the template archive first.')
      const data = editing
        ? await adminApi(`/templates/${initial.id}`, { method: 'PATCH', body, apiBaseUrl })
        : await adminApi('/templates', { method: 'POST', body, apiBaseUrl })
      onSaved(data.template)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      wide
      title={editing ? `Edit ${initial.name}` : 'New marketplace template'}
      onClose={onClose}
      footer={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={saving} disabled={upload?.status === 'uploading'} onClick={submit}>{editing ? 'Save template' : 'Create template'}</Button>
      </>}
    >
      {error && <Alert>{error}</Alert>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Name"><TextInput value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Restaurant website" /></Field>
        <Field label="Category"><Select value={form.category} onChange={(v) => set('category', v)} options={CATEGORIES.map(([value, label]) => ({ value, label }))} className="w-full" /></Field>
      </div>
      <Field label="Description"><textarea rows={3} className={textarea} value={form.description} onChange={(e) => set('description', e.target.value)} /></Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Technologies" hint="Comma separated"><TextInput value={form.technologies} onChange={(e) => set('technologies', e.target.value)} placeholder="React, Node.js, PostgreSQL" /></Field>
        <Field label="Card color"><Select value={form.accent} onChange={(v) => set('accent', v)} options={ACCENTS.map((a) => ({ value: a, label: a }))} className="w-full" /></Field>
        <Field label="Live preview URL"><TextInput value={form.previewUrl} onChange={(e) => set('previewUrl', e.target.value)} placeholder="https://demo.example.com" /></Field>
        <Field label="Thumbnail image URL"><TextInput value={form.thumbnailUrl} onChange={(e) => set('thumbnailUrl', e.target.value)} placeholder="https://…/screenshot.png" /></Field>
      </div>

      <div className="space-y-3 border-t border-slate-800 pt-4">
        <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Source</div>
        <div className="flex gap-2">
          {[['git', 'Git repository', GitBranch], ['archive', 'Upload archive', Archive]].map(([id, label, Icon]) => (
            <Button key={id} size="sm" variant={form.sourceType === id ? 'primary' : 'secondary'} onClick={() => set('sourceType', id)}><Icon className="w-3.5 h-3.5" />{label}</Button>
          ))}
        </div>
        {form.sourceType === 'git' ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2"><Field label="Repository URL" hint="Public repositories work for every customer; private ones only with your own GitHub token."><TextInput value={form.gitUrl} onChange={(e) => set('gitUrl', e.target.value)} placeholder="https://github.com/org/template.git" /></Field></div>
            <Field label="Branch"><TextInput value={form.branch} onChange={(e) => set('branch', e.target.value)} /></Field>
          </div>
        ) : (
          <div className="space-y-2">
            {editing && initial.source?.type === 'archive' && !upload && (
              <p className="text-xs text-slate-400">Current archive: <span className="text-slate-200">{initial.source.fileName}</span>. Upload a new one to replace it.</p>
            )}
            <label className="flex items-center justify-center gap-2 p-5 border border-dashed border-slate-700 hover:border-purple-500/60 rounded-2xl text-xs text-slate-300 cursor-pointer">
              <Upload className="w-4 h-4" />
              {upload ? `${upload.name} — ${upload.status === 'ready' ? 'uploaded and analyzed' : upload.status === 'error' ? 'failed' : `${Math.round(upload.progress * 100)}%`}` : 'Choose .zip, .tar.gz, .tgz or .tar'}
              <input type="file" accept=".zip,.tar.gz,.tgz,.tar" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
            {upload?.analysis && <p className="text-xs text-emerald-300">Detected: {upload.analysis.framework} ({upload.analysis.label})</p>}
          </div>
        )}
      </div>

      <div className="space-y-3 border-t border-slate-800 pt-4">
        <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Deploy defaults (customers can change them in the wizard)</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="App type"><Select value={form.defaults.type} onChange={(v) => setD('type', v)} options={TYPES.map(([value, label]) => ({ value, label }))} className="w-full" /></Field>
          <Field label="Database"><Select value={form.defaults.database} onChange={(v) => setD('database', v)} options={DATABASES.map(([value, label]) => ({ value, label }))} className="w-full" /></Field>
          <Field label="Port"><TextInput value={form.defaults.port} onChange={(e) => setD('port', e.target.value.replace(/\D/g, ''))} placeholder="auto" /></Field>
          <Field label="Build command"><TextInput value={form.defaults.buildCommand} onChange={(e) => setD('buildCommand', e.target.value)} placeholder="npm run build" /></Field>
          <Field label="Start command"><TextInput value={form.defaults.startCommand} onChange={(e) => setD('startCommand', e.target.value)} placeholder="npm start" /></Field>
          <Field label="Output folder"><TextInput value={form.defaults.outputDir} onChange={(e) => setD('outputDir', e.target.value)} placeholder="dist" /></Field>
        </div>
        <Field label="App folder (if not the root)"><TextInput value={form.defaults.appDir} onChange={(e) => setD('appDir', e.target.value)} placeholder="(project root)" /></Field>
        <Field label="Default environment variables" hint="KEY=value per line. Don't put real secrets here — customers see these."><textarea rows={4} className={textarea} value={form.defaults.envVars} onChange={(e) => setD('envVars', e.target.value)} placeholder={'NODE_ENV=production\nAPP_NAME=My Site'} /></Field>
      </div>

      <div className="space-y-3 border-t border-slate-800 pt-4">
        <Toggle checked={form.status === 'published'} onChange={(v) => set('status', v ? 'published' : 'draft')} label="Published" description="Published templates appear in every customer's marketplace. Drafts are visible only here." />
        <Toggle checked={!!form.featured} onChange={(v) => set('featured', v)} label="Featured" description="Shown first with a Featured badge." />
      </div>
    </Modal>
  )
}

export default function AdminTemplates({ apiBaseUrl = '' }) {
  const { data, loading, error, reload } = useAdminData(() => adminApi('/templates', { apiBaseUrl }), [])
  const [editing, setEditing] = useState(null) // null | {} (new) | template
  const [confirm, setConfirm] = useState(null)
  const [message, setMessage] = useState(null)

  const templates = data?.templates || []

  const togglePublish = async (t) => {
    try {
      await adminApi(`/templates/${t.id}`, { method: 'PATCH', body: { status: t.status === 'published' ? 'draft' : 'published' }, apiBaseUrl })
      setMessage({ tone: 'success', text: t.status === 'published' ? `${t.name} is now a draft.` : `${t.name} is live in the marketplace.` })
      reload()
    } catch (err) {
      setMessage({ tone: 'error', text: err.message })
    }
  }

  return (
    <div className="space-y-6">
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      <Card
        title={`Templates (${templates.length})`}
        icon={ShoppingBag}
        actions={<Button variant="primary" onClick={() => setEditing({})}><Plus className="w-3.5 h-3.5" />New template</Button>}
      >
        {loading ? <Loading /> : error ? <Alert>{error}</Alert> : templates.length === 0 ? (
          <EmptyState>No templates yet. Add one from a Git repository or upload a project archive.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-slate-500 text-left">
                <tr><th className="py-2 pr-3">Template</th><th className="pr-3">Category</th><th className="pr-3">Source</th><th className="pr-3">Status</th><th className="pr-3">Deploys</th><th className="pr-3">Updated</th><th /></tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {templates.map((t) => (
                  <tr key={t.id} className="text-slate-300">
                    <td className="py-3 pr-3">
                      <div className="font-semibold text-white flex items-center gap-1.5">{t.featured && <Star className="w-3.5 h-3.5 text-amber-400" />}{t.name}</div>
                      <div className="text-slate-500 truncate max-w-xs">{t.analysis?.framework || t.defaults?.type}</div>
                    </td>
                    <td className="pr-3">{CATEGORIES.find((c) => c[0] === t.category)?.[1] || t.category}</td>
                    <td className="pr-3">{t.source?.type === 'git' ? <span className="flex items-center gap-1"><GitBranch className="w-3.5 h-3.5" />{t.source.branch}</span> : <span className="flex items-center gap-1"><Archive className="w-3.5 h-3.5" />{t.source?.fileName}</span>}</td>
                    <td className="pr-3">{t.status === 'published' ? <Badge tone="green">Published</Badge> : <Badge>Draft</Badge>}</td>
                    <td className="pr-3 tabular-nums">{t.deployCount || 0}</td>
                    <td className="pr-3">{formatDate(t.updatedAt)}</td>
                    <td className="py-3">
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" onClick={() => togglePublish(t)} title={t.status === 'published' ? 'Unpublish' : 'Publish'}>{t.status === 'published' ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}</Button>
                        <Button size="sm" onClick={() => setEditing(t)}><Pencil className="w-3.5 h-3.5" /></Button>
                        <Button size="sm" variant="danger" onClick={() => setConfirm(t)}><Trash2 className="w-3.5 h-3.5" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && (
        <TemplateForm
          initial={editing.id ? editing : null}
          apiBaseUrl={apiBaseUrl}
          onClose={() => setEditing(null)}
          onSaved={(t) => { setEditing(null); setMessage({ tone: 'success', text: `${t.name} saved${t.status === 'published' ? ' and published' : ' as a draft'}.` }); reload() }}
        />
      )}

      <ConfirmDialog
        open={!!confirm}
        title="Delete template?"
        message={confirm ? `${confirm.name} will be removed from the marketplace and its stored archive deleted. Sites already deployed from it are not affected.` : ''}
        confirmLabel="Delete template"
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          try {
            await adminApi(`/templates/${confirm.id}`, { method: 'DELETE', apiBaseUrl })
            setMessage({ tone: 'success', text: `${confirm.name} deleted.` })
            reload()
          } catch (err) {
            setMessage({ tone: 'error', text: err.message })
          }
          setConfirm(null)
        }}
      />
    </div>
  )
}
