'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { actions, createHandler } = require('../domain/handler')
const { createCandidateKey, createMemberCursor, readMemberCursor } = require('../lib/member-cursor')
const { createProfileRef } = require('../lib/profile-ref')
const {
  createGameRepository,
  headquartersLevel,
  individualRankingRows,
  rankingPeriod,
  teamExperience,
  teamRankingRows,
} = require('../domain/repository')
const {
  assertNoClientScore,
  memberPageLimit,
  normalizeMatch,
  normalizeMembers,
  normalizeSeason,
} = require('../domain/validation')

const seasonId = '10000000-0000-4000-8000-000000000001'

test('game management respects a configured platform operations policy', async () => {
  const repository = createGameRepository({
    async one(sql) {
      assert.match(sql, /LEFT JOIN mip_role_capability_policies/)
      return { role_key: 'PLATFORM_OPERATIONS', policy_capabilities_json: '[]' }
    },
  })
  await assert.rejects(() => repository.getAdminSession({ appId: 'app', userId: 'user' }), /FORBIDDEN/)
})

test('uses replaceable neutral rules without any coin metric', () => {
  const season = normalizeSeason({
    seasonKey: '2026-h2',
    name: '2026 下半年赛季',
    rulesText: '以服务端经验值流水为准。',
    periodKind: 'HALF_YEAR',
    startsAt: '2026-07-01T00:00:00.000Z',
    endsAt: '2027-01-01T00:00:00.000Z',
  })
  assert.equal(season.rules.scoreMetric, 'EXPERIENCE')
  assert.equal(JSON.stringify(season.rules).includes('COIN'), false)
  assert.deepEqual(headquartersLevel(1500, season.rules), {
    number: 3,
    label: '三级大本营',
    minimumExperience: 1500,
    styleKey: 'BASE_3',
  })
})

test('rejects client-provided score fields before resolving identity or writing', async () => {
  assert.throws(() => assertNoClientScore({ match: { teamAScore: 9000 } }), /SCORE_NOT_ACCEPTED/)
  let resolved = false
  let called = false
  const handler = createHandler({
    health: async () => ({}),
    resolveCaller: async () => { resolved = true; return { appId: 'app', userId: 'user' } },
    assertPlayerReady: async () => {},
    assertAdminReady: async () => {},
    service: { saveWeeklyMatch: async () => { called = true } },
  })
  const result = await handler({
    action: 'admin.saveWeeklyMatch',
    match: { seasonId, teamAScore: 9000 },
  })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'SCORE_NOT_ACCEPTED')
  assert.equal(resolved, false)
  assert.equal(called, false)
})

test('dispatches nested v1 input, keeps legacy flat requests and preserves health checks', async () => {
  const calls = []
  const handler = createHandler({
    health: async () => ({ service: 'mip-game-api' }),
    resolveCaller: async () => ({ appId: 'app', userId: 'user' }),
    assertPlayerReady: async () => {},
    assertAdminReady: async () => {},
    service: {
      getOverview: async (_caller, input) => {
        calls.push(input)
        return { season: null }
      },
    },
  })
  const v1 = await handler({
    contractVersion: 1,
    action: 'getOverview',
    input: { seasonId },
  })
  const legacy = await handler({ action: 'getOverview', seasonId })
  assert.deepEqual(v1, { ok: true, data: { season: null } })
  assert.deepEqual(legacy, v1)
  assert.deepEqual(calls, [{ seasonId }, { seasonId }])
  assert.deepEqual(await handler({ action: 'health' }), {
    ok: true,
    data: { service: 'mip-game-api' },
  })
  assert.deepEqual(await handler({ contractVersion: 1, action: 'health', input: {} }), {
    ok: true,
    data: { service: 'mip-game-api' },
  })
  assert.equal(Object.keys(actions).length, 29)
})

