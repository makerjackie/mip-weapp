'use strict'

const CAPABILITIES = Object.freeze({
  DASHBOARD: 'admin.dashboard',
  BRANCHES_MANAGE: 'branches.manage',
  USERS_READ: 'users.read',
  USERS_PHONE_READ: 'users.phone.read',
  USERS_EDIT: 'users.fields.edit',
  USERS_CONTROL: 'users.access.manage',
  EXPORT_CREATE: 'exports.create',
  EVENTS_READ: 'events.read',
  EVENTS_WRITE: 'events.write',
  EVENTS_ROSTER: 'events.roster.read',
  EVENTS_REGISTRATIONS_MANAGE: 'events.registrations.manage',
  EVENTS_CHECKIN: 'events.checkin.manage',
  EVENTS_CHECKIN_UNDO: 'events.checkin.undo',
  EVENTS_TEAM: 'events.team.manage',
  EVENTS_ALBUM_MANAGE: 'events.album.manage',
  EVENTS_FEEDBACK_READ: 'events.feedback.read',
  ANNOUNCEMENTS_MANAGE: 'announcements.manage',
  COMMUNICATIONS_PUBLISH: 'communications.publish',
  COMMUNITY_REPORTS_MANAGE: 'community.reports.manage',
  OPPORTUNITIES_MODERATE: 'opportunities.moderate',
  OPPORTUNITIES_ARCHIVE: 'opportunities.archive',
  GROWTH_READ: 'growth.read',
  GROWTH_CONFIGURE: 'growth.configure',
  GROWTH_ADJUST: 'growth.adjust',
  ORDERS_READ: 'orders.read',
  REFUNDS_SUBMIT: 'refunds.submit',
  OPERATIONS_EXCEPTIONS_READ: 'operations.exceptions.read',
  ROLES_CHANGE: 'roles.change',
  AUDIT_READ: 'audit.read',
})

const ALL = Object.freeze(Object.values(CAPABILITIES))
const roleCapabilities = Object.freeze({
  PLATFORM_OWNER: ALL,
  PLATFORM_OPERATIONS: [
    CAPABILITIES.DASHBOARD,
    CAPABILITIES.BRANCHES_MANAGE,
    CAPABILITIES.USERS_READ,
    CAPABILITIES.USERS_PHONE_READ,
    CAPABILITIES.USERS_EDIT,
    CAPABILITIES.USERS_CONTROL,
    CAPABILITIES.EXPORT_CREATE,
    CAPABILITIES.EVENTS_READ,
    CAPABILITIES.EVENTS_WRITE,
    CAPABILITIES.EVENTS_ROSTER,
    CAPABILITIES.EVENTS_REGISTRATIONS_MANAGE,
    CAPABILITIES.EVENTS_CHECKIN,
    CAPABILITIES.EVENTS_CHECKIN_UNDO,
    CAPABILITIES.EVENTS_TEAM,
    CAPABILITIES.EVENTS_ALBUM_MANAGE,
    CAPABILITIES.EVENTS_FEEDBACK_READ,
    CAPABILITIES.ANNOUNCEMENTS_MANAGE,
    CAPABILITIES.COMMUNICATIONS_PUBLISH,
    CAPABILITIES.COMMUNITY_REPORTS_MANAGE,
    CAPABILITIES.OPPORTUNITIES_MODERATE,
    CAPABILITIES.OPPORTUNITIES_ARCHIVE,
    CAPABILITIES.GROWTH_READ,
    CAPABILITIES.GROWTH_CONFIGURE,
    CAPABILITIES.ORDERS_READ,
    CAPABILITIES.OPERATIONS_EXCEPTIONS_READ,
    CAPABILITIES.AUDIT_READ,
  ],
  PLATFORM_FINANCE: [
    CAPABILITIES.DASHBOARD,
    CAPABILITIES.ORDERS_READ,
    CAPABILITIES.REFUNDS_SUBMIT,
    CAPABILITIES.EXPORT_CREATE,
    CAPABILITIES.OPERATIONS_EXCEPTIONS_READ,
    CAPABILITIES.AUDIT_READ,
  ],
  BRANCH_ADMIN: [
    CAPABILITIES.DASHBOARD,
    CAPABILITIES.USERS_READ,
    CAPABILITIES.USERS_PHONE_READ,
    CAPABILITIES.USERS_EDIT,
    CAPABILITIES.USERS_CONTROL,
    CAPABILITIES.EXPORT_CREATE,
    CAPABILITIES.EVENTS_READ,
    CAPABILITIES.EVENTS_WRITE,
    CAPABILITIES.EVENTS_ROSTER,
    CAPABILITIES.EVENTS_REGISTRATIONS_MANAGE,
    CAPABILITIES.EVENTS_CHECKIN,
    CAPABILITIES.EVENTS_CHECKIN_UNDO,
    CAPABILITIES.EVENTS_TEAM,
    CAPABILITIES.EVENTS_ALBUM_MANAGE,
    CAPABILITIES.EVENTS_FEEDBACK_READ,
    CAPABILITIES.ANNOUNCEMENTS_MANAGE,
    CAPABILITIES.COMMUNICATIONS_PUBLISH,
    CAPABILITIES.ROLES_CHANGE,
    CAPABILITIES.OPPORTUNITIES_MODERATE,
    CAPABILITIES.GROWTH_READ,
    CAPABILITIES.ORDERS_READ,
    CAPABILITIES.AUDIT_READ,
  ],
  EVENT_OWNER: [
    CAPABILITIES.DASHBOARD,
    CAPABILITIES.EVENTS_READ,
    CAPABILITIES.EVENTS_WRITE,
    CAPABILITIES.EVENTS_ROSTER,
    CAPABILITIES.EVENTS_REGISTRATIONS_MANAGE,
    CAPABILITIES.USERS_PHONE_READ,
    CAPABILITIES.EVENTS_CHECKIN,
    CAPABILITIES.EVENTS_CHECKIN_UNDO,
    CAPABILITIES.EVENTS_TEAM,
    CAPABILITIES.EVENTS_ALBUM_MANAGE,
    CAPABILITIES.EVENTS_FEEDBACK_READ,
    CAPABILITIES.COMMUNICATIONS_PUBLISH,
    CAPABILITIES.EXPORT_CREATE,
    CAPABILITIES.ORDERS_READ,
    CAPABILITIES.ROLES_CHANGE,
    CAPABILITIES.AUDIT_READ,
  ],
  EVENT_MANAGER: [
    CAPABILITIES.DASHBOARD,
    CAPABILITIES.EVENTS_READ,
    CAPABILITIES.EVENTS_WRITE,
    CAPABILITIES.EVENTS_ROSTER,
    CAPABILITIES.EVENTS_REGISTRATIONS_MANAGE,
    CAPABILITIES.USERS_PHONE_READ,
    CAPABILITIES.EVENTS_CHECKIN,
    CAPABILITIES.EVENTS_CHECKIN_UNDO,
    CAPABILITIES.EVENTS_TEAM,
    CAPABILITIES.EVENTS_ALBUM_MANAGE,
    CAPABILITIES.EVENTS_FEEDBACK_READ,
    CAPABILITIES.COMMUNICATIONS_PUBLISH,
    CAPABILITIES.EXPORT_CREATE,
    CAPABILITIES.ORDERS_READ,
    CAPABILITIES.ROLES_CHANGE,
    CAPABILITIES.AUDIT_READ,
  ],
  EVENT_STAFF: [
    CAPABILITIES.DASHBOARD,
    CAPABILITIES.EVENTS_READ,
    CAPABILITIES.EVENTS_ROSTER,
    CAPABILITIES.EVENTS_CHECKIN,
  ],
})

