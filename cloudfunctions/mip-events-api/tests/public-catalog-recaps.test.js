'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { getEvent, listEvents } = require('../domain/event-service')

const eventId = '10000000-0000-4000-8000-000000000001'

function eventRow(overrides = {}) {
  return {
    id: eventId,
    app_id: 'wx-app-a',
    scope_type: 'PLATFORM',
    branch_id: null,
    organizer_user_id: null,
    title: '公开活动',
    summary: '活动摘要',
    description: '活动介绍',
    event_type_key: 'community',
    event_type_label: '社区活动',
    event_mode: 'OFFLINE',
    access_type: 'FREE',
    registration_policy: 'AUTO',
    status: 'PUBLISHED',
    public_status: 'PUBLISHED',
    starts_at: '2030-08-25T00:00:00.000Z',
    ends_at: '2030-08-25T02:00:00.000Z',
    registration_deadline: '2030-08-24T23:00:00.000Z',
    cancellation_deadline: '2030-08-24T12:00:00.000Z',
    price_cents: 0,
    currency: 'CNY',
    form_version: 1,
    registration_schema_json: '[]',
    capacity: 20,
    registration_count: 0,
    registration_status: null,
    registration_version: null,
    album_enabled: 0,
    album_submission_policy: 'REVIEW',
    ...overrides,
  }
}

function publicMetadataRows(sql) {
  if (sql.includes('mip_event_tag_assignments')) {
    return [
      { event_id: eventId, name: '创业' },
      { event_id: eventId, name: '线下' },
    ]
  }
  if (sql.includes('mip_event_video_recaps')) {
    return [
      {
        event_id: eventId,
        id: '20000000-0000-4000-8000-000000000001',
        title: '活动回顾',
        summary: '查看本次活动视频',
        destination_provider: 'WECHAT_CHANNELS',
        destination_kind: 'ACTIVITY',
        finder_user_name: 'sphMIP2026',
        feed_id: 'feed-token-1',
      },
      {
        event_id: eventId,
        id: '20000000-0000-4000-8000-000000000002',
        title: '无效记录',
        summary: '',
        destination_provider: 'WECHAT_CHANNELS',
        destination_kind: 'PROFILE',
        finder_user_name: 'invalid-finder',
        feed_id: null,
      },
    ]
  }
  return null
}

