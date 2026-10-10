import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

/**
 * Platform integrations configured by the super admin: Razorpay payments, email (SMTP),
 * SMS (Twilio / MSG91), WhatsApp (Meta Cloud API / Twilio) and which notifications to send.
 *
 * Stored in data/integrations.json (mode 0600) rather than db.json, because it holds secrets.
 * Secrets are never returned to the browser: the public view replaces them with { set, hint }.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FILE = process.env.AUTODEPLOY_INTEGRATIONS_PATH || path.resolve(__dirname, '../data/integrations.json')

const httpError = (status, message) => Object.assign(new Error(message), { status })

export const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD']
export const NOTIFICATION_EVENTS = {
  paymentReceipt: 'Payment receipt (plan upgrade or AI token purchase)',
  welcome: 'Welcome message after signup',
  supportReply: 'Support team replied to a ticket'
}

const DEFAULTS = {
  razorpay: { enabled: false, keyId: '', keySecret: '', webhookSecret: '', currency: 'INR', businessName: 'AutoDeploy' },
  email: { enabled: false, host: '', port: 587, secure: false, user: '', pass: '', fromName: 'AutoDeploy', fromEmail: '' },
  sms: {
    enabled: false,
    provider: 'twilio',
    twilio: { accountSid: '', authToken: '', from: '' },
    msg91: { authKey: '', templateId: '', variableName: 'var1' }
  },
  whatsapp: {
    enabled: false,
    provider: 'meta',
    meta: { phoneNumberId: '', accessToken: '', templateName: '', languageCode: 'en' },
    twilio: { accountSid: '', authToken: '', from: '' }
  },
  notifications: {
    defaultCountryCode: '91',
    events: {
      paymentReceipt: { email: true, sms: false, whatsapp: false },
      welcome: { email: true, sms: false, whatsapp: false },
      supportReply: { email: true, sms: false, whatsapp: false }
    }
  }
}

// Paths (section.key or section.sub.key) that hold secrets
const SECRETS = new Set([
  'razorpay.keySecret', 'razorpay.webhookSecret',
  'email.pass',
  'sms.twilio.authToken', 'sms.msg91.authKey',
  'whatsapp.meta.accessToken', 'whatsapp.twilio.authToken'
])

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v)

function merge(base, over) {
  const out = { ...base }
  for (const [k, v] of Object.entries(over || {})) out[k] = isObj(base[k]) && isObj(v) ? merge(base[k], v) : v
  return out
}

export function getIntegrations() {
  let stored = {}
  try { stored = JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { /* not configured yet */ }
  return merge(DEFAULTS, stored)
}

function writeIntegrations(cfg) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true })
  const tmp = `${FILE}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, FILE)
}

function mask(obj, prefix) {
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    const p = `${prefix}.${k}`
    if (SECRETS.has(p)) out[k] = { set: !!v, hint: v ? `…${String(v).slice(-4)}` : null }
    else out[k] = isObj(v) ? mask(v, p) : v
  }
  return out
}

/** Config safe to send to the super admin console (secrets masked). */
export function getPublicIntegrations() {
  const cfg = getIntegrations()
  return Object.fromEntries(Object.entries(cfg).map(([section, v]) => [section, mask(v, section)]))
}

const str = (v, max = 300) => String(v ?? '').trim().slice(0, max)

/**
 * Applies an update to one section. Only known keys are accepted; a secret is replaced only when
 * a non-empty string is sent, and cleared when `null` is sent.
 */
function applyUpdate(current, update, prefix, defaults) {
  const out = { ...current }
  for (const [k, def] of Object.entries(defaults)) {
    if (!(k in (update || {}))) continue
    const v = update[k]
    const p = `${prefix}.${k}`
    if (SECRETS.has(p)) {
      if (v === null) out[k] = ''
      else if (typeof v === 'string' && v.trim()) out[k] = str(v, 2000)
    } else if (isObj(def)) {
      out[k] = applyUpdate(current[k] || {}, v, p, def)
    } else if (typeof def === 'boolean') {
      out[k] = !!v
    } else if (typeof def === 'number') {
      const n = Number(v)
      if (!Number.isFinite(n)) throw httpError(400, `${k} must be a number.`)
      out[k] = n
    } else {
      out[k] = str(v)
    }
  }
  return out
}

export function saveIntegrationSection(section, update) {
  if (!(section in DEFAULTS)) throw httpError(404, 'Unknown integration.')
  const cfg = getIntegrations()
  let next
  if (section === 'notifications') {
    next = { ...cfg.notifications }
    if (update?.defaultCountryCode !== undefined) {
      const cc = str(update.defaultCountryCode).replace(/^\+/, '')
      if (!/^\d{1,4}$/.test(cc)) throw httpError(400, 'Country code must be 1–4 digits, e.g. 91.')
      next.defaultCountryCode = cc
    }
    if (isObj(update?.events)) {
      next.events = { ...cfg.notifications.events }
      for (const ev of Object.keys(NOTIFICATION_EVENTS)) {
        const e = update.events[ev]
        if (isObj(e)) next.events[ev] = { email: !!e.email, sms: !!e.sms, whatsapp: !!e.whatsapp }
      }
    }
  } else {
    next = applyUpdate(cfg[section], update, section, DEFAULTS[section])
  }

  if (section === 'razorpay') {
    if (!CURRENCIES.includes(next.currency)) throw httpError(400, `Currency must be one of ${CURRENCIES.join(', ')}.`)
    if (next.keyId && !/^rzp_(test|live)_[A-Za-z0-9]{8,}$/.test(next.keyId)) throw httpError(400, 'Key ID should look like rzp_live_… or rzp_test_….')
    if (next.enabled && (!next.keyId || !next.keySecret)) throw httpError(400, 'Enter the Key ID and Key Secret before enabling Razorpay.')
  }
  if (section === 'email') {
    if (next.port && (next.port < 1 || next.port > 65535)) throw httpError(400, 'Port must be between 1 and 65535.')
    if (next.fromEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(next.fromEmail)) throw httpError(400, 'From email is not valid.')
    if (next.enabled && (!next.host || !next.fromEmail)) throw httpError(400, 'Enter the SMTP host and From email before enabling email.')
  }
  if (section === 'sms') {
    if (!['twilio', 'msg91'].includes(next.provider)) throw httpError(400, 'SMS provider must be Twilio or MSG91.')
    if (next.enabled && next.provider === 'twilio' && (!next.twilio.accountSid || !next.twilio.authToken || !next.twilio.from)) throw httpError(400, 'Enter the Twilio Account SID, Auth Token and From number before enabling SMS.')
    if (next.enabled && next.provider === 'msg91' && (!next.msg91.authKey || !next.msg91.templateId)) throw httpError(400, 'Enter the MSG91 Auth Key and Flow template ID before enabling SMS.')
  }
  if (section === 'whatsapp') {
    if (!['meta', 'twilio'].includes(next.provider)) throw httpError(400, 'WhatsApp provider must be Meta Cloud API or Twilio.')
    if (next.enabled && next.provider === 'meta' && (!next.meta.phoneNumberId || !next.meta.accessToken)) throw httpError(400, 'Enter the Phone Number ID and Access Token before enabling WhatsApp.')
    if (next.enabled && next.provider === 'twilio' && (!next.twilio.accountSid || !next.twilio.authToken || !next.twilio.from)) throw httpError(400, 'Enter the Twilio Account SID, Auth Token and WhatsApp sender before enabling WhatsApp.')
  }

  cfg[section] = next
  cfg.updatedAt = new Date().toISOString()
  writeIntegrations(cfg)
  return getPublicIntegrations()
}
