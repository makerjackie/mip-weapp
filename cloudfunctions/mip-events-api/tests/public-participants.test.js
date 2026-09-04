'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { listPublicParticipants } = require('../domain/event-service')

const appId = 'wx-test-app'
const userId = '10000000-0000-4000-8000-000000000001'
const viewerUserId = '10000000-0000-4000-8000-000000000002'
const pepper = 'public-participant-test-pepper-with-more-than-32-characters'

test('public participant list filters server-side and returns no private registration facts', async () => {
  const database = {
    async one(sql) {
      assert.match(sql, /mip_events/)
      return { id: '20000000-0000-4000-8000-000000000001' }
    },
    async query(sql, parameters) {
      assert.match(sql, /r\.share_profile = 1/)
      assert.match(sql, /r\.status IN \('REGISTERED', 'ATTENDED'\)/)
      assert.match(sql, /FROM mip_user_blocks visibility_block/)
      assert.match(sql, /visibility_block\.app_id = r\.app_id/)
      assert.match(sql, /blocker_user_id = \? AND visibility_block\.blocked_user_id = r\.user_id/)
      assert.match(sql, /blocker_user_id = r\.user_id AND visibility_block\.blocked_user_id = \?/)
      assert.match(sql, /ORDER BY r\.registered_at DESC, r\.id DESC/)
      assert.match(sql, /r\.id AS registration_id/)
      assert.match(sql, /viewer_sent_heart\.app_id = r\.app_id/)
      assert.match(sql, /viewer_sent_heart\.event_id = r\.event_id/)
      assert.match(sql, /viewer_sent_heart\.voter_user_id = \?/)
      assert.match(sql, /viewer_sent_heart\.target_user_id = r\.user_id/)
      assert.match(sql, /participant_sent_heart\.voter_user_id = r\.user_id/)
      assert.match(sql, /participant_sent_heart\.target_user_id = \?/)
      assert.match(sql, /participant_sent_heart\.app_id = r\.app_id/)
      assert.match(sql, /participant_sent_heart\.event_id = r\.event_id/)
      assert.equal((sql.match(/\.status = 'ACTIVE'/g) || []).length >= 2, true)
      assert.doesNotMatch(sql, /answers_json|phone_ciphertext|ticket_hash|identity_key/i)
      assert.deepEqual(parameters, [
        viewerUserId,
        viewerUserId,
        appId,
        '20000000-0000-4000-8000-000000000001',
        viewerUserId,
        viewerUserId,
        25,
      ])
      return [{
        user_id: userId,
        nickname: '公开参与人',
        avatar_file_id: 'cloud://avatar',
        identity_status: '设计师',
        headline: '视觉设计',
        visibility_json: '{}',
        branch_name: '深圳分会',
        branch_city_name: '深圳',
        is_player: 1,
        heart_relation: 'SENT',
        answers_json: '{"private":true}',
        ticket_hash: 'secret',
      }]
    },
  }
  const result = await listPublicParticipants(database, {
    appId,
    userId: viewerUserId,
    eventId: '20000000-0000-4000-8000-000000000001',
    profileRefSecret: pepper,
  })
  assert.equal(result.items.length, 1)
  assert.match(result.items[0].profileRef, /^p1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{48}\.[A-Za-z0-9_-]{22}$/)
  assert.deepEqual(Object.keys(result.items[0]).sort(), [
    'avatarUrl',
    'headline',
    'heartRelation',
    'identityStatus',
    'nickname',
    'primaryBranch',
    'profileRef',
    'userKind',
  ])
  assert.equal(result.items[0].heartRelation, 'SENT')
  const serialized = JSON.stringify(result)
  assert.equal(serialized.includes(userId), false)
  assert.doesNotMatch(serialized, /answers|ticket|phone|openid/i)
})

