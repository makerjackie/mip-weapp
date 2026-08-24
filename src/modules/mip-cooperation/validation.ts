import type { CooperationCardDraft, CooperationCardFilter } from './types'
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
    cursor: optionalText(value.cursor, 512, '分页位置'),
    limit: Math.min(30, Math.max(1, Math.trunc(value.limit || 16))),
  }
}
