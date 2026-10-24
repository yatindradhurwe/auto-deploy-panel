import React, { useEffect, useState } from 'react'
import { Plug, Trash2, ShieldAlert, Copy, Check } from 'lucide-react'
import { Modal, Button, Select, Badge, Alert, Loading, EmptyState, Field, TextInput } from './admin/AdminUI'
import { useProjects } from '../store/ProjectsContext'

const ACCESS_OPTIONS = [
  { value: 'read', label: 'Read only — view files, git history, logs' },
  { value: 'edit', label: 'Read & edit — change files, run builds and tests' },
  { value: 'full', label: 'Full — edit and restart the app' }
]
const ACCESS_TONES = { read: 'slate', edit: 'cyan', full: 'amber' }
const EXPIRY_OPTIONS = [
  { value: '7', label: 'Expires in 7 days' },
  { value: '30', label: 'Expires in 30 days' },
  { value: '90', label: 'Expires in 90 days' },
  { value: '365', label: 'Expires in 1 year' },
  { value: '0', label: 'Never expires' }
]

const formatDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '')

function serverSlug(project) {
  const slug = String(project?.name || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return `autodeploy-${slug || 'project'}`
}

/** Setup instructions for the common MCP clients, with the new token filled in. */
function clientSnippets(name, endpoint, secret) {
  return [
    {
      id: 'claude-code',
      label: 'Claude Code',
      hint: 'Run in your terminal, then start claude in any folder.',
      code: `claude mcp add --transport http ${name} ${endpoint} --header "Authorization: Bearer ${secret}"`
    },
    {
      id: 'http-json',
      label: 'Cursor / Windsurf / other',
      hint: 'Add to the client\'s MCP config (for Cursor: ~/.cursor/mcp.json).',
      code: JSON.stringify({ mcpServers: { [name]: { type: 'http', url: endpoint, headers: { Authorization: `Bearer ${secret}` } } } }, null, 2)
    },
    {
      id: 'claude-desktop',
      label: 'Claude Desktop',
      hint: 'Add to claude_desktop_config.json (Settings → Developer → Edit Config). Needs Node.js; or add the URL as a custom connector.',
      code: JSON.stringify({ mcpServers: { [name]: { command: 'npx', args: ['-y', 'mcp-remote', endpoint, '--header', 'Authorization:${AUTH_HEADER}'], env: { AUTH_HEADER: `Bearer ${secret}` } } } }, null, 2)
    }
  ]
}

function CopyBlock({ code }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (e) {}
  }
  return (
    <div className="relative">
      <pre className="bg-slate-950 border border-slate-800 rounded-xl p-3 pr-20 text-[11px] text-slate-200 font-mono whitespace-pre-wrap break-all">{code}</pre>
      <Button size="sm" className="absolute top-2 right-2" onClick={copy}>
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  )
}

/**
 * Generate MCP access tokens so Claude Code, Claude Desktop, Cursor or another AI client can work on
 * this project through the panel's MCP server (managers of the project only).
 */
