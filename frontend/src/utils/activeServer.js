/**
 * The server currently selected in the panel.
 *
 * Every /api/ request automatically carries it as the X-Server-Id header, so each screen (project
 * hub, studio, databases, env, logs, …) talks to the selected server without having to pass it
 * along itself. The choice is remembered across reloads.
 */

const STORAGE_KEY = 'autodeploy_active_server'
let activeServerId = (() => {
  try { return localStorage.getItem(STORAGE_KEY) || '' } catch { return '' }
})()

export function getActiveServerId() {
  return activeServerId
}

export function setActiveServerId(id) {
  id = id || ''
  if (id === activeServerId) return
  activeServerId = id
  try { id ? localStorage.setItem(STORAGE_KEY, id) : localStorage.removeItem(STORAGE_KEY) } catch { /* private mode */ }
  window.dispatchEvent(new CustomEvent('autodeploy:server-changed', { detail: { id } }))
}

let installed = false

export function installServerHeader() {
  if (installed || typeof window === 'undefined') return
  installed = true
  const nativeFetch = window.fetch.bind(window)
  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || ''
    if (activeServerId && /\/api\//.test(url)) {
      const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined))
      // Fill in (or replace an empty) X-Server-Id; an explicit non-empty value from a caller wins
      if (!headers.get('X-Server-Id')) headers.set('X-Server-Id', activeServerId)
      init = { ...init, headers }
    }
    return nativeFetch(input, init)
  }
  const nativeOpen = XMLHttpRequest.prototype.open
  const nativeSend = XMLHttpRequest.prototype.send
  const nativeSetHeader = XMLHttpRequest.prototype.setRequestHeader
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__adApi = typeof url === 'string' && /\/api\//.test(url)
    this.__adHasServer = false
    return nativeOpen.call(this, method, url, ...rest)
  }
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (String(name).toLowerCase() === 'x-server-id') {
      if (!value) return // an empty value is filled in on send
      this.__adHasServer = true
    }
    return nativeSetHeader.call(this, name, value)
  }
  XMLHttpRequest.prototype.send = function (body) {
    if (this.__adApi && activeServerId && !this.__adHasServer) {
      try { nativeSetHeader.call(this, 'X-Server-Id', activeServerId) } catch { /* already sent */ }
    }
    return nativeSend.call(this, body)
  }
}
