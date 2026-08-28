'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  ACTION_SPECS,
  GAME_ADMIN_PROTOCOL,
  GAME_ADMIN_TRANSPORT,
  MUTATION_ACTIONS,
  createInternalGameHandler,
  signGameAdminRequest,
  verifyGameAdminRequest,
} = require('../lib/internal-admin-transport')

const SECRET = 'game-admin-hmac-secret-with-at-least-32-characters'
const APP_ID = 'wx1234567890abcdef'
const USER_ID = '10000000-0000-4000-8000-000000000001'
const NOW = 1_700_000_000_000

function signed(overrides = {}) {
  const request = {
    transport: GAME_ADMIN_TRANSPORT,
    protocol: GAME_ADMIN_PROTOCOL,
    timestamp: NOW,
    nonce: 'nonce-abcdefghijklmnopqrstuvwxyz',
    appId: APP_ID,
    actorUserId: USER_ID,
    action: 'admin.listAssignableMembers',
    input: {
      seasonId: '20000000-0000-4000-8000-000000000001',
      teamId: '30000000-0000-4000-8000-000000000001',
      query: '成员',
      limit: 50,
    },
    sourceFunction: 'mip-admin-api',
    ...overrides,
  }
  request.signature = signGameAdminRequest(request, SECRET)
  return request
}

