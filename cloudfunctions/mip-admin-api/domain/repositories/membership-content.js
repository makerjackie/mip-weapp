'use strict'
const { randomUUID } = require('node:crypto')
const { claimOptional, complete } = require('../idempotency')
const { AdminError } = require('../validation')
// 与 domain/membership-content.js 的 DOCUMENT_KINDS 一致；operation 保留历史键名以维持幂等重放兼容。
const DOCUMENT_KINDS = {
  membership: { settingKey: 'MEMBERSHIP_AGREEMENT', operation: 'membership.agreement.save' },
  user: { settingKey: 'USER_AGREEMENT', operation: 'user.agreement.save' },
  'experience-rules': { settingKey: 'EXPERIENCE_RULES_TEXT', operation: 'experience.rules.save' },
}
function createMembershipContentRepository(database, { lockMutation, assertScope, writeAudit }) {
  async function getMembershipAgreement(appId, document = 'membership') {
    const settingKey = DOCUMENT_KINDS[document].settingKey
    const row = await database.one("SELECT value_json, version, updated_at FROM mip_app_settings WHERE app_id = ? AND setting_key = ?", [appId, settingKey])
    const value = row ? (typeof row.value_json === 'string' ? JSON.parse(row.value_json) : row.value_json) : {}
    return { title: value.title || '', body: value.body || '', isDemo: value.isDemo !== false, version: Number(row?.version || 0), updatedAt: row?.updated_at || null }
  }
  async function saveMembershipAgreement(input) {
    return database.transaction(async tx => {
      assertScope(await lockMutation(tx, input), { scopeType: 'PLATFORM', scopeId: null })
      const kind = DOCUMENT_KINDS[input.document] || DOCUMENT_KINDS.membership
      const settingKey = kind.settingKey
      const operation = kind.operation
      const claim = await claimOptional(tx, input, operation, { draft: input.draft, version: input.expectedVersion }, randomUUID)
      if (claim.replay) return claim.replay
      const row = await tx.one("SELECT version FROM mip_app_settings WHERE app_id = ? AND setting_key = ? FOR UPDATE", [input.appId, settingKey])
      if (Number(row?.version || 0) !== input.expectedVersion) throw new AdminError('CONFLICT', '协议已被修改，请刷新后重试')
      await tx.query(`INSERT INTO mip_app_settings (app_id, setting_key, value_json, updated_by_user_id)
        VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE value_json = VALUES(value_json),
        updated_by_user_id = VALUES(updated_by_user_id), version = version + 1`, [input.appId, settingKey, JSON.stringify(input.draft), input.actorUserId])
      await writeAudit(tx, input.audit)
      const result = { version: input.expectedVersion + 1 }
      await complete(tx, input, operation, claim.requestHash, result)
      return result
    })
  }
  return { getMembershipAgreement, saveMembershipAgreement }
}
module.exports = { createMembershipContentRepository }