test('anonymous public participant list keeps the original public range', async () => {
  let participantSql = ''
  const database = {
    async one() {
      return { id: '20000000-0000-4000-8000-000000000001' }
    },
    async query(sql) {
      participantSql = sql
      return []
    },
  }

  await listPublicParticipants(database, {
    appId,
    eventId: '20000000-0000-4000-8000-000000000001',
    profileRefSecret: pepper,
  })

  assert.equal(participantSql.includes('mip_user_blocks'), false)
  assert.equal(participantSql.includes('mip_event_hearts'), false)
})

test('public participant heart relation is caller-relative and omits absent relations', async () => {
  const relationships = ['RECEIVED', 'MUTUAL', null, 'OTHER_USERS']
  const database = {
    async one() {
      return { id: '20000000-0000-4000-8000-000000000001' }
    },
    async query(sql, parameters) {
      assert.equal((sql.match(/mip_event_hearts/g) || []).length, 2)
      assert.deepEqual(parameters.slice(0, 2), [viewerUserId, viewerUserId])
      return relationships.map((heart_relation, index) => ({
        user_id: `10000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
        nickname: `参与人 ${index + 1}`,
        visibility_json: '{}',
        is_player: 0,
        heart_relation,
      }))
    },
  }

  const result = await listPublicParticipants(database, {
    appId,
    userId: viewerUserId,
    eventId: '20000000-0000-4000-8000-000000000001',
    profileRefSecret: pepper,
  })

  assert.equal(result.items[0].heartRelation, 'RECEIVED')
  assert.equal(result.items[1].heartRelation, 'MUTUAL')
  assert.equal('heartRelation' in result.items[2], false)
  assert.equal('heartRelation' in result.items[3], false)
  assert.equal(JSON.stringify(result).includes('user_id'), false)
})

test('public participant list applies visible keyword, player filter, and a stable cursor on the server', async () => {
  const registeredAt = '2026-08-23T08:00:00.000Z'
  const registrationId = '30000000-0000-4000-8000-000000000003'
  const cursor = Buffer.from(JSON.stringify({ registeredAt, id: registrationId })).toString('base64url')
  let participantQuery
  const database = {
    async one() {
      return { id: '20000000-0000-4000-8000-000000000001' }
    },
    async query(sql, parameters) {
      participantQuery = { sql, parameters }
      return []
    },
  }

  await listPublicParticipants(database, {
    appId,
    userId: viewerUserId,
    eventId: '20000000-0000-4000-8000-000000000001',
    profileRefSecret: pepper,
    query: {
      keyword: '设计%_=',
      userKind: 'PLAYER',
      cursor,
      limit: 12,
    },
  })

  assert.match(participantQuery.sql, /JSON_EXTRACT\(p\.visibility_json, '\$\.nickname'\)/)
  assert.match(participantQuery.sql, /JSON_EXTRACT\(p\.visibility_json, '\$\.introduction'\)/)
  assert.match(participantQuery.sql, /search_tag\.kind = 'INDUSTRY'/)
  assert.match(participantQuery.sql, /AND EXISTS\(\s*SELECT 1 FROM mip_membership_entitlements/)
  assert.match(participantQuery.sql, /r\.registered_at < \? OR \(r\.registered_at = \? AND r\.id < \?\)/)
  assert.deepEqual(participantQuery.parameters.slice(-4), [registeredAt, registeredAt, registrationId, 13])
  assert.equal(participantQuery.parameters.filter(value => value === '%设计=%=_==%').length, 4)
})

test('public participant list rejects malformed filters and cursors', async () => {
  const database = {
    async one() {
      return { id: '20000000-0000-4000-8000-000000000001' }
    },
    async query() {
      throw new Error('query should not run')
    },
  }

  await assert.rejects(
    listPublicParticipants(database, {
      appId,
      eventId: '20000000-0000-4000-8000-000000000001',
      profileRefSecret: pepper,
      query: { userKind: 'ADMIN' },
    }),
    /参与人列表参数无效/,
  )
  await assert.rejects(
    listPublicParticipants(database, {
      appId,
      eventId: '20000000-0000-4000-8000-000000000001',
      profileRefSecret: pepper,
      query: { cursor: 'not-a-cursor' },
    }),
    /分页参数无效/,
  )
})
