import type {
  CooperationAuthor,
  CooperationCardDraft,
  CooperationCardFilter,
  CooperationTag,
  CooperationTalentCard,
  CooperationTalentPage,
  CooperationTalentSummary,
} from './types'
import { cooperationAbilityDimensions, cooperationRoles } from '../../config/mip-catalogs'
import { isCooperationRoleKey } from '../mip'

function optionalText(value: unknown, maximum: number, field: string) {
  const result = typeof value === 'string' ? value.trim() : ''
  if (result.length > maximum) {
    throw new Error(`${field}格式不正确`)
  }
  return result || undefined
}

function uniqueIds(value: unknown, maximum: number, field: string) {
  if (!Array.isArray(value)) {
    return []
  }
  const result = [...new Set(value.map(item => String(item).trim()).filter(Boolean))]
  if (result.length > maximum || result.some(item => !/^[0-9a-f-]{36}$/i.test(item))) {
    throw new Error(`${field}格式不正确`)
  }
  return result
}

export function normalizeAbilityScores(value: Record<string, number>) {
  const result: Record<string, number> = {}
  for (const dimension of cooperationAbilityDimensions) {
    const score = Number(value?.[dimension.key])
    result[dimension.key] = Number.isFinite(score)
      ? Math.min(5, Math.max(0, Math.round(score)))
      : 0
  }
  return result
}

export function normalizeCooperationCardDraft(value: CooperationCardDraft): CooperationCardDraft {
  if (!isCooperationRoleKey(value.roleKey)) {
    throw new Error('请选择合作角色')
  }
  const definition = cooperationRoles.find(item => item.key === value.roleKey)
  if (!definition) {
    throw new Error('合作角色配置不可用')
  }
  const positioning = String(value.positioning || '').trim()
  const targetSummary = String(value.targetSummary || '').trim()
  if (!positioning || positioning.length > 500) {
    throw new Error('角色定位需为 1 至 500 个字符')
  }
  if (!targetSummary || targetSummary.length > 500) {
    throw new Error('合作目标需为 1 至 500 个字符')
  }
  const roleFields: Record<string, string | string[] | number> = {}
  for (const field of definition.fields) {
    const raw = value.roleFields?.[field.key]
    const normalized = Array.isArray(raw)
      ? raw.map(item => String(item).trim()).filter(Boolean).slice(0, 12)
      : typeof raw === 'number' ? raw : String(raw || '').trim()
    if (field.required && (Array.isArray(normalized) ? !normalized.length : normalized === '')) {
      throw new Error(`请填写${field.label}`)
    }
    if (typeof normalized === 'string' && normalized.length > 1000) {
      throw new Error(`${field.label}内容过长`)
    }
    roleFields[field.key] = normalized
  }
  return {
    ...value,
    positioning,
    targetSummary,
    roleFields,
    abilityScores: normalizeAbilityScores(value.abilityScores),
    expectedVersion: value.expectedVersion === undefined
      ? undefined
      : Math.max(1, Math.trunc(value.expectedVersion)),
    publish: Boolean(value.publish),
  }
}

export function normalizeCooperationCardFilter(value: CooperationCardFilter = {}): CooperationCardFilter {
  const branchId = optionalText(value.branchId, 36, '城市分会')
  if (branchId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(branchId)) {
    throw new Error('城市分会格式不正确')
  }
  return {
    keyword: optionalText(value.keyword, 80, '关键词'),
    branchId: branchId as CooperationCardFilter['branchId'],
    roleKey: value.roleKey && isCooperationRoleKey(value.roleKey) ? value.roleKey : undefined,
    industryTagIds: uniqueIds(value.industryTagIds, 8, '行业标签'),
    cursor: optionalText(value.cursor, 768, '分页位置'),
    limit: Math.min(30, Math.max(1, Math.trunc(value.limit || 16))),
  }
}

function invalidTalentResponse(): never {
  throw new Error('人才服务返回了无效响应')
}

function responseRecord(value: unknown, allowedKeys: string[], requiredKeys: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalidTalentResponse()
  }
  const source = value as Record<string, unknown>
  const keys = Object.keys(source)
  if (keys.some(key => !allowedKeys.includes(key)) || requiredKeys.some(key => !(key in source))) {
    return invalidTalentResponse()
  }
  return source
}

function responseText(value: unknown, maximum: number, required = false) {
  if (typeof value !== 'string' || value.length > maximum || (required && !value)) {
    return invalidTalentResponse()
  }
  return value
}

function responseDate(value: unknown) {
  const source = responseText(value, 40, true)
  const date = new Date(source)
  if (!Number.isFinite(date.getTime())) {
    return invalidTalentResponse()
  }
  return date.toISOString()
}

function responseId(value: unknown) {
  const id = responseText(value, 36, true)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return invalidTalentResponse()
  }
  return id
}

