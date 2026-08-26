'use strict'

const { CAPABILITIES, visibilityForCapability } = require('./capabilities')
const { decodeCursor } = require('./pagination')
const { AdminError, text } = require('./validation')

const pageSizes = new Set([10, 20, 50, 100])

function createAdminBenefitLedger({ repository, access }) {
  async function listUnifiedBenefitLedger(caller, input = {}) {
    const context = await access.session(caller)
    const hasMembershipRead = context.capabilities.some(item => item.capability === CAPABILITIES.MEMBERSHIPS_READ)
    const hasGrowthRead = context.capabilities.some(item => item.capability === CAPABILITIES.GROWTH_READ)
    if (!hasMembershipRead && !hasGrowthRead) {
      throw new AdminError('FORBIDDEN', '当前账号没有查看权益流水的权限')
    }
    const request = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
    const filters = normalizeFilters(request.filters)
    const pageSize = normalizePageSize(request.limit)
    return pageResult(await repository.listUnifiedBenefitLedger({
      appId: context.caller.appId,
      membershipVisibility: visibilityForCapability(context.bindings, CAPABILITIES.MEMBERSHIPS_READ),
      growthVisibility: visibilityForCapability(context.bindings, CAPABILITIES.GROWTH_READ),
      filters,
      pageSize,
      cursor: decodeCursor(request.cursor, ['createdAt', 'sourceId']),
    }))
  }

  return { listUnifiedBenefitLedger }
}

function normalizeFilters(value) {
  const filters = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const benefitType = filters.benefitType === undefined || filters.benefitType === ''
    ? ''
    : typeof filters.benefitType === 'string' ? filters.benefitType.trim().toUpperCase() : ''
  if (!['', 'MEMBERSHIP', 'GROWTH'].includes(benefitType)) {
    throw new AdminError('VALIDATION_FAILED', '权益类型无效')
  }
  const createdFrom = dateTimeFilter(filters.createdFrom, '开始时间')
  const createdTo = dateTimeFilter(filters.createdTo, '结束时间')
  if (createdFrom && createdTo && createdFrom > createdTo) {
    throw new AdminError('VALIDATION_FAILED', '权益流水开始时间不能晚于结束时间')
  }
  return {
    benefitType,
    query: text(filters.query, 80),
    createdFrom,
    createdTo,
  }
}

function normalizePageSize(value) {
  const pageSize = value === undefined || value === null || value === '' ? 20 : Number(value)
  if (!Number.isInteger(pageSize) || !pageSizes.has(pageSize)) {
    throw new AdminError('VALIDATION_FAILED', '分页数量必须为 10、20、50 或 100')
  }
  return pageSize
}

function dateTimeFilter(value, label) {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value !== 'string' || value.length > 40) {
    throw new AdminError('VALIDATION_FAILED', `${label}无效`)
  }
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw new AdminError('VALIDATION_FAILED', `${label}无效`)
  return date.toISOString().slice(0, 23).replace('T', ' ')
}

function pageResult(value) {
  if (Array.isArray(value)) return { items: value, nextCursor: null }
  return {
    items: Array.isArray(value?.items) ? value.items : [],
    nextCursor: typeof value?.nextCursor === 'string' ? value.nextCursor : null,
  }
}

module.exports = { createAdminBenefitLedger, normalizePageSize }
