'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  ACTIVE_REGISTRATION_STATUSES,
  listEventParticipants,
  previewEventParticipants,
  publicParticipant,
} = require('../domain/event-participants')

describe('event participant privacy contract', () => {
  it('returns only approved opt-in public profile fields', async () => {
    const calls = []
    const database = {
      async one(sql) {
        calls.push(sql)
        return { total: 3 }
      },
      async query(sql) {
        calls.push(sql)
        if (sql.includes('SELECT DISTINCT')) return [{ role_title: '产品经理' }]
        return [{
          id: '11111111-1111-4111-8111-111111111111',
          nickname: '林野',
          city: '上海',
          headline: '做小产品',
          bio: '喜欢城市徒步。',
          organization: '独立工作室',
          role_title: '产品经理',
          industry: '互联网',
          tags: '["产品","徒步"]',
          interests: '["城市"]',
          skills: '["设计"]',
          avatar_file_id: 'cloud://avatar',
          registered_at: '2026-07-28T08:00:00Z',
          user_id: 'must-not-leak',
          phone_number: '13800000000',
          ticket_code: 'SECRET',
        }]
      },
    }
    const result = await listEventParticipants(database, {
      appId: 'wx-app',
      eventId: '22222222-2222-4222-8222-222222222222',
      limit: 20,
    })
    assert.equal(result.items.length, 1)
    assert.equal(result.items[0].bio, '喜欢城市徒步。')
    for (const field of ['user_id', 'userId', 'phone_number', 'phoneNumber', 'ticket_code', 'ticketCode']) {
      assert.equal(Object.hasOwn(result.items[0], field), false)
    }
    const source = calls.join('\n')
    assert.match(source, /share_profile = 1/)
    assert.match(source, /p\.status = 'APPROVED'/)
    assert.deepEqual(ACTIVE_REGISTRATION_STATUSES, [
      'REGISTERED',
      'CANCELLATION_PENDING',
      'ATTENDED',
    ])
  })

  it('preview uses the same visibility gate', async () => {
    let captured = ''
    let capturedParams = []
    const rows = await previewEventParticipants({
      async query(sql, params) {
        captured = sql
        capturedParams = params
        return []
      },
    }, {
      appId: 'wx-app',
      eventId: '22222222-2222-4222-8222-222222222222',
      userId: 'current-user',
    })
    assert.deepEqual(rows, [])
    assert.match(captured, /share_profile = 1/)
    assert.match(captured, /p\.status = 'APPROVED'/)
    assert.match(captured, /member_blocks/)
    assert.match(captured, /LIMIT 5$/)
    assert.doesNotMatch(captured, /LIMIT \?/)
    assert.deepEqual(capturedParams.slice(-2), ['current-user', 'current-user'])
    assert.equal((captured.match(/\?/g) || []).length, capturedParams.length)
  })

  it('public mapper ignores private columns even if a query accidentally includes them', () => {
    const result = publicParticipant({
      id: '11111111-1111-4111-8111-111111111111',
      nickname: '成员',
      user_id: 'openid',
      phone_number: '13800000000',
      answer_snapshot: '{"secret":"x"}',
    })
    assert.equal(result.nickname, '成员')
    assert.equal(Object.hasOwn(result, 'user_id'), false)
    assert.equal(Object.hasOwn(result, 'phone_number'), false)
    assert.equal(Object.hasOwn(result, 'answer_snapshot'), false)
  })
})
