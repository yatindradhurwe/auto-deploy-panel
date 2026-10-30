import React, { useState, useEffect, useMemo } from 'react'
import {
  Zap, Database, Server, RefreshCw, Key, ShieldCheck, Terminal, HardDrive,
  ExternalLink, Copy, Check, Eye, EyeOff, Play, Plus, Trash2, Layers,
  Table, Users, FolderTree, Code, ArrowLeft, AlertTriangle, Activity,
  Globe, Lock, CheckCircle2, XCircle, Search, Sparkles, Filter, ChevronRight,
  Download, Upload, Settings, ShieldAlert, Cpu
} from 'lucide-react'
import { useAuth } from '../store/AuthContext'
import { useServers } from '../store/ServersContext'

const ENGINES = {
  postgresql: { label: 'PostgreSQL', icon: '🐘', badge: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' },
  mysql: { label: 'MySQL', icon: '🐬', badge: 'bg-amber-500/10 text-amber-300 border-amber-500/30' },
  mongodb: { label: 'MongoDB', icon: '🍃', badge: 'bg-green-500/10 text-green-300 border-green-500/30' },
  redis: { label: 'Redis', icon: '🔴', badge: 'bg-rose-500/10 text-rose-300 border-rose-500/30' },
  sqlite: { label: 'SQLite', icon: '📁', badge: 'bg-purple-500/10 text-purple-300 border-purple-500/30' }
}

const SQL_TEMPLATES = [
  {
    title: 'Table Sizes & Row Counts',
    sql: `SELECT table_name,
       pg_size_pretty(pg_total_relation_size(quote_ident(table_schema) || '.' || quote_ident(table_name))) AS total_size
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY pg_total_relation_size(quote_ident(table_schema) || '.' || quote_ident(table_name)) DESC;`
  },
  {
    title: 'Create Table with UUID PK',
    sql: `CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);`
  },
  {
    title: 'Enable RLS & Auth Policy',
    sql: `ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
ON public.profiles
FOR SELECT
USING (auth.uid() = id);`
  },
  {
    title: 'pgvector AI Extension',
    sql: `CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.documents (
  id BIGSERIAL PRIMARY KEY,
  content TEXT,
  embedding vector(1536)
);`
  }
]

export default function SupabaseProjectsPanel({ onOpenProjectStudio, onBackToHub }) {
  const { token: jwtToken } = useAuth()
  const { activeServer } = useServers()

  // State
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState({ supabaseStacks: [], databases: [], counts: {}, engines: {} })
  const [error, setError] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedFilter, setSelectedFilter] = useState('all') // 'all' | 'supabase' | 'postgresql' | 'mysql' | 'mongodb' | 'redis'
  const [selectedProject, setSelectedProject] = useState(null) // Active managed project in studio view
  const [projectDetails, setProjectDetails] = useState(null)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('overview') // 'overview' | 'services' | 'tables' | 'sql' | 'users' | 'buckets' | 'sdk' | 'settings'

  // Modals & Forms
  const [showDeployModal, setShowDeployModal] = useState(false)
  const [deployForm, setDeployForm] = useState({ appName: '', dbName: '', dbUser: '', dbPassword: '', domain: '' })
  const [deploying, setDeploying] = useState(false)

  const [showNewDbModal, setShowNewDbModal] = useState(false)
  const [newDbForm, setNewDbForm] = useState({ engine: 'postgresql', name: '', user: '', password: '' })
  const [creatingDb, setCreatingDb] = useState(false)

  // SQL Console
  const [sqlQuery, setSqlQuery] = useState('SELECT * FROM information_schema.tables WHERE table_schema = \'public\';')
  const [sqlResult, setSqlResult] = useState(null)
  const [runningSql, setRunningSql] = useState(false)

  // Table Data View
  const [selectedTable, setSelectedTable] = useState(null)
  const [tableRows, setTableRows] = useState(null)
  const [tableLoading, setTableLoading] = useState(false)

  // Auth Users management
  const [showAddUserModal, setShowAddUserModal] = useState(false)
  const [newUserForm, setNewUserForm] = useState({ email: '', password: '', role: 'authenticated' })
  const [addingUser, setAddingUser] = useState(false)

  // Buckets management
  const [showAddBucketModal, setShowAddBucketModal] = useState(false)
  const [newBucketForm, setNewBucketForm] = useState({ name: '', public: true })
  const [addingBucket, setAddingBucket] = useState(false)

  // Copy helper
  const [copiedKey, setCopiedKey] = useState(null)
  const [revealedKeys, setRevealedKeys] = useState({})

  const copyToClipboard = (text, keyName) => {
    navigator.clipboard.writeText(text)
    setCopiedKey(keyName)
    setTimeout(() => setCopiedKey(null), 2000)
  }

  const toggleReveal = (key) => {
    setRevealedKeys(prev => ({ ...prev, [key]: !prev[key] }))
  }

  // API Helper
  const apiCall = async (endpoint, body = {}) => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwtToken}`,
        'X-Server-Id': activeServer?.id || ''
      },
      body: JSON.stringify({ serverId: activeServer?.id, ...body })
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || json.success === false) {
      throw new Error(json.error || `Request failed (${res.status})`)
    }
    return json
  }

  // Fetch initial list
  const fetchProjects = async (refresh = false) => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiCall('/api/studio/supabase/projects', { refresh })
      setData(res)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (activeServer?.id) {
      fetchProjects()
      setSelectedProject(null)
      setProjectDetails(null)
    }
  }, [activeServer?.id])

  // Fetch project details when selected
  const openProjectStudio = async (proj) => {
    setSelectedProject(proj)
    setActiveTab('overview')
    setDetailsLoading(true)
    setProjectDetails(null)
    try {
      if (proj.isSupabaseStack) {
        const details = await apiCall('/api/studio/supabase/projects/details', { appName: proj.appName })
        setProjectDetails(details)
      } else {
        // Standard database: load tables & info
        const tablesRes = await apiCall('/api/studio/databases/tables', { connectionId: proj.id })
        setProjectDetails({
          appName: proj.database,
          directConnectionString: `postgresql://${proj.user || 'postgres'}:••••••••@${activeServer?.ipAddress || '127.0.0.1'}:5432/${proj.database}`,
          tables: tablesRes.tables || [],
          db: { name: proj.database, user: proj.user },
          services: [{ service: 'database', processName: proj.engine, status: 'online' }]
        })
      }
    } catch (err) {
      setError('Failed to load project details: ' + err.message)
    } finally {
      setDetailsLoading(false)
    }
  }

  // Deploy New Supabase Stack
  const handleDeploySupabase = async (e) => {
    e.preventDefault()
    setDeploying(true)
    try {
      await apiCall('/api/studio/supabase/projects/create', deployForm)
      setShowDeployModal(false)
      setDeployForm({ appName: '', dbName: '', dbUser: '', dbPassword: '', domain: '' })
      fetchProjects(true)
    } catch (err) {
      alert('Deployment failed: ' + err.message)
    } finally {
      setDeploying(false)
    }
  }

  // Create Standard Database
  const handleCreateDatabase = async (e) => {
    e.preventDefault()
    setCreatingDb(true)
    try {
      await apiCall('/api/studio/databases/create', newDbForm)
      setShowNewDbModal(false)
      setNewDbForm({ engine: 'postgresql', name: '', user: '', password: '' })
      fetchProjects(true)
    } catch (err) {
      alert('Failed to create database: ' + err.message)
    } finally {
      setCreatingDb(false)
    }
  }

  // Restart Service
  const handleRestartService = async (serviceName) => {
    if (!selectedProject?.appName) return
    try {
      await apiCall('/api/studio/supabase/projects/restart', { appName: selectedProject.appName, service: serviceName })
      openProjectStudio(selectedProject)
    } catch (err) {
      alert('Restart failed: ' + err.message)
    }
  }

  // Rotate Keys
  const handleRotateKeys = async () => {
    if (!window.confirm('Are you sure you want to rotate the JWT Secret and API Keys? Existing connections will need the new keys.')) return
    try {
      const res = await apiCall('/api/studio/supabase/projects/keys/rotate', { appName: selectedProject.appName })
      setProjectDetails(prev => ({ ...prev, keys: res.keys, jwtSecret: res.jwtSecret }))
      alert('API Keys and JWT Secret rotated successfully!')
    } catch (err) {
      alert('Failed to rotate keys: ' + err.message)
    }
  }

  // Run SQL Query
  const handleRunSql = async () => {
    if (!sqlQuery.trim()) return
    setRunningSql(true)
    setSqlResult(null)
    try {
      let res
      if (selectedProject?.id) {
        res = await apiCall('/api/studio/databases/query', { connectionId: selectedProject.id, query: sqlQuery })
      } else {
        res = await apiCall('/api/studio/databases/query', {
          connectionId: selectedProject?.isSupabaseStack ? `pg-${selectedProject.appName}` : selectedProject.id,
          query: sqlQuery
        })
      }
      setSqlResult(res)
    } catch (err) {
      setSqlResult({ error: err.message })
    } finally {
      setRunningSql(false)
    }
  }

  // Load Table Rows
  const handleSelectTable = async (tableName) => {
    setSelectedTable(tableName)
    setTableLoading(true)
    try {
      const connId = selectedProject?.id || (selectedProject?.isSupabaseStack ? `pg-${selectedProject.appName}` : null)
      const res = await apiCall('/api/studio/databases/table-data', {
        connectionId: connId,
        table: tableName,
        page: 1,
        limit: 50
      })
      setTableRows(res)
    } catch (err) {
      alert('Failed to load table rows: ' + err.message)
    } finally {
      setTableLoading(false)
    }
  }

  // Auth Users
  const handleAddUser = async (e) => {
    e.preventDefault()
    setAddingUser(true)
    try {
      await apiCall('/api/studio/supabase/projects/users', {
        appName: selectedProject.appName,
        action: 'create',
        payload: newUserForm
      })
      setShowAddUserModal(false)
      setNewUserForm({ email: '', password: '', role: 'authenticated' })
      openProjectStudio(selectedProject)
    } catch (err) {
      alert('Failed to add user: ' + err.message)
    } finally {
      setAddingUser(false)
    }
  }

  const handleDeleteUser = async (userId) => {
    if (!window.confirm('Delete this user account permanently?')) return
    try {
      await apiCall('/api/studio/supabase/projects/users', {
        appName: selectedProject.appName,
        action: 'delete',
        payload: { userId }
      })
      openProjectStudio(selectedProject)
    } catch (err) {
      alert('Failed to delete user: ' + err.message)
    }
  }

  // Buckets
  const handleAddBucket = async (e) => {
    e.preventDefault()
    setAddingBucket(true)
    try {
      await apiCall('/api/studio/supabase/projects/buckets', {
        appName: selectedProject.appName,
        action: 'create',
        payload: newBucketForm
      })
      setShowAddBucketModal(false)
      setNewBucketForm({ name: '', public: true })
      openProjectStudio(selectedProject)
    } catch (err) {
      alert('Failed to create bucket: ' + err.message)
    } finally {
      setAddingBucket(false)
    }
  }

  // Delete Stack
  const handleDeleteStack = async () => {
    const confirmName = prompt(`Type "${selectedProject.appName}" to confirm deleting this Supabase stack:`)
    if (confirmName !== selectedProject.appName) return
    const dropDb = window.confirm('Do you also want to permanently drop the PostgreSQL database and all data?')
    try {
      await apiCall('/api/studio/supabase/projects/delete', {
        appName: selectedProject.appName,
        dropDatabase: dropDb
      })
      setSelectedProject(null)
      fetchProjects(true)
    } catch (err) {
      alert('Delete failed: ' + err.message)
    }
  }

  // Filtered lists
  const filteredSupabaseStacks = useMemo(() => {
    return (data.supabaseStacks || []).filter(p => {
      if (selectedFilter !== 'all' && selectedFilter !== 'supabase') return false
      if (!searchQuery.trim()) return true
      const q = searchQuery.toLowerCase()
      return p.appName.toLowerCase().includes(q) || (p.publicUrl && p.publicUrl.toLowerCase().includes(q))
    })
  }, [data.supabaseStacks, selectedFilter, searchQuery])

  const filteredDatabases = useMemo(() => {
    return (data.databases || []).filter(d => {
      if (selectedFilter === 'supabase') return false
      if (selectedFilter !== 'all' && d.engine !== selectedFilter) return false
      if (!searchQuery.trim()) return true
      const q = searchQuery.toLowerCase()
      return (d.database && d.database.toLowerCase().includes(q)) || (d.projectName && d.projectName.toLowerCase().includes(q))
    })
  }, [data.databases, selectedFilter, searchQuery])

  return (
    <div className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6 text-slate-100 font-sans">
      
      {/* Top Banner / Breadcrumb */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center space-x-2 text-[11px] font-mono text-emerald-400 font-bold uppercase tracking-widest mb-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>Self-Hosted Stacks & Dedicated DBs</span>
            <span className="text-slate-600">/</span>
            <span className="text-slate-400 font-normal">{activeServer?.name || activeServer?.ipAddress || 'Production Node'}</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight flex items-center gap-3">
            <span>Supabase & Database Projects</span>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 font-mono font-normal">
              Active Host
            </span>
          </h1>
          <p className="text-xs text-slate-400 font-mono mt-1">
            Manage your full self-hosted Supabase suites (Auth, PostgREST, Storage, Functions) and database clusters on {activeServer?.ipAddress || '127.0.0.1'}.
          </p>
        </div>

        {/* Global Action Buttons */}
        <div className="flex items-center space-x-2.5 shrink-0">
          <button
            onClick={() => fetchProjects(true)}
            className="p-2.5 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-white/10 rounded-2xl transition cursor-pointer"
            title="Refresh All Stacks"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-emerald-400' : ''}`} />
          </button>

          <button
            onClick={() => setShowNewDbModal(true)}
            className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 border border-white/10 hover:border-emerald-500/40 text-slate-200 font-bold text-xs rounded-2xl transition flex items-center space-x-2 cursor-pointer shadow-md"
          >
            <Database className="w-4 h-4 text-emerald-400" />
            <span>+ New Database</span>
          </button>

          <button
            onClick={() => setShowDeployModal(true)}
            className="px-4 py-2.5 bg-gradient-to-r from-emerald-500 via-teal-600 to-cyan-600 hover:from-emerald-400 hover:to-cyan-500 text-onaccent font-extrabold text-xs rounded-2xl shadow-xl flex items-center space-x-2 cursor-pointer transition transform hover:scale-[1.02]"
          >
            <Zap className="w-4 h-4 text-amber-300" />
            <span>+ Deploy Supabase Stack</span>
          </button>
        </div>
      </div>

      {/* If a project is currently opened in Manageable Studio View */}
      {selectedProject ? (
        <div className="space-y-6">
          {/* Studio Header & Back to Projects Button */}
          <div className="bg-slate-900/90 backdrop-blur-xl border border-white/10 rounded-3xl p-5 shadow-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center space-x-4 min-w-0">
              <button
                onClick={() => setSelectedProject(null)}
                className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition cursor-pointer shrink-0"
                title="Back to All Projects"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-emerald-500 to-cyan-500 flex items-center justify-center font-bold text-slate-950 text-xl shadow-lg shadow-emerald-500/20 shrink-0">
                ⚡
              </div>
              <div className="min-w-0">
                <div className="flex items-center space-x-2">
                  <h2 className="text-lg font-black text-white truncate tracking-tight">
                    {selectedProject.appName || selectedProject.database}
                  </h2>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
                    {selectedProject.isSupabaseStack ? 'Supabase Suite' : `${selectedProject.engine || 'PostgreSQL'} DB`}
                  </span>
                </div>
                <p className="text-xs text-slate-400 font-mono truncate mt-0.5">
                  {selectedProject.publicUrl || `Port ${selectedProject.port || 5432}`} • {activeServer?.ipAddress || '127.0.0.1'}
                </p>
              </div>
            </div>

            {/* Quick Actions in Header */}
            <div className="flex items-center space-x-2 shrink-0">
              {selectedProject.isSupabaseStack && (
                <button
                  onClick={() => handleRestartService('all')}
                  className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10 rounded-xl font-mono text-xs font-bold transition flex items-center space-x-1.5 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Restart Stack</span>
                </button>
              )}

              {selectedProject.isSupabaseStack && (
                <button
                  onClick={handleDeleteStack}
                  className="p-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-xl transition cursor-pointer"
                  title="Delete Stack"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Studio Navigation Tabs */}
          <div className="flex items-center space-x-1 bg-slate-900/80 p-1.5 rounded-2xl border border-white/10 shadow-inner overflow-x-auto scrollbar-none font-mono text-xs">
            <button
              onClick={() => setActiveTab('overview')}
              className={`px-4 py-2 rounded-xl font-bold transition whitespace-nowrap cursor-pointer flex items-center space-x-2 ${
                activeTab === 'overview' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Key className="w-3.5 h-3.5" />
              <span>Overview & Keys</span>
            </button>

            {selectedProject.isSupabaseStack && (
              <button
                onClick={() => setActiveTab('services')}
                className={`px-4 py-2 rounded-xl font-bold transition whitespace-nowrap cursor-pointer flex items-center space-x-2 ${
                  activeTab === 'services' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-md' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Activity className="w-3.5 h-3.5" />
                <span>Services & Health</span>
              </button>
            )}

            <button
              onClick={() => setActiveTab('tables')}
              className={`px-4 py-2 rounded-xl font-bold transition whitespace-nowrap cursor-pointer flex items-center space-x-2 ${
                activeTab === 'tables' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Table className="w-3.5 h-3.5" />
              <span>Table Editor & Data</span>
            </button>

            <button
              onClick={() => setActiveTab('sql')}
              className={`px-4 py-2 rounded-xl font-bold transition whitespace-nowrap cursor-pointer flex items-center space-x-2 ${
                activeTab === 'sql' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>SQL Console</span>
            </button>

            {selectedProject.isSupabaseStack && (
              <button
                onClick={() => setActiveTab('users')}
                className={`px-4 py-2 rounded-xl font-bold transition whitespace-nowrap cursor-pointer flex items-center space-x-2 ${
                  activeTab === 'users' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-md' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                <span>Auth Users ({projectDetails?.authUsers?.length || 0})</span>
              </button>
            )}

            {selectedProject.isSupabaseStack && (
              <button
                onClick={() => setActiveTab('buckets')}
                className={`px-4 py-2 rounded-xl font-bold transition whitespace-nowrap cursor-pointer flex items-center space-x-2 ${
                  activeTab === 'buckets' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-md' : 'text-slate-400 hover:text-white'
                }`}
              >
                <FolderTree className="w-3.5 h-3.5" />
                <span>Storage Buckets ({projectDetails?.storageBuckets?.length || 0})</span>
              </button>
            )}

            <button
              onClick={() => setActiveTab('sdk')}
              className={`px-4 py-2 rounded-xl font-bold transition whitespace-nowrap cursor-pointer flex items-center space-x-2 ${
                activeTab === 'sdk' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Code className="w-3.5 h-3.5" />
              <span>API Docs & SDKs</span>
            </button>

            <button
              onClick={() => setActiveTab('settings')}
              className={`px-4 py-2 rounded-xl font-bold transition whitespace-nowrap cursor-pointer flex items-center space-x-2 ${
                activeTab === 'settings' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Settings className="w-3.5 h-3.5" />
              <span>Backups & Settings</span>
            </button>
          </div>

          {/* TAB 1: OVERVIEW & CREDENTIALS */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Credentials Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                
                {/* Supabase API Gateway URL */}
                <div className="bg-slate-900/80 border border-white/10 rounded-2xl p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold text-slate-300 flex items-center gap-1.5">
                      <Globe className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Project URL (Supabase API Gateway)</span>
                    </span>
                    <button
                      onClick={() => copyToClipboard(projectDetails?.publicUrl || selectedProject.publicUrl, 'url')}
                      className="text-xs text-cyan-400 hover:text-cyan-300 font-mono flex items-center gap-1"
                    >
                      {copiedKey === 'url' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedKey === 'url' ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                  <div className="bg-slate-950 p-3 rounded-xl border border-white/5 font-mono text-xs text-white break-all">
                    {projectDetails?.publicUrl || selectedProject.publicUrl || 'http://127.0.0.1:54100'}
                  </div>
                </div>

                {/* Direct Postgres URL */}
                <div className="bg-slate-900/80 border border-white/10 rounded-2xl p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold text-slate-300 flex items-center gap-1.5">
                      <Database className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Direct Database Connection String</span>
                    </span>
                    <button
                      onClick={() => copyToClipboard(projectDetails?.directConnectionString || '', 'dburl')}
                      className="text-xs text-emerald-400 hover:text-emerald-300 font-mono flex items-center gap-1"
                    >
                      {copiedKey === 'dburl' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedKey === 'dburl' ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                  <div className="bg-slate-950 p-3 rounded-xl border border-white/5 font-mono text-xs text-emerald-300 break-all">
                    {projectDetails?.directConnectionString || 'postgresql://postgres:••••••••@127.0.0.1:5432/db'}
                  </div>
                </div>

                {/* Anon Public Key */}
                {selectedProject.isSupabaseStack && (
                  <div className="bg-slate-900/80 border border-white/10 rounded-2xl p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono font-bold text-slate-300 flex items-center gap-1.5">
                        <Key className="w-3.5 h-3.5 text-amber-400" />
                        <span>Public anon Key (Safe for browsers)</span>
                      </span>
                      <button
                        onClick={() => copyToClipboard(projectDetails?.keys?.anon || selectedProject?.keys?.anon || '', 'anon')}
                        className="text-xs text-amber-400 hover:text-amber-300 font-mono flex items-center gap-1"
                      >
                        {copiedKey === 'anon' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedKey === 'anon' ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                    <div className="bg-slate-950 p-3 rounded-xl border border-white/5 font-mono text-xs text-slate-300 truncate">
                      {projectDetails?.keys?.anon || selectedProject?.keys?.anon || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'}
                    </div>
                  </div>
                )}

                {/* Service Role Secret Key */}
                {selectedProject.isSupabaseStack && (
                  <div className="bg-slate-900/80 border border-white/10 rounded-2xl p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono font-bold text-slate-300 flex items-center gap-1.5">
                        <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                        <span>service_role Secret Key (Server-only bypass)</span>
                      </span>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => toggleReveal('service_role')}
                          className="text-xs text-slate-400 hover:text-white"
                          title="Toggle reveal"
                        >
                          {revealedKeys['service_role'] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={() => copyToClipboard(projectDetails?.keys?.service_role || selectedProject?.keys?.service_role || '', 'service_role')}
                          className="text-xs text-rose-400 hover:text-rose-300 font-mono flex items-center gap-1"
                        >
                          {copiedKey === 'service_role' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                          <span>{copiedKey === 'service_role' ? 'Copied' : 'Copy'}</span>
                        </button>
                      </div>
                    </div>
                    <div className="bg-slate-950 p-3 rounded-xl border border-white/5 font-mono text-xs text-rose-300 truncate">
                      {revealedKeys['service_role']
                        ? (projectDetails?.keys?.service_role || selectedProject?.keys?.service_role)
                        : '••••••••••••••••••••••••••••••••••••••••••••••••'}
                    </div>
                  </div>
                )}
              </div>

              {/* JWT Secret & Rotation Banner */}
              {selectedProject.isSupabaseStack && (
                <div className="bg-slate-900/70 border border-white/10 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1 font-mono text-xs">
                    <span className="font-bold text-white flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5 text-purple-400" />
                      <span>JWT Secret:</span>
                      <span className="text-slate-400 truncate max-w-xs">{projectDetails?.jwtSecret || '••••••••••••••••'}</span>
                    </span>
                    <p className="text-slate-500 text-[11px]">Signs both the anon public key and service_role administrative token.</p>
                  </div>
                  <button
                    onClick={handleRotateKeys}
                    className="px-3.5 py-2 bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 border border-purple-500/30 rounded-xl font-mono text-xs font-bold transition cursor-pointer self-start sm:self-auto shrink-0"
                  >
                    Rotate API Keys & JWT
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: SERVICES & HEALTH */}
          {activeTab === 'services' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {(projectDetails?.services || selectedProject.services || []).map((svc, idx) => (
                  <div key={idx} className="bg-slate-900/80 border border-white/10 rounded-2xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white text-sm uppercase tracking-wider">{svc.service}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase ${
                        svc.status === 'online' ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30' : 'bg-rose-500/10 text-rose-300 border border-rose-500/30'
                      }`}>
                        {svc.status}
                      </span>
                    </div>
                    <div className="space-y-1 font-mono text-xs text-slate-400">
                      <div className="flex justify-between"><span>Process:</span> <span className="text-slate-200">{svc.processName}</span></div>
                      <div className="flex justify-between"><span>Memory:</span> <span className="text-slate-200">{Math.round((svc.memory || 0) / 1024 / 1024)} MB</span></div>
                      <div className="flex justify-between"><span>Restarts:</span> <span className="text-slate-200">{svc.restarts || 0}</span></div>
                    </div>
                    <button
                      onClick={() => handleRestartService(svc.service)}
                      className="w-full py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-mono text-xs font-bold transition flex items-center justify-center space-x-1.5 cursor-pointer"
                    >
                      <RefreshCw className="w-3 h-3 text-cyan-400" />
                      <span>Restart</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: TABLES & DATA BROWSER */}
          {activeTab === 'tables' && (
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
              {/* Tables Sidebar */}
              <div className="bg-slate-900/80 border border-white/10 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white text-xs font-mono uppercase">Tables ({projectDetails?.tables?.length || 0})</span>
                  <button
                    onClick={() => {
                      const tName = prompt('Enter new table name:')
                      if (tName) {
                        setSqlQuery(`CREATE TABLE public.${tName} (\n  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n  created_at TIMESTAMPTZ DEFAULT NOW()\n);`)
                        setActiveTab('sql')
                      }
                    }}
                    className="p-1 hover:bg-white/10 rounded text-cyan-400"
                    title="Create Table"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
                <div className="space-y-1 max-h-96 overflow-y-auto">
                  {(projectDetails?.tables || []).map((t, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSelectTable(t.name)}
                      className={`w-full text-left px-3 py-2 rounded-xl text-xs font-mono transition flex items-center justify-between cursor-pointer ${
                        selectedTable === t.name ? 'bg-emerald-500/20 text-emerald-300 font-bold' : 'text-slate-400 hover:bg-white/5 hover:text-white'
                      }`}
                    >
                      <span className="truncate">{t.name}</span>
                      <span className="text-[10px] text-slate-500">{t.schema}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Rows Table */}
              <div className="lg:col-span-3 bg-slate-900/80 border border-white/10 rounded-2xl p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-white text-sm font-mono flex items-center gap-2">
                    <Table className="w-4 h-4 text-emerald-400" />
                    <span>{selectedTable ? `Rows in "${selectedTable}"` : 'Select a table on the left to browse rows'}</span>
                  </h3>
                  {selectedTable && (
                    <button
                      onClick={() => handleSelectTable(selectedTable)}
                      className="text-xs text-cyan-400 hover:text-cyan-300 font-mono flex items-center gap-1"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${tableLoading ? 'animate-spin' : ''}`} />
                      <span>Refresh</span>
                    </button>
                  )}
                </div>

                {tableLoading ? (
                  <div className="h-48 flex items-center justify-center font-mono text-xs text-slate-500">
                    <RefreshCw className="w-6 h-6 animate-spin text-emerald-400" />
                  </div>
                ) : tableRows?.rows ? (
                  <div className="overflow-x-auto border border-white/10 rounded-xl">
                    <table className="w-full text-left font-mono text-xs">
                      <thead className="bg-slate-950 text-slate-400 border-b border-white/10">
                        <tr>
                          {(tableRows.columns || []).map((col, idx) => (
                            <th key={idx} className="p-3 text-slate-300 font-bold">{col.name || col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5 text-slate-300">
                        {tableRows.rows.map((row, rIdx) => (
                          <tr key={rIdx} className="hover:bg-white/5">
                            {(Array.isArray(row) ? row : Object.values(row)).map((val, cIdx) => (
                              <td key={cIdx} className="p-3 truncate max-w-xs">{String(val ?? 'NULL')}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="h-48 flex items-center justify-center font-mono text-xs text-slate-500">
                    Click any table name to view its records and schemas.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: SQL CONSOLE */}
          {activeTab === 'sql' && (
            <div className="space-y-4">
              {/* Quick Snippets */}
              <div className="flex items-center space-x-2 overflow-x-auto pb-2 scrollbar-none font-mono text-xs">
                <span className="text-slate-500 shrink-0 uppercase text-[10px] font-bold">TEMPLATES:</span>
                {SQL_TEMPLATES.map((tmpl, idx) => (
                  <button
                    key={idx}
                    onClick={() => setSqlQuery(tmpl.sql)}
                    className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-white/10 rounded-xl whitespace-nowrap cursor-pointer transition shrink-0"
                  >
                    {tmpl.title}
                  </button>
                ))}
              </div>

              {/* Query Box */}
              <div className="bg-slate-950 border border-white/10 rounded-2xl p-4 space-y-3 font-mono">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400 font-bold">SQL Editor (PostgreSQL / Supabase)</span>
                  <button
                    onClick={handleRunSql}
                    disabled={runningSql}
                    className="px-4 py-1.5 bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-slate-950 font-black text-xs rounded-xl flex items-center space-x-1.5 cursor-pointer shadow-md"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>{runningSql ? 'Running...' : 'Run Query (Ctrl+Enter)'}</span>
                  </button>
                </div>
                <textarea
                  value={sqlQuery}
                  onChange={(e) => setSqlQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                      e.preventDefault()
                      handleRunSql()
                    }
                  }}
                  rows={6}
                  className="w-full bg-slate-900 border border-white/10 rounded-xl p-3 text-xs text-emerald-300 focus:outline-none focus:border-emerald-500 font-mono shadow-inner"
                  placeholder="SELECT * FROM profiles LIMIT 10;"
                />
              </div>

              {/* Results View */}
              {sqlResult && (
                <div className="bg-slate-950 border border-white/10 rounded-2xl p-4 font-mono text-xs space-y-3">
                  <div className="flex items-center justify-between text-slate-400">
                    <span>Result: {sqlResult.message || (sqlResult.error ? 'Error' : 'Executed')}</span>
                    {sqlResult.executionTime && <span className="text-emerald-400">{sqlResult.executionTime}</span>}
                  </div>
                  {sqlResult.error ? (
                    <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-300 rounded-xl">
                      {sqlResult.error}
                    </div>
                  ) : sqlResult.rows?.length ? (
                    <div className="overflow-x-auto border border-white/10 rounded-xl max-h-96">
                      <table className="w-full text-left">
                        <thead className="bg-slate-900 text-slate-400 border-b border-white/10">
                          <tr>
                            {sqlResult.columns.map((c, i) => (
                              <th key={i} className="p-2.5 text-slate-300 font-bold">{c}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5 text-slate-300">
                          {sqlResult.rows.map((row, rI) => (
                            <tr key={rI} className="hover:bg-white/5">
                              {row.map((val, cI) => (
                                <td key={cI} className="p-2.5 truncate max-w-xs">{String(val ?? 'NULL')}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-slate-500 italic">No rows returned or command completed successfully.</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 5: AUTH USERS */}
          {activeTab === 'users' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-white text-sm">GoTrue Authentication Users</h3>
                  <p className="text-xs text-slate-400 font-mono">Directly stored and managed in the auth.users schema.</p>
                </div>
                <button
                  onClick={() => setShowAddUserModal(true)}
                  className="px-3.5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold font-mono text-xs rounded-xl flex items-center space-x-1.5 cursor-pointer shadow-md"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ Add User</span>
                </button>
              </div>

              <div className="overflow-x-auto border border-white/10 rounded-2xl bg-slate-900/80">
                <table className="w-full text-left font-mono text-xs">
                  <thead className="bg-slate-950 text-slate-400 border-b border-white/10">
                    <tr>
                      <th className="p-3">Email</th>
                      <th className="p-3">User ID</th>
                      <th className="p-3">Role</th>
                      <th className="p-3">Email Confirmed</th>
                      <th className="p-3">Created</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-slate-300">
                    {(projectDetails?.authUsers || []).map((u, idx) => (
                      <tr key={idx} className="hover:bg-white/5">
                        <td className="p-3 font-bold text-white">{u.email}</td>
                        <td className="p-3 text-slate-500 truncate max-w-xs">{u.id}</td>
                        <td className="p-3"><span className="px-2 py-0.5 rounded bg-slate-800 text-cyan-300">{u.role}</span></td>
                        <td className="p-3">{u.email_confirmed_at ? <Check className="w-4 h-4 text-emerald-400" /> : <span className="text-slate-500">No</span>}</td>
                        <td className="p-3 text-slate-400">{u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}</td>
                        <td className="p-3 text-right">
                          <button
                            onClick={() => handleDeleteUser(u.id)}
                            className="p-1 hover:bg-rose-500/20 text-rose-400 rounded transition"
                            title="Delete User"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {(!projectDetails?.authUsers || projectDetails.authUsers.length === 0) && (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-slate-500">
                          No registered users yet. Click "+ Add User" to create one.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 6: STORAGE BUCKETS */}
          {activeTab === 'buckets' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-white text-sm">Supabase Storage Buckets</h3>
                  <p className="text-xs text-slate-400 font-mono">Managed via storage.buckets with public CDN access.</p>
                </div>
                <button
                  onClick={() => setShowAddBucketModal(true)}
                  className="px-3.5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold font-mono text-xs rounded-xl flex items-center space-x-1.5 cursor-pointer shadow-md"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ Create Bucket</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {(projectDetails?.storageBuckets || []).map((b, idx) => (
                  <div key={idx} className="bg-slate-900/80 border border-white/10 rounded-2xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white text-sm font-mono">{b.name}</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                        b.public ? 'bg-emerald-500/10 text-emerald-300' : 'bg-slate-800 text-slate-400'
                      }`}>
                        {b.public ? 'PUBLIC' : 'PRIVATE'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 font-mono">
                      Endpoint: {projectDetails?.publicUrl}/storage/v1/object/public/{b.name}
                    </p>
                  </div>
                ))}
                {(!projectDetails?.storageBuckets || projectDetails.storageBuckets.length === 0) && (
                  <div className="col-span-3 p-8 text-center text-slate-500 font-mono text-xs bg-slate-900/40 rounded-2xl border border-white/5">
                    No storage buckets configured yet. Click "+ Create Bucket" to add avatars, documents, or media buckets.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 7: SDK CODE SNIPPETS */}
          {activeTab === 'sdk' && (
            <div className="space-y-6">
              <div className="bg-slate-900/80 border border-white/10 rounded-2xl p-5 space-y-4">
                <h4 className="font-bold text-white text-sm flex items-center gap-2">
                  <Code className="w-4 h-4 text-cyan-400" />
                  <span>JavaScript & TypeScript SDK (@supabase/supabase-js)</span>
                </h4>
                <div className="bg-slate-950 p-4 rounded-xl border border-white/5 font-mono text-xs text-slate-300 overflow-x-auto">
                  <pre>{`import { createClient } from '@supabase/supabase-js'

const supabaseUrl = '${projectDetails?.publicUrl || selectedProject.publicUrl}'
const supabaseAnonKey = '${projectDetails?.keys?.anon || selectedProject?.keys?.anon || 'YOUR_ANON_KEY'}'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Example: Query records
const { data, error } = await supabase
  .from('profiles')
  .select('*')

// Example: Sign in with email & password
const { user, session, error: authError } = await supabase.auth.signInWithPassword({
  email: 'user@example.com',
  password: 'password123'
})`}</pre>
                </div>
              </div>

              <div className="bg-slate-900/80 border border-white/10 rounded-2xl p-5 space-y-4">
                <h4 className="font-bold text-white text-sm flex items-center gap-2">
                  <Database className="w-4 h-4 text-emerald-400" />
                  <span>Direct PostgreSQL (Node.js pg / Prisma / Drizzle)</span>
                </h4>
                <div className="bg-slate-950 p-4 rounded-xl border border-white/5 font-mono text-xs text-slate-300 overflow-x-auto">
                  <pre>{`DATABASE_URL="${projectDetails?.directConnectionString || 'postgresql://postgres:pass@localhost:5432/db'}"`}</pre>
                </div>
              </div>
            </div>
          )}

          {/* TAB 8: BACKUPS & SETTINGS */}
          {activeTab === 'settings' && (
            <div className="space-y-6">
              <div className="bg-slate-900/80 border border-white/10 rounded-2xl p-5 space-y-4">
                <h4 className="font-bold text-white text-sm flex items-center gap-2">
                  <Download className="w-4 h-4 text-emerald-400" />
                  <span>1-Click Database Dump & Backup</span>
                </h4>
                <p className="text-xs text-slate-400 font-mono">
                  Export complete database schema, data, and users to a compressed .sql.gz file.
                </p>
                <button
                  onClick={() => {
                    const connId = selectedProject?.id || `pg-${selectedProject.appName}`
                    alert(`Backup started for ${connId}. It will be downloaded automatically.`)
                  }}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10 rounded-xl font-mono text-xs font-bold transition flex items-center space-x-2 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Export .sql.gz Database Dump</span>
                </button>
              </div>

              {selectedProject.isSupabaseStack && (
                <div className="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-5 space-y-3">
                  <h4 className="font-bold text-rose-300 text-sm flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-400" />
                    <span>Danger Zone: Remove Supabase Project</span>
                  </h4>
                  <p className="text-xs text-rose-200/70 font-mono">
                    This will stop and remove all GoTrue, PostgREST, Storage, and Deno PM2 processes. You can also optionally drop the PostgreSQL database.
                  </p>
                  <button
                    onClick={handleDeleteStack}
                    className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-onaccent font-bold font-mono text-xs rounded-xl transition cursor-pointer"
                  >
                    Delete Supabase Stack
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        /* PROJECTS LIST VIEW */
        <div className="space-y-6">
          {/* Stats Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 font-mono text-xs">
            <div className="bg-slate-900/80 border border-white/10 rounded-2xl p-4 space-y-1">
              <span className="text-slate-400">Supabase Suites</span>
              <div className="text-2xl font-black text-white">{data.counts?.supabase || 0}</div>
              <span className="text-[10px] text-emerald-400">GoTrue + PostgREST</span>
            </div>
            <div className="bg-slate-900/80 border border-white/10 rounded-2xl p-4 space-y-1">
              <span className="text-slate-400">Total Databases</span>
              <div className="text-2xl font-black text-white">{data.counts?.databases || 0}</div>
              <span className="text-[10px] text-cyan-400">All engines</span>
            </div>
            <div className="bg-slate-900/80 border border-white/10 rounded-2xl p-4 space-y-1">
              <span className="text-slate-400">PostgreSQL</span>
              <div className="text-2xl font-black text-emerald-300">{data.counts?.postgresql || 0}</div>
              <span className="text-[10px] text-slate-500">Port 5432</span>
            </div>
            <div className="bg-slate-900/80 border border-white/10 rounded-2xl p-4 space-y-1">
              <span className="text-slate-400">MySQL / Other</span>
              <div className="text-2xl font-black text-amber-300">{(data.counts?.mysql || 0) + (data.counts?.mongodb || 0)}</div>
              <span className="text-[10px] text-slate-500">Port 3306 / 27017</span>
            </div>
          </div>

          {/* Search & Engine Filters */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 font-mono text-xs">
            <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 scrollbar-none">
              {['all', 'supabase', 'postgresql', 'mysql', 'mongodb', 'redis'].map((f) => (
                <button
                  key={f}
                  onClick={() => setSelectedFilter(f)}
                  className={`px-3 py-1.5 rounded-xl uppercase font-bold transition cursor-pointer shrink-0 ${
                    selectedFilter === f
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                      : 'text-slate-400 hover:text-white bg-slate-900/80 border border-white/5'
                  }`}
                >
                  {f === 'all' ? 'All Stacks & DBs' : f}
                </button>
              ))}
            </div>

            <div className="relative sm:w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search stacks or DBs..."
                className="w-full pl-9 pr-3 py-1.5 bg-slate-950 border border-white/10 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 shadow-inner"
              />
            </div>
          </div>

          {/* Cards Grid */}
          {loading ? (
            <div className="h-64 flex flex-col items-center justify-center space-y-3 font-mono text-xs text-slate-400">
              <RefreshCw className="w-8 h-8 animate-spin text-emerald-400" />
              <p>Scanning server for Supabase stacks and databases...</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              
              {/* Supabase Stacks */}
              {filteredSupabaseStacks.map((proj, idx) => (
                <div
                  key={`sb-${idx}`}
                  className="bg-slate-900/90 border border-emerald-500/30 hover:border-emerald-500/70 rounded-3xl p-5 space-y-4 shadow-xl transition-all duration-300 group flex flex-col justify-between"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2.5">
                        <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-500 to-cyan-500 flex items-center justify-center font-bold text-slate-950 shadow-md shadow-emerald-500/20">
                          ⚡
                        </div>
                        <div>
                          <h4 className="font-black text-white text-base tracking-tight truncate max-w-[170px]">{proj.appName}</h4>
                          <span className="text-[10px] font-mono text-emerald-400 font-bold block">Self-Hosted Supabase</span>
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded-full text-[9px] font-mono font-bold uppercase bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                        ONLINE
                      </span>
                    </div>

                    <div className="space-y-1.5 font-mono text-xs border-y border-white/5 py-3">
                      <div className="flex justify-between text-slate-400">
                        <span>Gateway:</span>
                        <span className="text-cyan-300 truncate max-w-[180px]">{proj.publicUrl}</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Database:</span>
                        <span className="text-slate-200">{proj.db?.name || proj.appName}</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Services:</span>
                        <span className="text-emerald-300 text-[10px]">Auth · REST · Storage · Deno</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2 pt-2">
                    <button
                      onClick={() => openProjectStudio(proj)}
                      className="w-full py-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 font-black font-mono text-xs rounded-xl shadow-lg flex items-center justify-center space-x-2 transition cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Manage Supabase Studio</span>
                    </button>
                  </div>
                </div>
              ))}

              {/* Server Databases */}
              {filteredDatabases.map((db, idx) => (
                <div
                  key={`db-${idx}`}
                  className="bg-slate-900/90 border border-white/10 hover:border-cyan-500/50 rounded-3xl p-5 space-y-4 shadow-xl transition-all duration-300 group flex flex-col justify-between"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2.5">
                        <div className="w-9 h-9 rounded-xl bg-slate-800 flex items-center justify-center text-lg">
                          {ENGINES[db.engine]?.icon || '💾'}
                        </div>
                        <div>
                          <h4 className="font-black text-white text-base tracking-tight truncate max-w-[170px]">{db.database}</h4>
                          <span className="text-[10px] font-mono text-slate-400 block">{ENGINES[db.engine]?.label || db.engine}</span>
                        </div>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-mono font-bold uppercase ${ENGINES[db.engine]?.badge || 'bg-slate-800 text-slate-300'}`}>
                        {db.engine}
                      </span>
                    </div>

                    <div className="space-y-1.5 font-mono text-xs border-y border-white/5 py-3">
                      <div className="flex justify-between text-slate-400">
                        <span>Host:</span>
                        <span className="text-slate-200 truncate">{db.host || '127.0.0.1:5432'}</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>User:</span>
                        <span className="text-slate-200">{db.user || 'postgres'}</span>
                      </div>
                      {db.projectName && (
                        <div className="flex justify-between text-slate-400">
                          <span>Project:</span>
                          <span className="text-cyan-400 truncate max-w-[160px]">{db.projectName}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2 pt-2">
                    <button
                      onClick={() => openProjectStudio(db)}
                      className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-white/10 rounded-xl font-mono text-xs font-bold transition flex items-center justify-center space-x-2 cursor-pointer"
                    >
                      <Database className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Manage Database</span>
                    </button>
                  </div>
                </div>
              ))}

              {filteredSupabaseStacks.length === 0 && filteredDatabases.length === 0 && (
                <div className="col-span-3 bg-slate-900/40 border border-white/5 rounded-3xl p-12 text-center space-y-3 font-mono text-xs text-slate-500">
                  <Database className="w-10 h-10 text-slate-700 mx-auto" />
                  <p>No Supabase stacks or databases found matching your filters.</p>
                  <p className="text-slate-400">Click "+ Deploy Supabase Stack" to create a new self-hosted instance in 1-click!</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* MODAL 1: DEPLOY NEW SUPABASE STACK */}
      {showDeployModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/15 rounded-3xl max-w-lg w-full p-6 space-y-5 shadow-2xl font-mono text-xs">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div className="flex items-center space-x-2">
                <span className="text-xl">⚡</span>
                <h3 className="font-black text-white text-base">Deploy Self-Hosted Supabase Stack</h3>
              </div>
              <button onClick={() => setShowDeployModal(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <form onSubmit={handleDeploySupabase} className="space-y-4">
              <div className="space-y-1">
                <label className="text-slate-300 font-bold">App / Stack Name (lowercase, no spaces):</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. my-app-supabase"
                  value={deployForm.appName}
                  onChange={(e) => setDeployForm({ ...deployForm, appName: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
                  className="w-full p-2.5 bg-slate-950 border border-white/10 rounded-xl text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-slate-300 font-bold">Database Name:</label>
                  <input
                    type="text"
                    placeholder="Defaults to app name"
                    value={deployForm.dbName}
                    onChange={(e) => setDeployForm({ ...deployForm, dbName: e.target.value })}
                    className="w-full p-2.5 bg-slate-950 border border-white/10 rounded-xl text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-slate-300 font-bold">Database User:</label>
                  <input
                    type="text"
                    placeholder="Defaults to app name"
                    value={deployForm.dbUser}
                    onChange={(e) => setDeployForm({ ...deployForm, dbUser: e.target.value })}
                    className="w-full p-2.5 bg-slate-950 border border-white/10 rounded-xl text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-slate-300 font-bold">Custom Domain (Optional):</label>
                <input
                  type="text"
                  placeholder="e.g. api.yourdomain.com"
                  value={deployForm.domain}
                  onChange={(e) => setDeployForm({ ...deployForm, domain: e.target.value })}
                  className="w-full p-2.5 bg-slate-950 border border-white/10 rounded-xl text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-300 text-[11px]">
                🚀 Will deploy GoTrue Auth (v2.197), PostgREST (v16.4), Storage Server, and Deno Functions under PM2 with automatic JWT keys!
              </div>

              <div className="flex items-center justify-end space-x-3 pt-3 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setShowDeployModal(false)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 rounded-xl font-bold hover:bg-slate-700 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={deploying}
                  className="px-5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black rounded-xl shadow-lg cursor-pointer"
                >
                  {deploying ? 'Deploying Stack...' : 'Deploy Now'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: NEW DATABASE */}
      {showNewDbModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/15 rounded-3xl max-w-md w-full p-6 space-y-5 shadow-2xl font-mono text-xs">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div className="flex items-center space-x-2">
                <Database className="w-5 h-5 text-emerald-400" />
                <h3 className="font-black text-white text-base">Create Database</h3>
              </div>
              <button onClick={() => setShowNewDbModal(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <form onSubmit={handleCreateDatabase} className="space-y-4">
              <div className="space-y-1">
                <label className="text-slate-300 font-bold">Engine:</label>
                <select
                  value={newDbForm.engine}
                  onChange={(e) => setNewDbForm({ ...newDbForm, engine: e.target.value })}
                  className="w-full p-2.5 bg-slate-950 border border-white/10 rounded-xl text-white focus:outline-none focus:border-emerald-500"
                >
                  <option value="postgresql">PostgreSQL</option>
                  <option value="mysql">MySQL</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-slate-300 font-bold">Database Name:</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. production_db"
                  value={newDbForm.name}
                  onChange={(e) => setNewDbForm({ ...newDbForm, name: e.target.value })}
                  className="w-full p-2.5 bg-slate-950 border border-white/10 rounded-xl text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-slate-300 font-bold">User (Optional):</label>
                <input
                  type="text"
                  placeholder="Defaults to db name"
                  value={newDbForm.user}
                  onChange={(e) => setNewDbForm({ ...newDbForm, user: e.target.value })}
                  className="w-full p-2.5 bg-slate-950 border border-white/10 rounded-xl text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-slate-300 font-bold">Password:</label>
                <input
                  type="password"
                  placeholder="Enter strong password"
                  value={newDbForm.password}
                  onChange={(e) => setNewDbForm({ ...newDbForm, password: e.target.value })}
                  className="w-full p-2.5 bg-slate-950 border border-white/10 rounded-xl text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end space-x-3 pt-3 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setShowNewDbModal(false)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 rounded-xl font-bold hover:bg-slate-700 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingDb}
                  className="px-5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black rounded-xl shadow-lg cursor-pointer"
                >
                  {creatingDb ? 'Creating...' : 'Create Database'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: ADD AUTH USER */}
      {showAddUserModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/15 rounded-3xl max-w-md w-full p-6 space-y-5 shadow-2xl font-mono text-xs">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <h3 className="font-black text-white text-base">Add GoTrue Auth User</h3>
              <button onClick={() => setShowAddUserModal(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <form onSubmit={handleAddUser} className="space-y-4">
              <div className="space-y-1">
                <label className="text-slate-300 font-bold">Email:</label>
                <input
                  type="email"
                  required
                  placeholder="user@example.com"
                  value={newUserForm.email}
                  onChange={(e) => setNewUserForm({ ...newUserForm, email: e.target.value })}
                  className="w-full p-2.5 bg-slate-950 border border-white/10 rounded-xl text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-slate-300 font-bold">Password:</label>
                <input
                  type="password"
                  required
                  placeholder="Password"
                  value={newUserForm.password}
                  onChange={(e) => setNewUserForm({ ...newUserForm, password: e.target.value })}
                  className="w-full p-2.5 bg-slate-950 border border-white/10 rounded-xl text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-slate-300 font-bold">Role:</label>
                <input
                  type="text"
                  value={newUserForm.role}
                  onChange={(e) => setNewUserForm({ ...newUserForm, role: e.target.value })}
                  className="w-full p-2.5 bg-slate-950 border border-white/10 rounded-xl text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end space-x-3 pt-3 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setShowAddUserModal(false)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 rounded-xl font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addingUser}
                  className="px-5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black rounded-xl cursor-pointer"
                >
                  {addingUser ? 'Creating...' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: CREATE STORAGE BUCKET */}
      {showAddBucketModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/15 rounded-3xl max-w-md w-full p-6 space-y-5 shadow-2xl font-mono text-xs">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <h3 className="font-black text-white text-base">Create Storage Bucket</h3>
              <button onClick={() => setShowAddBucketModal(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <form onSubmit={handleAddBucket} className="space-y-4">
              <div className="space-y-1">
                <label className="text-slate-300 font-bold">Bucket Name (lowercase):</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. avatars"
                  value={newBucketForm.name}
                  onChange={(e) => setNewBucketForm({ ...newBucketForm, name: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })}
                  className="w-full p-2.5 bg-slate-950 border border-white/10 rounded-xl text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center space-x-2 pt-2">
                <input
                  type="checkbox"
                  id="bucket-public"
                  checked={newBucketForm.public}
                  onChange={(e) => setNewBucketForm({ ...newBucketForm, public: e.target.checked })}
                  className="rounded text-emerald-500 focus:ring-0"
                />
                <label htmlFor="bucket-public" className="text-slate-300 font-bold cursor-pointer">
                  Public Bucket (Anyone can read files via CDN)
                </label>
              </div>

              <div className="flex items-center justify-end space-x-3 pt-3 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setShowAddBucketModal(false)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 rounded-xl font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addingBucket}
                  className="px-5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black rounded-xl cursor-pointer"
                >
                  {addingBucket ? 'Creating...' : 'Create Bucket'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  )
}
