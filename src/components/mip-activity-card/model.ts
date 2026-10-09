import type { EventRecapCard, EventVideoRecap, MipEventListItem } from '../../modules/mip-events'
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
}

/**
 * 头像 stack 的人数标签。registrationCount 与头像预览同是公开参与者口径（服务端保证），
 * 头像之外还有剩余读「+N参加」；全部出镜时读「N人参加」，避免出现「+0参加」。
 */
function participantLabelParts(event: MipEventListItem) {
  const shown = event.participantPreview?.length ?? 0
  const count = event.registrationCount ?? 0
  const remainder = Math.max(count - shown, 0)
  if (shown <= 0) {
    return { plus: '', label: `${count}参加` }
  }
  return remainder > 0
    ? { plus: '+', label: `${remainder}参加` }
    : { plus: '', label: `${count}人参加` }
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
  const { plus, label } = participantLabelParts(event)
  return {
    ...event,
    coverUrl: event.coverUrl || '',
    startsText: formatChineseDateTime(event.startsAt),
    accessLabel: accessLabel(event),
    statusLabel: statusLabel(event),
    countText: `${plus}${label}`,
    plusLabel: plus,
    remainText: label,
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
