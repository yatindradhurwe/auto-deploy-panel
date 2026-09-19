import React, { useState, useEffect } from 'react'
import {
  Database, Table, HardDrive, Play, RefreshCw, Key, CheckCircle2, Search, Code,
  FileText, Layers, Terminal, Server, Plus, Trash2, Download, Edit3, X, AlertTriangle, ChevronRight, Check
} from 'lucide-react'

export default function DatabaseManager({ jwtToken }) {
  const [databases, setDatabases] = useState([])
  const [activeEngine, setActiveEngine] = useState('postgresql') // 'postgresql' | 'mysql' | 'mongodb' | 'redis' | 'sqlite'
  const [selectedDb, setSelectedDb] = useState(null)
  const [selectedDbName, setSelectedDbName] = useState('')
  const [selectedTable, setSelectedTable] = useState(null)
  const [activeSubTab, setActiveSubTab] = useState('data') // 'data' | 'structure' | 'console'
  const [tableSearchQuery, setTableSearchQuery] = useState('')
  const [dataSearchQuery, setDataSearchQuery] = useState('')

  // Query Console State
  const [queryInput, setQueryInput] = useState('SELECT * FROM users LIMIT 10;')
  const [queryResult, setQueryResult] = useState(null)
  const [executingQuery, setExecutingQuery] = useState(false)

  // Loading & Action Feedback State
  const [loading, setLoading] = useState(true)
  const [actionSuccessMsg, setActionSuccessMsg] = useState(null)

  // Modals State
  const [showCreateTableModal, setShowCreateTableModal] = useState(false)
  const [newTableName, setNewTableName] = useState('')
  const [newTableCols, setNewTableCols] = useState([
    { name: 'id', type: 'VARCHAR(100)', primary: true, nullable: false },
    { name: 'created_at', type: 'DATETIME', primary: false, nullable: false }
  ])

  const [showInsertRowModal, setShowInsertRowModal] = useState(false)
  const [insertRowData, setInsertRowData] = useState({})

  const getToken = () => jwtToken || localStorage.getItem('autodeploy_token') || localStorage.getItem('autodeploy_jwt_token') || ''

  useEffect(() => {
    fetchDatabases()
  }, [])

  const fetchDatabaseSchema = async (engine, dbName) => {
    try {
      const token = getToken()
      const res = await fetch('/api/studio/databases/schema', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ engine, dbName })
      })
      const data = await res.json()
      if (data.success && data.schema) {
        const defaultList = engine === 'postgresql' ? ['tipcrm_production', 'tipcrm_staging', 'postgres', 'happiness_db', 'litigation_db']
          : engine === 'mysql' ? ['autodeploy_db', 'sys', 'mysql', 'wordpress_db']
          : engine === 'mongodb' ? ['analytics_db', 'telemetry_db', 'admin']
          : engine === 'redis' ? ['db0 (Default Cache)', 'db1 (Session Store)', 'db2 (Queue)']
          : ['db.json', 'autodeploy_saas.db', 'system.db']

        const currentDbList = data.schema.databasesList && data.schema.databasesList.length > 0
          ? data.schema.databasesList
          : defaultList

        setSelectedDb((prev) => ({
          ...prev,
          engine: engine,
          activeDbName: dbName,
          databasesList: currentDbList,
          tables: data.schema.tables || [],
          collections: data.schema.collections || [],
          keys: data.schema.keys || []
        }))
        const newTables = data.schema.tables || data.schema.collections || data.schema.keys || []
        if (newTables.length > 0) {
          setSelectedTable(newTables[0])
        } else {
          setSelectedTable(null)
        }
      }
    } catch (err) {
      console.error('Failed to fetch db schema:', err)
    }
  }

  const fetchDatabases = async () => {
    setLoading(true)
    try {
      const token = getToken()
      const res = await fetch('/api/studio/databases', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      })
      const data = await res.json()
      if (data.success && data.databases.length > 0) {
        setDatabases(data.databases)
        const currentEng = data.databases.find((d) => d.engine === activeEngine) || data.databases[0]
        const defaultDbName = currentEng.activeDbName || currentEng.databasesList?.[0] || ''
        setSelectedDb(currentEng)
        setSelectedDbName(defaultDbName)
        
        // Fetch dynamic schema for default DB
        fetchDatabaseSchema(currentEng.engine, defaultDbName)
      }
    } catch (e) {
      console.error('Failed to load databases', e)
    } finally {
      setLoading(false)
    }
  }

  const handleSelectDbName = (dbName) => {
    setSelectedDbName(dbName)
    fetchDatabaseSchema(activeEngine, dbName)
  }

  const handleEngineChange = (engine) => {
    setActiveEngine(engine)
    const matched = databases.find((d) => d.engine === engine)
    const defaultDb = matched?.activeDbName || matched?.databasesList?.[0] || (
      engine === 'postgresql' ? 'tipcrm_production'
      : engine === 'mysql' ? 'autodeploy_db'
      : engine === 'mongodb' ? 'analytics_db'
      : engine === 'redis' ? 'db0 (Default Cache)'
      : 'db.json'
    )

    const defaultList = engine === 'postgresql' ? ['tipcrm_production', 'tipcrm_staging', 'postgres', 'happiness_db', 'litigation_db']
      : engine === 'mysql' ? ['autodeploy_db', 'sys', 'mysql', 'wordpress_db']
      : engine === 'mongodb' ? ['analytics_db', 'telemetry_db', 'admin']
      : engine === 'redis' ? ['db0 (Default Cache)', 'db1 (Session Store)', 'db2 (Queue)']
      : ['db.json', 'autodeploy_saas.db', 'system.db']

    if (matched) {
      setSelectedDb({
        ...matched,
        databasesList: matched.databasesList?.length ? matched.databasesList : defaultList,
        activeDbName: defaultDb
      })
    } else {
      setSelectedDb({
        engine,
        name: engine === 'postgresql' ? 'PostgreSQL Engine (pgAdmin)' : engine === 'mysql' ? 'MySQL Engine (phpMyAdmin)' : engine === 'mongodb' ? 'MongoDB Engine' : engine === 'redis' ? 'Redis GUI Console' : 'SQLite Embedded Manager',
        host: engine === 'postgresql' ? '127.0.0.1:5432' : engine === 'mysql' ? '127.0.0.1:3306' : engine === 'mongodb' ? '127.0.0.1:27017' : engine === 'redis' ? '127.0.0.1:6379' : '/var/www/auto-deploy-panel/backend/data/db.json',
        databasesList: defaultList,
        activeDbName: defaultDb,
        tables: [],
        collections: [],
        keys: []
      })
    }

    setSelectedDbName(defaultDb)
    fetchDatabaseSchema(engine, defaultDb)
    setQueryResult(null)

    // Set engine default template query
    if (engine === 'postgresql') setQueryInput('SELECT * FROM users LIMIT 10;')
    else if (engine === 'mysql') setQueryInput('SELECT * FROM deploy_logs ORDER BY id DESC LIMIT 10;')
    else if (engine === 'mongodb') setQueryInput('db.page_views.find({}).limit(10);')
    else if (engine === 'redis') setQueryInput('GET session:jwt_tokens:admin-001')
    else if (engine === 'sqlite') setQueryInput('SELECT * FROM settings LIMIT 10;')
  }

  const handleRunQuery = async () => {
    if (!queryInput || !queryInput.trim()) return
    setExecutingQuery(true)
    try {
      const res = await fetch('/api/studio/databases/query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify({
          engine: activeEngine,
          dbName: selectedDbName,
          tableName: selectedTable?.name || '',
          query: queryInput
        })
      })
      const data = await res.json()
      if (data.success) {
        setQueryResult(data)
      } else {
        setQueryResult({ error: data.error })
      }
    } catch (err) {
      setQueryResult({ error: err.message })
    } finally {
      setExecutingQuery(false)
    }
  }

  const handleInsertRowSubmit = async (e) => {
    e.preventDefault()
    if (!selectedTable) return
    try {
      const res = await fetch('/api/studio/databases/insert-row', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify({
          engine: activeEngine,
          dbName: selectedDbName,
          tableName: selectedTable.name,
          rowData: insertRowData
        })
      })
      const data = await res.json()
      if (data.success) {
        setActionSuccessMsg(`🎉 ${data.message}`)
        setShowInsertRowModal(false)
        setInsertRowData({})
        setTimeout(() => setActionSuccessMsg(null), 3500)
      }
    } catch (err) {
      alert(`Insert Failed: ${err.message}`)
    }
  }

  const handleDeleteRow = async (row) => {
    if (!selectedTable) return
    const pKey = selectedTable.primaryKey || 'id'
    const val = row[pKey] || Object.values(row)[0]
    if (!window.confirm(`Are you sure you want to delete row where ${pKey} = '${val}'?`)) return

    try {
      const res = await fetch('/api/studio/databases/delete-row', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify({
          engine: activeEngine,
          dbName: selectedDbName,
          tableName: selectedTable.name,
          primaryKey: pKey,
          primaryKeyValue: val
        })
      })
      const data = await res.json()
      if (data.success) {
        setActionSuccessMsg(`🗑 ${data.message}`)
        setTimeout(() => setActionSuccessMsg(null), 3500)
      }
    } catch (err) {
      alert(`Delete Failed: ${err.message}`)
    }
  }

  const handleCreateTableSubmit = async (e) => {
    e.preventDefault()
    if (!newTableName.trim()) return
    try {
      const res = await fetch('/api/studio/databases/create-table', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify({
          engine: activeEngine,
          dbName: selectedDbName,
          tableName: newTableName.trim(),
          columns: newTableCols
        })
      })
      const data = await res.json()
      if (data.success) {
        setActionSuccessMsg(`✨ ${data.message}`)
        setShowCreateTableModal(false)
        setNewTableName('')
        fetchDatabases()
        setTimeout(() => setActionSuccessMsg(null), 3500)
      }
    } catch (err) {
      alert(`Create Table Failed: ${err.message}`)
    }
  }

  const handleDropTable = async () => {
    if (!selectedTable) return
    if (!window.confirm(`⚠️ WARNING: Are you sure you want to PERMANENTLY DROP '${selectedTable.name}' from ${selectedDbName}? This action cannot be undone.`)) return

    try {
      const res = await fetch('/api/studio/databases/drop-table', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify({
          engine: activeEngine,
          dbName: selectedDbName,
          tableName: selectedTable.name
        })
      })
      const data = await res.json()
      if (data.success) {
        setActionSuccessMsg(`💥 ${data.message}`)
        setSelectedTable(null)
        fetchDatabases()
        setTimeout(() => setActionSuccessMsg(null), 3500)
      }
    } catch (err) {
      alert(`Drop Table Failed: ${err.message}`)
    }
  }

  const handleExportData = () => {
    if (!selectedTable) return
    const exportContent = JSON.stringify(selectedTable.data || selectedTable.sampleDocs || selectedTable, null, 2)
    const blob = new Blob([exportContent], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${selectedDbName}_${selectedTable.name}_dump.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Filter tables by search query
  const filteredTables = selectedDb?.tables?.filter((t) => t.name.toLowerCase().includes(tableSearchQuery.toLowerCase())) || []
  const filteredCollections = selectedDb?.collections?.filter((c) => c.name.toLowerCase().includes(tableSearchQuery.toLowerCase())) || []
  const filteredKeys = selectedDb?.keys?.filter((k) => k.key.toLowerCase().includes(tableSearchQuery.toLowerCase())) || []

  return (
    <div className="space-y-6 font-sans">
      
      {/* Top Header Banner */}
      <div className="bg-slate-900/80 backdrop-blur-2xl border border-white/10 rounded-3xl p-6 shadow-2xl shadow-slate-950/50 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center space-x-3.5">
          <div className="p-3 rounded-2xl bg-gradient-to-tr from-emerald-500/20 to-teal-600/20 text-emerald-400 border border-emerald-500/30 ring-1 ring-emerald-500/20 shadow-inner">
            <Database className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-xl font-extrabold text-white">Multi-Database Server Suite</h1>
              <span className="text-[10px] bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full font-mono font-bold">
                pgAdmin + phpMyAdmin + MongoDB + Redis + SQLite
              </span>
            </div>
            <p className="text-xs text-slate-400 font-mono mt-0.5">
              Inspect schemas, browse table rows, run custom queries, and manage all databases on target server
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          {actionSuccessMsg && (
            <div className="px-3.5 py-1.5 bg-emerald-950/90 border border-emerald-700/80 text-emerald-300 rounded-xl text-xs font-mono font-semibold animate-in fade-in duration-200">
              {actionSuccessMsg}
            </div>
          )}

          <button
            onClick={fetchDatabases}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10 rounded-xl transition cursor-pointer flex items-center space-x-2 text-xs font-semibold shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-emerald-400 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh Suite</span>
          </button>
        </div>
      </div>

      {/* Database Engines Switcher Bar */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 font-mono text-xs">
        <button
          onClick={() => handleEngineChange('postgresql')}
          className={`px-4 py-2.5 rounded-2xl border flex items-center gap-2 transition cursor-pointer ${
            activeEngine === 'postgresql'
              ? 'bg-blue-950/90 text-blue-300 border-blue-500/70 font-bold shadow-lg shadow-blue-950/40 ring-1 ring-blue-500/30'
              : 'bg-slate-900/70 text-slate-400 border-white/10 hover:text-slate-200 hover:bg-slate-800'
          }`}
        >
          <span className="text-base">🐘</span>
          <span>pgAdmin (PostgreSQL)</span>
        </button>

        <button
          onClick={() => handleEngineChange('mysql')}
          className={`px-4 py-2.5 rounded-2xl border flex items-center gap-2 transition cursor-pointer ${
            activeEngine === 'mysql'
              ? 'bg-amber-950/90 text-amber-300 border-amber-500/70 font-bold shadow-lg shadow-amber-950/40 ring-1 ring-amber-500/30'
              : 'bg-slate-900/70 text-slate-400 border-white/10 hover:text-slate-200 hover:bg-slate-800'
          }`}
        >
          <span className="text-base">🐬</span>
          <span>phpMyAdmin (MySQL)</span>
        </button>

        <button
          onClick={() => handleEngineChange('mongodb')}
          className={`px-4 py-2.5 rounded-2xl border flex items-center gap-2 transition cursor-pointer ${
            activeEngine === 'mongodb'
              ? 'bg-emerald-950/90 text-emerald-300 border-emerald-500/70 font-bold shadow-lg shadow-emerald-950/40 ring-1 ring-emerald-500/30'
              : 'bg-slate-900/70 text-slate-400 border-white/10 hover:text-slate-200 hover:bg-slate-800'
          }`}
        >
          <span className="text-base">🍃</span>
          <span>MongoDB Compass</span>
        </button>

        <button
          onClick={() => handleEngineChange('redis')}
          className={`px-4 py-2.5 rounded-2xl border flex items-center gap-2 transition cursor-pointer ${
            activeEngine === 'redis'
              ? 'bg-rose-950/90 text-rose-300 border-rose-500/70 font-bold shadow-lg shadow-rose-950/40 ring-1 ring-rose-500/30'
              : 'bg-slate-900/70 text-slate-400 border-white/10 hover:text-slate-200 hover:bg-slate-800'
          }`}
        >
          <span className="text-base">🔴</span>
          <span>Redis GUI Console</span>
        </button>

        <button
          onClick={() => handleEngineChange('sqlite')}
          className={`px-4 py-2.5 rounded-2xl border flex items-center gap-2 transition cursor-pointer ${
            activeEngine === 'sqlite'
              ? 'bg-purple-950/90 text-purple-300 border-purple-500/70 font-bold shadow-lg shadow-purple-950/40 ring-1 ring-purple-500/30'
              : 'bg-slate-900/70 text-slate-400 border-white/10 hover:text-slate-200 hover:bg-slate-800'
          }`}
        >
          <span className="text-base">📁</span>
          <span>SQLite Embedded Manager</span>
        </button>
      </div>

      {/* Main Grid: Left Tree Sidebar + Right Workbench Data Console */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
        
        {/* Left Sidebar: Databases List & Tables Tree Explorer */}
        <div className="bg-slate-900/60 backdrop-blur-2xl border border-white/10 rounded-3xl p-4 space-y-4 shadow-2xl shadow-slate-950/50 flex flex-col h-[650px]">
          
          {/* Active Database Info Card */}
          {selectedDb && (
            <div className="bg-slate-950 border border-white/10 rounded-2xl p-3.5 space-y-2 font-mono text-xs shadow-inner">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Engine Host</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-bold">
                  CONNECTED
                </span>
              </div>
              <div className="text-white font-extrabold text-sm truncate">{selectedDb.name}</div>
              <div className="text-slate-400 text-[11px] truncate">Host: {selectedDb.host}</div>

              {/* Database Selector Dropdown */}
              {selectedDb.databasesList && (
                <div className="pt-1">
                  <select
                    value={selectedDbName}
                    onChange={(e) => handleSelectDbName(e.target.value)}
                    className="w-full bg-slate-900 border border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-cyan-300 font-mono focus:outline-none focus:border-cyan-400"
                  >
                    {selectedDb.databasesList.map((dbName) => (
                      <option key={dbName} value={dbName}>
                        📁 Database: {dbName}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {/* Table / Collection List Section */}
          <div className="space-y-2 border-b border-white/10 pb-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <Table className="w-3.5 h-3.5 text-cyan-400" />
                <span>{activeEngine === 'mongodb' ? 'Collections' : activeEngine === 'redis' ? 'Cached Keys' : 'Tables'}</span>
              </span>

              <div className="flex items-center space-x-1">
                <button
                  onClick={() => setShowCreateTableModal(true)}
                  title="Create New Table"
                  className="p-1 text-slate-400 hover:text-emerald-300 hover:bg-slate-800 rounded-lg transition cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Filter Table Search Bar */}
            <div className="relative">
              <input
                type="text"
                value={tableSearchQuery}
                onChange={(e) => setTableSearchQuery(e.target.value)}
                placeholder="Search tables / keys..."
                className="w-full bg-slate-950 border border-white/10 rounded-xl pl-7 pr-2.5 py-1 text-xs text-slate-200 font-mono focus:outline-none focus:border-cyan-400 shadow-inner"
              />
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2 top-2" />
              {tableSearchQuery && (
                <button
                  onClick={() => setTableSearchQuery('')}
                  className="absolute right-2 top-2 text-slate-500 hover:text-slate-300"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Tables Explorer List */}
          <div className="flex-1 overflow-y-auto space-y-1 pr-1">
            {loading ? (
              <div className="h-40 flex flex-col items-center justify-center space-y-2 text-slate-500 text-xs font-mono">
                <RefreshCw className="w-5 h-5 animate-spin text-emerald-400" />
                <span>Scanning server databases...</span>
              </div>
            ) : (activeEngine === 'postgresql' || activeEngine === 'mysql' || activeEngine === 'sqlite') ? (
              filteredTables.length > 0 ? (
                filteredTables.map((t) => (
                  <button
                    key={t.name}
                    onClick={() => setSelectedTable(t)}
                    className={`w-full p-2.5 rounded-xl text-xs font-mono text-left transition flex items-center justify-between cursor-pointer border ${
                      selectedTable?.name === t.name
                        ? 'bg-slate-950 text-cyan-300 border-cyan-500/50 font-bold shadow-md shadow-cyan-950/40'
                        : 'bg-slate-950/40 text-slate-400 border-white/5 hover:text-slate-200 hover:bg-slate-900/60'
                    }`}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <Table className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                      <span className="truncate">{t.name}</span>
                    </span>
                    <span className="text-[10px] text-slate-500 shrink-0">{t.rows} rows</span>
                  </button>
                ))
              ) : (
                <div className="p-4 text-center text-slate-500 text-xs font-mono">
                  No tables found in {selectedDbName}
                </div>
              )
            ) : activeEngine === 'mongodb' ? (
              filteredCollections.length > 0 ? (
                filteredCollections.map((c) => (
                  <button
                    key={c.name}
                    onClick={() => setSelectedTable(c)}
                    className={`w-full p-2.5 rounded-xl text-xs font-mono text-left transition flex items-center justify-between cursor-pointer border ${
                      selectedTable?.name === c.name
                        ? 'bg-slate-950 text-emerald-300 border-emerald-500/50 font-bold shadow-md shadow-emerald-950/40'
                        : 'bg-slate-950/40 text-slate-400 border-white/5 hover:text-slate-200 hover:bg-slate-900/60'
                    }`}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <span className="text-emerald-400 font-bold">🍃</span>
                      <span className="truncate">{c.name}</span>
                    </span>
                    <span className="text-[10px] text-slate-500 shrink-0">{c.count} docs</span>
                  </button>
                ))
              ) : (
                <div className="p-4 text-center text-slate-500 text-xs font-mono">
                  No collections found in {selectedDbName}
                </div>
              )
            ) : activeEngine === 'redis' ? (
              filteredKeys.length > 0 ? (
                filteredKeys.map((k) => (
                  <button
                    key={k.key}
                    onClick={() => setSelectedTable(k)}
                    className={`w-full p-2.5 rounded-xl text-xs font-mono text-left transition flex items-center justify-between cursor-pointer border ${
                      selectedTable?.key === k.key
                        ? 'bg-slate-950 text-rose-300 border-rose-500/50 font-bold shadow-md shadow-rose-950/40'
                        : 'bg-slate-950/40 text-slate-400 border-white/5 hover:text-slate-200 hover:bg-slate-900/60'
                    }`}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <span className="text-rose-400 font-bold">🔴</span>
                      <span className="truncate">{k.key}</span>
                    </span>
                    <span className="text-[10px] text-rose-400 font-semibold shrink-0">{k.type}</span>
                  </button>
                ))
              ) : (
                <div className="p-4 text-center text-slate-500 text-xs font-mono">
                  No cached keys found in {selectedDbName}
                </div>
              )
            ) : null}
          </div>

          <div className="pt-2 border-t border-white/10 text-[10px] font-mono text-slate-400 flex items-center justify-between">
            <span>Selected: {selectedTable?.name || selectedTable?.key || 'None'}</span>
            <span className="text-emerald-400 font-bold">{selectedDbName}</span>
          </div>
        </div>

        {/* Right Main Panel: Data Grid Browser + Schema View + Interactive SQL Console */}
        <div className="lg:col-span-3 bg-slate-900/60 backdrop-blur-2xl border border-white/10 rounded-3xl overflow-hidden shadow-2xl shadow-slate-950/50 flex flex-col h-[650px]">
          
          {/* Main Top Header Navigation Tabs */}
          <div className="bg-slate-950 border-b border-white/10 px-4 py-2.5 flex items-center justify-between select-none">
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setActiveSubTab('data')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-mono font-bold transition flex items-center gap-1.5 cursor-pointer ${
                  activeSubTab === 'data'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <Table className="w-3.5 h-3.5" />
                <span>Data Grid View</span>
              </button>

              <button
                onClick={() => setActiveSubTab('structure')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-mono font-bold transition flex items-center gap-1.5 cursor-pointer ${
                  activeSubTab === 'structure'
                    ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Structure & Schema</span>
              </button>

              <button
                onClick={() => setActiveSubTab('console')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-mono font-bold transition flex items-center gap-1.5 cursor-pointer ${
                  activeSubTab === 'console'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <Code className="w-3.5 h-3.5" />
                <span>Interactive SQL Console</span>
              </button>
            </div>

            {/* Quick Action Buttons for Active Table */}
            {selectedTable && (
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => {
                    const defaultObj = {}
                    if (selectedTable.columns) {
                      selectedTable.columns.forEach((c) => { defaultObj[c.name] = '' })
                    }
                    setInsertRowData(defaultObj)
                    setShowInsertRowModal(true)
                  }}
                  className="px-3 py-1 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 rounded-xl text-xs font-mono font-semibold flex items-center gap-1 transition cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Insert Row</span>
                </button>

                <button
                  onClick={handleExportData}
                  className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-white/10 rounded-xl text-xs font-mono font-semibold flex items-center gap-1 transition cursor-pointer"
                  title="Export table data as JSON dump"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export JSON</span>
                </button>

                <button
                  onClick={handleDropTable}
                  className="p-1.5 bg-rose-950/50 hover:bg-rose-900/80 text-rose-300 border border-rose-800/80 rounded-xl text-xs transition cursor-pointer"
                  title="Drop this table from database"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* SubTab 1: Data Grid Browser View (phpMyAdmin / pgAdmin style) */}
          {activeSubTab === 'data' && (
            <div className="flex-1 bg-slate-950 p-4 flex flex-col overflow-hidden">
              {!selectedTable ? (
                <div className="h-full flex flex-col items-center justify-center space-y-3 text-slate-500 font-mono text-xs">
                  <Database className="w-10 h-10 text-slate-600" />
                  <p>Select a table or collection from the left sidebar to view data rows.</p>
                </div>
              ) : (selectedTable.columns || Array.isArray(selectedTable.data)) ? (
                <div className="flex-1 flex flex-col overflow-hidden space-y-3">
                  {/* Table Info Toolbar */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs font-mono text-slate-400 border-b border-white/10 pb-2">
                    <div className="flex items-center space-x-2">
                      <span className="text-white font-bold">{selectedTable.name}</span>
                      <span>({selectedTable.rows || selectedTable.data?.length || 0} total rows)</span>
                      <span className="text-cyan-400 ml-2">PK: {selectedTable.primaryKey || 'id'}</span>
                    </div>

                    <div className="relative w-full sm:w-48">
                      <input
                        type="text"
                        value={dataSearchQuery}
                        onChange={(e) => setDataSearchQuery(e.target.value)}
                        placeholder="Search rows..."
                        className="w-full bg-slate-900 border border-white/10 rounded-xl pl-7 pr-2 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-cyan-400"
                      />
                      <Search className="w-3 h-3 text-slate-500 absolute left-2.5 top-2" />
                    </div>
                  </div>

                  {/* Data Rows Table */}
                  <div className="flex-1 overflow-auto border border-white/10 rounded-2xl bg-slate-900/60">
                    <table className="w-full text-left text-xs text-slate-300 border-collapse">
                      <thead className="bg-slate-900 border-b border-white/10 font-mono text-[11px] text-slate-300 sticky top-0">
                        <tr>
                          <th className="py-2.5 px-3 border-r border-white/5 w-12 text-center">Action</th>
                          {selectedTable.columns?.map((col) => (
                            <th key={col.name} className="py-2.5 px-3 border-r border-white/5 whitespace-nowrap">
                              <span className="font-bold text-cyan-300">{col.name}</span>
                              <span className="text-[9px] text-slate-500 font-normal ml-1">({col.type})</span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5 font-mono text-[11px]">
                        {(() => {
                          const rows = selectedTable.data || []
                          const filtered = rows.filter(r => {
                            if (!dataSearchQuery.trim()) return true
                            const q = dataSearchQuery.toLowerCase()
                            return Object.values(r).some(val => String(val || '').toLowerCase().includes(q))
                          })
                          if (filtered.length === 0) {
                            return (
                              <tr>
                                <td colSpan={(selectedTable.columns?.length || 0) + 1} className="py-8 text-center text-slate-500">
                                  No records found matching "{dataSearchQuery}"
                                </td>
                              </tr>
                            )
                          }
                          return filtered.map((row, idx) => (
                            <tr key={idx} className="hover:bg-slate-900/80 transition">
                              <td className="py-2 px-3 border-r border-white/5 text-center">
                                <button
                                  onClick={() => handleDeleteRow(row)}
                                  className="p-1 text-slate-500 hover:text-rose-400 hover:bg-slate-800 rounded transition cursor-pointer"
                                  title="Delete row"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </td>
                              {selectedTable.columns?.map((col) => (
                                <td key={col.name} className="py-2 px-3 border-r border-white/5 whitespace-nowrap text-slate-200">
                                  {String(row[col.name] ?? '')}
                                </td>
                              ))}
                            </tr>
                          ))
                        })()}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : selectedTable.sampleDocs ? (
                /* MongoDB Compass Document Viewer */
                <div className="flex-1 flex flex-col space-y-3 overflow-hidden">
                  <div className="text-xs font-mono text-emerald-400 font-bold">
                    🍃 Collection: {selectedTable.name} ({selectedTable.count} documents)
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                    {selectedTable.sampleDocs.map((doc, idx) => (
                      <pre key={idx} className="p-4 bg-slate-900/90 border border-white/10 rounded-2xl font-mono text-xs text-emerald-300 overflow-x-auto whitespace-pre-wrap leading-relaxed shadow-sm">
                        {JSON.stringify(doc, null, 2)}
                      </pre>
                    ))}
                  </div>
                </div>
              ) : (selectedTable.value !== undefined || selectedTable.key) ? (
                /* Redis Key Viewer */
                <div className="flex-1 flex flex-col space-y-3 p-4 bg-slate-900/90 border border-white/10 rounded-2xl font-mono text-xs">
                  <div className="flex items-center justify-between text-rose-300 font-bold">
                    <span>🔴 Key: {selectedTable.key}</span>
                    <span>Type: {selectedTable.type} | TTL: {selectedTable.ttl}</span>
                  </div>
                  <pre className="p-4 bg-slate-950 border border-slate-800 rounded-xl text-rose-200 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                    {selectedTable.value}
                  </pre>
                </div>
              ) : null}
            </div>
          )}

          {/* SubTab 2: Structure & Schema Viewer (Columns, Data Types, Constraints) */}
          {activeSubTab === 'structure' && (
            <div className="flex-1 bg-slate-950 p-6 flex flex-col overflow-y-auto space-y-4 font-mono text-xs">
              {!selectedTable || !selectedTable.columns ? (
                <div className="h-full flex flex-col items-center justify-center space-y-3 text-slate-500">
                  <Layers className="w-10 h-10 text-slate-600" />
                  <p>Structure view available for relational database tables (PostgreSQL / MySQL / SQLite).</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-white/10 pb-3">
                    <div>
                      <h3 className="text-sm font-bold text-white flex items-center gap-2">
                        <Table className="w-4 h-4 text-cyan-400" />
                        Table Schema Structure: <span className="text-cyan-300">{selectedTable.name}</span>
                      </h3>
                      <p className="text-[11px] text-slate-400 mt-0.5">Database: {selectedDbName}</p>
                    </div>

                    <button
                      onClick={() => setShowCreateTableModal(true)}
                      className="px-3.5 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold rounded-xl text-xs flex items-center gap-1.5 transition cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add New Column</span>
                    </button>
                  </div>

                  <div className="border border-white/10 rounded-2xl overflow-hidden bg-slate-900/60">
                    <table className="w-full text-left text-xs text-slate-300 border-collapse">
                      <thead className="bg-slate-900 border-b border-white/10 font-mono text-[11px] text-slate-400">
                        <tr>
                          <th className="py-2.5 px-4">#</th>
                          <th className="py-2.5 px-4">Column Name</th>
                          <th className="py-2.5 px-4">Data Type</th>
                          <th className="py-2.5 px-4">Primary Key</th>
                          <th className="py-2.5 px-4">Nullable</th>
                          <th className="py-2.5 px-4">Default Value</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5 font-mono text-[11px]">
                        {selectedTable.columns.map((col, idx) => (
                          <tr key={col.name} className="hover:bg-slate-900/80">
                            <td className="py-2.5 px-4 text-slate-500">{idx + 1}</td>
                            <td className="py-2.5 px-4 text-cyan-300 font-bold">{col.name}</td>
                            <td className="py-2.5 px-4 text-slate-300">{col.type}</td>
                            <td className="py-2.5 px-4">
                              {col.primary ? (
                                <span className="text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-full font-bold">
                                  PRIMARY KEY
                                </span>
                              ) : (
                                <span className="text-slate-600">-</span>
                              )}
                            </td>
                            <td className="py-2.5 px-4">
                              {col.nullable ? <span className="text-emerald-400">YES</span> : <span className="text-slate-500">NO</span>}
                            </td>
                            <td className="py-2.5 px-4 text-slate-400">{col.default || 'NULL'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* SubTab 3: Interactive SQL & Query Console */}
          {activeSubTab === 'console' && (
            <div className="flex-1 bg-slate-950 p-5 flex flex-col space-y-4 overflow-hidden">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="font-bold text-white flex items-center gap-2">
                  <Code className="w-4 h-4 text-emerald-400" />
                  Live {activeEngine.toUpperCase()} Command Console
                </span>

                <div className="flex items-center space-x-2">
                  <span className="text-slate-500">Query Presets:</span>
                  <select
                    onChange={(e) => setQueryInput(e.target.value)}
                    className="bg-slate-900 border border-white/10 rounded-xl px-2.5 py-1 text-xs text-cyan-300 font-mono focus:outline-none"
                  >
                    <option value={`SELECT * FROM ${selectedTable?.name || 'users'} LIMIT 10;`}>SELECT * FROM table</option>
                    <option value={`INSERT INTO ${selectedTable?.name || 'users'} (email, name) VALUES ('test@app.com', 'Test User');`}>INSERT INTO table</option>
                    <option value={`UPDATE ${selectedTable?.name || 'users'} SET role = 'admin' WHERE id = 'usr_101';`}>UPDATE table SET</option>
                    <option value={`CREATE TABLE new_data (id INT PRIMARY KEY, title VARCHAR(255));`}>CREATE TABLE</option>
                    <option value={`DROP TABLE ${selectedTable?.name || 'temp_table'};`}>DROP TABLE</option>
                  </select>
                </div>
              </div>

              {/* Query Input Textarea */}
              <div className="relative">
                <textarea
                  value={queryInput}
                  onChange={(e) => setQueryInput(e.target.value)}
                  rows={4}
                  placeholder="Enter SQL query or DB command..."
                  className="w-full p-4 bg-slate-900 border border-white/10 rounded-2xl text-xs font-mono text-emerald-300 focus:border-emerald-500 focus:outline-none resize-none leading-relaxed shadow-inner"
                ></textarea>

                <button
                  onClick={handleRunQuery}
                  disabled={executingQuery || !queryInput.trim()}
                  className="absolute bottom-3 right-3 px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-slate-950 font-extrabold rounded-xl text-xs flex items-center gap-1.5 transition cursor-pointer shadow-lg disabled:opacity-50"
                >
                  <Play className={`w-3.5 h-3.5 ${executingQuery ? 'animate-spin' : ''}`} />
                  <span>{executingQuery ? 'Executing...' : 'Execute Query'}</span>
                </button>
              </div>

              {/* Execution Result Output */}
              <div className="flex-1 overflow-y-auto space-y-2">
                {queryResult && (
                  <div className="space-y-2 p-4 bg-slate-900/90 border border-white/10 rounded-2xl font-mono text-xs">
                    <div className="flex items-center justify-between text-[11px] text-slate-400 border-b border-white/10 pb-2">
                      <span className="text-emerald-400 font-bold">{queryResult.message || 'Execution Complete'}</span>
                      {queryResult.executionTime && <span className="text-slate-500">Execution Time: {queryResult.executionTime}</span>}
                    </div>

                    {queryResult.rows && (
                      <div className="overflow-x-auto max-h-48 border border-white/5 rounded-xl bg-slate-950">
                        <table className="w-full text-left text-xs text-slate-300 border-collapse">
                          <thead className="bg-slate-900 text-slate-400 font-mono text-[11px] border-b border-white/10 sticky top-0">
                            <tr>
                              {queryResult.columns?.map((col) => (
                                <th key={col} className="py-2 px-3">{col}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5 font-mono text-[11px]">
                            {queryResult.rows.map((r, rIdx) => (
                              <tr key={rIdx} className="hover:bg-slate-900/50">
                                {r.map((c, cIdx) => (
                                  <td key={cIdx} className="py-1.5 px-3 text-slate-200">{String(c)}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {queryResult.jsonOutput && (
                      <pre className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-emerald-300 max-h-48 overflow-y-auto whitespace-pre-wrap">
                        {queryResult.jsonOutput}
                      </pre>
                    )}

                    {queryResult.redisOutput && (
                      <pre className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-rose-300 whitespace-pre-wrap">
                        {queryResult.redisOutput}
                      </pre>
                    )}

                    {queryResult.error && (
                      <div className="p-3 bg-rose-950/80 border border-rose-800 text-rose-300 rounded-xl text-xs">
                        ⚠️ Query Error: {queryResult.error}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Modal 1: Create Table Modal */}
      {showCreateTableModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-6 space-y-4 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-3">
                <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  <Table className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-white text-sm">Create New Table</h3>
                  <p className="text-[11px] text-slate-400 font-mono">Target Database: {selectedDbName}</p>
                </div>
              </div>
              <button onClick={() => setShowCreateTableModal(false)} className="p-1 rounded-lg text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateTableSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest">Table Name</label>
                <input
                  type="text"
                  value={newTableName}
                  onChange={(e) => setNewTableName(e.target.value)}
                  placeholder="e.g. products"
                  className="w-full bg-slate-950 border border-white/10 rounded-2xl px-3.5 py-2 text-xs text-white font-mono focus:outline-none focus:border-cyan-400"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest flex items-center justify-between">
                  <span>Columns Definition</span>
                  <button
                    type="button"
                    onClick={() => setNewTableCols((prev) => [...prev, { name: `col_${prev.length + 1}`, type: 'VARCHAR(255)', primary: false, nullable: true }])}
                    className="text-cyan-400 hover:underline cursor-pointer"
                  >
                    + Add Column
                  </button>
                </label>

                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {newTableCols.map((col, idx) => (
                    <div key={idx} className="flex items-center space-x-2">
                      <input
                        type="text"
                        value={col.name}
                        onChange={(e) => {
                          const updated = [...newTableCols]
                          updated[idx].name = e.target.value
                          setNewTableCols(updated)
                        }}
                        placeholder="Column name"
                        className="flex-1 bg-slate-950 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white font-mono"
                      />
                      <select
                        value={col.type}
                        onChange={(e) => {
                          const updated = [...newTableCols]
                          updated[idx].type = e.target.value
                          setNewTableCols(updated)
                        }}
                        className="bg-slate-950 border border-white/10 rounded-xl px-2 py-1.5 text-xs text-cyan-300 font-mono"
                      >
                        <option value="INT">INT</option>
                        <option value="VARCHAR(255)">VARCHAR(255)</option>
                        <option value="TEXT">TEXT</option>
                        <option value="UUID">UUID</option>
                        <option value="DATETIME">DATETIME</option>
                        <option value="BOOLEAN">BOOLEAN</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => setNewTableCols(newTableCols.filter((_, i) => i !== idx))}
                        className="p-1 text-slate-500 hover:text-rose-400"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateTableModal(false)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 rounded-xl text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newTableName.trim()}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-extrabold rounded-xl text-xs shadow-lg"
                >
                  Create Table Now
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: Insert Row Modal */}
      {showInsertRowModal && selectedTable && selectedTable.columns && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-3">
                <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <Plus className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-white text-sm">Insert New Row</h3>
                  <p className="text-[11px] text-slate-400 font-mono">Table: {selectedTable.name}</p>
                </div>
              </div>
              <button onClick={() => setShowInsertRowModal(false)} className="p-1 rounded-lg text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleInsertRowSubmit} className="space-y-3 max-h-80 overflow-y-auto pr-1">
              {selectedTable.columns.map((col) => (
                <div key={col.name} className="space-y-1">
                  <label className="text-[10px] font-mono font-bold text-slate-300 flex items-center justify-between">
                    <span>{col.name}</span>
                    <span className="text-slate-500 text-[9px] font-normal">({col.type})</span>
                  </label>
                  <input
                    type="text"
                    value={insertRowData[col.name] || ''}
                    onChange={(e) => setInsertRowData({ ...insertRowData, [col.name]: e.target.value })}
                    placeholder={`Enter ${col.name}...`}
                    className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-cyan-400"
                  />
                </div>
              ))}

              <div className="flex justify-end space-x-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowInsertRowModal(false)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 rounded-xl text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-extrabold rounded-xl text-xs shadow-lg"
                >
                  Insert Row
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  )
}
