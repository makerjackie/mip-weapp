import type {
  AnnouncementDetail,
  AnnouncementListQuery,
  AnnouncementPage,
  AnnouncementScopeType,
  AnnouncementSummary,
  AnnouncementTargetType,
} from './types'

export interface AnnouncementTransport {
  invoke: (action: string, data?: Record<string, unknown>) => Promise<unknown>
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('公告服务返回了无效响应')
  }
  return value as Record<string, unknown>
}

function requiredText(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError('公告服务返回了无效响应')
  }
  return value
}

function optionalText(value: unknown) {
  return typeof value === 'string' && value ? value : undefined
}

function iso(value: unknown) {
  const text = requiredText(value)
  if (Number.isNaN(Date.parse(text))) {
    throw new TypeError('公告服务返回了无效响应')
  }
  return text
}

function summaryDto(value: unknown): AnnouncementSummary {
  const source = record(value)
  const scopeType = String(source.scopeType)
  const targetType = optionalText(source.targetType)
  const targetId = optionalText(source.targetId)
  if (typeof source.isPinned !== 'boolean'
    || !['PLATFORM', 'BRANCH'].includes(scopeType)
    || Boolean(targetType) !== Boolean(targetId)
    || (targetType && !['EVENT', 'OPPORTUNITY'].includes(targetType))) {
    throw new TypeError('公告服务返回了无效响应')
  }
  return {
    id: requiredText(source.id),
    title: requiredText(source.title),
    summary: requiredText(source.summary),
    isPinned: source.isPinned,
    publishedAt: iso(source.publishedAt),
    scopeType: scopeType as AnnouncementScopeType,
    ...(optionalText(source.visibleUntil) ? { visibleUntil: iso(source.visibleUntil) } : {}),
    ...(optionalText(source.branchName) ? { branchName: optionalText(source.branchName) } : {}),
    ...(targetType && targetId
      ? { targetType: targetType as AnnouncementTargetType, targetId }
      : {}),
  }
}

function pageDto(value: unknown): AnnouncementPage {
  const source = record(value)
  if (!Array.isArray(source.items)) {
    throw new TypeError('公告服务返回了无效响应')
  }
  return {
    items: source.items.map(summaryDto),
    ...(optionalText(source.nextCursor) ? { nextCursor: optionalText(source.nextCursor) } : {}),
  }
}

function detailDto(value: unknown): AnnouncementDetail {
  const source = record(value)
  return { ...summaryDto(source), body: requiredText(source.body) }
}

export function createAnnouncementGateway(transport: AnnouncementTransport) {
  return {
    list(input: AnnouncementListQuery = {}) {
      return transport.invoke('listAnnouncements', {
        branchId: input.branchId,
        cursor: input.cursor,
        limit: input.limit,
      }).then(pageDto)
    },
    get(announcementId: string) {
      return transport.invoke('getAnnouncement', { announcementId }).then(detailDto)
    },
  }
}
