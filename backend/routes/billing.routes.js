import express from 'express'
import { authenticateToken } from '../middleware/auth.middleware.js'
import { requireTenant, requireRole } from '../middleware/tenant.middleware.js'
import { getSubscriptionSummary } from '../services/subscription.service.js'
import { getAllPlans, saveSubscription, recordAuditLog } from '../services/db.service.js'

const router = express.Router()

/**
 * GET /api/billing/summary
 */
router.get('/summary', authenticateToken, requireTenant, (req, res) => {
  try {
    const summary = getSubscriptionSummary(req.tenant.organizationId)
    res.json(summary)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * GET /api/billing/plans
 */
router.get('/plans', (req, res) => {
  try {
    const plans = getAllPlans()
    res.json({ plans })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * POST /api/billing/checkout
 * Upgrade plan for tenant
 */
router.post('/checkout', authenticateToken, requireTenant, requireRole(['OWNER', 'ADMIN']), (req, res) => {
  try {
    const { planId } = req.body
    if (!planId) {
      return res.status(400).json({ error: 'planId parameter is required.' })
    }

    const plans = getAllPlans()
    if (!plans[planId]) {
      return res.status(400).json({ error: `Invalid planId '${planId}'.` })
    }

    const updatedSub = saveSubscription(req.tenant.organizationId, {
      planId,
      status: 'active',
      currentPeriodStart: new Date().toISOString(),
      currentPeriodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
      cancelAtPeriodEnd: false
    })

    recordAuditLog({
      organizationId: req.tenant.organizationId,
      userId: req.user.id,
      action: 'SUBSCRIPTION_UPGRADED',
      resourceType: 'subscription',
      resourceId: planId,
      details: { planId }
    })

    res.json({
      success: true,
      message: `Subscription successfully upgraded to ${plans[planId].name}!`,
      subscription: updatedSub
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

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

export default router
