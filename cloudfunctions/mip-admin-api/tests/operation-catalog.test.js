'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { describe, it } = require('node:test')
const { actions } = require('../domain/handler')
const {
  OPERATION_KINDS,
  OPERATION_OWNERS,
  healthOperation,
  operationByAction,
  operationCatalog,
} = require('../domain/operation-catalog')

const root = path.resolve(__dirname, '../../..')

function setLiteralStrings(filePath, constantName) {
  const source = fs.readFileSync(filePath, 'utf8')
  const match = source.match(new RegExp(`const ${constantName} = new Set\\(\\[([\\s\\S]*?)\\]\\)`))
  assert.ok(match, `${constantName} set literal must exist in ${filePath}`)
  return [...match[1].matchAll(/'([^']+)'/g)].map(item => item[1])
}

function sorted(values) {
  return [...values].sort()
}

describe('admin operation catalog', () => {
  it('freezes the exact 97 business actions and keeps health separate', () => {
    const handlerActions = Object.keys(actions).filter(action => action !== 'health')
    const catalogActions = operationCatalog.map(operation => operation.action)

    assert.equal(handlerActions.length, 97)
    assert.equal(catalogActions.length, 97)
    assert.equal(new Set(catalogActions).size, 97)
    assert.deepEqual(sorted(catalogActions), sorted(handlerActions))
    assert.equal(operationByAction.health, undefined)
    assert.deepEqual(healthOperation, { action: 'health', owner: 'SYSTEM', kind: 'QUERY' })
  })

  it('freezes every owner and kind assignment', () => {
    assert.equal(Object.isFrozen(operationCatalog), true)
    assert.equal(Object.isFrozen(operationByAction), true)
    assert.equal(Object.isFrozen(healthOperation), true)
    assert.equal(Object.keys(operationByAction).length, 97)

    for (const operation of operationCatalog) {
      assert.equal(Object.isFrozen(operation), true)
      assert.equal(OPERATION_OWNERS.includes(operation.owner), true)
      assert.equal(OPERATION_KINDS.includes(operation.kind), true)
      assert.equal(operationByAction[operation.action], operation)
    }
  })

  it('classifies every client read retry action as a query', () => {
    const readActions = setLiteralStrings(
      path.join(root, 'src/modules/mip-admin/cloudbase-gateway.ts'),
      'readActions',
    )

    assert.equal(new Set(readActions).size, readActions.length)
    for (const action of readActions) {
      assert.equal(operationByAction[action]?.kind, 'QUERY', `${action} must be a catalog query`)
    }
  })

  it('classifies every outbox wakeup action as a mutation', () => {
    const outboxMutationActions = setLiteralStrings(
      path.join(root, 'cloudfunctions/mip-admin-api/index.js'),
      'outboxMutationActions',
    )

    assert.equal(new Set(outboxMutationActions).size, outboxMutationActions.length)
    for (const action of outboxMutationActions) {
      assert.equal(operationByAction[action]?.kind, 'MUTATION', `${action} must be a catalog mutation`)
    }
  })
})
