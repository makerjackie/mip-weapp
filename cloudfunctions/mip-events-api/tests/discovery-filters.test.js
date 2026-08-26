'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  getEventDiscoveryFilters,
  listEvents,
} = require('../domain/event-service')

const eventId = '11111111-1111-4111-8111-111111111111'

function eventRow(overrides = {}) {
  return {
    id: eventId,
    scope_type: 'PLATFORM',
    title: '长期活动',
    summary: '活动摘要',
    event_type_key: 'workshop',
    event_type_label: '共创工作坊',
    event_mode: 'OFFLINE',
    access_type: 'MEMBER_INCLUDED',
    starts_at: '2030-11-16T01:30:00.000Z',
    ends_at: '2030-11-16T10:00:00.000Z',
    status: 'PUBLISHED',
    public_status: 'PUBLISHED',
    registration_count: 0,
    album_enabled: 0,
    ...overrides,
  }
}

describe('MIP public event discovery filters', () => {
  it('returns only active catalog keys and names that are attached to published history', async () => {
    const calls = []
    const database = {
      async query(sql, params) {
        calls.push({ sql, params })
        if (sql.includes('FROM mip_event_types event_type')) {
          return [{ key: 'community', name: '社区活动' }]
        }
        if (sql.includes('FROM mip_event_tags event_tag')) {
          return [{ key: 'ai', name: '人工智能' }, { key: 'networking', name: '资源链接' }]
        }
        throw new Error(`unexpected query: ${sql}`)
      },
    }

    const result = await getEventDiscoveryFilters(database, { appId: 'wx-app-a' })
    assert.deepEqual(result, {
      eventTypes: [{ key: 'community', name: '社区活动' }],
      tags: [{ key: 'ai', name: '人工智能' }, { key: 'networking', name: '资源链接' }],
    })
    assert.equal(calls.length, 2)
    for (const call of calls) {
      assert.match(call.sql, /status = 'ACTIVE'/)
      assert.match(call.sql, /published_at IS NOT NULL/)
      assert.match(call.sql, /status IN \('PUBLISHED', 'CANCELLED', 'ENDED'\)/)
      assert.deepEqual(call.params, ['wx-app-a'])
    }
    assert.equal(JSON.stringify(await getEventDiscoveryFilters({
      async query(sql) {
        return sql.includes('mip_event_types')
          ? [{ key: 'community', name: '社区活动', id: 'must-not-leak' }]
          : []
      },
    }, { appId: 'wx-app-a' })).includes('must-not-leak'), false)
  })

  it('filters by current catalogs and binds a signed cursor to every filter and sort fact', async () => {
    const calls = []
    const database = {
      async query(sql, params) {
        calls.push({ sql, params })
        if (sql.includes('FROM mip_event_types') && sql.includes('type_key = ?')) {
          return [{ type_key: params[1] }]
        }
        if (sql.includes('FROM mip_event_tags') && sql.includes('tag_key IN')) {
          return params.slice(1).map(tag_key => ({ tag_key }))
        }
        if (sql.includes('FROM mip_events e\n     LEFT JOIN')) {
          return [
            eventRow(),
            eventRow({ id: '22222222-2222-4222-8222-222222222222', starts_at: '2030-10-19T02:00:00.000Z' }),
          ]
        }
        if (sql.includes('FROM mip_event_registrations r')) return []
        if (sql.includes('mip_event_tag_assignments')) return []
        if (sql.includes('mip_event_video_recaps')) return []
        if (sql.includes('SELECT DISTINCT city_name')) return []
        throw new Error(`unexpected query: ${sql}`)
      },
    }
    const query = {
      view: 'UPCOMING',
      dateFilter: 'RECENT',
      cityName: '深圳',
      eventTypeKey: 'workshop',
      tagKeys: ['networking', 'ai'],
      accessType: 'MEMBER_INCLUDED',
      sortDirection: 'DESC',
      limit: 1,
    }
    const first = await listEvents(database, {
      appId: 'wx-app-a',
      userId: 'user-a',
      query,
      now: new Date('2026-08-26T00:00:00.000Z'),
      tokenSecret: 'event-discovery-cursor-secret',
    })
    assert.equal(first.items.length, 1)
    assert.match(first.nextCursor, /^[\w-]+\.[\w-]+$/)
    const eventQuery = calls.find(call => call.sql.includes('FROM mip_events e\n     LEFT JOIN'))
    assert.ok(eventQuery)
    assert.match(eventQuery.sql, /e\.event_type_key = \?/)
    assert.match(eventQuery.sql, /public_event_type\.type_key IS NOT NULL/)
    assert.match(eventQuery.sql, /e\.access_type = \?/)
    assert.match(eventQuery.sql, /filter_assignment\.status = 'ACTIVE'/)
    assert.match(eventQuery.sql, /filter_tag\.tag_key IN \(\?, \?\)/)
    assert.match(eventQuery.sql, /ORDER BY e\.starts_at DESC, e\.id DESC/)
    assert.equal(eventQuery.params.includes('workshop'), true)
    assert.equal(eventQuery.params.includes('MEMBER_INCLUDED'), true)
    assert.equal(eventQuery.params.includes('ai'), true)
    assert.equal(eventQuery.params.includes('networking'), true)
    const typeCatalogQuery = calls.find(call => call.sql.includes('FROM mip_event_types')
      && call.sql.includes('type_key = ?'))
    const tagCatalogQuery = calls.find(call => call.sql.includes('FROM mip_event_tags')
      && call.sql.includes('tag_key IN'))
    assert.match(typeCatalogQuery.sql, /published_at IS NOT NULL/)
    assert.match(tagCatalogQuery.sql, /published_at IS NOT NULL/)
    assert.match(tagCatalogQuery.sql, /assignment\.status = 'ACTIVE'/)

    await assert.rejects(() => listEvents(database, {
      appId: 'wx-app-a',
      userId: 'user-a',
      query: { ...query, cursor: first.nextCursor, sortDirection: 'ASC' },
      now: new Date('2026-08-26T00:00:00.000Z'),
      tokenSecret: 'event-discovery-cursor-secret',
    }), error => error?.code === 'VALIDATION_FAILED')
    await assert.rejects(() => listEvents(database, {
      appId: 'wx-app-a',
      userId: 'user-a',
      query: { ...query, cursor: `${first.nextCursor}x` },
      now: new Date('2026-08-26T00:00:00.000Z'),
      tokenSecret: 'event-discovery-cursor-secret',
    }), error => error?.code === 'VALIDATION_FAILED')

    for (const changedQuery of [
      { ...query, cityName: '上海' },
      { ...query, branchId: 'branch-b' },
      { ...query, query: '共创' },
      { ...query, date: '2030-11-16' },
      { ...query, dateFrom: '2030-01-01' },
      { ...query, dateTo: '2030-12-31' },
      { ...query, dateFilter: 'TODAY' },
      { ...query, view: 'PAST' },
      { ...query, eventTypeKey: 'community' },
      { ...query, tagKeys: ['ai'] },
      { ...query, accessType: 'FREE' },
      { ...query, sortDirection: 'ASC' },
    ]) {
      await assert.rejects(() => listEvents(database, {
        appId: 'wx-app-a',
        userId: 'user-a',
        query: { ...changedQuery, cursor: first.nextCursor },
        now: new Date('2026-08-26T00:00:00.000Z'),
        tokenSecret: 'event-discovery-cursor-secret',
      }), error => error?.code === 'VALIDATION_FAILED')
    }
    await assert.rejects(() => listEvents(database, {
      appId: 'wx-app-b',
      userId: 'user-a',
      query: { ...query, cursor: first.nextCursor },
      now: new Date('2026-08-26T00:00:00.000Z'),
      tokenSecret: 'event-discovery-cursor-secret',
    }), error => error?.code === 'VALIDATION_FAILED')
    await assert.rejects(() => listEvents(database, {
      appId: 'wx-app-a',
      userId: 'user-b',
      query: { ...query, cursor: first.nextCursor },
      now: new Date('2026-08-26T00:00:00.000Z'),
      tokenSecret: 'event-discovery-cursor-secret',
    }), error => error?.code === 'VALIDATION_FAILED')
  })

  it('rejects unknown, inactive, duplicate, and malformed catalog filters', async () => {
    const unavailable = {
      async query(sql) {
        if (sql.includes('FROM mip_event_types')) return []
        throw new Error(`unexpected query: ${sql}`)
      },
    }
    await assert.rejects(() => listEvents(unavailable, {
      appId: 'wx-app-a',
      query: { eventTypeKey: 'retired-type' },
      tokenSecret: 'event-discovery-cursor-secret',
    }), error => error?.code === 'VALIDATION_FAILED' && /不可用/.test(error.message))
    await assert.rejects(() => listEvents(unavailable, {
      appId: 'wx-app-a',
      query: { eventTypeKey: 'INVALID TYPE' },
      tokenSecret: 'event-discovery-cursor-secret',
    }), error => error?.code === 'VALIDATION_FAILED')
    await assert.rejects(() => listEvents(unavailable, {
      appId: 'wx-app-a',
      query: { tagKeys: ['ai', 'ai'] },
      tokenSecret: 'event-discovery-cursor-secret',
    }), error => error?.code === 'VALIDATION_FAILED')
  })
})
