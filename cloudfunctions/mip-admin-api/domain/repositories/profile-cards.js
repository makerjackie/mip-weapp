'use strict'
const { randomUUID } = require('node:crypto')
const { claimOptional, complete } = require('../idempotency')
const { decodeCursor, pageRows } = require('../pagination')
const { AdminError } = require('../validation')
const json = (value, fallback) => typeof value === 'string' ? JSON.parse(value) : value ?? fallback
function createProfileCardRepository(database, { lockMutation, assertScope, writeAudit }) {
  async function listProfileCards(appId, input) {
    if (input.cardType === 'TEMPLATE') {
      const rows = await database.query('SELECT * FROM mip_profile_card_templates WHERE app_id = ? ORDER BY sort_order, style_key', [appId])
      return { items: rows.map(row => ({ id: row.style_key, name: row.name, requiredFields: json(row.required_fields_json, []), sortOrder: Number(row.sort_order), status: row.status, version: Number(row.version) })), nextCursor: null }
    }
    const cursor = decodeCursor(input.cursor, ['id'])
    const rows = await database.query(`SELECT p.user_id, p.nickname, p.real_name, p.headline, p.companies_json,
        p.identity_status, p.version AS profile_version, media.cloud_file_id AS avatar_url,
        COALESCE(m.status, 'ACTIVE') AS card_status, COALESCE(m.version, 0) AS card_version, COALESCE(m.reason, '') AS reason
      FROM mip_profiles p JOIN mip_users u ON u.app_id = p.app_id AND u.id = p.user_id AND u.status = 'ACTIVE'
      LEFT JOIN mip_media_assets media ON media.app_id = p.app_id AND media.id = p.avatar_asset_id AND media.status = 'READY'
      LEFT JOIN mip_profile_card_moderation m ON m.app_id = p.app_id AND m.user_id = p.user_id
      WHERE p.app_id = ? AND (? = '' OR LOCATE(?, COALESCE(p.real_name, p.nickname)) > 0 OR LOCATE(?, p.nickname) > 0)
        ${cursor ? 'AND p.user_id < ?' : ''} ORDER BY p.user_id DESC LIMIT ?`,
    [appId, input.query, input.query, input.query, ...(cursor ? [cursor.id] : []), input.limit + 1])
    return pageRows(rows.map(row => ({ id: row.user_id, name: row.real_name || row.nickname, nickname: row.nickname,
      headline: row.headline || '', companies: json(row.companies_json, []), identityStatus: row.identity_status || '',
      avatarUrl: row.avatar_url || '', profileVersion: Number(row.profile_version), status: row.card_status,
      version: Number(row.card_version), reason: row.reason })), input.limit, row => ({ id: row.id }))
  }
  async function listProfileCardHistory(appId, userId, value, pageLimit) {
    const cursor = decodeCursor(value, ['version'])
    if (cursor && !/^\d+$/.test(cursor.version)) throw new AdminError('VALIDATION_FAILED', '分页游标无效')
    const rows = await database.query(`SELECT h.profile_version, h.snapshot_json, h.created_at
      FROM mip_profile_card_history h JOIN mip_users u ON u.app_id = h.app_id AND u.id = h.user_id AND u.status = 'ACTIVE'
      WHERE h.app_id = ? AND h.user_id = ? ${cursor ? 'AND h.profile_version < ?' : ''}
      ORDER BY h.profile_version DESC LIMIT ?`, [appId, userId, ...(cursor ? [cursor.version] : []), pageLimit + 1])
    return pageRows(rows.map(row => ({ version: Number(row.profile_version), snapshot: json(row.snapshot_json, {}), createdAt: row.created_at })), pageLimit, row => ({ version: String(row.version) }))
  }
  async function changeProfileCard(input) {
    return database.transaction(async tx => {
      const auth = await lockMutation(tx, input)
      assertScope(auth, { scopeType: 'PLATFORM', scopeId: null })
      const operation = `admin.cards.${input.kind.toLowerCase()}`
      const key = await claimOptional(tx, input, operation, { cardId: input.cardId, version: input.expectedVersion, changes: input.changes }, randomUUID)
      if (key.replay) return key.replay
      let row
      if (input.kind === 'PROFILE') {
        const user = await tx.one("SELECT id FROM mip_users WHERE app_id = ? AND id = ? AND status = 'ACTIVE' FOR UPDATE", [input.appId, input.cardId])
        if (!user) throw new AdminError('NOT_FOUND', '用户不存在')
        row = await tx.one('SELECT version FROM mip_profile_card_moderation WHERE app_id = ? AND user_id = ? FOR UPDATE', [input.appId, input.cardId])
      }
      else row = await tx.one('SELECT * FROM mip_profile_card_templates WHERE app_id = ? AND style_key = ? FOR UPDATE', [input.appId, input.cardId])
      if (Number(row?.version || 0) !== input.expectedVersion) throw new AdminError('CONFLICT', '名片已变化，请刷新后重试')
      if (input.kind === 'PROFILE') {
        await tx.query(`INSERT INTO mip_profile_card_moderation (app_id, user_id, status, reason, version) VALUES (?, ?, ?, ?, 1)
          ON DUPLICATE KEY UPDATE status = VALUES(status), reason = VALUES(reason), version = version + 1`,
        [input.appId, input.cardId, input.changes.status, input.changes.reason])
      }
      else {
        if (!row) throw new AdminError('NOT_FOUND', '模板不存在')
        const next = { name: row.name, requiredFields: json(row.required_fields_json, []), sortOrder: Number(row.sort_order), status: row.status, ...input.changes }
        await tx.query(`UPDATE mip_profile_card_templates SET name = ?, required_fields_json = ?, sort_order = ?, status = ?, version = version + 1
          WHERE app_id = ? AND style_key = ?`, [next.name, JSON.stringify(next.requiredFields), next.sortOrder, next.status, input.appId, input.cardId])
      }
      await writeAudit(tx, { ...input.audit, metadata: { ...input.changes, version: input.expectedVersion + 1 } })
      const result = { id: input.cardId, version: input.expectedVersion + 1 }
      await complete(tx, input, operation, key.requestHash, result)
      return result
    })
  }
  return { listProfileCards, listProfileCardHistory, changeProfileCard }
}
module.exports = { createProfileCardRepository }
