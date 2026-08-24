'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  CAPABILITIES,
  authorize,
  capabilitySnapshot,
  roleCapabilities,
  visibilityForCapability,
} = require('../domain/capabilities')

describe('admin capabilities', () => {
  it('keeps every sensitive operation as a separate capability', () => {
    assert.equal(roleCapabilities.PLATFORM_OPERATIONS.includes(CAPABILITIES.USERS_PHONE_READ), true)
    assert.equal(roleCapabilities.PLATFORM_OPERATIONS.includes(CAPABILITIES.EXPORT_CREATE), true)
    assert.equal(roleCapabilities.PLATFORM_OPERATIONS.includes(CAPABILITIES.REFUNDS_SUBMIT), false)
    assert.equal(roleCapabilities.PLATFORM_OPERATIONS.includes(CAPABILITIES.EVENTS_REGISTRATIONS_MANAGE), true)
    assert.equal(roleCapabilities.PLATFORM_OPERATIONS.includes(CAPABILITIES.EVENTS_FEEDBACK_READ), true)
    assert.equal(roleCapabilities.PLATFORM_OPERATIONS.includes(CAPABILITIES.ROLES_CHANGE), false)
    assert.equal(roleCapabilities.PLATFORM_OPERATIONS.includes(CAPABILITIES.GROWTH_ADJUST), false)
    assert.equal(roleCapabilities.PLATFORM_FINANCE.includes(CAPABILITIES.REFUNDS_SUBMIT), true)
    assert.equal(roleCapabilities.PLATFORM_FINANCE.includes(CAPABILITIES.USERS_PHONE_READ), false)
    assert.equal(roleCapabilities.BRANCH_ADMIN.includes(CAPABILITIES.ROLES_CHANGE), true)
    assert.equal(roleCapabilities.EVENT_STAFF.includes(CAPABILITIES.USERS_PHONE_READ), false)
    assert.equal(roleCapabilities.EVENT_STAFF.includes(CAPABILITIES.EXPORT_CREATE), false)
    assert.equal(roleCapabilities.EVENT_STAFF.includes(CAPABILITIES.EVENTS_REGISTRATIONS_MANAGE), false)
    assert.equal(roleCapabilities.EVENT_STAFF.includes(CAPABILITIES.EVENTS_CHECKIN_UNDO), false)
    assert.equal(roleCapabilities.EVENT_STAFF.includes(CAPABILITIES.EVENTS_FEEDBACK_READ), false)
    for (const role of ['PLATFORM_OWNER', 'PLATFORM_OPERATIONS', 'BRANCH_ADMIN', 'EVENT_OWNER', 'EVENT_MANAGER']) {
      assert.equal(roleCapabilities[role].includes(CAPABILITIES.EVENTS_CHECKIN_UNDO), true)
    }
    for (const role of ['PLATFORM_OWNER', 'PLATFORM_OPERATIONS', 'BRANCH_ADMIN', 'EVENT_OWNER', 'EVENT_MANAGER']) {
      assert.equal(roleCapabilities[role].includes(CAPABILITIES.COMMUNICATIONS_PUBLISH), true)
    }
    assert.equal(roleCapabilities.PLATFORM_FINANCE.includes(CAPABILITIES.COMMUNICATIONS_PUBLISH), false)
    assert.equal(roleCapabilities.EVENT_STAFF.includes(CAPABILITIES.COMMUNICATIONS_PUBLISH), false)
    assert.equal(roleCapabilities.PLATFORM_OPERATIONS.includes(CAPABILITIES.OPERATIONS_EXCEPTIONS_READ), true)
    assert.equal(roleCapabilities.PLATFORM_FINANCE.includes(CAPABILITIES.OPERATIONS_EXCEPTIONS_READ), true)
    for (const role of ['BRANCH_ADMIN', 'EVENT_OWNER', 'EVENT_MANAGER', 'EVENT_STAFF']) {
      assert.equal(roleCapabilities[role].includes(CAPABILITIES.OPERATIONS_EXCEPTIONS_READ), false)
    }
    assert.equal(roleCapabilities.PLATFORM_OPERATIONS.includes(CAPABILITIES.ANNOUNCEMENTS_MANAGE), true)
    assert.equal(roleCapabilities.BRANCH_ADMIN.includes(CAPABILITIES.ANNOUNCEMENTS_MANAGE), true)
    for (const role of ['PLATFORM_FINANCE', 'EVENT_OWNER', 'EVENT_MANAGER', 'EVENT_STAFF']) {
      assert.equal(roleCapabilities[role].includes(CAPABILITIES.ANNOUNCEMENTS_MANAGE), false)
    }
    for (const role of ['PLATFORM_OWNER', 'PLATFORM_OPERATIONS']) {
      assert.equal(roleCapabilities[role].includes(CAPABILITIES.OPPORTUNITIES_ARCHIVE), true)
    }
    for (const role of ['PLATFORM_FINANCE', 'BRANCH_ADMIN', 'EVENT_OWNER', 'EVENT_MANAGER', 'EVENT_STAFF']) {
      assert.equal(roleCapabilities[role].includes(CAPABILITIES.OPPORTUNITIES_ARCHIVE), false)
    }
  })

  it('enforces PLATFORM, BRANCH and EVENT scope on the server', () => {
    const branch = { roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: 'branch-a' }
    const event = { roleKey: 'EVENT_MANAGER', scopeType: 'EVENT', scopeId: 'event-a' }
    assert.equal(authorize([branch], CAPABILITIES.EVENTS_WRITE, {
      scopeType: 'EVENT', scopeId: 'event-b', branchId: 'branch-a',
    }), branch)
    assert.throws(() => authorize([branch], CAPABILITIES.EVENTS_WRITE, {
      scopeType: 'EVENT', scopeId: 'event-b', branchId: 'branch-b',
    }), /FORBIDDEN/)
    assert.equal(authorize([event], CAPABILITIES.EVENTS_WRITE, {
      scopeType: 'EVENT', scopeId: 'event-a', branchId: 'branch-b',
    }), event)
    assert.throws(() => authorize([event], CAPABILITIES.EVENTS_WRITE, {
      scopeType: 'EVENT', scopeId: 'event-b', branchId: 'branch-b',
    }), /FORBIDDEN/)
  })

  it('returns scoped capability descriptors for client display only', () => {
    const snapshot = capabilitySnapshot([
      { roleKey: 'EVENT_STAFF', scopeType: 'EVENT', scopeId: 'event-a' },
      { roleKey: 'EVENT_STAFF', scopeType: 'EVENT', scopeId: 'event-a' },
    ])
    assert.equal(snapshot.some(item => item.capability === CAPABILITIES.EVENTS_CHECKIN), true)
    assert.equal(snapshot.every(item => item.scopeType === 'EVENT' && item.scopeId === 'event-a'), true)
    assert.equal(new Set(snapshot.map(item => JSON.stringify(item))).size, snapshot.length)
  })

  it('does not widen one capability through an unrelated platform role', () => {
    const bindings = [
      { roleKey: 'PLATFORM_FINANCE', scopeType: 'PLATFORM', scopeId: null },
      { roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: 'branch-a' },
    ]
    assert.deepEqual(visibilityForCapability(bindings, CAPABILITIES.USERS_READ), {
      platform: false,
      branchIds: ['branch-a'],
      eventIds: [],
    })
    assert.deepEqual(visibilityForCapability(bindings, CAPABILITIES.ORDERS_READ), {
      platform: true,
      branchIds: ['branch-a'],
      eventIds: [],
    })
  })

  it('fails closed when a role key is stored under an incompatible scope type', () => {
    const malformedOwner = { roleKey: 'PLATFORM_OWNER', scopeType: 'BRANCH', scopeId: 'branch-a' }
    const malformedBranchAdmin = { roleKey: 'BRANCH_ADMIN', scopeType: 'PLATFORM', scopeId: null }
    assert.throws(() => authorize([malformedOwner], CAPABILITIES.ROLES_CHANGE, {
      scopeType: 'BRANCH', scopeId: 'branch-a',
    }), /FORBIDDEN/)
    assert.deepEqual(capabilitySnapshot([malformedOwner, malformedBranchAdmin]), [])
    assert.deepEqual(visibilityForCapability([malformedOwner], CAPABILITIES.USERS_READ), {
      platform: false,
      branchIds: [],
      eventIds: [],
    })
  })
})
