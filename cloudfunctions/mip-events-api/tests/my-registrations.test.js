'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  canCancelRegistration,
  canRetryRegistrationRefund,
  listMyRegistrations,
} = require('../domain/event-service')

function eventRow(overrides = {}) {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    scope_type: 'PLATFORM',
    branch_id: null,
    branch_name: null,
    title: '服务端活动',
    summary: '活动摘要',
    cover_file_id: 'cloud://env.test/event.jpg',
    event_type_label: '交流活动',
    event_type_key: 'MEETUP',
    event_mode: 'OFFLINE',
    access_type: 'PAID',
    starts_at: '2026-09-10T10:00:00.000Z',
    ends_at: '2026-09-10T12:00:00.000Z',
    city_name: '深圳',
    venue_name: 'MIP 空间',
    address: '南山区示例路 1 号',
    public_status: 'PUBLISHED',
    capacity: 100,
    registration_count: 12,
    registration_status: 'REGISTERED',
    album_enabled: 1,
    cancellation_deadline: '2026-09-09T10:00:00.000Z',
    registration_deadline: '2026-09-09T08:00:00.000Z',
    registration_id: '20000000-0000-4000-8000-000000000001',
    registration_version: 4,
    registration_updated_at: '2026-08-25T00:00:00.000Z',
    order_id: '30000000-0000-4000-8000-000000000001',
    checked_in_at: null,
    ...overrides,
  }
}

