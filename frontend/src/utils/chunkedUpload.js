import { getSessionToken } from './session'

/**
 * Uploads a file through the resumable /api/deploy/uploads API with byte progress.
 * `kind` is 'source' (project archive) or 'database'. Resolves to the completed upload
 * ({ uploadId, name, size, analysis? }).
 */
export async function chunkedUpload(file, kind, { onProgress = () => {} } = {}) {
  const request = async (path, body) => {
    const res = await fetch(`/api/deploy${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getSessionToken()}` },
      body: JSON.stringify(body || {})
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.success === false) throw new Error(data.error || `Upload failed (${res.status})`)
    return data
  }

  const init = await request('/uploads', { kind, name: file.name, size: file.size })
  const sendChunk = (offset, chunk) => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/api/deploy/uploads/${init.uploadId}/chunk?offset=${offset}`)
    xhr.setRequestHeader('Authorization', `Bearer ${getSessionToken()}`)
    xhr.setRequestHeader('Content-Type', 'application/octet-stream')
    xhr.upload.onprogress = (e) => onProgress((offset + e.loaded) / file.size)
    xhr.onload = () => {
      let data = {}
      try { data = JSON.parse(xhr.responseText) } catch { /* ignore */ }
      if (xhr.status === 409 && Number.isFinite(data.expectedOffset)) return resolve(data.expectedOffset)
      if (xhr.status >= 400) return reject(Object.assign(new Error(data.error || `Upload failed (${xhr.status})`), { fatal: true }))
      resolve(data.received)
    }
    xhr.onerror = () => reject(new Error('Network error while uploading'))
    xhr.send(chunk)
  })

  let offset = 0
  let failures = 0
  while (offset < file.size) {
    try {
      offset = await sendChunk(offset, file.slice(offset, offset + init.chunkSize))
      failures = 0
    } catch (err) {
      // Network hiccup: wait and resend from the last confirmed offset
      if (err.fatal || ++failures > 4) throw err
      await new Promise((r) => setTimeout(r, 1500 * failures))
    }
  }
  onProgress(1)
  return request(`/uploads/${init.uploadId}/complete`, {})
}
