'use strict'

const { CAPABILITIES, authorize } = require('./capabilities')
const { AdminError, requiredId, expectedVersion, text, stableKey, limit } = require('./validation')
const { decodeCursor } = require('./pagination')
const { BEHAVIORS } = require('./repositories/growth-operations')

function createContribution({ access, repository } = {}) {
  async function context(caller, capability) {
    const context = await access.session(caller)
    const grant = authorize(context.bindings, capability, { scopeType: 'PLATFORM', scopeId: null })
    return { ...context, grant }
  }
  function mutationInput(ctx, capability, action, metadata) {
    return { appId: ctx.caller.appId, actorUserId: ctx.caller.userId,
      authorization: access.mutationAuthorization(ctx.grant, capability),
      audit: resourceId => access.audit(ctx, ctx.grant, { scopeType: 'PLATFORM', action,
        resourceType: 'GROWTH', resourceId, metadata }) }
  }
  return {
    async listContributionRules(caller, input = {}) {
      const ctx = await context(caller, CAPABILITIES.GROWTH_READ)
      return repository.listContributionRules({ appId: ctx.caller.appId, ...readInput(input) })
    },
    async saveContributionRule(caller, input = {}) {
      const ctx = await context(caller, CAPABILITIES.GROWTH_CONFIGURE)
      const draft = normalizeContributionRule(input)
      const ruleId = input.ruleId ? requiredId(input.ruleId) : null
      return repository.saveContributionRule({ ...mutationInput(ctx, CAPABILITIES.GROWTH_CONFIGURE, 'admin.contribution.rule.save', draft),
        draft, ruleId, expectedVersion: ruleId ? expectedVersion(input.expectedVersion) : 0,
        idempotencyKey: stableKey(input.idempotencyKey, '请求', 128) })
    },
    async listContributionTransactions(caller, input = {}) {
      const ctx = await context(caller, CAPABILITIES.GROWTH_READ)
      return repository.listContributionTransactions({ appId: ctx.caller.appId, ...readInput(input) })
    },
    async reverseContribution(caller, input = {}) {
      const ctx = await context(caller, CAPABILITIES.GROWTH_ADJUST)
      const reversalValue = positiveInteger(input.reversalValue)
      const originalTransactionNo = requiredId(input.originalTransactionNo)
      const reason = text(input.reason, 300, { required: true, label: '冲正原因' })
      return repository.reverseContribution({ ...mutationInput(ctx, CAPABILITIES.GROWTH_ADJUST, 'admin.contribution.reverse', { originalTransactionNo, reversalValue, reason }),
        originalTransactionNo, reversalValue, reason, idempotencyKey: stableKey(input.idempotencyKey, '请求', 128) })
    },
  }
}

function positiveInteger(value) {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < 1 || result > 1_000_000) throw new AdminError('VALIDATION_FAILED', '数值必须为 1–1000000 的整数')
  return result
}
function date(value, required = false) {
  if (!value && !required) return null
  const parsed = typeof value === 'string' ? new Date(value) : null
  if (!parsed || !Number.isFinite(parsed.getTime())) throw new AdminError('VALIDATION_FAILED', '时间无效')
  return parsed.toISOString().slice(0, 23).replace('T', ' ')
}
function normalizeContributionRule(input) {
  const behavior = String(input.behavior || '')
  const status = String(input.status || '')
  if (!Object.hasOwn(BEHAVIORS, behavior) || !['ACTIVE', 'INACTIVE'].includes(status)) throw new AdminError('VALIDATION_FAILED', '贡献行为或状态无效')
  const rewardLimit = input.rewardLimit
  if (!rewardLimit || !['PER_EVENT', 'PER_DAY'].includes(rewardLimit.kind)) throw new AdminError('VALIDATION_FAILED', '奖励上限无效')
  if (!Array.isArray(input.scopeServers) || input.scopeServers.length > 100) throw new AdminError('VALIDATION_FAILED', '服务器范围无效')
  const effectiveFrom = date(input.effectiveFrom, true)
  const effectiveTo = date(input.effectiveTo)
  if (effectiveTo && effectiveTo <= effectiveFrom) throw new AdminError('VALIDATION_FAILED', '结束时间必须晚于开始时间')
  const rewardExp = positiveInteger(input.rewardExp)
  const maximum = positiveInteger(rewardLimit.value)
  if (maximum < rewardExp) throw new AdminError('VALIDATION_FAILED', '奖励上限不能小于单次奖励')
  return { behavior, rewardExp, rewardLimit: { kind: rewardLimit.kind, value: maximum },
    scopeServers: [...new Set(input.scopeServers.map(value => requiredId(value, '服务器')))], effectiveFrom, effectiveTo, status }
}
function readInput(input) {
  const source = input.filters || {}
  const filters = { query: text(source.query, 100), behavior: text(source.behavior, 128), status: text(source.status, 16),
    userId: source.userId ? requiredId(source.userId) : '', serverId: source.serverId ? requiredId(source.serverId) : '', sinceTime: date(source.sinceTime) }
  return { filters, limit: limit(input.limit), cursor: decodeCursor(input.cursor, ['createdAt', 'id']) }
}
module.exports = { createContribution, normalizeContributionRule, positiveInteger, date }
