import React, { useState, useEffect } from 'react'
import { Key, Save, Plus, Trash2, Eye, EyeOff, RefreshCw, FileText, CheckCircle2, Lock, Sparkles, Folder, Code } from 'lucide-react'

export default function EnvManager({ jwtToken }) {
  const [projects, setProjects] = useState([])
  const [selectedProject, setSelectedProject] = useState(null)
  const [envVars, setEnvVars] = useState([])
  const [rawContent, setRawContent] = useState('')
  const [envPath, setEnvPath] = useState('')
  const [editMode, setEditMode] = useState('table') // 'table' | 'raw'
  const [showSecrets, setShowSecrets] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState(null)

  useEffect(() => {
    fetchProjects()
  }, [])

  useEffect(() => {
    if (selectedProject) {
      fetchEnv(selectedProject.path)
    }
  }, [selectedProject])

  const fetchProjects = async () => {
    try {
      const res = await fetch('/api/studio/projects', {
        headers: { 'Authorization': `Bearer ${jwtToken}` }
      })
      const data = await res.json()
      if (data.success && data.projects.length > 0) {
        setProjects(data.projects)
        setSelectedProject(data.projects[0])
      }
    } catch (e) {
      console.error('Failed to load projects', e)
    }
  }

  const fetchEnv = async (projectPath) => {
    setLoading(true)
    setSaveMessage(null)
    try {
      const res = await fetch('/api/studio/env/get', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify({ projectPath })
      })
      const data = await res.json()
      if (data.success) {
        setEnvVars(data.envVars || [])
        setRawContent(data.rawContent || '')
        setEnvPath(data.envPath || '')
      }
    } catch (e) {
      console.error('Failed to fetch .env', e)
    } finally {
      setLoading(false)
    }
  }

  const handleAddVar = () => {
    setEnvVars([...envVars, { key: 'NEW_ENV_KEY', value: 'value' }])
  }

  const handleDeleteVar = (index) => {
    const updated = envVars.filter((_, i) => i !== index)
    setEnvVars(updated)
  }

  const handleVarChange = (index, field, val) => {
    const updated = [...envVars]
    updated[index][field] = val
    setEnvVars(updated)
  }

  const toggleSecretShow = (key) => {
    setShowSecrets((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const handleSaveEnv = async () => {
    if (!selectedProject) return
    setSaving(true)
    setSaveMessage(null)

    try {
      const payload = {
        projectPath: selectedProject.path,
        rawContent: editMode === 'raw' ? rawContent : null,
        envVars: editMode === 'table' ? envVars : null
      }

      const res = await fetch('/api/studio/env/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify(payload)
      })
      const data = await res.json()
      if (data.success) {
        setSaveMessage('.env configuration saved & applied successfully!')
        fetchEnv(selectedProject.path)
        setTimeout(() => setSaveMessage(null), 4000)
      } else {
        alert(`Failed to save .env: ${data.error}`)
      }
    } catch (err) {
      alert(`Error saving .env: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 font-sans">
      {/* Top Banner & Project Target Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/60 backdrop-blur-2xl border border-white/10 rounded-3xl p-6 shadow-2xl shadow-slate-950/50">
        <div className="flex items-center space-x-4">
          <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 ring-1 ring-amber-500/20 shadow-md">
            <Key className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h2 className="text-xl font-extrabold text-white tracking-tight flex items-center gap-2">
                Environment Variables & Secrets Vault
              </h2>
              <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-amber-950/90 border border-amber-800 text-amber-300 font-mono font-bold">
                .env Manager
              </span>
            </div>
            <p className="text-xs text-slate-400 font-mono flex items-center gap-2">
              Target Path: <span className="text-cyan-300 font-semibold">{envPath || 'Loading...'}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <label className="text-xs font-mono text-slate-400 uppercase font-bold">Project Target:</label>
          <select
            value={selectedProject?.id || ''}
            onChange={(e) => {
              const p = projects.find((proj) => proj.id === e.target.value)
              if (p) setSelectedProject(p)
            }}
            className="bg-slate-950/90 border border-amber-500/40 text-amber-300 text-xs font-mono px-3.5 py-2 rounded-2xl focus:outline-none focus:border-amber-400 cursor-pointer shadow-inner"
          >
            {projects.map((proj) => (
              <option key={proj.id} value={proj.id}>
                {proj.name} ({proj.repoName})
              </option>
            ))}
          </select>
        </div>
      </div>

      {saveMessage && (
        <div className="p-4 bg-emerald-950/90 border border-emerald-800 rounded-2xl text-xs text-emerald-300 flex items-center gap-2.5 font-mono shadow-xl animate-fadeIn">
          <CheckCircle2 className="w-4.5 h-4.5 text-emerald-400 shrink-0" />
          <span className="font-bold">{saveMessage}</span>
        </div>
      )}

      {/* Main .env Editor Card */}
      <div className="bg-slate-900/60 backdrop-blur-2xl border border-white/10 rounded-3xl overflow-hidden shadow-2xl shadow-slate-950/50 space-y-0">
        
        {/* Editor Toolbar Header */}
        <div className="p-4 border-b border-white/10 bg-slate-950/90 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-extrabold text-white uppercase font-mono tracking-wider">Project Secrets Configuration</span>
            <span className="text-[10px] text-slate-400 font-mono bg-slate-900 px-2.5 py-0.5 rounded-xl border border-white/5 font-bold">
              {envVars.length} Variables Defined
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* View Mode Toggle */}
            <div className="flex items-center bg-slate-900 p-1 rounded-2xl border border-white/10 font-mono text-[11px]">
              <button
                onClick={() => setEditMode('table')}
                className={`px-3 py-1 rounded-xl transition cursor-pointer font-bold ${
                  editMode === 'table' ? 'bg-amber-500 text-slate-950 shadow-md' : 'text-slate-400 hover:text-white'
                }`}
              >
                Table Grid
              </button>
              <button
                onClick={() => setEditMode('raw')}
                className={`px-3 py-1 rounded-xl transition cursor-pointer font-bold ${
                  editMode === 'raw' ? 'bg-amber-500 text-slate-950 shadow-md' : 'text-slate-400 hover:text-white'
                }`}
              >
                Raw .env
              </button>
            </div>

            {editMode === 'table' && (
              <button
                onClick={handleAddVar}
                className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/30 rounded-xl font-bold text-xs flex items-center gap-1.5 transition cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Variable</span>
              </button>
            )}

            <button
              onClick={handleSaveEnv}
              disabled={saving}
              className="px-4 py-1.5 bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-extrabold rounded-xl text-xs flex items-center gap-1.5 transition cursor-pointer shadow-lg shadow-amber-950/50 disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? 'Saving...' : 'Save .env File'}</span>
            </button>
          </div>
        </div>

        {/* Editor Body */}
        {loading ? (
          <div className="flex items-center justify-center p-12 text-slate-400 text-xs font-mono">
            <RefreshCw className="w-5 h-5 animate-spin text-amber-400 mr-2" />
            Loading project environment variables...
          </div>
        ) : editMode === 'table' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-200">
              <thead className="bg-slate-950/80 text-slate-400 font-mono border-b border-white/10 uppercase text-[10px] tracking-wider font-bold">
                <tr>
                  <th className="py-3.5 px-5">Variable Key</th>
                  <th className="py-3.5 px-5">Secret Value</th>
                  <th className="py-3.5 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-mono">
                {envVars.map((item, idx) => {
                  const isVisible = showSecrets[item.key]
                  return (
                    <tr key={idx} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-3.5 px-5 w-1/3">
                        <input
                          type="text"
                          value={item.key}
                          onChange={(e) => handleVarChange(idx, 'key', e.target.value)}
                          className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-amber-300 font-bold focus:outline-none focus:border-amber-400 shadow-inner"
                        />
                      </td>
                      <td className="py-3.5 px-5">
                        <div className="relative">
                          <input
                            type={isVisible ? 'text' : 'password'}
                            value={item.value}
                            onChange={(e) => handleVarChange(idx, 'value', e.target.value)}
                            className="w-full bg-slate-950 border border-white/10 rounded-xl pl-3 pr-9 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-amber-400 shadow-inner"
                          />
                          <button
                            type="button"
                            onClick={() => toggleSecretShow(item.key)}
                            className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-200 transition"
                          >
                            {isVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </td>
                      <td className="py-3.5 px-5 text-right">
                        <button
                          onClick={() => handleDeleteVar(idx)}
                          className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 rounded-xl transition cursor-pointer"
                          title="Delete Variable"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-4 bg-[#080B11]">
            <textarea
              value={rawContent}
              onChange={(e) => setRawContent(e.target.value)}
              rows={16}
              spellCheck={false}
              className="w-full p-4 bg-slate-950 text-amber-300 font-mono text-xs border border-white/10 rounded-2xl focus:outline-none focus:border-amber-400 resize-none leading-relaxed shadow-inner"
            ></textarea>
          </div>
        )}

      </div>
    </div>
  )
}
