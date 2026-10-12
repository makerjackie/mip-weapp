import type { EventParticipantPreview, MipEventListItem } from '../src/modules/mip-events'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { presentEventCard } from '../src/components/mip-activity-card/model'

/**
 * 参与人数展示合同（MIW-73）：服务端保证 registrationCount 与头像预览同是公开参与者口径
 * （share_profile=1 + REGISTERED/ATTENDED + 用户 ACTIVE + 资料存在）。
 * 卡片标签读报名总数，头像最多出镜前 3 个、不参与文案；超过 3 人（头像必然被截断）
 * 读「+N人参加」，≤3 人读「N人参加」；0 人整个胶囊隐藏
 * （卡片 wx:if registrationCount > 0，组件内 count > 0 双保险）。
 * 三个界面（活动卡/详情/公开名单）数字不允许互相矛盾。
 */
function eventWith(overrides: Partial<MipEventListItem>): MipEventListItem {
  return {
    id: '26000000-0000-4000-8000-00000000e001',
    scopeType: 'PLATFORM',
    title: 'MIP早会',
    summary: '摘要',
    eventTypeLabel: '社交',
    tags: [],
    videoRecaps: [],
    mode: 'OFFLINE',
    accessType: 'FREE',
    startsAt: '2030-09-01T08:00:00.000Z',
    endsAt: '2030-09-01T10:00:00.000Z',
    status: 'PUBLISHED',
    registrationCount: 0,
    participantPreview: [],
    ...overrides,
  }
}

function previews(count: number): EventParticipantPreview[] {
  return Array.from({ length: count }, (_, index) => ({
    participantRef: `p1.ref${index}`,
    nickname: `参与者${index + 1}`,
  }))
}

describe('event card participant count label', () => {
  it('prefixes + once the total exceeds the three avatar slots', () => {
    const view = presentEventCard(eventWith({ registrationCount: 10, participantPreview: previews(4) }))
    expect(view.countText).toBe('+10人参加')
  })

  it('reads 1人参加 for a single participant with their avatar', () => {
    const view = presentEventCard(eventWith({ registrationCount: 1, participantPreview: previews(1) }))
    expect(view.countText).toBe('1人参加')
  })

  it('reads N人参加 while everyone fits the three avatar slots', () => {
    const view = presentEventCard(eventWith({ registrationCount: 2, participantPreview: [] }))
    expect(view.countText).toBe('2人参加')
  })

  it('keeps the + prefix when the total passes three even with full previews', () => {
    const view = presentEventCard(eventWith({ registrationCount: 4, participantPreview: previews(6) }))
    expect(view.countText).toBe('+4人参加')
  })

  it('clears the label for zero-participant events so the pill hides', () => {
    const view = presentEventCard(eventWith({ registrationCount: 0, participantPreview: [] }))
    expect(view.countText).toBe('')
  })
})

describe('event card participant pill rendering contract (MIW-73)', () => {
  const cardTemplate = readFileSync(new URL('../src/components/mip-activity-card/index.wxml', import.meta.url), 'utf8')
  const previewTemplate = readFileSync(new URL('../src/components/event-participant-preview/index.wxml', import.meta.url), 'utf8')

  it('hides the pill entirely for zero-participant events', () => {
    expect(cardTemplate).toContain('wx:if="{{event.registrationCount > 0}}"')
    expect(previewTemplate).toContain('wx:if="{{count > 0}}"')
  })

  it('caps the avatar stack at the first three avatars', () => {
    expect(previewTemplate.match(/index < 3/g)?.length).toBe(2)
    expect(previewTemplate).not.toContain('plusLabel')
    expect(previewTemplate).not.toContain('remainText')
  })
})
