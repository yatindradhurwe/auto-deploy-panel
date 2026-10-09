import { useCallback } from 'react'
import { useAuth } from '../store/AuthContext'

/**
 * JSON request with the session token. Throws an Error carrying the server's message,
 * plus `status` and `code`, when the response isn't OK (or `success: false`).
 */
export async function apiRequest(token, path, { method = 'GET', body, headers = {}, signal } = {}) {
  const res = await fetch(path, {
    method,
    signal,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.success === false) {
    throw Object.assign(new Error(data.error || data.message || `Request failed (${res.status})`), { status: res.status, code: data.code, data })
  }
  return data
}

/** `api(path, options)` bound to the signed-in session from the auth store. */
export function useApi() {
  const { token } = useAuth()
  return useCallback((path, options) => apiRequest(token, path, options), [token])
}
