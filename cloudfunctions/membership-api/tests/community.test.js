'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  createMemberReport,
  getAnnouncement,
  listAnnouncements,
  normalizeReport,
  setMemberBlock,
} = require('../domain/community')

const memberId = '11111111-1111-4111-8111-111111111111'

describe('community announcements', () => {
  it('returns only published announcements inside their visibility window', async () => {
    let sql = ''
    let params = []
    const result = await listAnnouncements({
      async query(statement, values) {
        sql = statement
        params = values
        return [{
          id: '22222222-2222-4222-8222-222222222222',
          title: '本周活动',
          summary: '周六见',
          is_pinned: 1,
          published_at: '2026-07-28T10:00:00Z',
          created_by: 'must-not-leak',
        }]
      },
    }, { appId: 'wx-app', limit: 999 })

    assert.equal(result[0].isPinned, true)
    assert.equal(Object.hasOwn(result[0], 'created_by'), false)
    assert.match(sql, /status = 'PUBLISHED'/)
    assert.match(sql, /visible_from IS NULL OR visible_from <= UTC_TIMESTAMP/)
    assert.match(sql, /visible_until IS NULL OR visible_until > UTC_TIMESTAMP/)
    assert.match(sql, /LIMIT 50$/)
    assert.deepEqual(params, ['wx-app'])
  })

  it('scopes detail reads by app and public state', async () => {
    let sql = ''
    const result = await getAnnouncement({
      async one(statement) {
        sql = statement
        return {
          id: '22222222-2222-4222-8222-222222222222',
          title: '更新',
          summary: '摘要',
          body: '正文',
          is_pinned: 0,
          published_at: '2026-07-28T10:00:00Z',
        }
      },
    }, {
      appId: 'wx-app',
      announcementId: '22222222-2222-4222-8222-222222222222',
    })
    assert.equal(result.body, '正文')
    assert.match(sql, /app_id = \? AND id = \? AND status = 'PUBLISHED'/)
  })
})

describe('community member safety', () => {
  it('blocks reversibly and removes both follow directions atomically', async () => {
    const statements = []
    const database = {
      async one() {
        return {
          id: memberId,
          user_id: 'target-user',
          nickname: '成员',
        }
      },
      async transaction(work) {
        return work({
          async query(sql, params) {
            statements.push({ sql, params })
            return { affectedRows: 1 }
          },
        })
      },
    }
    const result = await setMemberBlock(database, {
      appId: 'wx-app',
      userId: 'current-user',
      memberId,
      blocked: true,
    })
    assert.deepEqual(result, { memberId, blocked: true })
    assert.ok(statements.some(item => /INSERT IGNORE INTO member_blocks/.test(item.sql)))
    assert.ok(statements.some(item => /DELETE FROM member_follows/.test(item.sql)))
    assert.ok(statements.some(item => item.params?.includes('MEMBER_BLOCKED')))
  })

  it('allows unblocking a suspended non-deleted profile', async () => {
    let targetSql = ''
    const statements = []
    const database = {
      async one(sql) {
        targetSql = sql
        return {
          id: memberId,
          user_id: 'target-user',
          nickname: '成员',
        }
      },
      async transaction(work) {
        return work({
          async query(sql, params) {
            statements.push({ sql, params })
            return { affectedRows: 1 }
          },
        })
      },
    }
    const result = await setMemberBlock(database, {
      appId: 'wx-app',
      userId: 'current-user',
      memberId,
      blocked: false,
    })
    assert.deepEqual(result, { memberId, blocked: false })
    assert.match(targetSql, /status <> 'DELETED'/)
    assert.ok(statements.some(item => /DELETE FROM member_blocks/.test(item.sql)))
    assert.ok(statements.some(item => item.params?.includes('MEMBER_UNBLOCKED')))
  })

  it('validates reports and makes retries idempotent without leaking identities', async () => {
    assert.throws(() => normalizeReport({
      category: 'UNKNOWN',
      idempotencyKey: '1234567890123456',
    }), /REPORT_CATEGORY_INVALID/)

    let inserted = 0
    const database = {
      async one(sql) {
        if (/FROM member_profiles/.test(sql)) {
          return { id: memberId, user_id: 'target-user', nickname: '成员' }
        }
        return {
          id: '33333333-3333-4333-8333-333333333333',
          target_user_id: 'target-user',
          category: 'SPAM',
          description: '重复广告',
          status: 'PENDING',
        }
      },
      async query() {
        inserted += 1
        return { affectedRows: inserted === 1 ? 1 : 0 }
      },
    }
    const input = {
      appId: 'wx-app',
      userId: 'current-user',
      memberId,
      category: 'SPAM',
      description: '重复广告',
      idempotencyKey: 'report-1234567890',
    }
    const first = await createMemberReport(database, input)
    const retry = await createMemberReport(database, input)
    assert.equal(first.idempotent, false)
    assert.equal(retry.idempotent, true)
    for (const field of ['target_user_id', 'reporter_user_id', 'userId']) {
      assert.equal(Object.hasOwn(first, field), false)
    }
  })
})
