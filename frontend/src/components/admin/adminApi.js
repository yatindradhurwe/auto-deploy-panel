/**
 * Small fetch wrapper for the Super Admin API. Throws an Error with the server's message on failure.
 */
export function getAuthToken() {
  return localStorage.getItem('autodeploy_token') || localStorage.getItem('autodeploy_jwt_token') || ''
}

export async function adminApi(path, { method = 'GET', body, apiBaseUrl = '' } = {}) {
  const res = await fetch(`${apiBaseUrl}/api/admin${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${getAuthToken()}`,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })
  let data = {}
  try {
    data = await res.json()
  } catch (e) {}
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`)
  }
  return data
}

export function formatDate(value, withTime = false) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return withTime
    ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : d.toLocaleDateString(undefined, { dateStyle: 'medium' })
}

export function timeAgo(value) {
  if (!value) return 'Never'
  const diff = Date.now() - new Date(value).getTime()
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return formatDate(value)
}

/**
 * Switches the browser session to an impersonation token, keeping the admin token so the
 * admin can return without logging in again.
 */
export function startImpersonation(token, user) {
  sessionStorage.setItem('autodeploy_admin_token', getAuthToken())
  sessionStorage.setItem('autodeploy_admin_user', localStorage.getItem('autodeploy_user') || '')
  localStorage.setItem('autodeploy_token', token)
  localStorage.removeItem('autodeploy_jwt_token')
  localStorage.setItem('autodeploy_user', JSON.stringify(user))
  localStorage.setItem('autodeploy_portal', 'panel')
  window.location.href = '/app/dashboard'
}

export function stopImpersonation() {
  // End the impersonation session on the server, not just in this browser
  const impersonationToken = getAuthToken()
  if (impersonationToken) {
    fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${impersonationToken}` }, keepalive: true }).catch(() => {})
  }
  const adminToken = sessionStorage.getItem('autodeploy_admin_token')
  const adminUser = sessionStorage.getItem('autodeploy_admin_user')
  sessionStorage.removeItem('autodeploy_admin_token')
  sessionStorage.removeItem('autodeploy_admin_user')
  if (adminToken) {
    localStorage.setItem('autodeploy_token', adminToken)
    if (adminUser) localStorage.setItem('autodeploy_user', adminUser)
    localStorage.setItem('autodeploy_portal', 'console')
    window.location.href = '/admin'
  } else {
    localStorage.removeItem('autodeploy_token')
    localStorage.removeItem('autodeploy_user')
    localStorage.removeItem('autodeploy_portal')
    window.location.href = '/admin/login'
  }
}
