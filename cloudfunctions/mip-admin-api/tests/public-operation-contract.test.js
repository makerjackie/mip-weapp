'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { operationCatalog } = require('../domain/operation-registry')
const {
  PUBLIC_OPERATION_CONTRACT_VERSION,
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
  it('projects all 145 business operations without exposing execution details', () => {
    assert.equal(PUBLIC_OPERATION_CONTRACT_VERSION, 1)
    assert.equal(publicOperationContract.version, 1)
    assert.equal(publicOperationContract.operationCount, 145)
    assert.equal(publicOperationContract.operations.length, 145)
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
    assert.equal(retryable.length, 62)
    assert.equal(retryable.every(operation => operation.kind === 'QUERY'), true)
    assert.equal(
      retryable.some(operation => operation.action === 'mip.admin.knowledge.schedules.list'),
      true,
    )
  })
})
