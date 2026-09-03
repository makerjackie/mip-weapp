import type { EventsAdminGateway } from './events-admin'
import type { SessionAdminGateway } from './session-admin'
import type {
  AdminCapability,
  AdminCapabilityGrant,
} from './types'
import { createQueryCache } from '@weapp/shared/cache'
import { createMipEventsAdmin } from './events-admin'
import { createMipAdminSession } from './session-admin'

export type MipAdminClientGateway
  = EventsAdminGateway
    & SessionAdminGateway

export function createMipAdminModule(gateway: MipAdminClientGateway) {
  const cache = createQueryCache(15_000)
  const session = createMipAdminSession(gateway, cache)
  const events = createMipEventsAdmin(gateway, cache)
  return {
    session,
    events,
    runtime: {
      invalidate() {
        cache.invalidate()
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
