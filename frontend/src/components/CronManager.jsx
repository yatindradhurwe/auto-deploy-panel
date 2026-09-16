import React, { useState, useEffect } from 'react'
import {
  Clock, Plus, RefreshCw, CheckCircle2, Play, AlertCircle,
  Calendar, Terminal, Trash2, Zap
} from 'lucide-react'

export default function CronManager({ jwtToken }) {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)

  // New Cron Form
  const [schedule, setSchedule] = useState('0 3 * * *')
  const [command, setCommand] = useState('/var/www/scripts/backup_db.sh')
  const [saving, setSaving] = useState(false)
  const [saveResult, setSaveResult] = useState(null)

  const fetchCronJobs = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/studio/cron/list', {
        headers: { 'Authorization': jwtToken ? `Bearer ${jwtToken}` : '' }
      })
      const data = await res.json()
      if (data.success && data.jobs) {
        setJobs(data.jobs)
      }
    } catch (e) {
      console.error('Failed to fetch cron jobs:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchCronJobs()
  }, [jwtToken])

  const handlePreset = (presetSchedule, defaultCmd) => {
    setSchedule(presetSchedule)
    if (defaultCmd) setCommand(defaultCmd)
  }

  const handleAddCron = async (e) => {
    e.preventDefault()
    if (!schedule || !command) return
    setSaving(true)
    setSaveResult(null)
    try {
      const res = await fetch('/api/studio/cron/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': jwtToken ? `Bearer ${jwtToken}` : ''
        },
        body: JSON.stringify({ schedule, command })
      })
      const data = await res.json()
      if (data.success) {
        setSaveResult({ type: 'success', message: data.message })
        await fetchCronJobs()
      } else {
        setSaveResult({ type: 'error', message: data.error })
      }
    } catch (err) {
      setSaveResult({ type: 'error', message: err.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 text-slate-100 font-sans">
      {/* Top Header Card */}
      <div className="bg-slate-900/80 border border-white/10 backdrop-blur-2xl rounded-3xl p-6 shadow-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-2xl bg-amber-500/10 text-amber-400 border border-amber-500/20 shadow-inner">
              <Clock className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-black text-white tracking-tight flex items-center gap-2">
                Cron Jobs & Scheduled Automation Studio
                <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2.5 py-0.5 rounded-full font-mono font-bold">TASK SCHEDULER</span>
              </h2>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                Automate server maintenance, background worker scripts, and database backup routines.
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={fetchCronJobs}
          className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10 px-4 py-2 rounded-xl font-mono flex items-center space-x-2 transition cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Sync Crontab</span>
        </button>
      </div>

      {/* Grid: Active Crontab & Add Form */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Active Jobs List (Col-Span 2) */}
        <div className="lg:col-span-2 bg-slate-900/80 border border-white/10 rounded-3xl p-6 shadow-2xl space-y-4">
          <h3 className="text-sm font-bold text-white font-mono flex items-center gap-2">
            <Calendar className="w-4 h-4 text-amber-400" />
            Active Scheduled Crontab Tasks ({jobs.length})
          </h3>

          <div className="space-y-3">
            {jobs.map((job) => (
              <div
                key={job.id}
                className="bg-slate-950/80 border border-white/10 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
              >
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-mono font-bold text-amber-300 bg-amber-950/80 border border-amber-800/80 px-2.5 py-0.5 rounded">
                      {job.schedule}
                    </span>
                    <span className="text-xs font-bold text-white font-mono">{job.description || 'Scheduled Worker'}</span>
                  </div>
                  <p className="text-xs font-mono text-slate-400 truncate max-w-lg">
                    Command: <code className="text-cyan-300">{job.command}</code>
                  </p>
                </div>

                <div className="flex items-center space-x-2">
                  <span className="text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-2.5 py-1 rounded-full font-bold">
                    RUNNING
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Add New Cron Form */}
        <div className="bg-slate-900/80 border border-white/10 rounded-3xl p-6 shadow-2xl space-y-4">
          <h3 className="text-sm font-bold text-white font-mono flex items-center gap-2">
            <Plus className="w-4 h-4 text-cyan-400" />
            Add New Cron Task
          </h3>

          {/* Quick Presets */}
          <div className="space-y-2">
            <span className="text-[11px] font-mono text-slate-400 block">Quick Schedule Presets:</span>
            <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
              <button
                type="button"
                onClick={() => handlePreset('*/5 * * * *', 'curl -s https://mywebsite.com/api/ping')}
                className="bg-slate-950 hover:bg-slate-800 text-cyan-300 border border-white/10 p-2 rounded-xl text-left cursor-pointer transition"
              >
                <span className="font-bold block">Every 5 mins</span>
                <span className="text-slate-500">*/5 * * * *</span>
              </button>
              <button
                type="button"
                onClick={() => handlePreset('0 * * * *', 'node /var/www/scripts/sync.js')}
                className="bg-slate-950 hover:bg-slate-800 text-cyan-300 border border-white/10 p-2 rounded-xl text-left cursor-pointer transition"
              >
                <span className="font-bold block">Every Hour</span>
                <span className="text-slate-500">0 * * * *</span>
              </button>
              <button
                type="button"
                onClick={() => handlePreset('0 0 * * *', '/var/www/scripts/backup_db.sh')}
                className="bg-slate-950 hover:bg-slate-800 text-cyan-300 border border-white/10 p-2 rounded-xl text-left cursor-pointer transition"
              >
                <span className="font-bold block">Daily Midnight</span>
                <span className="text-slate-500">0 0 * * *</span>
              </button>
              <button
                type="button"
                onClick={() => handlePreset('0 0 * * 0', 'pm2 reloadLogs')}
                className="bg-slate-950 hover:bg-slate-800 text-cyan-300 border border-white/10 p-2 rounded-xl text-left cursor-pointer transition"
              >
                <span className="font-bold block">Weekly Sunday</span>
                <span className="text-slate-500">0 0 * * 0</span>
              </button>
            </div>
          </div>

          <form onSubmit={handleAddCron} className="space-y-3 text-xs font-mono pt-2">
            <div>
              <label className="text-slate-400 block mb-1">5-Field Cron Expression</label>
              <input
                type="text"
                value={schedule}
                onChange={(e) => setSchedule(e.target.value)}
                placeholder="* * * * *"
                className="w-full bg-slate-950 border border-white/10 rounded-xl px-3.5 py-2.5 text-amber-300 font-bold focus:outline-none focus:border-cyan-500/50"
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1">Executable Command / Script Path</label>
              <input
                type="text"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="/path/to/script.sh"
                className="w-full bg-slate-950 border border-white/10 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-cyan-500/50"
              />
            </div>

            <button
              type="submit"
              disabled={saving || !schedule || !command}
              className="w-full bg-gradient-to-r from-amber-600 via-orange-600 to-yellow-600 hover:from-amber-500 hover:to-yellow-500 text-white font-bold py-2.5 rounded-xl shadow-lg transition flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-50"
            >
              <Zap className="w-4 h-4" />
              <span>{saving ? 'Updating Crontab...' : 'Add Scheduled Task'}</span>
            </button>
          </form>

          {saveResult && (
            <div className={`p-3.5 rounded-xl text-xs font-mono border ${
              saveResult.type === 'success' ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300' : 'bg-rose-950/60 border-rose-500/40 text-rose-300'
            }`}>
              {saveResult.message}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
