'use strict'

const { createHash } = require('node:crypto')
const { CAPABILITIES, authorize } = require('./capabilities')
const { decodeCursor } = require('./pagination')
const { AdminError, limit, requiredId, stableKey, text } = require('./validation')

const TYPES = new Set(['EXP', 'CONTRIBUTION', 'MEMBERSHIP'])
const MONTHS = new Set([1, 3, 6, 12])

function createAdminEntitlements({ access, repository, memberships }) {
  async function listEntitlementTransactions(caller, input = {}) {
    const context = await access.session(caller)
    authorize(context.bindings, CAPABILITIES.MEMBERSHIPS_READ, { scopeType: 'PLATFORM', scopeId: null })
    const filters = input.filters || {}
    const entitlementType = text(filters.entitlementType, 32)
    if (entitlementType && !TYPES.has(entitlementType)) throw new AdminError('VALIDATION_FAILED', '权益类型无效')
    const sinceTime = filters.sinceTime ? new Date(filters.sinceTime) : null
    if (sinceTime && !Number.isFinite(sinceTime.getTime())) throw new AdminError('VALIDATION_FAILED', '开始时间无效')
    const untilTime = filters.untilTime ? new Date(filters.untilTime) : null
    if (untilTime && !Number.isFinite(untilTime.getTime())) throw new AdminError('VALIDATION_FAILED', '结束时间无效')
    if (sinceTime && untilTime && sinceTime > untilTime) throw new AdminError('VALIDATION_FAILED', '开始时间不能晚于结束时间')
    const normalized = { entitlementType, query: text(filters.query, 100),
      sinceTime: sinceTime ? sinceTime.toISOString().slice(0, 23).replace('T', ' ') : null,
      ...(untilTime ? { untilTime: untilTime.toISOString().slice(0, 23).replace('T', ' ') } : {}) }
    const cursorContext = createHash('sha256').update(JSON.stringify([context.caller.appId, normalized])).digest('hex')
    const cursor = decodeCursor(input.cursor, ['createdAt', 'id', 'context'])
    if (cursor && cursor.context !== cursorContext) throw new AdminError('VALIDATION_FAILED', '权益筛选条件已变化，请从第一页读取')
    return repository.listEntitlementTransactions({ appId: context.caller.appId, filters: normalized,
      limit: limit(input.limit, 100), cursor, cursorContext })
  }

  async function grantEntitlement(caller, input = {}) {
    const context = await access.session(caller)
    const grant = authorize(context.bindings, CAPABILITIES.MEMBERSHIPS_ADJUST,
      { scopeType: 'PLATFORM', scopeId: null })
    const userId = requiredId(input.userId, '用户')
    const entitlementType = input.entitlementType
    if (!TYPES.has(entitlementType)) throw new AdminError('VALIDATION_FAILED', '权益类型无效')
    const idempotencyKey = stableKey(input.idempotencyKey, '请求', 128)
    if (entitlementType === 'MEMBERSHIP') {
      const months = input.months === undefined || input.months === null ? 12 : Number(input.months)
      if (!MONTHS.has(months) || input.amount !== undefined) throw new AdminError('VALIDATION_FAILED', '会籍时长无效')
      const current = await memberships.getMembership(caller, { userId })
      return memberships.grantMembership(caller, { userId, durationMonths: months,
        expectedChainVersion: current.chainVersion, idempotencyKey, reason: '后台手动发放权益' })
    }
    const amount = Number(input.amount)
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1_000_000 || input.months !== undefined) {
      throw new AdminError('VALIDATION_FAILED', '发放数量无效')
    }
    return repository.grantGrowthEntitlement({ appId: context.caller.appId,
      actorUserId: context.caller.userId, userId,
      metric: entitlementType === 'EXP' ? 'EXPERIENCE' : 'CONTRIBUTION', amount,
      reason: '后台手动发放权益', idempotencyKey,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.MEMBERSHIPS_ADJUST),
      audit: resourceId => access.audit(context, grant, { scopeType: 'PLATFORM',
        action: 'admin.entitlements.grant', resourceType: 'GROWTH_ENTRY', resourceId,
        metadata: { userId, entitlementType, amount } }),
    })
  }
  return { listEntitlementTransactions, grantEntitlement }
}

module.exports = { createAdminEntitlements }
