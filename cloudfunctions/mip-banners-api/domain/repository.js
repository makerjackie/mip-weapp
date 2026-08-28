'use strict'

const { randomUUID } = require('node:crypto')
const { claimOptional, complete } = require('./idempotency')
const {
  assertBannerAsset,
  expectedVersion,
  normalizeAdminFilters,
  normalizeBannerDraft,
  normalizeBannerTarget,
  normalizeDirection,
  normalizeStatus,
  requiredId,
} = require('./validation')

const PLATFORM_SCOPE_ID = '00000000-0000-0000-0000-000000000000'
const BANNERS_CAPABILITY = 'banners.manage'
const BANNER_ADMIN_ROLES = new Set(['PLATFORM_OWNER', 'PLATFORM_OPERATIONS'])

function createBannerRepository(database, options = {}) {
  const createId = options.createId || randomUUID

  async function getAdminSession(caller) {
    const roleKey = await assertBannersAdmin(database, caller)
    return { capability: BANNERS_CAPABILITY, roleKey }
  }

  async function listActive(appId) {
    const rows = await database.query(
      `${bannerSelect()}
       WHERE banner.app_id = ? AND banner.status = 'ACTIVE'
         AND asset.status = 'READY' AND asset.purpose = 'BANNER'
         AND asset.width_px >= 750 AND asset.height_px >= 300
         AND asset.width_px / asset.height_px BETWEEN 1.8 AND 3.2
       ORDER BY banner.sort_order, banner.id LIMIT 20`,
      [appId],
    )
    return rows.flatMap((row) => {
      try {
        normalizeBannerTarget(row.target_type, row.target_value)
        assertBannerAsset(mediaRow(row))
        return [publicBannerDto(row)]
      }
      catch {
        return []
      }
    })
  }

  async function listAdmin(caller, event = {}, adapter = database) {
    await assertBannersAdmin(adapter, caller)
    const filters = normalizeAdminFilters(event.filters)
    const clauses = ['banner.app_id = ?']
    const params = [caller.appId]
    if (filters.status) {
      clauses.push('banner.status = ?')
      params.push(filters.status)
    }
    else {
      clauses.push("banner.status <> 'DELETED'")
    }
    if (filters.query) {
      clauses.push('(banner.title LIKE ? OR banner.accessibility_label LIKE ? OR banner.target_value LIKE ?)')
      const query = `%${escapeLike(filters.query)}%`
      params.push(query, query, query)
    }
    const rows = await adapter.query(
      `${bannerSelect()} WHERE ${clauses.join(' AND ')}
       ORDER BY banner.sort_order, banner.id LIMIT 101`,
      params,
    )
    return { items: rows.slice(0, 100).map(adminBannerDto), truncated: rows.length > 100 }
  }

  async function getAdmin(caller, event, adapter = database) {
    await assertBannersAdmin(adapter, caller)
    const bannerId = requiredId(event.bannerId)
    const row = await adapter.one(
      `${bannerSelect()} WHERE banner.app_id = ? AND banner.id = ?`,
      [caller.appId, bannerId],
    )
    if (!row) throw new Error('NOT_FOUND')
    return adminBannerDto(row)
  }

  async function save(caller, event) {
    const draft = normalizeBannerDraft(event.banner)
    const idempotencyKey = normalizeIdempotencyKey(event.idempotencyKey)
    const bannerId = event.bannerId ? requiredId(event.bannerId) : createId()
    const version = event.bannerId ? expectedVersion(event.expectedVersion) : null
    return database.transaction(async (tx) => {
      const idempotency = await claimOptional(
        tx,
        caller,
        idempotencyKey,
        'mip.admin.banners.save',
        { bannerId: event.bannerId || null, expectedVersion: version, banner: draft },
        createId,
      )
      if (idempotency.replay) return idempotency.replay
      const roleKey = await assertBannersAdmin(tx, caller, true)
      if (!event.bannerId) {
        const asset = await getMedia(tx, caller.appId, draft.imageAssetId, true)
        assertBannerAsset(asset, { actorUserId: caller.userId })
        const order = await tx.one(
          `SELECT sort_order FROM mip_banners
           WHERE app_id = ? AND status <> 'DELETED'
           ORDER BY sort_order DESC, id DESC LIMIT 1 FOR UPDATE`,
          [caller.appId],
        )
        await tx.query(
          `INSERT INTO mip_banners (
             id, app_id, title, accessibility_label, image_asset_id,
             target_type, target_value, sort_order, status,
             created_by_user_id, updated_by_user_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'INACTIVE', ?, ?)`,
          [
            bannerId,
            caller.appId,
            draft.title,
            draft.accessibilityLabel,
            draft.imageAssetId,
            draft.targetType,
            draft.targetValue,
            Math.max(0, Number(order?.sort_order ?? -10) + 10),
            caller.userId,
            caller.userId,
          ],
        )
        await writeAudit(tx, caller, roleKey, 'admin.banners.create', bannerId, {
          status: 'INACTIVE',
          targetType: draft.targetType,
        })
      }
      else {
        const current = await getLockedBanner(tx, caller.appId, bannerId)
        if (!current || current.status === 'DELETED') throw new Error('NOT_FOUND')
        if (Number(current.version) !== version) throw new Error('CONFLICT')
        const asset = await getMedia(tx, caller.appId, draft.imageAssetId, true)
        assertBannerAsset(asset, {
          actorUserId: caller.userId,
          currentAssetId: current.image_asset_id,
        })
        const result = await tx.query(
          `UPDATE mip_banners
           SET title = ?, accessibility_label = ?, image_asset_id = ?,
             target_type = ?, target_value = ?, updated_by_user_id = ?,
             version = version + 1
           WHERE app_id = ? AND id = ? AND version = ? AND status <> 'DELETED'`,
          [
            draft.title,
            draft.accessibilityLabel,
            draft.imageAssetId,
            draft.targetType,
            draft.targetValue,
            caller.userId,
            caller.appId,
            bannerId,
            version,
          ],
        )
        if (Number(result.affectedRows) !== 1) throw new Error('CONFLICT')
        await writeAudit(tx, caller, roleKey, 'admin.banners.update', bannerId, {
          expectedVersion: version,
          status: current.status,
          targetType: draft.targetType,
        })
      }
      const saved = await getAdmin(caller, { bannerId }, tx)
      await complete(
        tx,
        caller,
        idempotencyKey,
        'mip.admin.banners.save',
        idempotency.requestHash,
        saved,
      )
      return saved
    })
  }

  async function changeStatus(caller, event) {
    const bannerId = requiredId(event.bannerId)
    const version = expectedVersion(event.expectedVersion)
    const status = normalizeStatus(event.status)
    return database.transaction(async (tx) => {
      const roleKey = await assertBannersAdmin(tx, caller, true)
      const current = await getLockedBanner(tx, caller.appId, bannerId)
      if (!current || current.status === 'DELETED') throw new Error('NOT_FOUND')
      if (Number(current.version) !== version) throw new Error('CONFLICT')
      if (current.status === status) return getAdmin(caller, { bannerId }, tx)
      if (status === 'ACTIVE') {
        normalizeBannerTarget(current.target_type, current.target_value)
        const asset = await getMedia(tx, caller.appId, current.image_asset_id, true)
        assertBannerAsset(asset, { currentAssetId: current.image_asset_id })
      }
      const result = await tx.query(
        `UPDATE mip_banners
         SET status = ?, activated_at = CASE WHEN ? = 'ACTIVE' THEN UTC_TIMESTAMP(3) ELSE activated_at END,
           updated_by_user_id = ?, version = version + 1
         WHERE app_id = ? AND id = ? AND version = ? AND status <> 'DELETED'`,
        [status, status, caller.userId, caller.appId, bannerId, version],
      )
      if (Number(result.affectedRows) !== 1) throw new Error('CONFLICT')
      await writeAudit(
        tx,
        caller,
        roleKey,
        status === 'ACTIVE' ? 'admin.banners.activate' : 'admin.banners.deactivate',
        bannerId,
        { fromStatus: current.status, toStatus: status, expectedVersion: version },
      )
      return getAdmin(caller, { bannerId }, tx)
    })
  }

  async function move(caller, event) {
    const bannerId = requiredId(event.bannerId)
    const version = expectedVersion(event.expectedVersion)
    const direction = normalizeDirection(event.direction)
    return database.transaction(async (tx) => {
      const roleKey = await assertBannersAdmin(tx, caller, true)
      const rows = await tx.query(
        `SELECT id, sort_order, version FROM mip_banners
         WHERE app_id = ? AND status <> 'DELETED'
         ORDER BY sort_order, id FOR UPDATE`,
        [caller.appId],
      )
      const currentIndex = rows.findIndex(row => row.id === bannerId)
      if (currentIndex < 0) throw new Error('NOT_FOUND')
      if (Number(rows[currentIndex].version) !== version) throw new Error('CONFLICT')
      const targetIndex = direction === 'UP' ? currentIndex - 1 : currentIndex + 1
      if (targetIndex < 0 || targetIndex >= rows.length) {
        return listAdmin(caller, {}, tx)
      }
      const reordered = [...rows]
      const [current] = reordered.splice(currentIndex, 1)
      reordered.splice(targetIndex, 0, current)
      for (const [index, row] of reordered.entries()) {
        const nextOrder = index * 10
        if (Number(row.sort_order) !== nextOrder || row.id === bannerId || row.id === rows[targetIndex].id) {
          await tx.query(
            `UPDATE mip_banners SET sort_order = ?, updated_by_user_id = ?, version = version + 1
             WHERE app_id = ? AND id = ? AND status <> 'DELETED'`,
            [nextOrder, caller.userId, caller.appId, row.id],
          )
        }
      }
      await writeAudit(tx, caller, roleKey, 'admin.banners.reorder', bannerId, {
        direction,
        fromIndex: currentIndex,
        toIndex: targetIndex,
        expectedVersion: version,
      })
      return listAdmin(caller, {}, tx)
    })
  }

  async function remove(caller, event) {
    const bannerId = requiredId(event.bannerId)
    const version = expectedVersion(event.expectedVersion)
    return database.transaction(async (tx) => {
      const roleKey = await assertBannersAdmin(tx, caller, true)
      const current = await getLockedBanner(tx, caller.appId, bannerId)
      if (!current || current.status === 'DELETED') throw new Error('NOT_FOUND')
      if (Number(current.version) !== version) throw new Error('CONFLICT')
      const result = await tx.query(
        `UPDATE mip_banners
         SET status = 'DELETED', deleted_at = UTC_TIMESTAMP(3),
           updated_by_user_id = ?, version = version + 1
         WHERE app_id = ? AND id = ? AND version = ? AND status <> 'DELETED'`,
        [caller.userId, caller.appId, bannerId, version],
      )
      if (Number(result.affectedRows) !== 1) throw new Error('CONFLICT')
      await writeAudit(tx, caller, roleKey, 'admin.banners.delete', bannerId, {
        fromStatus: current.status,
        expectedVersion: version,
      })
      return { bannerId, deleted: true }
    })
  }

  return { changeStatus, getAdmin, getAdminSession, listActive, listAdmin, move, remove, save }
}

