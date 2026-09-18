import {
  getSubscriptionByOrgId,
  getPlanById,
  getServersByOrgId,
  getProjectsByOrgId,
  getOrganizationMembers,
  getAllPlans
} from './db.service.js'

/**
 * Entitlement check helper to verify if organization is allowed to perform an action or expand resources
 * @param {string} organizationId
 * @param {'servers'|'projects'|'teamMembers'|'monitoring'|'apiAccess'} featureKey
 * @returns {{ allowed: boolean, reason?: string, current: number, max: number, planId: string }}
 */
export function checkEntitlement(organizationId, featureKey) {
  const subscription = getSubscriptionByOrgId(organizationId)
  const plan = getPlanById(subscription.planId)

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

  if (typeof max === 'boolean') {
    return {
      allowed: max,
      reason: max ? null : `Feature '${featureKey}' is not included in the ${plan.name} plan. Please upgrade to access this feature.`,
      current: 0,
      max: max ? 1 : 0,
      planId: plan.id
    }
  }

  const allowed = current < max
  return {
    allowed,
    reason: allowed ? null : `Plan limit reached for ${featureKey} (${current}/${max}). Upgrade your subscription to add more.`,
    current,
    max,
    planId: plan.id
  }
}

/**
 * Get full organization subscription summary with current usage vs quotas
 */
export function getSubscriptionSummary(organizationId) {
  const subscription = getSubscriptionByOrgId(organizationId)
  const plan = getPlanById(subscription.planId)
  const plans = getAllPlans()

  const servers = getServersByOrgId(organizationId)
  const projects = getProjectsByOrgId(organizationId)
  const teamMembers = getOrganizationMembers(organizationId)

  return {
    subscription,
    plan,
    plans,
    usage: {
      servers: { current: servers.length, max: plan.maxServers },
      projects: { current: projects.length, max: plan.maxProjects },
      teamMembers: { current: teamMembers.length, max: plan.maxTeamMembers },
      monitoring: plan.monitoring,
      apiAccess: plan.apiAccess
    }
  }
}