export default function McpAccessModal({ project, onClose }) {
  const { getMcpTokens, createMcpToken, revokeMcpToken } = useProjects()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [form, setForm] = useState({ name: '', access: 'edit', expiresInDays: '90' })
  const [created, setCreated] = useState(null)
  const [client, setClient] = useState('claude-code')

  const load = () => getMcpTokens(project).then(setData).catch((err) => setError(err.message))

  useEffect(() => {
    if (project) {
      setData(null)
      setError('')
      setCreated(null)
      load()
    }
  }, [project?.path])

  const generate = async () => {
    setBusy('create')
    setError('')
    try {
      const res = await createMcpToken(project, form)
      setCreated(res)
      setForm({ name: '', access: 'edit', expiresInDays: '90' })
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy('')
    }
  }

  const revoke = async (token) => {
    setBusy(`revoke-${token.id}`)
    setError('')
    try {
      await revokeMcpToken(token.id)
      if (created?.token.id === token.id) setCreated(null)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy('')
    }
  }

  const snippets = created ? clientSnippets(serverSlug(project), created.endpoint, created.secret) : []
  const snippet = snippets.find((s) => s.id === client) || snippets[0]

  return (
    <Modal open={!!project} title={`Connect AI to "${project?.name || ''}"`} onClose={onClose} wide>
      {!data && !error ? <Loading /> : (
        <div className="space-y-5 text-xs">
          <p className="text-slate-400">
            Generate an MCP server token so Claude Code, Claude Desktop, Cursor or any other MCP-capable AI can read and change this project on its server.
            The AI only reaches this project's folder, runs a safe list of commands, and every file it changes is backed up so it can be undone.
          </p>

          {error && <Alert>{error}</Alert>}

          {created && (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-300">MCP server ready — "{created.token.name}"</div>
              <p className="text-emerald-200/80">Copy the setup for your AI client now. The token is shown only once; generate a new one if you lose it.</p>
              <div className="flex flex-wrap gap-1.5">
                {snippets.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setClient(s.id)}
                    className={`px-3 py-1.5 rounded-lg border text-[11px] font-semibold transition cursor-pointer ${client === s.id ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-200' : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'}`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <p className="text-slate-400">{snippet.hint}</p>
              <CopyBlock code={snippet.code} />
              <div className="grid sm:grid-cols-2 gap-2 text-[11px] text-slate-400">
                <div>Server URL: <code className="text-slate-200 break-all">{created.endpoint}</code></div>
                <div>Auth header: <code className="text-slate-200">Authorization: Bearer &lt;token&gt;</code></div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Generate an MCP server token</h4>
            <div className="grid sm:grid-cols-3 gap-2">
              <Field label="Name">
                <TextInput value={form.name} maxLength={60} placeholder="e.g. Claude Code on my laptop" onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label="Access">
                <Select className="w-full" value={form.access} onChange={(access) => setForm({ ...form, access })} options={ACCESS_OPTIONS} />
              </Field>
              <Field label="Expiry">
                <Select className="w-full" value={form.expiresInDays} onChange={(expiresInDays) => setForm({ ...form, expiresInDays })} options={EXPIRY_OPTIONS} />
              </Field>
            </div>
            <div className="flex justify-end">
              <Button variant="primary" loading={busy === 'create'} onClick={generate}>
                <Plug className="w-3.5 h-3.5" /> Generate MCP server
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Active tokens</h4>
            {(data?.tokens || []).length === 0 ? (
              <EmptyState>No AI clients are connected to this project yet.</EmptyState>
            ) : (
              <ul className="divide-y divide-slate-800 border border-slate-800 rounded-2xl">
                {data.tokens.map((t) => (
                  <li key={t.id} className="p-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-200 truncate">{t.name}</span>
                        <Badge tone={ACCESS_TONES[t.access]}>{t.access}</Badge>
                        {t.expired && <Badge tone="red">expired</Badge>}
                      </div>
                      <div className="text-slate-500 truncate">
                        <code>{t.tokenPreview}</code> · by {t.createdBy.fullName} · {t.lastUsedAt ? `last used ${formatDate(t.lastUsedAt)}` : 'never used'} · {t.expiresAt ? `${t.expired ? 'expired' : 'expires'} ${formatDate(t.expiresAt)}` : 'no expiry'}
                      </div>
                    </div>
                    <Button size="sm" variant="danger" loading={busy === `revoke-${t.id}`} onClick={() => revoke(t)}>
                      <Trash2 className="w-3.5 h-3.5" /> Revoke
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-amber-200">
            <ShieldAlert className="w-4 h-4 shrink-0 mt-px" />
            <span>
              Anyone with the token can work on this project as you, so keep it private. It stops working when it expires, when you revoke it,
              when you sign out everywhere, or when you lose access to the project.
            </span>
          </div>
        </div>
      )}
    </Modal>
  )
}
