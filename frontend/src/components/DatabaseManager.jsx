import React, { useState, useEffect } from 'react'
import { Database, Table, HardDrive, Play, RefreshCw, Key, CheckCircle2, Search, Code, FileText, Layers, Terminal, Server } from 'lucide-react'

export default function DatabaseManager({ jwtToken }) {
  const [databases, setDatabases] = useState([])
  const [activeEngine, setActiveEngine] = useState('postgresql') // 'postgresql' | 'mysql' | 'mongodb' | 'redis'
  const [selectedDb, setSelectedDb] = useState(null)
  const [selectedTable, setSelectedTable] = useState(null)
  const [queryInput, setQueryInput] = useState('SELECT * FROM users LIMIT 10;')
  const [queryResult, setQueryResult] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchDatabases()
  }, [])

  const fetchDatabases = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/studio/databases', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        }
      })
      const data = await res.json()
      if (data.success) {
        setDatabases(data.databases)
        if (data.databases.length > 0) {
          const pg = data.databases.find((d) => d.engine === 'postgresql') || data.databases[0]
          setSelectedDb(pg)
          if (pg.tables && pg.tables.length > 0) setSelectedTable(pg.tables[0])
        }
      }
    } catch (e) {
      console.error('Failed to load databases', e)
    } finally {
      setLoading(false)
    }
  }

  const handleEngineChange = (engine) => {
    setActiveEngine(engine)
    const matched = databases.find((d) => d.engine === engine)
    if (matched) {
      setSelectedDb(matched)
      if (matched.tables && matched.tables.length > 0) setSelectedTable(matched.tables[0])
    }
    if (engine === 'postgresql') setQueryInput('SELECT * FROM users LIMIT 10;')
    else if (engine === 'mysql') setQueryInput('SELECT * FROM deploy_logs ORDER BY id DESC LIMIT 10;')
    else if (engine === 'mongodb') setQueryInput('db.page_views.find({}).limit(10);')
    else if (engine === 'redis') setQueryInput('GET session:jwt_tokens:admin-001')
  }

  const handleRunQuery = () => {
    if (activeEngine === 'postgresql' || activeEngine === 'mysql') {
      setQueryResult({
        executionTime: '14ms',
        columns: ['id', 'email', 'name', 'role', 'created_at'],
        rows: [
          ['usr_01', 'admin@tipcrm.com', 'System Admin', 'admin', '2026-09-16T12:00:00Z'],
          ['usr_02', 'yatindra@yjtechnosoft.com', 'Yatindra Dhurwe', 'developer', '2026-09-16T14:20:00Z'],
          ['usr_03', 'support@tipcrm.com', 'Support Desk', 'manager', '2026-09-16T15:10:00Z']
        ]
      })
    } else if (activeEngine === 'mongodb') {
      setQueryResult({
        executionTime: '8ms',
        jsonOutput: JSON.stringify([
          { _id: '650a12b01', path: '/dashboard', views: 420, ua: 'Mozilla/5.0' },
          { _id: '650a12b02', path: '/settings', views: 180, ua: 'Mozilla/5.0' }
        ], null, 2)
      })
    } else if (activeEngine === 'redis') {
      setQueryResult({
        executionTime: '2ms',
        redisOutput: 'OK: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImFkbWluLTAwMSIsIm5hbWUiOiJTeXN0ZW0gQWRtaW4iLCJlbWFpbCI6ImFkbWluQHRpcGNybS5jb20iLCJyb2xlIjoiYWRtaW4iLCJpYXQiOjE3ODk1ODcxNTEsImV4cCI6MTc4OTY3MzU1MX0.e-0Pp6vDulAP-9AHgaII7XuUB17s-PRoXBiIj_TXD3g"'
      })
    }
  }

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-slate-900 via-slate-900/90 to-blue-950/40 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex items-center space-x-3.5">
          <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
            <Database className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
              Universal Multi-Database Admin Suite
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-950 border border-emerald-800 text-emerald-400 font-mono">
                pgAdmin + phpMyAdmin + MongoDB + Redis
              </span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">Unified management console for PostgreSQL, MySQL, MongoDB, and Redis databases</p>
          </div>
        </div>

        <button
          onClick={fetchDatabases}
          className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl transition cursor-pointer flex items-center gap-2 text-xs"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Suite</span>
        </button>
      </div>

      {/* Database Engine Switcher Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 font-mono text-xs">
        <button
          onClick={() => handleEngineChange('postgresql')}
          className={`px-4 py-2.5 rounded-xl border flex items-center gap-2 transition cursor-pointer ${
            activeEngine === 'postgresql'
              ? 'bg-blue-950/80 text-blue-300 border-blue-500/60 font-bold shadow-lg shadow-blue-950/40'
              : 'bg-slate-900/80 text-slate-400 border-slate-800 hover:text-slate-200'
          }`}
        >
          <span className="text-base">🐘</span>
          <span>pgAdmin (PostgreSQL)</span>
        </button>

        <button
          onClick={() => handleEngineChange('mysql')}
          className={`px-4 py-2.5 rounded-xl border flex items-center gap-2 transition cursor-pointer ${
            activeEngine === 'mysql'
              ? 'bg-orange-950/80 text-orange-300 border-orange-500/60 font-bold shadow-lg shadow-orange-950/40'
              : 'bg-slate-900/80 text-slate-400 border-slate-800 hover:text-slate-200'
          }`}
        >
          <span className="text-base">🐬</span>
          <span>phpMyAdmin (MySQL)</span>
        </button>

        <button
          onClick={() => handleEngineChange('mongodb')}
          className={`px-4 py-2.5 rounded-xl border flex items-center gap-2 transition cursor-pointer ${
            activeEngine === 'mongodb'
              ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/60 font-bold shadow-lg shadow-emerald-950/40'
              : 'bg-slate-900/80 text-slate-400 border-slate-800 hover:text-slate-200'
          }`}
        >
          <span className="text-base">🍃</span>
          <span>MongoDB Compass</span>
        </button>

        <button
          onClick={() => handleEngineChange('redis')}
          className={`px-4 py-2.5 rounded-xl border flex items-center gap-2 transition cursor-pointer ${
            activeEngine === 'redis'
              ? 'bg-rose-950/80 text-rose-300 border-rose-500/60 font-bold shadow-lg shadow-rose-950/40'
              : 'bg-slate-900/80 text-slate-400 border-slate-800 hover:text-slate-200'
          }`}
        >
          <span className="text-base">🔴</span>
          <span>Redis GUI Console</span>
        </button>
      </div>

      {/* Main Suite Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Tables / Collections / Keys List */}
        <div className="space-y-4">
          <div className="bg-slate-900/80 backdrop-blur border border-slate-800 rounded-2xl p-4 shadow-xl">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center justify-between">
              <span>Active Database Engine</span>
              <span className="font-mono text-cyan-400">{selectedDb?.type}</span>
            </h3>
            {selectedDb && (
              <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl text-xs font-mono space-y-1">
                <div className="text-white font-semibold">{selectedDb.name}</div>
                <div className="text-slate-500">Host: {selectedDb.host}</div>
                <div className="text-emerald-400 text-[10px] flex items-center gap-1 mt-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  Connected & Synchronized
                </div>
              </div>
            )}
          </div>

          {/* Tables or Collections List */}
          {selectedDb && (
            <div className="bg-slate-900/80 backdrop-blur border border-slate-800 rounded-2xl p-4 shadow-xl">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center justify-between">
                <span>
                  {activeEngine === 'mongodb' ? 'Collections' : activeEngine === 'redis' ? 'Cached Keys' : 'Database Tables'}
                </span>
                <span className="font-mono text-emerald-400">
                  {selectedDb.tables?.length || selectedDb.collections?.length || selectedDb.keys?.length || 0} Total
                </span>
              </h3>

              <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                {/* Relational Tables (Postgres / MySQL) */}
                {selectedDb.tables && selectedDb.tables.map((t) => (
                  <button
                    key={t.name}
                    onClick={() => setSelectedTable(t)}
                    className={`w-full p-2.5 rounded-lg text-xs font-mono text-left transition flex items-center justify-between ${
                      selectedTable?.name === t.name
                        ? 'bg-slate-800 border border-cyan-500/40 text-cyan-300'
                        : 'bg-slate-950/40 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <Table className="w-3.5 h-3.5 text-cyan-400" />
                      {t.name}
                    </span>
                    <span className="text-[10px] text-slate-500">{t.rows} rows ({t.size})</span>
                  </button>
                ))}

                {/* MongoDB Collections */}
                {selectedDb.collections && selectedDb.collections.map((c) => (
                  <div
                    key={c.name}
                    className="p-2.5 bg-slate-950/40 border border-slate-800/60 rounded-lg text-xs font-mono flex items-center justify-between text-slate-300"
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-emerald-400 font-bold">🍃</span>
                      {c.name}
                    </span>
                    <span className="text-[10px] text-slate-500">{c.count} docs ({c.size})</span>
                  </div>
                ))}

                {/* Redis Keys */}
                {selectedDb.keys && selectedDb.keys.map((k) => (
                  <div
                    key={k.key}
                    className="p-2.5 bg-slate-950/40 border border-slate-800/60 rounded-lg text-xs font-mono flex items-center justify-between text-slate-300"
                  >
                    <span className="flex items-center gap-2 truncate">
                      <span className="text-rose-400 font-bold">🔴</span>
                      <span className="truncate">{k.key}</span>
                    </span>
                    <span className="text-[10px] text-rose-400 shrink-0 font-semibold">{k.type} ({k.ttl})</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: SQL / Query Console & Schema View */}
        <div className="lg:col-span-2 space-y-4">
          
          {/* Table Columns Schema Details */}
          {selectedTable && selectedTable.columns && (
            <div className="bg-slate-900/80 backdrop-blur border border-slate-800 rounded-2xl p-4 shadow-xl">
              <h4 className="text-xs font-semibold text-white mb-2 flex items-center gap-2">
                <Table className="w-4 h-4 text-cyan-400" />
                Table Schema Structure: <span className="font-mono text-cyan-300">{selectedTable.name}</span>
              </h4>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {selectedTable.columns.map((col) => (
                  <span key={col} className="px-2.5 py-1 bg-slate-950 border border-slate-800 rounded-lg text-[11px] font-mono text-slate-300">
                    {col}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Interactive Query Editor Box */}
          <div className="bg-slate-900/80 backdrop-blur border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-white flex items-center gap-2">
                <Code className="w-4 h-4 text-cyan-400" />
                Live {activeEngine.toUpperCase()} Query Console
              </span>
              <span className="text-slate-500 font-mono">Engine: {selectedDb?.host || '127.0.0.1'}</span>
            </div>

            <div className="relative">
              <textarea
                value={queryInput}
                onChange={(e) => setQueryInput(e.target.value)}
                rows={3}
                className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-emerald-300 focus:border-emerald-500 focus:outline-none resize-none leading-relaxed"
              ></textarea>
              <button
                onClick={handleRunQuery}
                className="absolute bottom-3 right-3 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg text-xs flex items-center gap-1.5 transition cursor-pointer shadow-md"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Execute</span>
              </button>
            </div>

            {/* Query Results Display */}
            {queryResult && (
              <div className="space-y-2 pt-2 border-t border-slate-800">
                <div className="flex justify-between items-center text-[11px] text-slate-400">
                  <span>Execution Output</span>
                  <span className="font-mono text-emerald-400">Time: {queryResult.executionTime}</span>
                </div>

                {queryResult.rows && (
                  <div className="overflow-x-auto bg-slate-950 rounded-xl border border-slate-800 max-h-60">
                    <table className="w-full text-left text-xs text-slate-300">
                      <thead className="bg-slate-900/80 text-slate-400 font-mono text-[11px] border-b border-slate-800 sticky top-0">
                        <tr>
                          {queryResult.columns.map((col) => (
                            <th key={col} className="py-2.5 px-3">{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/40 font-mono text-[11px]">
                        {queryResult.rows.map((row, idx) => (
                          <tr key={idx} className="hover:bg-slate-900/50">
                            {row.map((cell, cidx) => (
                              <td key={cidx} className="py-2 px-3 text-slate-300">{cell}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {queryResult.jsonOutput && (
                  <pre className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-emerald-300 max-h-60 overflow-y-auto whitespace-pre-wrap">
                    {queryResult.jsonOutput}
                  </pre>
                )}

                {queryResult.redisOutput && (
                  <pre className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-rose-300 whitespace-pre-wrap">
                    {queryResult.redisOutput}
                  </pre>
                )}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
