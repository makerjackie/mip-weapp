'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { describe, it } = require('node:test')
const {
  outboxMutationActions,
  postCommitAutomationFor,
} = require('../lib/post-commit-automation')

describe('admin post-commit automation routing', () => {
  it('does not require trusted app context for ordinary reads or health', () => {
    assert.deepEqual(postCommitAutomationFor('mip.admin.health'), {
      messageSchedule: false,
      outbox: false,
      requiresTrustedAppId: false,
    })
    assert.deepEqual(postCommitAutomationFor('mip.admin.users.list'), {
      messageSchedule: false,
      outbox: false,
      requiresTrustedAppId: false,
    })
  })

  it('requires trusted app context only for registered automation mutations', () => {
    assert.deepEqual(postCommitAutomationFor('mip.admin.messageCampaigns.schedule'), {
      messageSchedule: true,
      outbox: false,
      requiresTrustedAppId: true,
    })
    assert.deepEqual(postCommitAutomationFor('mip.admin.messageCampaigns.cancelSchedule'), {
      messageSchedule: true,
      outbox: false,
      requiresTrustedAppId: true,
    })
    assert.deepEqual(postCommitAutomationFor(
      'mip.admin.messageDeliveryReviews.reconcile',
      { schedulerReconcileRequired: false },
    ), {
      messageSchedule: false,
      outbox: false,
      requiresTrustedAppId: false,
    })
    assert.deepEqual(postCommitAutomationFor(
      'mip.admin.messageDeliveryReviews.reconcile',
      { schedulerReconcileRequired: true },
    ), {
      messageSchedule: true,
      outbox: false,
      requiresTrustedAppId: true,
    })
    const outboxMutation = outboxMutationActions.values().next().value
    assert.equal(postCommitAutomationFor(outboxMutation).requiresTrustedAppId, true)
  })

  it('imports the shared outbox action set used by the cloud-function entrypoint', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '..', 'index.js'), 'utf8')
    assert.match(source, /messageScheduleMutationActions,\s*outboxMutationActions,\s*postCommitAutomationFor,/)
    assert.ok(outboxMutationActions instanceof Set)
  })
})
