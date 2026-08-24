import type { BranchId, CooperationRoleKey } from '../mip'
import type {
  OpportunityDraft,
  OpportunityFilter,
  OpportunityTag,
  PeopleFilter,
  PeoplePage,
  PublicPerson,
  PublicProfileAggregate,
  PublicProfileBadge,
  PublicProfileCooperationCard,
  PublicProfileOpportunity,
  PublicProfileSuperCase,
} from './types'
import { isCooperationRoleKey } from '../mip'

function text(value: unknown, maximum: number, field: string, required = true) {
  const result = typeof value === 'string' ? value.trim() : ''
  if ((required && !result) || result.length > maximum) {
    throw new Error(`${field}格式不正确`)
  }
  return result
}

function uniqueStrings(value: unknown, maximum: number, field: string) {
  if (!Array.isArray(value)) {
    return []
  }
  const result = [...new Set(value.map(item => String(item).trim()).filter(Boolean))]
  if (result.length > maximum || result.some(item => item.length > 64)) {
    throw new Error(`${field}格式不正确`)
  }
  return result
}

function profileRefs(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }
  const result = [...new Set(value.map(item => String(item).trim()).filter(Boolean))]
  if (result.length > 8 || result.some(item => item.length < 20 || item.length > 200 || !item.startsWith('p1.'))) {
    throw new Error('团队成员格式不正确')
  }
  return result
}

export function normalizeOpportunityDraft(value: OpportunityDraft): OpportunityDraft {
  const roleKeys = uniqueStrings(value.roleKeys, 6, '合作角色')
  if (!roleKeys.length || !roleKeys.every(isCooperationRoleKey)) {
    throw new Error('请选择至少一种合作角色')
  }
  const scopeType = value.scopeType === 'BRANCH' ? 'BRANCH' : 'PLATFORM'
  if (scopeType === 'BRANCH' && !value.branchId) {
    throw new Error('请选择城市分会')
  }
  return {
    ...value,
    title: text(value.title, 120, '机会标题'),
    valueSummary: text(value.valueSummary, 240, '机会价值'),
    targetSummary: text(value.targetSummary, 500, '寻找内容'),
    description: text(value.description, 6000, '机会说明'),
    scopeType,
    branchId: scopeType === 'BRANCH' ? value.branchId : undefined,
    cityTagId: text(value.cityTagId, 64, '城市', false) || undefined,
    coverAssetId: text(value.coverAssetId, 64, '封面', false) || undefined,
    roleKeys: roleKeys as CooperationRoleKey[],
    industryTagIds: uniqueStrings(value.industryTagIds, 8, '行业标签'),
    abilityTagIds: uniqueStrings(value.abilityTagIds, 8, '能力标签'),
    teamProfileRefs: profileRefs(value.teamProfileRefs),
    expectedVersion: value.expectedVersion === undefined
      ? undefined
      : Math.max(1, Math.trunc(value.expectedVersion)),
    publish: Boolean(value.publish),
  }
}

export function normalizeOpportunityFilter(value: OpportunityFilter): OpportunityFilter {
  return {
    status: value.status === 'COMPLETED' ? 'COMPLETED' : 'RECRUITING',
    keyword: text(value.keyword, 80, '关键词', false) || undefined,
    cityTagId: text(value.cityTagId, 64, '城市', false) || undefined,
    branchId: value.branchId,
    roleKey: value.roleKey && isCooperationRoleKey(value.roleKey) ? value.roleKey : undefined,
    industryTagIds: uniqueStrings(value.industryTagIds, 8, '行业标签'),
    abilityTagIds: uniqueStrings(value.abilityTagIds, 8, '能力标签'),
    cursor: text(value.cursor, 512, '分页位置', false) || undefined,
    limit: Math.min(30, Math.max(1, Math.trunc(value.limit || 12))),
  }
}

export function normalizePeopleFilter(value: PeopleFilter): PeopleFilter {
  const scope = value.scope === 'PLAYER' || (!value.scope && value.kind === 'PLAYER')
    ? 'PLAYER'
    : 'GLOBAL'
  return {
    scope,
    keyword: text(value.keyword, 80, '关键词', false) || undefined,
    branchId: value.branchId,
    roleKey: value.roleKey && isCooperationRoleKey(value.roleKey) ? value.roleKey : undefined,
    industryTagIds: uniqueStrings(value.industryTagIds, 8, '行业标签'),
    abilityTagIds: uniqueStrings(value.abilityTagIds, 8, '能力标签'),
    cursor: text(value.cursor, 768, '分页位置', false) || undefined,
    limit: Math.min(30, Math.max(1, Math.trunc(value.limit || 20))),
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('人才服务返回了无效响应')
  }
  return value as Record<string, unknown>
}

