'use strict'

const assert = require('node:assert/strict')
const { test } = require('node:test')
const { getEvent, getEventInteractionSummary, getHeart, listHeartCandidates, setHeart } = require('../domain/event-service')
const { createSignedToken } = require('../lib/tokens')

const profileRefSecret = 'event-experience-profile-reference-secret'
const candidateUserId = '22222222-2222-4222-8222-222222222222'

test('heart candidates are returned by registration time descending', async () => {
  const database = {
    async one(sql) {
      if (String(sql).includes('FROM mip_event_registrations')) {
        return { id: 'registration-self', event_id: 'event-1', user_id: 'user-self', status: 'ATTENDED', version: 1 }
      }
      return null
    },
    async query(sql, params) {
      assert.match(sql, /ORDER BY r\.registered_at DESC, r\.id DESC/)
      assert.match(sql, /r\.id AS registration_id, r\.user_id/)
      assert.match(sql, /visibility_block\.app_id = r\.app_id/)
      assert.match(sql, /blocker_user_id = \? AND visibility_block\.blocked_user_id = r\.user_id/)
      assert.match(sql, /blocker_user_id = r\.user_id AND visibility_block\.blocked_user_id = \?/)
      assert.deepEqual(params, ['wx-app', 'event-1', 'user-self', 'user-self', 'user-self'])
      return [{ registration_id: 'registration-2', user_id: candidateUserId, nickname: '较晚报名的参与者' }]
    },
  }
  const result = await listHeartCandidates(database, {
    appId: 'wx-app',
    eventId: 'event-1',
    userId: 'user-self',
    tokenSecret: 'event-experience-token-secret',
    profileRefSecret,
  })
  assert.equal(result[0].nickname, '较晚报名的参与者')
  assert.equal(result[0].selected, false)
  assert.match(result[0].profileRef, /^p1\./)
  assert.equal(JSON.stringify(result).includes(candidateUserId), false)
})

test('heart result hides blocked selected and received participants in app-scoped SQL', async () => {
  const calls = []
  const database = {
    async one(sql, params) {
      calls.push({ sql, params })
      if (sql.includes('SELECT id, event_id, user_id')) {
        return { id: 'registration-self', event_id: 'event-1', user_id: 'user-self', status: 'ATTENDED' }
      }
      return { version: 4, updated_at: '2026-08-24T00:00:00.000Z' }
    },
    async query(sql, params) {
      calls.push({ sql, params })
      return []
    },
  }

  const result = await getHeart(database, {
    appId: 'wx-app',
    eventId: 'event-1',
    userId: 'user-self',
    tokenSecret: 'event-experience-token-secret',
    profileRefSecret,
  })

  const selectedQuery = calls.find(call => call.sql.includes('FROM mip_event_hearts h')
    && call.sql.includes('LEFT JOIN mip_event_registrations tr'))
  const receivedQuery = calls.find(call => call.sql.includes('JOIN mip_event_registrations vr'))
  assert.match(selectedQuery.sql, /visibility_block\.app_id = h\.app_id/)
  assert.match(selectedQuery.sql, /blocked_user_id = h\.target_user_id/)
  assert.deepEqual(selectedQuery.params, ['user-self', 'user-self', 'wx-app', 'event-1', 'user-self'])
  assert.match(receivedQuery.sql, /visibility_block\.app_id = h\.app_id/)
  assert.match(receivedQuery.sql, /blocked_user_id = h\.voter_user_id/)
  assert.deepEqual(receivedQuery.params, ['wx-app', 'event-1', 'user-self', 'user-self', 'user-self'])
  assert.equal(result.target, undefined)
  assert.deepEqual(result.received, [])
  assert.equal(result.version, 4)
})

