'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  WEB_BFF_FIRST_QUERY_ACTIONS,
  WEB_BFF_QUERY_ACTIONS,
  WEB_BFF_SECOND_QUERY_ACTIONS,
  WEB_BFF_THIRD_QUERY_ACTIONS,
  WEB_BFF_FOURTH_QUERY_ACTIONS,
  createQueryActionAllowlist,
} = require('../lib/web-bff-auth')
const { publicOperationContract } = require('../domain/public-operation-contract')

const EXPECTED_THIRD_QUERY_ACTIONS = Object.freeze([
  'mip.admin.communityReports.list',
  'mip.admin.announcements.scopes',
  'mip.admin.announcements.list',
  'mip.admin.announcements.get',
  'mip.admin.opportunities.list',
  'mip.admin.opportunities.get',
  'mip.admin.opportunities.options',
  'mip.admin.userContent.list',
  'mip.admin.userContent.get',
  'mip.admin.matching.get',
  'mip.admin.opportunityComments.get',
  'mip.admin.growth.levels',
  'mip.admin.growth.benefits',
  'mip.admin.growth.rules',
  'mip.admin.growth.entries',
  'mip.admin.growth.levelTransitions',
  'mip.admin.badges.list',
  'mip.admin.badges.awards',
  'mip.admin.exceptions.list',
  'mip.admin.operations.queue.list',
])

describe('Web BFF third query allowlist', () => {
  it('matches the exact third read-only Web surface', () => {
    const combinedActions = [
      ...WEB_BFF_FIRST_QUERY_ACTIONS,
      ...WEB_BFF_SECOND_QUERY_ACTIONS,
      ...WEB_BFF_THIRD_QUERY_ACTIONS,
      ...WEB_BFF_FOURTH_QUERY_ACTIONS,
    ]

    assert.deepEqual(WEB_BFF_THIRD_QUERY_ACTIONS, EXPECTED_THIRD_QUERY_ACTIONS)
    assert.equal(new Set(combinedActions).size, combinedActions.length)
    assert.deepEqual([...WEB_BFF_QUERY_ACTIONS], combinedActions)
  })

  it('accepts the third batch only through generated query facts', () => {
    const allowlist = createQueryActionAllowlist(
      WEB_BFF_THIRD_QUERY_ACTIONS,
      publicOperationContract,
    )
    const operationByAction = new Map(
      publicOperationContract.operations.map(operation => [operation.action, operation]),
    )

    assert.deepEqual([...allowlist], EXPECTED_THIRD_QUERY_ACTIONS)
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

  it('fails closed when third-batch contract metadata drifts', () => {
    const driftedContract = {
      ...publicOperationContract,
      operations: publicOperationContract.operations.map(operation => (
        operation.action === 'mip.admin.growth.levels'
          ? { ...operation, session: 'OPTIONAL' }
          : operation
      )),
    }

    assert.throws(
      () => createQueryActionAllowlist(WEB_BFF_THIRD_QUERY_ACTIONS, driftedContract),
      /WEB_BFF_QUERY_CONTRACT_INVALID/,
    )
  })

  it('contains no generated contract mutation', () => {
    const mutations = new Set(
      publicOperationContract.operations
        .filter(operation => operation.kind === 'MUTATION')
        .map(operation => operation.action),
    )

    assert.equal(
      EXPECTED_THIRD_QUERY_ACTIONS.some(action => mutations.has(action)),
      false,
    )
  })
})
