import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  dateTimeParts,
  localDateTimeIso,
  validateDateTimeRange,
} from '../src/packages/admin/components/date-time-range/model'

function read(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('admin date-time range model', () => {
  it('keeps picker values local and converts them to UTC ISO for APIs', () => {
    vi.stubEnv('TZ', 'Asia/Shanghai')
    expect(localDateTimeIso('2026-08-25', '14:30')).toBe('2026-08-25T06:30:00.000Z')
    expect(dateTimeParts('2026-08-25T06:30:00.000Z')).toEqual({ date: '2026-08-25', time: '14:30' })
    vi.unstubAllEnvs()
  })

  it('validates an optional range and rejects reversed values', () => {
    expect(validateDateTimeRange({
      startDate: '2026-08-25',
      startTime: '14:30',
      endDate: '',
      endTime: '',
    }, false).valid).toBe(true)
    expect(validateDateTimeRange({
      startDate: '2026-08-25',
      startTime: '14:30',
      endDate: '2026-08-25',
      endTime: '14:29',
    })).toMatchObject({ valid: false, message: '结束时间不能早于开始时间。' })
    expect(validateDateTimeRange({
      startDate: '2026-08-25',
      startTime: '14:30',
      endDate: '2026-08-25',
      endTime: '14:30',
    }).valid).toBe(true)
  })

  it('uses the shared component in both selected admin editors', () => {
    const component = read('src/packages/admin/components/date-time-range/index.wxml')
    expect(component).toContain('bindchange="change"')
    expect(component).toContain('bind:tap="clear"')
    expect(read('src/packages/admin/events/index.wxml')).toContain('<mip-admin-date-time-range')
    expect(read('src/packages/admin/announcement-editor/index.wxml')).toContain('<mip-admin-date-time-range')
  })
})
