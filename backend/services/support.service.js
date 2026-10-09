import crypto from 'crypto'
import { readDb, writeDb } from './db.service.js'

export const TICKET_STATUSES = ['open', 'pending', 'resolved', 'closed']
export const TICKET_PRIORITIES = ['low', 'medium', 'high', 'urgent']
export const TICKET_CATEGORIES = ['server', 'deployment', 'domain', 'database', 'billing', 'account', 'other']

const MAX_SUBJECT = 200
const MAX_MESSAGE = 10000

const httpError = (status, message) => Object.assign(new Error(message), { status })

function cleanText(value, max, label) {
  const text = String(value || '').trim()
  if (!text) throw httpError(400, `${label} is required.`)
  if (text.length > max) throw httpError(400, `${label} must be at most ${max} characters.`)
  return text
}

function pick(value, allowed, fallback) {
  const v = String(value || '').toLowerCase()
  return allowed.includes(v) ? v : fallback
}

/**
 * List view of a ticket: everything except the full message thread.
 */
function summarize(ticket, db) {
  const org = (db.organizations || {})[ticket.organizationId]
  const user = (db.users || {})[ticket.createdBy]
  const last = ticket.messages[ticket.messages.length - 1]
  return {
    id: ticket.id,
    number: ticket.number,
    subject: ticket.subject,
    category: ticket.category,
    priority: ticket.priority,
    status: ticket.status,
    organizationId: ticket.organizationId,
    organizationName: org ? org.name : ticket.organizationId,
    createdBy: ticket.createdBy,
    createdByName: user ? user.fullName || user.email : 'Deleted user',
    createdByEmail: user ? user.email : '',
    messageCount: ticket.messages.length,
    awaitingStaff: !!last && last.authorRole !== 'staff',
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt
  }
}

function detail(ticket, db) {
  return { ...summarize(ticket, db), messages: ticket.messages }
}

function findTicket(db, ticketId) {
  const ticket = (db.supportTickets || []).find((t) => t.id === ticketId)
  if (!ticket) throw httpError(404, 'Ticket not found.')
  return ticket
}

export function createTicket({ organizationId, user, subject, message, category, priority }) {
  const db = readDb()
  db.supportTickets = db.supportTickets || []
  const now = new Date().toISOString()
  const ticket = {
    id: `tkt-${crypto.randomBytes(6).toString('hex')}`,
    number: db.supportTickets.reduce((max, t) => Math.max(max, t.number || 0), 1000) + 1,
    organizationId,
    createdBy: user.id,
    subject: cleanText(subject, MAX_SUBJECT, 'Subject'),
    category: pick(category, TICKET_CATEGORIES, 'other'),
    priority: pick(priority, TICKET_PRIORITIES, 'medium'),
    status: 'open',
    messages: [{
      id: crypto.randomBytes(6).toString('hex'),
      authorId: user.id,
      authorName: user.name || user.email,
      authorRole: 'customer',
      body: cleanText(message, MAX_MESSAGE, 'Message'),
      createdAt: now
    }],
    createdAt: now,
    updatedAt: now
  }
  db.supportTickets.unshift(ticket)
  writeDb(db)
  return detail(ticket, db)
}

/**
 * Tickets of one organization (customer view) or of every organization (super admin view).
 */
export function listTickets({ organizationId = null, status = '', search = '' } = {}) {
  const db = readDb()
  const q = String(search).trim().toLowerCase()
  return (db.supportTickets || [])
    .filter((t) => !organizationId || t.organizationId === organizationId)
    .filter((t) => !status || t.status === status)
    .map((t) => summarize(t, db))
    .filter((t) => !q || `#${t.number} ${t.subject} ${t.organizationName} ${t.createdByEmail}`.toLowerCase().includes(q))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
}

export function getTicket(ticketId, { organizationId = null } = {}) {
  const db = readDb()
  const ticket = findTicket(db, ticketId)
  if (organizationId && ticket.organizationId !== organizationId) throw httpError(404, 'Ticket not found.')
  return detail(ticket, db)
}

/**
 * Adds a reply. A customer reply reopens a resolved ticket; a staff reply marks it pending (waiting on customer).
 */
export function replyToTicket(ticketId, { user, body, asStaff = false, organizationId = null }) {
  const db = readDb()
  const ticket = findTicket(db, ticketId)
  if (organizationId && ticket.organizationId !== organizationId) throw httpError(404, 'Ticket not found.')
  if (!asStaff && ticket.status === 'closed') throw httpError(400, 'This ticket is closed. Open a new ticket instead.')
  const now = new Date().toISOString()
  ticket.messages.push({
    id: crypto.randomBytes(6).toString('hex'),
    authorId: user.id,
    authorName: user.name || user.email,
    authorRole: asStaff ? 'staff' : 'customer',
    body: cleanText(body, MAX_MESSAGE, 'Reply'),
    createdAt: now
  })
  if (asStaff) {
    if (ticket.status === 'open') ticket.status = 'pending'
  } else if (ticket.status !== 'open') {
    ticket.status = 'open'
  }
  ticket.updatedAt = now
  writeDb(db)
  return detail(ticket, db)
}

export function updateTicket(ticketId, { status, priority } = {}, { organizationId = null } = {}) {
  const db = readDb()
  const ticket = findTicket(db, ticketId)
  if (organizationId && ticket.organizationId !== organizationId) throw httpError(404, 'Ticket not found.')
  const changes = {}
  if (status !== undefined) {
    if (!TICKET_STATUSES.includes(status)) throw httpError(400, `Status must be one of ${TICKET_STATUSES.join(', ')}.`)
    if (status !== ticket.status) changes.status = { from: ticket.status, to: status }
    ticket.status = status
  }
  if (priority !== undefined) {
    if (!TICKET_PRIORITIES.includes(priority)) throw httpError(400, `Priority must be one of ${TICKET_PRIORITIES.join(', ')}.`)
    if (priority !== ticket.priority) changes.priority = { from: ticket.priority, to: priority }
    ticket.priority = priority
  }
  ticket.updatedAt = new Date().toISOString()
  writeDb(db)
  return { ticket: detail(ticket, db), changes }
}
