import nodemailer from 'nodemailer'
import { getIntegrations } from './integrations.service.js'
import { readDb } from './db.service.js'

/**
 * Outbound email, SMS and WhatsApp using the super admin's integration settings.
 * send* functions throw on failure (used by "Send test"); notify() never throws.
 */

const httpError = (status, message) => Object.assign(new Error(message), { status })
const TIMEOUT = 15000

/** E.164 with the platform's default country code for numbers written without one. */
export function normalizePhone(phone, defaultCountryCode = '91') {
  const raw = String(phone || '').trim()
  if (!raw) return null
  let digits = raw.replace(/[^\d]/g, '')
  if (raw.startsWith('+')) return digits.length >= 8 ? `+${digits}` : null
  if (digits.startsWith('00')) return `+${digits.slice(2)}`
  digits = digits.replace(/^0+/, '')
  if (digits.length < 6) return null
  return digits.length <= 10 ? `+${defaultCountryCode}${digits}` : `+${digits}`
}

async function postJson(url, { headers = {}, body, form, auth } = {}) {
  const h = { ...headers }
  if (auth) h.Authorization = `Basic ${Buffer.from(`${auth.user}:${auth.pass}`).toString('base64')}`
  let payload
  if (form) {
    h['Content-Type'] = 'application/x-www-form-urlencoded'
    payload = new URLSearchParams(form).toString()
  } else if (body !== undefined) {
    h['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const res = await fetch(url, { method: 'POST', headers: h, body: payload, signal: AbortSignal.timeout(TIMEOUT) })
  const text = await res.text()
  let data = {}
  try { data = JSON.parse(text) } catch { data = { raw: text } }
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || data?.error || text.slice(0, 300)
    throw httpError(502, `Provider error ${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`)
  }
  return data
}

// --- Email -------------------------------------------------------------------------------------

export async function sendEmail({ to, subject, text, html }, cfg = getIntegrations()) {
  const e = cfg.email
  if (!e.host || !e.fromEmail) throw httpError(400, 'Email (SMTP) is not configured.')
  const transport = nodemailer.createTransport({
    host: e.host,
    port: Number(e.port) || 587,
    secure: !!e.secure,
    auth: e.user ? { user: e.user, pass: e.pass } : undefined,
    connectionTimeout: TIMEOUT,
    greetingTimeout: TIMEOUT,
    socketTimeout: TIMEOUT
  })
  const info = await transport.sendMail({
    from: e.fromName ? `"${e.fromName.replace(/"/g, '')}" <${e.fromEmail}>` : e.fromEmail,
    to,
    subject,
    text,
    html
  })
  return { id: info.messageId }
}

// --- SMS ---------------------------------------------------------------------------------------

async function twilioMessage(t, to, from, text) {
  if (!t.accountSid || !t.authToken || !t.from) throw httpError(400, 'Twilio is not configured.')
  const data = await postJson(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(t.accountSid)}/Messages.json`, {
    auth: { user: t.accountSid, pass: t.authToken },
    form: { To: to, From: from, Body: text }
  })
  return { id: data.sid }
}

export async function sendSms({ to, text }, cfg = getIntegrations()) {
  const s = cfg.sms
  const phone = normalizePhone(to, cfg.notifications.defaultCountryCode)
  if (!phone) throw httpError(400, 'Phone number is not valid.')
  if (s.provider === 'msg91') {
    const m = s.msg91
    if (!m.authKey || !m.templateId) throw httpError(400, 'MSG91 is not configured.')
    const data = await postJson('https://control.msg91.com/api/v5/flow', {
      headers: { authkey: m.authKey, accept: 'application/json' },
      body: { template_id: m.templateId, short_url: '0', recipients: [{ mobiles: phone.slice(1), [m.variableName || 'var1']: text.slice(0, 300) }] }
    })
    if (data.type === 'error') throw httpError(502, `MSG91: ${data.message}`)
    return { id: data.message || null }
  }
  return twilioMessage(s.twilio, phone, s.twilio.from, text)
}

// --- WhatsApp ----------------------------------------------------------------------------------

export async function sendWhatsApp({ to, text }, cfg = getIntegrations()) {
  const w = cfg.whatsapp
  const phone = normalizePhone(to, cfg.notifications.defaultCountryCode)
  if (!phone) throw httpError(400, 'Phone number is not valid.')
  if (w.provider === 'twilio') {
    const from = w.twilio.from.startsWith('whatsapp:') ? w.twilio.from : `whatsapp:${w.twilio.from}`
    return twilioMessage(w.twilio, `whatsapp:${phone}`, from, text)
  }
  const m = w.meta
  if (!m.phoneNumberId || !m.accessToken) throw httpError(400, 'WhatsApp Cloud API is not configured.')
  // Business-initiated messages must use an approved template; its body takes the message as {{1}}.
  // Without a template a plain text message is sent (only delivered inside a 24-hour customer window).
  const body = m.templateName
    ? {
        messaging_product: 'whatsapp',
        to: phone.slice(1),
        type: 'template',
        template: {
          name: m.templateName,
          language: { code: m.languageCode || 'en' },
          components: [{ type: 'body', parameters: [{ type: 'text', text: text.slice(0, 1000) }] }]
        }
      }
    : { messaging_product: 'whatsapp', to: phone.slice(1), type: 'text', text: { body: text.slice(0, 4000) } }
  const data = await postJson(`https://graph.facebook.com/v21.0/${encodeURIComponent(m.phoneNumberId)}/messages`, {
    headers: { Authorization: `Bearer ${m.accessToken}` },
    body
  })
  return { id: data.messages?.[0]?.id || null }
}

// --- Notifications -----------------------------------------------------------------------------

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/**
 * Sends a notification for `event` to a user over every channel the super admin enabled for it.
 * Failures are logged, never thrown, so they can't break the action that triggered them.
 */
export function notifyUser(userId, event, { subject, text }) {
  const run = async () => {
    const cfg = getIntegrations()
    const channels = cfg.notifications.events[event]
    if (!channels) return
    const user = (readDb().users || {})[userId]
    if (!user) return
    const jobs = []
    if (channels.email && cfg.email.enabled && user.email) {
      const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#111">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`
      jobs.push(['email', sendEmail({ to: user.email, subject, text, html }, cfg)])
    }
    const sms = `${subject}: ${text}`.slice(0, 600)
    if (channels.sms && cfg.sms.enabled && user.phone) jobs.push(['sms', sendSms({ to: user.phone, text: sms }, cfg)])
    if (channels.whatsapp && cfg.whatsapp.enabled && user.phone) jobs.push(['whatsapp', sendWhatsApp({ to: user.phone, text: sms }, cfg)])
    const results = await Promise.allSettled(jobs.map(([, p]) => p))
    results.forEach((r, i) => {
      if (r.status === 'rejected') console.error(`[NOTIFY] ${event} via ${jobs[i][0]} to user ${userId} failed: ${r.reason?.message}`)
    })
  }
  run().catch((err) => console.error(`[NOTIFY] ${event} failed:`, err.message))
}