describe('my event registrations', () => {
  it('filters each tab on the server and returns authoritative counts and cancellation facts', async () => {
    let listSql = ''
    let countQuery
    const metadataCalls = []
    const db = {
      async query(sql, params) {
        if (sql.includes('FROM mip_event_registrations r')) {
          listSql = sql
          return [eventRow()]
        }
        if (sql.includes('mip_event_tag_assignments')) {
          metadataCalls.push({ sql, params })
          return [{ event_id: eventRow().id, name: '线下' }]
        }
        if (sql.includes('mip_event_video_recaps')) {
          metadataCalls.push({ sql, params })
          return [{
            event_id: eventRow().id,
            id: '40000000-0000-4000-8000-000000000001',
            title: '活动回顾',
            summary: '',
            destination_provider: 'WECHAT_CHANNELS',
            destination_kind: 'PROFILE',
            finder_user_name: 'sphMIP2026',
            feed_id: null,
          }]
        }
        throw new Error(`unexpected query: ${sql}`)
      },
      async one(sql, params) {
        if (sql.includes('AS upcoming_count')) {
          countQuery = { sql, params }
          return { upcoming_count: 2, attended_count: 5 }
        }
        return { value_json: JSON.stringify({ cancellationHoursBeforeStart: 24 }) }
      },
    }
    const page = await listMyRegistrations(db, {
      appId: 'wx-app',
      userId: 'user-1',
      category: 'UPCOMING',
      tokenSecret: '',
      now: new Date('2026-08-25T00:00:00.000Z'),
    })

    assert.match(listSql, /r\.status IN \('PENDING_REVIEW','WAITLISTED','PAYMENT_PENDING','REGISTERED','CANCELLATION_PENDING'\)/)
    assert.match(listSql, /e\.ends_at > \?/)
    assert.match(listSql, /public_event_type\.app_id = e\.app_id/)
    assert.match(listSql, /public_event_type\.status = 'ACTIVE'/)
    assert.match(countQuery.sql, /event_row\.ends_at > \?/)
    assert.deepEqual(countQuery.params, [new Date('2026-08-25T00:00:00.000Z'), new Date('2026-08-25T00:00:00.000Z'), 'wx-app', 'user-1'])
    assert.deepEqual(page.counts, { upcoming: 2, attended: 5, history: 0 })
    assert.deepEqual(page.items[0], {
      registrationId: '20000000-0000-4000-8000-000000000001',
      version: 4,
      event: {
        id: '10000000-0000-4000-8000-000000000001',
        scopeType: 'PLATFORM',
        branchId: undefined,
        branchName: undefined,
        title: '服务端活动',
        summary: '活动摘要',
        coverUrl: 'cloud://env.test/event.jpg',
        eventTypeLabel: '交流活动',
        tags: ['线下'],
        videoRecaps: [{
          id: '40000000-0000-4000-8000-000000000001',
          title: '活动回顾',
          summary: '',
          destination: {
            provider: 'WECHAT_CHANNELS',
            type: 'PROFILE',
            finderUserName: 'sphMIP2026',
            feedId: null,
          },
        }],
        mode: 'OFFLINE',
        accessType: 'PAID',
        startsAt: '2026-09-10T10:00:00.000Z',
        endsAt: '2026-09-10T12:00:00.000Z',
        cityName: '深圳',
        venueName: 'MIP 空间',
        status: 'PUBLISHED',
        capacity: 100,
        registrationCount: 12,
        participantPreview: [],
        registrationStatus: 'REGISTERED',
        albumEnabled: true,
      },
      status: 'REGISTERED',
      orderId: '30000000-0000-4000-8000-000000000001',
      checkedInAt: undefined,
      venueAddress: '南山区示例路 1 号',
      updatedAt: '2026-08-25T00:00:00.000Z',
      canEdit: true,
      canCancel: true,
      canRetryRefund: false,
    })
    assert.deepEqual(metadataCalls.map(call => call.params), [
      ['wx-app', eventRow().id],
      ['wx-app', eventRow().id],
    ])
  })

  it('projects retry only for an active non-manual cancellation refund', () => {
    const pending = eventRow({
      registration_status: 'CANCELLATION_PENDING',
      order_status: 'REFUND_PENDING',
      refund_status: 'PENDING',
      refund_last_error_code: null,
    })
    assert.equal(canRetryRegistrationRefund(pending), true)
    assert.equal(canRetryRegistrationRefund({
      ...pending,
      refund_status: 'PROCESSING',
      refund_last_error_code: 'MANUAL_REVIEW_CHANGE',
    }), false)
    assert.equal(canRetryRegistrationRefund({ ...pending, order_status: 'PAID' }), false)
    assert.equal(canRetryRegistrationRefund({ ...pending, refund_status: 'FAILED' }), false)
  })

  it('uses the same cancellation status and deadline rules as the mutation', () => {
    const row = eventRow({ cancellation_deadline: null })
    assert.equal(canCancelRegistration(row, 'REGISTERED', new Date('2026-09-09T09:59:59.000Z'), 24), true)
    assert.equal(canCancelRegistration(row, 'REGISTERED', new Date('2026-09-09T10:00:00.000Z'), 24), false)
    assert.equal(canCancelRegistration(row, 'CANCELLATION_PENDING', new Date('2026-08-25T00:00:00.000Z'), 24), false)
    assert.equal(canCancelRegistration(row, 'ATTENDED', new Date('2026-08-25T00:00:00.000Z'), 24), false)
  })

  it('includes ended, cancelled and rejected registrations in history without duplicating attended', async () => {
    let listQuery
    const now = new Date('2026-09-05T00:00:00Z')
    const db = {
      async query(sql, params) {
        if (sql.includes('FROM mip_event_registrations r')) listQuery = { sql, params }
        return []
      },
      async one(sql) {
        return sql.includes('AS upcoming_count') ? { history_count: 3 } : null
      },
    }
    const page = await listMyRegistrations(db, { appId: 'app', userId: 'user', category: 'HISTORY', now })
    assert.match(listQuery.sql, /r.status <> 'ATTENDED'/)
    assert.match(listQuery.sql, /r.status IN \('CANCELLED','REJECTED'\)/)
    assert.match(listQuery.sql, /e.ends_at <= \?/)
    assert.match(listQuery.sql, /e.status <> 'PUBLISHED'/)
    assert.deepEqual(listQuery.params.slice(0, 5), [now, 'user', 'app', 'user', now])
    assert.equal(page.counts.history, 3)
  })

  it('rejects unsupported client categories' , async () => {
    await assert.rejects(
      () => listMyRegistrations({}, {
        appId: 'wx-app',
        userId: 'user-1',
        category: 'CANCELLED',
      }),
      error => error?.code === 'VALIDATION_FAILED',
    )
  })
})
