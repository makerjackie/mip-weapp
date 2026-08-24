import type { CooperationRoleKey } from '../mip'
import type { OpportunityDraft, OpportunityFilter } from './types'
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

export function createMutationKey(prefix: string) {
  const random = Math.random().toString(36).slice(2, 12)
  return `${prefix}:${Date.now().toString(36)}:${random}`
}
