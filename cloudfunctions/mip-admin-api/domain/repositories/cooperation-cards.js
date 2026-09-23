'use strict'
const { randomUUID } = require('node:crypto')
const { claimOptional, complete } = require('../idempotency')
const { lockMutationAuthorization, assertMutationScope } = require('../mutation-authorization')
const { AdminError } = require('../validation')
const { CARD_TYPES, LEGACY_SCORE_KEYS } = require('../cooperation-cards')
const json = value => { try { return typeof value === 'object' && value ? value : JSON.parse(value || '{}') } catch { return {} } }
const iso = value => value ? new Date(value).toISOString() : null
const roleFields = { connector: ['circles', 'resources', 'target'], business_builder: ['industries', 'business_models', 'target'], capital_operator: ['investment_fields', 'capital_range', 'target'], strategist: ['planning_types', 'methods', 'target'], visual_designer: ['visual_types', 'portfolio_summary', 'target'], delivery_lead: ['project_types', 'delivery_experience', 'target'] }
function createCooperationCardRepository(database, options = {}) {
  const lockMutation = options.lockMutationAuthorization || lockMutationAuthorization
  const assertScope = options.assertMutationScope || assertMutationScope
  const writeAudit = options.writeAudit
  async function getCooperationCards(appId, userId) {
    const rows = await database.query(`SELECT c.*, p.real_name, p.nickname,
      (SELECT actor.nickname FROM mip_audit_logs a LEFT JOIN mip_profiles actor ON actor.app_id = a.app_id AND actor.user_id = a.actor_user_id
       WHERE a.app_id = c.app_id AND a.resource_type = 'COOPERATION_CARD' AND a.resource_id = c.id ORDER BY a.created_at DESC, a.id DESC LIMIT 1) AS modified_by
      FROM mip_cooperation_cards c LEFT JOIN mip_profiles p ON p.app_id = c.app_id AND p.user_id = c.owner_user_id
      WHERE c.app_id = ? AND c.owner_user_id = ? AND c.status <> 'ARCHIVED' ORDER BY c.updated_at DESC, c.id DESC`, [appId, userId])
    return rows.map(row => {
      const cardType = row.card_type || Object.keys(CARD_TYPES).find(key => CARD_TYPES[key].roleKey === row.role_key)
      const schema = CARD_TYPES[cardType]; const scores = json(row.ability_scores_json)
      return { id: row.id, userId, cardType, realName: row.card_real_name ?? row.real_name ?? '', gameName: row.card_game_name ?? row.nickname ?? '',
        cardSummary: row.positioning, targetSummary: row.target_summary, referralNeeded: row.referral_needed || '',
        quirks: row.quirks || '', rootCause: row.root_cause || '', prevention: row.prevention || '', cooperationValue: row.cooperation_value || '',
        abilityScores: schema.scores.map((key, index) => ({ key, score: Number(scores[LEGACY_SCORE_KEYS[index]] || 1) })),
        menuFields: json(row.menu_fields_json), status: row.status, expectedVersion: Number(row.version), version: Number(row.version),
        modifiedBy: row.modified_by || '', modifiedAt: iso(row.updated_at) }
    })
  }
  async function saveCooperationCard(input) {
    return database.transaction(async tx => {
      const authorization = await lockMutation(tx, input)
      const owner = await tx.one('SELECT id, status, primary_branch_id FROM mip_users WHERE app_id = ? AND id = ? FOR UPDATE', [input.appId, input.userId])
      if (!owner || owner.status !== 'ACTIVE') throw new AdminError('NOT_FOUND', '用户不存在或已停用')
      const scope = { scopeType: owner.primary_branch_id ? 'BRANCH' : 'PLATFORM', scopeId: owner.primary_branch_id || null }
      assertScope(authorization, scope)
      if (scope.scopeType !== input.authorizedScope.scopeType || scope.scopeId !== input.authorizedScope.scopeId) throw new AdminError('CONFLICT', '用户所属服务器已变化')
      const claim = await claimOptional(tx, input, 'admin.cooperation_cards.save', { userId: input.userId, expectedVersion: input.expectedVersion, draft: input.draft }, randomUUID)
      if (claim.replay) return claim.replay
      const d = input.draft
      const row = await tx.one('SELECT id, status, version FROM mip_cooperation_cards WHERE app_id = ? AND owner_user_id = ? AND role_key = ? FOR UPDATE', [input.appId, input.userId, d.roleKey])
      if ((row ? Number(row.version) : 0) !== input.expectedVersion) throw new AdminError('CONFLICT', '合作卡已变化，请刷新')
      if (row?.status === 'ARCHIVED') throw new AdminError('INVALID_STATE', '合作卡已归档')
      const cardId = row?.id || randomUUID()
      const menuValues = Object.values(d.menuFields)
      const legacyFields = Object.fromEntries(roleFields[d.roleKey].map((key, index) => [key, index === 2 ? d.targetSummary : menuValues[Math.min(index, menuValues.length - 1)]]))
      const values = [d.cardType, d.cardSummary, d.targetSummary, JSON.stringify(legacyFields), JSON.stringify(d.abilityScores), JSON.stringify(d.menuFields), d.realName, d.gameName, d.referralNeeded, d.quirks, d.rootCause, d.prevention, d.cooperationValue, d.status, input.contentSafetyStatus, d.status]
      if (row) {
        await tx.query(`UPDATE mip_cooperation_cards SET card_type = ?, positioning = ?, target_summary = ?, role_fields_json = ?, ability_scores_json = ?, menu_fields_json = ?,
          card_real_name = ?, card_game_name = ?, referral_needed = ?, quirks = ?, root_cause = ?, prevention = ?, cooperation_value = ?, status = ?, content_safety_status = ?,
          published_at = CASE WHEN ? = 'DRAFT' THEN NULL ELSE COALESCE(published_at, UTC_TIMESTAMP(3)) END, version = version + 1
          WHERE app_id = ? AND id = ? AND version = ?`, [...values, input.appId, cardId, input.expectedVersion])
      }
      else {
        await tx.query(`INSERT INTO mip_cooperation_cards (id, app_id, owner_user_id, role_key, card_type, positioning, target_summary, role_fields_json, ability_scores_json, menu_fields_json,
          card_real_name, card_game_name, referral_needed, quirks, root_cause, prevention, cooperation_value, status, content_safety_status, published_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'DRAFT' THEN NULL ELSE UTC_TIMESTAMP(3) END)`, [cardId, input.appId, input.userId, d.roleKey, ...values])
      }
      await writeAudit(tx, input.audit(cardId))
      const result = { id: cardId, userId: input.userId, cardType: d.cardType, status: d.status, version: input.expectedVersion + 1 }
      await complete(tx, input, 'admin.cooperation_cards.save', claim.requestHash, result)
      return result
    })
  }
  return { getCooperationCards, saveCooperationCard }
}
module.exports = { createCooperationCardRepository }
