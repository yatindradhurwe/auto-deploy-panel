import http from 'http'
import https from 'https'
import dns from 'dns'
import net from 'net'

/**
 * Fetches project pages for the Studio live preview (redirects followed, private addresses
 * refused for organization users so the preview can't be used to reach internal services).
 */

const MAX_REDIRECTS = 5
const TIMEOUT_MS = 15000
const MAX_BODY_BYTES = 10 * 1024 * 1024

const blocked = new net.BlockList()
for (const [addr, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16]]) {
  blocked.addSubnet(addr, prefix, 'ipv4')
}
for (const [addr, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10]]) {
  blocked.addSubnet(addr, prefix, 'ipv6')
}

export const isPrivateAddress = (ip) => blocked.check(ip, net.isIPv6(ip) ? 'ipv6' : 'ipv4')

// Checks the address actually connected to, so DNS can't swap in a private one after a check
const publicOnlyLookup = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err)
    const bad = addresses.find((a) => isPrivateAddress(a.address))
    if (bad) return callback(Object.assign(new Error(`${hostname} resolves to a private address`), { code: 'PRIVATE_ADDRESS' }))
    if (options.all) return callback(null, addresses)
    callback(null, addresses[0].address, addresses[0].family)
  })
}

export function normalizePreviewUrl(raw) {
  let url = String(raw || '').trim()
  if (!url) return null
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`
  try {
    const parsed = new URL(url)
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed : null
  } catch {
    return null
  }
}

function requestOnce(url, { allowPrivate, readBody }) {
  return new Promise((resolve, reject) => {
    if (!allowPrivate && net.isIP(url.hostname.replace(/^\[|\]$/g, '')) && isPrivateAddress(url.hostname.replace(/^\[|\]$/g, ''))) {
      return reject(Object.assign(new Error('Private addresses cannot be previewed'), { code: 'PRIVATE_ADDRESS' }))
    }
    const client = url.protocol === 'https:' ? https : http
    const req = client.request(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AutoDeployStudioPreview/1.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Encoding': 'identity'
      },
      rejectUnauthorized: false,
      ...(allowPrivate ? {} : { lookup: publicOnlyLookup })
    }, (res) => {
      if (!readBody || (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)) {
        res.resume()
        return resolve({ status: res.statusCode, headers: res.headers, body: Buffer.alloc(0) })
      }
      const chunks = []
      let size = 0
      res.on('data', (c) => {
        size += c.length
        if (size > MAX_BODY_BYTES) return req.destroy(Object.assign(new Error('The page is too large to preview'), { code: 'TOO_LARGE' }))
        chunks.push(c)
      })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }))
      res.on('error', reject)
    })
    req.setTimeout(TIMEOUT_MS, () => req.destroy(Object.assign(new Error('The site took too long to respond'), { code: 'TIMEOUT' })))
    req.on('error', reject)
    req.end()
  })
}

/**
 * GET a URL, following redirects. Returns { status, headers, body, finalUrl }.
 */
export async function fetchPreview(rawUrl, { allowPrivate = false, readBody = true } = {}) {
  let url = normalizePreviewUrl(rawUrl)
  if (!url) throw Object.assign(new Error('A valid http(s) URL is required'), { code: 'BAD_URL' })
  for (let hop = 0; ; hop++) {
    const res = await requestOnce(url, { allowPrivate, readBody })
    const location = res.headers.location
    if (res.status >= 300 && res.status < 400 && location && hop < MAX_REDIRECTS) {
      url = new URL(location, url)
      if (!['http:', 'https:'].includes(url.protocol)) throw Object.assign(new Error('Redirected to an unsupported URL'), { code: 'BAD_URL' })
      continue
    }
    return { ...res, finalUrl: url.toString() }
  }
}

/**
 * Whether a response may be shown in a cross-origin iframe on the panel.
 */
export function frameBlockReason(headers, panelHost) {
  const xfo = String(headers['x-frame-options'] || '').toLowerCase()
  if (xfo.includes('deny') || xfo.includes('sameorigin')) return `The site sends X-Frame-Options: ${xfo.toUpperCase()}`
  const csp = [].concat(headers['content-security-policy'] || []).join(';')
  const fa = csp.split(';').map((d) => d.trim()).find((d) => /^frame-ancestors\s/i.test(d))
  if (fa) {
    const sources = fa.split(/\s+/).slice(1)
    const allowed = sources.some((s) => s === '*' || (panelHost && s.replace(/^https?:\/\//, '').replace(/\/$/, '') === panelHost))
    if (!allowed) return 'The site\'s Content-Security-Policy (frame-ancestors) blocks embedding'
  }
  return null
}

export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/**
 * Make a proxied HTML page resolve its relative links against the real site.
 */
export function injectBaseHref(html, baseUrl) {
  const tag = `<base href="${escapeHtml(baseUrl)}">`
  if (/<head(\s[^>]*)?>/i.test(html)) return html.replace(/<head(\s[^>]*)?>/i, (m) => m + tag)
  if (/<html(\s[^>]*)?>/i.test(html)) return html.replace(/<html(\s[^>]*)?>/i, (m) => `${m}<head>${tag}</head>`)
  return tag + html
}
