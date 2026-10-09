import type { EventParticipantPreview, MipEventListItem } from '../src/modules/mip-events'
import { describe, expect, it } from 'vitest'
import { presentEventCard } from '../src/components/mip-activity-card/model'

/**
 * 参与人数展示合同：服务端保证 registrationCount 与头像预览同是公开参与者口径
 * （share_profile=1 + REGISTERED/ATTENDED + 用户 ACTIVE + 资料存在）。
 * 卡片标签必须让用户数得出来：头像之外有剩余读「+N参加」，全部出镜读「N人参加」，
 * 无头像读「N参加」。三个界面（活动卡/详情/公开名单）数字不允许互相矛盾。
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
  it('reads N人参加 when every public participant is already shown as avatars', () => {
    // 用户反馈场景修复后：3 人公开、3 个头像全部出镜，不再出现「+0参加」。
    const view = presentEventCard(eventWith({ registrationCount: 3, participantPreview: previews(3) }))
    expect(view.plusLabel).toBe('')
    expect(view.remainText).toBe('3人参加')
    expect(view.countText).toBe('3人参加')
  })

  it('reads +N参加 when public participants exceed the avatar stack', () => {
    const view = presentEventCard(eventWith({ registrationCount: 5, participantPreview: previews(4) }))
    expect(view.plusLabel).toBe('+')
    expect(view.remainText).toBe('1参加')
    expect(view.countText).toBe('+1参加')
  })

  it('reads N参加 when no avatar preview exists', () => {
    const view = presentEventCard(eventWith({ registrationCount: 2, participantPreview: [] }))
    expect(view.plusLabel).toBe('')
    expect(view.remainText).toBe('2参加')
  })

  it('keeps zero-participant events at 0参加', () => {
    const view = presentEventCard(eventWith({ registrationCount: 0, participantPreview: [] }))
    expect(view.remainText).toBe('0参加')
  })
})