test('accepts trusted CloudBase metadata outside the neutral game envelope', async () => {
  const calls = []
  let resolved = false
  const handler = createHandler({
    health: async () => ({}),
    resolveCaller: async () => { resolved = true; return { appId: 'app', userId: 'user' } },
    assertPlayerReady: async () => {},
    assertAdminReady: async () => {},
    service: {
      getOverview: async (_caller, input) => {
        calls.push(input)
        return { season: null }
      },
    },
  })

  assert.deepEqual(await handler({
    contractVersion: 1,
    action: 'getOverview',
    input: { seasonId },
    userInfo: { appId: 'cloudbase-app', openId: 'cloudbase-openid' },
    tcbContext: { requestId: 'cloudbase-request' },
  }), { ok: true, data: { season: null } })
  assert.deepEqual(calls, [{ seasonId }])

  resolved = false
  const malformed = await handler({
    contractVersion: 1,
    action: 'getOverview',
    input: {},
    userInfo: 'forged-metadata',
  })
  assert.equal(malformed.error.code, 'VALIDATION_FAILED')
  assert.equal(resolved, false)
})

test('rejects extra v1 fields and strips nested routing metadata before score validation', async () => {
  const calls = []
  let resolved = false
  const handler = createHandler({
    health: async () => ({}),
    resolveCaller: async () => { resolved = true; return { appId: 'app', userId: 'user' } },
    assertPlayerReady: async () => {},
    assertAdminReady: async () => {},
    service: {
      getOverview: async (_caller, input) => {
        calls.push(input)
        return { season: null }
      },
      saveWeeklyMatch: async () => {
        calls.push({ route: 'admin.saveWeeklyMatch' })
      },
    },
  })
  const injected = await handler({
    contractVersion: 1,
    action: 'getOverview',
    input: {
      action: 'admin.saveWeeklyMatch',
      contractVersion: 999,
      input: { action: 'admin.saveWeeklyMatch' },
      seasonId,
    },
  })
  assert.equal(injected.ok, true)
  assert.deepEqual(calls, [{ seasonId }])

  const flat = await handler({
    contractVersion: 1,
    action: 'getOverview',
    input: {},
    seasonId,
  })
  assert.equal(flat.ok, false)
  assert.equal(flat.error.code, 'VALIDATION_FAILED')

  resolved = false
  const score = await handler({
    contractVersion: 1,
    action: 'admin.saveWeeklyMatch',
    input: { match: { seasonId, teamAScore: 9000 } },
  })
  assert.equal(score.ok, false)
  assert.equal(score.error.code, 'SCORE_NOT_ACCEPTED')
  assert.equal(resolved, false)
  assert.deepEqual(calls, [{ seasonId }])
})

test('rejects prototype action names before resolving game identity', async () => {
  let resolved = false
  const handler = createHandler({
    health: async () => ({}),
    resolveCaller: async () => { resolved = true; return { appId: 'app', userId: 'user' } },
    assertPlayerReady: async () => { resolved = true },
    assertAdminReady: async () => { resolved = true },
    service: {},
  })

  for (const action of ['toString', 'constructor', '__proto__']) {
    const result = await handler({ contractVersion: 1, action, input: {} })
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'NOT_FOUND')
  }
  assert.equal(resolved, false)
})

test('gates admin actions before dispatch and leaves member reads authenticated', async () => {
  const calls = []
  const handler = createHandler({
    health: async () => ({}),
    resolveCaller: async () => ({ appId: 'app', userId: 'user' }),
    assertPlayerReady: async () => { calls.push('player') },
    assertAdminReady: async () => { calls.push('gate'); throw new Error('PHONE_REQUIRED') },
    service: {
      getOverview: async () => { calls.push('read'); return { season: null } },
      listSeasons: async () => { calls.push('admin'); return { items: [] } },
    },
  })
  assert.deepEqual(await handler({ action: 'getOverview' }), { ok: true, data: { season: null } })
  const blocked = await handler({ action: 'admin.listSeasons' })
  assert.equal(blocked.error.code, 'PHONE_REQUIRED')
  assert.deepEqual(calls, ['player', 'read', 'gate'])
})

