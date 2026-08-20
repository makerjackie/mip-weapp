import type { EventDetail } from './types'

type EventPresentationSource = Pick<
  EventDetail,
  'eventMode' | 'registrationMode' | 'memberFree' | 'priceCents' | 'capacity' | 'registrationCount'
>

export function eventFeatureTags(event: EventPresentationSource) {
  const mode = event.eventMode === 'ONLINE'
    ? '线上活动'
    : event.eventMode === 'HYBRID' ? '线上线下' : '线下活动'
  const registration = event.registrationMode === 'APPROVAL' ? '报名需审核' : '即时确认'
  const access = event.memberFree ? '会员免费' : event.priceCents > 0 ? '付费活动' : '免费活动'
  return [mode, registration, access]
}

export function eventAvailabilityText(event: EventPresentationSource) {
  if (event.capacity === null) {
    return `已有 ${event.registrationCount} 人报名`
  }
  const remaining = Math.max(event.capacity - event.registrationCount, 0)
  return remaining > 0 ? `剩余 ${remaining} 个名额` : '名额已满'
}

export function eventDescriptionNeedsExpansion(description: string) {
  const content = description.trim()
  return content.length > 72 || content.includes('\n')
}

export function eventSummaryText(summary: string, description: string) {
  const preferred = summary.trim()
  if (preferred) {
    return preferred
  }
  const normalized = description.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return ''
  }
  const firstSentence = normalized.split(/[。！？!?]/, 1)[0]
  return firstSentence.length > 52 ? `${firstSentence.slice(0, 52)}…` : firstSentence
}