function responseAbilityScores(value: unknown) {
  const source = responseRecord(
    value,
    cooperationAbilityDimensions.map(dimension => dimension.key),
    [],
  )
  const entries = Object.entries(source)
  if (entries.length > 24 || entries.some(([key, score]) => (
    !/^[a-z][a-z0-9_]{0,63}$/.test(key)
    || !Number.isInteger(score)
    || Number(score) < 0
    || Number(score) > 5
  ))) {
    return invalidTalentResponse()
  }
  return Object.fromEntries(entries) as Record<string, number>
}

function responseTag(value: unknown): CooperationTag {
  const source = responseRecord(value, ['id', 'key', 'label'], ['id', 'key', 'label'])
  return {
    id: responseId(source.id),
    key: responseText(source.key, 80, true),
    label: responseText(source.label, 80, true),
  }
}

function responseAuthor(value: unknown): Omit<CooperationAuthor, 'profileRef'> {
  const source = responseRecord(
    value,
    ['nickname', 'avatarUrl', 'headline', 'cityName', 'primaryIndustry'],
    ['nickname'],
  )
  const avatarUrl = source.avatarUrl === undefined ? '' : responseText(source.avatarUrl, 1024)
  const headline = source.headline === undefined ? '' : responseText(source.headline, 160)
  const cityName = source.cityName === undefined ? '' : responseText(source.cityName, 80)
  return {
    nickname: responseText(source.nickname, 64, true),
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(headline ? { headline } : {}),
    ...(cityName ? { cityName } : {}),
    ...(source.primaryIndustry === undefined ? {} : { primaryIndustry: responseTag(source.primaryIndustry) }),
  }
}

function responseTalentCard(value: unknown): CooperationTalentCard {
  const source = responseRecord(
    value,
    ['id', 'roleKey', 'positioning', 'targetSummary', 'abilityScores', 'publishedAt'],
    ['id', 'roleKey', 'positioning', 'targetSummary', 'abilityScores', 'publishedAt'],
  )
  const roleKey = String(source.roleKey || '')
  if (!isCooperationRoleKey(roleKey)) {
    return invalidTalentResponse()
  }
  return {
    id: responseId(source.id) as CooperationTalentCard['id'],
    roleKey,
    positioning: responseText(source.positioning, 500, true),
    targetSummary: responseText(source.targetSummary, 500, true),
    abilityScores: responseAbilityScores(source.abilityScores),
    publishedAt: responseDate(source.publishedAt),
  }
}

function responseTalent(value: unknown): CooperationTalentSummary {
  const source = responseRecord(
    value,
    ['talentKey', 'profileRef', 'author', 'joinedAt', 'cards'],
    ['talentKey', 'profileRef', 'author', 'joinedAt', 'cards'],
  )
  const talentKey = responseText(source.talentKey, 64, true)
  const profileRef = responseText(source.profileRef, 200, true)
  if (!/^mctk1\.[\w-]{43}$/.test(talentKey)
    || !/^p1\.[\w-]{16}\.[\w-]{48}\.[\w-]{22}$/.test(profileRef)
    || !Array.isArray(source.cards)
    || source.cards.length < 1
    || source.cards.length > 6) {
    return invalidTalentResponse()
  }
  const cards = source.cards.map(responseTalentCard)
  if (new Set(cards.map(card => card.id)).size !== cards.length
    || new Set(cards.map(card => card.roleKey)).size !== cards.length) {
    return invalidTalentResponse()
  }
  return {
    talentKey,
    profileRef,
    author: responseAuthor(source.author),
    joinedAt: responseDate(source.joinedAt),
    cards,
  }
}

export function parseCooperationTalentPage(value: unknown): CooperationTalentPage {
  const source = responseRecord(value, ['items', 'nextCursor'], ['items'])
  if (!Array.isArray(source.items) || source.items.length > 30) {
    return invalidTalentResponse()
  }
  const items = source.items.map(responseTalent)
  const nextCursor = source.nextCursor === undefined ? '' : responseText(source.nextCursor, 768)
  if ((nextCursor && !/^mct1\.[\w-]+\.[\w-]+\.[\w-]+$/.test(nextCursor))
    || new Set(items.map(item => item.talentKey)).size !== items.length
    || new Set(items.map(item => item.profileRef)).size !== items.length) {
    return invalidTalentResponse()
  }
  return { items, ...(nextCursor ? { nextCursor } : {}) }
}

export function mergeCooperationTalents<T extends Pick<CooperationTalentSummary, 'talentKey' | 'profileRef'>>(
  current: T[],
  incoming: T[],
) {
  const talentKeys = new Set(current.map(item => item.talentKey))
  const profileOwners = new Map(current.map(item => [item.profileRef, item.talentKey]))
  const result = [...current]
  for (const item of incoming) {
    const profileOwner = profileOwners.get(item.profileRef)
    if (profileOwner && profileOwner !== item.talentKey) {
      return invalidTalentResponse()
    }
    if (talentKeys.has(item.talentKey)) {
      continue
    }
    talentKeys.add(item.talentKey)
    profileOwners.set(item.profileRef, item.talentKey)
    result.push(item)
  }
  return result
}
