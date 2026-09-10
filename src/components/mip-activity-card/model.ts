import type { MipEventListItem } from '../../modules/mip-events'
import { publicEventTypeLabel } from '../../modules/mip-events'
import { formatChineseDateTime } from '../../utils/date'

export interface EventCardView extends MipEventListItem {
  startsText: string
  accessLabel: string
  statusLabel: string
  locationText: string
  countText: string
  plusLabel: string
  remainText: string
  accessTagStyle: string
  typeTagStyle: string
}

/** With an avatar stack the count reads as the remainder beyond the shown avatars (“+45参加”). */
function participantCountText(event: MipEventListItem) {
  const shown = event.participantPreview?.length ?? 0
  const count = event.registrationCount ?? 0
  return shown > 0 ? `+${Math.max(count - shown, 0)}参加` : `${count}参加`
}

/** The pill splits the leading “+” (smaller type) from the remainder text. */
function participantRemainText(event: MipEventListItem) {
  const shown = event.participantPreview?.length ?? 0
  const count = event.registrationCount ?? 0
  return shown > 0 ? `${Math.max(count - shown, 0)}参加` : `${count}参加`
}

/** OrderTag presets — skill contract wechat-component-contracts.md `OrderTag`. */
const ORDER_TAG_PRESETS: Record<string, { bg: string, border: string, color: string }> = {
  仅玩家: { bg: '#fde530', border: '#d0b801', color: '#000000' },
  沙龙: { bg: '#428bff', border: '#075adf', color: '#f7f7f7' },
}

function orderTagStyle(label: string) {
  const preset = ORDER_TAG_PRESETS[label]
  if (!preset) {
    return ''
  }
  return `background:${preset.bg};border-color:${preset.border};color:${preset.color}`
}

function accessLabel(event: MipEventListItem) {
  if (event.accessType === 'MEMBER_INCLUDED') {
    return '仅玩家'
  }
  if (event.accessType === 'PAID') {
    return '付费活动'
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

export function presentEventCard(event: MipEventListItem): EventCardView {
  return {
    ...event,
    coverUrl: event.coverUrl || '',
    startsText: formatChineseDateTime(event.startsAt),
    accessLabel: accessLabel(event),
    statusLabel: statusLabel(event),
    countText: participantCountText(event),
    plusLabel: (event.participantPreview?.length ?? 0) > 0 ? '+' : '',
    remainText: participantRemainText(event),
    accessTagStyle: orderTagStyle(accessLabel(event)),
    typeTagStyle: orderTagStyle(publicEventTypeLabel(event.eventTypeLabel)),
    locationText: [event.cityName, event.venueName].filter(Boolean).join(' · ') || '地点待公布',
    eventTypeLabel: publicEventTypeLabel(event.eventTypeLabel),
  }
}