test('defines seasonal and all-time ranking periods without accepting a client range', () => {
  const season = {
    season_key: '2026-h2',
    starts_at: '2026-07-01 00:00:00.000',
    ends_at: '2027-01-01 00:00:00.000',
  }
  assert.deepEqual(rankingPeriod(season, 'TEAM_HALF_YEAR'), {
    key: '2026-h2:team_half_year',
    start: '2026-07-01 00:00:00.000',
    end: season.ends_at,
  })
  assert.deepEqual(rankingPeriod(season, 'TEAM_YEAR'), {
    key: '2026-h2:team_year',
    start: '2026-01-01 00:00:00.000',
    end: season.ends_at,
  })
  assert.deepEqual(rankingPeriod(season, 'INDIVIDUAL_SEASON'), {
    key: '2026-h2:individual_season',
    start: season.starts_at,
    end: season.ends_at,
  })
  assert.deepEqual(rankingPeriod(season, 'INDIVIDUAL_ALL_TIME'), {
    key: 'all-time',
    start: '1970-01-01 00:00:00.000',
    end: season.ends_at,
  })
})

test('keeps draft ranking snapshots behind the admin action', async () => {
  const queries = []
  const repository = createGameRepository({
    async one(sql) {
      queries.push(sql)
      return null
    },
  })
  await assert.rejects(
    repository.listRankings(
      { appId: 'app', userId: 'user' },
      { seasonId, rankingType: 'TEAM_HALF_YEAR' },
    ),
    /NOT_FOUND/,
  )
  assert.match(queries[0], /status IN \('ACTIVE', 'CLOSED'\)/)
})

test('normalizes an unordered seven-day matchup pair and rejects non-week periods', () => {
  const teamAId = '20000000-0000-4000-8000-000000000001'
  const teamBId = '20000000-0000-4000-8000-000000000002'
  assert.deepEqual(normalizeMatch({
    seasonId,
    teamAId: teamBId,
    teamBId: teamAId,
    weekStart: '2026-08-24',
    weekEnd: '2026-08-30',
  }), {
    seasonId,
    teamAId,
    teamBId,
    weekStart: '2026-08-24',
    weekEnd: '2026-08-30',
  })
  assert.throws(() => normalizeMatch({
    seasonId,
    teamAId,
    teamBId,
    weekStart: '2026-08-24',
    weekEnd: '2026-08-31',
  }), /VALIDATION_FAILED/)
})

test('rejects membership changes after the season is closed before writing', async () => {
  const writes = []
  let oneCall = 0
  const database = {
    async transaction(work) { return work(this) },
    async one() {
      oneCall += 1
      if (oneCall === 1) return { role_key: 'PLATFORM_OWNER' }
      return { status: 'CLOSED' }
    },
    async query(sql) { writes.push(sql); return [] },
  }
  const repository = createGameRepository(database)
  await assert.rejects(
    repository.replaceTeamMembers(
      { appId: 'app', userId: 'user', profileRefSecret: 'secret' },
      {
        seasonId,
        teamId: '20000000-0000-4000-8000-000000000001',
        expectedVersion: 3,
        members: [],
      },
    ),
    /INVALID_STATE/,
  )
  assert.deepEqual(writes, [])
})