async function assertBannersAdmin(adapter, caller, lock = false) {
  if (lock) {
    const user = await adapter.one(
      `SELECT status FROM mip_users WHERE app_id = ? AND id = ? FOR UPDATE`,
      [caller.appId, caller.userId],
    )
    if (!user || user.status !== 'ACTIVE') throw new Error('FORBIDDEN')
  }
  const row = await adapter.one(
    `SELECT binding.role_key,
      CASE WHEN policy.policy_mode = 'CUSTOM' THEN policy.capabilities_json ELSE NULL END AS policy_capabilities_json
     FROM mip_admin_role_bindings binding
     LEFT JOIN mip_role_capability_policies policy
       ON policy.app_id = binding.app_id AND policy.role_key = binding.role_key
     WHERE binding.app_id = ? AND binding.user_id = ? AND binding.scope_type = 'PLATFORM'
       AND binding.scope_id = ? AND binding.status = 'ACTIVE'
       AND binding.role_key IN ('PLATFORM_OWNER', 'PLATFORM_OPERATIONS')
     ORDER BY (binding.role_key = 'PLATFORM_OWNER') DESC, binding.role_key ${lock ? 'FOR UPDATE' : ''}`,
    [caller.appId, caller.userId, PLATFORM_SCOPE_ID],
  )
  if (!row || !BANNER_ADMIN_ROLES.has(row.role_key)
    || !configuredCapabilityAllows(row, BANNERS_CAPABILITY)) throw new Error('FORBIDDEN')
  return row.role_key
}

