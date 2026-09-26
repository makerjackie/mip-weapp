import type { AdminRequest } from './admin-read-contracts'

export interface ProfileCard {
  id: string
  name: string
  nickname: string
  headline: string
  companies: Array<{ name?: string; role?: string }>
  identityStatus: string
  avatarUrl: string
  profileVersion: number
  status: 'ACTIVE' | 'TAKEN_DOWN'
  version: number
  reason: string
}
export interface CardTemplate {
  id: string
  name: string
  requiredFields: string[]
  sortOrder: number
  status: 'ACTIVE' | 'INACTIVE'
  version: number
}
export interface CardHistory { version: number; snapshot: Record<string, unknown>; createdAt: string }
export interface CardPage<T> { items: T[]; nextCursor: string | null }
export const cardTemplatePreviews: Record<string, string> = {
  PINK: '/card-templates/card-bg-a.webp', BLUE: '/card-templates/card-bg-b.webp',
  WHITE: '/card-templates/card-bg-c.webp', YELLOW: '/card-templates/card-bg-d.webp',
}
export const cardRequiredFields = [
  { value: 'name', label: '姓名' }, { value: 'avatar', label: '头像' }, { value: 'company', label: '公司' },
  { value: 'position', label: '职位' }, { value: 'contact', label: '至少一项公开联系方式' },
]
export function profileCardsModule(request: AdminRequest) {
  return {
    list: (query: string, cursor?: string) => request<CardPage<ProfileCard>>('mip.admin.cards.list', { cardType: 'PROFILE', query, cursor, limit: 20 }),
    templates: () => request<CardPage<CardTemplate>>('mip.admin.cards.list', { cardType: 'TEMPLATE' }),
    history: (cardId: string, cursor?: string) => request<CardPage<CardHistory>>('mip.admin.cards.history', { cardId, cursor, limit: 20 }),
    saveTemplate: (item: CardTemplate, fields: Pick<CardTemplate, 'name' | 'sortOrder' | 'requiredFields'>, idempotencyKey: string) => request('mip.admin.cards.save', { cardType: 'TEMPLATE', cardId: item.id, expectedVersion: item.version, fields, idempotencyKey }),
    setTemplateStatus: (item: CardTemplate, idempotencyKey: string) => request('mip.admin.cards.changeStatus', { cardId: item.id, expectedVersion: item.version, status: item.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE', idempotencyKey }),
    moderate: (item: ProfileCard, reason: string, idempotencyKey: string) => item.status === 'TAKEN_DOWN'
      ? request('mip.admin.cards.changeStatus', { cardId: item.id, cardType: 'PROFILE', expectedVersion: item.version, status: 'ACTIVE', idempotencyKey })
      : request('mip.admin.cards.takedown', { cardId: item.id, expectedVersion: item.version, reason, idempotencyKey }),
  }
}

export function cardHistoryFields(snapshot: Record<string, unknown>): Array<{ label: string; value: string }> {
  const organizations = (value: unknown) => Array.isArray(value) ? value.map(item => item && typeof item === 'object'
    ? [item.name, item.role].filter(value => typeof value === 'string').join(' · ') : '').filter(Boolean).join(' / ') : ''
  const text = (value: unknown) => typeof value === 'string' ? value : ''
  return [
    { label: '姓名', value: text(snapshot.realName) || text(snapshot.nickname) },
    { label: '昵称', value: text(snapshot.nickname) }, { label: '职位简介', value: text(snapshot.headline) },
    { label: '公司与职位', value: organizations(snapshot.companies) },
    { label: '组织与职务', value: organizations(snapshot.organizations) },
    { label: 'MIP 身份', value: text(snapshot.identityStatus) },
  ]
}
