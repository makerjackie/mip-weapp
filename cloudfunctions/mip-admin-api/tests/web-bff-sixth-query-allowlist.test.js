'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  WEB_BFF_QUERY_ACTIONS,
  WEB_BFF_SIXTH_QUERY_ACTIONS,
  createQueryActionAllowlist,
} = require('../lib/web-bff-auth')
const { publicOperationContract } = require('../domain/public-operation-contract')

const EXPECTED_BANNER_QUERY_ACTIONS = Object.freeze([
  'mip.admin.banners.session',
  'mip.admin.banners.list',
  'mip.admin.banners.get',
])

describe('Web BFF Banner query allowlist', () => {
  it('exposes exactly the three reviewed Banner queries', () => {
    assert.deepEqual(WEB_BFF_SIXTH_QUERY_ACTIONS, EXPECTED_BANNER_QUERY_ACTIONS)
    assert.equal(
      [...WEB_BFF_QUERY_ACTIONS].filter(action => action.startsWith('mip.admin.banners.')).length,
      EXPECTED_BANNER_QUERY_ACTIONS.length,
    )
  })

  it('accepts Banner reads only through generated query facts', () => {
    const allowlist = createQueryActionAllowlist(
      WEB_BFF_SIXTH_QUERY_ACTIONS,
      publicOperationContract,
    )
    const operationByAction = new Map(
      publicOperationContract.operations.map(operation => [operation.action, operation]),
    )

    assert.deepEqual([...allowlist], EXPECTED_BANNER_QUERY_ACTIONS)
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
