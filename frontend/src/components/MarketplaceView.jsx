import React, { useEffect, useState } from 'react'
import {
  ShoppingBag, Search, Sparkles, ExternalLink, Zap, X, GitBranch, Archive, Database,
  RefreshCw, AlertCircle, Rocket, Layers
} from 'lucide-react'
import { useApi } from '../hooks/useApi'

const CATEGORY_LABELS = {
  all: 'All templates', saas: 'SaaS & panels', web: 'Websites', landing: 'Landing pages',
  ecommerce: 'E-commerce', blog: 'Blogs & CMS', api: 'APIs & backends', other: 'Other'
}

const ACCENT_GRADIENTS = {
  cyan: 'from-cyan-900/50 via-indigo-950 to-slate-950',
  purple: 'from-purple-900/50 via-slate-950 to-slate-950',
  emerald: 'from-emerald-900/50 via-slate-950 to-slate-950',
  amber: 'from-amber-900/40 via-slate-950 to-slate-950',
  rose: 'from-rose-900/40 via-slate-950 to-slate-950',
  indigo: 'from-indigo-900/50 via-slate-950 to-slate-950'
}

const TYPE_LABELS = {
  static: 'Static website', spa: 'Single-page app', 'node-ssr': 'Node SSR', 'node-server': 'Node.js server',
  fullstack: 'Frontend + API', php: 'PHP', python: 'Python', go: 'Go', java: 'Java', ruby: 'Ruby'
}

const stackOf = (t) => TYPE_LABELS[t.defaults?.type] || t.analysis?.framework || 'Auto-detected'

/**
 * Template marketplace: templates published by the platform team, deployable in one click
 * to the selected server through the deploy wizard.
 */
