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
      return { my_interest_count: '1', received_interest_count: '2' }
    },
  }

  const result = await getEventInteractionSummary(database, {
    appId: 'wx-app',
    eventId: 'event-1',
    userId: 'user-self',
  })

  const [summaryCall] = calls
  assert.match(summaryCall.sql, /AS my_interest_count/)
  assert.match(summaryCall.sql, /AS received_interest_count/)
  assert.match(summaryCall.sql, /h\.voter_user_id = \? AND h\.status = 'ACTIVE'/)
  assert.match(summaryCall.sql, /h\.target_user_id = \? AND h\.status = 'ACTIVE'/)
  assert.match(summaryCall.sql, /visibility_block\.app_id = h\.app_id/)
  assert.match(summaryCall.sql, /visibility_block\.blocked_user_id = h\.target_user_id/)
  assert.match(summaryCall.sql, /visibility_block\.blocked_user_id = h\.voter_user_id/)
  assert.deepEqual(summaryCall.params, [
    'user-self',
    'user-self',
    'wx-app',
    'event-1',
    'user-self',
    'user-self',
    'user-self',
    'wx-app',
    'event-1',
    'user-self',
  ])
  assert.deepEqual(result, { myInterestCount: 1, receivedInterestCount: 2 })
})

test('event detail emits interaction summary only for the attended viewer', async () => {
  const summaryRow = { my_interest_count: 1, received_interest_count: 2 }
  const detailDatabase = row => ({
    async one(sql) {
      if (sql.includes('AS received_interest_count')) return summaryRow
      return row
    },
    async query() {
      return []
    },
  })
  const baseRow = {
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
  const load = (row, userId) => getEvent(detailDatabase(row), {
    appId: 'wx-app',
    userId,
    eventId: 'event-1',
    now: new Date('2026-08-24T00:00:00.000Z'),
    tokenSecret: '',
    profileRefSecret: 'public-organizer-profile-ref-pepper-more-than-32-characters',
  })

  const attended = await load({ ...baseRow, registration_status: 'ATTENDED', registration_version: 3 }, 'viewer-1')
  assert.deepEqual(attended.interactionSummary, { myInterestCount: 1, receivedInterestCount: 2 })

  const registered = await load({ ...baseRow, registration_status: 'REGISTERED', registration_version: 3 }, 'viewer-1')
  assert.equal('interactionSummary' in registered, false)

  const guest = await load({ ...baseRow, registration_status: null }, null)
  assert.equal('interactionSummary' in guest, false)
})
