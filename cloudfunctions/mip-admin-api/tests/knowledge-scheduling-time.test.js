'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  dailyTimeValue,
  nextDailyRunAt,
  timeZoneValue,
} = require('../domain/knowledge-scheduling-time')

describe('knowledge daily schedule time', () => {
  it('computes the next Asia/Shanghai local occurrence without server timezone assumptions', () => {
    assert.equal(nextDailyRunAt({
      after: new Date('2030-08-25T00:29:59.000Z'),
      dailyTime: '08:30',
      timeZone: 'Asia/Shanghai',
    }).toISOString(), '2030-08-25T00:30:00.000Z')
    assert.equal(nextDailyRunAt({
      after: new Date('2030-08-25T00:30:00.000Z'),
      dailyTime: '08:30',
      timeZone: 'Asia/Shanghai',
    }).toISOString(), '2030-08-26T00:30:00.000Z')
  })

  it('validates exact daily time and IANA timezone values', () => {
    assert.equal(dailyTimeValue('23:59'), '23:59')
    assert.equal(timeZoneValue('UTC'), 'UTC')
    assert.throws(() => dailyTimeValue('24:00'), /VALIDATION_FAILED/)
    assert.throws(() => timeZoneValue('Invalid/Timezone'), /VALIDATION_FAILED/)
  })

  it('skips a nonexistent daylight-saving local time instead of wedging the lease', () => {
    assert.equal(nextDailyRunAt({
      after: new Date('2030-03-10T05:00:00.000Z'),
      dailyTime: '02:30',
      timeZone: 'America/New_York',
    }).toISOString(), '2030-03-11T06:30:00.000Z')
  })
})
