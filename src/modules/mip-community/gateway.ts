import type {
  BlockedProfile,
  BlockedProfilePage,
  BlockMutationResult,
  CommunityRelationship,
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
  }
}
