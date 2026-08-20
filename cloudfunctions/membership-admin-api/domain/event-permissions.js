'use strict'

/**
 * Event-scoped permissions stay intentionally small for an early-stage
 * community. A person receives one understandable preset; individual
 * capabilities remain an internal authorization detail.
 *
 * Legacy roles are read during the rolling migration so an old function/database
 * deployment cannot accidentally lock operators out.
 */

const EVENT_MANAGER_ROLES = Object.freeze([
  'EVENT_OWNER',
  'EVENT_MANAGER',
  'EVENT_STAFF',
])

const LEGACY_ROLE_ALIASES = Object.freeze({
  EDITOR: 'EVENT_MANAGER',
  ROSTER_MANAGER: 'EVENT_STAFF',
  CHECKIN_STAFF: 'EVENT_STAFF',
  ALBUM_MODERATOR: 'EVENT_STAFF',
})

const ROLE_CAPABILITIES = Object.freeze({
  EVENT_OWNER: Object.freeze([
    'edit',
    'publish',
    'team',
    'roster',
    'rosterSensitive',
    'rosterExport',
    'registrationReview',
    'checkin',
    'album',
  ]),
  EVENT_MANAGER: Object.freeze([
    'edit',
    'publish',
    'roster',
    'rosterSensitive',
    'rosterExport',
    'registrationReview',
    'checkin',
    'album',
  ]),
  EVENT_STAFF: Object.freeze([
    'roster',
    'rosterSensitive',
    'checkin',
    'album',
  ]),
})

function normalizeEventManagerRole(role) {
  if (EVENT_MANAGER_ROLES.includes(role)) {
    return role
  }
  return LEGACY_ROLE_ALIASES[role] || null
}

function capabilitiesForEventRole(role) {
  const normalized = normalizeEventManagerRole(role)
  return normalized ? ROLE_CAPABILITIES[normalized] : []
}

function eventRoleHasCapability(role, capability) {
  return capabilitiesForEventRole(role).includes(capability)
}

function actorRoleForEventRole(role) {
  const normalized = normalizeEventManagerRole(role)
  if (normalized === 'EVENT_OWNER') return 'owner'
  if (normalized === 'EVENT_MANAGER') return 'manager'
  return 'staff'
}

module.exports = {
  EVENT_MANAGER_ROLES,
  actorRoleForEventRole,
  capabilitiesForEventRole,
  eventRoleHasCapability,
  normalizeEventManagerRole,
}
