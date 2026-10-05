import React, { useState, useEffect } from 'react'
import {
  Layers, Search, Grid, List, ExternalLink, Globe, Play, Sparkles, Code,
  Server, RefreshCw, CheckCircle2, ChevronDown, Bell, User, Plus, FolderGit2,
  Trash2, ShieldCheck, DownloadCloud, Activity, Zap, HardDrive
} from 'lucide-react'

export default function AllProjectsHub({
  server,
  jwtToken,
  currentUser,
  onOpenProjectStudio,
  onChangeServerNode,
  onTabChange
}) {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortOrder, setSortOrder] = useState('custom')
  const [viewMode, setViewMode] = useState('grid') // 'grid' | 'list'
  const [showCreditNotice, setShowCreditNotice] = useState(true)

  useEffect(() => {
    fetchProjects()
  }, [server])

  const fetchProjects = async () => {
    setLoading(true)
    const tok = jwtToken || localStorage.getItem('autodeploy_token') || localStorage.getItem('autodeploy_jwt_token') || ''
    const srvId = server?.id || ''
    try {
      const res = await fetch(`/api/studio/projects?serverId=${srvId}`, {
        headers: {
          'Authorization': `Bearer ${tok}`,
          'X-Server-Id': srvId
        }
      })
      const data = await res.json()
      if (data.success && Array.isArray(data.projects)) {
        setProjects(data.projects)
      }
    } catch (e) {
      console.error('Failed to load projects for hub:', e)
    } finally {
      setLoading(false)
    }
  }

  const filteredProjects = projects.filter((p) => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    return (
      (p.name && p.name.toLowerCase().includes(q)) ||
      (p.path && p.path.toLowerCase().includes(q)) ||
      (p.domain && p.domain.toLowerCase().includes(q)) ||
      (p.repoName && p.repoName.toLowerCase().includes(q))
    )
  })

  // Generate thumbnail preview placeholder styling
  const getThumbnailStyle = (index) => {
    const gradients = [
      'from-slate-900 via-indigo-950 to-slate-950',
      'from-slate-950 via-cyan-950 to-slate-900',
      'from-slate-900 via-purple-950 to-slate-950',
      'from-slate-950 via-emerald-950 to-slate-900'
    ]
    return gradients[index % gradients.length]
  }

  return (
    <div className="min-h-screen bg-[#07090E] text-slate-100 flex flex-col font-sans">
      
      {/* Top Navigation Header (Matching Estage Screenshot Design) */}
      <header className="h-16 bg-[#0B0E17]/90 backdrop-blur-xl border-b border-white/10 px-6 flex items-center justify-between z-30 shrink-0">
        
        {/* Left: Logo & Top Header Nav Tabs */}
        <div className="flex items-center space-x-6">
          <div className="flex items-center space-x-2.5 cursor-pointer" onClick={onChangeServerNode}>
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-cyan-500 via-indigo-600 to-purple-600 flex items-center justify-center font-black text-white shadow-md">
              ⚡
            </div>
            <span className="font-extrabold text-white text-base tracking-tight">AutoDeploy</span>
          </div>

          <nav className="hidden lg:flex items-center space-x-1 font-mono text-xs">
            <button
              onClick={() => onTabChange && onTabChange('projects')}
              className="px-3 py-1.5 rounded-lg font-bold text-white bg-white/10 border border-white/10"
            >
              Projects
            </button>
            <button
              onClick={() => onTabChange && onTabChange('email')}
              className="px-3 py-1.5 rounded-lg text-slate-400 hover:text-white transition"
            >
              Email Box
            </button>
            <button
              onClick={() => onTabChange && onTabChange('databases')}
              className="px-3 py-1.5 rounded-lg text-slate-400 hover:text-white transition"
            >
              Databases
            </button>
            <button
              onClick={() => onTabChange && onTabChange('servers')}
              className="px-3 py-1.5 rounded-lg text-slate-400 hover:text-white transition"
            >
              Servers
            </button>
            <button
              onClick={() => onTabChange && onTabChange('audit-logs')}
              className="px-3 py-1.5 rounded-lg text-slate-400 hover:text-white transition"
            >
              Audit Logs
            </button>
          </nav>
        </div>

        {/* Right Controls: Search, Server Selector, User Avatar, Upgrade */}
        <div className="flex items-center space-x-3 font-mono text-xs">
          
          <div className="relative hidden md:block">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search... Ctrl K"
              className="pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 w-44"
            />
          </div>

          {/* Connected Server Node Dropdown */}
          <button
            onClick={onChangeServerNode}
            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-700 rounded-xl font-bold flex items-center space-x-1.5 transition cursor-pointer"
          >
            <Server className="w-3.5 h-3.5 text-cyan-400" />
            <span className="truncate max-w-[120px]">{server?.name || 'Server Node'}</span>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          </button>

          {/* User Profile Avatar Badge */}
          <div className="flex items-center space-x-2 pl-2 border-l border-slate-800">
            <div className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center font-bold text-white text-[10px]">
              {currentUser?.name ? currentUser.name.slice(0, 2).toUpperCase() : 'YD'}
            </div>
            <span className="hidden sm:inline text-slate-300 font-semibold text-xs">
              {currentUser?.name || 'Yatindra Dhurwe'}
            </span>
          </div>

          <button className="px-3.5 py-1.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-extrabold rounded-xl shadow-md transition cursor-pointer">
            Get Pro Plan
          </button>
        </div>
      </header>

      {/* Main All Projects Hub Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8 space-y-6">
        
        {/* Workspace Sub-header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center space-x-1.5 text-[11px] font-mono text-cyan-400 font-bold uppercase tracking-widest mb-1">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
              <span>{server?.name || 'ESTAGE Workspace'}</span>
            </div>
            <h1 className="text-3xl font-black text-white tracking-tight">All Projects</h1>
            <p className="text-xs text-slate-400 font-mono mt-1">
              {projects.length} project{projects.length !== 1 ? 's' : ''} connected on {server?.ipAddress || 'live server'} — continue where you left off
            </p>
          </div>

          {/* Filter Search Input */}
          <div className="w-full md:w-72">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Name, project ID or domain..."
              className="w-full px-4 py-2 bg-slate-950 border border-slate-800 rounded-2xl text-xs text-slate-100 placeholder-slate-500 font-mono focus:border-cyan-500 focus:outline-none shadow-inner"
            />
          </div>
        </div>

        {/* Credit / Usage Notification Banner (Matching Screenshot) */}
        {showCreditNotice && (
          <div className="bg-slate-950 border border-cyan-500/30 rounded-2xl p-4 flex items-center justify-between shadow-xl">
            <div className="flex items-center space-x-3">
              <div className="p-2.5 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                <Zap className="w-5 h-5" />
              </div>
              <div className="font-mono text-xs">
                <span className="font-bold text-white block">AI Agent & Server Updates Active</span>
                <span className="text-slate-400">All autonomous tools, live preview, and PM2 auto-updaters ready.</span>
              </div>
            </div>
            <button
              onClick={() => setShowCreditNotice(false)}
              className="px-3 py-1 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold font-mono text-xs rounded-xl shadow transition cursor-pointer"
            >
              Top up credits
            </button>
          </div>
        )}

        {/* Sort & Grid Toggle Bar */}
        <div className="flex items-center justify-between font-mono text-xs pt-2">
          <div className="flex items-center space-x-2">
            <span className="text-slate-500 uppercase text-[10px] font-bold">SORT:</span>
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              className="bg-slate-950 border border-slate-800 text-slate-300 rounded-xl px-3 py-1 focus:outline-none"
            >
              <option value="custom">Custom order</option>
              <option value="name">Project Name</option>
              <option value="recent">Recently Updated</option>
            </select>
          </div>

          <div className="flex items-center space-x-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded-lg transition cursor-pointer ${
                viewMode === 'grid' ? 'bg-slate-800 text-cyan-400' : 'text-slate-500'
              }`}
            >
              <Grid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded-lg transition cursor-pointer ${
                viewMode === 'list' ? 'bg-slate-800 text-cyan-400' : 'text-slate-500'
              }`}
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Project Cards Grid View (Exact Estage Screenshot Layout) */}
        {loading ? (
          <div className="h-64 flex flex-col items-center justify-center space-y-3 text-slate-400 font-mono text-xs">
            <RefreshCw className="w-8 h-8 animate-spin text-cyan-400" />
            <p>Loading projects for {server?.name || 'server'}...</p>
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="bg-slate-950 border border-slate-800 rounded-3xl p-12 text-center space-y-3 font-mono text-xs text-slate-500">
            <Layers className="w-10 h-10 text-slate-700 mx-auto" />
            <p>No projects matched your query.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredProjects.map((proj, idx) => (
              <div
                key={proj.id || idx}
                className="bg-slate-950 border border-slate-800/80 hover:border-cyan-500/70 rounded-3xl overflow-hidden flex flex-col justify-between transition-all duration-300 group shadow-xl hover:shadow-cyan-950/30"
              >
                {/* Top Live Screenshot / Preview Card Header */}
                <div
                  className={`h-44 bg-gradient-to-br ${getThumbnailStyle(idx)} border-b border-slate-800/80 p-4 relative flex flex-col justify-between group-hover:opacity-95 transition`}
                >
                  {/* Browser Mac Dots */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80"></span>
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80"></span>
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80"></span>
                    </div>
                    <span className="text-[10px] font-mono text-slate-500 truncate max-w-[140px]">
                      {proj.domain || proj.repoName || 'app.site.com'}
                    </span>
                  </div>

                  {/* Thumbnail Hero Placeholder / Website Branding Preview */}
                  <div className="text-center space-y-1 my-auto">
                    <h5 className="font-black text-white text-base tracking-tight truncate px-2">
                      {proj.name}
                    </h5>
                    <p className="text-[11px] text-cyan-300 font-mono truncate px-4">
                      {proj.type || 'Web App'} • PM2 Active
                    </p>
                  </div>

                  {/* Open Studio Overlay Button on Hover */}
                  <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-all duration-200 flex items-center justify-center p-4">
                    <button
                      onClick={() => onOpenProjectStudio(proj)}
                      className="px-5 py-2.5 bg-gradient-to-r from-cyan-500 via-indigo-600 to-purple-600 text-white font-extrabold rounded-2xl font-mono text-xs shadow-xl flex items-center space-x-2 transition transform hover:scale-105 cursor-pointer"
                    >
                      <Sparkles className="w-4 h-4 text-white" />
                      <span>Open Project Studio</span>
                    </button>
                  </div>
                </div>

                {/* Card Bottom Metadata & Status Pills */}
                <div className="p-4 space-y-3 font-mono">
                  <div className="flex items-center justify-between">
                    <h4 className="font-extrabold text-white text-sm truncate flex items-center gap-2">
                      <span>{proj.name}</span>
                    </h4>
                    <div className="flex items-center space-x-1.5">
                      <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase bg-slate-900 text-slate-400 border border-slate-800">
                        SHARED
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase border flex items-center gap-1 ${
                        proj.status === 'active'
                          ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                          : 'bg-cyan-950 text-cyan-300 border-cyan-800'
                      }`}>
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                        {proj.status === 'active' ? 'LIVE' : 'IN PROGRESS'}
                      </span>
                    </div>
                  </div>

                  <div className="text-[11px] text-slate-500 flex items-center justify-between border-t border-slate-900 pt-2">
                    <span className="truncate max-w-[180px]">{proj.domain || proj.path}</span>
                    <span className="text-slate-600 text-[10px]">Updated Today</span>
                  </div>

                  {/* Direct Action Button */}
                  <button
                    onClick={() => onOpenProjectStudio(proj)}
                    className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-800 hover:border-cyan-500/50 rounded-xl font-extrabold text-xs flex items-center justify-center space-x-1.5 transition cursor-pointer"
                  >
                    <Code className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Open Dedicated Project Studio</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

      </main>
    </div>
  )
}
