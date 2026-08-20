'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  actorRoleForEventRole,
  capabilitiesForEventRole,
  eventRoleHasCapability,
  normalizeEventManagerRole,
} = require('../domain/event-permissions')

test('event roles expose three understandable presets', () => {
  assert.equal(normalizeEventManagerRole('EVENT_OWNER'), 'EVENT_OWNER')
  assert.equal(normalizeEventManagerRole('EVENT_MANAGER'), 'EVENT_MANAGER')
  assert.equal(normalizeEventManagerRole('EVENT_STAFF'), 'EVENT_STAFF')
  assert.equal(normalizeEventManagerRole('EDITOR'), 'EVENT_MANAGER')
  assert.equal(normalizeEventManagerRole('CHECKIN_STAFF'), 'EVENT_STAFF')
})

test('event operators can contact registrants while bulk export stays manager-scoped', () => {
  assert.equal(eventRoleHasCapability('EVENT_OWNER', 'team'), true)
  assert.equal(eventRoleHasCapability('EVENT_OWNER', 'rosterSensitive'), true)
  assert.equal(eventRoleHasCapability('EVENT_MANAGER', 'team'), false)
  assert.equal(eventRoleHasCapability('EVENT_MANAGER', 'rosterSensitive'), true)
  assert.equal(eventRoleHasCapability('EVENT_MANAGER', 'rosterExport'), true)
  assert.equal(eventRoleHasCapability('EVENT_STAFF', 'rosterSensitive'), true)
  assert.equal(eventRoleHasCapability('EVENT_STAFF', 'rosterExport'), false)
  assert.deepEqual(capabilitiesForEventRole('UNKNOWN'), [])
})

test('workflow actor roles remain compatible with owner and manager gates', () => {
  assert.equal(actorRoleForEventRole('EVENT_OWNER'), 'owner')
  assert.equal(actorRoleForEventRole('EVENT_MANAGER'), 'manager')
  assert.equal(actorRoleForEventRole('EVENT_STAFF'), 'staff')
})
