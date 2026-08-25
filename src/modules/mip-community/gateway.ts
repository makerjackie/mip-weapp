import type {
  BlockedProfile,
  BlockedProfilePage,
  BlockMutationResult,
  CommunityRelationship,
  EventComment,
  EventCommentPage,
  EventCommentStatus,
  EventCommentSubmissionInput,
  ReportCategory,
  ReportReceipt,
} from './types'

export interface CommunityTransport {
  invoke: (action: string, data?: Record<string, unknown>) => Promise<unknown>
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('社区安全服务返回了无效响应')
  }
  return value as Record<string, unknown>
}

function profileRef(value: unknown) {
  if (typeof value !== 'string' || !value.startsWith('p1.') || value.length > 200) {
    throw new Error('社区安全服务返回了无效响应')
  }
  return value
}

function optionalText(value: unknown) {
  return typeof value === 'string' && value ? value : undefined
}

function relationshipDto(value: unknown): CommunityRelationship {
  const source = record(value)
  if (typeof source.isSelf !== 'boolean' || typeof source.blocked !== 'boolean') {
    throw new TypeError('社区安全服务返回了无效响应')
  }
  return { profileRef: profileRef(source.profileRef), isSelf: source.isSelf, blocked: source.blocked }
}

function mutationDto(value: unknown): BlockMutationResult {
  const source = record(value)
  if (typeof source.blocked !== 'boolean'
    || typeof source.changed !== 'boolean'
    || !Number.isInteger(source.version)) {
    throw new TypeError('社区安全服务返回了无效响应')
  }
  return {
    profileRef: profileRef(source.profileRef),
    blocked: source.blocked,
    changed: source.changed,
    version: Number(source.version),
  }
}

function blockedProfileDto(value: unknown): BlockedProfile {
  const source = record(value)
  if (typeof source.nickname !== 'string' || typeof source.blockedAt !== 'string') {
    throw new TypeError('社区安全服务返回了无效响应')
  }
  return {
    profileRef: profileRef(source.profileRef),
    nickname: source.nickname,
    blockedAt: source.blockedAt,
    ...(optionalText(source.avatarUrl) ? { avatarUrl: optionalText(source.avatarUrl) } : {}),
    ...(optionalText(source.headline) ? { headline: optionalText(source.headline) } : {}),
    ...(optionalText(source.cityName) ? { cityName: optionalText(source.cityName) } : {}),
  }
}

function blockedPageDto(value: unknown): BlockedProfilePage {
  const source = record(value)
  if (!Array.isArray(source.items)) {
    throw new TypeError('社区安全服务返回了无效响应')
  }
  return {
    items: source.items.map(blockedProfileDto),
    ...(optionalText(source.nextCursor) ? { nextCursor: optionalText(source.nextCursor) } : {}),
  }
}

function receiptDto(value: unknown): ReportReceipt {
  const source = record(value)
  const statuses = new Set(['PENDING', 'REVIEWING', 'RESOLVED', 'DISMISSED'])
  if (typeof source.reportId !== 'string'
    || !statuses.has(String(source.status))
    || typeof source.idempotent !== 'boolean') {
    throw new TypeError('社区安全服务返回了无效响应')
  }
  return {
    reportId: source.reportId,
    status: source.status as ReportReceipt['status'],
    idempotent: source.idempotent,
  }
}

function eventCommentDto(value: unknown): EventComment {
  const source = record(value)
  const author = record(source.author)
  const statuses = new Set<EventCommentStatus>(['PENDING', 'PUBLISHED', 'HIDDEN', 'DELETED'])
  if (typeof source.id !== 'string'
    || typeof source.body !== 'string'
    || !statuses.has(source.status as EventCommentStatus)
    || typeof author.nickname !== 'string'
    || typeof author.headline !== 'string'
    || typeof author.avatarUrl !== 'string'
    || typeof source.mine !== 'boolean'
    || typeof source.canEdit !== 'boolean'
    || typeof source.canDelete !== 'boolean'
    || !Number.isInteger(source.version)) {
    throw new TypeError('社区安全服务返回了无效响应')
  }
  return {
    id: source.id,
    body: source.body,
    status: source.status as EventCommentStatus,
    author: {
      profileRef: profileRef(author.profileRef),
      nickname: author.nickname,
      headline: author.headline,
      avatarUrl: author.avatarUrl,
    },
    mine: source.mine,
    canEdit: source.canEdit,
    canDelete: source.canDelete,
    version: Number(source.version),
    ...(optionalText(source.createdAt) ? { createdAt: optionalText(source.createdAt) } : {}),
    ...(optionalText(source.editedAt) ? { editedAt: optionalText(source.editedAt) } : {}),
  }
}

