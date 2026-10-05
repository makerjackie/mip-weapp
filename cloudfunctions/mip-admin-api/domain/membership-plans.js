'use strict'
const { CAPABILITIES, authorize } = require('./capabilities')
const { AdminError } = require('./validation')
// 会员方案改价（MIW-35）：价格需求会变动，但当前只有一条年卡方案，
// 后台只开放改价；名称/时长/上下架保持只读，不做新建、删除等通用方案管理。
const MIN_PRICE_CENTS = 1
const MAX_PRICE_CENTS = 100000000
const scope = { scopeType: 'PLATFORM', scopeId: null }
function priceCents(value) {
  if (!Number.isSafeInteger(value) || value < MIN_PRICE_CENTS || value > MAX_PRICE_CENTS) {
    throw new AdminError('VALIDATION_FAILED', '价格无效，请输入 0.01 元至 100 万元之间的金额')
  }
  return value
}
function createMembershipPlans({ access, repository }) {
  async function listMembershipPlans(caller) {
    const context = await access.session(caller)
    authorize(context.bindings, CAPABILITIES.GROWTH_READ, scope)
    return repository.listMembershipPlans(context.caller.appId)
  }
  async function saveMembershipPlanPrice(caller, input = {}) {
    const context = await access.session(caller)
    const grant = authorize(context.bindings, CAPABILITIES.GROWTH_CONFIGURE, scope)
    if (typeof input.planId !== 'string' || !input.planId.trim()) throw new AdminError('VALIDATION_FAILED', '方案标识无效')
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) throw new AdminError('VALIDATION_FAILED', '方案版本无效')
    const price = priceCents(input.priceCents)
    return repository.saveMembershipPlanPrice({ appId: context.caller.appId, actorUserId: context.caller.userId,
      planId: input.planId.trim(), expectedVersion: input.expectedVersion, priceCents: price,
      idempotencyKey: input.idempotencyKey,
      authorization: access.mutationAuthorization(grant, CAPABILITIES.GROWTH_CONFIGURE),
      audit: access.audit(context, grant, { ...scope, action: 'admin.membership.plan.price.save', resourceType: 'MEMBERSHIP_PLAN', resourceId: input.planId.trim(),
        metadata: { priceCents: price } }) })
  }
  return { listMembershipPlans, saveMembershipPlanPrice }
}
module.exports = { MAX_PRICE_CENTS, MIN_PRICE_CENTS, createMembershipPlans }
