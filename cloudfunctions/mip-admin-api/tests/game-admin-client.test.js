'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  DEFAULT_TIMEOUT_MS,
  GAME_ADMIN_TRANSPORT,
  MUTATION_OPERATIONS,
  OPERATION_SPECS,
  boundedTimeout,
  createGameAdminClient,
} = require('../lib/game-admin-client')
const { verifyGameAdminRequest } = require('../../mip-game-api/lib/internal-admin-transport')

const SECRET = 'game-admin-hmac-secret-with-at-least-32-characters'
const APP_ID = 'wx1234567890abcdef'
const USER_ID = '10000000-0000-4000-8000-000000000001'
const NOW = 1_700_000_000_000

function clientWith(cloud, extra = {}) {
  return createGameAdminClient({
    cloud,
    secret: SECRET,
    now: () => NOW,
    nonce: () => 'nonce-abcdefghijklmnopqrstuvwxyz',
    ...extra,
  })
}

describe('game admin typed client', () => {
  it('exposes only the twenty reviewed Game operations', () => {
    assert.deepEqual(Object.keys(OPERATION_SPECS).sort(), [
      'mip.admin.game.session',
      'mip.admin.game.rankings.list',
      'mip.admin.game.seasons.list',
      'mip.admin.game.seasons.save',
      'mip.admin.game.seasons.changeStatus',
      'mip.admin.game.teams.list',
      'mip.admin.game.teams.save',
      'mip.admin.game.teams.changeStatus',
      'mip.admin.game.members.assignable.list',
      'mip.admin.game.teams.members.replace',
      'mip.admin.game.matches.list',
      'mip.admin.game.matches.save',
      'mip.admin.game.matches.finalize',
      'mip.admin.game.rankings.generate',
      'mip.admin.game.blindBoxes.catalogs.list',
      'mip.admin.game.blindBoxes.catalogs.save',
      'mip.admin.game.blindBoxes.catalogs.changeStatus',
      'mip.admin.game.blindBoxes.cards.list',
      'mip.admin.game.blindBoxes.cards.save',
      'mip.admin.game.blindBoxes.cards.changeStatus',
    ].sort())
  })

  it('signs a deeply modeled request authenticated by the Game trusted adapter', async () => {
    let captured
    const input = {
      seasonId: '20000000-0000-4000-8000-000000000001',
      expectedVersion: 2,
      season: {
        seasonKey: '2030-h1',
        name: '2030 上半年赛季',
        summary: '赛季说明',
        rulesText: '规则',
        rules: {
          scoreMetric: 'EXPERIENCE',
          headquartersThresholds: [
            { level: 1, minimumExperience: 0, label: '一级大本营' },
          ],
        },
        periodKind: 'HALF_YEAR',
        startsAt: '2030-01-01T00:00:00.000Z',
        endsAt: '2030-06-30T23:59:59.000Z',
      },
    }
    const client = clientWith({
      async callFunction(request) {
        captured = request
        const verified = verifyGameAdminRequest(request.data, {
          secret: SECRET,
          allowedAppIds: new Set([APP_ID]),
          now: () => NOW,
        })
        assert.equal(verified.action, 'admin.saveSeason')
        assert.deepEqual(verified.input, input)
        return { result: { ok: true, data: { version: 3 } } }
      },
    })
    const result = await client.execute({
      appId: APP_ID,
      actorUserId: USER_ID,
      action: 'mip.admin.game.seasons.save',
      input,
      idempotencyKey: 'game-save-season-0001',
    })

    assert.deepEqual(result, { version: 3 })
    assert.equal(captured.name, 'mip-game-api')
    assert.equal(captured.data.transport, GAME_ADMIN_TRANSPORT)
    assert.equal(captured.data.sourceFunction, 'mip-admin-api')
    assert.equal(captured.data.idempotencyKey, 'game-save-season-0001')
  })

  it('requires mutation idempotency and forbids the field on all eight queries', async () => {
    let invoked = false
    const client = clientWith({ async callFunction() { invoked = true } })
    await assert.rejects(
      () => client.execute({
        appId: APP_ID,
        actorUserId: USER_ID,
        action: 'mip.admin.game.matches.finalize',
        input: { matchId: 'match-a', expectedVersion: 1 },
      }),
      error => error.code === 'VALIDATION_FAILED',
    )
    const queryActions = Object.keys(OPERATION_SPECS).filter(item => !MUTATION_OPERATIONS.has(item))
    assert.equal(queryActions.length, 8)
    for (const action of queryActions) {
      await assert.rejects(
        () => client.execute({
          appId: APP_ID,
          actorUserId: USER_ID,
          action,
          input: {},
          idempotencyKey: 'query-key-forbidden-0001',
        }),
        error => error.code === 'VALIDATION_FAILED',
        action,
      )
    }
    assert.equal(invoked, false)
  })

  it('rejects unknown top-level, nested, and array-item fields before transport', async () => {
    let invoked = false
    const client = clientWith({ async callFunction() { invoked = true } })
    const cases = [
      {
        action: 'mip.admin.game.rankings.list',
        input: { seasonId: 'season', rankingType: 'TEAM_YEAR', ownerUserId: 'forged' },
      },
      {
        action: 'mip.admin.game.seasons.save',
        input: {
          season: {
            rules: {
              headquartersThresholds: [
                { level: 1, minimumExperience: 0, label: '一级', clientScore: 10 },
              ],
            },
          },
        },
      },
      {
        action: 'mip.admin.game.teams.members.replace',
        input: { members: [{ memberRef: 'member', role: 'MEMBER', userId: 'forged' }] },
      },
      {
        action: 'mip.admin.game.blindBoxes.cards.save',
        input: { card: { name: '卡牌', stockRemaining: 999 } },
      },
    ]
    for (const request of cases) {
      await assert.rejects(
        () => client.execute({ appId: APP_ID, actorUserId: USER_ID, ...request }),
        error => error.code === 'VALIDATION_FAILED',
      )
    }
    assert.equal(invoked, false)
  })

  it('fails closed for invalid identity, function configuration, action, and timeout bounds', async () => {
    const invalidTarget = clientWith({ async callFunction() {} }, { functionName: 'other-function' })
    await assert.rejects(
      () => invalidTarget.execute({
        appId: APP_ID, actorUserId: USER_ID,
        action: 'mip.admin.game.seasons.list', input: {},
      }),
      error => error.code === 'GAME_DISPATCH_CONFIG_REQUIRED',
    )
    const client = clientWith({ async callFunction() {} })
    await assert.rejects(
      () => client.execute({
        appId: 'forged app', actorUserId: USER_ID,
        action: 'mip.admin.game.seasons.list', input: {},
      }),
      error => error.code === 'AUTH_REQUIRED',
    )
    await assert.rejects(
      () => client.execute({
        appId: APP_ID, actorUserId: USER_ID,
        action: 'mip.admin.game.dropAll', input: {},
      }),
      error => error.code === 'GAME_OPERATION_NOT_ALLOWED',
    )
    assert.equal(boundedTimeout(250), 250)
    assert.equal(boundedTimeout(50_000), 50_000)
    assert.equal(boundedTimeout(249), DEFAULT_TIMEOUT_MS)
    assert.equal(boundedTimeout(50_001), DEFAULT_TIMEOUT_MS)
  })

  it('fails closed when the configured Game function exceeds its timeout', async () => {
    const client = clientWith({
      async callFunction() {
        await new Promise(resolve => setTimeout(resolve, 300))
        return { result: { ok: true, data: {} } }
      },
    }, { timeoutMs: 250 })
    await assert.rejects(
      () => client.execute({
        appId: APP_ID,
        actorUserId: USER_ID,
        action: 'mip.admin.game.seasons.list',
        input: {},
      }),
      error => error.code === 'GAME_DISPATCH_UNAVAILABLE' && error.retryable === true,
    )
  })
})
