import {
  readDb,
  writeDb,
  getSubscriptionByOrgId,
  getPlanById,
  getServersByOrgId,
  getProjectsByOrgId,
  getOrganizationMembers,
  getAllPlans,
  recordAuditLog
} from './db.service.js'
import { notifyUser } from './notify.service.js'

const DAY_MS = 86400000

/** Days a lapsed paid subscription keeps its plan (as past_due) before falling back to FREE. */
export const GRACE_DAYS = 7

/** The platform's own organization never expires and is never limited. */
const PLATFORM_ORG_ID = 'org-default'

/** Statuses that no longer grant the paid plan's limits. */
const LAPSED = new Set(['canceled', 'expired'])

/**
 * The status a subscription actually has right now, from its stored status and period end:
 *  - active/trialing past its period end → canceled (cancelAtPeriodEnd), else past_due during the grace period
 *  - past_due past the grace period → expired
 * FREE never lapses (it has no period to pay for).
 */
export function resolveSubscriptionStatus(sub, now = Date.now()) {
  if (!sub) return 'none'
  const stored = sub.status || 'active'
  if (sub.organizationId === PLATFORM_ORG_ID || sub.planId === 'FREE') return stored
  const end = new Date(sub.currentPeriodEnd || 0).getTime()
  if (!end || now < end) return stored
  if (stored === 'active' || stored === 'trialing') {
    if (sub.cancelAtPeriodEnd) return 'canceled'
    return now < end + GRACE_DAYS * DAY_MS ? 'past_due' : 'expired'
  }
  if (stored === 'past_due' && now >= end + GRACE_DAYS * DAY_MS) return 'expired'
  return stored
}

export function daysLeft(sub, now = Date.now()) {
  if (!sub || !sub.currentPeriodEnd) return null
  return Math.ceil((new Date(sub.currentPeriodEnd).getTime() - now) / DAY_MS)
}

/** The plan whose limits apply: the subscribed plan, or FREE once the subscription has lapsed. */
function entitlementPlan(subscription) {
  const status = resolveSubscriptionStatus(subscription)
  return LAPSED.has(status) ? getPlanById('FREE') : getPlanById(subscription.planId)
}

/**
 * Entitlement check helper to verify if organization is allowed to perform an action or expand resources
 * @param {string} organizationId
 * @param {'servers'|'projects'|'teamMembers'|'monitoring'|'apiAccess'} featureKey
 * @returns {{ allowed: boolean, reason?: string, current: number, max: number, planId: string }}
 */
export function checkEntitlement(organizationId, featureKey) {
  const subscription = getSubscriptionByOrgId(organizationId)
  const plan = entitlementPlan(subscription)
  const lapsed = plan.id !== subscription.planId

  if (organizationId === PLATFORM_ORG_ID) {
    return { allowed: true, reason: null, current: 0, max: Infinity, planId: plan.id }
  }

  const servers = getServersByOrgId(organizationId)
  const projects = getProjectsByOrgId(organizationId)
  const teamMembers = getOrganizationMembers(organizationId)

  const usageMap = {
    servers: servers.length,
    projects: projects.length,
    teamMembers: teamMembers.length
  }

  const planMaxMap = {
    servers: plan.maxServers,
    projects: plan.maxProjects,
    teamMembers: plan.maxTeamMembers,
    monitoring: plan.monitoring,
    apiAccess: plan.apiAccess
  }

  const current = usageMap[featureKey] ?? 0
  const max = planMaxMap[featureKey]
  const lapsedNote = lapsed ? ` Your ${getPlanById(subscription.planId).name} subscription has ${resolveSubscriptionStatus(subscription)}, so Free plan limits apply until it is renewed.` : ''

  if (typeof max === 'boolean') {
    return {
      allowed: max,
      reason: max ? null : `Feature '${featureKey}' is not included in the ${plan.name} plan. Please upgrade to access this feature.${lapsedNote}`,
      current: 0,
      max: max ? 1 : 0,
      planId: plan.id
    }
  }

  const allowed = current < max
  const labels = { servers: 'servers', projects: 'projects', teamMembers: 'team members' }
  return {
    allowed,
    reason: allowed ? null : `Plan limit reached for ${labels[featureKey] || featureKey} (${current}/${max} on ${plan.name}). Upgrade your subscription to add more.${lapsedNote}`,
    current,
    max,
    planId: plan.id
  }
}

/** Throws a 402 when the organization is at its plan limit for `featureKey`. */
export function assertEntitlement(organizationId, featureKey) {
  const result = checkEntitlement(organizationId, featureKey)
  if (!result.allowed) throw Object.assign(new Error(result.reason), { status: 402, code: 'PLAN_LIMIT_REACHED' })
  return result
}