describe('MIP public event catalog and recap contract', () => {
  it('projects active catalog names, tags, and recaps in the public list without admin fields', async () => {
    const calls = []
    const db = {
      async query(sql, params) {
        calls.push({ sql, params })
        if (sql.includes('FROM mip_events e')) return [eventRow()]
        const metadata = publicMetadataRows(sql)
        if (metadata) return metadata
        if (sql.includes('SELECT DISTINCT city_name')) return []
        throw new Error(`unexpected query: ${sql}`)
      },
    }

    const result = await listEvents(db, {
      appId: 'wx-app-a',
      query: { view: 'UPCOMING', dateFilter: 'RECENT' },
      now: new Date('2030-08-20T00:00:00.000Z'),
      tokenSecret: '',
    })

    assert.equal(result.items[0].eventTypeLabel, '社区活动')
    assert.deepEqual(result.items[0].tags, ['创业', '线下'])
    assert.deepEqual(result.items[0].videoRecaps, [{
      id: '20000000-0000-4000-8000-000000000001',
      title: '活动回顾',
      summary: '查看本次活动视频',
      destination: {
        provider: 'WECHAT_CHANNELS',
        type: 'ACTIVITY',
        finderUserName: 'sphMIP2026',
        feedId: 'feed-token-1',
      },
    }])
    assert.deepEqual(Object.keys(result.items[0].videoRecaps[0]).sort(), [
      'destination',
      'id',
      'summary',
      'title',
    ])

    const eventQuery = calls.find(call => call.sql.includes('FROM mip_events e'))
    assert.match(eventQuery.sql, /public_event_type\.status = 'ACTIVE'/)
    const tagQuery = calls.find(call => call.sql.includes('mip_event_tag_assignments'))
    assert.match(tagQuery.sql, /assignment\.app_id = \?/)
    assert.match(tagQuery.sql, /assignment\.status = 'ACTIVE'/)
    assert.match(tagQuery.sql, /tag\.status = 'ACTIVE'/)
    assert.deepEqual(tagQuery.params, ['wx-app-a', eventId])
    const recapQuery = calls.find(call => call.sql.includes('mip_event_video_recaps'))
    assert.match(recapQuery.sql, /app_id = \?/)
    assert.match(recapQuery.sql, /status = 'ACTIVE'/)
    assert.deepEqual(recapQuery.params, ['wx-app-a', eventId])
  })

  it('uses the same active-only metadata projection for public detail', async () => {
    const calls = []
    const db = {
      async one(sql, params) {
        calls.push({ sql, params })
        return eventRow()
      },
      async query(sql, params) {
        calls.push({ sql, params })
        const metadata = publicMetadataRows(sql)
        if (metadata) return metadata
        if (sql.includes('mip_event_changes') || sql.includes('mip_event_content_media')) return []
        throw new Error(`unexpected query: ${sql}`)
      },
    }

    const result = await getEvent(db, {
      appId: 'wx-app-a',
      userId: null,
      eventId,
      now: new Date('2030-08-20T00:00:00.000Z'),
      tokenSecret: '',
      profileRefSecret: 'public-profile-ref-secret-more-than-thirty-two-characters',
    })

    assert.equal(result.eventTypeLabel, '社区活动')
    assert.deepEqual(result.tags, ['创业', '线下'])
    assert.equal(result.videoRecaps.length, 1)
    assert.equal('status' in result.videoRecaps[0], false)
    assert.equal('version' in result.videoRecaps[0], false)
    assert.equal('createdByUserId' in result.videoRecaps[0], false)
    const detailQuery = calls.find(call => call.sql.includes('FROM mip_events e'))
    assert.match(detailQuery.sql, /public_event_type\.app_id = e\.app_id/)
    assert.match(detailQuery.sql, /public_event_type\.status = 'ACTIVE'/)
  })

  it('bounds public metadata to the client contract limits', async () => {
    const calls = []
    const db = {
      async query(sql, params) {
        calls.push({ sql, params })
        if (sql.includes('FROM mip_events e')) return [eventRow()]
        if (sql.includes('mip_event_tag_assignments')) {
          return [{ event_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', name: '其他应用夹带标签' }, ...Array.from({ length: 105 }, (_, index) => ({
            event_id: eventId,
            name: `标签${index + 1}`,
          }))]
        }
        if (sql.includes('mip_event_video_recaps')) {
          return [{
            event_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
            id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
            title: '其他应用夹带回顾',
            summary: '',
            destination_provider: 'WECHAT_CHANNELS',
            destination_kind: 'PROFILE',
            finder_user_name: 'sphOtherApp',
            feed_id: null,
          }, ...Array.from({ length: 105 }, (_, index) => ({
            event_id: eventId,
            id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
            title: `活动回顾${index + 1}`,
            summary: '',
            destination_provider: 'WECHAT_CHANNELS',
            destination_kind: 'PROFILE',
            finder_user_name: 'sphMIP2026',
            feed_id: null,
          }))]
        }
        if (sql.includes('SELECT DISTINCT city_name')) return []
        throw new Error(`unexpected query: ${sql}`)
      },
    }

    const result = await listEvents(db, {
      appId: 'wx-app-a',
      query: { view: 'UPCOMING', dateFilter: 'RECENT' },
      now: new Date('2030-08-20T00:00:00.000Z'),
      tokenSecret: '',
    })

    assert.equal(result.items[0].tags.length, 100)
    assert.equal(result.items[0].videoRecaps.length, 100)
    assert.equal(result.items[0].tags.at(-1), '标签100')
    assert.equal(result.items[0].videoRecaps.at(-1).title, '活动回顾100')
    assert.equal(result.items[0].tags.includes('其他应用夹带标签'), false)
    assert.equal(result.items[0].videoRecaps.some(item => item.title === '其他应用夹带回顾'), false)

    const tagQuery = calls.find(call => call.sql.includes('mip_event_tag_assignments'))
    assert.match(tagQuery.sql, /ROW_NUMBER\(\) OVER/)
    assert.match(tagQuery.sql, /PARTITION BY assignment\.event_id/)
    assert.match(tagQuery.sql, /public_tag\.public_rank <= 100/)
    assert.deepEqual(tagQuery.params, ['wx-app-a', eventId])
    const recapQuery = calls.find(call => call.sql.includes('mip_event_video_recaps'))
    assert.match(recapQuery.sql, /ROW_NUMBER\(\) OVER/)
    assert.match(recapQuery.sql, /PARTITION BY event_id/)
    assert.match(recapQuery.sql, /public_recap\.public_rank <= 100/)
    assert.deepEqual(recapQuery.params, ['wx-app-a', eventId])
  })

  it('keeps registered DRAFT and UNPUBLISHED activities readable in list and detail contracts', async () => {
    for (const status of ['DRAFT', 'UNPUBLISHED']) {
      const db = {
        async one() {
          return eventRow({ status, public_status: status, registration_status: 'REGISTERED' })
        },
        async query(sql) {
          if (sql.includes('FROM mip_events e')) {
            return [eventRow({ status, public_status: status, registration_status: 'REGISTERED' })]
          }
          if (sql.includes('mip_event_changes')
            || sql.includes('mip_event_content_media')
            || sql.includes('mip_event_tag_assignments')
            || sql.includes('mip_event_video_recaps')
            || sql.includes('SELECT DISTINCT city_name')) {
            return []
          }
          throw new Error(`unexpected query: ${sql}`)
        },
      }

      const feed = await listEvents(db, {
        appId: 'wx-app-a',
        userId: 'viewer-user',
        query: { view: 'MINE', dateFilter: 'RECENT' },
        now: new Date('2030-08-20T00:00:00.000Z'),
        tokenSecret: '',
      })
      assert.equal(feed.items[0].status, status)

      const detail = await getEvent(db, {
        appId: 'wx-app-a',
        userId: 'viewer-user',
        eventId,
        now: new Date('2030-08-20T00:00:00.000Z'),
        tokenSecret: '',
        profileRefSecret: 'public-profile-ref-secret-more-than-thirty-two-characters',
      })
      assert.equal(detail.status, status)
    }
  })
})
