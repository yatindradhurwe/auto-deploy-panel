import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer } from 'react'
import { useAuth } from './AuthContext'
import { apiRequest } from '../hooks/useApi'
import { getActiveServerId, setActiveServerId as rememberActiveServer } from '../utils/activeServer'

/**
 * Servers of the signed-in organization and the one selected in the panel.
 * The selection is also mirrored to utils/activeServer so every /api/ call carries X-Server-Id.
 */

const initialState = { servers: [], activeServerId: getActiveServerId() || '', loading: true, error: '' }

function reducer(state, action) {
  switch (action.type) {
    case 'LOADING':
      return { ...state, loading: true, error: '' }
    case 'LOADED': {
      const { servers } = action
      // Keep the remembered server if it still exists; otherwise fall back to the first one
      const activeServerId = servers.some((s) => s.id === state.activeServerId) ? state.activeServerId : (servers[0]?.id || '')
      return { ...state, servers, activeServerId, loading: false }
    }
    case 'LIVE_STATUS': {
      const byId = new Map(action.servers.map((s) => [s.id, s]))
      return { ...state, servers: state.servers.map((s) => (byId.has(s.id) ? { ...s, ...byId.get(s.id) } : s)) }
    }
    case 'FAILED':
      return { ...state, loading: false, error: action.error }
    case 'SELECT':
      return { ...state, activeServerId: action.id || '' }
    default:
      return state
  }
}

const ServersContext = createContext(null)

export function ServersProvider({ children }) {
  const { token } = useAuth()
  const [state, dispatch] = useReducer(reducer, initialState)

  const refresh = useCallback(async () => {
    dispatch({ type: 'LOADING' })
    try {
      const data = await apiRequest(token, '/api/agent/servers')
      dispatch({ type: 'LOADED', servers: data.servers || [] })
      // Live reachability and load; organization users without server access just skip it
      apiRequest(token, '/api/studio/servers')
        .then((live) => live?.servers && dispatch({ type: 'LIVE_STATUS', servers: live.servers }))
        .catch(() => {})
    } catch (err) {
      dispatch({ type: 'FAILED', error: err.message })
    }
  }, [token])

  const selectServer = useCallback((id) => dispatch({ type: 'SELECT', id }), [])

  /** Connects a new server (SSH details are verified by the API) and selects it. */
  const connectServer = useCallback(async (form) => {
    const data = await apiRequest(token, '/api/agent/servers', { method: 'POST', body: form })
    await refresh()
    if (data.server?.id) dispatch({ type: 'SELECT', id: data.server.id })
    return data
  }, [token, refresh])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Every API request targets the selected server (see utils/activeServer)
  useEffect(() => {
    rememberActiveServer(state.activeServerId)
  }, [state.activeServerId])

  const value = useMemo(() => ({
    ...state,
    activeServer: state.servers.find((s) => s.id === state.activeServerId) || state.servers[0] || null,
    refresh,
    selectServer,
    connectServer
  }), [state, refresh, selectServer, connectServer])

  return <ServersContext.Provider value={value}>{children}</ServersContext.Provider>
}

export function useServers() {
  const ctx = useContext(ServersContext)
  if (!ctx) throw new Error('useServers must be used inside <ServersProvider>')
  return ctx
}
