'use strict'

const { createHash, createHmac, randomUUID } = require('node:crypto')
const { PURPOSE_POLICIES, decodeAndSanitizeImage, openApiChecker } = require('./image')

const CLEANABLE_PURPOSES = Object.freeze([
  ...Object.keys(PURPOSE_POLICIES),
  'CHECKIN_POSTER',
  'EVENT_INVITATION_CODE',
])
const ADMIN_UPLOAD_PURPOSES = new Set(['BANNER', 'TASK_TEMPLATE'])

function deploymentStage(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!['development', 'test', 'staging', 'production'].includes(normalized)) {
    throw new Error('SERVICE_UNAVAILABLE')
  }
  return normalized
}

function objectScope(secret, value, length) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('SERVICE_UNAVAILABLE')
  }
  return createHmac('sha256', secret).update(value).digest('hex').slice(0, length)
}

function buildObjectKey({ appId, userId, purpose, assetId, extension, env = process.env }) {
  const policy = PURPOSE_POLICIES[purpose]
  if (!policy || !/^[0-9a-f-]{36}$/i.test(assetId) || !['png', 'jpg'].includes(extension)) {
    throw new Error('PURPOSE_INVALID')
  }
  const secret = String(env.MIP_MEDIA_SCOPE_SECRET || '')
  const stage = deploymentStage(env.MIP_DEPLOYMENT_STAGE)
  const appScope = objectScope(secret, appId, 24)
  const userScope = objectScope(secret, `${appId}\0${userId}`, 24)
  const objectKey = `mip/${stage}/${appScope}/${policy.directory}/${userScope}/${assetId}.${extension}`
  if (!/^mip\/(development|test|staging|production)\/[0-9a-f]{24}\/[a-z-]+\/[0-9a-f]{24}\/[0-9a-f-]{36}\.(?:png|jpg)$/.test(objectKey)
    || objectKey.includes('..')) {
    throw new Error('SERVICE_UNAVAILABLE')
  }
  return objectKey
}

function cloudObjectKey(fileId) {
  if (typeof fileId !== 'string' || fileId.length > 1024 || !fileId.startsWith('cloud://')
    || fileId.includes('..') || fileId.includes('\\') || /\s/.test(fileId)) {
    throw new Error('MEDIA_FILE_INVALID')
  }
  const tail = fileId.slice('cloud://'.length)
  const slash = tail.indexOf('/')
  if (slash <= 0 || slash === tail.length - 1) throw new Error('MEDIA_FILE_INVALID')
  return tail.slice(slash + 1)
}

function assertOwnedMipFile({ appId, objectKey, fileId, env = process.env }) {
  const secret = String(env.MIP_MEDIA_SCOPE_SECRET || '')
  const appScope = objectScope(secret, appId, 24)
  if (typeof objectKey !== 'string'
    || !new RegExp(`^mip/(?:development|test|staging|production)/${appScope}/`).test(objectKey)
    || objectKey.includes('..')
    || objectKey.includes('\\')
    || /\s/.test(objectKey)
    || cloudObjectKey(fileId) !== objectKey) {
    throw new Error('MEDIA_FILE_INVALID')
  }
  return true
}

async function deleteOwnedFile(cloud, input) {
  if (typeof cloud?.deleteFile !== 'function') return false
  try {
    assertOwnedMipFile(input)
    const result = await cloud.deleteFile({ fileList: [input.fileId] })
    assertDeleted(result, input.fileId)
    return true
  }
  catch {
    return false
  }
}

function assertDeleted(result, fileId) {
  const list = result?.fileList || result?.file_list
  if (!Array.isArray(list) || list.length !== 1) {
    throw new Error('MEDIA_DELETE_FAILED')
  }
  const item = list[0]
  const returnedId = item?.fileID || item?.fileId || item?.file_id
  if (returnedId !== fileId || ![0, '0'].includes(item?.status)) {
    throw new Error('MEDIA_DELETE_FAILED')
  }
}