test('heart state returns opaque profile references without exposing user ids', async () => {
  const targetUserId = '22222222-2222-4222-8222-222222222222'
  const voterUserId = '33333333-3333-4333-8333-333333333333'
  const database = {
    async one(sql) {
      if (sql.includes('SELECT id, event_id, user_id')) {
        return { id: 'registration-self', event_id: 'event-1', user_id: 'user-self', status: 'ATTENDED' }
      }
      // MIW-36：getHeart 同时下发 heartCounts 服务端计数，stub 按 COUNT 别名路由。
      if (sql.includes('AS my_interest_count')) return { my_interest_count: 1 }
      if (sql.includes('AS received_interest_count')) return { received_interest_count: 1 }
      assert.match(sql, /tr\.id AS registration_id, tr\.user_id/)
      return {
        version: 2,
        updated_at: '2026-08-24T00:00:00.000Z',
        registration_id: 'registration-target',
        user_id: targetUserId,
        nickname: '我的心动',
      }
    },
    async query(sql) {
      assert.match(sql, /vr\.user_id/)
      return [{
        registration_id: 'registration-voter',
        user_id: voterUserId,
        nickname: '对我心动',
      }]
    },
  }

  const result = await getHeart(database, {
    appId: 'wx-app',
    eventId: 'event-1',
    userId: 'user-self',
    tokenSecret: 'event-experience-token-secret',
    profileRefSecret,
  })

  assert.match(result.target.profileRef, /^p1\./)
  assert.match(result.received[0].profileRef, /^p1\./)
  assert.equal(JSON.stringify(result).includes(targetUserId), false)
  assert.equal(JSON.stringify(result).includes(voterUserId), false)
  // 计数与列表同源（heartCounts）：target 在场 → 我的心动 1；received 一行 → 对我心动 1。
  assert.deepEqual(result.counts, { myInterestCount: 1, receivedInterestCount: 1 })
})

test('set heart rechecks a signed target inside the transaction', async () => {
  const now = new Date('2026-08-24T00:00:00.000Z')
  const tokenSecret = 'event-experience-token-secret'
  const targetRef = createSignedToken({
    type: 'heart-target',
    eventId: 'event-1',
    registrationId: 'registration-target',
    expiresAt: '2026-09-24T00:00:00.000Z',
  }, tokenSecret)
  let targetCall
  const tx = {
    async one(sql, params) {
      if (sql.includes('FROM mip_users')) {
        return { id: 'user-self', status: 'ACTIVE' }
      }
      if (sql.includes('SELECT id, event_id, user_id')) {
        return { id: 'registration-self', event_id: 'event-1', user_id: 'user-self', status: 'ATTENDED' }
      }
      if (sql.includes('SELECT r.id, r.user_id')) {
        targetCall = { sql, params }
        return null
      }
      throw new Error(`unexpected query: ${sql}`)
    },
  }

  await assert.rejects(
    () => setHeart({ transaction: work => work(tx) }, {
      appId: 'wx-app',
      eventId: 'event-1',
      userId: 'user-self',
      targetRef,
      tokenSecret,
      participationAccessPolicy: { requireAccess: async () => ({}) },
      now,
    }),
    /参与人不存在或当前不可见/,
  )
  assert.match(targetCall.sql, /visibility_block\.app_id = r\.app_id/)
  assert.match(targetCall.sql, /blocker_user_id = \? AND visibility_block\.blocked_user_id = r\.user_id/)
  assert.match(targetCall.sql, /FOR UPDATE/)
  assert.deepEqual(targetCall.params, [
    'wx-app',
    'event-1',
    'registration-target',
    'user-self',
    'user-self',
  ])
})

