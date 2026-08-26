import type {
  AdminCapabilityGrant,
  AdminEvent,
  AdminEventVideoRecap,
} from '../../../modules/mip-admin'
import { formatLocalDateTime } from '../../../utils/date'

export type EventVideoRecapView = AdminEventVideoRecap & {
  statusText: string
  statusTheme: 'default' | 'success' | 'warning'
  destinationText: string
  updatedText: string
}

export type EventRecapEventOption = Pick<AdminEvent, 'id' | 'title' | 'status' | 'startsAt'> & {
  statusText: string
  startsText: string
}

export interface EventVideoRecapDraft {
  eventId: string
  title: string
  summary: string
  destinationType: AdminEventVideoRecap['destination']['type']
  finderUserName: string
  feedId: string
  sortOrder: string
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const destinationTokenPattern = /^[\w=:+/.-]+$/
const finderUserNamePattern = /^sph[A-Za-z0-9]+$/

export function validEventId(value: string) {
  return uuidPattern.test(value.trim())
}

export function hasPlatformRecapCapability(grants: AdminCapabilityGrant[]) {
  return grants.some(grant => (
    grant.capability === 'events.recaps.manage'
    && grant.scopeType === 'PLATFORM'
    && grant.scopeId === null
  ))
}

export function canReadRecapEventOptions(grants: AdminCapabilityGrant[]) {
  return grants.some(grant => grant.capability === 'events.read')
}

export function eventVideoRecapDraftError(draft: EventVideoRecapDraft) {
  const eventId = draft.eventId.trim()
  const title = draft.title.trim()
  const summary = draft.summary.trim()
  const finderUserName = draft.finderUserName.trim()
  const feedId = draft.feedId.trim()
  const sortOrder = Number(draft.sortOrder)
  if (!validEventId(eventId)) {
    return '请填写有效的活动 ID'
  }
  if (!title || title.length > 120) {
    return '标题需为 1–120 个字符'
  }
  if (summary.length > 300) {
    return '说明不能超过 300 个字符'
  }
  if (finderUserName.length < 4
    || finderUserName.length > 128
    || !finderUserNamePattern.test(finderUserName)) {
    return '视频号账号格式无效'
  }
  if (draft.destinationType === 'ACTIVITY'
    && (!feedId || feedId.length > 256 || !destinationTokenPattern.test(feedId))) {
    return '视频号活动目标需填写有效的内容标识'
  }
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 1_000_000) {
    return '显示顺序需为 0–1000000 的整数'
  }
  return ''
}

export function eventVideoRecapView(item: AdminEventVideoRecap): EventVideoRecapView {
  const destinationText = item.destination.type === 'PROFILE'
    ? `视频号主页 · ${item.destination.finderUserName}`
    : `视频号活动 · ${item.destination.finderUserName} · ${item.destination.feedId || ''}`
  return {
    ...item,
    statusText: item.status === 'ACTIVE' ? '已启用' : item.status === 'INACTIVE' ? '已停用' : '已归档',
    statusTheme: item.status === 'ACTIVE' ? 'success' : item.status === 'INACTIVE' ? 'warning' : 'default',
    destinationText,
    updatedText: formatLocalDateTime(item.updatedAt),
  }
}

export function eventRecapEventOption(item: AdminEvent): EventRecapEventOption {
  const statusText = {
    DRAFT: '草稿',
    PUBLISHED: '已发布',
    UNPUBLISHED: '已下架',
    CANCELLED: '已取消',
    ENDED: '已结束',
    ARCHIVED: '已归档',
  }[item.status]
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    startsAt: item.startsAt,
    statusText,
    startsText: formatLocalDateTime(item.startsAt),
  }
}