async function lockActiveUser(adapter, caller) {
  const user = await adapter.one(
    `SELECT id, status FROM mip_users
     WHERE app_id = ? AND id = ? FOR UPDATE`,
    [caller.appId, caller.userId],
  )
  if (!user || user.status !== 'ACTIVE') throw new Error('FORBIDDEN')
}

function createMediaService({ database, cloud, checker, env = process.env, id = randomUUID }) {
  const checkImage = checker || openApiChecker(cloud)

  async function health() {
    const row = await database.one('SELECT 1 AS ok')
    if (Number(row?.ok) !== 1) throw new Error('SERVICE_UNAVAILABLE')
    return { service: 'mip-media-api', persistence: 'cloudbase-mysql' }
  }

  async function uploadImage(caller, value) {
    const purpose = typeof value?.purpose === 'string' ? value.purpose.trim() : ''
    if (!PURPOSE_POLICIES[purpose]) throw new Error('PURPOSE_INVALID')
    if (ADMIN_UPLOAD_PURPOSES.has(purpose)) {
      const role = await database.one(
        `SELECT role_key FROM mip_admin_role_bindings
         WHERE app_id = ? AND user_id = ? AND scope_type = 'PLATFORM'
           AND scope_id = '00000000-0000-0000-0000-000000000000'
           AND status = 'ACTIVE'
           AND role_key IN ('PLATFORM_OWNER', 'PLATFORM_OPERATIONS')
         LIMIT 1`,
        [caller.appId, caller.userId],
      )
      if (!role) throw new Error('FORBIDDEN')
    }
    const image = decodeAndSanitizeImage(value?.imageBase64, purpose)
    const safetyResult = await checkImage(image)
    if (safetyResult === false || safetyResult?.ok === false || safetyResult?.rejected === true) {
      throw new Error('IMAGE_CONTENT_REJECTED')
    }
    const assetId = id()
    const objectKey = buildObjectKey({
      appId: caller.appId,
      userId: caller.userId,
      purpose,
      assetId,
      extension: image.extension,
      env,
    })
    const contentSha256 = createHash('sha256').update(image.buffer).digest('hex')
    let cloudFileId = ''
    let tombstoneRegistered = false
    const registerTombstone = async () => {
      const pending = await database.query(
        `INSERT INTO mip_media_assets (
           id, app_id, owner_user_id, purpose, object_key, cloud_file_id,
           content_sha256, content_type, content_bytes, width_px, height_px, status
         ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
        [
          assetId,
          caller.appId,
          purpose,
          objectKey,
          cloudFileId,
          contentSha256,
          image.contentType,
          image.bytes,
          image.width,
          image.height,
        ],
      )
      if (Number(pending?.affectedRows) !== 1) throw new Error('UPLOAD_FAILED')
      tombstoneRegistered = true
    }
    try {
      const uploaded = await cloud.uploadFile({ cloudPath: objectKey, fileContent: image.buffer })
      cloudFileId = typeof uploaded?.fileID === 'string' ? uploaded.fileID.trim() : ''
      if (!cloudFileId.startsWith('cloud://') || cloudFileId.length > 1024) {
        throw new Error('UPLOAD_FAILED')
      }
      assertOwnedMipFile({ appId: caller.appId, objectKey, fileId: cloudFileId, env })
      await registerTombstone()
      await database.transaction(async (tx) => {
        await lockActiveUser(tx, caller)
        const result = await tx.query(
          `UPDATE mip_media_assets
           SET owner_user_id = ?, status = 'READY'
           WHERE app_id = ? AND id = ? AND owner_user_id IS NULL AND status = 'PENDING'`,
          [caller.userId, caller.appId, assetId],
        )
        if (Number(result?.affectedRows) !== 1) throw new Error('UPLOAD_FAILED')
      })
      return {
        assetId,
        purpose,
        imageUrl: cloudFileId,
        width: image.width,
        height: image.height,
      }
    }
    catch (error) {
      const cleanupFileId = cloudFileId || (typeof error?.fileID === 'string' ? error.fileID : '')
      let uploadState
      let stateKnown = false
      try {
        uploadState = await database.one(
          `SELECT owner_user_id, status FROM mip_media_assets
           WHERE app_id = ? AND id = ?`,
          [caller.appId, assetId],
        )
        stateKnown = true
      }
      catch {}
      if (uploadState?.status === 'READY' && uploadState.owner_user_id === caller.userId) {
        return {
          assetId,
          purpose,
          imageUrl: cloudFileId,
          width: image.width,
          height: image.height,
        }
      }
      if (!stateKnown) {
        if (error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)) throw error
        throw new Error('UPLOAD_FAILED')
      }
      if (!uploadState && cleanupFileId) {
        try {
          await registerTombstone()
          uploadState = { owner_user_id: null, status: 'PENDING' }
        }
        catch {
          try {
            uploadState = await database.one(
              `SELECT owner_user_id, status FROM mip_media_assets
               WHERE app_id = ? AND id = ?`,
              [caller.appId, assetId],
            )
          }
          catch {
            if (error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)) throw error
            throw new Error('UPLOAD_FAILED')
          }
        }
      }
      if (uploadState?.status === 'READY' && uploadState.owner_user_id === caller.userId) {
        return {
          assetId,
          purpose,
          imageUrl: cloudFileId,
          width: image.width,
          height: image.height,
        }
      }
      const canDelete = !uploadState
        || (uploadState.status === 'PENDING' && uploadState.owner_user_id == null)
      if (!canDelete) {
        if (error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)) throw error
        throw new Error('UPLOAD_FAILED')
      }
      const deleted = await deleteOwnedFile(cloud, {
        appId: caller.appId,
        objectKey,
        fileId: cleanupFileId,
        env,
      })
      if (deleted && (tombstoneRegistered
        || (uploadState?.status === 'PENDING' && uploadState.owner_user_id == null))) {
        await database.query(
          `UPDATE mip_media_assets SET status = 'DELETED'
           WHERE app_id = ? AND id = ? AND owner_user_id IS NULL AND status = 'PENDING'`,
          [caller.appId, assetId],
        ).catch(() => undefined)
      }
      if (error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)) throw error
      throw new Error('UPLOAD_FAILED')
    }
  }

  async function cleanupOrphans(appId, value = {}) {
    const limit = Number(value.limit || 10)
    const minimumAgeHours = Number(value.minimumAgeHours || 24)
    if (!/^wx[0-9a-f]{16}$/i.test(appId)
      || !Number.isInteger(limit) || limit < 1 || limit > 20
      || !Number.isInteger(minimumAgeHours) || minimumAgeHours < 24 || minimumAgeHours > 2160) {
      throw new Error('MEDIA_CLEANUP_INVALID')
    }
    const leased = await database.transaction(async (tx) => {
      const rows = await tx.query(
        `SELECT asset.id, asset.object_key, asset.cloud_file_id
         FROM mip_media_assets asset
         WHERE asset.app_id = ?
           AND asset.purpose IN (${CLEANABLE_PURPOSES.map(() => '?').join(', ')})
           AND (
             asset.status = 'READY'
             OR (asset.status = 'PENDING' AND asset.updated_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 30 MINUTE))
           )
           AND asset.created_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? HOUR)
           AND NOT EXISTS (
             SELECT 1 FROM mip_profiles profile
             WHERE profile.app_id = asset.app_id AND profile.avatar_asset_id = asset.id
           )
           AND NOT EXISTS (
             SELECT 1 FROM mip_events event
             WHERE event.app_id = asset.app_id AND event.cover_asset_id = asset.id
           )
           AND NOT EXISTS (
             SELECT 1 FROM mip_event_content_media content_media
             WHERE content_media.app_id = asset.app_id AND content_media.media_asset_id = asset.id
               AND content_media.status = 'ACTIVE'
           )
           AND NOT EXISTS (
             SELECT 1 FROM mip_event_album_photos photo
             WHERE photo.app_id = asset.app_id AND photo.media_asset_id = asset.id
               AND photo.status IN ('PENDING', 'PUBLISHED')
           )
           AND NOT EXISTS (
             SELECT 1 FROM mip_opportunities opportunity
             WHERE opportunity.app_id = asset.app_id AND opportunity.cover_asset_id = asset.id
           )
           AND NOT EXISTS (
             SELECT 1 FROM mip_super_cases super_case
             WHERE super_case.app_id = asset.app_id AND super_case.cover_asset_id = asset.id
           )
           AND NOT EXISTS (
             SELECT 1 FROM mip_super_case_media media
             WHERE media.app_id = asset.app_id AND media.media_asset_id = asset.id
           )
           AND NOT EXISTS (
             SELECT 1 FROM mip_task_completions completion
             WHERE completion.app_id = asset.app_id AND completion.attachment_asset_id = asset.id
           )
           AND NOT EXISTS (
             SELECT 1 FROM mip_task_cards task
             WHERE task.app_id = asset.app_id AND task.template_asset_id = asset.id
               AND task.status <> 'DELETED'
           )
           AND NOT EXISTS (
             SELECT 1 FROM mip_banners banner
             WHERE banner.app_id = asset.app_id AND banner.image_asset_id = asset.id
               AND banner.status <> 'DELETED'
           )
           AND NOT EXISTS (
             SELECT 1 FROM mip_event_invitation_links invitation
             WHERE invitation.app_id = asset.app_id AND invitation.code_asset_id = asset.id
               AND invitation.status = 'ACTIVE' AND invitation.expires_at > UTC_TIMESTAMP(3)
           )
           AND (
             asset.purpose <> 'CHECKIN_POSTER'
             OR NOT EXISTS (
               SELECT 1 FROM mip_event_checkin_credentials credential
               WHERE credential.app_id = asset.app_id
                 AND credential.status = 'ACTIVE'
                 AND credential.valid_until > UTC_TIMESTAMP(3)
                 AND asset.object_key LIKE CONCAT('%/', credential.event_id, '/', credential.id, '.png')
             )
           )
         ORDER BY asset.created_at, asset.id
         LIMIT ? FOR UPDATE SKIP LOCKED`,
        [appId, ...CLEANABLE_PURPOSES, minimumAgeHours, limit],
      )
      for (const row of rows) {
        await tx.query(
          `UPDATE mip_media_assets SET status = 'PENDING'
           WHERE app_id = ? AND id = ? AND status IN ('READY', 'PENDING')`,
          [appId, row.id],
        )
      }
      return rows
    })

    let deleted = 0
    let failed = 0
    for (const asset of leased) {
      try {
        assertOwnedMipFile({
          appId,
          objectKey: asset.object_key,
          fileId: asset.cloud_file_id,
          env,
        })
        const result = await cloud.deleteFile({ fileList: [asset.cloud_file_id] })
        assertDeleted(result, asset.cloud_file_id)
        const update = await database.query(
          `UPDATE mip_media_assets SET status = 'DELETED'
           WHERE app_id = ? AND id = ? AND status = 'PENDING'`,
          [appId, asset.id],
        )
        if (Number(update?.affectedRows) !== 1) {
          throw new Error('MEDIA_CLEANUP_LEASE_LOST')
        }
        deleted += 1
      }
      catch {
        failed += 1
        // PENDING is the non-public deletion intent. Keep it on every failure:
        // storage responses can be ambiguous, and a later run can safely retry.
      }
    }
    return { scanned: leased.length, deleted, failed }
  }

  return { cleanupOrphans, health, uploadImage }
}

module.exports = {
  assertDeleted,
  assertOwnedMipFile,
  buildObjectKey,
  cloudObjectKey,
  createMediaService,
  deleteOwnedFile,
  deploymentStage,
}