function configuredCapabilityAllows(row, capability) {
  if (row.role_key === 'PLATFORM_OWNER') return true
  const value = row.policy_capabilities_json
  if (value === null || value === undefined) return true
  try {
    const capabilities = typeof value === 'string' ? JSON.parse(value) : value
    return Array.isArray(capabilities)
      && new Set(capabilities).size === capabilities.length
      && capabilities.every(item => typeof item === 'string')
      && capabilities.includes(capability)
  }
  catch {
    return false
  }
}

async function getMedia(adapter, appId, assetId, lock = false) {
  return adapter.one(
    `SELECT id, owner_user_id, purpose, cloud_file_id, content_type,
            width_px, height_px, status
     FROM mip_media_assets WHERE app_id = ? AND id = ?${lock ? ' FOR UPDATE' : ''}`,
    [appId, assetId],
  )
}

async function getLockedBanner(adapter, appId, bannerId) {
  return adapter.one(
    `SELECT * FROM mip_banners WHERE app_id = ? AND id = ? FOR UPDATE`,
    [appId, bannerId],
  )
}

function bannerSelect() {
  return `SELECT banner.*, asset.cloud_file_id AS image_url,
                 asset.id AS asset_id, asset.owner_user_id AS asset_owner_user_id,
                 asset.purpose AS asset_purpose, asset.content_type AS asset_content_type,
                 asset.width_px AS asset_width_px, asset.height_px AS asset_height_px,
                 asset.status AS asset_status
          FROM mip_banners banner
          INNER JOIN mip_media_assets asset
            ON asset.app_id = banner.app_id AND asset.id = banner.image_asset_id`
}

