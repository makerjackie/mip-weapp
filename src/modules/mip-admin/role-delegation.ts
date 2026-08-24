import type { AdminRoleBinding, AdminRoleKey, AdminScopeType } from './types'

export interface AdminRoleScope {
  scopeType: AdminScopeType
  scopeId: string | null
  branchId: string | null
}

export function scopeTypeForAdminRole(roleKey: AdminRoleKey): AdminScopeType {
  if (roleKey.startsWith('PLATFORM_')) {
    return 'PLATFORM'
  }
  return roleKey === 'BRANCH_ADMIN' ? 'BRANCH' : 'EVENT'
}

export function canDelegateAdminRole(
  actorRoles: AdminRoleBinding[],
  targetRole: AdminRoleKey,
  scope: AdminRoleScope,
) {
  return actorRoles.some((actor) => {
    if (actor.roleKey === 'PLATFORM_OWNER' && actor.scopeType === 'PLATFORM') {
      return true
    }
    if (scope.scopeType !== 'EVENT' || !targetRole.startsWith('EVENT_')) {
      return false
    }
    if (actor.roleKey === 'BRANCH_ADMIN' && actor.scopeType === 'BRANCH') {
      return actor.scopeId === scope.branchId
    }
    if (actor.scopeType !== 'EVENT' || actor.scopeId !== scope.scopeId) {
      return false
    }
    if (actor.roleKey === 'EVENT_OWNER') {
      return targetRole === 'EVENT_MANAGER' || targetRole === 'EVENT_STAFF'
    }
    return actor.roleKey === 'EVENT_MANAGER' && targetRole === 'EVENT_STAFF'
  })
}
