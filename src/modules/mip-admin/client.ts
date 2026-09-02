import type { BenefitLedgerAdminGateway } from './benefit-ledger'
import type { CommunityAdminGateway } from './community-admin'
import type { DashboardAdminGateway } from './dashboard-admin'
import type { EventCatalogAdminGateway } from './event-catalogs-admin'
import type { EventsAdminGateway } from './events-admin'
import type { ExportAdminGateway } from './export-download'
import type { GovernanceAdminGateway } from './governance-admin'
import type { GrowthAdminGateway } from './growth-admin'
import type { MembershipsAdminGateway } from './memberships-admin'
import type { MessagingAdminGateway } from './messaging-admin'
import type { OpportunityAdminGateway } from './opportunity-admin'
import type { OrdersAdminGateway } from './orders-admin'
import type { PaymentAttemptsAdminGateway } from './payment-attempts'
import type { PendingAdminExportStore } from './pending-export'
import type { SessionAdminGateway } from './session-admin'
import type {
  AdminCapability,
  AdminCapabilityGrant,
} from './types'
import type { UserContentAdminGateway } from './user-content-admin'
import type { UsersAdminGateway } from './users-admin'
import { createQueryCache } from '@weapp/shared/cache'
import { createMipBenefitLedgerAdmin } from './benefit-ledger'
import { createMipCommunityAdmin } from './community-admin'
import { createMipDashboardAdmin } from './dashboard-admin'
import { createMipEventCatalogAdmin } from './event-catalogs-admin'
import { createMipEventsAdmin } from './events-admin'
import { createMipExportsAdmin } from './exports-admin'
import { createMipGovernanceAdmin } from './governance-admin'
import { createMipGrowthAdmin } from './growth-admin'
import { createMipMembershipsAdmin } from './memberships-admin'
import { createMipMessagingAdmin } from './messaging-admin'
import { createMipOpportunityAdmin } from './opportunity-admin'
import { createMipOrdersAdmin } from './orders-admin'
import { createMipPaymentAttemptsAdmin } from './payment-attempts'
import { createMipAdminSession } from './session-admin'
import { createMipUserContentAdmin } from './user-content-admin'
import { createMipUsersAdmin } from './users-admin'

export type MipAdminClientGateway
  = BenefitLedgerAdminGateway
    & CommunityAdminGateway
    & DashboardAdminGateway
    & EventCatalogAdminGateway
    & EventsAdminGateway
    & ExportAdminGateway
    & GovernanceAdminGateway
    & GrowthAdminGateway
    & MembershipsAdminGateway
    & MessagingAdminGateway
    & OpportunityAdminGateway
    & OrdersAdminGateway
    & PaymentAttemptsAdminGateway
    & SessionAdminGateway
    & UserContentAdminGateway
    & UsersAdminGateway

export function createMipAdminModule(
  gateway: MipAdminClientGateway,
  options: { pendingExportStore?: PendingAdminExportStore } = {},
) {
  const cache = createQueryCache(15_000)
  let generation = 0
  const dashboard = createMipDashboardAdmin(gateway, cache)
  const session = createMipAdminSession(gateway, cache)
  const community = createMipCommunityAdmin(gateway, cache)
  const growth = createMipGrowthAdmin(gateway, cache)
  const benefitLedger = createMipBenefitLedgerAdmin(gateway, cache)
  const events = createMipEventsAdmin(gateway, cache)
  const eventCatalogs = createMipEventCatalogAdmin(gateway, cache)
  const exports = createMipExportsAdmin(
    gateway,
    cache,
    options.pendingExportStore,
    () => {
      const workflowGeneration = generation
      return { isCurrent: () => workflowGeneration === generation }
    },
  )
  const governance = createMipGovernanceAdmin(gateway, cache)
  const messaging = createMipMessagingAdmin(gateway, cache)
  const memberships = createMipMembershipsAdmin(gateway, cache)
  const opportunities = createMipOpportunityAdmin(gateway, cache)
  const orders = createMipOrdersAdmin(gateway, cache)
  const paymentAttempts = createMipPaymentAttemptsAdmin(gateway, cache)
  const users = createMipUsersAdmin(gateway, cache)
  const userContent = createMipUserContentAdmin(gateway, cache)
  return {
    dashboard,
    session,
    messaging,
    community,
    users,
    userContent,
    memberships,
    events,
    eventCatalogs,
    governance,
    opportunities,
    growth,
    benefitLedger,
    orders,
    paymentAttempts,
    exports,
    runtime: {
      clearSensitive() {
        cache.invalidate('mip-admin:users')
        cache.invalidate('mip-admin:user-influence')
        cache.invalidate('mip-admin:membership')
        cache.invalidate('mip-admin:roster')
      },
      invalidate() {
        generation += 1
        cache.invalidate()
        options.pendingExportStore?.clear()
      },
    },
  }
}

export function hasCapability(grants: AdminCapabilityGrant[], capability: AdminCapability) {
  return grants.some(item => item.capability === capability)
}

export function hasScopedCapability(
  grants: AdminCapabilityGrant[],
  capability: AdminCapability,
  scope: { scopeType: 'PLATFORM' | 'BRANCH' | 'EVENT', scopeId: string | null, branchId?: string | null },
) {
  return grants.some(item => item.capability === capability && (
    item.scopeType === 'PLATFORM'
    || (item.scopeType === scope.scopeType && item.scopeId === scope.scopeId)
    || (item.scopeType === 'BRANCH' && scope.scopeType === 'EVENT' && item.scopeId === scope.branchId)
  ))
}
