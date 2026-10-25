import React, { useState, useEffect } from 'react'
import { Triangle, Database, Search, ChevronRight, Loader2, Check, AlertTriangle, ExternalLink, KeyRound } from 'lucide-react'

/**
 * Importers for the deployment wizard: pick a Vercel project (repository, build settings,
 * environment, domains) or a Supabase project (database address, keys, JWT secret, Auth settings,
 * functions). Access tokens stay in this component's state for the calls and are never saved.
 */

function TokenForm({ label, help, href, placeholder, busy, onSubmit, styles }) {
  const [token, setToken] = useState('')
  return (
    <div className="space-y-2">
      <div className="text-xs text-slate-400">{label} <a href={href} target="_blank" rel="noreferrer" className="text-cyan-300 hover:underline inline-flex items-center gap-1">Create one <ExternalLink className="w-3 h-3" /></a></div>
      <div className="flex gap-2">
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && token.trim() && onSubmit(token.trim())} placeholder={placeholder} autoComplete="off" className={styles.input} />
        <button onClick={() => onSubmit(token.trim())} disabled={!token.trim() || busy} className={styles.ghost}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />} Connect</button>
      </div>
      <div className="text-[11px] text-slate-500">{help}</div>
    </div>
  )
}

function ProjectList({ items, query, setQuery, render, onPick, busyId }) {
  const shown = items.filter(p => JSON.stringify(p).toLowerCase().includes(query.toLowerCase())).slice(0, 60)
  return (
    <div>
      <div className="relative">
        <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search projects" className="w-full bg-slate-950 border border-white/10 rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-cyan-500/60" />
      </div>
      <div className="mt-2 max-h-64 overflow-y-auto rounded-2xl border border-white/10 divide-y divide-white/5">
        {!shown.length && <div className="p-4 text-sm text-slate-500">No projects found.</div>}
        {shown.map(p => (
          <button key={p.key} onClick={() => onPick(p)} disabled={!!busyId} className="w-full px-4 py-3 text-left flex items-center gap-3 hover:bg-white/5 cursor-pointer disabled:cursor-default">
            {render(p)}
            {busyId === p.key ? <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" /> : <ChevronRight className="w-4 h-4 text-slate-600" />}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Vercel → onImport(project details from /api/deploy/vercel/project). */
export function VercelImport({ api, styles, onImport, imported }) {
  const [token, setToken] = useState(null)
  const [projects, setProjects] = useState(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState(null)

  const connect = async (t) => {
    setError(null); setBusy('token')
    try {
      const d = await api('/vercel/projects', { method: 'POST', body: { token: t } })
      setToken(t); setProjects(d.projects.map(p => ({ ...p, key: p.id })))
    } catch (e) { setError(e.message) } finally { setBusy('') }
  }
  const pick = async (p) => {
    setError(null); setBusy(p.key)
    try {
      const d = await api('/vercel/project', { method: 'POST', body: { token, id: p.id, teamId: p.teamId } })
      onImport(d.project)
    } catch (e) { setError(e.message) } finally { setBusy('') }
  }

  return (
    <div className="mt-5 space-y-4">
      <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 text-xs text-slate-400">
        Moves a Vercel project here: its Git repository and production branch, build settings, production environment variables and domain are filled in for you. The site is then built and served by this server.
        If it uses Supabase, the next steps can copy its database, users and files too.
      </div>
      {!projects ? (
        <TokenForm label="Vercel access token" href="https://vercel.com/account/settings/tokens" placeholder="Vercel token" busy={busy === 'token'} onSubmit={connect} styles={styles}
          help="Scope it to the team that owns the project. It is used to read the project now and is not saved." />
      ) : (
        <ProjectList items={projects} query={query} setQuery={setQuery} onPick={pick} busyId={busy}
          render={(p) => (
            <>
              <Triangle className="w-4 h-4 text-slate-300 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-white truncate">{p.name} <span className="text-slate-500 text-xs">· {p.team}</span></div>
                <div className="text-xs text-slate-500 truncate">{p.framework || 'other'} · {p.repo ? `${p.repo.replace(/^https:\/\/|\.git$/g, '')} (${p.branch})` : 'no Git repository'}</div>
              </div>
            </>
          )} />
      )}
      {error && <div className="text-xs text-rose-300 whitespace-pre-wrap">{error}</div>}
      {imported && (
        <div className="p-4 rounded-2xl bg-emerald-500/5 border border-emerald-500/20 text-xs text-slate-300 space-y-1.5">
          <div className="flex gap-2"><Check className="w-4 h-4 text-emerald-400 shrink-0" /><span>Imported <b className="text-white">{imported.name}</b>{imported.framework ? ` (${imported.framework})` : ''}: {imported.env.length} environment variable(s){imported.domains.length ? `, domain ${imported.domains[0]}` : ''}.</span></div>
          {imported.missingEnv.length > 0 && <div className="flex gap-2 text-amber-300"><AlertTriangle className="w-4 h-4 shrink-0" /><span>Sensitive on Vercel, so their values could not be read: {imported.missingEnv.join(', ')}. Fill them in on the next step.</span></div>}
          {imported.supabaseRef && <div className="flex gap-2"><Database className="w-4 h-4 text-cyan-400 shrink-0" /><span>Uses Supabase project <code>{imported.supabaseRef}</code>: the Database step is set to migrate it.</span></div>}
          {imported.notes.map((n, i) => <div key={i} className="flex gap-2 text-amber-300"><AlertTriangle className="w-4 h-4 shrink-0" /><span>{n}</span></div>)}
        </div>
      )}
    </div>
  )
}

/** Supabase → onImport(project details from /api/deploy/supabase/project, database password). */
export function SupabaseImport({ api, styles, onImport, preferredRef }) {
  const [token, setToken] = useState(null)
  const [projects, setProjects] = useState(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState(null)
  const [details, setDetails] = useState(null)
  const [password, setPassword] = useState('')
  const [done, setDone] = useState(false)

  const pick = async (p, t = token) => {
    setError(null); setBusy(p.key); setDone(false)
    try {
      const d = await api('/supabase/project', { method: 'POST', body: { token: t, ref: p.ref } })
      setDetails(d.project)
    } catch (e) { setError(e.message) } finally { setBusy('') }
  }
  const connect = async (t) => {
    setError(null); setBusy('token')
    try {
      const d = await api('/supabase/projects', { method: 'POST', body: { token: t } })
      const list = d.projects.map(p => ({ ...p, key: p.ref }))
      setToken(t); setProjects(list)
      const preferred = list.find(p => p.ref === preferredRef)
      if (preferred) await pick(preferred, t)
    } catch (e) { setError(e.message) } finally { setBusy(b => (b === 'token' ? '' : b)) }
  }
  useEffect(() => { setDone(false) }, [password])

  return (
    <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 space-y-3">
      <div className="text-xs text-slate-300 font-semibold flex items-center gap-2"><Database className="w-4 h-4 text-emerald-400" /> Fill in from your Supabase account <span className="text-slate-500 font-normal">(recommended)</span></div>
      {!projects ? (
        <TokenForm label="Supabase personal access token" href="https://supabase.com/dashboard/account/tokens" placeholder="sbp_…" busy={busy === 'token'} onSubmit={connect} styles={styles}
          help="Reads the project's connection details, API keys, JWT secret, Auth settings and Edge Function list. It is not saved." />
      ) : !details ? (
        <ProjectList items={projects} query={query} setQuery={setQuery} onPick={(p) => pick(p)} busyId={busy}
          render={(p) => (
            <>
              <Database className="w-4 h-4 text-emerald-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-white truncate">{p.name} <span className="text-slate-500 text-xs">· {p.ref}</span></div>
                <div className="text-xs text-slate-500 truncate">{p.region}{p.postgres ? ` · PostgreSQL ${p.postgres}` : ''}{p.status && p.status !== 'ACTIVE_HEALTHY' ? ` · ${p.status.toLowerCase()}` : ''}</div>
              </div>
            </>
          )} />
      ) : (
        <div className="space-y-3">
          <div className="text-xs text-slate-300 flex flex-wrap gap-x-4 gap-y-1">
            <span><b className="text-white">{details.name}</b> · {details.ref}</span>
            <span>{details.jwtSecret ? '✓ JWT secret (keys and sessions stay valid)' : '✗ JWT secret not readable (new keys will be issued)'}</span>
            <span>{details.storageKey ? '✓ service key (Storage files)' : '✗ no service key'}</span>
            <span>{details.functions.length} edge function(s)</span>
            <button onClick={() => { setDetails(null); setDone(false) }} className="text-slate-400 hover:text-white cursor-pointer">Change project</button>
          </div>
          <div className="flex gap-2">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Database password (Project Settings → Database)" autoComplete="new-password" className={styles.input} />
            <button onClick={() => { onImport(details, password); setDone(true) }} disabled={!password} className={styles.primary}>{done ? <Check className="w-4 h-4" /> : null}Use this project</button>
          </div>
          <div className="text-[11px] text-slate-500">Supabase never shows the database password again: if you lost it, reset it under Project Settings → Database.</div>
        </div>
      )}
      {error && <div className="text-xs text-rose-300 whitespace-pre-wrap">{error}</div>}
    </div>
  )
}
