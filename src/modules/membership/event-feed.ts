import type { EventSummary } from './types'
import { formatLocalDateTime } from '../../utils/date'

export type EventTimeFilter = 'all' | 'next7' | 'weekend' | 'month'

export interface PresentedEvent extends EventSummary {
  action: 'registered' | 'pending' | 'waitlisted' | 'membership' | 'phone' | 'register' | 'payment' | 'full' | 'closed'
  actionLabel: string
  availabilityText: string
  priceText: string
  startsText: string
  statusText: string
}

function eventAction(event: EventSummary, membershipActive: boolean, phoneBound: boolean) {
  if (event.registrationState === 'PENDING_REVIEW') {
    return { action: 'pending' as const, actionLabel: '报名待审核', statusText: '待审核' }
  }
  if (event.registrationState === 'WAITLISTED') {
    return { action: 'waitlisted' as const, actionLabel: '候补中', statusText: '候补中' }
  }
  if (event.registered || ['REGISTERED', 'ATTENDED', 'CANCELLATION_PENDING'].includes(String(event.registrationState))) {
    return { action: 'registered' as const, actionLabel: '已报名', statusText: '已报名' }
  }
  if (!event.registrationOpen) {
    return { action: 'closed' as const, actionLabel: '报名已截止', statusText: '已截止' }
  }
  if (event.capacity !== null && event.registrationCount >= event.capacity) {
    return event.waitlistEnabled
      ? { action: 'register' as const, actionLabel: '加入候补', statusText: '可候补' }
      : { action: 'full' as const, actionLabel: '名额已满', statusText: '已满员' }
  }
  if (!phoneBound) {
    return { action: 'phone' as const, actionLabel: '绑定手机号后报名', statusText: '报名中' }
  }
  if (event.memberFree && !membershipActive) {
    return { action: 'membership' as const, actionLabel: '开通会员后报名', statusText: '会员活动' }
  }
  if (!event.memberFree && event.priceCents > 0) {
    return {
      action: 'payment' as const,
      actionLabel: `支付 ¥${(event.priceCents / 100).toFixed(2)} 报名`,
      statusText: '报名中',
    }
  }
  return event.registrationMode === 'APPROVAL'
    ? { action: 'register' as const, actionLabel: '提交报名申请', statusText: '需审核' }
    : { action: 'register' as const, actionLabel: '立即报名', statusText: '报名中' }
}

function weekendRange(now: Date) {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const day = start.getDay()
  if (day === 0) {
    start.setDate(start.getDate() - 1)
  }
  else {
    start.setDate(start.getDate() + ((6 - day + 7) % 7))
  }
  const end = new Date(start)
  end.setDate(end.getDate() + 2)
  return { start, end }
}

export function eventMatchesTimeFilter(
  event: Pick<EventSummary, 'startsAt'>,
  filter: EventTimeFilter,
  now = new Date(),
) {
  if (filter === 'all') {
    return true
  }
  const startsAt = new Date(event.startsAt)
  if (Number.isNaN(startsAt.getTime())) {
    return false
  }
  if (filter === 'next7') {
    const end = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000))
    return startsAt >= now && startsAt < end
  }
  if (filter === 'weekend') {
    const range = weekendRange(now)
    return startsAt >= range.start && startsAt < range.end
  }
  return startsAt.getFullYear() === now.getFullYear()
    && startsAt.getMonth() === now.getMonth()
}

export function presentEventFeed(
  events: EventSummary[],
  input: {
    membershipActive: boolean
    phoneBound: boolean
    timeFilter?: EventTimeFilter
    now?: Date
  },
) {
  const filter = input.timeFilter || 'all'
  const now = input.now || new Date()
  return events
    .filter(event => eventMatchesTimeFilter(event, filter, now))
    .map(event => ({
      ...event,
      ...eventAction(event, input.membershipActive, input.phoneBound),
      priceText: event.memberFree
        ? '会员免费'
        : event.priceCents
          ? `¥${(event.priceCents / 100).toFixed(2)}`
          : '免费',
      startsText: formatLocalDateTime(event.startsAt),
      availabilityText: event.registrationState === 'PENDING_REVIEW'
        ? '等待主办方审核'
        : event.registrationState === 'WAITLISTED'
          ? '已进入候补'
          : event.capacity === null
            ? '开放报名'
            : `剩余 ${Math.max(0, event.capacity - event.registrationCount)} 位`,
    }))
}
