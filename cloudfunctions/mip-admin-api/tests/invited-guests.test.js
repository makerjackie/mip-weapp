'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createProfileRecordsRepository } = require('../domain/repositories/profile-records')

const inviterUserId = '20000000-0000-4000-8000-000000000001'
const guestUserId = '30000000-0000-4000-8000-000000000001'

describe('invited guests list', () => {
  it('merges event and membership invitation relationships into one timeline', async () => {
    const calls = []
    const repository = createProfileRecordsRepository({
      async query(sql, params) {
        calls.push({ sql, params })
        return [
          {
            source: 'EVENT',
            id: '40000000-0000-4000-8000-000000000001',
            user_id: guestUserId,
            captured_at: '2026-08-24 10:00:00.000',
            event_id: '50000000-0000-4000-8000-000000000001',
            primary_branch_id: null,
            user_status: 'ACTIVE',
            nickname: '受邀嘉宾',
            event_title: '八月交流会',
            registration_status: 'REGISTERED',
            is_player: 0,
          },
          {
            source: 'MEMBERSHIP',
            id: guestUserId,
            user_id: guestUserId,
            captured_at: '2026-08-20 09:00:00.000',
            event_id: null,
            primary_branch_id: null,
            user_status: 'ACTIVE',
            nickname: '受邀嘉宾',
            event_title: null,
            registration_status: null,
            is_player: 0,
          },
        ]
      },
    })
    const page = await repository.listInvitedGuests('app-1', inviterUserId, { limit: 20 })
    assert.equal(page.items.length, 2)
    assert.deepEqual(page.items.map(item => item.source), ['EVENT', 'MEMBERSHIP'])
    assert.deepEqual(page.items.map(item => item.kind), ['GUEST', 'GUEST'])
    assert.equal(page.items[0].eventTitle, '八月交流会')
    assert.equal(page.items[1].eventId, null)
    assert.equal(page.items[1].registrationStatus, null)
    assert.equal(page.nextCursor, null)

    const sql = calls[0].sql
    assert.match(sql, /mip_event_invitation_attributions/)
    assert.match(sql, /mip_membership_invitation_guests/)
    assert.match(sql, /UNION ALL/)
    // 活动邀请与会员邀请各自按邀请人过滤；游标统一按 captured_at + id。
    assert.deepEqual(calls[0].params.slice(0, 4), ['app-1', inviterUserId, 'app-1', inviterUserId])
    assert.match(sql, /ORDER BY a\.captured_at DESC, a\.id DESC/)
  })

  it('returns an exhausted page when the inviter has no recorded relationships', async () => {
    const repository = createProfileRecordsRepository({
      async query() {
        return []
      },
    })
    const page = await repository.listInvitedGuests('app-1', inviterUserId, { limit: 20 })
    assert.deepEqual(page.items, [])
    assert.equal(page.nextCursor, null)
  })
})
