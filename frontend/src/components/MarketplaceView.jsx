import React, { useState } from 'react'
import {
  ShoppingBag, Search, Sparkles, ExternalLink, Zap, Star, Filter, Code,
  Globe, Layout, CheckCircle2, ArrowRight, ShieldCheck, Download, Tag
} from 'lucide-react'

export default function MarketplaceView({ onDeployTemplate, onBackToHub }) {
  const [selectedCategory, setSelectedCategory] = useState('all') // 'all' | 'saas' | 'web' | 'landing'
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTemplateModal, setSelectedTemplateModal] = useState(null)

  const templates = [
    {
      id: 'tpl-autodeploy-saas',
      name: 'AutoDeploy Multi-Tenant Panel',
      category: 'saas',
      categoryLabel: 'SaaS & DevOps Panel',
      description: 'Complete multi-tenant server management & AI Agent deployment panel with SSH, database suite, and PM2 logs.',
      price: 149,
      rating: 5.0,
      sales: 128,
      repoUrl: 'https://github.com/yatindradhurwe/auto-deploy-panel.git',
      previewUrl: 'https://automate-deployment.yjtechnosoft.com',
      badge: 'POPULAR',
      technologies: ['React 18', 'TailwindCSS', 'Node.js', 'Express', 'SSH2', 'PostgreSQL'],
      gradient: 'from-cyan-900/40 via-indigo-950 to-slate-950'
    },
    {
      id: 'tpl-tip-crm',
      name: 'TOP Income Producer Enterprise CRM',
      category: 'saas',
      categoryLabel: 'Enterprise CRM Suite',
      description: 'Full-featured CRM panel with lead pipelines, contact management, deals pipeline, team roles, and automated email inbox.',
      price: 199,
      rating: 4.9,
      sales: 94,
      repoUrl: 'https://github.com/yatindradhurwe/tip-crm.git',
      previewUrl: 'https://tip-crm.yjtechnosoft.com',
      badge: 'BESTSELLER',
      technologies: ['React', 'Node.js', 'PostgreSQL', 'Tailwind', 'JWT Auth'],
      gradient: 'from-purple-900/40 via-slate-950 to-slate-950'
    },
    {
      id: 'tpl-litigation-saas',
      name: 'Litigation & Legal Case Management',
      category: 'saas',
      categoryLabel: 'Legal Tech SaaS',
      description: 'Comprehensive legal case tracking, hearings schedule, client billing, court document generator, and admin panel.',
      price: 129,
      rating: 4.8,
      sales: 62,
      repoUrl: 'https://github.com/tenant-org/litigation-app.git',
      previewUrl: 'http://187.127.165.128:5050',
      badge: 'FEATURED',
      technologies: ['React', 'Express', 'PostgreSQL', 'Lucide Icons'],
      gradient: 'from-emerald-900/40 via-slate-950 to-slate-950'
    },
    {
      id: 'tpl-estate-portal',
      name: 'Estate Real Estate SaaS Platform',
      category: 'web',
      categoryLabel: 'Real Estate Portal',
      description: 'Property listings marketplace with interactive map filters, lead contact forms, agent profile pages, and booking system.',
      price: 99,
      rating: 4.7,
      sales: 45,
      repoUrl: 'https://github.com/tenant-org/estate-portal.git',
      previewUrl: 'http://187.127.165.128:5051',
      badge: 'NEW',
      technologies: ['Next.js', 'TailwindCSS', 'Node.js', 'MySQL'],
      gradient: 'from-amber-900/40 via-slate-950 to-slate-950'
    },
    {
      id: 'tpl-dark-saas-landing',
      name: 'Dark Horizon SaaS Landing & Pricing Page',
      category: 'landing',
      categoryLabel: 'Landing Page & Design',
      description: 'Ultra-modern dark gradient landing page template with pricing table, hero banner, feature carousels, and contact modal.',
      price: 49,
      rating: 4.9,
      sales: 210,
      repoUrl: 'https://github.com/tenant-org/dark-saas-landing.git',
      previewUrl: 'https://automate-deployment.yjtechnosoft.com',
      badge: 'TRENDING',
      technologies: ['Vite', 'React', 'TailwindCSS', 'Framer Motion'],
      gradient: 'from-rose-900/40 via-slate-950 to-slate-950'
    },
    {
      id: 'tpl-ai-copilot-studio',
      name: 'AI Agent Developer Studio UI',
      category: 'web',
      categoryLabel: 'AI & Developer Tools',
      description: 'AI Coding Assistant workbench interface with code editor, terminal logs, natural language prompt drawer, and diff previewer.',
      price: 119,
      rating: 5.0,
      sales: 78,
      repoUrl: 'https://github.com/yatindradhurwe/auto-deploy-panel.git',
      previewUrl: 'https://automate-deployment.yjtechnosoft.com',
      badge: 'HOT',
      technologies: ['React', 'Node.js', 'Gemini API', 'Claude API', 'OpenAI'],
      gradient: 'from-blue-900/40 via-indigo-950 to-slate-950'
    }
  ]

  const filteredTemplates = templates.filter((tpl) => {
    const matchesCat = selectedCategory === 'all' || tpl.category === selectedCategory
    const q = searchQuery.toLowerCase().trim()
    const matchesSearch = !q || tpl.name.toLowerCase().includes(q) || tpl.description.toLowerCase().includes(q) || tpl.technologies.some(t => t.toLowerCase().includes(q))
    return matchesCat && matchesSearch
  })

  return (
    <div className="min-h-screen bg-[#07090E] text-slate-100 font-sans flex flex-col">
      
      {/* Marketplace Top Navigation Header */}
      <header className="h-16 bg-[#0B0E17]/90 backdrop-blur-xl border-b border-white/10 px-6 flex items-center justify-between z-30 shrink-0">
        <div className="flex items-center space-x-4">
          {onBackToHub && (
            <button
              onClick={onBackToHub}
              className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 rounded-xl text-xs font-mono font-bold transition flex items-center space-x-1.5 cursor-pointer"
            >
              ← Back to Projects Hub
            </button>
          )}

          <div className="flex items-center space-x-2">
            <div className="p-2 rounded-xl bg-gradient-to-tr from-amber-500 to-rose-600 text-slate-950 font-black shadow-lg">
              <ShoppingBag className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-extrabold text-white text-base tracking-tight flex items-center gap-2">
                Template Marketplace
                <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded-full font-mono font-bold">
                  SOFTWARE PANELS & DESIGNS
                </span>
              </h1>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <div className="relative hidden sm:block">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search templates, tech, CRM..."
              className="pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 w-56 font-mono"
            />
          </div>

          <button
            onClick={() => alert('Template vendor submission program opening soon!')}
            className="px-4 py-1.5 bg-gradient-to-r from-amber-500 to-rose-600 hover:from-amber-400 hover:to-rose-500 text-slate-950 font-extrabold rounded-xl text-xs shadow-lg flex items-center space-x-1.5 transition cursor-pointer"
          >
            <Tag className="w-3.5 h-3.5" />
            <span>Sell Your Template</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8 space-y-8">
        
        {/* Hero Section */}
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-950 border border-amber-500/30 rounded-3xl p-8 backdrop-blur-xl relative overflow-hidden shadow-2xl">
          <div className="max-w-2xl space-y-3 relative z-10">
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 font-mono text-xs font-bold">
              <Sparkles className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
              <span>1-Click Deployable Software Panels & Website Designs</span>
            </div>
            <h2 className="text-3xl font-black text-white tracking-tight">
              Ready-to-Deploy SaaS Panels, CRMs & Fullstack Web Templates
            </h2>
            <p className="text-xs text-slate-400 font-mono leading-relaxed">
              Instantly buy, preview, and deploy production-grade software panel templates directly to your server node with 1-click CI/CD integration.
            </p>
          </div>
        </div>

        {/* Filter Categories Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="flex items-center space-x-2 font-mono text-xs overflow-x-auto pb-1">
            <button
              onClick={() => setSelectedCategory('all')}
              className={`px-4 py-2 rounded-xl font-bold transition cursor-pointer ${
                selectedCategory === 'all'
                  ? 'bg-gradient-to-r from-amber-500 to-rose-600 text-slate-950 shadow-md'
                  : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              All Templates ({templates.length})
            </button>
            <button
              onClick={() => setSelectedCategory('saas')}
              className={`px-4 py-2 rounded-xl font-bold transition cursor-pointer ${
                selectedCategory === 'saas'
                  ? 'bg-gradient-to-r from-amber-500 to-rose-600 text-slate-950 shadow-md'
                  : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              SaaS & CRM Panels
            </button>
            <button
              onClick={() => setSelectedCategory('web')}
              className={`px-4 py-2 rounded-xl font-bold transition cursor-pointer ${
                selectedCategory === 'web'
                  ? 'bg-gradient-to-r from-amber-500 to-rose-600 text-slate-950 shadow-md'
                  : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              Fullstack Web Apps
            </button>
            <button
              onClick={() => setSelectedCategory('landing')}
              className={`px-4 py-2 rounded-xl font-bold transition cursor-pointer ${
                selectedCategory === 'landing'
                  ? 'bg-gradient-to-r from-amber-500 to-rose-600 text-slate-950 shadow-md'
                  : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              Landing & Website Designs
            </button>
          </div>

          <div className="text-xs text-slate-400 font-mono">
            Showing <strong className="text-amber-300">{filteredTemplates.length}</strong> template{filteredTemplates.length !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Templates Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredTemplates.map((tpl) => (
            <div
              key={tpl.id}
              className="bg-slate-950/90 border border-slate-800/90 hover:border-amber-500/60 rounded-3xl overflow-hidden transition-all duration-300 flex flex-col group shadow-xl hover:shadow-amber-950/30"
            >
              {/* Thumbnail Container */}
              <div className={`h-44 bg-gradient-to-br ${tpl.gradient} p-6 flex flex-col justify-between relative border-b border-slate-800/80`}>
                <div className="flex items-center justify-between z-10">
                  <span className="px-2.5 py-1 rounded-full text-[10px] font-mono font-extrabold uppercase bg-amber-500 text-slate-950 shadow-md">
                    {tpl.badge}
                  </span>
                  <span className="text-sm font-black text-white bg-slate-950/80 border border-white/10 px-3 py-1 rounded-xl font-mono">
                    ${tpl.price}
                  </span>
                </div>

                <div className="z-10 space-y-1">
                  <span className="text-[10px] font-mono text-cyan-300 font-bold uppercase tracking-wider block">
                    {tpl.categoryLabel}
                  </span>
                  <h3 className="font-black text-white text-lg tracking-tight group-hover:text-amber-300 transition line-clamp-1">
                    {tpl.name}
                  </h3>
                </div>
              </div>

              {/* Card Body */}
              <div className="p-6 flex-1 flex flex-col justify-between space-y-4">
                <p className="text-xs text-slate-400 font-mono line-clamp-2 leading-relaxed">
                  {tpl.description}
                </p>

                {/* Tech Badges */}
                <div className="flex flex-wrap gap-1.5">
                  {tpl.technologies.map((t, idx) => (
                    <span key={idx} className="text-[10px] font-mono bg-slate-900 text-slate-300 border border-slate-800 px-2 py-0.5 rounded-lg">
                      {t}
                    </span>
                  ))}
                </div>

                {/* Actions */}
                <div className="pt-3 border-t border-slate-900 flex items-center justify-between gap-3">
                  <a
                    href={tpl.previewUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-xl text-xs font-mono font-bold flex items-center space-x-1 border border-slate-800 transition"
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Demo</span>
                  </a>

                  <button
                    onClick={() => onDeployTemplate && onDeployTemplate(tpl)}
                    className="flex-1 py-2 bg-gradient-to-r from-amber-500 via-rose-600 to-indigo-600 hover:from-amber-400 hover:to-rose-500 text-slate-950 font-extrabold rounded-xl text-xs font-mono shadow-md flex items-center justify-center space-x-1.5 transition cursor-pointer"
                  >
                    <Zap className="w-3.5 h-3.5 fill-slate-950" />
                    <span>1-Click Deploy Template</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

      </main>

    </div>
  )
}
