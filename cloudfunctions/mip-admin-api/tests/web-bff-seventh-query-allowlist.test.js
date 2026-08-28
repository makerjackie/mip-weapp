'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  WEB_BFF_QUERY_ACTIONS,
  WEB_BFF_SEVENTH_QUERY_ACTIONS,
  createQueryActionAllowlist,
} = require('../lib/web-bff-auth')
const { publicOperationContract } = require('../domain/public-operation-contract')

const EXPECTED_GAME_QUERY_ACTIONS = Object.freeze([
  'mip.admin.game.session',
  'mip.admin.game.rankings.list',
  'mip.admin.game.seasons.list',
  'mip.admin.game.teams.list',
  'mip.admin.game.members.assignable.list',
  'mip.admin.game.matches.list',
  'mip.admin.game.blindBoxes.catalogs.list',
  'mip.admin.game.blindBoxes.cards.list',
])

describe('Web BFF Game query allowlist', () => {
  it('exposes exactly the eight reviewed Game queries', () => {
    assert.deepEqual(WEB_BFF_SEVENTH_QUERY_ACTIONS, EXPECTED_GAME_QUERY_ACTIONS)
    assert.equal(
      [...WEB_BFF_QUERY_ACTIONS].filter(action => action.startsWith('mip.admin.game.')).length,
      EXPECTED_GAME_QUERY_ACTIONS.length,
    )
  })

  it('accepts Game reads only through generated query facts', () => {
    const allowlist = createQueryActionAllowlist(
      WEB_BFF_SEVENTH_QUERY_ACTIONS,
      publicOperationContract,
    )
    const operationByAction = new Map(
      publicOperationContract.operations.map(operation => [operation.action, operation]),
    )

    assert.deepEqual([...allowlist], EXPECTED_GAME_QUERY_ACTIONS)
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
