'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { createHandler } = require('../domain/handler')
const { createGameRepository, headquartersLevel, rankingPeriod } = require('../domain/repository')
const { assertNoClientScore, normalizeMatch, normalizeSeason } = require('../domain/validation')

const seasonId = '10000000-0000-4000-8000-000000000001'

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

test('keeps score generation app-scoped on growth facts', () => {
  const source = fs.readFileSync(path.join(__dirname, '../domain/repository.js'), 'utf8')
  assert.match(source, /entry\.metric = 'EXPERIENCE'/)
  assert.match(source, /member\.app_id = \?/)
  assert.match(source, /account\.experience_balance/)
  assert.match(source, /status = 'ARCHIVED'/)
  assert.doesNotMatch(source, /coin_balance|metric = 'COIN'/)
  assert.doesNotMatch(source, /event\.(?:score|points)/)
})
