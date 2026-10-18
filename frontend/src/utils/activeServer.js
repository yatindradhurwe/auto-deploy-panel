/**
 * The server currently selected in the panel.
 *
 * Every /api/ request automatically carries it as the X-Server-Id header, so each screen (project
 * hub, studio, databases, env, logs, …) talks to the selected server without having to pass it
 * along itself.
 *
 * The choice is remembered per user (another account in the same browser never inherits it) and
 * per tab (sessionStorage), so two tabs can work on two servers without switching each other.
 * localStorage only seeds a new tab with the user's last choice.
 */

const STORAGE_PREFIX = 'autodeploy_active_server'
let activeServerId = ''
let storageKey = ''

const read = (store) => {
  try { return store.getItem(storageKey) || '' } catch { return '' }
}
const write = (store, id) => {
  try { id ? store.setItem(storageKey, id) : store.removeItem(storageKey) } catch { /* private mode */ }
}

/** Switches to the given user's remembered server ('' when signed out) and returns it. */
export function loadActiveServerFor(userId) {
  storageKey = userId ? `${STORAGE_PREFIX}:${userId}` : ''
  activeServerId = storageKey ? read(sessionStorage) || read(localStorage) : ''
  try { localStorage.removeItem(STORAGE_PREFIX) } catch { /* legacy shared key */ }
  return activeServerId
}

export function getActiveServerId() {
  return activeServerId
}

export function setActiveServerId(id) {
  id = id || ''
  if (id === activeServerId) return
  activeServerId = id
  if (storageKey) {
    write(sessionStorage, id)
    write(localStorage, id)
  }
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
    const pending = nativeFetch(input, init)
    // The selected server was removed elsewhere: let the servers store pick a valid one
    pending.then((res) => {
      if (res.status === 404 && res.headers.get('X-Server-Missing')) window.dispatchEvent(new Event('autodeploy:server-missing'))
    }, () => {})
    return pending
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
    if (this.__adApi) {
      this.addEventListener('load', () => {
        if (this.status === 404 && this.getResponseHeader('X-Server-Missing')) window.dispatchEvent(new Event('autodeploy:server-missing'))
      }, { once: true })
    }
    return nativeSend.call(this, body)
  }
}
