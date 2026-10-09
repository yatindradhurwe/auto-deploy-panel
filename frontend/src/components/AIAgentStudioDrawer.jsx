import React, { useState, useEffect } from 'react'
import { Bot, X } from 'lucide-react'
import ProjectAgentPanel from './ProjectAgentPanel'
import { useAuth } from '../store/AuthContext'
import { useServers } from '../store/ServersContext'
import { useProjects } from '../store/ProjectsContext'

/**
 * Slide-over drawer hosting the Claude project agent, with a project picker.
 * Used by Code Studio, the dashboard and the deployment copilot.
 */
export default function AIAgentStudioDrawer({ isOpen, onClose, projectPath, selectedProject, onCodeModified }) {
  const { token: jwtToken } = useAuth()
  const { activeServer } = useServers()
  const projects = useProjects().projects.filter(p => p.path)
  const [currentPath, setCurrentPath] = useState(selectedProject?.path || projectPath || '')

  useEffect(() => {
    if (selectedProject?.path || projectPath) setCurrentPath(selectedProject?.path || projectPath)
  }, [selectedProject?.path, projectPath])

  useEffect(() => {
    if (isOpen && !currentPath && projects[0]) setCurrentPath(projects[0].path)
  }, [isOpen, projects])

  if (!isOpen) return null

  const current = projects.find(p => p.path === currentPath)
  const name = selectedProject?.name || current?.name || currentPath.split('/').filter(Boolean).pop() || 'Project'

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <aside className="relative w-full max-w-xl h-full bg-[#07090E] border-l border-white/10 flex flex-col shadow-2xl">
        <div className="p-3.5 border-b border-slate-800 bg-slate-950 flex items-center gap-2 font-mono text-xs">
          <div className="p-1.5 rounded-lg bg-gradient-to-tr from-cyan-500 to-purple-600 text-slate-950"><Bot className="w-4 h-4" /></div>
          <span className="font-extrabold text-white">AI Project Agent</span>
          <select
            value={currentPath}
            onChange={(e) => setCurrentPath(e.target.value)}
            className="ml-auto max-w-[55%] bg-slate-900 border border-slate-800 text-cyan-300 rounded-lg px-2 py-1 text-[11px] font-bold focus:outline-none"
          >
            {currentPath && !projects.some(p => p.path === currentPath) && <option value={currentPath}>{currentPath}</option>}
            {projects.map(p => <option key={p.path} value={p.path}>{p.name || p.path}</option>)}
          </select>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white rounded cursor-pointer"><X className="w-4 h-4" /></button>
        </div>
        {currentPath ? (
          <ProjectAgentPanel
            key={currentPath}
            projectPath={currentPath}
            projectName={name}
            onFilesChanged={onCodeModified}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-xs text-slate-500 font-mono">Select a project.</div>
        )}
      </aside>
    </div>
  )
}
