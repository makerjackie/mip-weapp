'use strict'

const { Buffer } = require('node:buffer')

const EVENT_COMMENT_CAPABILITY = 'events.comments.manage'

const eventScopedCapabilities = Object.freeze([
  'admin.dashboard',
  'events.read',
  'events.write',
  'events.roster.read',
  'events.registrations.manage',
  'users.phone.read',
  'events.checkin.manage',
  'events.checkin.undo',
  'events.team.manage',
  'events.album.manage',
  'events.feedback.read',
  EVENT_COMMENT_CAPABILITY,
  'communications.publish',
  'exports.create',
  'orders.read',
  'roles.change',
  'audit.read',
])

const EVENT_COMMENT_ROLE_CAPABILITIES = Object.freeze({
  PLATFORM_OPERATIONS: Object.freeze([
    'admin.dashboard',
    'branches.manage',
    'users.read',
    'users.phone.read',
    'users.fields.edit',
    'users.access.manage',
    'exports.create',
    'events.read',
    'events.write',
    'events.roster.read',
    'events.registrations.manage',
    'events.checkin.manage',
    'events.checkin.undo',
    'events.team.manage',
    'events.album.manage',
    'events.feedback.read',
    EVENT_COMMENT_CAPABILITY,
    'events.catalog.manage',
    'events.recaps.manage',
    'announcements.manage',
    'messages.manage',
    'messages.delivery.review',
    'communications.publish',
    'community.reports.manage',
    'opportunities.moderate',
    'opportunities.archive',
    'growth.read',
    'growth.configure',
    'tasks.manage',
    'banners.manage',
    'badges.manage',
    'game.manage',
    'knowledge.manage',
    'orders.read',
    'operations.exceptions.read',
    'audit.read',
  ]),
  BRANCH_ADMIN: Object.freeze([
    'admin.dashboard',
    'users.read',
    'users.phone.read',
    'users.fields.edit',
    'users.access.manage',
    'exports.create',
    'events.read',
    'events.write',
    'events.roster.read',
    'events.registrations.manage',
    'events.checkin.manage',
    'events.checkin.undo',
    'events.team.manage',
    'events.album.manage',
    'events.feedback.read',
    EVENT_COMMENT_CAPABILITY,
    'announcements.manage',
    'messages.manage',
    'communications.publish',
    'roles.change',
    'opportunities.moderate',
    'growth.read',
    'orders.read',
    'audit.read',
  ]),
  EVENT_OWNER: eventScopedCapabilities,
  EVENT_MANAGER: eventScopedCapabilities,
})

function hasEffectiveEventCommentCapability(row = {}) {
  if (row.responsibility_kind === 'ORGANIZER') {
    return row.role_key === null || row.role_key === undefined
  }
  if (row.responsibility_kind !== 'MANAGEMENT') return false
  if (row.role_key === 'PLATFORM_OWNER') return true

  const safeMaximum = EVENT_COMMENT_ROLE_CAPABILITIES[row.role_key]
  if (!safeMaximum?.includes(EVENT_COMMENT_CAPABILITY)) return false
  if (row.policy_mode === null || row.policy_mode === undefined || row.policy_mode === 'DEFAULT') {
    return true
  }
  if (row.policy_mode !== 'CUSTOM') return false

  const capabilities = parseCapabilities(row.capabilities_json)
  if (!capabilities) return false
  const unique = new Set(capabilities)
  return unique.size === capabilities.length
    && capabilities.every(item => typeof item === 'string' && safeMaximum.includes(item))
    && unique.has(EVENT_COMMENT_CAPABILITY)
}

function parseCapabilities(raw) {
  if (Array.isArray(raw)) return raw
  if (typeof raw !== 'string' && !Buffer.isBuffer(raw)) return null
  try {
    const parsed = JSON.parse(String(raw))
    return Array.isArray(parsed) ? parsed : null
  }
  catch {
    return null
  }
}

module.exports = {
  EVENT_COMMENT_ROLE_CAPABILITIES,
  hasEffectiveEventCommentCapability,
}