test('interaction summary counts active hearts with app-scoped block filters', async () => {
  const calls = []
  const database = {
    async one(sql, params) {
      calls.push({ sql, params })
      if (sql.includes('AS my_interest_count')) return { my_interest_count: '1' }
      return { received_interest_count: '2' }
    },
  }

  const result = await getEventInteractionSummary(database, {
    appId: 'wx-app',
    eventId: 'event-1',
    userId: 'user-self',
  })

  const [sentCall, receivedCall] = calls
  // 回归守卫：拉黑片段必须以 `AND` 连词进入 WHERE，裸 NOT EXISTS 拼接是 MySQL 1064。
  assert.match(sentCall.sql, /AND h\.status = 'ACTIVE'\s+AND NOT EXISTS \(/)
  assert.match(sentCall.sql, /AS my_interest_count/)
  assert.match(sentCall.sql, /h\.voter_user_id = \? AND h\.status = 'ACTIVE'/)
  assert.match(sentCall.sql, /visibility_block\.app_id = h\.app_id/)
  assert.match(sentCall.sql, /visibility_block\.blocked_user_id = h\.target_user_id/)
  assert.deepEqual(sentCall.params, ['wx-app', 'event-1', 'user-self', 'user-self', 'user-self'])

  assert.match(receivedCall.sql, /AND h\.status = 'ACTIVE'\s+AND NOT EXISTS \(/)
  assert.match(receivedCall.sql, /AS received_interest_count/)
  assert.match(receivedCall.sql, /h\.target_user_id = \? AND h\.status = 'ACTIVE'/)
  assert.match(receivedCall.sql, /visibility_block\.blocked_user_id = h\.voter_user_id/)
  // 与 getHeart received 列表同人群：投票者资料可见才计入（口径与参与人页 tab 一致）。
  assert.match(receivedCall.sql, /JOIN mip_profiles vp ON vp\.app_id = vr\.app_id AND vp\.user_id = vr\.user_id/)
  assert.deepEqual(receivedCall.params, ['wx-app', 'event-1', 'user-self', 'user-self', 'user-self'])

  assert.deepEqual(result, { myInterestCount: 1, receivedInterestCount: 2 })
})

const detailBaseRow = {
  id: 'event-1',
  app_id: 'wx-app',
  scope_type: 'PLATFORM',
  organizer_user_id: 'organizer-1',
  title: '活动',
  summary: '摘要',
  description: '介绍',
  notices: null,
  event_mode: 'ONLINE',
  access_type: 'FREE',
  registration_policy: 'AUTO',
  status: 'PUBLISHED',
  starts_at: '2026-08-25T00:00:00.000Z',
  ends_at: '2026-08-25T02:00:00.000Z',
  price_cents: 0,
  currency: 'CNY',
  form_version: 1,
  registration_schema_json: '[]',
  capacity: 10,
  registration_count: 3,
  cancellation_deadline: '2026-08-24T00:00:00.000Z',
}

function detailDatabase(row, { summaryError } = {}) {
  return {
    async one(sql) {
      if (sql.includes('AS my_interest_count') || sql.includes('AS received_interest_count')) {
        if (summaryError) throw summaryError
        return sql.includes('AS my_interest_count')
          ? { my_interest_count: 1 }
          : { received_interest_count: 2 }
      }
      return row
    },
    async query() {
      return []
    },
  }
}

const loadDetail = (row, userId, database) => getEvent(database || detailDatabase(row), {
  appId: 'wx-app',
  userId,
  eventId: 'event-1',
  now: new Date('2026-08-24T00:00:00.000Z'),
  tokenSecret: '',
  profileRefSecret: 'public-organizer-profile-ref-pepper-more-than-32-characters',
})

test('event detail emits interaction summary only for the attended viewer', async () => {
  const attended = await loadDetail({ ...detailBaseRow, registration_status: 'ATTENDED', registration_version: 3 }, 'viewer-1')
  assert.deepEqual(attended.interactionSummary, { myInterestCount: 1, receivedInterestCount: 2 })

  const registered = await loadDetail({ ...detailBaseRow, registration_status: 'REGISTERED', registration_version: 3 }, 'viewer-1')
  assert.equal('interactionSummary' in registered, false)

  const guest = await loadDetail({ ...detailBaseRow, registration_status: null }, null)
  assert.equal('interactionSummary' in guest, false)
})

test('event detail keeps loading when the interaction summary fails (MIW-28)', async () => {
  const row = { ...detailBaseRow, registration_status: 'ATTENDED', registration_version: 3 }
  const attended = await loadDetail(row, 'viewer-1', detailDatabase(row, {
    summaryError: new Error('interaction summary unavailable'),
  }))

  assert.equal('interactionSummary' in attended, false)
  assert.equal(attended.canInteract, true)
})
