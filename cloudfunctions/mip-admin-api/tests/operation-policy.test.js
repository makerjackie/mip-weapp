'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { eventOperationPolicy, EDITABLE_EVENT_STATUSES } = require('../domain/event-policy')
const { opportunityOperationPolicy, EDITABLE_OPPORTUNITY_STATUSES } = require('../domain/opportunity-policy')

test('event projection shares the transaction edit boundary and honours scope capabilities', () => {
  for (const status of ['DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ENDED', 'CANCELLED', 'ARCHIVED']) {
    assert.equal(eventOperationPolicy({ status }, () => true).availableActions.includes('mip.admin.events.save'), EDITABLE_EVENT_STATUSES.includes(status))
    assert.deepEqual(eventOperationPolicy({ status }, () => false).availableActions, [])
  }
  assert.deepEqual(eventOperationPolicy({ status: 'PUBLISHED' }, () => true).readOnlyFields, ['scopeType', 'branchId', 'eventMode', 'accessType', 'registrationPolicy'])
})
test('opportunity projection never exposes impossible lifecycle mutations', () => {
  for (const status of ['DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ENDED', 'ARCHIVED']) {
    const available = opportunityOperationPolicy({ status, contentSafetyStatus: 'APPROVED' }, () => true).availableActions
    assert.equal(available.includes('mip.admin.opportunities.save'), EDITABLE_OPPORTUNITY_STATUSES.includes(status))
    assert.equal(available.includes('mip.admin.opportunities.end'), status === 'PUBLISHED')
    assert.equal(available.includes('mip.admin.opportunities.archive'), status === 'DRAFT')
  }
  assert.deepEqual(opportunityOperationPolicy({ status: 'PUBLISHED', deleted: true }, () => true).availableActions, [])
  assert.deepEqual(opportunityOperationPolicy({ status: 'DRAFT' }, () => false).availableActions, [])
  assert.equal(opportunityOperationPolicy({ status: 'DRAFT', contentSafetyStatus: 'APPROVED', deadlineAt: '2020-01-01' }, () => true).availableActions.includes('mip.admin.opportunities.publish'), false)
})