export default function MarketplaceView({ onDeployTemplate, onBackToHub }) {
  const api = useApi()
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [category, setCategory] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selected, setSelected] = useState(null)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await api('/api/templates')
      setTemplates(data.templates || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const categories = ['all', ...Array.from(new Set(templates.map((t) => t.category)))]
  const q = searchQuery.toLowerCase().trim()
  const filtered = templates.filter((t) =>
    (category === 'all' || t.category === category) &&
    (!q || `${t.name} ${t.description} ${(t.technologies || []).join(' ')}`.toLowerCase().includes(q)))

  const deploy = (t) => {
    setSelected(null)
    onDeployTemplate && onDeployTemplate(t)
  }

  return (
    <div className="min-h-screen bg-[#07090E] text-slate-100 font-sans flex flex-col">
      <header className="min-h-16 bg-[#0B0E17]/90 backdrop-blur-xl border-b border-white/10 px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3 z-30 shrink-0">
        <div className="flex items-center gap-3">
          {onBackToHub && (
            <button onClick={onBackToHub} className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 rounded-xl text-xs font-mono font-bold transition cursor-pointer">
              ← Back to Projects Hub
            </button>
          )}
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-gradient-to-tr from-amber-500 to-rose-600 text-slate-950 shadow-lg"><ShoppingBag className="w-5 h-5" /></div>
            <h1 className="font-extrabold text-white text-base tracking-tight">Template Marketplace</h1>
          </div>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
          <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search templates or tech…" className="w-full pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 font-mono" />
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8 space-y-8">
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-950 border border-amber-500/30 rounded-3xl p-6 sm:p-8 shadow-2xl">
          <div className="max-w-2xl space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 font-mono text-xs font-bold">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />1-click deploy to your server
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">Ready-to-deploy panels, websites and apps</h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              Pick a template, choose a domain and it's built, configured and published on your selected server with nginx, PM2 and SSL — the same pipeline as a regular deploy.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs overflow-x-auto pb-1 border-b border-slate-800">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`px-4 py-2 mb-3 rounded-xl font-bold whitespace-nowrap transition cursor-pointer ${category === c ? 'bg-gradient-to-r from-amber-500 to-rose-600 text-slate-950' : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'}`}
            >
              {CATEGORY_LABELS[c] || c}{c === 'all' ? ` (${templates.length})` : ''}
            </button>
          ))}
          <button onClick={load} className="ml-auto mb-3 p-2 text-slate-400 hover:text-white cursor-pointer" title="Refresh"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
        </div>

        {error ? (
          <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-sm flex gap-2"><AlertCircle className="w-5 h-5 shrink-0" />{error}</div>
        ) : loading ? (
          <div className="py-24 text-center text-slate-400 text-xs font-mono"><RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3 text-amber-400" />Loading templates…</div>
        ) : filtered.length === 0 ? (
          <div className="py-24 text-center text-slate-500 text-sm space-y-2">
            <Layers className="w-10 h-10 mx-auto text-slate-700" />
            <p>{templates.length === 0 ? 'No templates have been published yet.' : 'No templates match your search.'}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filtered.map((t) => (
              <div key={t.id} className="bg-slate-950 border border-slate-800 hover:border-amber-500/60 rounded-3xl overflow-hidden flex flex-col transition shadow-xl">
                <button onClick={() => setSelected(t)} className={`h-40 bg-gradient-to-br ${ACCENT_GRADIENTS[t.accent] || ACCENT_GRADIENTS.cyan} relative text-left cursor-pointer`}>
                  {t.thumbnailUrl ? (
                    <img src={t.thumbnailUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-80" loading="lazy" />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
                      <span className="font-black text-xl text-white/90 tracking-tight">{t.name}</span>
                    </div>
                  )}
                  {t.featured && <span className="absolute top-3 left-3 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-amber-500 text-slate-950">FEATURED</span>}
                  <span className="absolute top-3 right-3 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-slate-950/80 text-slate-300 border border-white/10">{CATEGORY_LABELS[t.category] || t.category}</span>
                </button>
                <div className="p-5 flex-1 flex flex-col gap-3">
                  <div>
                    <h3 className="font-extrabold text-white text-base">{t.name}</h3>
                    <p className="text-xs text-slate-400 mt-1 line-clamp-3">{t.description || 'No description.'}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(t.technologies || []).slice(0, 6).map((tech) => (
                      <span key={tech} className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-slate-900 border border-slate-800 text-slate-300">{tech}</span>
                    ))}
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono flex items-center gap-3 mt-auto">
                    <span>{stackOf(t)}</span>
                    <span>· {t.deployCount || 0} deploy{t.deployCount === 1 ? '' : 's'}</span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => deploy(t)} className="flex-1 py-2 bg-gradient-to-r from-amber-500 to-rose-600 text-slate-950 font-extrabold rounded-xl text-xs flex items-center justify-center gap-1.5 cursor-pointer"><Rocket className="w-3.5 h-3.5" />Deploy</button>
                    {t.previewUrl && (
                      <a href={t.previewUrl} target="_blank" rel="noopener noreferrer" className="px-3 py-2 bg-slate-900 border border-slate-800 hover:border-slate-600 rounded-xl text-xs text-slate-300 flex items-center gap-1"><ExternalLink className="w-3.5 h-3.5" />Preview</a>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {selected && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xl flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div className="bg-[#0B0E17] border border-white/15 rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className={`h-44 bg-gradient-to-br ${ACCENT_GRADIENTS[selected.accent] || ACCENT_GRADIENTS.cyan} relative rounded-t-3xl overflow-hidden`}>
              {selected.thumbnailUrl && <img src={selected.thumbnailUrl} alt="" className="w-full h-full object-cover" />}
              <button onClick={() => setSelected(null)} className="absolute top-3 right-3 p-1.5 bg-slate-950/70 rounded-lg text-slate-300 hover:text-white cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-6 space-y-5">
              <div>
                <h3 className="text-xl font-black text-white">{selected.name}</h3>
                <p className="text-xs text-slate-400 mt-2 whitespace-pre-line leading-relaxed">{selected.description || 'No description.'}</p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="bg-slate-900/70 border border-white/10 rounded-xl p-3"><div className="text-slate-500 text-[10px] uppercase font-mono">App type</div><div className="text-slate-200 font-semibold mt-1">{stackOf(selected)}</div></div>
                <div className="bg-slate-900/70 border border-white/10 rounded-xl p-3"><div className="text-slate-500 text-[10px] uppercase font-mono">Source</div>
                  <div className="text-slate-200 font-semibold mt-1 flex items-center gap-1">
                    {selected.source?.type === 'git' ? <><GitBranch className="w-3.5 h-3.5" />Git ({selected.source.branch})</> : <><Archive className="w-3.5 h-3.5" />Packaged archive</>}
                  </div>
                </div>
                <div className="bg-slate-900/70 border border-white/10 rounded-xl p-3"><div className="text-slate-500 text-[10px] uppercase font-mono">Database</div><div className="text-slate-200 font-semibold mt-1 flex items-center gap-1"><Database className="w-3.5 h-3.5" />{selected.defaults?.database && selected.defaults.database !== 'none' ? selected.defaults.database : 'None needed'}</div></div>
                <div className="bg-slate-900/70 border border-white/10 rounded-xl p-3"><div className="text-slate-500 text-[10px] uppercase font-mono">Deployed</div><div className="text-slate-200 font-semibold mt-1">{selected.deployCount || 0} times</div></div>
              </div>
              {(selected.technologies || []).length > 0 && (
                <div className="flex flex-wrap gap-1.5">{selected.technologies.map((tech) => <span key={tech} className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-slate-900 border border-slate-800 text-slate-300">{tech}</span>)}</div>
              )}
              <div className="flex gap-2">
                <button onClick={() => deploy(selected)} className="flex-1 py-3 bg-gradient-to-r from-amber-500 to-rose-600 text-slate-950 font-extrabold rounded-xl text-sm flex items-center justify-center gap-2 cursor-pointer"><Zap className="w-4 h-4" />Deploy this template</button>
                {selected.previewUrl && <a href={selected.previewUrl} target="_blank" rel="noopener noreferrer" className="px-4 py-3 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-300 flex items-center gap-1.5"><ExternalLink className="w-4 h-4" />Live preview</a>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
