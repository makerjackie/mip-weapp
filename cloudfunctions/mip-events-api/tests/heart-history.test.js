'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { listHeartHistory, markHeartHistoryRead } = require('../domain/event-service')

const appId = 'wx-mip-app'
const userId = '11111111-1111-4111-8111-111111111111'
const otherUserId = '22222222-2222-4222-8222-222222222222'
const profileRefSecret = 'profile-reference-secret-more-than-thirty-two-characters'

// MIW-52：列表按人聚合（产品口径：同一个人多点几次心动累计展示，最新互动排最前）。
function heartRow(overrides = {}) {
  return {
    person_user_id: otherUserId,
    heart_count: 2,
    last_at: '2026-08-24T10:00:00.000Z',
    person_unread_count: 0,
    nickname: '同行者',
    headline: '品牌设计',
    avatar_file_id: 'cloud://mip/avatar.png',
    visibility_json: {},
    ...overrides,
  }
}

describe('MIP heart history', () => {
  it('returns only the caller sent records with opaque public profile references', async () => {
    const calls = []
    const rows = [
      heartRow(),
      heartRow({ person_user_id: otherUserId, last_at: '2026-08-24T09:00:00.000Z' }),
    ]
    const database = {
      async one() { return { total_count: 2, unread_count: 1, read_through_at: '2026-09-22T09:00:00.000Z' } },
      async query(sql, params) {
        calls.push({ sql, params })
        return rows
      },
    }
    const result = await listHeartHistory(database, {
      appId,
      userId,
      kind: 'SENT',
      limit: 1,
      profileRefSecret,
    })
    assert.match(calls[0].sql, /h\.voter_user_id = \? AND h\.status = 'ACTIVE'/)
    assert.match(calls[0].sql, /p\.user_id = h\.target_user_id/)
    assert.match(calls[0].sql, /COUNT\(\*\) AS heart_count/)
    assert.match(calls[0].sql, /GROUP BY h\.target_user_id/)
    assert.deepEqual(calls[0].params.slice(0, 2), [appId, userId])
    assert.equal(result.items.length, 1)
    assert.equal(result.items[0].person.nickname, '同行者')
    assert.equal(result.items[0].person.heartCount, 2)
    assert.match(result.items[0].person.profileRef, /^p1\./)
    assert.equal(JSON.stringify(result).includes(otherUserId), false)
    assert.ok(result.nextCursor)
    assert.equal(result.unreadCount, 0)
  })

  it('uses the target side for received records and rejects unknown kinds', async () => {
    let sql = ''
    const database = {
      async one() { return { total_count: 2, unread_count: 1, read_through_at: '2026-09-22T09:00:00.000Z' } },
      async query(statement) {
        // MIW-52 后列表还会追加 person 详情/邀请人查询，主查询按表名识别。
        if (!sql && /FROM mip_event_hearts/.test(statement)) {
          sql = statement
        }
        return [heartRow()]
      },
    }
    const result = await listHeartHistory(database, {
      appId,
      userId,
      kind: 'RECEIVED',
      profileRefSecret,
    })
    assert.match(sql, /h\.target_user_id = \? AND h\.status = 'ACTIVE'/)
    assert.match(sql, /p\.user_id = h\.voter_user_id/)
    assert.equal(result.kind, 'RECEIVED')
    assert.equal(result.totalCount, 2)
    assert.equal(result.unreadCount, 1)
    assert.equal(result.readThroughAt, '2026-09-22T09:00:00.000Z')
    await assert.rejects(
      listHeartHistory(database, {
        appId,
        userId,
        kind: 'UNKNOWN',
        profileRefSecret,
      }),
      error => error.code === 'VALIDATION_FAILED',
    )
  })

  it('marks unread people on the received side only', async () => {
    const database = {
      async one() { return { total_count: 1, unread_count: 1, read_through_at: '2026-09-22T09:00:00.000Z' } },
      async query(sql) {
        if (/FROM mip_event_hearts/.test(sql)) {
          return [heartRow({ person_unread_count: 2 })]
        }
        return []
      },
    }
    const received = await listHeartHistory(database, { appId, userId, kind: 'RECEIVED', profileRefSecret })
    assert.equal(received.items[0].person.unread, true)
    const sent = await listHeartHistory(database, { appId, userId, kind: 'SENT', profileRefSecret })
    assert.equal(sent.items[0].person.unread, undefined)
  })

  it('redacts hidden person fields while retaining a usable opaque profile reference', async () => {
    const database = {
      async one() { return { total_count: 1, unread_count: 1, read_through_at: '2026-09-22T10:00:00.000Z' } },
      async query() { return [heartRow({
        visibility_json: JSON.stringify({ nickname: false, avatar: false, headline: false }),
      })] },
    }
    const page = await listHeartHistory(database, { appId, userId, kind: 'RECEIVED', profileRefSecret })
    assert.deepEqual(page.items[0].person, {
      profileRef: page.items[0].person.profileRef, nickname: 'MIP 用户', avatarUrl: undefined, headline: undefined,
      heartCount: 2,
    })
    assert.equal(JSON.stringify(page).includes(otherUserId), false)
  })

  // MIW-52 统一竖版用户卡：心动值 person 补公开详情（城市/行业/身份/等级/勋章）与邀请人标注。
  it('enriches heart people with public details and a USER inviter attribution', async () => {
    const rows = [heartRow()]
    const database = {
      async one() { return { total_count: 1, unread_count: 0, read_through_at: '2026-09-22T09:00:00.000Z' } },
      async query(sql) {
        if (/FROM mip_event_hearts/.test(sql)) {
          return rows
        }
        if (/mip_user_badge_equipment/.test(sql)) {
          return [{ user_id: otherUserId, slot_no: 1, id: 'badge-1', badge_key: 'host', name: '主理人', description: '', icon_name: '', image_url: 'https://cdn/badge.png', placeholder_shape: '' }]
        }
        if (/FROM mip_growth_levels/.test(sql)) {
          return [
            { id: 'lv1', name: '初识', minimum_experience: 0, status: 'ACTIVE' },
            { id: 'lv2', name: '同行', minimum_experience: 100, status: 'ACTIVE' },
          ]
        }
        if (/FROM mip_profiles profile/.test(sql)) {
          return [{
            user_id: otherUserId,
            visibility_json: {},
            identity_status: '品牌主理人',
            introduction: '做智能硬件出海',
            city_name: '广州',
            experience_balance: 100,
            industry_label: '智能硬件',
          }]
        }
        if (/mip_event_invitation_attributions/.test(sql)) {
          return [{
            guest_user_id: otherUserId,
            invitation_source_type: 'USER',
            inviter_nickname: '李慕白',
            inviter_visibility_json: {},
            inviter_avatar_file_id: 'cloud://mip/inviter.png',
          }]
        }
        return []
      },
    }
    const result = await listHeartHistory(database, { appId, userId, kind: 'RECEIVED', profileRefSecret })
    const person = result.items[0].person
    assert.equal(person.cityName, '广州')
    assert.equal(person.industryLabel, '智能硬件')
    assert.equal(person.identityStatus, '品牌主理人')
    assert.deepEqual(person.level, { number: 2, name: '同行' })
    assert.deepEqual(person.badges, [{ id: 'badge-1', name: '主理人', imageUrl: 'https://cdn/badge.png' }])
    assert.deepEqual(person.inviter, { sourceType: 'USER', displayName: '李慕白', avatarUrl: 'cloud://mip/inviter.png' })
    assert.equal(JSON.stringify(result).includes(otherUserId), false)
  })

  it('falls back to the platform inviter and omits fields without source data', async () => {
    const database = {
      async one() { return { total_count: 1, unread_count: 0, read_through_at: '2026-09-22T09:00:00.000Z' } },
      async query(sql) {
        if (/FROM mip_event_hearts/.test(sql)) {
          return [heartRow()]
        }
        if (/mip_event_invitation_attributions/.test(sql)) {
          return [{
            guest_user_id: otherUserId,
            invitation_source_type: 'PLATFORM',
            inviter_nickname: '',
            inviter_visibility_json: {},
            inviter_avatar_file_id: '',
          }]
        }
        return []
      },
    }
    const result = await listHeartHistory(database, { appId, userId, kind: 'SENT', profileRefSecret })
    const person = result.items[0].person
    assert.deepEqual(person.inviter, { sourceType: 'PLATFORM', displayName: 'MIP 平台' })
    assert.equal(person.cityName, undefined)
    assert.equal(person.level, undefined)
    assert.equal(person.badges, undefined)
  })

  it('marks only received hearts through the load watermark without changing relationship time', async () => {
    const calls = []
    const tx = {
      async one() { return { id: userId, status: 'ACTIVE' } },
      async query(sql, params) { calls.push({ sql, params }); return { affectedRows: 1 } },
    }
    const result = await markHeartHistoryRead({ transaction: work => work(tx) }, {
      appId, userId, readThroughAt: '2026-09-22T10:00:00.000Z',
    })
    assert.equal(result.readAt, '2026-09-22T10:00:00.000Z')
    assert.match(calls[0].sql, /target_user_id = \? AND status = 'ACTIVE'/)
    assert.match(calls[0].sql, /updated_at = updated_at/)
    assert.match(calls[0].sql, /updated_at <= LEAST\(\?, UTC_TIMESTAMP\(3\)\)/)
    assert.deepEqual(calls[0].params.slice(0, 2), [appId, userId])
    await assert.rejects(() => markHeartHistoryRead({}, { appId, userId, readThroughAt: 'invalid' }), /阅读时间无效/)
  })
})
