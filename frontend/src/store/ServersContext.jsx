import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer } from 'react'
import { useAuth } from './AuthContext'
import { apiRequest } from '../hooks/useApi'
import { loadActiveServerFor, setActiveServerId as rememberActiveServer } from '../utils/activeServer'

/**
 * Servers of the signed-in organization and the one selected in the panel.
 * The selection is also mirrored to utils/activeServer so every /api/ call carries X-Server-Id.
 * Until the list has loaded the selection is unconfirmed, and screens wait for `ready`.
 */

const initialState = { servers: [], activeServerId: '', loading: true, loaded: false, error: '' }

function reducer(state, action) {
  switch (action.type) {
    case 'LOADING':
      return { ...state, loading: true, error: '' }
    case 'LOADED': {
      const { servers } = action
      // Keep the remembered server if it still exists; otherwise fall back to the first one
      const activeServerId = servers.some((s) => s.id === state.activeServerId) ? state.activeServerId : (servers[0]?.id || '')
      return { ...state, servers, activeServerId, loading: false, loaded: true }
    }
    case 'LIVE_STATUS': {
      const byId = new Map(action.servers.map((s) => [s.id, s]))
      return { ...state, servers: state.servers.map((s) => (byId.has(s.id) ? { ...s, ...byId.get(s.id) } : s)) }
    }
    case 'FAILED':
      return { ...state, loading: false, error: action.error }
    case 'SELECT':
      // Only servers of this account can be selected
      if (action.id && state.loaded && !state.servers.some((s) => s.id === action.id)) return state
      return { ...state, activeServerId: action.id || '' }
    default:
      return state
  }
}

const ServersContext = createContext(null)

export function ServersProvider({ children }) {
  const { token, user } = useAuth()
  const [state, dispatch] = useReducer(reducer, user?.id, (userId) => ({ ...initialState, activeServerId: loadActiveServerFor(userId) }))

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

  // Signed out / switched account: stop sending this account's server with requests
  useEffect(() => () => { loadActiveServerFor('') }, [])

  // The API says the selected server is gone (removed in another tab or by a teammate)
  useEffect(() => {
    const onMissing = () => refresh()
    window.addEventListener('autodeploy:server-missing', onMissing)
    return () => window.removeEventListener('autodeploy:server-missing', onMissing)
  }, [refresh])

  const value = useMemo(() => ({
    ...state,
    activeServer: state.servers.find((s) => s.id === state.activeServerId) || null,
    ready: state.loaded,
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
