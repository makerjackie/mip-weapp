'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  WEB_BFF_FIRST_QUERY_ACTIONS,
  WEB_BFF_FIFTH_QUERY_ACTIONS,
  WEB_BFF_QUERY_ACTIONS,
  WEB_BFF_SECOND_QUERY_ACTIONS,
  WEB_BFF_SEVENTH_QUERY_ACTIONS,
  WEB_BFF_SIXTH_QUERY_ACTIONS,
  WEB_BFF_THIRD_QUERY_ACTIONS,
  WEB_BFF_FOURTH_QUERY_ACTIONS,
  createQueryActionAllowlist,
} = require('../lib/web-bff-auth')
const { publicOperationContract } = require('../domain/public-operation-contract')

const EXPECTED_SECOND_QUERY_ACTIONS = Object.freeze([
  'mip.admin.users.get',
  'mip.admin.users.influence.list',
  'mip.admin.events.get',
  'mip.admin.events.insights.get',
  'mip.admin.events.roster',
  'mip.admin.events.rosterAll',
  'mip.admin.events.policy.get',
  'mip.admin.orders.get',
  'mip.admin.paymentAttempts.list',
  'mip.admin.memberships.get',
  'mip.admin.memberships.timeline',
  'mip.admin.benefits.ledger',
  'mip.admin.roles.candidates',
  'mip.admin.messageCampaigns.get',
  'mip.admin.messageCampaigns.recipients',
  'mip.admin.messageTemplates.get',
  'mip.admin.messageDeliveryReviews.list',
  'mip.admin.messageDeliveryReviews.get',
  'mip.admin.messageDeliveryRecords.list',
  'mip.admin.knowledge.get',
  'mip.admin.knowledge.schedules.list',
])

describe('Web BFF second query allowlist', () => {
  it('matches the exact second read-only Web surface', () => {
    const combinedActions = [
      ...WEB_BFF_FIRST_QUERY_ACTIONS,
      ...WEB_BFF_SECOND_QUERY_ACTIONS,
      ...WEB_BFF_THIRD_QUERY_ACTIONS,
      ...WEB_BFF_FOURTH_QUERY_ACTIONS,
      ...WEB_BFF_FIFTH_QUERY_ACTIONS,
      ...WEB_BFF_SIXTH_QUERY_ACTIONS,
      ...WEB_BFF_SEVENTH_QUERY_ACTIONS,
    ]

    assert.deepEqual(WEB_BFF_SECOND_QUERY_ACTIONS, EXPECTED_SECOND_QUERY_ACTIONS)
    assert.equal(new Set(combinedActions).size, combinedActions.length)
    assert.deepEqual([...WEB_BFF_QUERY_ACTIONS], combinedActions)
  })

  it('accepts the second batch only through generated query facts', () => {
    const allowlist = createQueryActionAllowlist(
      WEB_BFF_SECOND_QUERY_ACTIONS,
      publicOperationContract,
    )
    const operationByAction = new Map(
      publicOperationContract.operations.map(operation => [operation.action, operation]),
    )

    assert.deepEqual([...allowlist], EXPECTED_SECOND_QUERY_ACTIONS)
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

  it('contains no generated contract mutation', () => {
    const mutations = new Set(
      publicOperationContract.operations
        .filter(operation => operation.kind === 'MUTATION')
        .map(operation => operation.action),
    )

    assert.equal(
      EXPECTED_SECOND_QUERY_ACTIONS.some(action => mutations.has(action)),
      false,
    )
  })
})