describe('Game internal admin transport', () => {
  it('accepts only the twenty trusted internal actions', () => {
    assert.deepEqual(Object.keys(ACTION_SPECS).sort(), [
      'admin.getSession',
      'admin.listRankings',
      'admin.listSeasons',
      'admin.saveSeason',
      'admin.changeSeasonStatus',
      'admin.listTeams',
      'admin.saveTeam',
      'admin.changeTeamStatus',
      'admin.listAssignableMembers',
      'admin.replaceTeamMembers',
      'admin.listMatches',
      'admin.saveWeeklyMatch',
      'admin.finalizeWeeklyMatch',
      'admin.generateRankingSnapshot',
      'admin.listBlindBoxCatalogs',
      'admin.saveBlindBoxCatalog',
      'admin.changeBlindBoxCatalogStatus',
      'admin.listBlindBoxCards',
      'admin.saveBlindBoxCard',
      'admin.changeBlindBoxCardStatus',
    ].sort())
  })

  it('authenticates AppID and caller facts before rechecking admin readiness', async () => {
    const calls = []
    const handler = createInternalGameHandler({
      secret: SECRET,
      allowedAppIds: new Set([APP_ID]),
      profileRefSecret: 'profile-ref-secret',
      now: () => NOW,
      async assertAdminReady(caller) { calls.push({ gate: caller }) },
      service: {
        async listAssignableMembers(caller, input) {
          calls.push({ service: { caller, input } })
          return { items: [], hasMore: false }
        },
      },
    })
    const result = await handler({
      ...signed(),
      userInfo: { openId: 'framework-only' },
      tcbContext: { requestId: 'framework-only' },
    })

    const expectedCaller = {
      appId: APP_ID,
      userId: USER_ID,
      profileRefSecret: 'profile-ref-secret',
    }
    assert.deepEqual(result, { ok: true, data: { items: [], hasMore: false } })
    assert.deepEqual(calls, [
      { gate: expectedCaller },
      {
        service: {
          caller: expectedCaller,
          input: {
            seasonId: '20000000-0000-4000-8000-000000000001',
            teamId: '30000000-0000-4000-8000-000000000001',
            query: '成员',
            limit: 50,
          },
        },
      },
    ])
  })

  it('rejects signed AppID, source, time, action, and deeply nested input drift before dispatch', async () => {
    let gated = false
    let dispatched = false
    const handler = createInternalGameHandler({
      secret: SECRET,
      allowedAppIds: new Set([APP_ID]),
      now: () => NOW,
      async assertAdminReady() { gated = true },
      service: new Proxy({}, {
        get() { return async () => { dispatched = true } },
      }),
    })
    const cases = [
      signed({ appId: 'wx-other' }),
      signed({ sourceFunction: 'mip-other-api' }),
      signed({ timestamp: NOW - 60_001 }),
      signed({ action: 'admin.dropAll', input: {} }),
      signed({ input: { seasonId: 'season', hidden: true } }),
      signed({
        action: 'admin.replaceTeamMembers',
        input: {
          seasonId: 'season', teamId: 'team', expectedVersion: 1,
          members: [{ memberRef: 'member', role: 'MEMBER', userId: 'forged' }],
        },
      }),
      signed({
        action: 'admin.saveSeason',
        input: {
          season: {
            rules: {
              headquartersThresholds: [
                { level: 1, minimumExperience: 0, label: '一级', score: 100 },
              ],
            },
          },
        },
      }),
      signed({ browserControlledField: true }),
    ]

    for (const request of cases) {
      const result = await handler(request)
      assert.equal(result.ok, false)
      assert.equal(result.error.code, 'AUTH_REQUIRED')
    }
    assert.equal(gated, false)
    assert.equal(dispatched, false)
  })

  it('rejects tampering and missing allowlist or HMAC configuration', () => {
    const tampered = signed()
    tampered.input.query = '篡改'
    for (const [request, options, error] of [
      [tampered, { secret: SECRET, allowedAppIds: new Set([APP_ID]), now: () => NOW }, 'AUTH_REQUIRED'],
      [signed(), { secret: SECRET, allowedAppIds: new Set(), now: () => NOW }, 'AUTH_REQUIRED'],
      [signed(), { secret: '', allowedAppIds: new Set([APP_ID]), now: () => NOW }, 'GAME_INTERNAL_AUTH_CONFIG_REQUIRED'],
    ]) {
      assert.throws(() => verifyGameAdminRequest(request, options), new RegExp(error))
    }
  })

  it('never accepts an unsigned internal-shaped or ordinary WeChat request as trusted admin', async () => {
    let gated = false
    const handler = createInternalGameHandler({
      service: {},
      secret: SECRET,
      allowedAppIds: new Set([APP_ID]),
      now: () => NOW,
      async assertAdminReady() { gated = true },
    })
    const unsigned = signed()
    delete unsigned.signature
    for (const request of [
      unsigned,
      { contractVersion: 1, action: 'admin.listSeasons', input: {} },
    ]) {
      const result = await handler(request)
      assert.equal(result.ok, false)
      assert.equal(result.error.code, 'AUTH_REQUIRED')
    }
    assert.equal(gated, false)
  })

  it('wakes outbox only after a verified successful mutation with trusted AppID', async () => {
    const calls = []
    const handler = createInternalGameHandler({
      secret: SECRET,
      allowedAppIds: new Set([APP_ID]),
      now: () => NOW,
      async assertAdminReady() { calls.push('gate') },
      service: {
        async finalizeWeeklyMatch() {
          calls.push('domain')
          return { status: 'FINALIZED' }
        },
      },
      async afterSuccessfulMutation({ request, data }) {
        calls.push({ action: request.action, appId: request.appId, data })
      },
    })
    const result = await handler(signed({
      action: 'admin.finalizeWeeklyMatch',
      idempotencyKey: 'game-finalize-match-0001',
      input: {
        matchId: '40000000-0000-4000-8000-000000000001',
        expectedVersion: 1,
      },
    }))

    assert.deepEqual(result, { ok: true, data: { status: 'FINALIZED' } })
    assert.deepEqual(calls, [
      'gate',
      'domain',
      {
        action: 'admin.finalizeWeeklyMatch',
        appId: APP_ID,
        data: { status: 'FINALIZED' },
      },
    ])
  })

  it('requires signed mutation idempotency and never accepts it on a query', async () => {
    const calls = []
    const handler = createInternalGameHandler({
      secret: SECRET,
      allowedAppIds: new Set([APP_ID]),
      now: () => NOW,
      async assertAdminReady() { calls.push('gate') },
      service: {
        async saveSeason(_caller, input) {
          calls.push(input)
          return { id: 'season-a' }
        },
      },
    })
    const mutation = signed({
      action: 'admin.saveSeason',
      idempotencyKey: 'game-save-season-0001',
      input: { season: { name: '2030 上半年赛季' } },
    })
    const accepted = await handler(mutation)

    assert.equal(MUTATION_ACTIONS.size, 12)
    assert.deepEqual(accepted, { ok: true, data: { id: 'season-a' } })
    assert.deepEqual(calls, [
      'gate',
      { season: { name: '2030 上半年赛季' }, idempotencyKey: 'game-save-season-0001' },
    ])

    const missingKey = { ...mutation }
    delete missingKey.idempotencyKey
    missingKey.signature = signGameAdminRequest(missingKey, SECRET)
    const queryWithKey = signed({ idempotencyKey: 'query-key-forbidden-0001' })
    for (const request of [missingKey, queryWithKey]) {
      const result = await handler(request)
      assert.equal(result.ok, false)
      assert.equal(result.error.code, 'AUTH_REQUIRED')
    }
  })

  it('covers the mutation idempotency key with HMAC', () => {
    const request = signed({
      action: 'admin.generateRankingSnapshot',
      idempotencyKey: 'game-ranking-generate-0001',
      input: { seasonId: 'season-a', rankingType: 'TEAM_YEAR' },
    })
    request.idempotencyKey = 'game-ranking-generate-0002'
    assert.throws(
      () => verifyGameAdminRequest(request, {
        secret: SECRET,
        allowedAppIds: new Set([APP_ID]),
        now: () => NOW,
      }),
      /AUTH_REQUIRED/,
    )
  })
})
