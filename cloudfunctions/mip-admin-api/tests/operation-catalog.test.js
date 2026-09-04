'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  OPERATION_KINDS,
  OPERATION_OWNERS,
  createOperationDispatcher,
  createOperationRegistry,
  operationByAction,
  operationCatalog,
  outboxMutationActions,
} = require('../domain/operation-registry')
const { createOwnerModules } = require('./owner-modules-test-helper')

const expectedOutboxActions = Object.freeze([
  'mip.admin.announcements.publish',
  'mip.admin.announcements.withdraw',
  'mip.admin.messageCampaigns.publish',
  'mip.admin.events.save',
  'mip.admin.events.clone',
  'mip.admin.events.changeStatus',
  'mip.admin.events.comments.moderate',
  'mip.admin.communications.publishEventReminder',
  'mip.admin.events.registrations.review',
  'mip.admin.events.checkIn',
  'mip.admin.events.undoCheckIn',
  'mip.admin.growth.adjust',
  'mip.admin.memberships.grant',
  'mip.admin.refunds.submit',
  'mip.admin.knowledge.contents.review',
  'mip.admin.opportunityComments.moderate',
])

function sorted(values) {
  return [...values].sort()
}

function definition(action, kind = 'QUERY', options = {}) {
  return {
    action,
    kind,
    method: options.method || 'testOperation',
    sessionFirst: options.sessionFirst === true,
    usesInput: options.usesInput !== false,
    wakesOutbox: options.wakesOutbox === true,
    ...options.extra,
  }
}

function manifest(owner, operations) {
  return { owner, operations }
}

