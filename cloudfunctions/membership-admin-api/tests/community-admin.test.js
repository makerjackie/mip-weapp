'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  listMemberReports,
  normalizeAnnouncement,
  resolveMemberReport,
  saveAnnouncement,
  setAnnouncementState,
} = require('../domain/community-admin')

const announcementId = '11111111-1111-4111-8111-111111111111'
const reportId = '22222222-2222-4222-8222-222222222222'

describe('community announcement operations', () => {
  it('validates content and visibility windows', () => {
    const result = normalizeAnnouncement({
      title: '社区公告',
      summary: '本周安排',
      body: '正文',
      visibleFrom: '2026-07-28T10:00:00Z',
      visibleUntil: '2026-07-29T10:00:00Z',
    })
    assert.equal(result.title, '社区公告')
    assert.throws(() => normalizeAnnouncement({
      title: '社区公告',
      summary: '摘要',
      body: '正文',
      visibleFrom: '2026-07-29T10:00:00Z',
      visibleUntil: '2026-07-28T10:00:00Z',
    }), /INVALID_ANNOUNCEMENT_WINDOW/)
  })

  it('creates a draft and audit record in one transaction', async () => {
    const statements = []
    const database = {
      async transaction(work) {
        return work({
          async query(sql, params) {
            statements.push({ sql, params })
            return { affectedRows: 1 }
          },
        })
      },
      async one() {
        return {
          id: announcementId,
          title: '公告',
          summary: '摘要',
          body: '正文',
          status: 'DRAFT',
          is_pinned: 0,
          version: 1,
        }
      },
    }
    const result = await saveAnnouncement(database, {
      appId: 'wx-app',
      actorId: 'owner',
      actorRole: 'owner',
      announcement: { title: '公告', summary: '摘要', body: '正文' },
    })
    assert.equal(result.status, 'DRAFT')
    assert.ok(statements.some(item => /INSERT INTO member_announcements/.test(item.sql)))
    assert.ok(statements.some(item => /ANNOUNCEMENT_CREATED/.test(item.sql)))
  })

  it('pins one published announcement and records the transition', async () => {
    const statements = []
    const database = {
      async transaction(work) {
        return work({
          async one() {
            return { status: 'PUBLISHED', is_pinned: 0, version: 3 }
          },
          async query(sql, params) {
            statements.push({ sql, params })
            return { affectedRows: 1 }
          },
        })
      },
      async one() {
        return {
          id: announcementId,
          title: '公告',
          summary: '摘要',
          body: '正文',
          status: 'PUBLISHED',
          is_pinned: 1,
          version: 4,
        }
      },
    }
    const result = await setAnnouncementState(database, {
      appId: 'wx-app',
      actorId: 'owner',
      actorRole: 'owner',
      announcementId,
      action: 'PIN',
      expectedVersion: 3,
    })
    assert.equal(result.isPinned, true)
    assert.ok(statements.some(item => /id <> \?/.test(item.sql)))
    assert.ok(statements.some(item => item.params?.includes('ANNOUNCEMENT_PINNED')))
  })

  it('republishes a withdrawn announcement and clears withdrawn time', async () => {
    const statements = []
    const database = {
      async transaction(work) {
        return work({
          async one() {
            return { status: 'WITHDRAWN', is_pinned: 0, version: 5 }
          },
          async query(sql, params) {
            statements.push({ sql, params })
            return { affectedRows: 1 }
          },
        })
      },
      async one() {
        return {
          id: announcementId,
          title: '公告',
          summary: '摘要',
          body: '正文',
          status: 'PUBLISHED',
          is_pinned: 0,
          version: 6,
        }
      },
    }
    const result = await setAnnouncementState(database, {
      appId: 'wx-app',
      actorId: 'owner',
      actorRole: 'owner',
      announcementId,
      action: 'PUBLISH',
      expectedVersion: 5,
    })
    assert.equal(result.status, 'PUBLISHED')
    const update = statements.find(item => /SET status = \?/.test(item.sql))
    assert.match(update.sql, /WHEN \? = 'PUBLISH' THEN NULL/)
    assert.equal(update.params.filter(value => value === 'PUBLISH').length, 3)
    assert.ok(statements.some(item => item.params?.includes('ANNOUNCEMENT_PUBLISHED')))
  })
})

describe('member report operations', () => {
  it('does not expose reporter identity in the operator DTO', async () => {
    const rows = await listMemberReports({
      async query() {
        return [{
          id: reportId,
          target_member_id: '33333333-3333-4333-8333-333333333333',
          target_nickname: '成员',
          target_avatar_url: 'cloud://avatar',
          reporter_user_id: 'must-not-leak',
          target_user_id: 'must-not-leak',
          category: 'SPAM',
          description: '广告',
          status: 'PENDING',
          prior_report_count: 2,
          version: 1,
          created_at: '2026-07-28T10:00:00Z',
        }]
      },
    }, { appId: 'wx-app', status: 'PENDING' })
    assert.equal(rows[0].priorReportCount, 2)
    assert.equal(Object.hasOwn(rows[0], 'reporter_user_id'), false)
    assert.equal(Object.hasOwn(rows[0], 'target_user_id'), false)
  })

  it('hides a reported profile and audits the reason atomically', async () => {
    const statements = []
    const result = await resolveMemberReport({
      async transaction(work) {
        return work({
          async one() {
            return {
              id: reportId,
              target_user_id: 'target-user',
              status: 'PENDING',
              version: 1,
            }
          },
          async query(sql, params) {
            statements.push({ sql, params })
            return { affectedRows: 1 }
          },
        })
      },
    }, {
      appId: 'wx-app',
      actorId: 'owner',
      actorRole: 'owner',
      reportId,
      decision: 'HIDE_PROFILE',
      reason: '确认存在骚扰',
      expectedVersion: 1,
    })
    assert.equal(result.status, 'RESOLVED')
    assert.equal(result.resolutionAction, 'HIDE_PROFILE')
    assert.ok(statements.some(item => /status = 'SUSPENDED'/.test(item.sql)))
    assert.ok(statements.some(item => /MEMBER_REPORT_RESOLVED/.test(item.sql)))
  })
})
