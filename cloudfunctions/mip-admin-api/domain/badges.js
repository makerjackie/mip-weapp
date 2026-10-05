'use strict'

const { randomUUID } = require('node:crypto')
const { assertMutationAuthorization } = require('./mutation-authorization')
const { cursorPredicateFor } = require('./pagination')

function createBadgeAdminRepository(database, options = {}) {
  const createId = options.createId || randomUUID

  async function listBadges(appId) {
    const rows = await database.query(
      `SELECT badge.id, badge.badge_key, badge.name, badge.description, badge.acquire_condition,
              badge.category, badge.icon_name, badge.image_url, badge.image_asset_id,
              badge.placeholder_shape, badge.sort_order, badge.status, badge.version,
              badge.created_at, badge.updated_at,
              COALESCE(NULLIF(asset.cloud_file_id, ''), badge.image_url) AS image_preview_url
       FROM mip_badges badge
       LEFT JOIN mip_media_assets asset
         ON asset.app_id = badge.app_id AND asset.id = badge.image_asset_id
           AND asset.status = 'READY'
       WHERE badge.app_id = ?
       ORDER BY badge.sort_order, badge.name, badge.id`,
      [appId],
    )
    return rows.map(badgeDto)
  }

  async function saveBadge(input) {
    return database.transaction(async (tx) => {
      await assertMutationAuthorization(tx, input, { scopeType: 'PLATFORM', scopeId: null })
      const badgeId = input.badgeId || createId()
      const current = input.badgeId
        ? await tx.one(
            `SELECT id, status, version, image_asset_id FROM mip_badges
             WHERE app_id = ? AND id = ? FOR UPDATE`,
            [input.appId, badgeId],
          )
        : null
      if (input.badgeId && !current) throw codeError('NOT_FOUND')
      if (current && Number(current.version) !== input.expectedVersion) throw codeError('CONFLICT')
      if (current?.status === 'ACTIVE' && input.draft.status !== 'ACTIVE') {
        const equipped = await tx.one(
          `SELECT COUNT(*) AS total FROM mip_user_badge_equipment
           WHERE app_id = ? AND badge_id = ?`,
          [input.appId, badgeId],
        )
        if (Number(equipped?.total || 0) > 0) throw codeError('BADGE_IN_USE')
      }
      const imageAssetId = input.draft.imageAssetId || null
      if (imageAssetId) {
        // Uploads are actor-owned READY assets; keep the badge's current artwork
        // editable by any operator with badge rights (same carve-out as banners).
        const asset = await tx.one(
          `SELECT id, owner_user_id, purpose, status, content_type, cloud_file_id
           FROM mip_media_assets WHERE app_id = ? AND id = ? FOR UPDATE`,
          [input.appId, imageAssetId],
        )
        if (!asset || asset.status !== 'READY' || asset.purpose !== 'BADGE_IMAGE'
          || !['image/jpeg', 'image/png'].includes(asset.content_type)
          || !String(asset.cloud_file_id || '').startsWith('cloud://')) {
          throw codeError('IMAGE_ASSET_INVALID')
        }
        if (asset.owner_user_id !== input.actorUserId && asset.id !== current?.image_asset_id) {
          throw codeError('IMAGE_NOT_OWNED')
        }
      }
      try {
        if (current) {
          const result = await tx.query(
            `UPDATE mip_badges
             SET badge_key = ?, name = ?, description = ?, acquire_condition = ?, category = ?,
                 icon_name = ?, image_url = ?, image_asset_id = ?,
                 placeholder_shape = ?, sort_order = ?, status = ?, version = version + 1
             WHERE app_id = ? AND id = ? AND version = ?`,
            [input.draft.key, input.draft.name, input.draft.description, input.draft.acquireCondition,
              input.draft.category, input.draft.iconName, input.draft.imageUrl, imageAssetId,
              input.draft.placeholderShape, input.draft.sortOrder,
              input.draft.status, input.appId, badgeId, input.expectedVersion],
          )
          if (Number(result.affectedRows) !== 1) throw codeError('CONFLICT')
        }
        else {
          await tx.query(
            `INSERT INTO mip_badges (
               id, app_id, badge_key, name, description, acquire_condition, category,
               icon_name, image_url, image_asset_id,
               placeholder_shape, sort_order, status, created_by_user_id
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [badgeId, input.appId, input.draft.key, input.draft.name, input.draft.description,
              input.draft.acquireCondition, input.draft.category,
              input.draft.iconName, input.draft.imageUrl, imageAssetId,
              input.draft.placeholderShape, input.draft.sortOrder, input.draft.status, input.actorUserId],
          )
        }
      }
      catch (error) {
        if (error?.code === 'ER_DUP_ENTRY') throw codeError('BADGE_KEY_CONFLICT')
        throw error
      }
      await writeAudit(tx, input.audit(badgeId))
      return { id: badgeId, version: current ? input.expectedVersion + 1 : 1 }
    })
  }

  async function listBadgeAwards(appId, filters = {}) {
    const clauses = ['award.app_id = ?']
    const params = [appId]
    if (filters.userId) { clauses.push('award.user_id = ?'); params.push(filters.userId) }
    if (filters.status) {
      clauses.push('award.status = ?')
      params.push(filters.status)
    }
    if (filters.query) {
      clauses.push('(profile.nickname LIKE ? OR badge.name LIKE ? OR award.user_id = ?)')
      const pattern = `%${filters.query.replace(/[\\%_]/g, '\\$&')}%`
      params.push(pattern, pattern, filters.query)
    }
    const cursor = cursorPredicateFor('award.updated_at', filters.cursor, 'updatedAt', 'award.id')
    const rows = await database.query(
      `SELECT award.id, award.user_id, profile.nickname, award.badge_id, badge.name AS badge_name,
              award.status, award.award_reason, award.awarded_at, award.revoke_reason,
              award.revoked_at, award.version, award.updated_at,
              EXISTS (
                SELECT 1 FROM mip_user_badge_equipment equipment
                WHERE equipment.app_id = award.app_id AND equipment.user_id = award.user_id
                  AND equipment.badge_id = award.badge_id
              ) AS equipped
       FROM mip_user_badges award
       INNER JOIN mip_badges badge ON badge.app_id = award.app_id AND badge.id = award.badge_id
       INNER JOIN mip_users user ON user.app_id = award.app_id AND user.id = award.user_id
       LEFT JOIN mip_profiles profile ON profile.app_id = user.app_id AND profile.user_id = user.id
       WHERE ${clauses.join(' AND ')}${cursor.sql}
       ORDER BY award.updated_at DESC, award.id DESC
       LIMIT ?`,
      [...params, ...cursor.params, (filters.limit ?? 100) + 1],
    )
    return rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      nickname: row.nickname || '未填写昵称',
      badgeId: row.badge_id,
      badgeName: row.badge_name,
      status: row.status,
      awardReason: row.award_reason,
      awardedAt: iso(row.awarded_at),
      updatedAt: iso(row.updated_at),
      revokeReason: row.revoke_reason || '',
      revokedAt: iso(row.revoked_at),
      equipped: Number(row.equipped) === 1,
      version: Number(row.version),
    }))
  }

  async function grantBadge(input) {
    return database.transaction(async (tx) => {
      await assertMutationAuthorization(tx, input, { scopeType: 'PLATFORM', scopeId: null })
      const user = await tx.one(
        `SELECT id, status FROM mip_users WHERE app_id = ? AND id = ? FOR UPDATE`,
        [input.appId, input.userId],
      )
      const badge = await tx.one(
        `SELECT id, status FROM mip_badges WHERE app_id = ? AND id = ? FOR UPDATE`,
        [input.appId, input.badgeId],
      )
      if (!user || !badge) throw codeError('NOT_FOUND')
      if (user.status !== 'ACTIVE' || badge.status !== 'ACTIVE') throw codeError('INVALID_STATE')
      const current = await tx.one(
        `SELECT id, status, version FROM mip_user_badges
         WHERE app_id = ? AND user_id = ? AND badge_id = ? FOR UPDATE`,
        [input.appId, input.userId, input.badgeId],
      )
      if (current?.status === 'ACTIVE') {
        return { id: current.id, status: 'ACTIVE', version: Number(current.version), idempotent: true }
      }
      const awardId = current?.id || createId()
      if (current) {
        await tx.query(
          `UPDATE mip_user_badges
           SET status = 'ACTIVE', award_reason = ?, awarded_by_user_id = ?,
               awarded_at = UTC_TIMESTAMP(3), revoked_by_user_id = NULL,
               revoke_reason = NULL, revoked_at = NULL, version = version + 1
           WHERE app_id = ? AND id = ? AND version = ?`,
          [input.reason, input.actorUserId, input.appId, awardId, current.version],
        )
      }
      else {
        await tx.query(
          `INSERT INTO mip_user_badges (
             id, app_id, user_id, badge_id, status, award_reason, awarded_by_user_id
           ) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?)`,
          [awardId, input.appId, input.userId, input.badgeId, input.reason, input.actorUserId],
        )
      }
      await writeAudit(tx, input.audit(awardId))
      return {
        id: awardId,
        status: 'ACTIVE',
        version: current ? Number(current.version) + 1 : 1,
        idempotent: false,
      }
    })
  }

  async function revokeBadge(input) {
    return database.transaction(async (tx) => {
      await assertMutationAuthorization(tx, input, { scopeType: 'PLATFORM', scopeId: null })
      const award = await tx.one(
        `SELECT id, user_id, badge_id, status, version FROM mip_user_badges
         WHERE app_id = ? AND id = ? FOR UPDATE`,
        [input.appId, input.awardId],
      )
      if (!award) throw codeError('NOT_FOUND')
      if (Number(award.version) !== input.expectedVersion) throw codeError('CONFLICT')
      if (award.status !== 'ACTIVE') throw codeError('INVALID_STATE')
      const equipped = await tx.one(
        `SELECT slot_no FROM mip_user_badge_equipment
         WHERE app_id = ? AND user_id = ? AND badge_id = ? FOR UPDATE`,
        [input.appId, award.user_id, award.badge_id],
      )
      if (equipped) throw codeError('BADGE_EQUIPPED')
      const result = await tx.query(
        `UPDATE mip_user_badges
         SET status = 'REVOKED', revoked_by_user_id = ?, revoke_reason = ?,
             revoked_at = UTC_TIMESTAMP(3), version = version + 1
         WHERE app_id = ? AND id = ? AND version = ? AND status = 'ACTIVE'`,
        [input.actorUserId, input.reason, input.appId, input.awardId, input.expectedVersion],
      )
      if (Number(result.affectedRows) !== 1) throw codeError('CONFLICT')
      await writeAudit(tx, input.audit(input.awardId))
      return { id: input.awardId, status: 'REVOKED', version: input.expectedVersion + 1 }
    })
  }

  return { grantBadge, listBadgeAwards, listBadges, revokeBadge, saveBadge }
}

function badgeDto(row) {
  return {
    id: row.id,
    key: row.badge_key,
    name: row.name,
    description: row.description,
    acquireCondition: row.acquire_condition || '',
    category: row.category === 'HONOR' ? 'HONOR' : 'IDENTITY',
    iconName: row.icon_name || '',
    imageUrl: row.image_url || '',
    imagePreviewUrl: row.image_preview_url || '',
    imageAssetId: row.image_asset_id || null,
    placeholderShape: row.placeholder_shape,
    sortOrder: Number(row.sort_order),
    status: row.status,
    version: Number(row.version),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }
}

function iso(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

async function writeAudit(tx, audit) {
  await tx.query(
    `INSERT INTO mip_audit_logs (
       app_id, actor_user_id, actor_type, scope_type, scope_id, action,
       resource_type, resource_id, effective_role, metadata_json
     ) VALUES (?, ?, 'ADMIN', ?, ?, ?, ?, ?, ?, ?)`,
    [audit.appId, audit.actorUserId, audit.scopeType, audit.scopeId || null,
      audit.action, audit.resourceType, audit.resourceId || null,
      audit.effectiveRole || null, JSON.stringify(audit.metadata || {})],
  )
}

function codeError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

module.exports = { badgeDto, createBadgeAdminRepository }
