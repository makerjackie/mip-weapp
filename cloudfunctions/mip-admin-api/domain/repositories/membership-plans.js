'use strict'
const { randomUUID } = require('node:crypto')
const { claimOptional, complete } = require('../idempotency')
const { AdminError } = require('../validation')
// 后台会员方案改价（MIW-35）：只允许改 price_cents；方案行自带 catalog_stage，
// TEST/LIVE 各自独立，改价仅影响之后的新订单（下单时快照金额）。
const OPERATION = 'membership.plan.price.save'
function iso(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}
function createMembershipPlansRepository(database, { lockMutation, assertScope, writeAudit }) {
  async function listMembershipPlans(appId) {
    const rows = await database.query(
      `SELECT id, plan_key, catalog_stage, name, duration_days, price_cents, currency, status, version, updated_at
       FROM mip_membership_plans WHERE app_id = ? ORDER BY catalog_stage, price_cents`,
      [appId],
    )
    return { items: rows.map(row => ({
      id: row.id,
      planKey: row.plan_key,
      catalogStage: row.catalog_stage,
      name: row.name,
      durationDays: Number(row.duration_days),
      priceCents: Number(row.price_cents),
      currency: row.currency,
      status: row.status,
      version: Number(row.version),
      updatedAt: iso(row.updated_at),
    })) }
  }
  async function saveMembershipPlanPrice(input) {
    return database.transaction(async tx => {
      assertScope(await lockMutation(tx, input), { scopeType: 'PLATFORM', scopeId: null })
      const claim = await claimOptional(tx, input, OPERATION, { expectedVersion: input.expectedVersion, planId: input.planId, priceCents: input.priceCents }, randomUUID)
      if (claim.replay) return claim.replay
      const row = await tx.one('SELECT price_cents, version FROM mip_membership_plans WHERE app_id = ? AND id = ? FOR UPDATE', [input.appId, input.planId])
      if (!row) throw new AdminError('NOT_FOUND', '会员方案不存在')
      if (Number(row.version) !== input.expectedVersion) throw new AdminError('CONFLICT', '方案已被其他人修改，请刷新后重试')
      const result = await tx.query(
        'UPDATE mip_membership_plans SET price_cents = ?, version = version + 1 WHERE app_id = ? AND id = ? AND version = ?',
        [input.priceCents, input.appId, input.planId, input.expectedVersion],
      )
      if (Number(result.affectedRows) !== 1) throw new AdminError('CONFLICT', '方案已被其他人修改，请刷新后重试')
      await writeAudit(tx, { ...input.audit,
        metadata: { ...input.audit.metadata, previousPriceCents: Number(row.price_cents) } })
      const response = { planId: input.planId, priceCents: input.priceCents, version: input.expectedVersion + 1 }
      await complete(tx, input, OPERATION, claim.requestHash, response)
      return response
    })
  }
  return { listMembershipPlans, saveMembershipPlanPrice }
}
module.exports = { createMembershipPlansRepository }
