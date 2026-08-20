'use strict'

const ROLE_CAPABILITIES = Object.freeze({
  owner: ['dashboard', 'profiles', 'events', 'orders', 'refunds', 'audit', 'roles', 'operations', 'announcements', 'reports'],
  manager: ['dashboard', 'profiles', 'events', 'orders', 'refunds', 'audit', 'operations', 'announcements', 'reports'],
  reviewer: ['dashboard', 'profiles', 'reports'],
  support: ['dashboard', 'orders', 'refunds'],
})

function capabilitiesFor(role) {
  return ROLE_CAPABILITIES[role] ? [...ROLE_CAPABILITIES[role]] : []
}

function assertCapability(admin, capability) {
  if (!admin || admin.status !== 'ACTIVE' || !capabilitiesFor(admin.role).includes(capability)) {
    throw new Error('FORBIDDEN')
  }
}

module.exports = { assertCapability, capabilitiesFor }
