import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer } from 'react'
import { useAuth } from './AuthContext'
import { useServers } from './ServersContext'
import { apiRequest } from '../hooks/useApi'

/**
 * Projects on the selected server, the caller's access to each, and project sharing.
 *
 * Every project from the API carries `access`:
 *  'super' | 'owner'  full control (platform super admin / organization owner or admin)
 *  'manager'          shared: deploy, restart, logs, env, files, git
 *  'viewer'           shared: status, logs, git history
 */

export const ACCESS_LABELS = { super: 'Super admin', owner: 'Full access', manager: 'Manager', viewer: 'Viewer' }

export const canManageProject = (project) => ['super', 'owner', 'manager'].includes(project?.access)
export const canShareProject = (project) => ['super', 'owner'].includes(project?.access)

const initialState = { projects: [], loading: false, error: '', errorCode: '', serverId: '', sharedWithMe: [], fullAccess: false }

function reducer(state, action) {
  switch (action.type) {
    case 'LOADING':
      // Another server: drop the previous server's projects right away so they are never shown under it
      return action.serverId === state.serverId
        ? { ...state, loading: true, error: '', errorCode: '' }
        : { ...state, projects: [], loading: true, error: '', errorCode: '', serverId: action.serverId }
    case 'LOADED':
      // Ignore a late answer for a server that is no longer selected
      return action.serverId === state.serverId ? { ...state, projects: action.projects, loading: false } : state
    case 'FAILED':
      return action.serverId === state.serverId ? { ...state, projects: [], loading: false, error: action.error, errorCode: action.code || '' } : state
    case 'SHARED_WITH_ME':
      return { ...state, sharedWithMe: action.shares, fullAccess: action.fullAccess }
    case 'RESET':
      return { ...initialState }
    default:
      return state
  }
}

const ProjectsContext = createContext(null)

export function ProjectsProvider({ children }) {
  const { token } = useAuth()
  const { activeServerId: selectedServerId, ready: serversReady } = useServers()
  // Wait for the server list, so a remembered but removed server is never queried
  const activeServerId = serversReady ? selectedServerId : ''
  const [state, dispatch] = useReducer(reducer, initialState)

  const api = useCallback((path, options = {}) => apiRequest(token, path, {
    ...options,
    headers: { ...(activeServerId ? { 'X-Server-Id': activeServerId } : {}), ...(options.headers || {}) }
  }), [token, activeServerId])

  const refresh = useCallback(async () => {
    if (!activeServerId) {
      dispatch({ type: 'RESET' })
      return
    }
    dispatch({ type: 'LOADING', serverId: activeServerId })
    try {
      const data = await api(`/api/studio/projects?serverId=${encodeURIComponent(activeServerId)}`)
      dispatch({ type: 'LOADED', serverId: activeServerId, projects: data.projects || [] })
    } catch (err) {
      dispatch({ type: 'FAILED', serverId: activeServerId, error: err.message, code: err.code })
    }
  }, [api, activeServerId])

  const refreshSharedWithMe = useCallback(async () => {
    try {
      const data = await api('/api/projects/shared-with-me')
      dispatch({ type: 'SHARED_WITH_ME', shares: data.shares || [], fullAccess: !!data.fullAccess })
    } catch { /* not critical */ }
  }, [api])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    refreshSharedWithMe()
  }, [refreshSharedWithMe])

  // --- Sharing (organization owners/admins) ---------------------------------------------------

  const getShares = useCallback((project) =>
    api(`/api/projects/shares?projectPath=${encodeURIComponent(project.path)}`), [api])

  const shareProject = useCallback((project, userId, role) => api('/api/projects/shares', {
    method: 'POST',
    body: {
      projectPath: project.path,
      projectName: project.name,
      appNames: (project.pm2Processes || []).map((p) => p.name),
      userId,
      role
    }
  }), [api])

  // --- MCP access tokens (managers of a project) ---------------------------------------------

  const getMcpTokens = useCallback((project) =>
    api(`/api/projects/mcp/tokens?projectPath=${encodeURIComponent(project.path)}`), [api])

  const createMcpToken = useCallback((project, { name, access, expiresInDays }) => api('/api/projects/mcp/tokens', {
    method: 'POST',
    body: { projectPath: project.path, projectName: project.name, name, access, expiresInDays: Number(expiresInDays) }
  }), [api])

  const revokeMcpToken = useCallback((tokenId) => api(`/api/projects/mcp/tokens/${tokenId}`, { method: 'DELETE' }), [api])

  const updateShare = useCallback((shareId, role) => api(`/api/projects/shares/${shareId}`, { method: 'PATCH', body: { role } }), [api])
  const revokeShare = useCallback((shareId) => api(`/api/projects/shares/${shareId}`, { method: 'DELETE' }), [api])

  const value = useMemo(() => ({
    ...state,
    refresh,
    refreshSharedWithMe,
    getShares,
    shareProject,
    updateShare,
    revokeShare,
    getMcpTokens,
    createMcpToken,
    revokeMcpToken
  }), [state, refresh, refreshSharedWithMe, getShares, shareProject, updateShare, revokeShare, getMcpTokens, createMcpToken, revokeMcpToken])

  return <ProjectsContext.Provider value={value}>{children}</ProjectsContext.Provider>
}

export function useProjects() {
  const ctx = useContext(ProjectsContext)
  if (!ctx) throw new Error('useProjects must be used inside <ProjectsProvider>')
  return ctx
}
