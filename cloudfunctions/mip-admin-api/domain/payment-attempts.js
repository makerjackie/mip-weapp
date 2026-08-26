'use strict'

const { CAPABILITIES, firstGrant, visibilityForCapability } = require('./capabilities')
const { decodeCursor } = require('./pagination')
const { AdminError, text } = require('./validation')

const PAYMENT_PROVIDERS = ['WECHAT_PAY', 'TEST']
const PAYMENT_ATTEMPT_STATUSES = ['CREATED', 'PARAMETERS_ISSUED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CLOSED']
const PAGE_SIZES = new Set([10, 20, 50, 100])

function createAdminPaymentAttempts({ repository, access }) {
  async function listPaymentAttempts(caller, input = {}) {
    const context = await access.session(caller)
    const grant = firstGrant(context.bindings, CAPABILITIES.ORDERS_READ)
    const request = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
    const filters = normalizeFilters(request.filters)
    const pageSize = normalizePageSize(request.limit)
    const page = pageResult(await repository.listPaymentAttempts(
      context.caller.appId,
      visibilityForCapability(context.bindings, CAPABILITIES.ORDERS_READ),
      filters,
      pageSize,
      decodeCursor(request.cursor, ['createdAt', 'id']),
    ))
    await repository.recordAudit(access.audit(context, grant, {
      scopeType: grant.scopeType,
      scopeId: grant.scopeId,
      action: 'admin.paymentAttempts.view',
      resourceType: 'PAYMENT_ATTEMPT_LIST',
      metadata: { count: page.items.length, filters },
    }))
    return page
  }

  return { listPaymentAttempts }
}

function normalizeFilters(value) {
  const filters = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const createdFrom = dateTimeFilter(filters.createdFrom, '开始时间')
  const createdTo = dateTimeFilter(filters.createdTo, '结束时间')
  if (createdFrom && createdTo && createdFrom > createdTo) {
    throw new AdminError('VALIDATION_FAILED', '支付尝试开始时间不能晚于结束时间')
  }
  return {
    query: text(filters.query, 80),
    provider: enumFilter(filters.provider, PAYMENT_PROVIDERS, '支付渠道'),
    status: enumFilter(filters.status, PAYMENT_ATTEMPT_STATUSES, '支付尝试状态'),
    createdFrom,
    createdTo,
  }
}

function enumFilter(value, allowed, label) {
  if (value === null || value === undefined || value === '') return ''
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : ''
  if (!allowed.includes(normalized)) throw new AdminError('VALIDATION_FAILED', `${label}无效`)
  return normalized
}

function dateTimeFilter(value, label) {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value !== 'string' || value.length > 40) throw new AdminError('VALIDATION_FAILED', `${label}无效`)
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw new AdminError('VALIDATION_FAILED', `${label}无效`)
  return date.toISOString().slice(0, 23).replace('T', ' ')
}

function normalizePageSize(value) {
  const pageSize = value === undefined || value === null || value === '' ? 20 : Number(value)
  if (!Number.isInteger(pageSize) || !PAGE_SIZES.has(pageSize)) {
    throw new AdminError('VALIDATION_FAILED', '分页数量必须为 10、20、50 或 100')
  }
  return pageSize
}

function pageResult(value) {
  return {
    items: Array.isArray(value?.items) ? value.items : [],
    nextCursor: typeof value?.nextCursor === 'string' ? value.nextCursor : null,
  }
}

module.exports = { createAdminPaymentAttempts, normalizePageSize }
