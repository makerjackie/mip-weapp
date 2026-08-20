import type { EventSummary } from '../src/modules/membership/types'
import { describe, expect, it } from 'vitest'
import {
  eventMatchesTimeFilter,
  presentEventFeed,
} from '../src/modules/membership/event-feed'

function event(overrides: Partial<EventSummary> = {}): EventSummary {
  return {
    id: 'event-1',
    title: '城市手作聚会',
    startsAt: '2027-01-09T02:00:00.000Z',
    location: '上海',
    priceCents: 0,
    memberFree: false,
    activityType: 'PUBLIC_FREE',
    registered: false,
    registrationState: null,
    coverUrl: '',
    capacity: 20,
    registrationCount: 8,
    registrationOpen: true,
    registrationMode: 'AUTO',
    waitlistEnabled: true,
    eventMode: 'OFFLINE',
    eventState: 'PUBLISHED',
    ...overrides,
  }
}

describe('member event feed', () => {
  const now = new Date('2027-01-04T00:00:00.000Z')

  it('applies stable seven-day, weekend, and month filters', () => {
    const friday = event({ startsAt: '2027-01-08T02:00:00.000Z' })
    const saturday = event({ startsAt: '2027-01-09T02:00:00.000Z' })
    const nextMonth = event({ startsAt: '2027-02-01T02:00:00.000Z' })

    expect(eventMatchesTimeFilter(friday, 'next7', now)).toBe(true)
    expect(eventMatchesTimeFilter(saturday, 'weekend', now)).toBe(true)
    expect(eventMatchesTimeFilter(friday, 'weekend', now)).toBe(false)
    expect(eventMatchesTimeFilter(nextMonth, 'month', now)).toBe(false)
    expect(eventMatchesTimeFilter(nextMonth, 'all', now)).toBe(true)
  })

  it.each([
    {
      name: 'already registered',
      input: event({ registered: true, registrationState: 'REGISTERED' }),
      membershipActive: false,
      phoneBound: false,
      action: 'registered',
      label: '已报名',
    },
    {
      name: 'pending approval',
      input: event({ registrationState: 'PENDING_REVIEW', registrationMode: 'APPROVAL' }),
      membershipActive: true,
      phoneBound: true,
      action: 'pending',
      label: '报名待审核',
    },
    {
      name: 'waitlisted',
      input: event({ registrationState: 'WAITLISTED' }),
      membershipActive: true,
      phoneBound: true,
      action: 'waitlisted',
      label: '候补中',
    },
    {
      name: 'phone required',
      input: event(),
      membershipActive: false,
      phoneBound: false,
      action: 'phone',
      label: '绑定手机号后报名',
    },
    {
      name: 'membership required',
      input: event({ memberFree: true, activityType: 'MEMBER_INCLUDED' }),
      membershipActive: false,
      phoneBound: true,
      action: 'membership',
      label: '开通会员后报名',
    },
    {
      name: 'paid registration',
      input: event({ priceCents: 8800, activityType: 'PUBLIC_PAID' }),
      membershipActive: true,
      phoneBound: true,
      action: 'payment',
      label: '支付 ¥88.00 报名',
    },
    {
      name: 'join waitlist when full',
      input: event({ registrationCount: 20 }),
      membershipActive: true,
      phoneBound: true,
      action: 'register',
      label: '加入候补',
    },
    {
      name: 'closed registration',
      input: event({ registrationOpen: false }),
      membershipActive: true,
      phoneBound: true,
      action: 'closed',
      label: '报名已截止',
    },
  ])('$name has one explicit next action', ({
    input,
    membershipActive,
    phoneBound,
    action,
    label,
  }) => {
    const [presented] = presentEventFeed([input], {
      membershipActive,
      phoneBound,
      now,
    })
    expect(presented.action).toBe(action)
    expect(presented.actionLabel).toBe(label)
  })

  it('never reports a negative remaining capacity', () => {
    const [presented] = presentEventFeed([
      event({ capacity: 10, registrationCount: 15, waitlistEnabled: false }),
    ], {
      membershipActive: true,
      phoneBound: true,
      now,
    })

    expect(presented.availabilityText).toBe('剩余 0 位')
    expect(presented.action).toBe('full')
  })
})