function eventCommentPageDto(value: unknown): EventCommentPage {
  const source = record(value)
  const event = record(source.event)
  const settings = record(source.settings)
  if (typeof event.id !== 'string'
    || typeof event.title !== 'string'
    || !['PUBLISHED', 'CANCELLED', 'ENDED'].includes(String(event.status))
    || typeof settings.commentsEnabled !== 'boolean'
    || !['AUTO', 'REVIEW'].includes(String(settings.moderationMode))
    || !Number.isInteger(settings.version)
    || !Array.isArray(source.items)) {
    throw new TypeError('社区安全服务返回了无效响应')
  }
  return {
    event: {
      id: event.id,
      title: event.title,
      status: event.status as EventCommentPage['event']['status'],
    },
    settings: {
      commentsEnabled: settings.commentsEnabled,
      moderationMode: settings.moderationMode as EventCommentPage['settings']['moderationMode'],
      version: Number(settings.version),
    },
    items: source.items.map(eventCommentDto),
    ...(optionalText(source.nextCursor) ? { nextCursor: optionalText(source.nextCursor) } : {}),
  }
}

function commentMutationDto(value: unknown) {
  const source = record(value)
  if (typeof source.id !== 'string'
    || !['PENDING', 'PUBLISHED', 'DELETED'].includes(String(source.status))
    || !Number.isInteger(source.version)) {
    throw new TypeError('社区安全服务返回了无效响应')
  }
  return {
    id: source.id,
    status: source.status as 'PENDING' | 'PUBLISHED' | 'DELETED',
    version: Number(source.version),
  }
}

function commentReportDto(value: unknown) {
  const source = record(value)
  if (typeof source.reportId !== 'string' || source.status !== 'PENDING') {
    throw new TypeError('社区安全服务返回了无效响应')
  }
  return { reportId: source.reportId, status: 'PENDING' as const }
}

export function createMipCommunityGateway(transport: CommunityTransport) {
  return {
    async relationship(profileRefValue: string) {
      return relationshipDto(await transport.invoke('getRelationship', { profileRef: profileRefValue }))
    },
    async block(profileRefValue: string) {
      return mutationDto(await transport.invoke('blockProfile', { profileRef: profileRefValue }))
    },
    async unblock(profileRefValue: string) {
      return mutationDto(await transport.invoke('unblockProfile', { profileRef: profileRefValue }))
    },
    async listBlocked(cursor?: string) {
      return blockedPageDto(await transport.invoke('listBlocked', { cursor, limit: 20 }))
    },
    async report(input: {
      profileRef: string
      category: string
      description: string
      requestId: string
    }) {
      return receiptDto(await transport.invoke('reportProfile', input))
    },
    async listEventComments(eventId: string, cursor?: string) {
      return eventCommentPageDto(await transport.invoke('listEventComments', {
        eventId,
        cursor,
        limit: 20,
      }))
    },
    async saveEventComment(input: EventCommentSubmissionInput, idempotencyKey: string) {
      return commentMutationDto(await transport.invoke('saveEventComment', {
        ...input,
        idempotencyKey,
      }))
    },
    async deleteEventComment(
      eventId: string,
      commentId: string,
      expectedVersion: number,
      idempotencyKey: string,
    ) {
      return commentMutationDto(await transport.invoke('deleteEventComment', {
        eventId,
        commentId,
        expectedVersion,
        idempotencyKey,
      }))
    },
    async reportEventComment(input: {
      eventId: string
      commentId: string
      expectedVersion: number
      category: ReportCategory
      description: string
      requestId: string
      idempotencyKey: string
    }) {
      return commentReportDto(await transport.invoke('reportEventComment', input))
    },
  }
}
