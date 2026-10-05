'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { listEventCalendarDates } = require('../domain/event-service')

function calendarDatabase(rows = []) {
  const calls = []
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params })
      return rows
    },
  }
}

describe('MIP event calendar dates', () => {
  it('returns distinct china business dates of currently listed published events', async () => {
    const database = calendarDatabase([
      { event_date: '2030-11-18' },
      { event_date: '2030-11-16' },
      { event_date: '2030-11-16' },
      { event_date: 'bogus' },
      { event_date: '' },
    ])
    const result = await listEventCalendarDates(database, {
      appId: 'wx-app-a',
      query: { dateFrom: '2030-11-01', dateTo: '2030-11-30', cityName: ' 深圳 ' },
      now: new Date('2030-11-10T02:00:00.000Z'),
    })
    // 去重、丢掉非日期行、按日期升序。
    assert.deepEqual(result, { dates: ['2030-11-16', '2030-11-18'] })
    assert.equal(database.calls.length, 1)
    const { sql, params } = database.calls[0]
    // 谓词与公开目录一致：已发布、发布时间存在、未结束，且 starts_at 落在所选日期区间。
    assert.match(sql, /e\.status = 'PUBLISHED'/)
    assert.match(sql, /e\.published_at IS NOT NULL/)
    assert.match(sql, /e\.ends_at >= \?/)
    assert.match(sql, /e\.starts_at >= \?/)
    assert.match(sql, /e\.starts_at < \?/)
    assert.match(sql, /e\.city_name = \?/)
    assert.match(sql, /DATE_ADD\(e\.starts_at, INTERVAL 8 HOUR\)/)
    assert.match(sql, /ORDER BY event_date ASC/)
    assert.deepEqual(params, [
      'wx-app-a',
      new Date('2030-11-10T02:00:00.000Z'),
      new Date('2030-10-31T16:00:00.000Z'),
      new Date('2030-11-30T16:00:00.000Z'),
      '深圳',
    ])
  })

  it('omits the city clause when no city filter is supplied', async () => {
    const database = calendarDatabase()
    await listEventCalendarDates(database, {
      appId: 'wx-app-a',
      query: { dateFrom: '2030-11-01', dateTo: '2030-11-30' },
    })
    assert.match(database.calls[0].sql, /WHERE e\.app_id = \? AND/)
    assert.equal(database.calls[0].sql.includes('city_name'), false)
    assert.equal(database.calls[0].params.length, 4)
  })

  it('rejects missing, malformed, reversed, and oversized ranges before querying', async () => {
    const database = calendarDatabase()
    await assert.rejects(() => listEventCalendarDates(database, {
      appId: 'wx-app-a',
      query: {},
    }), error => error?.code === 'VALIDATION_FAILED' && /开始日期无效/.test(error.message))
    await assert.rejects(() => listEventCalendarDates(database, {
      appId: 'wx-app-a',
      query: { dateFrom: '2030-02-30', dateTo: '2030-03-01' },
    }), error => error?.code === 'VALIDATION_FAILED')
    await assert.rejects(() => listEventCalendarDates(database, {
      appId: 'wx-app-a',
      query: { dateFrom: '2030-11-30', dateTo: '2030-11-01' },
    }), error => error?.code === 'VALIDATION_FAILED' && /开始日期不能晚于结束日期/.test(error.message))
    await assert.rejects(() => listEventCalendarDates(database, {
      appId: 'wx-app-a',
      query: { dateFrom: '2030-01-01', dateTo: '2030-12-31' },
    }), error => error?.code === 'VALIDATION_FAILED' && /日期范围过大/.test(error.message))
    assert.equal(database.calls.length, 0)
  })

  it('accepts a two-month window for month paging', async () => {
    const database = calendarDatabase()
    await listEventCalendarDates(database, {
      appId: 'wx-app-a',
      query: { dateFrom: '2030-11-01', dateTo: '2030-12-31' },
    })
    assert.equal(database.calls.length, 1)
  })
})