/**
 * Get full organization subscription summary with current usage vs quotas
 */
export function getSubscriptionSummary(organizationId) {
  const subscription = getSubscriptionByOrgId(organizationId)
  const plan = getPlanById(subscription.planId)
  const limits = entitlementPlan(subscription)
  const plans = getAllPlans()

  const servers = getServersByOrgId(organizationId)
  const projects = getProjectsByOrgId(organizationId)
  const teamMembers = getOrganizationMembers(organizationId)

  return {
    subscription: { ...subscription, status: resolveSubscriptionStatus(subscription), daysLeft: daysLeft(subscription), graceDays: GRACE_DAYS },
    plan,
    plans,
    usage: {
      servers: { current: servers.length, max: limits.maxServers },
      projects: { current: projects.length, max: limits.maxProjects },
      teamMembers: { current: teamMembers.length, max: limits.maxTeamMembers },
      monitoring: limits.monitoring,
      apiAccess: limits.apiAccess
    }
  }
}

/**
 * Stores the resolved status of every subscription whose period has run out, records it in the
 * audit trail and tells the organization owner. Returns the changes made.
 */
export function sweepSubscriptions({ now = Date.now() } = {}) {
  const db = readDb()
  const changes = []
  for (const sub of Object.values(db.subscriptions || {})) {
    const next = resolveSubscriptionStatus(sub, now)
    if (next === sub.status || next === 'none') continue
    changes.push({ organizationId: sub.organizationId, planId: sub.planId, from: sub.status, to: next })
    sub.status = next
    sub.updatedAt = new Date(now).toISOString()
    if (next === 'expired' || next === 'canceled') sub.endedAt = sub.endedAt || new Date(now).toISOString()
  }
  if (changes.length === 0) return changes
  writeDb(db)

  for (const c of changes) {
    recordAuditLog({ organizationId: c.organizationId, userId: 'system', action: 'SUBSCRIPTION_STATUS_CHANGED', resourceType: 'subscription', resourceId: c.organizationId, details: c })
    const org = (db.organizations || {})[c.organizationId]
    const plan = (db.plans || {})[c.planId]
    if (!org?.ownerId) continue
    const text = {
      past_due: `Your ${plan?.name || c.planId} subscription for "${org.name}" ended and is now past due. Renew it within ${GRACE_DAYS} days under Billing to keep your plan limits.`,
      expired: `Your ${plan?.name || c.planId} subscription for "${org.name}" has expired. Free plan limits now apply; renew under Billing to restore your plan.`,
      canceled: `Your ${plan?.name || c.planId} subscription for "${org.name}" was canceled at the end of its billing period. Free plan limits now apply.`
    }[c.to]
    if (text) notifyUser(org.ownerId, 'subscriptionStatus', { subject: `Subscription ${c.to.replace('_', ' ')}: ${org.name}`, text })
  }
  return changes
}

let sweepTimer = null

/** Sweeps subscriptions now and then every hour. */
export function initSubscriptionSweeper() {
  const run = () => {
    try {
      const changes = sweepSubscriptions()
      if (changes.length) console.log(`[SUBSCRIPTIONS] ${changes.length} subscription status change(s) applied`)
    } catch (err) {
      console.error('[SUBSCRIPTIONS] sweep failed:', err.message)
    }
  }
  run()
  clearInterval(sweepTimer)
  sweepTimer = setInterval(run, 60 * 60 * 1000)
  sweepTimer.unref?.()
}

/**
 * Checks subscriptions and the records they depend on. With `fix`, repairs every issue marked
 * fixable in one write; over-limit organizations are only reported (fixing them means deleting
 * customer resources, which is the organization's decision).
 */
