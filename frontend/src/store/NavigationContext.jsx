import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer } from 'react'
import { getActiveServerId } from '../utils/activeServer'

/**
 * Where the organization panel is: which screen, which tab and which project studio is open.
 * The URL is the source of truth, so a reload, a shared link or back/forward lands on the same view.
 *
 *  /app/servers               server connect landing (default after login)
 *  /app/hub/<tab>             projects hub and its sub views (databases, email, deployments…)
 *  /app/workspace/<tab>       sidebar workspace
 *  /app/project/<server>/<name>  dedicated project studio; the server is part of the address so
 *                                 a project never opens against another server with the same name
 */

const BASE = '/app'
const PROJECT_KEY = 'autodeploy_open_project'

export const projectRouteName = (project) =>
  project?.name || project?.repoName || String(project?.path || '').split('/').filter(Boolean).pop() || ''

function readStoredProject({ projectName, projectServerId }) {
  if (!projectName) return null
  try {
    const stored = JSON.parse(sessionStorage.getItem(PROJECT_KEY) || 'null')
    return stored && projectRouteName(stored) === projectName && (!projectServerId || stored.serverId === projectServerId) ? stored : null
  } catch { return null }
}

function storeProject(project) {
  try { project ? sessionStorage.setItem(PROJECT_KEY, JSON.stringify(project)) : sessionStorage.removeItem(PROJECT_KEY) } catch { /* private mode */ }
}

const EMPTY_ROUTE = { viewStep: 'servers', activeTab: 'projects', projectName: '', projectServerId: '' }

export function parsePanelPath(pathname = window.location.pathname) {
  const [, , section = '', ...rest] = pathname.split('/')
  const params = rest.filter(Boolean).map((p) => { try { return decodeURIComponent(p) } catch { return p } })
  if (section === 'hub') return { ...EMPTY_ROUTE, viewStep: 'hub', activeTab: params[0] || 'projects' }
  if (section === 'workspace') return { ...EMPTY_ROUTE, viewStep: 'workspace', activeTab: params[0] || 'dashboard' }
  if (section === 'project' && params.length >= 2) return { ...EMPTY_ROUTE, viewStep: 'project', projectServerId: params[0], projectName: params[1] }
  if (section === 'project' && params.length === 1) return { ...EMPTY_ROUTE, viewStep: 'project', projectName: params[0] } // older links
  return EMPTY_ROUTE
}

function pathFor({ viewStep, activeTab, projectName, projectServerId }) {
  if (viewStep === 'hub') return `${BASE}/hub/${encodeURIComponent(activeTab || 'projects')}`
  if (viewStep === 'workspace') return `${BASE}/workspace/${encodeURIComponent(activeTab || 'dashboard')}`
  if (viewStep === 'project' && projectName) {
    return `${BASE}/project/${projectServerId ? `${encodeURIComponent(projectServerId)}/` : ''}${encodeURIComponent(projectName)}`
  }
  return `${BASE}/servers`
}

function initialState() {
  const route = parsePanelPath()
  const project = readStoredProject(route)
  return { ...route, projectServerId: route.projectServerId || project?.serverId || '', project }
}

function reducer(state, action) {
  switch (action.type) {
    case 'ROUTE':
      return { ...action.route, project: action.project !== undefined ? action.project : state.project }
    case 'PROJECT_RESOLVED':
      return state.projectName === projectRouteName(action.project) && (!state.projectServerId || state.projectServerId === action.project.serverId)
        ? { ...state, projectServerId: action.project.serverId, project: action.project }
        : state
    default:
      return state
  }
}

const NavigationContext = createContext(null)

export function NavigationProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState)

  // Normalize the address bar (e.g. /app/dashboard → /app/servers) without adding a history entry
  useEffect(() => {
    const path = pathFor(state)
    if (window.location.pathname !== path) window.history.replaceState(null, '', path)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Browser back / forward
  useEffect(() => {
    const onPop = () => {
      const route = parsePanelPath()
      dispatch({ type: 'ROUTE', route, project: readStoredProject(route) })
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const go = useCallback((route, project = null) => {
    const next = { ...EMPTY_ROUTE, ...route }
    const path = pathFor(next)
    if (window.location.pathname !== path) window.history.pushState(null, '', path)
    dispatch({ type: 'ROUTE', route: next, project })
  }, [])

  const showServers = useCallback(() => go({ viewStep: 'servers' }), [go])
  const showHub = useCallback((tab = 'projects') => go({ viewStep: 'hub', activeTab: tab }), [go])
  const showWorkspace = useCallback((tab = 'dashboard') => go({ viewStep: 'workspace', activeTab: tab }), [go])

  /** Switches tab within the current screen (the hub when on the landing or in a project). */
  const setActiveTab = useCallback((tab) => {
    go({ viewStep: state.viewStep === 'workspace' ? 'workspace' : 'hub', activeTab: tab })
  }, [go, state.viewStep])

  /** Opens a project studio, bound to the server the project lives on. */
  const openProject = useCallback((project) => {
    const pinned = { ...project, serverId: project.serverId || getActiveServerId() }
    storeProject(pinned)
    go({ viewStep: 'project', projectName: projectRouteName(pinned), projectServerId: pinned.serverId }, pinned)
  }, [go])

  const closeProject = useCallback(() => {
    storeProject(null)
    go({ viewStep: 'hub', activeTab: 'projects' })
  }, [go])

  /** Fills in the open project after a reload when it was not cached in this tab. */
  const resolveProject = useCallback((project) => {
    storeProject(project)
    dispatch({ type: 'PROJECT_RESOLVED', project })
  }, [])

  const value = useMemo(() => ({
    ...state,
    showServers,
    showHub,
    showWorkspace,
    setActiveTab,
    openProject,
    closeProject,
    resolveProject
  }), [state, showServers, showHub, showWorkspace, setActiveTab, openProject, closeProject, resolveProject])

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>
}

export function useNavigation() {
  const ctx = useContext(NavigationContext)
  if (!ctx) throw new Error('useNavigation must be used inside <NavigationProvider>')
  return ctx
}
