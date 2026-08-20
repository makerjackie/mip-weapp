import { describe, expect, it } from 'vitest'
import { parseEventDetail } from '../src/modules/membership/dto'
import {
  eventAvailabilityText,
  eventDescriptionNeedsExpansion,
  eventFeatureTags,
  eventSummaryText,
} from '../src/modules/membership/event-detail-presentation'

describe('event detail presentation', () => {
  it('derives semantic tags from trusted event fields', () => {
    expect(eventFeatureTags({
      eventMode: 'OFFLINE',
      registrationMode: 'APPROVAL',
      memberFree: true,
      priceCents: 0,
      capacity: 20,
      registrationCount: 8,
    })).toEqual(['线下活动', '报名需审核', '会员免费'])

    expect(eventFeatureTags({
      eventMode: 'HYBRID',
      registrationMode: 'AUTO',
      memberFree: false,
      priceCents: 8800,
      capacity: null,
      registrationCount: 8,
    })).toEqual(['线上线下', '即时确认', '付费活动'])
  })

  it('keeps capacity and description disclosure useful on a phone screen', () => {
    expect(eventAvailabilityText({
      eventMode: 'ONLINE',
      registrationMode: 'AUTO',
      memberFree: false,
      priceCents: 0,
      capacity: 12,
      registrationCount: 9,
    })).toBe('剩余 3 个名额')
    expect(eventAvailabilityText({
      eventMode: 'ONLINE',
      registrationMode: 'AUTO',
      memberFree: false,
      priceCents: 0,
      capacity: 12,
      registrationCount: 15,
    })).toBe('名额已满')
    expect(eventDescriptionNeedsExpansion('一段简短介绍')).toBe(false)
    expect(eventDescriptionNeedsExpansion('一'.repeat(73))).toBe(true)
  })

  it('prefers the database summary and falls back to the first description sentence', () => {
    expect(eventSummaryText('一起认识城市里的有趣伙伴', '不应使用这段')).toBe('一起认识城市里的有趣伙伴')
    expect(eventSummaryText('', '一起认识城市里的有趣伙伴。后续内容很多。')).toBe('一起认识城市里的有趣伙伴')
  })

  it('accepts a public organizer without exposing its private identity', () => {
    const parsed = parseEventDetail({
      id: '11111111-1111-4111-8111-111111111111',
      title: '城市散步与晚餐',
      startsAt: '2027-01-09T02:00:00.000Z',
      location: '上海',
      priceCents: 0,
      memberFree: true,
      activityType: 'MEMBER_INCLUDED',
      registered: false,
      registrationState: null,
      capacity: 20,
      registrationCount: 8,
      registrationOpen: true,
      registrationMode: 'AUTO',
      waitlistEnabled: true,
      eventMode: 'OFFLINE',
      eventState: 'PUBLISHED',
      summary: '沿着街区散步，认识新的朋友',
      description: '活动介绍',
      organizer: {
        id: '22222222-2222-4222-8222-222222222222',
        nickname: '林深',
        headline: '城市活动发起人',
        avatarUrl: 'cloud://avatar',
      },
      formVersion: 1,
      membershipActive: true,
      phoneBound: true,
      canCancel: false,
      canRegister: true,
    })

    expect(parsed.summary).toBe('沿着街区散步，认识新的朋友')
    expect(parsed.organizer).toEqual({
      id: '22222222-2222-4222-8222-222222222222',
      nickname: '林深',
      headline: '城市活动发起人',
      avatarUrl: 'cloud://avatar',
    })
    expect(parsed.organizer).not.toHaveProperty('userId')
  })
})