const roleScopeTypes = Object.freeze({
  PLATFORM_OWNER: 'PLATFORM',
  PLATFORM_OPERATIONS: 'PLATFORM',
  PLATFORM_FINANCE: 'PLATFORM',
  BRANCH_ADMIN: 'BRANCH',
  EVENT_OWNER: 'EVENT',
  EVENT_MANAGER: 'EVENT',
  EVENT_STAFF: 'EVENT',
})

function isValidRoleBinding(binding) {
  const expectedScopeType = roleScopeTypes[binding?.roleKey]
  if (!expectedScopeType || binding?.scopeType !== expectedScopeType) return false
  return expectedScopeType === 'PLATFORM'
    ? binding.scopeId === null || binding.scopeId === undefined
    : typeof binding.scopeId === 'string' && binding.scopeId.length > 0
}

function coversScope(binding, requested) {
  if (!isValidRoleBinding(binding)) return false
  if (binding.scopeType === 'PLATFORM') {
    return true
  }
  if (binding.scopeType === 'BRANCH') {
    return requested.scopeType === 'BRANCH' && binding.scopeId === requested.scopeId
      || requested.scopeType === 'EVENT' && binding.scopeId === requested.branchId
  }
  return binding.scopeType === 'EVENT'
    && requested.scopeType === 'EVENT'
    && binding.scopeId === requested.scopeId
}

function authorize(bindings, capability, requested = { scopeType: 'PLATFORM', scopeId: null }) {
  const binding = bindings.find(item => roleCapabilities[item.roleKey]?.includes(capability)
    && coversScope(item, requested))
  if (!binding) {
    const error = new Error('FORBIDDEN')
    error.code = 'FORBIDDEN'
    throw error
  }
  return binding
}

function firstGrant(bindings, capability) {
  const binding = bindings.find(item => isValidRoleBinding(item)
    && roleCapabilities[item.roleKey]?.includes(capability))
  if (!binding) {
    const error = new Error('FORBIDDEN')
    error.code = 'FORBIDDEN'
    throw error
  }
  return binding
}

function capabilitySnapshot(bindings) {
  const entries = []
  const seen = new Set()
  for (const binding of bindings) {
    if (!isValidRoleBinding(binding)) continue
    for (const capability of roleCapabilities[binding.roleKey] || []) {
      const key = `${capability}:${binding.scopeType}:${binding.scopeId || ''}`
      if (!seen.has(key)) {
        seen.add(key)
        entries.push({
          capability,
          scopeType: binding.scopeType,
          scopeId: binding.scopeId || null,
        })
      }
    }
  }
  return entries
}

function visibilityFromBindings(bindings) {
  const validBindings = bindings.filter(isValidRoleBinding)
  return {
    platform: validBindings.some(item => item.scopeType === 'PLATFORM'),
    branchIds: [...new Set(validBindings.filter(item => item.scopeType === 'BRANCH').map(item => item.scopeId))],
    eventIds: [...new Set(validBindings.filter(item => item.scopeType === 'EVENT').map(item => item.scopeId))],
  }
}

function visibilityForCapability(bindings, capability) {
  return visibilityFromBindings(bindings.filter(item => roleCapabilities[item.roleKey]?.includes(capability)))
}

module.exports = {
  CAPABILITIES,
  authorize,
  capabilitySnapshot,
  coversScope,
  firstGrant,
  isValidRoleBinding,
  roleCapabilities,
  visibilityForCapability,
  visibilityFromBindings,
}
