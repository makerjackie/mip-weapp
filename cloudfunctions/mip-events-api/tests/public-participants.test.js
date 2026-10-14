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
      // 差异报告 C1：胶囊计数查询与主列表查询共用 mock，按 GROUP BY is_player 分流。
      if (sql.includes('GROUP BY is_player')) {
        assert.match(sql, /r\.share_profile = 1/)
        assert.match(sql, /mip_membership_entitlements/)
        assert.doesNotMatch(sql, /JSON_EXTRACT/)
        assert.deepEqual(parameters, [appId, '20000000-0000-4000-8000-000000000001', viewerUserId, viewerUserId])
        return [{ is_player: 1, total: 2 }, { is_player: 0, total: 1 }]
      }
      // MIW-73：嘉宾卡同构补齐（公开详情/等级/勋章/邀请人）批量查询，按表名分流。
      if (sql.includes('FROM mip_profiles profile')) {
        return [{
          user_id: userId,
          visibility_json: '{}',
          identity_status: '设计师',
          introduction: '设计十年',
          city_name: '深圳',
          experience_balance: 120,
          industry_label: '视觉设计',
        }]
      }
      if (sql.includes('FROM mip_growth_levels')) {
        // MIW-104：lvNN key → 业务等级号。
        return [
          { id: 'level-1', level_key: 'lv01', display_badge: 'Lv.1', name: '新手', minimum_experience: 0, status: 'ACTIVE' },
          { id: 'level-2', level_key: 'lv03', display_badge: 'Lv.3', name: '进阶', minimum_experience: 100, status: 'ACTIVE' },
        ]
      }
      if (sql.includes('mip_user_badge_equipment')) {
        return [{ user_id: userId, slot_no: 1, id: 'badge-1', name: '金徽', image_url: 'cloud://badge' }]
      }
      if (sql.includes('mip_event_invitation_attributions')) {
        return [{
          guest_user_id: userId,
          invitation_source_type: 'USER',
          inviter_nickname: '邀请人甲',
          inviter_visibility_json: '{}',
          inviter_avatar_file_id: 'cloud://inviter',
        }]
      }
      assert.match(sql, /r\.share_profile = 1/)
      assert.match(sql, /r\.status IN \('REGISTERED', 'ATTENDED'\)/)
      assert.match(sql, /FROM mip_user_blocks visibility_block/)
      assert.match(sql, /visibility_block\.app_id = r\.app_id/)
      assert.match(sql, /blocker_user_id = \? AND visibility_block\.blocked_user_id = r\.user_id/)
      assert.match(sql, /blocker_user_id = r\.user_id AND visibility_block\.blocked_user_id = \?/)
      assert.match(sql, /ORDER BY r\.registered_at DESC, r\.id DESC/)
      assert.match(sql, /r\.id AS registration_id/)
      // MIW-96：名单 SQL 不再 JOIN mip_event_hearts 计算 heart_relation 死载荷。
      assert.doesNotMatch(sql, /mip_event_hearts|heart_relation/i)
      assert.doesNotMatch(sql, /answers_json|phone_ciphertext|ticket_hash|identity_key/i)
      assert.deepEqual(parameters, [
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
  // MIW-73：名单条目补齐嘉宾卡同构字段（城市/行业/身份/介绍/等级/勋章/邀请人）。
  assert.deepEqual(Object.keys(result.items[0]).sort(), [
    'avatarUrl',
    'badges',
    'cityName',
    'headline',
    'identityStatus',
    'industryLabel',
    'introduction',
    'inviter',
    'level',
    'nickname',
    'primaryBranch',
    'profileRef',
    'userKind',
  ])
  // HR-01（MIW-96）：契约负向断言——响应不再下发 heart_relation。
  assert.equal(result.items[0].heartRelation, undefined)
  assert.equal(result.items[0].cityName, '深圳')
  assert.equal(result.items[0].industryLabel, '视觉设计')
  assert.equal(result.items[0].identityStatus, '设计师')
  assert.equal(result.items[0].introduction, '设计十年')
  assert.deepEqual(result.items[0].level, { number: 3, name: '进阶' })
  assert.deepEqual(result.items[0].badges, [{ id: 'badge-1', name: '金徽', imageUrl: 'cloud://badge' }])
  assert.deepEqual(result.items[0].inviter, { sourceType: 'USER', displayName: '邀请人甲', avatarUrl: 'cloud://inviter' })
  assert.deepEqual(result.kindTotals, { PLAYER: 2, GUEST: 1 })
  const serialized = JSON.stringify(result)
  assert.equal(serialized.includes(userId), false)
  assert.equal(serialized.includes('heartRelation'), false)
  assert.doesNotMatch(serialized, /answers|ticket|phone|openid/i)
})

// MIW-85 INVITER-02：玩家（ACTIVE 会员）参与人卡不下发邀请人——曾有历史归档也不显示。
// stub 模拟门控后真实库回空，同时锁归档 SQL 的门控/tie-break 形状防回退。
test('player participants carry no inviter annotation even with past invitation archives', async () => {
  let inviterSql = ''
  const database = {
    async one() {
      return { id: '20000000-0000-4000-8000-000000000001' }
    },
    async query(sql) {
      if (sql.includes('GROUP BY is_player')) return [{ is_player: 0, total: 1 }]
      if (sql.includes('FROM mip_profiles profile') || sql.includes('FROM mip_growth_levels') || sql.includes('mip_user_badge_equipment')) return []
      if (sql.includes('mip_event_invitation_attributions')) {
        inviterSql = sql
        return []
      }
      return [{
        user_id: userId,
        nickname: '玩家参与人',
        visibility_json: '{}',
        is_player: 1,
      }]
    },
  }
  const result = await listPublicParticipants(database, {
    appId,
    userId: viewerUserId,
    eventId: '20000000-0000-4000-8000-000000000001',
    profileRefSecret: pepper,
  })
  assert.match(inviterSql, /NOT EXISTS \(\s*SELECT 1 FROM mip_membership_entitlements membership/)
  assert.match(inviterSql, /membership\.status = 'ACTIVE'\s+AND membership\.starts_at <= UTC_TIMESTAMP\(3\)\s+AND membership\.ends_at > UTC_TIMESTAMP\(3\)/)
  assert.match(inviterSql, /ORDER BY attribution\.captured_at DESC, attribution\.registration_id DESC/)
  assert.equal(result.items.length, 1)
  assert.equal('inviter' in result.items[0], false)
})

test('anonymous public participant list keeps the original public range', async () => {
  let participantSql = ''
  const database = {
    async one() {
      return { id: '20000000-0000-4000-8000-000000000001' }
    },
    async query(sql) {
      if (sql.includes('GROUP BY is_player')) return []
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
      if (sql.includes('GROUP BY is_player')) return []
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
