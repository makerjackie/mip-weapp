import { describe, expect, it } from 'vitest'
import { publicEventTypeLabel } from '../src/pages/events/presentation'

describe('MIP event public presentation', () => {
  it('maps the demo event key to a stable Chinese label', () => {
    expect(publicEventTypeLabel('mip_morning_meeting')).toBe('MIP 早会')
    expect(publicEventTypeLabel('community')).toBe('社区活动')
  })

  it('does not expose unknown stable catalog keys', () => {
    expect(publicEventTypeLabel('legacy_event_type')).toBe('活动')
    expect(publicEventTypeLabel('Workshop')).toBe('Workshop')
    expect(publicEventTypeLabel('城市交流')).toBe('城市交流')
  })
})
