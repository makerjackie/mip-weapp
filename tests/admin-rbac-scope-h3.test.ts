import { describe, expect, it } from 'vitest'
import { canDelegateAdminRole, scopeTypeForAdminRole } from '../src/modules/mip-admin/role-delegation'

describe('MIP admin role scope', () => {
  it('keeps the platform, branch and event delegation chain narrow', () => {
    const platformOwner = [{ roleKey: 'PLATFORM_OWNER' as const, scopeType: 'PLATFORM' as const, scopeId: null }]
    const branchAdmin = [{ roleKey: 'BRANCH_ADMIN' as const, scopeType: 'BRANCH' as const, scopeId: 'branch-a' }]
    const eventOwner = [{ roleKey: 'EVENT_OWNER' as const, scopeType: 'EVENT' as const, scopeId: 'event-a' }]
    const eventManager = [{ roleKey: 'EVENT_MANAGER' as const, scopeType: 'EVENT' as const, scopeId: 'event-a' }]
    const eventScope = { scopeType: 'EVENT' as const, scopeId: 'event-a', branchId: 'branch-a' }

    expect(scopeTypeForAdminRole('PLATFORM_FINANCE')).toBe('PLATFORM')
    expect(scopeTypeForAdminRole('BRANCH_ADMIN')).toBe('BRANCH')
    expect(scopeTypeForAdminRole('EVENT_STAFF')).toBe('EVENT')
    expect(canDelegateAdminRole(platformOwner, 'BRANCH_ADMIN', {
      scopeType: 'BRANCH',
      scopeId: 'branch-a',
      branchId: 'branch-a',
    })).toBe(true)
    expect(canDelegateAdminRole(branchAdmin, 'EVENT_OWNER', eventScope)).toBe(true)
    expect(canDelegateAdminRole(branchAdmin, 'EVENT_OWNER', { ...eventScope, branchId: 'branch-b' })).toBe(false)
    expect(canDelegateAdminRole(eventOwner, 'EVENT_MANAGER', eventScope)).toBe(true)
    expect(canDelegateAdminRole(eventOwner, 'EVENT_OWNER', eventScope)).toBe(false)
    expect(canDelegateAdminRole(eventManager, 'EVENT_STAFF', eventScope)).toBe(true)
    expect(canDelegateAdminRole(eventManager, 'EVENT_MANAGER', eventScope)).toBe(false)
  })
})
