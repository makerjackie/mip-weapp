'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { createHandler } = require('../domain/handler')
const { createGameRepository, headquartersLevel, individualRankingRows, rankingPeriod } = require('../domain/repository')
const { assertNoClientScore, normalizeMatch, normalizeSeason } = require('../domain/validation')

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
      return { version: 3, season_status: 'CLOSED' }
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

test('builds all-time ranking from time-bounded growth and entitlement facts', async () => {
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
  assert.match(captured.sql, /entitlement\.status IN \('ACTIVE', 'EXPIRED'\)/)
  assert.match(captured.sql, /entitlement\.revoked_at > LEAST\(\?, UTC_TIMESTAMP\(3\)\)/)
  assert.match(captured.sql, /entitlement\.starts_at <= LEAST\(\?, UTC_TIMESTAMP\(3\)\)/)
  assert.match(captured.sql, /entitlement\.ends_at > LEAST\(\?, UTC_TIMESTAMP\(3\)\)/)
  assert.doesNotMatch(captured.sql, /mip_growth_accounts/)
  assert.deepEqual(captured.params, [period.start, period.end, 'app', period.end, period.end, period.end])
})

test('keeps score generation app-scoped on growth facts', () => {
  const source = fs.readFileSync(path.join(__dirname, '../domain/repository.js'), 'utf8')
  assert.match(source, /entry\.metric = 'EXPERIENCE'/)
  assert.match(source, /member\.app_id = \?/)
  assert.match(source, /entry\.created_at >= \? AND entry\.created_at <= \?/)
  assert.match(source, /entitlement\.starts_at <= LEAST\(\?, UTC_TIMESTAMP\(3\)\)/)
  assert.match(source, /status = 'ARCHIVED'/)
  assert.doesNotMatch(source, /coin_balance|metric = 'COIN'/)
  assert.doesNotMatch(source, /event\.(?:score|points)/)
})