function responseText(value: unknown, maximum: number, required = false) {
  const result = typeof value === 'string' ? value.trim() : ''
  if ((required && !result) || result.length > maximum) {
    throw new Error('人才服务返回了无效响应')
  }
  return result
}

function responseDate(value: unknown) {
  const source = responseText(value, 40, true)
  const date = new Date(source)
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError('人才服务返回了无效响应')
  }
  return date.toISOString()
}

function responseId(value: unknown) {
  const result = responseText(value, 64, true)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result)) {
    throw new Error('人才服务返回了无效响应')
  }
  return result
}

function publicTag(value: unknown): OpportunityTag {
  const source = record(value)
  return {
    id: responseId(source.id),
    key: responseText(source.key, 80, true),
    label: responseText(source.label, 80, true),
  }
}

function publicTags(value: unknown) {
  if (!Array.isArray(value) || value.length > 32) {
    throw new Error('人才服务返回了无效响应')
  }
  return value.map(publicTag)
}

function publicOrganizations(value: unknown) {
  if (!Array.isArray(value) || value.length > 12) {
    throw new Error('人才服务返回了无效响应')
  }
  return value.map((item) => {
    const source = record(item)
    const role = responseText(source.role, 80)
    return {
      name: responseText(source.name, 120, true),
      ...(role ? { role } : {}),
    }
  })
}

function publicBadges(value: unknown): PublicProfileBadge[] {
  if (value === undefined) {
    return []
  }
  if (!Array.isArray(value) || value.length > 3) {
    throw new Error('人才服务返回了无效响应')
  }
  const slots = new Set<number>()
  return value.map((item) => {
    const source = record(item)
    const equippedSlot = Number(source.equippedSlot)
    const placeholderShape = String(source.placeholderShape)
    if (!Number.isInteger(equippedSlot) || equippedSlot < 1 || equippedSlot > 3
      || slots.has(equippedSlot)
      || !['CIRCLE', 'DIAMOND', 'HEXAGON'].includes(placeholderShape)) {
      throw new Error('人才服务返回了无效响应')
    }
    slots.add(equippedSlot)
    const iconName = responseText(source.iconName, 64)
    const imageUrl = responseText(source.imageUrl, 1024)
    return {
      id: responseId(source.id),
      key: responseText(source.key, 80, true),
      name: responseText(source.name, 100, true),
      description: responseText(source.description, 500),
      ...(iconName ? { iconName } : {}),
      ...(imageUrl ? { imageUrl } : {}),
      placeholderShape: placeholderShape as PublicProfileBadge['placeholderShape'],
      equippedSlot,
    }
  }).sort((left, right) => left.equippedSlot - right.equippedSlot)
}

