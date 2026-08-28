import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { publicEventTypeLabel } from '../src/modules/mip-events/presentation'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')

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

  it('uses the shared presenter on event list, detail, and registration surfaces', () => {
    for (const file of [
      'src/pages/events/index.ts',
      'src/packages/member/mip-events/detail/index.ts',
      'src/packages/member/mip-events/registration/index.ts',
    ]) {
      expect(read(file)).toContain('publicEventTypeLabel')
    }
    expect(read('src/packages/member/mip-events/detail/index.ts'))
      .toContain('eventTypeLabel: publicEventTypeLabel(event.eventTypeLabel)')
  })
})
