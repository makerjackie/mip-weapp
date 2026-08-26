'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { listEvents } = require('../domain/event-service')

function eventRow() {
  return {
    id: 'event-1',
    scope_type: 'PLATFORM',
    title: '活动',
    summary: '摘要',
    event_type_key: 'community',
    event_mode: 'OFFLINE',
    access_type: 'FREE',
    starts_at: '2026-08-25T00:00:00.000Z',
    ends_at: '2026-08-25T02:00:00.000Z',
    status: 'PUBLISHED',
    public_status: 'PUBLISHED',
    registration_count: 1,
  }
}

test('event participant previews exclude either block direction for an identified viewer', async () => {
  const calls = []
  const database = {
    async query(sql, params) {
      calls.push({ sql, params })
      if (sql.includes('FROM mip_events e')) return [eventRow()]
      if (sql.includes('FROM mip_event_registrations r')) return []
      if (sql.includes('mip_event_tag_assignments')) return []
      if (sql.includes('mip_event_video_recaps')) return []
      if (sql.includes('SELECT DISTINCT city_name')) return []
      throw new Error(`unexpected query: ${sql}`)
    },
  }

  const result = await listEvents(database, {
    appId: 'wx-app',
    userId: 'viewer-user',
    query: {},
    now: new Date('2026-08-24T00:00:00.000Z'),
    tokenSecret: 'event-preview-token-secret',
  })

  const preview = calls.find(call => call.sql.includes('SELECT r.event_id, r.id AS registration_id'))
  assert.match(preview.sql, /FROM mip_user_blocks visibility_block/)
  assert.match(preview.sql, /visibility_block\.app_id = r\.app_id/)
  assert.match(preview.sql, /blocker_user_id = \? AND visibility_block\.blocked_user_id = r\.user_id/)
  assert.match(preview.sql, /blocker_user_id = r\.user_id AND visibility_block\.blocked_user_id = \?/)
  assert.deepEqual(preview.params, ['wx-app', 'event-1', 'viewer-user', 'viewer-user'])
  assert.deepEqual(result.items[0].participantPreview, [])
})

test('anonymous event participant previews keep the existing public range', async () => {
  let previewSql = ''
  const database = {
    async query(sql) {
      if (sql.includes('FROM mip_events e')) return [eventRow()]
      if (sql.includes('FROM mip_event_registrations r')) {
        previewSql = sql
        return []
      }
      if (sql.includes('mip_event_tag_assignments')) return []
      if (sql.includes('mip_event_video_recaps')) return []
      if (sql.includes('SELECT DISTINCT city_name')) return []
      throw new Error(`unexpected query: ${sql}`)
    },
  }

  await listEvents(database, {
    appId: 'wx-app',
    query: {},
    now: new Date('2026-08-24T00:00:00.000Z'),
    tokenSecret: 'event-preview-token-secret',
  })

  assert.equal(previewSql.includes('mip_user_blocks'), false)
})

test('custom event date is validated and converted from the China business day', async () => {
  let eventQuery
  const database = {
    async query(sql, params) {
      if (sql.includes('FROM mip_events e')) {
        eventQuery = { sql, params }
        return []
      }
      if (sql.includes('SELECT DISTINCT city_name')) return []
      throw new Error(`unexpected query: ${sql}`)
    },
  }

  await listEvents(database, {
    appId: 'wx-app',
    query: { view: 'UPCOMING', dateFilter: 'CUSTOM', date: '2026-08-24' },
    now: new Date('2026-08-20T00:00:00.000Z'),
    tokenSecret: 'event-preview-token-secret',
  })

  assert.match(eventQuery.sql, /e\.starts_at >= \? AND e\.starts_at < \?/)
  const dateParams = eventQuery.params.filter(value => value instanceof Date).map(value => value.toISOString())
  assert.deepEqual(dateParams, [
    '2026-08-20T00:00:00.000Z',
    '2026-08-20T00:00:00.000Z',
    '2026-08-23T16:00:00.000Z',
    '2026-08-24T16:00:00.000Z',
  ])

  await assert.rejects(
    () => listEvents(database, {
      appId: 'wx-app',
      query: { view: 'UPCOMING', dateFilter: 'CUSTOM', date: '2026/08/24' },
      now: new Date('2026-08-20T00:00:00.000Z'),
      tokenSecret: 'event-preview-token-secret',
    }),
    /请选择有效日期/,
  )
})
