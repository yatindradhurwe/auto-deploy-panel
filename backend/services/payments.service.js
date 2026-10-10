import crypto from 'crypto'
import { getIntegrations } from './integrations.service.js'
import { readDb, writeDb, getAllPlans, saveSubscription, recordAuditLog, getUserById } from './db.service.js'
import { getPack, creditPack } from './ai-credits.service.js'
import { notifyUser } from './notify.service.js'

/**
 * Razorpay payments for plan upgrades and AI token packs.
 *
 * 1. createCheckout() prices the item on the server and creates a Razorpay order (or applies a
 *    free item directly). The browser opens Razorpay Checkout with that order.
 * 2. verifyCheckout() checks the signature Checkout returns and fulfills the order.
 * 3. handleWebhook() is the backup path (order.paid / payment.captured) if the browser never
 *    comes back. Fulfillment is idempotent: an order is fulfilled once.
 */

const httpError = (status, message) => Object.assign(new Error(message), { status })
const MAX_PAYMENTS = 5000

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a || ''))
  const y = Buffer.from(String(b || ''))
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}
const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex')

export function getPaymentConfig() {
  const r = getIntegrations().razorpay
  return { enabled: !!(r.enabled && r.keyId && r.keySecret), currency: r.currency || 'INR', keyId: r.keyId, businessName: r.businessName }
}

async function razorpay(method, path, body) {
  const r = getIntegrations().razorpay
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${r.keyId}:${r.keySecret}`).toString('base64')}`,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000)
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw httpError(res.status === 401 ? 400 : 502, `Razorpay: ${data?.error?.description || `request failed (${res.status})`}`)
  return data
}

/** Checks the stored keys against Razorpay (super admin "Test connection"). */
export async function testRazorpay() {
  const r = getIntegrations().razorpay
  if (!r.keyId || !r.keySecret) throw httpError(400, 'Enter the Key ID and Key Secret first.')
  await razorpay('GET', '/orders?count=1')
  return { message: `Connected to Razorpay (${r.keyId.startsWith('rzp_live_') ? 'live' : 'test'} mode).` }
}

function describeItem(kind, itemId) {
  if (kind === 'plan') {
    const plan = getAllPlans()[itemId]
    if (!plan || plan.isPublic === false) throw httpError(400, `Invalid plan '${itemId}'.`)
    return { price: Number(plan.priceMonthly) || 0, description: `${plan.name} plan — 1 month`, itemName: plan.name }
  }
  if (kind === 'tokens') {
    const pack = getPack(itemId)
    return { price: Number(pack.price) || 0, description: `${pack.name} — ${pack.tokens.toLocaleString()} AI tokens`, itemName: pack.name, tokens: pack.tokens }
  }
  throw httpError(400, 'Unknown purchase type.')
}

function savePayment(record) {
  const db = readDb()
  db.payments ||= {}
  db.payments[record.orderId] = record
  const ids = Object.keys(db.payments)
  if (ids.length > MAX_PAYMENTS) {
    ids.sort((a, b) => (db.payments[a].createdAt || '').localeCompare(db.payments[b].createdAt || ''))
    for (const id of ids.slice(0, ids.length - MAX_PAYMENTS)) delete db.payments[id]
  }
  writeDb(db)
}

function applyItem(record) {
  if (record.kind === 'plan') {
    saveSubscription(record.organizationId, {
      planId: record.itemId,
      status: 'active',
      currentPeriodStart: new Date().toISOString(),
      currentPeriodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
      cancelAtPeriodEnd: false
    })
  } else {
    // Credit what was paid for, even if the pack was edited after the order was created
    const pack = { id: record.itemId, name: record.itemName, tokens: record.tokens, price: record.amount / 100 }
    creditPack(record.organizationId, pack, record.userId, record.paymentId ? { paymentId: record.paymentId, orderId: record.orderId, currency: record.currency } : {})
  }
}

/**
 * Marks an order paid and applies it, exactly once. Synchronous from the status check to the
 * write, so the browser callback and the webhook can't both fulfill it.
 */
function fulfill(orderId, { paymentId, source }) {
  const db = readDb()
  const record = (db.payments || {})[orderId]
  if (!record) throw httpError(404, 'Order not found.')
  if (record.status === 'paid') return { record, alreadyPaid: true }
  record.status = 'paid'
  record.paymentId = paymentId
  record.paidAt = new Date().toISOString()
  record.fulfilledBy = source
  writeDb(db)
  applyItem(record)
  recordAuditLog({
    organizationId: record.organizationId,
    userId: record.userId,
    action: record.kind === 'plan' ? 'SUBSCRIPTION_UPGRADED' : 'AI_TOKENS_PURCHASED',
    resourceType: record.kind === 'plan' ? 'subscription' : 'ai-tokens',
    resourceId: record.itemId,
    details: { orderId, paymentId, amount: record.amount / 100, currency: record.currency, via: source }
  })
  const amount = `${record.currency} ${(record.amount / 100).toFixed(2)}`
  notifyUser(record.userId, 'paymentReceipt', {
    subject: 'Payment received',
    text: `Thank you! We received ${amount} for ${record.description}.\nPayment ID: ${paymentId}\nOrder ID: ${orderId}`
  })
  return { record, alreadyPaid: false }
}

