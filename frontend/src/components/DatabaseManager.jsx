import React, { useState, useEffect, useMemo } from 'react'
import {
  Database, Table, Play, RefreshCw, Search, Code, Layers, Plus, Trash2, Download, X,
  AlertTriangle, ChevronRight, ChevronDown, ChevronLeft, FolderGit2, Key
} from 'lucide-react'

const ENGINES = {
  postgresql: { label: 'PostgreSQL', icon: '🐘', badge: 'bg-blue-500/10 text-blue-300 border-blue-500/30', sample: 'SELECT * FROM {table} LIMIT 20;' },
  mysql: { label: 'MySQL', icon: '🐬', badge: 'bg-amber-500/10 text-amber-300 border-amber-500/30', sample: 'SELECT * FROM `{table}` LIMIT 20;' },
  mongodb: { label: 'MongoDB', icon: '🍃', badge: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30', sample: 'db.getCollection("{table}").find({}).limit(20)' },
  redis: { label: 'Redis', icon: '🔴', badge: 'bg-rose-500/10 text-rose-300 border-rose-500/30', sample: 'KEYS *' },
  sqlite: { label: 'SQLite', icon: '📁', badge: 'bg-purple-500/10 text-purple-300 border-purple-500/30', sample: 'SELECT * FROM "{table}" LIMIT 20;' }
}

const PAGE_SIZE = 50

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`
}

const formatCount = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString())

function cellText(v) {
  if (v === null || v === undefined) return null
  return typeof v === 'object' ? JSON.stringify(v) : String(v)
}

export default function DatabaseManager({ jwtToken, activeServer, project }) {
  const [discovery, setDiscovery] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [mobileTab, setMobileTab] = useState('explorer')
  const [sidebarSearch, setSidebarSearch] = useState('')
  const [collapsed, setCollapsed] = useState({})

  const [selectedConn, setSelectedConn] = useState(null)
  const [tables, setTables] = useState([])
  const [tablesLoading, setTablesLoading] = useState(false)
  const [selectedTable, setSelectedTable] = useState(null)

  const [activeSubTab, setActiveSubTab] = useState('data')
  const [tableData, setTableData] = useState(null)
  const [dataLoading, setDataLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [expandedCell, setExpandedCell] = useState(null)

  const [queryInput, setQueryInput] = useState('')
  const [queryResult, setQueryResult] = useState(null)
  const [executingQuery, setExecutingQuery] = useState(false)

  const [showInsertModal, setShowInsertModal] = useState(false)
  const [insertRowData, setInsertRowData] = useState({})
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newTableName, setNewTableName] = useState('')
  const [newTableCols, setNewTableCols] = useState([{ name: 'id', type: 'INTEGER', primary: true, nullable: false }])

  const getToken = () => jwtToken || localStorage.getItem('autodeploy_token') || localStorage.getItem('autodeploy_jwt_token') || ''

  const api = async (endpoint, body = {}) => {
    const res = await fetch(`/api/studio/databases${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`,
        'X-Server-Id': activeServer?.id || ''
      },
      body: JSON.stringify({ serverId: activeServer?.id, ...body })
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.success === false) throw new Error(data.error || `Request failed (${res.status})`)
    return data
  }

  const flash = (msg) => {
    setNotice(msg)
    setTimeout(() => setNotice(null), 3500)
  }

  // ---------------------------------------------------------------- discovery
  const loadDiscovery = async (refresh = false) => {
    setLoading(true)
    setError(null)
    try {
      const data = await api('', { refresh })
      setDiscovery(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setSelectedConn(null)
    setTables([])
    setSelectedTable(null)
    setTableData(null)
    loadDiscovery()
  }, [activeServer?.id])

  // Projects shown in the sidebar (scoped to one project inside the project studio)
  const groups = useMemo(() => {
    if (!discovery) return []
    let projects = discovery.projects || []
    if (project) {
      const p = (project.path || '').replace(/\/+$/, '')
      const names = [project.name, project.repoName, project.appName].filter(Boolean).map(n => n.toLowerCase())
      projects = projects.filter(x => (p && x.path === p) || names.includes(x.name.toLowerCase()) || names.includes(x.path.split('/').pop().toLowerCase()))
    }
    const list = projects
      .filter(x => x.databases.length || !project)
      .map(x => ({ key: x.path, title: x.name, subtitle: x.path, databases: x.databases }))
    if (!project && discovery.unassigned?.length) {
      list.push({ key: '__unassigned', title: 'Other databases on this server', subtitle: 'Not linked to a project', databases: discovery.unassigned })
    }
    const q = sidebarSearch.trim().toLowerCase()
    if (!q) return list
    return list
      .map(g => ({ ...g, databases: g.title.toLowerCase().includes(q) ? g.databases : g.databases.filter(d => d.database.toLowerCase().includes(q) || d.engine.includes(q)) }))
      .filter(g => g.databases.length)
  }, [discovery, project, sidebarSearch])

  const totalDatabases = useMemo(() => {
    const ids = new Set()
    groups.forEach(g => g.databases.forEach(d => ids.add(d.id)))
    return ids.size
  }, [groups])

  // Auto-select the first database when inside a project
  useEffect(() => {
    if (!selectedConn && project && groups[0]?.databases[0]) selectConnection(groups[0].databases[0])
  }, [groups])

  // ---------------------------------------------------------------- tables & data
  const selectConnection = async (conn) => {
    setSelectedConn(conn)
    setSelectedTable(null)
    setTableData(null)
    setTables([])
    setQueryResult(null)
    setQueryInput(ENGINES[conn.engine]?.sample.replace('{table}', 'table_name') || '')
    setTablesLoading(true)
    try {
      const data = await api('/tables', { connectionId: conn.id })
      setTables(data.tables || [])
      if (data.tables?.length) selectTable(data.tables[0], conn)
    } catch (e) {
      setError(`${conn.database}: ${e.message}`)
    } finally {
      setTablesLoading(false)
    }
  }

  const selectTable = (table, conn = selectedConn) => {
    setSelectedTable(table)
    setPage(1)
    setSearch('')
    setSearchInput('')
    setQueryInput(ENGINES[conn.engine]?.sample.replace('{table}', table.schema && table.schema !== 'public' ? `${table.schema}.${table.name}` : table.name) || '')
    setMobileTab('workbench')
  }

  const loadTableData = async () => {
    if (!selectedConn || !selectedTable) return
    setDataLoading(true)
    setError(null)
    try {
      const data = await api('/table-data', {
        connectionId: selectedConn.id,
        schema: selectedTable.schema,
        table: selectedTable.name,
        page,
        pageSize: PAGE_SIZE,
        search
      })
      setTableData(data)
    } catch (e) {
      setTableData(null)
      setError(e.message)
    } finally {
      setDataLoading(false)
    }
  }

  useEffect(() => { loadTableData() }, [selectedTable, page, search])

  const reloadTables = async () => {
    if (!selectedConn) return
    const data = await api('/tables', { connectionId: selectedConn.id })
    setTables(data.tables || [])
    return data.tables || []
  }

  // ---------------------------------------------------------------- actions
  const handleRunQuery = async () => {
    if (!selectedConn || !queryInput.trim()) return
    setExecutingQuery(true)
    setQueryResult(null)
    try {
      setQueryResult(await api('/query', { connectionId: selectedConn.id, query: queryInput }))
    } catch (e) {
      setQueryResult({ error: e.message })
    } finally {
      setExecutingQuery(false)
    }
  }

  const rowKey = (row) => {
    const pk = (tableData?.columns || []).filter(c => c.primary).map(c => c.name)
    if (!pk.length) return null
    if (selectedConn.engine === 'mongodb') {
      const idx = tableData.rows.indexOf(row)
      return { _id: tableData.rawDocs?.[idx]?._id }
    }
    return Object.fromEntries(pk.map(k => [k, row[k]]))
  }

  const handleDeleteRow = async (row) => {
    const where = rowKey(row)
    if (!where) return
    if (!window.confirm(`Delete this row from '${selectedTable.name}'?\n\n${JSON.stringify(where)}\n\nThis cannot be undone.`)) return
    try {
      const data = await api('/delete-row', { connectionId: selectedConn.id, schema: selectedTable.schema, table: selectedTable.name, where })
      flash(data.message)
      loadTableData()
    } catch (e) {
      setError(e.message)
    }
  }

  const handleInsertRow = async (e) => {
    e.preventDefault()
    try {
      const data = await api('/insert-row', { connectionId: selectedConn.id, schema: selectedTable.schema, table: selectedTable.name, row: insertRowData })
      flash(data.message)
      setShowInsertModal(false)
      setInsertRowData({})
      loadTableData()
    } catch (err) {
      setError(err.message)
    }
  }

  const handleCreateTable = async (e) => {
    e.preventDefault()
    try {
      const data = await api('/create-table', { connectionId: selectedConn.id, table: newTableName, columns: newTableCols })
      flash(data.message)
      setShowCreateModal(false)
      const list = await reloadTables()
      const created = list.find(t => t.name === newTableName)
      if (created) selectTable(created)
      setNewTableName('')
    } catch (err) {
      setError(err.message)
    }
  }

  const handleDropTable = async () => {
    const typed = window.prompt(`This permanently drops '${selectedTable.name}' and all of its data from ${selectedConn.database}.\n\nType the table name to confirm:`)
    if (typed !== selectedTable.name) return
    try {
      const data = await api('/drop-table', { connectionId: selectedConn.id, schema: selectedTable.schema, table: selectedTable.name })
      flash(data.message)
      setSelectedTable(null)
      setTableData(null)
      await reloadTables()
    } catch (e) {
      setError(e.message)
    }
  }

  const handleExport = () => {
    if (!tableData) return
    const blob = new Blob([JSON.stringify(tableData.rows, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${selectedConn.database}_${selectedTable.name}_page${page}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ---------------------------------------------------------------- render helpers
  const engineBadge = (engine) => {
    const e = ENGINES[engine] || { label: engine, icon: '🗄️', badge: 'bg-slate-500/10 text-slate-300 border-slate-500/30' }
    return (
      <span className={`text-[10px] px-1.5 py-0.5 rounded-md border font-mono font-bold uppercase whitespace-nowrap ${e.badge}`}>
        {e.icon} {e.label}
      </span>
    )
  }

  const totalPages = tableData?.total ? Math.max(1, Math.ceil(tableData.total / PAGE_SIZE)) : 1
  const canEditRows = selectedConn && selectedTable && selectedTable.type !== 'view' && (tableData?.columns || []).some(c => c.primary)
  const insertColumns = selectedConn?.engine === 'redis'
    ? [{ name: 'key' }, { name: 'value' }]
    : (tableData?.columns || []).filter(c => c.name !== '_id')

  return (
    <div className="space-y-6 font-sans">
      {/* Header */}
      <div className="bg-slate-900/80 backdrop-blur-2xl border border-white/10 rounded-3xl p-6 shadow-2xl shadow-slate-950/50 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center space-x-3.5">
          <div className="p-3 rounded-2xl bg-gradient-to-tr from-emerald-500/20 to-teal-600/20 text-emerald-400 border border-emerald-500/30 ring-1 ring-emerald-500/20 shadow-inner">
            <Database className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-white">
              {project ? `${project.name} Databases` : 'Project Databases'}
            </h1>
            <p className="text-xs text-slate-400 font-mono mt-0.5">
              {loading ? 'Discovering databases…' : `${totalDatabases} database${totalDatabases === 1 ? '' : 's'} found${project ? ' for this project' : ` across ${groups.filter(g => g.key !== '__unassigned' && g.databases.length).length} projects`} · live data from ${activeServer?.name || 'this server'}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {notice && (
            <div className="px-3.5 py-1.5 bg-emerald-950/90 border border-emerald-700/80 text-emerald-300 rounded-xl text-xs font-mono font-semibold">
              {notice}
            </div>
          )}
          {discovery?.engines && (
            <div className="hidden md:flex items-center gap-1.5">
              {Object.entries(discovery.engines).map(([eng, up]) => (
                <span key={eng} title={`${ENGINES[eng]?.label} ${up ? 'running' : 'not running'}`} className={`text-[10px] px-2 py-1 rounded-lg border font-mono ${up ? 'border-emerald-500/30 text-emerald-300 bg-emerald-500/5' : 'border-white/5 text-slate-600'}`}>
                  {ENGINES[eng]?.icon} {up ? 'up' : 'off'}
                </span>
              ))}
            </div>
          )}
          <button
            onClick={() => loadDiscovery(true)}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10 rounded-xl transition cursor-pointer flex items-center space-x-2 text-xs font-semibold shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-emerald-400 ${loading ? 'animate-spin' : ''}`} />
            <span>Rescan</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-3 p-3.5 bg-rose-950/60 border border-rose-700/50 rounded-2xl text-rose-200 text-xs font-mono">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-rose-400" />
          <pre className="whitespace-pre-wrap break-all flex-1">{error}</pre>
          <button onClick={() => setError(null)} className="text-rose-400 hover:text-white cursor-pointer"><X className="w-4 h-4" /></button>
        </div>
      )}

      {discovery?.remote && (
        <div className="p-4 bg-amber-950/40 border border-amber-700/40 rounded-2xl text-amber-200 text-sm">{discovery.message}</div>
      )}

      {discovery?.errors?.length > 0 && (
        <details className="p-3 bg-slate-900/60 border border-amber-700/30 rounded-2xl text-xs font-mono text-amber-200/80">
          <summary className="cursor-pointer">{discovery.errors.length} engine listing warning(s)</summary>
          {discovery.errors.map((e, i) => <div key={i} className="mt-1.5 break-all">{ENGINES[e.engine]?.label}: {e.error}</div>)}
        </details>
      )}

      {/* Mobile switcher */}
      <div className="flex lg:hidden bg-slate-900 border border-white/10 p-1 rounded-2xl font-mono text-xs">
        <button onClick={() => setMobileTab('explorer')} className={`flex-1 py-2 rounded-xl font-bold transition ${mobileTab === 'explorer' ? 'bg-cyan-600 text-white' : 'text-slate-400'}`}>
          📁 Explorer ({totalDatabases})
        </button>
        <button onClick={() => setMobileTab('workbench')} className={`flex-1 py-2 rounded-xl font-bold transition ${mobileTab === 'workbench' ? 'bg-cyan-600 text-white' : 'text-slate-400'}`}>
          ⚡ Data & Query
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
        {/* Sidebar: projects → databases → tables */}
        <div className={`bg-slate-900/60 backdrop-blur-2xl border border-white/10 rounded-3xl p-4 shadow-2xl shadow-slate-950/50 flex-col h-[700px] ${mobileTab === 'explorer' ? 'flex' : 'hidden lg:flex'}`}>
          <div className="relative mb-3">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={sidebarSearch}
              onChange={(e) => setSidebarSearch(e.target.value)}
              placeholder="Filter projects & databases…"
              className="w-full bg-slate-950 border border-white/10 rounded-xl pl-8 pr-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500/50"
            />
          </div>

          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            {loading && !discovery && (
              <div className="text-xs text-slate-500 font-mono p-3 flex items-center gap-2"><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Scanning projects…</div>
            )}
            {!loading && groups.length === 0 && (
              <div className="text-xs text-slate-500 font-mono p-3">
                {project ? 'No database configuration was found in this project (.env) and no server database matches its name.' : 'No databases found.'}
              </div>
            )}

            {groups.map(group => {
              const isCollapsed = collapsed[group.key] ?? (group.databases.length === 0 || group.key === '__unassigned')
              return (
                <div key={group.key}>
                  <button
                    onClick={() => setCollapsed(c => ({ ...c, [group.key]: !isCollapsed }))}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5 text-left cursor-pointer"
                    title={group.subtitle}
                  >
                    {isCollapsed ? <ChevronRight className="w-3.5 h-3.5 text-slate-500" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-500" />}
                    <FolderGit2 className={`w-3.5 h-3.5 ${group.key === '__unassigned' ? 'text-slate-500' : 'text-cyan-400'}`} />
                    <span className="text-xs font-bold text-slate-200 truncate flex-1">{group.title}</span>
                    <span className="text-[10px] text-slate-500 font-mono">{group.databases.length}</span>
                  </button>

                  {!isCollapsed && (
                    <div className="ml-4 mt-1 space-y-1 border-l border-white/5 pl-2">
                      {group.databases.length === 0 && <div className="text-[11px] text-slate-600 font-mono px-2 py-1">no database detected</div>}
                      {group.databases.map(db => {
                        const active = selectedConn?.id === db.id
                        return (
                          <div key={db.id}>
                            <button
                              onClick={() => selectConnection(db)}
                              className={`w-full text-left px-2 py-1.5 rounded-lg transition cursor-pointer ${active ? 'bg-emerald-500/10 border border-emerald-500/30' : 'hover:bg-white/5 border border-transparent'}`}
                            >
                              <div className="flex items-center gap-2">
                                <Database className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-emerald-400' : 'text-slate-500'}`} />
                                <span className={`text-xs font-mono truncate flex-1 ${active ? 'text-emerald-200 font-bold' : 'text-slate-300'}`}>{db.database}</span>
                              </div>
                              <div className="flex items-center gap-1.5 mt-1 ml-5">
                                {engineBadge(db.engine)}
                                <span className="text-[10px] text-slate-500 font-mono">{db.engine === 'redis' ? `${formatCount(db.keys)} keys` : formatBytes(db.bytes)}</span>
                              </div>
                            </button>

                            {active && (
                              <div className="ml-5 mt-1 space-y-0.5">
                                {tablesLoading && <div className="text-[11px] text-slate-500 font-mono px-2 py-1 flex items-center gap-1.5"><RefreshCw className="w-3 h-3 animate-spin" /> loading tables…</div>}
                                {!tablesLoading && tables.length === 0 && <div className="text-[11px] text-slate-600 font-mono px-2 py-1">no tables</div>}
                                {tables.map(t => (
                                  <button
                                    key={`${t.schema || ''}.${t.name}`}
                                    onClick={() => selectTable(t)}
                                    className={`w-full flex items-center gap-1.5 px-2 py-1 rounded-md text-left cursor-pointer ${selectedTable?.name === t.name && selectedTable?.schema === t.schema ? 'bg-cyan-500/10 text-cyan-200' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'}`}
                                  >
                                    {t.type === 'view' ? <Layers className="w-3 h-3 shrink-0" /> : <Table className="w-3 h-3 shrink-0" />}
                                    <span className="text-[11px] font-mono truncate flex-1">{t.schema && t.schema !== 'public' ? `${t.schema}.` : ''}{t.name}</span>
                                    <span className="text-[10px] text-slate-600 font-mono">{formatCount(t.rows)}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Workbench */}
        <div className={`lg:col-span-3 bg-slate-900/60 backdrop-blur-2xl border border-white/10 rounded-3xl shadow-2xl shadow-slate-950/50 flex-col h-[700px] overflow-hidden ${mobileTab === 'workbench' ? 'flex' : 'hidden lg:flex'}`}>
          {!selectedConn ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-slate-500">
              <Database className="w-10 h-10 mb-3 text-slate-600" />
              <p className="text-sm font-semibold text-slate-300">Select a database</p>
              <p className="text-xs mt-1 max-w-sm">Databases are discovered from each project's .env and from the database servers running on this host.</p>
            </div>
          ) : (
            <>
              {/* Connection bar */}
              <div className="px-5 py-3.5 border-b border-white/10 flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="flex items-center gap-2 min-w-0">
                  {engineBadge(selectedConn.engine)}
                  <span className="text-sm font-bold text-white font-mono truncate">{selectedConn.database}</span>
                  {selectedTable && <><ChevronRight className="w-3.5 h-3.5 text-slate-600" /><span className="text-sm font-mono text-cyan-300 truncate">{selectedTable.name}</span></>}
                </div>
                <div className="text-[11px] text-slate-500 font-mono flex flex-wrap gap-x-3">
                  <span>{selectedConn.host}</span>
                  {selectedConn.user && <span>user: {selectedConn.user}</span>}
                  <span>auth: {selectedConn.auth}</span>
                  {selectedConn.projects?.length > 0 && <span>used by: {selectedConn.projects.map(p => `${p.name}${p.source ? ` (${p.source})` : ''}`).join(', ')}</span>}
                </div>
              </div>

              {/* Tabs */}
              <div className="px-5 pt-3 flex items-center gap-1 border-b border-white/5 text-xs font-semibold">
                {[['data', 'Data', Table], ['structure', 'Structure', Key], ['console', 'Query Console', Code]].map(([id, label, Icon]) => (
                  <button
                    key={id}
                    onClick={() => setActiveSubTab(id)}
                    className={`px-3.5 py-2 rounded-t-xl flex items-center gap-1.5 cursor-pointer border-b-2 ${activeSubTab === id ? 'text-emerald-300 border-emerald-400 bg-emerald-500/5' : 'text-slate-400 border-transparent hover:text-slate-200'}`}
                  >
                    <Icon className="w-3.5 h-3.5" /> {label}
                  </button>
                ))}
                {['postgresql', 'mysql', 'sqlite', 'mongodb'].includes(selectedConn.engine) && (
                  <button onClick={() => setShowCreateModal(true)} className="ml-auto mb-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-white/10 text-slate-200 flex items-center gap-1.5 cursor-pointer">
                    <Plus className="w-3.5 h-3.5" /> {selectedConn.engine === 'mongodb' ? 'Collection' : 'Table'}
                  </button>
                )}
              </div>

              {/* Data tab */}
              {activeSubTab === 'data' && (
                <div className="flex-1 flex flex-col min-h-0">
                  {!selectedTable ? (
                    <div className="flex-1 flex items-center justify-center text-xs text-slate-500">{tablesLoading ? 'Loading tables…' : 'Select a table from the explorer.'}</div>
                  ) : (
                    <>
                      <div className="px-5 py-3 flex flex-wrap items-center gap-2">
                        <form
                          onSubmit={(e) => { e.preventDefault(); setPage(1); setSearch(searchInput) }}
                          className="relative flex-1 min-w-[200px]"
                        >
                          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                          <input
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            placeholder={selectedConn.engine === 'mongodb' ? 'Search text or JSON filter {"status":"active"} — Enter' : selectedConn.engine === 'redis' ? 'Key pattern, e.g. session:* — Enter' : 'Search all columns — Enter'}
                            className="w-full bg-slate-950 border border-white/10 rounded-xl pl-8 pr-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500/50"
                          />
                        </form>
                        <button onClick={loadTableData} className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-white/10 cursor-pointer" title="Reload">
                          <RefreshCw className={`w-3.5 h-3.5 text-slate-300 ${dataLoading ? 'animate-spin' : ''}`} />
                        </button>
                        {(canEditRows || selectedConn.engine === 'redis') && (
                          <button onClick={() => { setInsertRowData({}); setShowInsertModal(true) }} className="px-3 py-2 rounded-lg bg-emerald-600/80 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer">
                            <Plus className="w-3.5 h-3.5" /> Insert
                          </button>
                        )}
                        <button onClick={handleExport} className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-white/10 text-slate-200 text-xs flex items-center gap-1.5 cursor-pointer">
                          <Download className="w-3.5 h-3.5" /> JSON
                        </button>
                        {selectedConn.engine !== 'redis' && selectedTable.type !== 'view' && (
                          <button onClick={handleDropTable} className="px-3 py-2 rounded-lg bg-rose-950/60 hover:bg-rose-900/70 border border-rose-700/40 text-rose-300 text-xs flex items-center gap-1.5 cursor-pointer">
                            <Trash2 className="w-3.5 h-3.5" /> Drop
                          </button>
                        )}
                      </div>

                      <div className="flex-1 overflow-auto mx-5 border border-white/10 rounded-xl bg-slate-950/60 min-h-0">
                        {dataLoading && !tableData ? (
                          <div className="p-6 text-xs text-slate-500 font-mono flex items-center gap-2"><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Loading rows…</div>
                        ) : tableData && tableData.rows.length === 0 ? (
                          <div className="p-6 text-xs text-slate-500 font-mono">{search ? 'No rows match your search.' : 'This table is empty.'}</div>
                        ) : tableData && (
                          <table className={`w-full text-xs font-mono ${dataLoading ? 'opacity-50' : ''}`}>
                            <thead className="sticky top-0 bg-slate-900 z-10">
                              <tr>
                                {canEditRows && <th className="w-8" />}
                                {tableData.columns.map(c => (
                                  <th key={c.name} className="text-left px-3 py-2 text-slate-300 font-bold border-b border-white/10 whitespace-nowrap" title={c.type}>
                                    {c.primary && <Key className="w-3 h-3 inline mr-1 text-amber-400" />}{c.name}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {tableData.rows.map((row, i) => (
                                <tr key={i} className="border-b border-white/5 hover:bg-white/[0.03]">
                                  {canEditRows && (
                                    <td className="px-2">
                                      <button onClick={() => handleDeleteRow(row)} className="text-slate-600 hover:text-rose-400 cursor-pointer" title="Delete row">
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </td>
                                  )}
                                  {tableData.columns.map(c => {
                                    const text = cellText(row[c.name])
                                    return (
                                      <td
                                        key={c.name}
                                        onClick={() => text && text.length > 60 && setExpandedCell({ column: c.name, value: text })}
                                        className={`px-3 py-1.5 text-slate-300 max-w-[320px] truncate ${text && text.length > 60 ? 'cursor-pointer hover:text-white' : ''}`}
                                      >
                                        {text === null ? <span className="text-slate-600 italic">NULL</span> : text}
                                      </td>
                                    )
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>

                      <div className="px-5 py-3 flex items-center justify-between text-xs text-slate-400 font-mono">
                        <span>
                          {tableData ? `${tableData.total === null ? '?' : formatCount(tableData.total)} ${selectedConn.engine === 'redis' ? 'keys' : 'rows'}${search ? ' matching' : ''}` : ''}
                          {selectedConn.engine === 'redis' && tableData?.nextCursor ? ' · showing first scan batch, refine the pattern to narrow' : ''}
                        </span>
                        {selectedConn.engine !== 'redis' && (
                          <div className="flex items-center gap-2">
                            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="p-1.5 rounded-lg bg-slate-800 border border-white/10 disabled:opacity-30 cursor-pointer disabled:cursor-default">
                              <ChevronLeft className="w-3.5 h-3.5" />
                            </button>
                            <span>Page {page} / {totalPages}</span>
                            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="p-1.5 rounded-lg bg-slate-800 border border-white/10 disabled:opacity-30 cursor-pointer disabled:cursor-default">
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Structure tab */}
              {activeSubTab === 'structure' && (
                <div className="flex-1 overflow-auto p-5">
                  {!selectedTable || !tableData ? (
                    <div className="text-xs text-slate-500">Select a table to view its structure.</div>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                        {[
                          ['Type', selectedTable.type],
                          ['Rows', formatCount(tableData.total ?? selectedTable.rows)],
                          ['Size', formatBytes(selectedTable.bytes)],
                          ['Columns', tableData.columns.length]
                        ].map(([k, v]) => (
                          <div key={k} className="bg-slate-950 border border-white/10 rounded-xl p-3">
                            <div className="text-[10px] uppercase text-slate-500 font-bold tracking-wider">{k}</div>
                            <div className="text-sm text-white font-mono mt-1">{v}</div>
                          </div>
                        ))}
                      </div>
                      {selectedConn.engine === 'mongodb' && <p className="text-[11px] text-slate-500 mb-2">MongoDB is schemaless — fields below are inferred from the documents on the current page.</p>}
                      <table className="w-full text-xs font-mono border border-white/10 rounded-xl overflow-hidden">
                        <thead className="bg-slate-900">
                          <tr>{['Column', 'Type', 'Nullable', 'Key', 'Default'].map(h => <th key={h} className="text-left px-3 py-2 text-slate-300 border-b border-white/10">{h}</th>)}</tr>
                        </thead>
                        <tbody>
                          {tableData.columns.map(c => (
                            <tr key={c.name} className="border-b border-white/5">
                              <td className="px-3 py-1.5 text-white">{c.name}</td>
                              <td className="px-3 py-1.5 text-cyan-300">{c.type || '—'}</td>
                              <td className="px-3 py-1.5 text-slate-400">{c.nullable ? 'YES' : 'NO'}</td>
                              <td className="px-3 py-1.5 text-amber-300">{c.primary ? 'PRIMARY' : ''}</td>
                              <td className="px-3 py-1.5 text-slate-400 truncate max-w-[240px]">{c.default ?? ''}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </div>
              )}

              {/* Query console */}
              {activeSubTab === 'console' && (
                <div className="flex-1 flex flex-col min-h-0 p-5 gap-3">
                  <textarea
                    value={queryInput}
                    onChange={(e) => setQueryInput(e.target.value)}
                    onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleRunQuery() }}
                    spellCheck={false}
                    className="w-full h-36 bg-slate-950 border border-white/10 rounded-xl p-3 text-xs text-emerald-200 font-mono focus:outline-none focus:border-emerald-500/50 resize-y"
                  />
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleRunQuery}
                      disabled={executingQuery}
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-2 cursor-pointer"
                    >
                      {executingQuery ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />} Run (Ctrl+Enter)
                    </button>
                    <span className="text-[11px] text-amber-300/80 font-mono">Runs directly against {selectedConn.database} — write queries change live data.</span>
                  </div>

                  <div className="flex-1 overflow-auto border border-white/10 rounded-xl bg-slate-950/60 min-h-0">
                    {!queryResult ? (
                      <div className="p-4 text-xs text-slate-600 font-mono">Results will appear here.</div>
                    ) : queryResult.error ? (
                      <pre className="p-4 text-xs text-rose-300 font-mono whitespace-pre-wrap">{queryResult.error}</pre>
                    ) : (
                      <div>
                        <div className="px-3 py-2 text-[11px] text-emerald-300 font-mono border-b border-white/5">{queryResult.message} · {queryResult.executionTime}</div>
                        {queryResult.columns?.length > 0 && (
                          <table className="w-full text-xs font-mono">
                            <thead className="sticky top-0 bg-slate-900">
                              <tr>{queryResult.columns.map((c, i) => <th key={i} className="text-left px-3 py-2 text-slate-300 border-b border-white/10 whitespace-nowrap">{c}</th>)}</tr>
                            </thead>
                            <tbody>
                              {queryResult.rows.map((r, i) => (
                                <tr key={i} className="border-b border-white/5">
                                  {r.map((v, j) => <td key={j} className="px-3 py-1.5 text-slate-300 max-w-[320px] truncate">{v === null ? <span className="text-slate-600 italic">NULL</span> : cellText(v)}</td>)}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                        {queryResult.jsonOutput && <pre className="p-3 text-xs text-slate-300 font-mono whitespace-pre-wrap">{queryResult.jsonOutput}</pre>}
                        {queryResult.redisOutput !== undefined && <pre className="p-3 text-xs text-slate-300 font-mono whitespace-pre-wrap">{queryResult.redisOutput}</pre>}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Expanded cell */}
      {expandedCell && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setExpandedCell(null)}>
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-3xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
              <span className="text-sm font-mono text-white">{expandedCell.column}</span>
              <button onClick={() => setExpandedCell(null)} className="text-slate-400 hover:text-white cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            <pre className="p-4 overflow-auto text-xs text-slate-200 font-mono whitespace-pre-wrap break-all">{(() => { try { return JSON.stringify(JSON.parse(expandedCell.value), null, 2) } catch { return expandedCell.value } })()}</pre>
          </div>
        </div>
      )}

      {/* Insert row modal */}
      {showInsertModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <form onSubmit={handleInsertRow} className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
            <div className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between">
              <span className="text-sm font-bold text-white">Insert into {selectedTable?.name}</span>
              <button type="button" onClick={() => setShowInsertModal(false)} className="text-slate-400 hover:text-white cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-3 overflow-y-auto">
              <p className="text-[11px] text-slate-500">Leave a field empty to use the column default.</p>
              {insertColumns.map(c => (
                <label key={c.name} className="block">
                  <span className="text-[11px] text-slate-400 font-mono">{c.name} {c.type && <span className="text-slate-600">{c.type}</span>}</span>
                  <input
                    value={insertRowData[c.name] || ''}
                    onChange={(e) => setInsertRowData(d => ({ ...d, [c.name]: e.target.value }))}
                    className="mt-1 w-full bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500/50"
                  />
                </label>
              ))}
            </div>
            <div className="px-5 py-3.5 border-t border-white/10 flex justify-end gap-2">
              <button type="button" onClick={() => setShowInsertModal(false)} className="px-4 py-2 rounded-lg bg-slate-800 text-slate-200 text-xs cursor-pointer">Cancel</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer">Insert row</button>
            </div>
          </form>
        </div>
      )}

      {/* Create table modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <form onSubmit={handleCreateTable} className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
            <div className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between">
              <span className="text-sm font-bold text-white">New {selectedConn?.engine === 'mongodb' ? 'collection' : 'table'} in {selectedConn?.database}</span>
              <button type="button" onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-white cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-3 overflow-y-auto">
              <input
                required
                value={newTableName}
                onChange={(e) => setNewTableName(e.target.value)}
                placeholder="name"
                className="w-full bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500/50"
              />
              {selectedConn?.engine !== 'mongodb' && (
                <>
                  {newTableCols.map((c, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input value={c.name} placeholder="column" onChange={(e) => setNewTableCols(cols => cols.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} className="flex-1 bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono" />
                      <input value={c.type} placeholder="TYPE" onChange={(e) => setNewTableCols(cols => cols.map((x, j) => j === i ? { ...x, type: e.target.value } : x))} className="w-40 bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-xs text-cyan-200 font-mono" />
                      <label className="text-[11px] text-slate-400 flex items-center gap-1"><input type="checkbox" checked={c.primary} onChange={(e) => setNewTableCols(cols => cols.map((x, j) => j === i ? { ...x, primary: e.target.checked } : x))} /> PK</label>
                      <label className="text-[11px] text-slate-400 flex items-center gap-1"><input type="checkbox" checked={!c.nullable} onChange={(e) => setNewTableCols(cols => cols.map((x, j) => j === i ? { ...x, nullable: !e.target.checked } : x))} /> NOT NULL</label>
                      <button type="button" onClick={() => setNewTableCols(cols => cols.filter((_, j) => j !== i))} className="text-slate-500 hover:text-rose-400 cursor-pointer"><X className="w-4 h-4" /></button>
                    </div>
                  ))}
                  <button type="button" onClick={() => setNewTableCols(cols => [...cols, { name: '', type: 'TEXT', primary: false, nullable: true }])} className="text-xs text-emerald-300 flex items-center gap-1 cursor-pointer">
                    <Plus className="w-3.5 h-3.5" /> Add column
                  </button>
                </>
              )}
            </div>
            <div className="px-5 py-3.5 border-t border-white/10 flex justify-end gap-2">
              <button type="button" onClick={() => setShowCreateModal(false)} className="px-4 py-2 rounded-lg bg-slate-800 text-slate-200 text-xs cursor-pointer">Cancel</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer">Create</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
