import type {
  AdminCapability,
  AdminCapabilityGrant,
} from '../../../modules/mip-admin'
import type { AdminDashboardMetricView } from './model'

interface MetricTargetGroup {
  capability: AdminCapability
  path: string
  keys: string[]
}

const targetGroups: MetricTargetGroup[] = [{
  capability: 'users.read',
  path: '/packages/admin/profiles/index',
  keys: ['current-players', 'new-accounts', 'membership-expiring'],
}, {
  capability: 'orders.read',
  path: '/packages/admin/orders/index',
  keys: [
    'membership-initial',
    'membership-first-renewal',
    'membership-repeat-renewal',
    'membership-paid-amount',
    'events-net-amount',
  ],
}, {
  capability: 'events.read',
  path: '/packages/admin/managed-events/index',
  keys: [
    'registration-open-events',
    'events-total',
    'events-feedback-rate',
    'events-rating',
  ],
}, {
  capability: 'events.roster.read',
  path: '/packages/admin/event-participants/index',
  keys: ['effective-registrations', 'events-checkin-rate'],
}, {
  capability: 'events.registrations.manage',
  path: '/packages/admin/event-registrations/index',
  keys: ['events-pending-review'],
}, {
  capability: 'opportunities.moderate',
  path: '/packages/admin/opportunities/index',
  keys: [
    'published-opportunities',
    'opportunities-total',
    'opportunities-team-rate',
    'opportunities-referrals',
    'opportunities-cards',
    'opportunities-cases',
    'opportunities-conversion',
  ],
}, {
  capability: 'tasks.manage',
  path: '/packages/admin/tasks/index',
  keys: ['tasks-published'],
}, {
  capability: 'tasks.manage',
  path: '/packages/admin/task-completions/index',
  keys: [
    'task-completions',
    'tasks-completed',
    'tasks-experience',
    'tasks-pending-review',
  ],
}]

const metricTargets = new Map(targetGroups.flatMap(group => group.keys.map(key => [key, {
  capability: group.capability,
  path: group.path,
}] as const)))

export function withDashboardMetricTargets(
  metrics: AdminDashboardMetricView[],
  grants: AdminCapabilityGrant[],
) {
  return metrics.map((metric) => {
    const target = metricTargets.get(metric.key)
    if (!metric.available
      || !target
      || !grants.some(grant => grant.capability === target.capability)) {
      return metric
    }
    return { ...metric, path: target.path }
  })
}
