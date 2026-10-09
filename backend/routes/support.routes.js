import express from 'express'
import { authenticateToken } from '../middleware/auth.middleware.js'
import { requireTenant } from '../middleware/tenant.middleware.js'
import { recordAuditLog } from '../services/db.service.js'
import { createTicket, listTickets, getTicket, replyToTicket, updateTicket } from '../services/support.service.js'

/**
 * Customer support desk: an admin opens tickets for their organization and talks to platform staff.
 * Super admins answer them from /api/admin/support.
 */
const router = express.Router()

router.use(authenticateToken, requireTenant)

const handle = (fn) => (req, res) => {
  try {
    res.json(fn(req))
  } catch (err) {
    const status = err.status || 400
    if (status >= 500) console.error('[SUPPORT API ERROR]:', err)
    res.status(status).json({ success: false, error: err.message })
  }
}

const audit = (req, action, resourceId, details = {}) => recordAuditLog({
  organizationId: req.tenant.organizationId,
  userId: req.user.id,
  action,
  resourceType: 'support_ticket',
  resourceId,
  ip: String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim(),
  details: { email: req.user.email, ...details }
})

router.get('/tickets', handle((req) => ({
  success: true,
  tickets: listTickets({ organizationId: req.tenant.organizationId, status: req.query.status || '' })
})))

router.post('/tickets', handle((req) => {
  const { subject, message, category, priority } = req.body || {}
  const ticket = createTicket({ organizationId: req.tenant.organizationId, user: req.user, subject, message, category, priority })
  audit(req, 'SUPPORT_TICKET_CREATED', ticket.id, { number: ticket.number, subject: ticket.subject })
  return { success: true, ticket }
}))

router.get('/tickets/:id', handle((req) => ({
  success: true,
  ticket: getTicket(req.params.id, { organizationId: req.tenant.organizationId })
})))

router.post('/tickets/:id/replies', handle((req) => ({
  success: true,
  ticket: replyToTicket(req.params.id, { user: req.user, body: (req.body || {}).body, organizationId: req.tenant.organizationId })
})))

// Customers can only close their own ticket; everything else is staff-controlled
router.post('/tickets/:id/close', handle((req) => {
  const { ticket } = updateTicket(req.params.id, { status: 'closed' }, { organizationId: req.tenant.organizationId })
  audit(req, 'SUPPORT_TICKET_CLOSED', ticket.id, { number: ticket.number })
  return { success: true, ticket }
}))

export default router
