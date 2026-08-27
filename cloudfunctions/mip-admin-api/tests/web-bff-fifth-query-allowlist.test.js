'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  WEB_BFF_FIFTH_QUERY_ACTIONS,
  WEB_BFF_QUERY_ACTIONS,
  createQueryActionAllowlist,
} = require('../lib/web-bff-auth')
const { publicOperationContract } = require('../domain/public-operation-contract')

const EXPECTED_TASK_QUERY_ACTIONS = Object.freeze([
  'mip.admin.tasks.list',
  'mip.admin.tasks.get',
  'mip.admin.tasks.assignableMembers.list',
  'mip.admin.tasks.completions.list',
  'mip.admin.tasks.completions.get',
  'mip.admin.tasks.completions.export',
])

describe('Web BFF task query allowlist', () => {
  it('exposes exactly the six reviewed task queries', () => {
    assert.deepEqual(WEB_BFF_FIFTH_QUERY_ACTIONS, EXPECTED_TASK_QUERY_ACTIONS)
    assert.equal(
      [...WEB_BFF_QUERY_ACTIONS].filter(action => action.startsWith('mip.admin.tasks.')).length,
      EXPECTED_TASK_QUERY_ACTIONS.length,
    )
  })

  it('accepts task reads only through generated query facts', () => {
    const allowlist = createQueryActionAllowlist(
      WEB_BFF_FIFTH_QUERY_ACTIONS,
      publicOperationContract,
    )
    const operationByAction = new Map(
      publicOperationContract.operations.map(operation => [operation.action, operation]),
    )

    assert.deepEqual([...allowlist], EXPECTED_TASK_QUERY_ACTIONS)
    for (const action of allowlist) {
      assert.deepEqual(operationByAction.get(action), {
        action,
        kind: 'QUERY',
        authentication: 'REQUIRED',
        session: 'REQUIRED',
        safeToRetry: true,
        idempotencyKeyRequired: null,
      })
    }
  })
})
