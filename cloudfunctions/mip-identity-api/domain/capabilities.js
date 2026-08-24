'use strict'

const capabilitiesByRole = {
  PLATFORM_OWNER: [
    'admin:enter',
    'platform:operate',
    'branch:manage',
    'profile:manage',
    'profile:read_phone',
    'admin:roles',
  ],
  PLATFORM_OPERATIONS: [
    'admin:enter',
    'platform:operate',
    'branch:manage',
    'profile:manage',
  ],
  PLATFORM_FINANCE: ['admin:enter', 'finance:manage'],
  BRANCH_ADMIN: ['admin:enter', 'branch:operate', 'branch:manage_members'],
  EVENT_OWNER: ['admin:enter', 'event:manage'],
  EVENT_MANAGER: ['admin:enter', 'event:manage'],
  EVENT_STAFF: ['admin:enter', 'event:check_in'],
}

const policyRequirementByCapability = Object.freeze({
  'admin:enter': 'admin.dashboard',
  'platform:operate': 'admin.dashboard',
  'branch:manage': 'branches.manage',
  'profile:manage': 'users.fields.edit',
  'profile:read_phone': 'users.phone.read',
  'admin:roles': 'roles.change',
  'finance:manage': 'orders.read',
  'branch:operate': 'admin.dashboard',
  'branch:manage_members': 'users.read',
  'event:manage': 'events.write',
  'event:check_in': 'events.checkin.manage',
})

function configuredCapabilityAllows(row, capability) {
  if (row.role_key === 'PLATFORM_OWNER') return true
  const value = row.policy_capabilities_json
  if (value === null || value === undefined) return true
  try {
    const capabilities = typeof value === 'string' ? JSON.parse(value) : value
    const required = policyRequirementByCapability[capability]
    return typeof required === 'string'
      && Array.isArray(capabilities)
      && new Set(capabilities).size === capabilities.length
      && capabilities.every(item => typeof item === 'string')
      && capabilities.includes(required)
  }
  catch {
    return false
  }
}

function projectGrants(rows) {
  const groups = new Map()
  for (const row of rows || []) {
    const key = `${row.scope_type}:${row.scope_id}`
    const group = groups.get(key) || {
      scopeType: row.scope_type,
      scopeId: row.scope_id,
      roles: [],
      capabilities: new Set(),
    }
    if (!group.roles.includes(row.role_key)) {
      group.roles.push(row.role_key)
    }
    for (const capability of capabilitiesByRole[row.role_key] || []) {
      if (configuredCapabilityAllows(row, capability)) group.capabilities.add(capability)
    }
    groups.set(key, group)
  }
  return [...groups.values()].map(group => ({
    scopeType: group.scopeType,
    scopeId: group.scopeId,
    roles: group.roles,
    capabilities: [...group.capabilities].sort(),
  }))
}

module.exports = { capabilitiesByRole, projectGrants }
