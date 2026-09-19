import React, { useState, useEffect } from 'react'
import {
  RefreshCw, ShieldCheck, AlertTriangle, Clock, CheckCircle2, XCircle,
  Search, Filter, Database, Zap, Lock, Layers, EyeOff
} from 'lucide-react'

export function AdminIdempotencyPanel({ jwtToken, apiBaseUrl = '' }) {
  const [stats, setStats] = useState(null)
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')

  const fetchIdempotencyData = async () => {
    setLoading(true)
    try {
      const headers = { 'Authorization': `Bearer ${jwtToken}` }
      const [resStats, resRecords] = await Promise.all([
        fetch(`${apiBaseUrl}/api/admin/idempotency/stats`, { headers }),
        fetch(`${apiBaseUrl}/api/admin/idempotency/records`, { headers })
      ])

      const dataStats = await resStats.json()
      const dataRecords = await resRecords.json()

      if (dataStats.success) setStats(dataStats.stats)
      if (dataRecords.success) setRecords(dataRecords.records || [])
    } catch (err) {
      console.error('Failed to load Idempotency system metrics:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchIdempotencyData()
  }, [jwtToken])

  const maskKey = (key) => {
    if (!key) return ''
    if (key.length <= 8) return '****'
    return `${key.slice(0, 4)}...${key.slice(-4)}`
  }

  const filteredRecords = records.filter(r => {
    const matchesSearch = (r.idempotencyKey || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                          (r.organizationId || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                          (r.requestPath || '').toLowerCase().includes(searchTerm.toLowerCase())
    const matchesStatus = statusFilter === 'ALL' || r.status === statusFilter
    return matchesSearch && matchesStatus
  })

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-slate-900/60 border border-purple-500/20 p-6 rounded-2xl backdrop-blur-xl">
        <div>
          <div className="flex items-center space-x-2">
            <ShieldCheck className="w-6 h-6 text-purple-400" />
            <h2 className="text-xl font-black text-white tracking-tight">System Idempotency Engine</h2>
            <span className="text-[10px] font-mono bg-purple-500/20 text-purple-300 border border-purple-500/30 px-2 py-0.5 rounded-full font-bold">
              MULTI-TENANT PROTECTION
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Real-time request deduplication, payload hash verification, crash recovery, and organization isolation.
          </p>
        </div>

        <button
          onClick={fetchIdempotencyData}
          disabled={loading}
          className="px-4 py-2 bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 border border-purple-500/40 rounded-xl text-xs font-bold flex items-center space-x-2 transition-all disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh System Audit</span>
        </button>
      </div>

      {/* Metrics Grid */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          <div className="bg-slate-900/40 border border-slate-800 p-4 rounded-xl">
            <div className="text-[10px] font-mono uppercase text-slate-400 font-bold">Total Operations</div>
            <div className="text-2xl font-black text-white mt-1">{stats.totalRequests}</div>
          </div>
          <div className="bg-slate-900/40 border border-cyan-500/30 p-4 rounded-xl">
            <div className="text-[10px] font-mono uppercase text-cyan-400 font-bold">New Operations</div>
            <div className="text-2xl font-black text-cyan-300 mt-1">{stats.newOperations}</div>
          </div>
          <div className="bg-slate-900/40 border border-emerald-500/30 p-4 rounded-xl">
            <div className="text-[10px] font-mono uppercase text-emerald-400 font-bold">Replayed Requests</div>
            <div className="text-2xl font-black text-emerald-300 mt-1">{stats.replayedRequests}</div>
          </div>
          <div className="bg-slate-900/40 border border-amber-500/30 p-4 rounded-xl">
            <div className="text-[10px] font-mono uppercase text-amber-400 font-bold">Conflicts Prevented</div>
            <div className="text-2xl font-black text-amber-300 mt-1">{stats.conflicts}</div>
          </div>
          <div className="bg-slate-900/40 border border-blue-500/30 p-4 rounded-xl">
            <div className="text-[10px] font-mono uppercase text-blue-400 font-bold">Processing</div>
            <div className="text-2xl font-black text-blue-300 mt-1">{stats.processing}</div>
          </div>
          <div className="bg-slate-900/40 border border-rose-500/30 p-4 rounded-xl">
            <div className="text-[10px] font-mono uppercase text-rose-400 font-bold">Failed Operations</div>
            <div className="text-2xl font-black text-rose-300 mt-1">{stats.failed}</div>
          </div>
          <div className="bg-slate-900/40 border border-slate-700 p-4 rounded-xl">
            <div className="text-[10px] font-mono uppercase text-slate-400 font-bold">Expired Keys</div>
            <div className="text-2xl font-black text-slate-300 mt-1">{stats.expired}</div>
          </div>
        </div>
      )}

      {/* Filter and Search */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-900/40 border border-slate-800 p-4 rounded-xl">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search key, org, endpoint..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
          />
        </div>

        <div className="flex items-center space-x-2 w-full sm:w-auto">
          <Filter className="w-4 h-4 text-slate-400" />
          <span className="text-xs text-slate-400 font-medium">Status Filter:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-purple-500"
          >
            <option value="ALL">All Statuses</option>
            <option value="COMPLETED">COMPLETED</option>
            <option value="PROCESSING">PROCESSING</option>
            <option value="FAILED">FAILED</option>
            <option value="EXPIRED">EXPIRED</option>
          </select>
        </div>
      </div>

      {/* Idempotency Records Table */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden backdrop-blur-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950/80 text-slate-400 font-mono text-[10px] uppercase border-b border-slate-800">
              <tr>
                <th className="p-4">Timestamp</th>
                <th className="p-4">Organization</th>
                <th className="p-4">Endpoint Path</th>
                <th className="p-4">Idempotency Key (Masked)</th>
                <th className="p-4">Status</th>
                <th className="p-4">Replayed?</th>
                <th className="p-4">HTTP Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {loading ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-500">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-purple-400" />
                    <span>Loading idempotency audit trail...</span>
                  </td>
                </tr>
              ) : filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-500">
                    No idempotency records found matching query.
                  </td>
                </tr>
              ) : (
                filteredRecords.map((rec) => {
                  const isCompleted = rec.status === 'COMPLETED'
                  const isProcessing = rec.status === 'PROCESSING'
                  const isFailed = rec.status === 'FAILED'

                  return (
                    <tr key={rec.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="p-4 font-mono text-[11px] text-slate-400">
                        {new Date(rec.createdAt).toLocaleString()}
                      </td>
                      <td className="p-4 font-semibold text-white">
                        {rec.organizationId}
                      </td>
                      <td className="p-4 font-mono text-cyan-300">
                        <span className="font-bold text-slate-400 mr-1.5">{rec.httpMethod}</span>
                        {rec.requestPath}
                      </td>
                      <td className="p-4 font-mono text-purple-300 flex items-center space-x-1.5">
                        <Lock className="w-3 h-3 text-purple-400" />
                        <span>{maskKey(rec.idempotencyKey)}</span>
                      </td>
                      <td className="p-4">
                        <span className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          isCompleted ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' :
                          isProcessing ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' :
                          isFailed ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40' :
                          'bg-slate-800 text-slate-400 border border-slate-700'
                        }`}>
                          {isCompleted && <CheckCircle2 className="w-3 h-3 mr-1 text-emerald-400" />}
                          {isProcessing && <Clock className="w-3 h-3 mr-1 text-amber-400 animate-spin" />}
                          {isFailed && <XCircle className="w-3 h-3 mr-1 text-rose-400" />}
                          <span>{rec.status}</span>
                        </span>
                      </td>
                      <td className="p-4">
                        {rec.replayedCount > 0 ? (
                          <span className="bg-purple-500/20 text-purple-300 border border-purple-500/40 px-2 py-0.5 rounded-full text-[10px] font-bold">
                            YES ({rec.replayedCount})
                          </span>
                        ) : (
                          <span className="text-slate-500 text-[10px]">NO</span>
                        )}
                      </td>
                      <td className="p-4 font-mono font-bold">
                        {rec.responseStatus ? (
                          <span className={rec.responseStatus < 400 ? 'text-emerald-400' : 'text-rose-400'}>
                            {rec.responseStatus}
                          </span>
                        ) : (
                          <span className="text-slate-600">-</span>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
