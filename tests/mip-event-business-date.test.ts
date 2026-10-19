import { expect, it } from 'vitest'
import { eventScheduleText } from '../src/components/mip-activity-card/model'
import { businessCalendarDate, formatBusinessDate, formatBusinessDateTime, formatBusinessTime } from '../src/utils/business-date'

it('uses the API business day and time even when the device is in New York', () => {
  const previousTimezone = process.env.TZ
  process.env.TZ = 'America/New_York'
  try {
    const timestamp = '2026-12-12T02:00:00.000Z'
    expect(formatBusinessDate(timestamp)).toBe('2026-12-12')
    expect(formatBusinessTime(timestamp)).toBe('10:00')
    expect(formatBusinessDateTime(timestamp)).toBe('2026年12月12日 10:00')
    expect(eventScheduleText(timestamp, '2026-12-12T04:00:00.000Z', new Date('2026-01-01T00:00:00Z'))).toBe('12月12日 10:00-12:00')
    const today = businessCalendarDate('2026-10-19T17:00:00Z')
    expect([today.getFullYear(), today.getMonth() + 1, today.getDate()]).toEqual([2026, 10, 20])
    // A nonexistent 02:30 local DST clock must not distort the business timestamp.
    expect(formatBusinessTime('2026-03-07T18:30:00Z')).toBe('02:30')
  }
  finally {
    if (previousTimezone === undefined) {
      delete process.env.TZ
    }
    else {
      process.env.TZ = previousTimezone
    }
  }
})
it('returns no fabricated date for an invalid server timestamp', () => {
  expect(formatBusinessDate('invalid')).toBe('')
  expect(formatBusinessDateTime('invalid')).toBe('')
})
