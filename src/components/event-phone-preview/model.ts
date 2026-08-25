export interface EventPhonePreviewMediaDraft {
  imageUrl?: string
  caption?: string
}

export interface EventPhonePreviewDraft {
  scopeType?: string
  title?: string
  summary?: string
  description?: string
  notices?: string
  eventMode?: string
  accessType?: string
  priceYuan?: string | number
  venueName?: string
  address?: string
  cityName?: string
  contentMedia?: EventPhonePreviewMediaDraft[]
}

export interface EventPhonePreviewInput {
  draft: EventPhonePreviewDraft
  coverUrl?: string
  branchName?: string
  startsDate?: string
  startsTime?: string
  endsDate?: string
  endsTime?: string
}

export interface EventPhonePreviewModel {
  coverUrl: string
  scopeLabel: string
  modeLabel: string
  accessLabel: string
  title: string
  summary: string
  timeText: string
  locationText: string
  description: string
  notices: string
  contentMedia: Array<{ imageUrl: string, caption: string }>
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function dateParts(value: unknown) {
  const match = text(value).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) {
    return null
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null
  }
  return { day, month, value: match[0], weekday: date.getUTCDay(), year }
}

function timePart(value: unknown) {
  const normalized = text(value)
  const match = normalized.match(/^(\d{2}):(\d{2})$/)
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
    return ''
  }
  return normalized
}

function dateLabel(value: ReturnType<typeof dateParts>) {
  if (!value) {
    return ''
  }
  const weekdays = ['日', '一', '二', '三', '四', '五', '六']
  return `${value.year}年${value.month}月${value.day}日 周${weekdays[value.weekday]}`
}

export function formatEventPreviewTime(
  startsDate: unknown,
  startsTime: unknown,
  endsDate: unknown,
  endsTime: unknown,
) {
  const startDate = dateParts(startsDate)
  const startTime = timePart(startsTime)
  if (!startDate || !startTime) {
    return '活动时间待定'
  }
  const endDate = dateParts(endsDate)
  const endTime = timePart(endsTime)
  if (!endDate || !endTime) {
    return `${dateLabel(startDate)} ${startTime}`
  }
  if (endDate.value === startDate.value) {
    return `${dateLabel(startDate)} ${startTime}–${endTime}`
  }
  return `${dateLabel(startDate)} ${startTime} 至 ${dateLabel(endDate)} ${endTime}`
}

export function formatEventPreviewLocation(draft: EventPhonePreviewDraft) {
  const mode = text(draft.eventMode)
  if (mode === 'ONLINE') {
    return '线上活动'
  }
  const venueName = text(draft.venueName)
  const address = text(draft.address)
  const cityName = text(draft.cityName)
  const offlineLocation = venueName && address
    ? `${venueName} · ${address}`
    : venueName || address || cityName
  if (mode === 'HYBRID') {
    return offlineLocation ? `${offlineLocation} · 线上同步` : '线上与线下'
  }
  return offlineLocation || '地点待定'
}

export function formatEventPreviewAccess(draft: EventPhonePreviewDraft) {
  if (draft.accessType === 'MEMBER_INCLUDED') {
    return '玩家权益包含'
  }
  if (draft.accessType === 'PAID') {
    const price = text(String(draft.priceYuan ?? ''))
    if (/^\d+(?:\.\d{1,2})?$/.test(price) && Number(price) > 0) {
      return `¥${Number(price).toFixed(2)} 报名`
    }
    return '付费报名'
  }
  return '免费报名'
}

export function buildEventPhonePreview(input: EventPhonePreviewInput): EventPhonePreviewModel {
  const draft = input.draft || {}
  return {
    coverUrl: text(input.coverUrl),
    scopeLabel: draft.scopeType === 'BRANCH'
      ? text(input.branchName) || '城市分会活动'
      : '平台活动',
    modeLabel: draft.eventMode === 'ONLINE'
      ? '线上'
      : draft.eventMode === 'HYBRID' ? '线上与线下' : '线下',
    accessLabel: formatEventPreviewAccess(draft),
    title: text(draft.title) || '未填写活动名称',
    summary: text(draft.summary) || '暂未填写活动摘要',
    timeText: formatEventPreviewTime(
      input.startsDate,
      input.startsTime,
      input.endsDate,
      input.endsTime,
    ),
    locationText: formatEventPreviewLocation(draft),
    description: text(draft.description) || '暂未填写活动介绍',
    notices: text(draft.notices) || '暂未填写报名须知',
    contentMedia: Array.isArray(draft.contentMedia)
      ? draft.contentMedia
          .map(item => ({ imageUrl: text(item?.imageUrl), caption: text(item?.caption) }))
          .filter(item => Boolean(item.imageUrl))
      : [],
  }
}