export function parsePublicPerson(value: unknown): PublicPerson {
  const source = record(value)
  const profileRef = responseText(source.profileRef, 200, true)
  if (!profileRef.startsWith('p1.')
    || typeof source.isSelf !== 'boolean'
    || !['PLAYER', 'GUEST'].includes(String(source.userKind))) {
    throw new Error('人才服务返回了无效响应')
  }
  const branchSource = source.primaryBranch === undefined ? null : record(source.primaryBranch)
  const nickname = responseText(source.nickname, 64)
  const avatarUrl = responseText(source.avatarUrl, 1024)
  const identityStatus = responseText(source.identityStatus, 32)
  const headline = responseText(source.headline, 160)
  const introduction = responseText(source.introduction, 600)
  return {
    profileRef,
    isSelf: source.isSelf,
    userKind: source.userKind as PublicPerson['userKind'],
    joinedAt: responseDate(source.joinedAt),
    ...(nickname ? { nickname } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(identityStatus ? { identityStatus } : {}),
    ...(headline ? { headline } : {}),
    ...(introduction ? { introduction } : {}),
    ...(source.companies !== undefined ? { companies: publicOrganizations(source.companies) } : {}),
    ...(source.organizations !== undefined ? { organizations: publicOrganizations(source.organizations) } : {}),
    ...(source.primaryIndustry !== undefined ? { primaryIndustry: publicTag(source.primaryIndustry) } : {}),
    ...(source.abilities !== undefined ? { abilities: publicTags(source.abilities) } : {}),
    ...(branchSource
      ? {
          primaryBranch: {
            id: responseId(branchSource.id) as BranchId,
            name: responseText(branchSource.name, 80, true),
            cityName: responseText(branchSource.cityName, 80, true),
          },
        }
      : {}),
    badges: publicBadges(source.badges),
  }
}

export function parsePeoplePage(value: unknown): PeoplePage {
  const source = record(value)
  if (!Array.isArray(source.items) || source.items.length > 30) {
    throw new Error('人才服务返回了无效响应')
  }
  const nextCursor = responseText(source.nextCursor, 768)
  return {
    items: source.items.map(parsePublicPerson),
    ...(nextCursor ? { nextCursor } : {}),
  }
}

function abilityScores(value: unknown) {
  const source = record(value)
  return Object.fromEntries(Object.entries(source).flatMap(([key, raw]) => {
    const score = Number(raw)
    return /^[a-z][a-z0-9_]{0,63}$/.test(key) && Number.isInteger(score) && score >= 0 && score <= 5
      ? [[key, score]]
      : []
  }).slice(0, 24))
}

function cooperationCard(value: unknown): PublicProfileCooperationCard {
  const source = record(value)
  const roleKey = String(source.roleKey || '')
  if (!isCooperationRoleKey(roleKey) || source.status !== 'PUBLISHED') {
    throw new Error('人才服务返回了无效响应')
  }
  return {
    id: responseId(source.id),
    roleKey,
    positioning: responseText(source.positioning, 500, true),
    targetSummary: responseText(source.targetSummary, 500, true),
    abilityScores: abilityScores(source.abilityScores),
    status: 'PUBLISHED',
    publishedAt: responseDate(source.publishedAt),
  }
}

function superCase(value: unknown): PublicProfileSuperCase {
  const source = record(value)
  if (source.status !== 'PUBLISHED') {
    throw new Error('人才服务返回了无效响应')
  }
  const optional = (key: string, maximum: number) => responseText(source[key], maximum)
  return {
    id: responseId(source.id),
    projectName: responseText(source.projectName, 120, true),
    summary: responseText(source.summary, 240, true),
    responsibility: responseText(source.responsibility, 500, true),
    ...(optional('caseType', 80) ? { caseType: optional('caseType', 80) } : {}),
    ...(optional('cityLabel', 80) ? { cityLabel: optional('cityLabel', 80) } : {}),
    ...(optional('industryLabel', 80) ? { industryLabel: optional('industryLabel', 80) } : {}),
    ...(optional('coverUrl', 1024) ? { coverUrl: optional('coverUrl', 1024) } : {}),
    status: 'PUBLISHED',
    publishedAt: responseDate(source.publishedAt),
  }
}

function profileOpportunity(value: unknown): PublicProfileOpportunity {
  const source = record(value)
  if (source.status !== 'PUBLISHED' || !Number.isInteger(source.referralCount) || Number(source.referralCount) < 0) {
    throw new Error('人才服务返回了无效响应')
  }
  const branchName = responseText(source.branchName, 80)
  const cityLabel = responseText(source.cityLabel, 80)
  const coverUrl = responseText(source.coverUrl, 1024)
  return {
    id: responseId(source.id) as PublicProfileOpportunity['id'],
    title: responseText(source.title, 120, true),
    valueSummary: responseText(source.valueSummary, 240, true),
    targetSummary: responseText(source.targetSummary, 500, true),
    referralCount: Number(source.referralCount),
    ...(branchName ? { branchName } : {}),
    ...(cityLabel ? { cityLabel } : {}),
    ...(coverUrl ? { coverUrl } : {}),
    status: 'PUBLISHED',
    publishedAt: responseDate(source.publishedAt),
  }
}

export function parseProfileInfluence(value: unknown) {
  const source = record(value)
  const counts = [
    source.guestCount,
    source.interactionCount,
    source.interestCount,
    source.visitorCount,
  ]
  if (counts.some(count => typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0)) {
    throw new Error('人才服务返回了无效响应')
  }
  return {
    guestCount: source.guestCount as number,
    interactionCount: source.interactionCount as number,
    interestCount: source.interestCount as number,
    visitorCount: source.visitorCount as number,
  }
}

export function parsePublicProfileAggregate(value: unknown): PublicProfileAggregate {
  const source = record(value)
  if (!Array.isArray(source.cooperationCards)
    || !Array.isArray(source.superCases)
    || !Array.isArray(source.opportunities)
    || source.cooperationCards.length > 6
    || source.superCases.length > 200
    || source.opportunities.length > 200
    || typeof source.interestActive !== 'boolean') {
    throw new Error('人才服务返回了无效响应')
  }
  return {
    profile: parsePublicPerson(source.profile),
    cooperationCards: source.cooperationCards.map(cooperationCard),
    superCases: source.superCases.map(superCase),
    opportunities: source.opportunities.map(profileOpportunity),
    interestActive: source.interestActive,
    ...(source.influence === undefined ? {} : { influence: parseProfileInfluence(source.influence) }),
  }
}

export function createMutationKey(prefix: string) {
  const random = Math.random().toString(36).slice(2, 12)
  return `${prefix}:${Date.now().toString(36)}:${random}`
}