function mediaRow(row) {
  return {
    id: row.asset_id,
    owner_user_id: row.asset_owner_user_id,
    purpose: row.asset_purpose,
    cloud_file_id: row.image_url,
    content_type: row.asset_content_type,
    width_px: row.asset_width_px,
    height_px: row.asset_height_px,
    status: row.asset_status,
  }
}

function publicBannerDto(row) {
  return {
    id: row.id,
    title: row.title,
    accessibilityLabel: row.accessibility_label,
    imageUrl: row.image_url,
    targetType: row.target_type,
    targetValue: row.target_value,
    sortOrder: Number(row.sort_order),
  }
}

function adminBannerDto(row) {
  return {
    ...publicBannerDto(row),
    imageAssetId: row.image_asset_id,
    imageWidth: Number(row.asset_width_px),
    imageHeight: Number(row.asset_height_px),
    imageStatus: row.asset_status,
    status: row.status,
    version: Number(row.version),
    activatedAt: iso(row.activated_at),
    deletedAt: iso(row.deleted_at),
    updatedAt: iso(row.updated_at),
  }
}

async function writeAudit(tx, caller, roleKey, action, resourceId, metadata) {
  await tx.query(
    `INSERT INTO mip_audit_logs (
       app_id, actor_user_id, actor_type, scope_type, scope_id,
       action, resource_type, resource_id, effective_role, metadata_json
     ) VALUES (?, ?, 'ADMIN', 'PLATFORM', NULL, ?, 'BANNER', ?, ?, ?)`,
    [caller.appId, caller.userId, action, resourceId, roleKey, JSON.stringify(metadata)],
  )
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, match => `\\${match}`)
}

function iso(value) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : ''
}

function normalizeIdempotencyKey(value) {
  if (value === undefined || value === null || value === '') return undefined
  const key = typeof value === 'string' ? value.trim() : ''
  if (!/^[A-Za-z0-9_.:-]{12,128}$/.test(key)) throw new Error('VALIDATION_FAILED')
  return key
}

module.exports = {
  BANNERS_CAPABILITY,
  BANNER_ADMIN_ROLES,
  PLATFORM_SCOPE_ID,
  adminBannerDto,
  assertBannersAdmin,
  createBannerRepository,
  publicBannerDto,
}
