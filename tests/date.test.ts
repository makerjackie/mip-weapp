import { describe, expect, it, vi } from 'vitest'
import {
  formatChineseDate,
  formatChineseDateTime,
  formatChineseMonthDay,
  formatChineseMonthDayTime,
  formatLocalDate,
  formatLocalDateTime,
  formatLocalMonthDayTime,
  formatLocalTime,
  parseLocalDate,
} from '../src/utils/date'

describe('local date formatting', () => {
  it('formats database ISO timestamps in the device timezone instead of slicing UTC text', () => {
    vi.stubEnv('TZ', 'Asia/Shanghai')
    const value = new Date('2026-07-25T06:00:00.000Z')
    expect(formatLocalDate(value)).toBe('2026-07-25')
    expect(formatLocalDate(value.getTime())).toBe('2026-07-25')
    expect(formatLocalTime(value)).toBe('14:00')
    expect(formatLocalDateTime(value)).toBe('2026-07-25 14:00')
    expect(formatLocalMonthDayTime(value)).toBe('07-25 14:00')
    expect(formatChineseDate(value)).toBe('2026年7月25日')
    expect(formatChineseDateTime(value)).toBe('2026年7月25日 14:00')
    expect(formatChineseMonthDay(value)).toBe('7月25日')
    expect(formatChineseMonthDayTime(value)).toBe('7月25日 14:00')
    vi.unstubAllEnvs()
  })

  it('returns an empty string for invalid timestamps', () => {
    expect(formatLocalDateTime('invalid')).toBe('')
    expect(formatChineseDateTime('invalid')).toBe('')
  })

  it('parses YYYY-MM-DD keys as local calendar days', () => {
    vi.stubEnv('TZ', 'Asia/Shanghai')
    const parsed = parseLocalDate('2026-01-01')
    expect(parsed).not.toBeNull()
    expect(formatLocalDate(parsed!)).toBe('2026-01-01')
    expect(parseLocalDate('2026-13-01')).toBeNull()
    expect(parseLocalDate('2026-1-1')).toBeNull()
    vi.unstubAllEnvs()
  })
})