export function checkSubscriptionHealth({ fix = false, now = Date.now() } = {}) {
  const db = readDb()
  const orgs = db.organizations || {}
  const subs = db.subscriptions || {}
  const plans = db.plans || {}
  const users = db.users || {}
  const issues = []
  const add = (type, severity, message, ref, fixable = true) => issues.push({ type, severity, message, fixable, ...ref })

  for (const org of Object.values(orgs)) {
    const sub = subs[org.id]
    if (!sub) {
      add('missing_subscription', 'high', `"${org.name}" has no subscription record, so it silently gets a rolling Free plan.`, { organizationId: org.id })
      if (fix) {
        subs[org.id] = { id: `sub-${Date.now()}-${org.id}`, organizationId: org.id, planId: 'FREE', status: 'active', currentPeriodStart: new Date(now).toISOString(), currentPeriodEnd: new Date(now + 30 * DAY_MS).toISOString(), cancelAtPeriodEnd: false, updatedAt: new Date(now).toISOString() }
        org.planId = 'FREE'
      }
      continue
    }
    if (!plans[sub.planId]) {
      add('unknown_plan', 'high', `"${org.name}" is subscribed to plan '${sub.planId}', which no longer exists.`, { organizationId: org.id })
      if (fix) { sub.planId = 'FREE'; org.planId = 'FREE'; sub.updatedAt = new Date(now).toISOString() }
    } else if (org.planId !== sub.planId) {
      add('plan_mismatch', 'low', `"${org.name}" shows plan '${org.planId || 'none'}' but is subscribed to '${sub.planId}'.`, { organizationId: org.id })
      if (fix) org.planId = sub.planId
    }
    if (!sub.currentPeriodEnd || Number.isNaN(new Date(sub.currentPeriodEnd).getTime())) {
      add('invalid_period', 'medium', `"${org.name}" has no valid billing period end.`, { organizationId: org.id })
      if (fix) { sub.currentPeriodStart = sub.currentPeriodStart || new Date(now).toISOString(); sub.currentPeriodEnd = new Date(now + 30 * DAY_MS).toISOString() }
    }
    const resolved = resolveSubscriptionStatus(sub, now)
    if (resolved !== sub.status) {
      add('stale_status', 'medium', `"${org.name}" is stored as ${sub.status} but its period ended ${formatDay(sub.currentPeriodEnd)}; it should be ${resolved.replace('_', ' ')}.`, { organizationId: org.id })
      if (fix) { sub.status = resolved; sub.updatedAt = new Date(now).toISOString() }
    }
    if (!users[org.ownerId]) {
      add('missing_owner', 'medium', `"${org.name}" is owned by a user that no longer exists.`, { organizationId: org.id }, false)
    }

    // Usage beyond the limits that currently apply
    if (org.id !== PLATFORM_ORG_ID) {
      const limits = LAPSED.has(resolved) ? plans.FREE : plans[sub.planId]
      if (limits) {
        const count = (coll) => Object.values(db[coll] || {}).filter((r) => r.organizationId === org.id).length
        const members = (db.organizationMembers || []).filter((m) => m.organizationId === org.id).length
        const over = [['servers', count('servers'), limits.maxServers], ['projects', count('projects'), limits.maxProjects], ['team members', members, limits.maxTeamMembers]]
          .filter(([, used, max]) => used > max)
        if (over.length) {
          add('over_limit', 'low', `"${org.name}" uses more than ${limits.name} allows: ${over.map(([k, used, max]) => `${used}/${max} ${k}`).join(', ')}.`, { organizationId: org.id }, false)
        }
      }
    }
  }

  for (const sub of Object.values(subs)) {
    if (orgs[sub.organizationId]) continue
    add('orphan_subscription', 'medium', `Subscription for deleted organization '${sub.organizationId}'.`, { organizationId: sub.organizationId })
    if (fix) delete subs[sub.organizationId]
  }
  for (const [id, s] of Object.entries(db.servers || {})) {
    if (orgs[s.organizationId]) continue
    add('orphan_server', 'medium', `Server record '${s.name || id}' belongs to deleted organization '${s.organizationId || 'none'}'.`, { serverId: id })
    if (fix) delete db.servers[id]
  }
  for (const [id, p] of Object.entries(db.projects || {})) {
    if (orgs[p.organizationId]) continue
    add('orphan_project', 'medium', `Project record '${p.name || id}' belongs to deleted organization '${p.organizationId || 'none'}'.`, { projectId: id })
    if (fix) delete db.projects[id]
  }
  const orphanMembers = (db.organizationMembers || []).filter((m) => !orgs[m.organizationId] || !users[m.userId])
  if (orphanMembers.length) {
    add('orphan_membership', 'low', `${orphanMembers.length} membership record(s) point to a deleted user or organization.`, {})
    if (fix) db.organizationMembers = db.organizationMembers.filter((m) => orgs[m.organizationId] && users[m.userId])
  }

  const fixable = issues.filter((i) => i.fixable)
  if (fix && fixable.length) {
    db.subscriptions = subs
    writeDb(db)
  }
  return { checkedAt: new Date(now).toISOString(), issues, fixableCount: fixable.length, fixed: fix ? fixable.length : 0 }
}

function formatDay(value) {
  return value ? new Date(value).toISOString().slice(0, 10) : 'unknown'
}
