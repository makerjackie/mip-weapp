'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { operationCatalog } = require('../domain/operation-registry')
const {
  ADMIN_WEB_OPERATION_CONTRACT_VERSION,
  PUBLIC_OPERATION_CONTRACT_VERSION,
  adminWebOperationContract,
  createAdminWebOperationContract,
  publicOperationContract,
} = require('../domain/public-operation-contract')

const operationKeys = [
  'action',
  'kind',
  'authentication',
  'session',
  'safeToRetry',
  'idempotencyKeyRequired',
]

describe('public admin operation contract', () => {
  it('projects all 187 business operations without exposing execution details', () => {
    assert.equal(PUBLIC_OPERATION_CONTRACT_VERSION, 1)
    assert.equal(publicOperationContract.version, 1)
    assert.equal(publicOperationContract.operationCount, 187)
    assert.equal(publicOperationContract.operations.length, 187)
    assert.equal(Object.isFrozen(publicOperationContract), true)
    assert.equal(Object.isFrozen(publicOperationContract.operations), true)

    const actions = new Set()
    for (const [index, operation] of publicOperationContract.operations.entries()) {
      const source = operationCatalog[index]
      assert.deepEqual(Object.keys(operation), operationKeys, source.action)
      assert.equal(operation.action, source.action)
      assert.equal(operation.kind, source.kind)
      assert.equal(operation.authentication, 'REQUIRED')
      assert.equal(operation.session, 'REQUIRED')
      assert.equal(operation.safeToRetry, source.kind === 'QUERY')
      assert.equal(operation.idempotencyKeyRequired, null)
      assert.equal(Object.isFrozen(operation), true)
      assert.equal(actions.has(operation.action), false, operation.action)
      actions.add(operation.action)
    }

    assert.equal(actions.has('health'), false)
    assert.doesNotMatch(
      JSON.stringify(publicOperationContract),
      /"(?:owner|dispatch|method|sessionFirst|sessionPreflightRequired|wakesOutbox|openId|appId|database|modulePath)"|cloudfunctions|mysql|FROM_OPENID|OPENID/i,
    )
  })

  it('marks every and only query operation as safe to retry', () => {
    const retryable = publicOperationContract.operations
      .filter(operation => operation.safeToRetry)
    assert.equal(retryable.length, 80)
    assert.equal(retryable.every(operation => operation.kind === 'QUERY'), true)
    assert.equal(
      retryable.some(operation => operation.action === 'mip.admin.knowledge.schedules.list'),
      true,
    )
    for (const action of ['mip.admin.dashboard', 'mip.admin.operations.queue.list']) {
      const operation = publicOperationContract.operations.find(item => item.action === action)
      assert.equal(operation?.kind, 'QUERY')
      assert.equal(operation?.safeToRetry, true)
    }
  })

  it('owns the complete Web exposure, input-key, route, and idempotency policy', () => {
    assert.equal(ADMIN_WEB_OPERATION_CONTRACT_VERSION, 1)
    assert.equal(adminWebOperationContract.version, 1)
    assert.equal(adminWebOperationContract.operationCount, 187)
    assert.equal(adminWebOperationContract.operations.length, 187)
    assert.equal(Object.isFrozen(adminWebOperationContract), true)
    assert.equal(Object.isFrozen(adminWebOperationContract.operations), true)

    const queries = []
    const mutations = []
    const blocked = []
    for (const [index, operation] of adminWebOperationContract.operations.entries()) {
      assert.equal(operation.action, publicOperationContract.operations[index].action)
      assert.equal(operation.kind, publicOperationContract.operations[index].kind)
      assert.equal(Object.isFrozen(operation), true)
      assert.equal(Object.isFrozen(operation.requiredInputKeys), true)
      assert.equal(Object.isFrozen(operation.optionalInputKeys), true)
      assert.equal(
        new Set([...operation.requiredInputKeys, ...operation.optionalInputKeys]).size,
        operation.requiredInputKeys.length + operation.optionalInputKeys.length,
        operation.action,
      )
      if (!operation.webAllowed) {
        blocked.push(operation)
        assert.equal(operation.webRoute, null)
        assert.equal(operation.idempotencyKeyRequired, null)
        assert.equal(operation.forwardIdempotencyKey, null)
      }
      else if (operation.kind === 'QUERY') {
        queries.push(operation)
        assert.equal(operation.webRoute, 'ADMIN')
        assert.equal(operation.idempotencyKeyRequired, false)
        assert.equal(operation.forwardIdempotencyKey, false)
      }
      else {
        mutations.push(operation)
        assert.equal(operation.idempotencyKeyRequired, true)
        assert.equal(typeof operation.forwardIdempotencyKey, 'boolean')
      }
    }

    assert.equal(queries.length, 80)
    assert.equal(mutations.length, 80)
    assert.equal(blocked.length, 27)
    assert.deepEqual(
      mutations.find(operation => operation.action === 'mip.admin.exports.create'),
      {
        action: 'mip.admin.exports.create',
        kind: 'MUTATION',
        webAllowed: true,
        webRoute: 'ADMIN',
        requiredInputKeys: ['exportType', 'includesPhone', 'filters'],
        optionalInputKeys: [],
        idempotencyKeyRequired: true,
        forwardIdempotencyKey: true,
      },
    )
    assert.equal(
      mutations.find(operation => operation.action === 'mip.admin.media.uploadImage')?.webRoute,
      'MEDIA',
    )
  })

  it('fails closed when the server registry adds a query without a reviewed Web policy', () => {
    const operations = operationCatalog.map(operation => operation.action === 'mip.admin.session'
      ? { ...operation, action: 'mip.admin.newQuery' }
      : operation)

    assert.throws(
      () => createAdminWebOperationContract(operations),
      /ADMIN_WEB_OPERATION_CONTRACT_SOURCE_INVALID/,
    )
  })
})