test('pages every assignable current player with an opaque keyset cursor and an explicit team limit', async () => {
  const userIds = [
    '30000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000003',
  ]
  const queries = []
  const database = {
    async one() { return { role_key: 'PLATFORM_OWNER' } },
    async query(sql, params) {
      queries.push({ sql, params })
      const rows = userIds.map((id, index) => ({
        id,
        nickname: `玩家${index + 1}`,
        branch_name: null,
        team_id: null,
        team_name: null,
        role: null,
      }))
      return queries.length === 1 ? rows : rows.slice(2)
    },
  }
  const caller = { appId: 'app', userId: userIds[0], profileRefSecret: 's'.repeat(32) }
  const repository = createGameRepository(database)
  const first = await repository.listAssignableMembers(caller, { seasonId, limit: 2 })
  assert.equal(first.items.length, 2)
  assert.equal(first.hasMore, true)
  assert.equal(first.limit, 2)
  assert.equal(first.maxTeamMembers, 100)
  assert.match(first.nextCursor, /^gm1\./)
  assert.match(first.items[0].memberRef, /^p1\./)
  assert.match(first.items[0].candidateKey, /^gmk1\.[A-Za-z0-9_-]{43}$/)
  assert.match(queries[0].sql, /ORDER BY user\.id LIMIT \?/)
  assert.match(queries[0].sql, /entitlement\.status = 'ACTIVE'/)
  assert.deepEqual(queries[0].params, [seasonId, 'app', 3])

  const second = await repository.listAssignableMembers(caller, {
    seasonId,
    cursor: first.nextCursor,
    limit: 2,
  })
  assert.equal(second.items.length, 1)
  assert.equal(second.hasMore, false)
  assert.equal(second.nextCursor, '')
  assert.match(queries[1].sql, /user\.id > \?/)
  assert.deepEqual(queries[1].params, [seasonId, 'app', userIds[1], 3])
})

test('binds assignable-member cursors to their season and normalized query', () => {
  const pepper = 's'.repeat(32)
  const context = {
    appId: 'app',
    seasonId,
    query: '玩家',
    userId: '30000000-0000-4000-8000-000000000001',
  }
  const cursor = createMemberCursor(context, pepper)
  assert.equal(readMemberCursor(cursor, context, pepper), context.userId)
  assert.throws(
    () => readMemberCursor(cursor, { ...context, query: '其他' }, pepper),
    /VALIDATION_FAILED/,
  )
  assert.throws(
    () => readMemberCursor(cursor, {
      ...context,
      seasonId: '10000000-0000-4000-8000-000000000002',
    }, pepper),
    /VALIDATION_FAILED/,
  )
  assert.equal(createCandidateKey(context, pepper), createCandidateKey(context, pepper))
  assert.notEqual(
    createCandidateKey(context, pepper),
    createCandidateKey({ ...context, userId: '30000000-0000-4000-8000-000000000002' }, pepper),
  )
})

test('publishes the team member limit instead of silently truncating replacement input', () => {
  assert.throws(() => memberPageLimit(undefined), /PAGINATION_REQUIRED/)
  assert.equal(memberPageLimit(100), 100)
  assert.throws(() => memberPageLimit(101), /VALIDATION_FAILED/)
  assert.throws(
    () => normalizeMembers(Array.from({ length: 101 }, () => ({}))),
    /MEMBER_LIMIT_EXCEEDED/,
  )
})

