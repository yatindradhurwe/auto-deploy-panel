import express from 'express'
import { authenticateToken } from '../middleware/auth.middleware.js'
import { requireTenant, requireRole } from '../middleware/tenant.middleware.js'
import { getSubscriptionSummary } from '../services/subscription.service.js'
import { getAllPlans, saveSubscription, recordAuditLog } from '../services/db.service.js'
import { getAiBilling, getBalance, getLedger } from '../services/ai-credits.service.js'
import { createCheckout, verifyCheckout, handleWebhook, listPayments, getPaymentConfig } from '../services/payments.service.js'

const router = express.Router()

/**
 * GET /api/billing/summary
 */
router.get('/summary', authenticateToken, requireTenant, (req, res) => {
  try {
    const summary = getSubscriptionSummary(req.tenant.organizationId)
    const { currency, enabled } = getPaymentConfig()
    res.json({ ...summary, currency, paymentsEnabled: enabled })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * GET /api/billing/plans
 */
router.get('/plans', (req, res) => {
  try {
    // Custom plans an admin marked as private are assigned manually and not offered publicly
    const plans = Object.fromEntries(Object.entries(getAllPlans()).filter(([, p]) => p.isPublic !== false))
    res.json({ plans })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

const asyncRoute = (fn) => async (req, res) => {
  try {
    res.json({ success: true, ...(await fn(req, res)) })
  } catch (err) {
    const status = err.status || 500
    if (status >= 500) console.error('[BILLING]', err.message)
    res.status(status).json({ success: false, error: err.message })
  }
}

/**
 * POST /api/billing/checkout { planId }
 * Starts a plan upgrade: free plans apply immediately, paid plans return a Razorpay Checkout order.
 */
router.post('/checkout', authenticateToken, requireTenant, requireRole(['OWNER', 'ADMIN']), asyncRoute((req) => {
  if (!req.body.planId) throw Object.assign(new Error('planId parameter is required.'), { status: 400 })
  return createCheckout({ organizationId: req.tenant.organizationId, user: req.user, kind: 'plan', itemId: req.body.planId })
}))

/**
 * POST /api/billing/checkout/verify { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 * Confirms a completed Razorpay Checkout and applies the purchase.
 */
router.post('/checkout/verify', authenticateToken, requireTenant, asyncRoute((req) => verifyCheckout({
  organizationId: req.tenant.organizationId,
  orderId: req.body.razorpay_order_id,
  paymentId: req.body.razorpay_payment_id,
  signature: req.body.razorpay_signature
})))

/**
 * POST /api/billing/razorpay/webhook
 * Razorpay → us (order.paid, payment.captured, payment.failed). Authenticated by signature.
 */
router.post('/razorpay/webhook', (req, res) => {
  try {
    res.json(handleWebhook(req.rawBody, req.headers['x-razorpay-signature']))
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message })
  }
})

/**
 * GET /api/billing/payments — this organization's payment history
 */
router.get('/payments', authenticateToken, requireTenant, asyncRoute((req) => ({
  payments: listPayments({ organizationId: req.tenant.organizationId, limit: 50 })
    .map(({ orderId, paymentId, kind, itemName, amount, currency, status, createdAt, paidAt }) => ({ orderId, paymentId, kind, itemName, amount: amount / 100, currency, status, createdAt, paidAt }))
})))

/**
 * GET /api/billing/ai-tokens
 * The organization's AI token balance, the packs on sale and recent usage.
 */
router.get('/ai-tokens', authenticateToken, requireTenant, (req, res) => {
  try {
    const orgId = req.tenant.organizationId
    res.json({ success: true, balance: getBalance(orgId), packs: getAiBilling().packs, ledger: getLedger({ organizationId: orgId, limit: 50 }), currency: getPaymentConfig().currency, paymentsEnabled: getPaymentConfig().enabled })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * POST /api/billing/ai-tokens/purchase
 * Buys a token pack for the organization.
 */
router.post('/ai-tokens/purchase', authenticateToken, requireTenant, requireRole(['OWNER', 'ADMIN']), asyncRoute((req) =>
  createCheckout({ organizationId: req.tenant.organizationId, user: req.user, kind: 'tokens', itemId: req.body.packId })
))

/**
 * POST /api/billing/cancel
 */
router.post('/cancel', authenticateToken, requireTenant, requireRole(['OWNER']), (req, res) => {
  try {
    const updatedSub = saveSubscription(req.tenant.organizationId, {
      cancelAtPeriodEnd: true
    })

    recordAuditLog({
      organizationId: req.tenant.organizationId,
      userId: req.user.id,
      action: 'SUBSCRIPTION_CANCELLED',
      resourceType: 'subscription',
      resourceId: req.tenant.organizationId
    })

    res.json({
      success: true,
      message: 'Subscription marked for cancellation at period end.',
      subscription: updatedSub
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

import { recordWebhookEvent } from '../services/db.service.js'

/**
 * POST /api/billing/webhook
 * Stripe / Razorpay Payment Webhook Deduplication Endpoint
 */
router.post('/webhook', (req, res) => {
  try {
    const provider = req.headers['x-payment-provider'] || (req.body.id && req.body.id.startsWith('evt_') ? 'stripe' : 'razorpay')
    const eventId = req.body.id || req.body.event_id || req.body.payload?.payment?.entity?.id || `pay_${Date.now()}`
    const eventType = req.body.type || req.body.event || 'payment.succeeded'

    const { isDuplicate } = recordWebhookEvent({
      provider,
      eventId,
      organizationId: req.body.organizationId || 'org-default',
      eventType,
      payloadHash: JSON.stringify(req.body).substring(0, 100)
    })

    if (isDuplicate) {
      console.log(`[PAYMENT WEBHOOK DEDUPLICATED] provider=${provider} eventId=${eventId}`)
      return res.json({
        success: true,
        message: `Payment webhook '${eventId}' already processed safely.`,
        replayed: true
      })
    }

    res.json({
      success: true,
      message: `Payment webhook event '${eventId}' processed successfully.`,
      eventId
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