describe('admin operation catalog', () => {
  it('freezes all 187 business operations and keeps health outside the registry', () => {
    const catalogActions = operationCatalog.map(operation => operation.action)

    assert.equal(operationCatalog.length, 187)
    assert.equal(new Set(catalogActions).size, 187)
    assert.deepEqual(sorted(Object.keys(operationByAction)), sorted(catalogActions))
    assert.equal(operationByAction.health, undefined)
    assert.equal(operationByAction.toString, undefined)
    assert.equal(Object.getPrototypeOf(operationByAction), null)
    assert.equal(Object.isFrozen(operationCatalog), true)
    assert.equal(Object.isFrozen(operationByAction), true)

    for (const operation of operationCatalog) {
      assert.equal(operationByAction[operation.action], operation)
      assert.equal(Object.isFrozen(operation), true)
      assert.equal(OPERATION_OWNERS.includes(operation.owner), true, operation.action)
      assert.equal(OPERATION_KINDS.includes(operation.kind), true, operation.action)
      assert.equal(typeof operation.method, 'string', operation.action)
      assert.equal(typeof operation.sessionFirst, 'boolean', operation.action)
      assert.equal(typeof operation.usesInput, 'boolean', operation.action)
      assert.equal(typeof operation.wakesOutbox, 'boolean', operation.action)
    }
  })

  it('dispatches every registered operation with its declared call ordering', async () => {
    const caller = { appId: 'wx-app', userId: 'user-a' }
    const input = { marker: 'input-a' }

    for (const operation of operationCatalog) {
      const calls = []
      const ownerModules = createOwnerModules({}, declared => async (...args) => {
        calls.push({ method: declared.method, args })
        return { method: declared.method }
      })
      const result = (await createOperationDispatcher(ownerModules)
        .execute(caller, operation.action, input)).data

      if (operation.sessionFirst) {
        assert.deepEqual(calls.map(call => call.method), ['getSession', operation.method], operation.action)
        assert.deepEqual(calls[0].args, [caller], operation.action)
        assert.deepEqual(calls[1].args, [caller, input], operation.action)
      }
      else {
        assert.deepEqual(calls.map(call => call.method), [operation.method], operation.action)
        assert.deepEqual(calls[0].args, operation.usesInput ? [caller, input] : [caller], operation.action)
      }
      assert.deepEqual(result, { method: operation.method }, operation.action)
    }
  })

  it('derives the exact outbox wakeup set from mutation metadata', () => {
    assert.deepEqual(sorted(outboxMutationActions), sorted(expectedOutboxActions))
    for (const operation of operationCatalog) {
      assert.equal(outboxMutationActions.has(operation.action), operation.wakesOutbox, operation.action)
      if (operation.wakesOutbox) {
        assert.equal(operation.kind, 'MUTATION', operation.action)
      }
    }
  })

  it('fails closed for malformed or internally inconsistent manifests', () => {
    const valid = definition('mip.admin.test')
    const options = { expectedCount: 1, expectedOwners: ['ACCESS'] }
    const cases = [
      [manifest('UNKNOWN', [valid]), 'OPERATION_MANIFEST_INVALID'],
      [manifest('ACCESS', [definition('mip.admin.test', 'READ')]), 'OPERATION_KIND_INVALID'],
      [manifest('ACCESS', [definition('health')]), 'OPERATION_ACTION_INVALID'],
      [manifest('ACCESS', [{ ...valid, method: null }]), 'OPERATION_METHOD_INVALID'],
      [manifest('ACCESS', [{ ...valid, sessionFirst: null }]), 'OPERATION_SESSION_INVALID'],
      [manifest('ACCESS', [definition('mip.admin.test', 'QUERY', { wakesOutbox: true })]), 'OPERATION_OUTBOX_INVALID'],
      [manifest('ACCESS', [definition('mip.admin.test', 'MUTATION', {
        extra: { capability: 'unproven' },
      })]), 'OPERATION_DEFINITION_INVALID'],
    ]

    for (const [invalidManifest, error] of cases) {
      assert.throws(
        () => createOperationRegistry([invalidManifest], options),
        new RegExp(error),
      )
    }

    assert.throws(
      () => createOperationRegistry([
        manifest('ACCESS', [definition('mip.admin.same')]),
        manifest('USERS', [definition('mip.admin.same')]),
      ], { expectedCount: 2, expectedOwners: ['ACCESS', 'USERS'] }),
      /OPERATION_ACTION_DUPLICATE/,
    )
    assert.throws(
      () => createOperationRegistry([
        manifest('ACCESS', [definition('mip.admin.one')]),
        manifest('ACCESS', [definition('mip.admin.two')]),
      ], { expectedCount: 2, expectedOwners: ['ACCESS'] }),
      /OPERATION_OWNER_DUPLICATE/,
    )
    assert.throws(
      () => createOperationRegistry([
        manifest('ACCESS', [definition('mip.admin.one')]),
      ], { expectedCount: 1, expectedOwners: ['ACCESS', 'USERS'] }),
      /OPERATION_OWNER_MISSING/,
    )
    assert.throws(
      () => createOperationRegistry([
        manifest('ACCESS', [definition('mip.admin.one')]),
      ], { expectedCount: 2, expectedOwners: ['ACCESS'] }),
      /OPERATION_COUNT_INVALID/,
    )
    assert.throws(
      () => createOperationRegistry([
        manifest('ACCESS', [
          definition('mip.admin.one'),
          definition('mip.admin.two'),
        ]),
      ], { expectedCount: 2, expectedOwners: ['ACCESS'] }),
      /OPERATION_METHOD_DUPLICATE/,
    )
  })

  it('fails at startup when an owner module or declared method is missing', () => {
    const ownerModules = createOwnerModules()
    delete ownerModules.KNOWLEDGE
    assert.throws(
      () => createOperationDispatcher(ownerModules),
      /OPERATION_OWNER_MODULE_INVALID:KNOWLEDGE/,
    )

    const incomplete = createOwnerModules()
    delete incomplete.EVENTS.saveEvent
    assert.throws(
      () => createOperationDispatcher(incomplete),
      /OPERATION_METHOD_MISSING:EVENTS:mip\.admin\.events\.save:saveEvent/,
    )
  })
})