test('serializes current-player checks and versions every team affected by a roster transfer', async () => {
  const pepper = 's'.repeat(32)
  const targetTeamId = '20000000-0000-4000-8000-000000000001'
  const sourceTeamId = '20000000-0000-4000-8000-000000000002'
  const transferredUserId = '30000000-0000-4000-8000-000000000001'
  const newUserId = '30000000-0000-4000-8000-000000000002'
  const calls = []
  const tx = {
    async one(sql, params) {
      calls.push({ kind: 'one', sql, params })
      if (sql.includes('FROM mip_admin_role_bindings')) return { role_key: 'PLATFORM_OWNER' }
      if (sql.includes('FROM mip_game_seasons')) return { status: 'ACTIVE' }
      if (sql.includes('FROM mip_users')) return { status: 'ACTIVE' }
      if (sql.includes('FROM mip_membership_chains')) return { version: 5 }
      if (sql.includes('FROM mip_membership_entitlements')) return { id: 'entitlement' }
      if (sql.includes('FROM mip_game_team_memberships')) {
        return params[2] === transferredUserId
          ? { id: 'source-membership', team_id: sourceTeamId, role: 'MEMBER' }
          : null
      }
      if (sql.includes('FROM mip_game_teams')) {
        return { version: params[2] === targetTeamId ? 4 : 7 }
      }
      throw new Error(`unexpected one: ${sql}`)
    },
    async query(sql, params) {
      calls.push({ kind: 'query', sql, params })
      if (sql.includes('SELECT id, user_id FROM mip_game_team_memberships')) {
        return [{ id: 'removed-membership', user_id: '30000000-0000-4000-8000-000000000099' }]
      }
      return { affectedRows: 1 }
    },
  }
  const repository = createGameRepository({ transaction: work => work(tx) }, {
    createId: (() => {
      let sequence = 10
      return () => `40000000-0000-4000-8000-${String(sequence++).padStart(12, '0')}`
    })(),
  })
  const result = await repository.replaceTeamMembers(
    { appId: 'app', userId: 'admin', profileRefSecret: pepper },
    {
      seasonId,
      teamId: targetTeamId,
      expectedVersion: 4,
      members: [
        {
          memberRef: createProfileRef({ appId: 'app', userId: transferredUserId }, pepper),
          role: 'CAPTAIN',
        },
        {
          memberRef: createProfileRef({ appId: 'app', userId: newUserId }, pepper),
          role: 'MEMBER',
        },
      ],
    },
  )
  assert.deepEqual(result, { teamId: targetTeamId, memberCount: 2, version: 5 })
  const statements = calls.map(call => call.sql.replace(/\s+/g, ' ').trim())
  const firstUser = statements.findIndex(sql => sql.includes('FROM mip_users'))
  const firstChain = statements.findIndex(sql => sql.includes('FROM mip_membership_chains'))
  const firstEntitlement = statements.findIndex(sql => sql.includes('FROM mip_membership_entitlements'))
  assert.ok(firstUser >= 0 && firstChain > firstUser && firstEntitlement > firstChain)
  assert.equal(statements.filter(sql => sql.includes('FROM mip_membership_chains')).length, 2)
  const sourceUpdate = calls.find(call => call.kind === 'query'
    && call.sql.includes('UPDATE mip_game_teams') && call.params[2] === sourceTeamId)
  const targetUpdate = calls.find(call => call.kind === 'query'
    && call.sql.includes('UPDATE mip_game_teams') && call.params[2] === targetTeamId)
  assert.equal(sourceUpdate.params[3], 7)
  assert.equal(targetUpdate.params[3], 4)
  assert.equal(calls.filter(call => call.sql.includes('INSERT INTO mip_audit_logs')).length, 2)
})

test('does not write a roster after the membership-chain check finds no current entitlement', async () => {
  const pepper = 's'.repeat(32)
  const targetTeamId = '20000000-0000-4000-8000-000000000001'
  const userId = '30000000-0000-4000-8000-000000000001'
  const writes = []
  const repository = createGameRepository({
    transaction: work => work({
      async one(sql) {
        if (sql.includes('FROM mip_admin_role_bindings')) return { role_key: 'PLATFORM_OWNER' }
        if (sql.includes('FROM mip_game_seasons')) return { status: 'ACTIVE' }
        if (sql.includes('FROM mip_game_teams')) return { version: 4 }
        if (sql.includes('FROM mip_users')) return { status: 'ACTIVE' }
        if (sql.includes('FROM mip_membership_chains')) return { version: 5 }
        if (sql.includes('FROM mip_membership_entitlements')) return null
        throw new Error(`unexpected one: ${sql}`)
      },
      async query(sql) { writes.push(sql); return { affectedRows: 1 } },
    }),
  })
  await assert.rejects(repository.replaceTeamMembers(
    { appId: 'app', userId: 'admin', profileRefSecret: pepper },
    {
      seasonId,
      teamId: targetTeamId,
      expectedVersion: 4,
      members: [{
        memberRef: createProfileRef({ appId: 'app', userId }, pepper),
        role: 'MEMBER',
      }],
    },
  ), /MEMBER_NOT_FOUND/)
  assert.deepEqual(writes, [])
})

