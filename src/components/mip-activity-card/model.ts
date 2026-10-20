import type { EventRecapCard, EventVideoRecap, MipEventListItem } from '../../modules/mip-events'
import { publicEventTypeLabel } from '../../modules/mip-events'
import { businessCalendarDate, formatBusinessDateTime as formatChineseDateTime, formatBusinessMonthDayTime as formatChineseMonthDayTime, formatBusinessDate as formatLocalDate, formatBusinessTime as formatLocalTime } from '../../utils/business-date'

export interface EventCardView extends MipEventListItem {
  startsText: string
  accessLabel: string
  statusLabel: string
  locationText: string
  countText: string
}

/**
 * MIW-73：头像 stack 的人数标签读报名总数（头像最多出镜 3 个，不计入文案）。
 * 超过 3 人（头像必然被截断）读「+N人参加」；≤3 人全员出镜读「N人参加」；
 * 0 人文案为空，胶囊由卡片侧 registrationCount > 0 整体隐藏。
 */
function participantCountText(event: MipEventListItem) {
  const count = event.registrationCount ?? 0
  if (count <= 0) {
    return ''
  }
  return count > 3 ? `+${count}人参加` : `${count}人参加`
}

function accessLabel(event: MipEventListItem) {
  if (event.accessType === 'MEMBER_INCLUDED') {
    return '仅玩家'
  }
  if (event.accessType === 'PAID') {
    return event.memberFree ? '玩家免费' : '付费活动'
  }
  return '免费活动'
}

function statusLabel(event: MipEventListItem) {
  if (event.registrationStatus === 'ATTENDED') {
    return '已签到'
  }
  if (event.registrationStatus === 'REGISTERED') {
    return '已报名'
  }
  if (event.registrationStatus === 'WAITLISTED') {
    return '候补中'
  }
  if (event.registrationStatus === 'PENDING_REVIEW') {
    return '待审核'
  }
  if (event.status === 'CANCELLED') {
    return '已取消'
  }
  if (event.status === 'ENDED') {
    return '已结束'
  }
  return ''
}

/** Keep compact current-year dates without making historical or future events ambiguous. */
export function eventScheduleText(startsAt: string, endsAt?: string, now = new Date()) {
  const dateTime = (value: string) => businessCalendarDate(value).getFullYear() === businessCalendarDate(now).getFullYear()
    ? formatChineseMonthDayTime(value)
    : formatChineseDateTime(value)
  const start = dateTime(startsAt)
  if (!endsAt) {
    return start
  }
  const end = formatLocalDate(endsAt) === formatLocalDate(startsAt)
    ? formatLocalTime(endsAt)
    : dateTime(endsAt)
  return `${start}-${end}`
}

export function presentEventCard(event: MipEventListItem): EventCardView {
  return {
    ...event,
    coverUrl: event.coverUrl || '',
    startsText: eventScheduleText(event.startsAt, event.endsAt),
    accessLabel: accessLabel(event),
    statusLabel: statusLabel(event),
    countText: participantCountText(event),
    locationText: [event.cityName, event.venueName].filter(Boolean).join(' · ') || '地点待公布',
    eventTypeLabel: publicEventTypeLabel(event.eventTypeLabel),
  }
}

export interface RecapCardView {
  id: string
  title: string
  coverUrl: string
  videoRecaps: EventVideoRecap[]
}

/** MIW-57 往期活动 tab：后台配置的回顾条目复用 recap 卡片（封面 + 代码绘制播放层 + 标题）。 */
export function presentRecapCard(recap: EventRecapCard): RecapCardView {
  return {
    id: recap.id,
    title: recap.title,
    coverUrl: recap.coverUrl,
    videoRecaps: [{
      id: recap.id,
      title: recap.title,
      summary: '',
      destination: recap.destination,
    }],
  }
}
