'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  WEB_BFF_FIRST_QUERY_ACTIONS,
  WEB_BFF_FOURTH_QUERY_ACTIONS,
  WEB_BFF_QUERY_ACTIONS,
  WEB_BFF_SECOND_QUERY_ACTIONS,
  WEB_BFF_THIRD_QUERY_ACTIONS,
  createQueryActionAllowlist,
} = require('../lib/web-bff-auth')
const { publicOperationContract } = require('../domain/public-operation-contract')

const EXPECTED_FOURTH_QUERY_ACTIONS = Object.freeze([
  'mip.admin.events.catalog.list',
  'mip.admin.events.tags.get',
  'mip.admin.events.recaps.list',
  'mip.admin.events.recaps.get',
  'mip.admin.events.album.list',
  'mip.admin.events.comments.get',
  'mip.admin.messageCampaigns.scopes',
  'mip.admin.exports.status',
])

describe('Web BFF fourth query allowlist', () => {
  it('matches the exact final read-only Web surface', () => {
    const combinedActions = [
      ...WEB_BFF_FIRST_QUERY_ACTIONS,
      ...WEB_BFF_SECOND_QUERY_ACTIONS,
      ...WEB_BFF_THIRD_QUERY_ACTIONS,
      ...WEB_BFF_FOURTH_QUERY_ACTIONS,
    ]

    assert.deepEqual(WEB_BFF_FOURTH_QUERY_ACTIONS, EXPECTED_FOURTH_QUERY_ACTIONS)
    assert.equal(new Set(combinedActions).size, combinedActions.length)
    assert.deepEqual([...WEB_BFF_QUERY_ACTIONS], combinedActions)
  })

  it('accepts the final batch only through generated query facts', () => {
    const allowlist = createQueryActionAllowlist(
      WEB_BFF_FOURTH_QUERY_ACTIONS,
      publicOperationContract,
    )
    const operationByAction = new Map(
      publicOperationContract.operations.map(operation => [operation.action, operation]),
    )

    assert.deepEqual([...allowlist], EXPECTED_FOURTH_QUERY_ACTIONS)
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

  it('leaves only the audit-writing legacy dashboard query outside the Web surface', () => {
    const remaining = publicOperationContract.operations
      .filter(operation => operation.kind === 'QUERY' && !WEB_BFF_QUERY_ACTIONS.has(operation.action))
      .map(operation => operation.action)

    assert.deepEqual(remaining, ['mip.admin.dashboard'])
  })

  it('contains no generated contract mutation', () => {
    const mutations = new Set(
      publicOperationContract.operations
        .filter(operation => operation.kind === 'MUTATION')
        .map(operation => operation.action),
    )

    assert.equal(
      EXPECTED_FOURTH_QUERY_ACTIONS.some(action => mutations.has(action)),
      false,
    )
  })
})
