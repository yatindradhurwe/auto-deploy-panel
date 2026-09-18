import React, { useState, useEffect } from 'react'
import { ShieldCheck, Clock, User, Activity, RefreshCw, Search } from 'lucide-react'

export default function AuditLogViewer({ apiBaseUrl = '' }) {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')

  const fetchAuditLogs = async () => {
    setLoading(true)
    try {
      const token = localStorage.getItem('autodeploy_token')
      const res = await fetch(`${apiBaseUrl}/api/team/audit-logs`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json()
      if (data.logs) setLogs(data.logs)
    } catch (err) {
      console.error('Failed to fetch audit logs:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAuditLogs()
  }, [])

  const filteredLogs = logs.filter(
    (l) =>
      !filter ||
      l.action?.toLowerCase().includes(filter.toLowerCase()) ||
      l.resourceType?.toLowerCase().includes(filter.toLowerCase()) ||
      l.userId?.toLowerCase().includes(filter.toLowerCase())
  )

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/60 border border-slate-800 rounded-3xl p-6 backdrop-blur-xl">
        <div>
          <div className="flex items-center space-x-2 text-cyan-400 text-xs font-semibold uppercase tracking-wider mb-1">
            <ShieldCheck className="w-4 h-4" />
            <span>Compliance & Security Audit</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Organization Audit Trail</h1>
          <p className="text-xs text-slate-400 mt-1">Real-time immutable history of all security events and deployment actions</p>
        </div>

        <div className="flex items-center space-x-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
            <input
              type="text"
              placeholder="Search audit trail..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-4 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 w-56"
            />
          </div>
          <button
            onClick={fetchAuditLogs}
            className="p-2.5 bg-slate-800 hover:bg-slate-700 text-cyan-400 rounded-xl transition"
            title="Refresh logs"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl backdrop-blur-xl">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-950/60 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              <th className="py-4 px-6">Timestamp</th>
              <th className="py-4 px-6">Action</th>
              <th className="py-4 px-6">User / Actor</th>
              <th className="py-4 px-6">Resource Type</th>
              <th className="py-4 px-6">IP Address</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 text-xs text-slate-200 font-mono">
            {loading ? (
              <tr>
                <td colSpan="5" className="py-8 text-center text-slate-400">
                  Loading audit logs...
                </td>
              </tr>
            ) : filteredLogs.length === 0 ? (
              <tr>
                <td colSpan="5" className="py-8 text-center text-slate-400">
                  No audit log entries found.
                </td>
              </tr>
            ) : (
              filteredLogs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-800/40 transition">
                  <td className="py-3.5 px-6 text-slate-400 text-[11px]">
                    {new Date(log.timestamp).toLocaleString()}
                  </td>
                  <td className="py-3.5 px-6">
                    <span className="px-2 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 font-bold text-[10px]">
                      {log.action}
                    </span>
                  </td>
                  <td className="py-3.5 px-6 font-sans font-semibold text-slate-300">{log.userId}</td>
                  <td className="py-3.5 px-6 text-slate-400">{log.resourceType || 'system'}</td>
                  <td className="py-3.5 px-6 text-slate-500 text-[11px]">{log.ip || '127.0.0.1'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