function resultMessage(record) {
  return record.kind === 'plan'
    ? `Your subscription is now on the ${record.itemName} plan.`
    : `${Number(record.tokens).toLocaleString()} AI tokens added to your organization.`
}

/**
 * Starts a purchase. Free items are applied immediately; paid items need Razorpay enabled.
 */
export async function createCheckout({ organizationId, user, kind, itemId }) {
  const item = describeItem(kind, String(itemId || ''))
  const base = { organizationId, userId: user.id, kind, itemId: String(itemId), itemName: item.itemName, description: item.description, tokens: item.tokens || null, createdAt: new Date().toISOString() }

  if (item.price <= 0) {
    const orderId = `free_${crypto.randomBytes(8).toString('hex')}`
    savePayment({ ...base, orderId, amount: 0, currency: getPaymentConfig().currency, status: 'created', gateway: 'none' })
    const { record } = fulfill(orderId, { paymentId: null, source: 'free' })
    return { requiresPayment: false, message: resultMessage(record) }
  }

  const cfg = getPaymentConfig()
  if (!cfg.enabled) throw httpError(503, 'Online payments are not set up yet. Please contact support to upgrade.')
  const amount = Math.round(item.price * 100)
  if (amount < 100) throw httpError(400, 'The amount is below the payment gateway minimum.')

  const order = await razorpay('POST', '/orders', {
    amount,
    currency: cfg.currency,
    receipt: `rcpt_${crypto.randomBytes(6).toString('hex')}`,
    notes: { organizationId, userId: user.id, kind, itemId: String(itemId) }
  })
  savePayment({ ...base, orderId: order.id, amount, currency: cfg.currency, status: 'created', gateway: 'razorpay' })
  const u = getUserById(user.id) || {}
  return {
    requiresPayment: true,
    checkout: {
      key: cfg.keyId,
      order_id: order.id,
      amount,
      currency: cfg.currency,
      name: cfg.businessName || 'AutoDeploy',
      description: item.description,
      prefill: { name: u.fullName || '', email: u.email || '', contact: u.phone || '' },
      notes: { organizationId }
    }
  }
}

/** Called by the browser after Razorpay Checkout succeeds. */
export function verifyCheckout({ organizationId, orderId, paymentId, signature }) {
  const r = getIntegrations().razorpay
  if (!orderId || !paymentId || !signature) throw httpError(400, 'Missing payment details.')
  const record = (readDb().payments || {})[orderId]
  if (!record || record.organizationId !== organizationId) throw httpError(404, 'Order not found.')
  if (!safeEqual(hmac(r.keySecret, `${orderId}|${paymentId}`), signature)) throw httpError(400, 'Payment signature is invalid.')
  const { record: done } = fulfill(orderId, { paymentId, source: 'checkout' })
  return { message: resultMessage(done) }
}

/** Razorpay webhook: verifies X-Razorpay-Signature over the raw body. */
export function handleWebhook(rawBody, signature) {
  const r = getIntegrations().razorpay
  if (!r.webhookSecret) throw httpError(503, 'Webhook secret not configured.')
  if (!safeEqual(hmac(r.webhookSecret, rawBody || ''), signature)) throw httpError(400, 'Invalid signature.')
  const event = JSON.parse(String(rawBody))
  const payment = event.payload?.payment?.entity
  const orderId = event.payload?.order?.entity?.id || payment?.order_id
  if (!orderId) return { ignored: true }
  const record = (readDb().payments || {})[orderId]
  if (!record) return { ignored: true }

  if (event.event === 'order.paid' || event.event === 'payment.captured') {
    if (payment && (payment.amount !== record.amount || payment.currency !== record.currency)) {
      console.error(`[RAZORPAY] Amount mismatch on ${orderId}: got ${payment.amount} ${payment.currency}, expected ${record.amount} ${record.currency}`)
      return { ignored: true }
    }
    fulfill(orderId, { paymentId: payment?.id || null, source: 'webhook' })
  } else if (event.event === 'payment.failed' && record.status !== 'paid') {
    const db = readDb()
    db.payments[orderId].status = 'failed'
    db.payments[orderId].failureReason = payment?.error_description || null
    writeDb(db)
  }
  return { ok: true }
}

export function listPayments({ organizationId = null, limit = 200 } = {}) {
  const db = readDb()
  const orgs = db.organizations || {}
  return Object.values(db.payments || {})
    .filter((p) => !organizationId || p.organizationId === organizationId)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, limit)
    .map((p) => ({ ...p, organizationName: orgs[p.organizationId]?.name || p.organizationId }))
}
