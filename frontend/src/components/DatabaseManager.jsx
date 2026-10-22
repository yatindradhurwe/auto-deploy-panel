import React, { useState, useEffect, useMemo } from 'react'
import {
  Database, Table, Play, RefreshCw, Search, Code, Layers, Plus, Trash2, Download, X,
  AlertTriangle, ChevronRight, ChevronDown, ChevronLeft, FolderGit2, Key, Upload, UserCog, Eye, EyeOff, Link2, ArrowRightLeft
} from 'lucide-react'
import { useAuth } from '../store/AuthContext'
import { useServers } from '../store/ServersContext'

const ENGINES = {
  postgresql: { label: 'PostgreSQL', icon: '🐘', badge: 'bg-blue-500/10 text-blue-300 border-blue-500/30', sample: 'SELECT * FROM {table} LIMIT 20;' },
  mysql: { label: 'MySQL', icon: '🐬', badge: 'bg-amber-500/10 text-amber-300 border-amber-500/30', sample: 'SELECT * FROM `{table}` LIMIT 20;' },
  mongodb: { label: 'MongoDB', icon: '🍃', badge: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30', sample: 'db.getCollection("{table}").find({}).limit(20)' },
  redis: { label: 'Redis', icon: '🔴', badge: 'bg-rose-500/10 text-rose-300 border-rose-500/30', sample: 'KEYS *' },
  sqlite: { label: 'SQLite', icon: '📁', badge: 'bg-purple-500/10 text-purple-300 border-purple-500/30', sample: 'SELECT * FROM "{table}" LIMIT 20;' }
}

const SUPABASE_BADGE = 'bg-green-500/10 text-green-300 border-green-500/30'

const PAGE_SIZE = 50
const SYSTEM_DB_USERS = ['root', 'mysql', 'debian-sys-maint', 'postgres', 'admin']
const inputCls = 'w-full bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500/50'

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`
}

function randomPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), b => chars[b % chars.length]).join('')
}

const formatCount = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString())

function cellText(v) {
  if (v === null || v === undefined) return null
  return typeof v === 'object' ? JSON.stringify(v) : String(v)
}

export default function DatabaseManager({ project }) {
  const { token: jwtToken } = useAuth()
  const { activeServer } = useServers()
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

  // Export / import / credentials
  const [exporting, setExporting] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [importFile, setImportFile] = useState(null)
  const [importState, setImportState] = useState(null) // { phase: 'uploading'|'importing'|'done', progress, message, backup }
  const [showCreds, setShowCreds] = useState(false)
  const [creds, setCreds] = useState({ newUser: '', newPassword: '', adminUser: '', adminPassword: '', restart: true })
  const [showPw, setShowPw] = useState(false)
  const [credsBusy, setCredsBusy] = useState(false)
  const [credsResult, setCredsResult] = useState(null)

  // New / delete database
  const [showNewDb, setShowNewDb] = useState(false)
  const [newDb, setNewDb] = useState({ engine: 'mysql', name: '', user: '', password: '', adminUser: '', adminPassword: '' })
  const [newDbBusy, setNewDbBusy] = useState(false)
  const [newDbResult, setNewDbResult] = useState(null) // { ok, message, connection }
  const [showDropDb, setShowDropDb] = useState(false)
  const [dropDb, setDropDb] = useState({ confirm: '', dropUser: false })
  const [dropDbBusy, setDropDbBusy] = useState(false)
  const [dropDbError, setDropDbError] = useState(null)

  // Connect Supabase / migrate to this server
  const [showConnect, setShowConnect] = useState(false)
  const [connectForm, setConnectForm] = useState({ projectPath: '', url: '', envKey: 'DATABASE_URL', replace: false, restart: true })
  const [connectBusy, setConnectBusy] = useState(false)
  const [connectResult, setConnectResult] = useState(null) // { ok, message }
  const [showMigrate, setShowMigrate] = useState(false)
  const [migrateForm, setMigrateForm] = useState({ name: '', user: '', password: '', targetProjectPath: '', includeAuth: true, restart: true })
  const [migrateBusy, setMigrateBusy] = useState(false)
  const [migrateResult, setMigrateResult] = useState(null) // { ok, message, errors, dump, connection }

  const getToken = () => jwtToken

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

  // Projects a database can be connected to (just this one inside the project studio)
  const scopedProjects = useMemo(() => {
    const projects = discovery?.projects || []
    if (!project) return projects
    const p = (project.path || '').replace(/\/+$/, '')
    const names = [project.name, project.repoName, project.appName].filter(Boolean).map(n => n.toLowerCase())
    return projects.filter(x => (p && x.path === p) || names.includes(x.name.toLowerCase()) || names.includes(x.path.split('/').pop().toLowerCase()))
  }, [discovery, project])

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

  const authHeaders = () => ({ 'Authorization': `Bearer ${getToken()}`, 'X-Server-Id': activeServer?.id || '' })

  const handleExportDatabase = async () => {
    setExporting(true)
    setError(null)
    try {
      const res = await fetch('/api/studio/databases/export', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId: activeServer?.id, connectionId: selectedConn.id })
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Export failed (${res.status})`)
      }
      const name = (res.headers.get('Content-Disposition') || '').match(/filename="?([^";]+)"?/)?.[1] || `${selectedConn.database}.sql.gz`
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      URL.revokeObjectURL(url)
      flash(`Exported ${selectedConn.database}`)
    } catch (e) {
      setError(e.message)
    } finally {
      setExporting(false)
    }
  }

  /** Chunked upload (resumes after network hiccups), then runs the import on the server. */
  const handleImport = async () => {
    if (!importFile) return
    setImportState({ phase: 'uploading', progress: 0 })
    try {
      const init = await api('/uploads', { name: importFile.name, size: importFile.size })
      let offset = 0
      let failures = 0
      while (offset < importFile.size) {
        try {
          const res = await fetch(`/api/studio/databases/uploads/${init.uploadId}/chunk?offset=${offset}`, {
            method: 'POST',
            headers: { ...authHeaders(), 'Content-Type': 'application/octet-stream' },
            body: importFile.slice(offset, offset + init.chunkSize)
          })
          const data = await res.json().catch(() => ({}))
          if (res.status === 409 && Number.isFinite(data.expectedOffset)) { offset = data.expectedOffset; continue }
          if (!res.ok) throw Object.assign(new Error(data.error || `Upload failed (${res.status})`), { fatal: true })
          offset = data.received
          failures = 0
          setImportState({ phase: 'uploading', progress: offset / importFile.size })
        } catch (err) {
          if (err.fatal || ++failures > 4) throw err
          await new Promise(r => setTimeout(r, 1500 * failures))
        }
      }
      await api(`/uploads/${init.uploadId}/complete`)
      setImportState({ phase: 'importing', progress: 1 })
      const data = await api('/import', { connectionId: selectedConn.id, uploadId: init.uploadId })
      setImportState({ phase: 'done', progress: 1, message: data.message, backup: data.backup })
      await reloadTables()
    } catch (e) {
      setImportState({ phase: 'error', message: e.message })
    }
  }

  const openImport = () => {
    setImportFile(null)
    setImportState(null)
    setShowImport(true)
  }

  const openCreds = () => {
    setCreds({ newUser: '', newPassword: '', adminUser: '', adminPassword: '', restart: true })
    setCredsResult(null)
    setShowPw(false)
    setShowCreds(true)
  }

  const generatePassword = () => {
    setCreds(c => ({ ...c, newPassword: randomPassword() }))
    setShowPw(true)
  }

  const handleChangeCreds = async (e) => {
    e.preventDefault()
    setCredsBusy(true)
    setCredsResult(null)
    try {
      const data = await api('/credentials', { connectionId: selectedConn.id, ...creds })
      setCredsResult({ ok: true, message: data.message })
      flash('Database credentials updated')
      const fresh = await api('', { refresh: true })
      setDiscovery(fresh)
      const updated = [...(fresh.projects || []).flatMap(p => p.databases), ...(fresh.unassigned || [])].find(d => d.database === selectedConn.database && d.engine === selectedConn.engine && d.host === selectedConn.host)
      if (updated) setSelectedConn(updated)
    } catch (err) {
      setCredsResult({ ok: false, message: err.message })
    } finally {
      setCredsBusy(false)
    }
  }

  const openNewDb = () => {
    setNewDb({ engine: discovery?.engines?.mysql || !discovery?.engines?.postgresql ? 'mysql' : 'postgresql', name: '', user: '', password: '', adminUser: '', adminPassword: '' })
    setNewDbResult(null)
    setShowPw(false)
    setShowNewDb(true)
  }

  const handleCreateDb = async (e) => {
    e.preventDefault()
    setNewDbBusy(true)
    setNewDbResult(null)
    try {
      const data = await api('/create', newDb)
      setNewDbResult({ ok: true, message: data.message, connection: data.connection })
      flash(data.message)
      setDiscovery(await api('', { refresh: true }))
    } catch (err) {
      setNewDbResult({ ok: false, message: err.message })
    } finally {
      setNewDbBusy(false)
    }
  }

  const openDropDb = () => {
    setDropDb({ confirm: '', dropUser: false })
    setDropDbError(null)
    setShowDropDb(true)
  }

  const handleDropDb = async (e) => {
    e.preventDefault()
    setDropDbBusy(true)
    setDropDbError(null)
    try {
      const data = await api('/delete', { connectionId: selectedConn.id, ...dropDb })
      setShowDropDb(false)
      setSelectedConn(null)
      setTables([])
      setSelectedTable(null)
      setTableData(null)
      flash(data.message)
      setDiscovery(await api('', { refresh: true }))
    } catch (err) {
      setDropDbError(err.message)
    } finally {
      setDropDbBusy(false)
    }
  }

  const refreshAndSelect = async (match) => {
    const fresh = await api('', { refresh: true })
    setDiscovery(fresh)
    const found = [...(fresh.projects || []).flatMap(p => p.databases), ...(fresh.unassigned || [])].find(match)
    if (found) selectConnection(found)
  }

  const openConnect = () => {
    setConnectForm({ projectPath: scopedProjects[0]?.path || '', url: '', envKey: 'DATABASE_URL', replace: false, restart: true })
    setConnectResult(null)
    setShowPw(false)
    setShowConnect(true)
  }

  const handleConnect = async (e) => {
    e.preventDefault()
    setConnectBusy(true)
    setConnectResult(null)
    try {
      const data = await api('/connect-external', connectForm)
      setConnectResult({ ok: true, message: data.message })
      flash('Database connected')
      const host = (() => { try { const u = new URL(connectForm.url.trim()); return `${u.hostname}:${u.port || 5432}` } catch { return null } })()
      await refreshAndSelect(d => d.host === host && d.projects?.length)
    } catch (err) {
      setConnectResult({ ok: false, message: err.message })
    } finally {
      setConnectBusy(false)
    }
  }

  const openMigrate = () => {
    const linked = scopedProjects.find(p => p.databases.some(d => d.id === selectedConn.id)) || scopedProjects[0]
    const base = (linked?.name || selectedConn.database).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'app'
    setMigrateForm({ name: `${base}_db`, user: `${base}_user`, password: randomPassword(), targetProjectPath: linked?.path || '', includeAuth: true, restart: true })
    setMigrateResult(null)
    setShowPw(false)
    setShowMigrate(true)
  }

  const handleMigrate = async (e) => {
    e.preventDefault()
    setMigrateBusy(true)
    setMigrateResult(null)
    try {
      const data = await api('/migrate', { connectionId: selectedConn.id, ...migrateForm })
      setMigrateResult({ ok: true, ...data })
      flash('Migration finished')
      await refreshAndSelect(d => d.database === migrateForm.name && !d.external)
    } catch (err) {
      setMigrateResult({ ok: false, message: err.message })
    } finally {
      setMigrateBusy(false)
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
  const engineBadge = (engine, provider) => {
    const e = provider === 'supabase'
      ? { label: 'Supabase', icon: '⚡', badge: SUPABASE_BADGE }
      : ENGINES[engine] || { label: engine, icon: '🗄️', badge: 'bg-slate-500/10 text-slate-300 border-slate-500/30' }
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
            onClick={openConnect}
            disabled={!scopedProjects.length}
            title={scopedProjects.length ? 'Connect a Supabase (or other external PostgreSQL) database to a project' : 'No project found on this server'}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-green-300 border border-green-500/30 rounded-xl transition cursor-pointer flex items-center space-x-2 text-xs font-bold shadow-sm disabled:opacity-40 disabled:cursor-default"
          >
            <Link2 className="w-3.5 h-3.5" />
            <span>Connect Supabase</span>
          </button>
          <button
            onClick={openNewDb}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-onaccent rounded-xl transition cursor-pointer flex items-center space-x-2 text-xs font-bold shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New database</span>
          </button>
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
        <button onClick={() => setMobileTab('explorer')} className={`flex-1 py-2 rounded-xl font-bold transition ${mobileTab === 'explorer' ? 'bg-cyan-600 text-onaccent' : 'text-slate-400'}`}>
          📁 Explorer ({totalDatabases})
        </button>
        <button onClick={() => setMobileTab('workbench')} className={`flex-1 py-2 rounded-xl font-bold transition ${mobileTab === 'workbench' ? 'bg-cyan-600 text-onaccent' : 'text-slate-400'}`}>
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
                          <div key={db.id} className="relative group">
                            {['mysql', 'postgresql', 'sqlite', 'mongodb', 'redis'].includes(db.engine) && !(db.engine === 'postgresql' && db.external) && (
                              <button
                                onClick={() => { if (!active) selectConnection(db); openDropDb() }}
                                title={`Delete ${db.database} (a backup is taken first)`}
                                className="absolute right-1.5 top-1.5 z-10 p-1 rounded-md text-slate-600 hover:text-rose-400 hover:bg-rose-500/10 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 focus:opacity-100 transition cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              onClick={() => selectConnection(db)}
                              className={`w-full text-left pl-2 pr-8 py-1.5 rounded-lg transition cursor-pointer ${active ? 'bg-emerald-500/10 border border-emerald-500/30' : 'hover:bg-white/5 border border-transparent'}`}
                            >
                              <div className="flex items-center gap-2">
                                <Database className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-emerald-400' : 'text-slate-500'}`} />
                                <span className={`text-xs font-mono truncate flex-1 ${active ? 'text-emerald-200 font-bold' : 'text-slate-300'}`}>{db.database}</span>
                              </div>
                              <div className="flex items-center gap-1.5 mt-1 ml-5">
                                {engineBadge(db.engine, db.provider)}
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
                  {engineBadge(selectedConn.engine, selectedConn.provider)}
                  <span className="text-sm font-bold text-white font-mono truncate">{selectedConn.database}</span>
                  {selectedTable && <><ChevronRight className="w-3.5 h-3.5 text-slate-600" /><span className="text-sm font-mono text-cyan-300 truncate">{selectedTable.name}</span></>}
                </div>
                <div className="text-[11px] text-slate-500 font-mono flex flex-wrap gap-x-3">
                  <span>{selectedConn.host}</span>
                  {selectedConn.user && <span>user: {selectedConn.user}</span>}
                  <span>auth: {selectedConn.auth}</span>
                  {selectedConn.projects?.length > 0 && <span>used by: {selectedConn.projects.map(p => `${p.name}${p.source ? ` (${p.source})` : ''}`).join(', ')}</span>}
                </div>
                {['mysql', 'postgresql', 'sqlite'].includes(selectedConn.engine) && (
                  <div className="ml-auto flex items-center gap-1.5 text-xs font-semibold">
                    <button onClick={handleExportDatabase} disabled={exporting} title="Download a full .sql.gz dump" className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-white/10 text-slate-200 flex items-center gap-1.5 cursor-pointer disabled:opacity-50">
                      {exporting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} Export
                    </button>
                    <button onClick={openImport} title="Import a .sql / .sql.gz / .dump file" className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-white/10 text-slate-200 flex items-center gap-1.5 cursor-pointer">
                      <Upload className="w-3.5 h-3.5" /> Import
                    </button>
                    {selectedConn.engine === 'postgresql' && selectedConn.external && (
                      <button onClick={openMigrate} title="Copy this database into a new PostgreSQL database on this server" className="px-3 py-1.5 rounded-lg bg-green-600/80 hover:bg-green-500 text-onaccent flex items-center gap-1.5 cursor-pointer">
                        <ArrowRightLeft className="w-3.5 h-3.5" /> Migrate to this server
                      </button>
                    )}
                    {selectedConn.engine !== 'sqlite' && (
                      <button onClick={openCreds} title="Change the database username or password" className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-white/10 text-slate-200 flex items-center gap-1.5 cursor-pointer">
                        <UserCog className="w-3.5 h-3.5" /> Credentials
                      </button>
                    )}
                  </div>
                )}
                {!(selectedConn.engine === 'postgresql' && selectedConn.external) && <button onClick={openDropDb} title="Delete this database (a backup is taken first)" className={`${['mysql', 'postgresql', 'sqlite'].includes(selectedConn.engine) ? '' : 'ml-auto '}px-3 py-1.5 rounded-lg bg-rose-950/60 hover:bg-rose-900/60 border border-rose-700/40 text-rose-200 flex items-center gap-1.5 cursor-pointer text-xs font-semibold`}>
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>}
              </div>

              {selectedConn.credsError && (
                <div className="mx-5 mt-3 flex items-start gap-2 p-3 rounded-xl bg-amber-950/50 border border-amber-700/40 text-[11px] text-amber-200">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-400" />
                  <div className="flex-1">
                    MySQL rejects the login in the project's .env ({selectedConn.appUser || selectedConn.user}): <span className="font-mono">{selectedConn.credsError}</span>.
                    {selectedConn.auth === 'server admin login' && ' You are browsing through the server\'s admin login.'} Use <button onClick={openCreds} className="underline font-semibold cursor-pointer">Credentials</button> to give the app a working user and password.
                  </div>
                </div>
              )}

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
                          <button onClick={() => { setInsertRowData({}); setShowInsertModal(true) }} className="px-3 py-2 rounded-lg bg-emerald-600/80 hover:bg-emerald-500 text-onaccent text-xs font-semibold flex items-center gap-1.5 cursor-pointer">
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
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-onaccent text-xs font-bold flex items-center gap-2 cursor-pointer"
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
              <button type="submit" className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-onaccent text-xs font-bold cursor-pointer">Insert row</button>
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
              <button type="submit" className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-onaccent text-xs font-bold cursor-pointer">Create</button>
            </div>
          </form>
        </div>
      )}
      {/* Import modal */}
      {showImport && selectedConn && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-lg flex flex-col">
            <div className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between">
              <span className="text-sm font-bold text-white">Import into {selectedConn.database}</span>
              <button type="button" disabled={['uploading', 'importing'].includes(importState?.phase)} onClick={() => setShowImport(false)} className="text-slate-400 hover:text-white cursor-pointer disabled:opacity-40"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-[11px] text-slate-400">Runs the dump against this database. Tables in the dump replace existing ones with the same name. A backup of the current data is saved on the server first.</p>
              <input
                type="file"
                accept={selectedConn.engine === 'postgresql' ? '.sql,.gz,.dump' : '.sql,.gz'}
                disabled={!!importState && importState.phase !== 'error'}
                onChange={(e) => { setImportFile(e.target.files?.[0] || null); setImportState(null) }}
                className="block w-full text-xs text-slate-300 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-slate-800 file:text-slate-200 file:cursor-pointer"
              />
              {importFile && <div className="text-[11px] text-slate-500 font-mono">{importFile.name} · {formatBytes(importFile.size)}</div>}
              {importState?.phase === 'uploading' && (
                <div>
                  <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${Math.round(importState.progress * 100)}%` }} /></div>
                  <div className="text-[11px] text-slate-400 mt-1 font-mono">Uploading {Math.round(importState.progress * 100)}%</div>
                </div>
              )}
              {importState?.phase === 'importing' && <div className="text-xs text-slate-300 flex items-center gap-2"><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Backing up and importing… this can take a while for big dumps.</div>}
              {importState?.phase === 'done' && (
                <div className="p-3 rounded-lg bg-emerald-950/60 border border-emerald-700/50 text-xs text-emerald-200">
                  {importState.message}
                  <div className="text-[11px] text-emerald-300/70 font-mono mt-1 break-all">Previous data backed up to {importState.backup}</div>
                </div>
              )}
              {importState?.phase === 'error' && <pre className="p-3 rounded-lg bg-rose-950/60 border border-rose-700/50 text-xs text-rose-200 whitespace-pre-wrap break-all">{importState.message}</pre>}
            </div>
            <div className="px-5 py-3.5 border-t border-white/10 flex justify-end gap-2">
              <button type="button" disabled={['uploading', 'importing'].includes(importState?.phase)} onClick={() => setShowImport(false)} className="px-4 py-2 rounded-lg bg-slate-800 text-slate-200 text-xs cursor-pointer disabled:opacity-40">{importState?.phase === 'done' ? 'Close' : 'Cancel'}</button>
              {importState?.phase !== 'done' && (
                <button type="button" onClick={handleImport} disabled={!importFile || ['uploading', 'importing'].includes(importState?.phase)} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-onaccent text-xs font-bold cursor-pointer disabled:opacity-50">Import</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Credentials modal */}
      {showCreds && selectedConn && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <form onSubmit={handleChangeCreds} autoComplete="off" className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
            <div className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between">
              <span className="text-sm font-bold text-white">Credentials for {selectedConn.database}</span>
              <button type="button" onClick={() => setShowCreds(false)} className="text-slate-400 hover:text-white cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-3 overflow-y-auto">
              <p className="text-[11px] text-slate-400">Current user: <span className="font-mono text-slate-200">{selectedConn.appUser || selectedConn.user || '—'}</span>. The change is applied in {selectedConn.engine === 'mysql' ? 'MySQL' : 'PostgreSQL'} and written to the project's .env files that use this database (a .env.bak copy is kept).</p>
              {selectedConn.engine === 'mysql' && (!(selectedConn.appUser || selectedConn.user) || SYSTEM_DB_USERS.includes((selectedConn.appUser || selectedConn.user).toLowerCase())) && (
                <p className="text-[11px] text-amber-200 bg-amber-950/40 border border-amber-700/40 rounded-lg p-2.5">
                  {(selectedConn.appUser || selectedConn.user) ? `The app uses the system account "${selectedConn.appUser || selectedConn.user}".` : 'No app user is known for this database.'} Enter a new username and password: a dedicated MySQL user with full access to {selectedConn.database} is created and the app's .env is switched to it.
                </p>
              )}
              <label className="block">
                <span className="text-[11px] text-slate-400">New username <span className="text-slate-600">(leave empty to keep)</span></span>
                <input value={creds.newUser} onChange={(e) => setCreds(c => ({ ...c, newUser: e.target.value }))} placeholder={selectedConn.appUser || selectedConn.user || ''} autoComplete="off" className="mt-1 w-full bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500/50" />
              </label>
              <label className="block">
                <span className="text-[11px] text-slate-400">New password <span className="text-slate-600">(leave empty to keep; 8+ characters, no quotes, backslashes, backticks or $)</span></span>
                <div className="mt-1 flex gap-2">
                  <div className="relative flex-1">
                    <input type={showPw ? 'text' : 'password'} value={creds.newPassword} onChange={(e) => setCreds(c => ({ ...c, newPassword: e.target.value }))} autoComplete="new-password" className="w-full bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500/50 pr-9" />
                    <button type="button" onClick={() => setShowPw(v => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200 cursor-pointer">{showPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}</button>
                  </div>
                  <button type="button" onClick={generatePassword} className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-white/10 text-slate-200 text-xs cursor-pointer">Generate</button>
                </div>
              </label>
              {selectedConn.engine === 'mysql' && (
                <details className="text-[11px] text-slate-400">
                  <summary className="cursor-pointer">MySQL admin login (needed to rename the user if the panel can't log in to MySQL by itself)</summary>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <input value={creds.adminUser} onChange={(e) => setCreds(c => ({ ...c, adminUser: e.target.value }))} placeholder="Admin user (root)" autoComplete="off" className="w-full bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500/50" />
                    <input type="password" value={creds.adminPassword} onChange={(e) => setCreds(c => ({ ...c, adminPassword: e.target.value }))} placeholder="Admin password" autoComplete="new-password" className="w-full bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500/50" />
                  </div>
                </details>
              )}
              <label className="flex items-center gap-2 text-[11px] text-slate-300">
                <input type="checkbox" checked={creds.restart} onChange={(e) => setCreds(c => ({ ...c, restart: e.target.checked }))} />
                Restart the project's app afterwards so it uses the new credentials
              </label>
              {credsResult && (
                <div className={`p-3 rounded-lg text-xs border ${credsResult.ok ? 'bg-emerald-950/60 border-emerald-700/50 text-emerald-200' : 'bg-rose-950/60 border-rose-700/50 text-rose-200'}`}>{credsResult.message}</div>
              )}
            </div>
            <div className="px-5 py-3.5 border-t border-white/10 flex justify-end gap-2">
              <button type="button" onClick={() => setShowCreds(false)} className="px-4 py-2 rounded-lg bg-slate-800 text-slate-200 text-xs cursor-pointer">{credsResult?.ok ? 'Close' : 'Cancel'}</button>
              <button type="submit" disabled={credsBusy || (!creds.newUser.trim() && !creds.newPassword)} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-onaccent text-xs font-bold cursor-pointer disabled:opacity-50 flex items-center gap-1.5">
                {credsBusy && <RefreshCw className="w-3.5 h-3.5 animate-spin" />} Save
              </button>
            </div>
          </form>
        </div>
      )}
      {/* New database modal */}
      {showNewDb && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <form onSubmit={handleCreateDb} autoComplete="off" className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
            <div className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between">
              <span className="text-sm font-bold text-white">New database on {activeServer?.name || 'this server'}</span>
              <button type="button" onClick={() => setShowNewDb(false)} className="text-slate-400 hover:text-white cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            {newDbResult?.ok ? (
              <div className="p-5 space-y-3 overflow-y-auto">
                <div className="p-3 rounded-lg text-xs border bg-emerald-950/60 border-emerald-700/50 text-emerald-200">{newDbResult.message}</div>
                {newDbResult.connection?.url && (
                  <div>
                    <div className="text-[11px] text-slate-400 mb-1">Connection string for your app's .env:</div>
                    <div className="flex gap-2">
                      <code className="flex-1 bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-emerald-200 font-mono break-all">DATABASE_URL={newDbResult.connection.url}</code>
                      <button type="button" onClick={() => { navigator.clipboard.writeText(`DATABASE_URL=${newDbResult.connection.url}`); flash('Copied') }} className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-white/10 text-slate-200 text-xs cursor-pointer">Copy</button>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1 font-mono">host 127.0.0.1 · port {newDbResult.connection.port} · database {newDbResult.connection.database} · user {newDbResult.connection.user}</div>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-5 space-y-3 overflow-y-auto">
                <div className="grid grid-cols-2 gap-2">
                  {['mysql', 'postgresql'].map(eng => (
                    <button key={eng} type="button" onClick={() => setNewDb(d => ({ ...d, engine: eng }))} className={`px-3 py-2 rounded-lg border text-xs font-semibold cursor-pointer ${newDb.engine === eng ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200' : 'border-white/10 bg-slate-950 text-slate-400'}`}>
                      {ENGINES[eng].icon} {ENGINES[eng].label}{discovery?.engines && !discovery.engines[eng] ? ' (not running)' : ''}
                    </button>
                  ))}
                </div>
                <label className="block">
                  <span className="text-[11px] text-slate-400">Database name <span className="text-slate-600">(letters, numbers, underscores)</span></span>
                  <input required value={newDb.name} onChange={(e) => setNewDb(d => ({ ...d, name: e.target.value }))} placeholder="my_app_db" className={`mt-1 ${inputCls}`} />
                </label>
                <label className="block">
                  <span className="text-[11px] text-slate-400">Username <span className="text-slate-600">(optional — a new user gets full access to this database; an existing one is given access)</span></span>
                  <input value={newDb.user} onChange={(e) => setNewDb(d => ({ ...d, user: e.target.value }))} placeholder="my_app_user" autoComplete="off" className={`mt-1 ${inputCls}`} />
                </label>
                {newDb.user.trim() && (
                  <label className="block">
                    <span className="text-[11px] text-slate-400">Password for a new user <span className="text-slate-600">(leave empty for an existing user; 8+ characters, no quotes, backslashes, backticks or $)</span></span>
                    <div className="mt-1 flex gap-2">
                      <div className="relative flex-1">
                        <input type={showPw ? 'text' : 'password'} value={newDb.password} onChange={(e) => setNewDb(d => ({ ...d, password: e.target.value }))} autoComplete="new-password" className={`${inputCls} pr-9`} />
                        <button type="button" onClick={() => setShowPw(v => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200 cursor-pointer">{showPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}</button>
                      </div>
                      <button type="button" onClick={() => { setNewDb(d => ({ ...d, password: randomPassword() })); setShowPw(true) }} className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-white/10 text-slate-200 text-xs cursor-pointer">Generate</button>
                    </div>
                  </label>
                )}
                {newDb.engine === 'mysql' && (
                  <details className="text-[11px] text-slate-400">
                    <summary className="cursor-pointer">MySQL admin login (only if the panel can't log in to MySQL by itself)</summary>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <input value={newDb.adminUser} onChange={(e) => setNewDb(d => ({ ...d, adminUser: e.target.value }))} placeholder="Admin user (root)" autoComplete="off" className={inputCls} />
                      <input type="password" value={newDb.adminPassword} onChange={(e) => setNewDb(d => ({ ...d, adminPassword: e.target.value }))} placeholder="Admin password" autoComplete="new-password" className={inputCls} />
                    </div>
                  </details>
                )}
                {newDbResult && !newDbResult.ok && <div className="p-3 rounded-lg text-xs border bg-rose-950/60 border-rose-700/50 text-rose-200 whitespace-pre-wrap break-all">{newDbResult.message}</div>}
              </div>
            )}
            <div className="px-5 py-3.5 border-t border-white/10 flex justify-end gap-2">
              <button type="button" onClick={() => setShowNewDb(false)} className="px-4 py-2 rounded-lg bg-slate-800 text-slate-200 text-xs cursor-pointer">{newDbResult?.ok ? 'Close' : 'Cancel'}</button>
              {!newDbResult?.ok && (
                <button type="submit" disabled={newDbBusy || !newDb.name.trim()} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-onaccent text-xs font-bold cursor-pointer disabled:opacity-50 flex items-center gap-1.5">
                  {newDbBusy && <RefreshCw className="w-3.5 h-3.5 animate-spin" />} Create database
                </button>
              )}
            </div>
          </form>
        </div>
      )}

      {/* Connect Supabase modal */}
      {showConnect && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <form onSubmit={handleConnect} autoComplete="off" className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
            <div className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between">
              <span className="text-sm font-bold text-white flex items-center gap-2"><Link2 className="w-4 h-4 text-green-400" /> Connect a Supabase database</span>
              <button type="button" disabled={connectBusy} onClick={() => setShowConnect(false)} className="text-slate-400 hover:text-white cursor-pointer disabled:opacity-40"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-3 overflow-y-auto">
              <p className="text-[11px] text-slate-400">The connection is tested from {activeServer?.name || 'this server'}, then saved in the project's .env (a .env.bak copy is kept) so you can browse it here and migrate it onto this server later. Any external PostgreSQL works too.</p>
              <label className="block">
                <span className="text-[11px] text-slate-400">Project</span>
                <select required value={connectForm.projectPath} onChange={(e) => setConnectForm(f => ({ ...f, projectPath: e.target.value }))} className={`mt-1 ${inputCls}`}>
                  {scopedProjects.map(p => <option key={p.path} value={p.path}>{p.name} — {p.path}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-[11px] text-slate-400">Connection string <span className="text-slate-600">(Supabase → Connect → Session pooler; the direct db.&lt;ref&gt;.supabase.co host is IPv6 only)</span></span>
                <div className="relative mt-1">
                  <input required type={showPw ? 'text' : 'password'} value={connectForm.url} onChange={(e) => setConnectForm(f => ({ ...f, url: e.target.value }))} placeholder="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres" autoComplete="off" className={`${inputCls} pr-9`} />
                  <button type="button" onClick={() => setShowPw(v => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200 cursor-pointer">{showPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}</button>
                </div>
              </label>
              <label className="block">
                <span className="text-[11px] text-slate-400">.env variable</span>
                <input required value={connectForm.envKey} onChange={(e) => setConnectForm(f => ({ ...f, envKey: e.target.value }))} className={`mt-1 ${inputCls}`} />
              </label>
              <label className="flex items-center gap-2 text-[11px] text-slate-300">
                <input type="checkbox" checked={connectForm.replace} onChange={(e) => setConnectForm(f => ({ ...f, replace: e.target.checked }))} />
                Replace the existing value if {connectForm.envKey || 'the variable'} is already set
              </label>
              <label className="flex items-center gap-2 text-[11px] text-slate-300">
                <input type="checkbox" checked={connectForm.restart} onChange={(e) => setConnectForm(f => ({ ...f, restart: e.target.checked }))} />
                Restart the project's app afterwards
              </label>
              {connectResult && (
                <div className={`p-3 rounded-lg text-xs border whitespace-pre-wrap break-all ${connectResult.ok ? 'bg-emerald-950/60 border-emerald-700/50 text-emerald-200' : 'bg-rose-950/60 border-rose-700/50 text-rose-200'}`}>{connectResult.message}</div>
              )}
            </div>
            <div className="px-5 py-3.5 border-t border-white/10 flex justify-end gap-2">
              <button type="button" disabled={connectBusy} onClick={() => setShowConnect(false)} className="px-4 py-2 rounded-lg bg-slate-800 text-slate-200 text-xs cursor-pointer disabled:opacity-40">{connectResult?.ok ? 'Close' : 'Cancel'}</button>
              {!connectResult?.ok && (
                <button type="submit" disabled={connectBusy || !connectForm.url.trim() || !connectForm.projectPath} className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-onaccent text-xs font-bold cursor-pointer disabled:opacity-50 flex items-center gap-1.5">
                  {connectBusy && <RefreshCw className="w-3.5 h-3.5 animate-spin" />} Test &amp; connect
                </button>
              )}
            </div>
          </form>
        </div>
      )}

      {/* Migrate to this server modal */}
      {showMigrate && selectedConn && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <form onSubmit={handleMigrate} autoComplete="off" className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
            <div className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between">
              <span className="text-sm font-bold text-white flex items-center gap-2"><ArrowRightLeft className="w-4 h-4 text-green-400" /> Migrate {selectedConn.database} to {activeServer?.name || 'this server'}</span>
              <button type="button" disabled={migrateBusy} onClick={() => setShowMigrate(false)} className="text-slate-400 hover:text-white cursor-pointer disabled:opacity-40"><X className="w-4 h-4" /></button>
            </div>
            {migrateResult?.ok ? (
              <div className="p-5 space-y-3 overflow-y-auto">
                <div className="p-3 rounded-lg text-xs border bg-emerald-950/60 border-emerald-700/50 text-emerald-200">{migrateResult.message}</div>
                {migrateResult.connection?.url && (
                  <div>
                    <div className="text-[11px] text-slate-400 mb-1">New connection string:</div>
                    <div className="flex gap-2">
                      <code className="flex-1 bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-emerald-200 font-mono break-all">DATABASE_URL={migrateResult.connection.url}</code>
                      <button type="button" onClick={() => { navigator.clipboard.writeText(`DATABASE_URL=${migrateResult.connection.url}`); flash('Copied') }} className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-white/10 text-slate-200 text-xs cursor-pointer">Copy</button>
                    </div>
                  </div>
                )}
                {migrateResult.errors?.length > 0 && (
                  <details className="text-[11px] text-amber-200 bg-amber-950/40 border border-amber-700/40 rounded-lg p-2.5">
                    <summary className="cursor-pointer">{migrateResult.errors.length} statement(s) could not be restored</summary>
                    <pre className="mt-2 whitespace-pre-wrap break-all font-mono text-amber-200/80">{migrateResult.errors.join('\n')}</pre>
                  </details>
                )}
                <p className="text-[11px] text-slate-500">The source database is unchanged. Its dump is kept on the server at <span className="font-mono break-all">{migrateResult.dump}</span>. Supabase Auth logins, Storage files and the REST/Realtime APIs (supabase-js) still run on Supabase — only the PostgreSQL data was copied.</p>
              </div>
            ) : (
              <div className="p-5 space-y-3 overflow-y-auto">
                <p className="text-[11px] text-slate-400">Creates a new PostgreSQL database on this server and copies the tables, data, functions and policies of <span className="font-mono text-slate-200">{selectedConn.database}</span> ({selectedConn.host}) into it. The source is only read.</p>
                {discovery?.engines && !discovery.engines.postgresql && (
                  <p className="text-[11px] text-amber-200 bg-amber-950/40 border border-amber-700/40 rounded-lg p-2.5">PostgreSQL does not seem to be running on this server. Install it first (apt-get install -y postgresql).</p>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-[11px] text-slate-400">New database name</span>
                    <input required value={migrateForm.name} onChange={(e) => setMigrateForm(f => ({ ...f, name: e.target.value }))} className={`mt-1 ${inputCls}`} />
                  </label>
                  <label className="block">
                    <span className="text-[11px] text-slate-400">Username</span>
                    <input required value={migrateForm.user} onChange={(e) => setMigrateForm(f => ({ ...f, user: e.target.value }))} autoComplete="off" className={`mt-1 ${inputCls}`} />
                  </label>
                </div>
                <label className="block">
                  <span className="text-[11px] text-slate-400">Password <span className="text-slate-600">(new user: 8+ characters, no quotes, backslashes, backticks or $; leave empty for an existing user)</span></span>
                  <div className="mt-1 flex gap-2">
                    <div className="relative flex-1">
                      <input type={showPw ? 'text' : 'password'} value={migrateForm.password} onChange={(e) => setMigrateForm(f => ({ ...f, password: e.target.value }))} autoComplete="new-password" className={`${inputCls} pr-9`} />
                      <button type="button" onClick={() => setShowPw(v => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200 cursor-pointer">{showPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}</button>
                    </div>
                    <button type="button" onClick={() => { setMigrateForm(f => ({ ...f, password: randomPassword() })); setShowPw(true) }} className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-white/10 text-slate-200 text-xs cursor-pointer">Generate</button>
                  </div>
                </label>
                <label className="block">
                  <span className="text-[11px] text-slate-400">Use it in project <span className="text-slate-600">(its .env is pointed at the new database)</span></span>
                  <select value={migrateForm.targetProjectPath} onChange={(e) => setMigrateForm(f => ({ ...f, targetProjectPath: e.target.value }))} className={`mt-1 ${inputCls}`}>
                    <option value="">Don't change any project</option>
                    {(project ? scopedProjects : discovery?.projects || []).map(p => <option key={p.path} value={p.path}>{p.name} — {p.path}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-[11px] text-slate-300">
                  <input type="checkbox" checked={migrateForm.includeAuth} onChange={(e) => setMigrateForm(f => ({ ...f, includeAuth: e.target.checked }))} />
                  Include Supabase Auth users (the auth schema, often referenced by your tables)
                </label>
                {migrateForm.targetProjectPath && (
                  <label className="flex items-center gap-2 text-[11px] text-slate-300">
                    <input type="checkbox" checked={migrateForm.restart} onChange={(e) => setMigrateForm(f => ({ ...f, restart: e.target.checked }))} />
                    Restart the project's app afterwards
                  </label>
                )}
                {migrateBusy && <div className="text-xs text-slate-300 flex items-center gap-2"><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Dumping and restoring… this can take a while for big databases.</div>}
                {migrateResult && !migrateResult.ok && <div className="p-3 rounded-lg text-xs border bg-rose-950/60 border-rose-700/50 text-rose-200 whitespace-pre-wrap break-all">{migrateResult.message}</div>}
              </div>
            )}
            <div className="px-5 py-3.5 border-t border-white/10 flex justify-end gap-2">
              <button type="button" disabled={migrateBusy} onClick={() => setShowMigrate(false)} className="px-4 py-2 rounded-lg bg-slate-800 text-slate-200 text-xs cursor-pointer disabled:opacity-40">{migrateResult?.ok ? 'Close' : 'Cancel'}</button>
              {!migrateResult?.ok && (
                <button type="submit" disabled={migrateBusy || !migrateForm.name.trim() || !migrateForm.user.trim()} className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-onaccent text-xs font-bold cursor-pointer disabled:opacity-50 flex items-center gap-1.5">
                  {migrateBusy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ArrowRightLeft className="w-3.5 h-3.5" />} Migrate
                </button>
              )}
            </div>
          </form>
        </div>
      )}

      {/* Delete database modal */}
      {showDropDb && selectedConn && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <form onSubmit={handleDropDb} autoComplete="off" className="bg-slate-900 border border-rose-700/40 rounded-2xl w-full max-w-lg flex flex-col">
            <div className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between">
              <span className="text-sm font-bold text-rose-200 flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-rose-400" /> Delete {selectedConn.database}</span>
              <button type="button" disabled={dropDbBusy} onClick={() => setShowDropDb(false)} className="text-slate-400 hover:text-white cursor-pointer disabled:opacity-40"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-[11px] text-slate-300">
                {{
                  sqlite: 'This permanently deletes the SQLite file and all its tables. A gzipped SQL dump is saved on the server (/var/backups/autodeploy-db) first.',
                  mongodb: 'This permanently drops the database and all its collections. A gzipped mongodump archive is saved on the server (/var/backups/autodeploy-db) first.',
                  redis: 'This permanently removes every key in this Redis database (FLUSHDB). A snapshot of the whole Redis server is saved (/var/backups/autodeploy-db) first.'
                }[selectedConn.engine] || 'This permanently drops the database and all its tables. A gzipped backup is saved on the server (/var/backups/autodeploy-db) first.'}
                {selectedConn.projects?.length > 0 && <> It is used by <span className="font-semibold text-amber-200">{selectedConn.projects.map(p => p.name).join(', ')}</span>, which will stop working.</>}
              </p>
              <label className="block">
                <span className="text-[11px] text-slate-400">Type <span className="font-mono text-rose-200">{selectedConn.database}</span> to confirm</span>
                <input autoFocus value={dropDb.confirm} onChange={(e) => setDropDb(d => ({ ...d, confirm: e.target.value }))} className={`mt-1 ${inputCls} focus:border-rose-500/50`} />
              </label>
              {(selectedConn.appUser || selectedConn.user) && !SYSTEM_DB_USERS.includes((selectedConn.appUser || selectedConn.user).toLowerCase()) && (
                <label className="flex items-center gap-2 text-[11px] text-slate-300">
                  <input type="checkbox" checked={dropDb.dropUser} onChange={(e) => setDropDb(d => ({ ...d, dropUser: e.target.checked }))} />
                  Also remove the user <span className="font-mono">{selectedConn.appUser || selectedConn.user}</span> (kept if it still has other databases)
                </label>
              )}
              {dropDbError && <div className="p-3 rounded-lg text-xs border bg-rose-950/60 border-rose-700/50 text-rose-200 whitespace-pre-wrap break-all">{dropDbError}</div>}
            </div>
            <div className="px-5 py-3.5 border-t border-white/10 flex justify-end gap-2">
              <button type="button" disabled={dropDbBusy} onClick={() => setShowDropDb(false)} className="px-4 py-2 rounded-lg bg-slate-800 text-slate-200 text-xs cursor-pointer disabled:opacity-40">Cancel</button>
              <button type="submit" disabled={dropDbBusy || dropDb.confirm !== selectedConn.database} className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-onaccent text-xs font-bold cursor-pointer disabled:opacity-50 flex items-center gap-1.5">
                {dropDbBusy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} Back up &amp; delete
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