test('builds individual rankings from time-bounded growth for players active at snapshot time', async () => {
  let captured = null
  const period = {
    start: '1970-01-01 00:00:00.000',
    end: '2027-01-01 00:00:00.000',
  }
  await individualRankingRows({
    async query(sql, params) { captured = { sql, params }; return [] },
  }, 'app', { id: seasonId }, period, 'INDIVIDUAL_ALL_TIME')
  assert.match(captured.sql, /mip_growth_entries entry/)
  assert.match(captured.sql, /entry\.created_at >= \? AND entry\.created_at <= \?/)
  assert.match(captured.sql, /entitlement\.status = 'ACTIVE'/)
  assert.match(captured.sql, /entitlement\.starts_at <= UTC_TIMESTAMP\(3\)/)
  assert.match(captured.sql, /entitlement\.ends_at > UTC_TIMESTAMP\(3\)/)
  assert.doesNotMatch(captured.sql, /entitlement\.status IN \('ACTIVE', 'EXPIRED'\)/)
  assert.doesNotMatch(captured.sql, /mip_growth_accounts/)
  assert.deepEqual(captured.params, [period.start, period.end, 'app'])
})

test('rechecks active player facts when calculating team scores and ranking writes', async () => {
  let scoreRead = null
  const eligibilityAt = '2026-08-08 00:00:00.000'
  const score = await teamExperience({
    async one(sql, params) { scoreRead = { sql, params }; return { score: 12 } },
  }, 'app', seasonId, '20000000-0000-4000-8000-000000000001', '2026-08-01', '2026-08-07', eligibilityAt)
  assert.equal(score, 12)
  assert.match(scoreRead.sql, /INNER JOIN mip_users user/)
  assert.match(scoreRead.sql, /entitlement\.status = 'ACTIVE'/)
  assert.match(scoreRead.sql, /entitlement\.starts_at <= COALESCE\(\?, UTC_TIMESTAMP\(3\)\)/)
  assert.match(scoreRead.sql, /entitlement\.ends_at > COALESCE\(\?, UTC_TIMESTAMP\(3\)\)/)
  assert.deepEqual(scoreRead.params, [
    '2026-08-01',
    '2026-08-07',
    'app',
    seasonId,
    '20000000-0000-4000-8000-000000000001',
    eligibilityAt,
    eligibilityAt,
  ])

  let rankingRead = null
  await teamRankingRows({
    async query(sql, params) { rankingRead = { sql, params }; return [] },
  }, 'app', { id: seasonId }, { start: '2026-08-01', end: '2026-08-31' })
  assert.match(rankingRead.sql, /LEFT JOIN mip_users user/)
  assert.match(rankingRead.sql, /entitlement\.status = 'ACTIVE'/)
  assert.deepEqual(rankingRead.params, ['2026-08-01', '2026-08-31', 'app', seasonId])
})

test('keeps score generation app-scoped on growth facts', () => {
  const source = fs.readFileSync(path.join(__dirname, '../domain/repository.js'), 'utf8')
  assert.match(source, /UTC_TIMESTAMP\(3\) AS eligibility_at/)
  assert.equal(source.match(/current\.eligibility_at/g)?.length, 2)
  assert.match(source, /entry\.metric = 'EXPERIENCE'/)
  assert.match(source, /member\.app_id = \?/)
  assert.match(source, /entry\.created_at >= \? AND entry\.created_at <= \?/)
  assert.match(source, /entitlement\.starts_at <= UTC_TIMESTAMP\(3\)/)
  assert.match(source, /status = 'ARCHIVED'/)
  assert.doesNotMatch(source, /coin_balance|metric = 'COIN'/)
  assert.doesNotMatch(source, /event\.(?:score|points)/)
})
