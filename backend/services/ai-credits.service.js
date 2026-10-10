import crypto from 'crypto'
import { readDb, writeDb } from './db.service.js'

/**
 * AI token credits. Organizations buy token packs (configured by the super admin) and every
 * model turn of the project agent is debited from their balance. Super admin sessions on the
 * platform console are not metered.
 *
 * Tokens charged per turn = (input + cache writes + output + cache reads / 10) × provider multiplier.
 * Cache reads are discounted because providers bill them at roughly a tenth of fresh input.
 */

const MAX_LEDGER = 5000
const httpError = (status, message) => Object.assign(new Error(message), { status })

export const DEFAULT_AI_BILLING = {
  packs: [
    { id: 'pack-small', name: 'Starter pack', tokens: 1000000, price: 10 },
    { id: 'pack-medium', name: 'Builder pack', tokens: 5000000, price: 40 },
    { id: 'pack-large', name: 'Agency pack', tokens: 20000000, price: 140 }
  ],
  multipliers: { claude: 1, openai: 1, gemini: 1 },
  signupBonusTokens: 0
}

export function getAiBilling() {
  const stored = readDb().aiBilling || {}
  return {
    ...DEFAULT_AI_BILLING,
    ...stored,
    multipliers: { ...DEFAULT_AI_BILLING.multipliers, ...(stored.multipliers || {}) }
  }
}

export function saveAiBilling(updates = {}) {
  const current = getAiBilling()
  const next = { ...current }

  if (updates.packs !== undefined) {
    if (!Array.isArray(updates.packs) || updates.packs.length > 20) throw httpError(400, 'Packs must be a list of at most 20 entries.')
    const ids = new Set()
    next.packs = updates.packs.map((p) => {
      const id = String(p.id || `pack-${crypto.randomBytes(4).toString('hex')}`).trim()
      if (!/^[a-zA-Z0-9_-]{2,40}$/.test(id) || ids.has(id)) throw httpError(400, `Invalid or duplicate pack id '${id}'.`)
      ids.add(id)
      const name = String(p.name || '').trim().slice(0, 60)
      const tokens = Math.floor(Number(p.tokens))
      const price = Number(p.price)
      if (!name) throw httpError(400, 'Every pack needs a name.')
      if (!Number.isFinite(tokens) || tokens < 1000) throw httpError(400, `Pack '${name}' must contain at least 1,000 tokens.`)
      if (!Number.isFinite(price) || price < 0) throw httpError(400, `Pack '${name}' needs a valid price.`)
      return { id, name, tokens, price: Math.round(price * 100) / 100 }
    })
  }

  if (updates.multipliers !== undefined) {
    next.multipliers = { ...current.multipliers }
    for (const [k, v] of Object.entries(updates.multipliers || {})) {
      if (!(k in DEFAULT_AI_BILLING.multipliers)) continue
      const n = Number(v)
      if (!Number.isFinite(n) || n <= 0 || n > 100) throw httpError(400, `Multiplier for ${k} must be between 0 and 100.`)
      next.multipliers[k] = n
    }
  }

  if (updates.signupBonusTokens !== undefined) {
    const n = Math.floor(Number(updates.signupBonusTokens))
    if (!Number.isFinite(n) || n < 0) throw httpError(400, 'Signup bonus must be zero or more tokens.')
    next.signupBonusTokens = n
  }

  const db = readDb()
  db.aiBilling = { ...next, updatedAt: new Date().toISOString() }
  writeDb(db)
  return getAiBilling()
}

export function getBalance(organizationId) {
  return (readDb().aiTokenBalances || {})[organizationId] || 0
}

/**
 * Adds (positive) or removes (negative) tokens and records a ledger entry.
 * Balances may go below zero only through usage debits (a turn already consumed).
 */
