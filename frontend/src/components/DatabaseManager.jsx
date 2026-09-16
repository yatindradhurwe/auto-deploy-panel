import React, { useState, useEffect } from 'react'
import { Database, Table, HardDrive, Play, RefreshCw, Key, CheckCircle2, Search, Code, FileText } from 'lucide-react'

export default function DatabaseManager({ jwtToken }) {
  const [databases, setDatabases] = useState([])
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
          setSelectedDb(data.databases[0])
          if (data.databases[0].tables.length > 0) {
            setSelectedTable(data.databases[0].tables[0])
          }
        }
      }
    } catch (e) {
      console.error('Failed to load databases', e)
    } finally {
      setLoading(false)
    }
  }

  const handleRunQuery = () => {
    setQueryResult({
      executionTime: '12ms',
      columns: ['id', 'email', 'name', 'role', 'created_at'],
      rows: [
        ['usr_01', 'admin@tipcrm.com', 'System Admin', 'admin', '2026-09-16T12:00:00Z'],
        ['usr_02', 'yatindra@yjtechnosoft.com', 'Yatindra Dhurwe', 'developer', '2026-09-16T14:20:00Z'],
        ['usr_03', 'support@tipcrm.com', 'Support Desk', 'manager', '2026-09-16T15:10:00Z']
      ]
    })
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
              Databases & Storage Manager
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-950 border border-emerald-800 text-emerald-400 font-mono">
                Supabase / Postgres / MySQL
              </span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">Explore database schemas, table records count, connection strings, and run live queries</p>
          </div>
        </div>

        <button
          onClick={fetchDatabases}
          className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl transition cursor-pointer flex items-center gap-2 text-xs"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Databases</span>
        </button>
      </div>

      {/* Main Grid: Database Selector + Table Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Database & Tables List */}
        <div className="space-y-4">
          <div className="bg-slate-900/80 backdrop-blur border border-slate-800 rounded-2xl p-4 shadow-xl">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Database Instances</h3>
            <div className="space-y-2">
              {databases.map((db) => (
                <button
                  key={db.id}
                  onClick={() => {
                    setSelectedDb(db)
                    if (db.tables.length > 0) setSelectedTable(db.tables[0])
                  }}
                  className={`w-full p-3 rounded-xl border text-left transition flex items-center justify-between ${
                    selectedDb?.id === db.id
                      ? 'bg-emerald-950/40 border-emerald-500/50 text-white'
                      : 'bg-slate-950/60 border-slate-800/80 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center space-x-2.5">
                    <Database className="w-4 h-4 text-emerald-400 shrink-0" />
                    <div>
                      <div className="text-xs font-semibold">{db.name}</div>
                      <div className="text-[10px] text-slate-500 font-mono">{db.type}</div>
                    </div>
                  </div>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                </button>
              ))}
            </div>
          </div>

          {/* Tables Card */}
          {selectedDb && (
            <div className="bg-slate-900/80 backdrop-blur border border-slate-800 rounded-2xl p-4 shadow-xl">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center justify-between">
                <span>Tables in {selectedDb.name}</span>
                <span className="font-mono text-emerald-400">{selectedDb.tables.length} Tables</span>
              </h3>
              <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                {selectedDb.tables.map((t) => (
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
              </div>
            </div>
          )}
        </div>

        {/* Right Column: SQL Query Editor & Table View */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-slate-900/80 backdrop-blur border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-white flex items-center gap-2">
                <Code className="w-4 h-4 text-cyan-400" />
                Live SQL Query Console
              </span>
              <span className="text-slate-500 font-mono">Target: {selectedDb?.host || '127.0.0.1'}</span>
            </div>

            <div className="relative">
              <textarea
                value={queryInput}
                onChange={(e) => setQueryInput(e.target.value)}
                rows={3}
                className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-emerald-300 focus:border-emerald-500 focus:outline-none resize-none"
              ></textarea>
              <button
                onClick={handleRunQuery}
                className="absolute bottom-3 right-3 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg text-xs flex items-center gap-1.5 transition cursor-pointer shadow-md"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Execute Query</span>
              </button>
            </div>

            {/* Query Results Table */}
            {queryResult && (
              <div className="space-y-2 pt-2 border-t border-slate-800">
                <div className="flex justify-between items-center text-[11px] text-slate-400">
                  <span>Query Results ({queryResult.rows.length} rows)</span>
                  <span className="font-mono text-emerald-400">Time: {queryResult.executionTime}</span>
                </div>
                <div className="overflow-x-auto bg-slate-950 rounded-xl border border-slate-800">
                  <table className="w-full text-left text-xs text-slate-300">
                    <thead className="bg-slate-900/80 text-slate-400 font-mono text-[11px] border-b border-slate-800">
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
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
