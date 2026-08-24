'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { listEvents } = require('../domain/event-service')

function databaseForList() {
  const calls = []
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params })
      if (sql.includes('FROM mip_events e')) {
        return []
      }
      if (sql.includes('SELECT DISTINCT city_name')) {
        return []
      }
      throw new Error(`unexpected query: ${sql}`)
    },
  }
}

describe('MIP event date range filter', () => {
  it('uses the China business date for the today shortcut', async () => {
    const database = databaseForList()
    await listEvents(database, {
      appId: 'wx-app-a',
      query: { view: 'UPCOMING', dateFilter: 'TODAY' },
      now: new Date('2026-08-24T17:00:00.000Z'),
      tokenSecret: 'event-preview-token-secret',
    })

    const eventQuery = database.calls.find(call => call.sql.includes('FROM mip_events e'))
    assert.ok(eventQuery)
    assert.match(eventQuery.sql, /e\.starts_at >= \? AND e\.starts_at < \?/)
    const dateParameters = eventQuery.params.filter(value => value instanceof Date)
    assert.deepEqual(dateParameters.slice(-2).map(value => value.toISOString()), [
      '2026-08-24T16:00:00.000Z',
      '2026-08-25T16:00:00.000Z',
    ])
  })

  it('uses an inclusive China business-day range and keeps the app scope predicate', async () => {
    const database = databaseForList()
    await listEvents(database, {
      appId: 'wx-app-a',
      query: {
        view: 'UPCOMING',
        dateFilter: 'RECENT',
        dateFrom: '2026-08-24',
        dateTo: '2026-08-25',
      },
      now: new Date('2026-08-20T00:00:00.000Z'),
      tokenSecret: 'event-preview-token-secret',
    })

    const eventQuery = database.calls.find(call => call.sql.includes('FROM mip_events e'))
    assert.ok(eventQuery)
    assert.match(eventQuery.sql, /e\.app_id = \?/)
    assert.match(eventQuery.sql, /e\.starts_at >= \? AND e\.starts_at < \?/)
    assert.deepEqual(eventQuery.params.slice(-3, -1).map(value => value.toISOString()), [
      '2026-08-23T16:00:00.000Z',
      '2026-08-25T16:00:00.000Z',
    ])
  })

  it('supports one-sided ranges but rejects invalid dates and reversed ranges', async () => {
    const fromOnly = databaseForList()
    await listEvents(fromOnly, {
      appId: 'wx-app-a',
      query: { view: 'UPCOMING', dateFilter: 'RECENT', dateFrom: '2026-08-24' },
      now: new Date('2026-08-20T00:00:00.000Z'),
      tokenSecret: 'event-preview-token-secret',
    })
    const fromQuery = fromOnly.calls.find(call => call.sql.includes('FROM mip_events e'))
    assert.ok(fromQuery)
    assert.match(fromQuery.sql, /e\.starts_at >= \?/)
    assert.doesNotMatch(fromQuery.sql, /e\.starts_at < \?/)

    await assert.rejects(() => listEvents(databaseForList(), {
      appId: 'wx-app-a',
      query: { view: 'UPCOMING', dateFilter: 'RECENT', dateFrom: '2026-02-30', dateTo: '2026-03-01' },
      now: new Date('2026-08-20T00:00:00.000Z'),
      tokenSecret: 'event-preview-token-secret',
    }), error => error?.code === 'VALIDATION_FAILED')
    await assert.rejects(() => listEvents(databaseForList(), {
      appId: 'wx-app-a',
      query: { view: 'UPCOMING', dateFilter: 'RECENT', dateFrom: '2026-08-25', dateTo: '2026-08-24' },
      now: new Date('2026-08-20T00:00:00.000Z'),
      tokenSecret: 'event-preview-token-secret',
    }), error => error?.code === 'VALIDATION_FAILED')
  })
})
