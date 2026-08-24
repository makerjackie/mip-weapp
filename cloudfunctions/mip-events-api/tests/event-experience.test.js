'use strict'

const assert = require('node:assert/strict')
const { test } = require('node:test')
const { getHeart, listHeartCandidates, setHeart } = require('../domain/event-service')
const { createSignedToken } = require('../lib/tokens')

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
      assert.match(sql, /visibility_block\.app_id = r\.app_id/)
      assert.match(sql, /blocker_user_id = \? AND visibility_block\.blocked_user_id = r\.user_id/)
      assert.match(sql, /blocker_user_id = r\.user_id AND visibility_block\.blocked_user_id = \?/)
      assert.deepEqual(params, ['wx-app', 'event-1', 'user-self', 'user-self', 'user-self'])
      return [{ registration_id: 'registration-2', nickname: '较晚报名的参与者' }]
    },
  }
  const result = await listHeartCandidates(database, {
    appId: 'wx-app',
    eventId: 'event-1',
    userId: 'user-self',
    tokenSecret: 'event-experience-token-secret',
  })
  assert.equal(result[0].nickname, '较晚报名的参与者')
  assert.equal(result[0].selected, false)
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