function applyEntry(organizationId, delta, entry) {
  if (!organizationId) throw httpError(400, 'Organization is required.')
  const db = readDb()
  db.aiTokenBalances ||= {}
  db.aiTokenLedger ||= []
  const balance = (db.aiTokenBalances[organizationId] || 0) + delta
  db.aiTokenBalances[organizationId] = balance
  db.aiTokenLedger.push({
    id: `aitx_${crypto.randomBytes(8).toString('hex')}`,
    organizationId,
    delta,
    balance,
    at: new Date().toISOString(),
    ...entry
  })
  if (db.aiTokenLedger.length > MAX_LEDGER) db.aiTokenLedger = db.aiTokenLedger.slice(-MAX_LEDGER)
  writeDb(db)
  return balance
}

export function getPack(packId) {
  const pack = getAiBilling().packs.find((p) => p.id === packId)
  if (!pack) throw httpError(400, 'That token pack is not available.')
  return pack
}

/** Credits a paid (or free) pack. `payment` = { paymentId, orderId, currency } when paid online. */
export function creditPack(organizationId, pack, userId, payment = {}) {
  return applyEntry(organizationId, pack.tokens, { type: 'purchase', packId: pack.id, packName: pack.name, amount: pack.price, userId, ...payment })
}

/** Super admin adjustment: positive grants, negative deducts (never below zero). */
export function adjustBalance(organizationId, tokens, { userId, note = '' } = {}) {
  const delta = Math.trunc(Number(tokens))
  if (!Number.isFinite(delta) || delta === 0) throw httpError(400, 'Enter a non-zero number of tokens.')
  const current = getBalance(organizationId)
  const applied = delta < 0 ? -Math.min(current, -delta) : delta
  return applyEntry(organizationId, applied, { type: delta > 0 ? 'grant' : 'deduct', userId, note: String(note).slice(0, 200) })
}

export function tokensForUsage(usage, providerId) {
  const m = getAiBilling().multipliers[providerId] ?? 1
  const raw = (usage.input || 0) + (usage.cacheWrite || 0) + (usage.output || 0) + Math.ceil((usage.cacheRead || 0) / 10)
  return Math.ceil(raw * m)
}

/** Debits one model turn. Returns { charged, balance }. */
export function chargeUsage(organizationId, usage, { providerId, model, sessionId, userId, projectName }) {
  const charged = tokensForUsage(usage, providerId)
  if (!charged) return { charged: 0, balance: getBalance(organizationId) }
  const balance = applyEntry(organizationId, -charged, { type: 'usage', provider: providerId, model, sessionId, userId, projectName })
  return { charged, balance }
}

export function getLedger({ organizationId = null, limit = 100 } = {}) {
  const ledger = readDb().aiTokenLedger || []
  return ledger
    .filter((e) => !organizationId || e.organizationId === organizationId)
    .slice(-Math.min(Math.max(Number(limit) || 100, 1), 1000))
    .reverse()
}

/** Per-organization balances plus purchase/usage totals, for the super admin console. */
export function getOrganizationTokenSummary() {
  const db = readDb()
  const balances = db.aiTokenBalances || {}
  const totals = {}
  for (const e of db.aiTokenLedger || []) {
    const t = (totals[e.organizationId] ||= { purchased: 0, used: 0, revenue: 0, lastUsedAt: null })
    if (e.type === 'purchase') { t.purchased += e.delta; t.revenue += e.amount || 0 }
    if (e.type === 'usage') { t.used -= e.delta; t.lastUsedAt = e.at }
  }
  return Object.values(db.organizations || {}).map((o) => ({
    organizationId: o.id,
    name: o.name,
    balance: balances[o.id] || 0,
    ...(totals[o.id] || { purchased: 0, used: 0, revenue: 0, lastUsedAt: null })
  }))
}

/** Welcome tokens for a newly registered organization (no-op when the bonus is 0). */
export function grantSignupBonus(organizationId) {
  const tokens = getAiBilling().signupBonusTokens
  if (!tokens) return getBalance(organizationId)
  return applyEntry(organizationId, tokens, { type: 'grant', note: 'Signup bonus' })
}
