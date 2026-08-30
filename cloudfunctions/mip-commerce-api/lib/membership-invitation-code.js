'use strict'

const { createHash, createHmac } = require('node:crypto')

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function deploymentStage(value) {
  const stage = String(value || '').trim().toLowerCase()
  if (!['development', 'test', 'staging', 'production'].includes(stage)) {
    throw new Error('MEMBERSHIP_INVITATION_CODE_UNAVAILABLE')
  }
  return stage
}

function codeEnvironment(stage) {
  if (stage === 'production') return 'release'
  if (stage === 'staging') return 'trial'
  return 'develop'
}

function invitationCodeKey({ appId, scene, allocationId, env = process.env }) {
  const secret = String(env.MIP_MEDIA_SCOPE_SECRET || '')
  if (!appId || !/^[A-Za-z0-9_-]{32}$/.test(scene)
    || !UUID_PATTERN.test(allocationId) || secret.length < 32) {
    throw new Error('MEMBERSHIP_INVITATION_CODE_UNAVAILABLE')
  }
  const stage = deploymentStage(env.MIP_DEPLOYMENT_STAGE)
  const appScope = createHmac('sha256', secret).update(appId).digest('hex').slice(0, 24)
  const reference = createHash('sha256')
    .update(`MIP_MEMBERSHIP_INVITATION_ALLOCATION_V1\0${allocationId}`)
    .digest('hex')
    .slice(0, 32)
  return `mip/${stage}/${appScope}/membership-invitations/${reference}.png`
}

function assertUploadedObject(fileId, objectKey) {
  if (typeof fileId !== 'string' || !fileId.startsWith('cloud://')
    || !fileId.endsWith(`/${objectKey}`) || fileId.includes('..')
    || fileId.includes('\\') || /\s/.test(fileId)) {
    throw new Error('MEMBERSHIP_INVITATION_CODE_UNAVAILABLE')
  }
}

async function deleteUploadedObject(cloud, fileId, objectKey) {
  if (typeof cloud?.deleteFile !== 'function') return false
  try {
    assertUploadedObject(fileId, objectKey)
    const result = await cloud.deleteFile({ fileList: [fileId] })
    const list = result?.fileList || result?.file_list
    if (!Array.isArray(list) || list.length !== 1) return false
    const item = list[0]
    const returnedId = item?.fileID || item?.fileId || item?.file_id
    return returnedId === fileId && [0, '0'].includes(item?.status)
  }
  catch {
    return false
  }
}

async function bindAllocationObjectKey(database, input) {
  const bound = await database.query(
    `UPDATE mip_membership_invitation_codes
     SET allocation_object_key = ?
     WHERE app_id = ? AND id = ? AND inviter_user_id = ?
       AND status = 'PENDING' AND lease_token = ?
       AND allocation_id = ? AND allocation_asset_id = ?
       AND lease_expires_at > UTC_TIMESTAMP(3)
       AND (allocation_object_key IS NULL OR allocation_object_key = ?)`,
    [
      input.objectKey,
      input.appId,
      input.invitationId,
      input.inviterUserId,
      input.leaseToken,
      input.allocationId,
      input.assetId,
      input.objectKey,
    ],
  )
  if (Number(bound?.affectedRows) === 1) return true
  const stored = await database.one(
    `SELECT allocation_object_key FROM mip_membership_invitation_codes
     WHERE app_id = ? AND id = ? AND inviter_user_id = ?
       AND status = 'PENDING' AND lease_token = ?
       AND allocation_id = ? AND allocation_asset_id = ?
       AND lease_expires_at > UTC_TIMESTAMP(3)`,
    [
      input.appId,
      input.invitationId,
      input.inviterUserId,
      input.leaseToken,
      input.allocationId,
      input.assetId,
    ],
  )
  if (stored?.allocation_object_key !== input.objectKey) {
    throw new Error('MEMBERSHIP_INVITATION_CODE_UNAVAILABLE')
  }
  return true
}

async function uploadExactObject(cloud, objectKey, content, attempts = 2) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const uploaded = await cloud.uploadFile({ cloudPath: objectKey, fileContent: content })
      const codeUrl = typeof uploaded?.fileID === 'string' ? uploaded.fileID.trim() : ''
      assertUploadedObject(codeUrl, objectKey)
      return codeUrl
    }
    catch {
      if (attempt === attempts) throw new Error('MEMBERSHIP_INVITATION_CODE_UNAVAILABLE')
    }
  }
  throw new Error('MEMBERSHIP_INVITATION_CODE_UNAVAILABLE')
}

async function readInvitationCodeOutcome(database, appId, invitationId) {
  return database.one(
    `SELECT code.status, code.lease_token, code.allocation_id,
            code.allocation_asset_id, code.code_asset_id,
            code.expires_at > UTC_TIMESTAMP(3) AS unexpired,
            asset.owner_user_id, asset.status AS asset_status,
            asset.object_key, asset.cloud_file_id
     FROM mip_membership_invitation_codes code
     LEFT JOIN mip_media_assets asset
       ON asset.app_id = code.app_id AND asset.id = code.code_asset_id
     WHERE code.app_id = ? AND code.id = ?`,
    [appId, invitationId],
  )
}

async function ensurePendingAsset(database, input) {
  return database.transaction(async (tx) => {
    const code = await tx.one(
      `SELECT id FROM mip_membership_invitation_codes
       WHERE app_id = ? AND id = ? AND inviter_user_id = ?
         AND status = 'PENDING' AND lease_token = ?
         AND allocation_id = ? AND allocation_asset_id = ?
         AND lease_expires_at > UTC_TIMESTAMP(3)
       FOR UPDATE`,
      [
        input.appId,
        input.invitationId,
        input.inviterUserId,
        input.leaseToken,
        input.allocationId,
        input.assetId,
      ],
    )
    if (!code) throw new Error('MEMBERSHIP_INVITATION_CODE_UNAVAILABLE')
    let asset = await tx.one(
      `SELECT id, owner_user_id, purpose, status, cloud_file_id
       FROM mip_media_assets
       WHERE app_id = ? AND object_key = ? FOR UPDATE`,
      [input.appId, input.objectKey],
    )
    if (!asset) {
      const inserted = await tx.query(
        `INSERT INTO mip_media_assets (
           id, app_id, owner_user_id, purpose, object_key, cloud_file_id,
           content_sha256, content_type, content_bytes, width_px, height_px, status
         ) VALUES (?, ?, NULL, 'MEMBERSHIP_INVITATION_CODE', ?, ?, ?,
           'image/png', ?, 430, 430, 'PENDING')`,
        [
          input.assetId,
          input.appId,
          input.objectKey,
          input.codeUrl,
          input.contentSha256,
          input.contentBytes,
        ],
      )
      if (Number(inserted?.affectedRows) !== 1) {
        throw new Error('MEMBERSHIP_INVITATION_CODE_UNAVAILABLE')
      }
      asset = { id: input.assetId, owner_user_id: null, status: 'PENDING' }
    }
    else if (asset.id === input.assetId && asset.purpose === 'MEMBERSHIP_INVITATION_CODE'
      && ['PENDING', 'DELETED'].includes(asset.status) && asset.owner_user_id == null) {
      const revived = await tx.query(
        `UPDATE mip_media_assets
         SET owner_user_id = NULL, cloud_file_id = ?, content_sha256 = ?,
             content_type = 'image/png', content_bytes = ?, width_px = 430,
             height_px = 430, status = 'PENDING'
         WHERE app_id = ? AND id = ? AND purpose = 'MEMBERSHIP_INVITATION_CODE'
           AND owner_user_id IS NULL AND status IN ('PENDING', 'DELETED')`,
        [input.codeUrl, input.contentSha256, input.contentBytes, input.appId, asset.id],
      )
      if (Number(revived?.affectedRows) !== 1) {
        throw new Error('MEMBERSHIP_INVITATION_CODE_UNAVAILABLE')
      }
      asset = { ...asset, owner_user_id: null, status: 'PENDING' }
    }
    else {
      throw new Error('MEMBERSHIP_INVITATION_CODE_UNAVAILABLE')
    }
    const attached = await tx.query(
      `UPDATE mip_membership_invitation_codes
       SET code_asset_id = ?
       WHERE app_id = ? AND id = ? AND inviter_user_id = ?
         AND status = 'PENDING' AND lease_token = ?
         AND allocation_id = ? AND allocation_asset_id = ?`,
      [
        asset.id,
        input.appId,
        input.invitationId,
        input.inviterUserId,
        input.leaseToken,
        input.allocationId,
        input.assetId,
      ],
    )
    if (Number(attached?.affectedRows) !== 1) {
      throw new Error('MEMBERSHIP_INVITATION_CODE_UNAVAILABLE')
    }
    return asset.id
  })
}

async function finalizeInvitationCode(database, input) {
  return database.transaction(async (tx) => {
    const owner = await tx.one(
      `SELECT member.id
       FROM mip_users member
       WHERE member.app_id = ? AND member.id = ? AND member.status = 'ACTIVE'
         AND EXISTS (
           SELECT 1 FROM mip_membership_entitlements entitlement
           WHERE entitlement.app_id = member.app_id AND entitlement.user_id = member.id
             AND entitlement.status = 'ACTIVE'
             AND entitlement.starts_at <= UTC_TIMESTAMP(3)
             AND entitlement.ends_at > UTC_TIMESTAMP(3)
         )
       LIMIT 1 FOR UPDATE`,
      [input.appId, input.inviterUserId],
    )
    if (!owner) {
      throw new Error('MEMBERSHIP_INVITATION_FORBIDDEN')
    }
    const code = await tx.one(
      `SELECT code_asset_id FROM mip_membership_invitation_codes
       WHERE app_id = ? AND id = ? AND inviter_user_id = ?
         AND status = 'PENDING' AND lease_token = ?
         AND allocation_id = ? AND allocation_asset_id = ?
         AND lease_expires_at > UTC_TIMESTAMP(3) AND expires_at > UTC_TIMESTAMP(3)
       FOR UPDATE`,
      [
        input.appId,
        input.invitationId,
        input.inviterUserId,
        input.leaseToken,
        input.allocationId,
        input.assetId,
      ],
    )
    if (!code || code.code_asset_id !== input.assetId) {
      throw new Error('MEMBERSHIP_INVITATION_CODE_UNAVAILABLE')
    }
    const activated = await tx.query(
      `UPDATE mip_media_assets
       SET owner_user_id = ?, status = 'READY'
       WHERE app_id = ? AND id = ? AND owner_user_id IS NULL
         AND purpose = 'MEMBERSHIP_INVITATION_CODE' AND status = 'PENDING'`,
      [input.inviterUserId, input.appId, input.assetId],
    )
    if (Number(activated?.affectedRows) !== 1) {
      throw new Error('MEMBERSHIP_INVITATION_CODE_UNAVAILABLE')
    }
    const completed = await tx.query(
      `UPDATE mip_membership_invitation_codes
       SET status = 'READY', lease_token = NULL, lease_expires_at = NULL
       WHERE app_id = ? AND id = ? AND inviter_user_id = ?
         AND code_asset_id = ? AND status = 'PENDING' AND lease_token = ?
         AND allocation_id = ? AND allocation_asset_id = ?`,
      [
        input.appId,
        input.invitationId,
        input.inviterUserId,
        input.assetId,
        input.leaseToken,
        input.allocationId,
        input.assetId,
      ],
    )
    if (Number(completed?.affectedRows) !== 1) {
      throw new Error('MEMBERSHIP_INVITATION_CODE_UNAVAILABLE')
    }
  })
}

async function markFailedAfterDeletion(database, input) {
  return database.transaction(async (tx) => {
    const code = await tx.one(
      `SELECT code_asset_id FROM mip_membership_invitation_codes
       WHERE app_id = ? AND id = ? AND status = 'PENDING' AND lease_token = ?
         AND allocation_id = ? AND allocation_asset_id = ?
       FOR UPDATE`,
      [
        input.appId,
        input.invitationId,
        input.leaseToken,
        input.allocationId,
        input.assetId,
      ],
    )
    if (!code || (code.code_asset_id && code.code_asset_id !== input.assetId)) return false
    if (code.code_asset_id) {
      const deleted = await tx.query(
        `UPDATE mip_media_assets SET status = 'DELETED'
         WHERE app_id = ? AND id = ? AND owner_user_id IS NULL
           AND purpose = 'MEMBERSHIP_INVITATION_CODE' AND status = 'PENDING'`,
        [input.appId, input.assetId],
      )
      if (Number(deleted?.affectedRows) !== 1) return false
    }
    const failed = await tx.query(
      `UPDATE mip_membership_invitation_codes
       SET status = 'FAILED', lease_token = NULL, lease_expires_at = NULL
       WHERE app_id = ? AND id = ? AND status = 'PENDING' AND lease_token = ?
         AND allocation_id = ? AND allocation_asset_id = ?`,
      [
        input.appId,
        input.invitationId,
        input.leaseToken,
        input.allocationId,
        input.assetId,
      ],
    )
    return Number(failed?.affectedRows) === 1
  })
}

async function markDetachedAllocationDeleted(database, input) {
  const result = await database.query(
    `UPDATE mip_media_assets SET status = 'DELETED'
     WHERE app_id = ? AND id = ? AND object_key = ? AND owner_user_id IS NULL
       AND purpose = 'MEMBERSHIP_INVITATION_CODE' AND status = 'PENDING'`,
    [input.appId, input.assetId, input.objectKey],
  )
  return Number(result?.affectedRows) === 1
}

async function ensureDetachedTombstone(database, input) {
  return database.transaction(async (tx) => {
    const existing = await tx.one(
      `SELECT id, owner_user_id, purpose, status, object_key
       FROM mip_media_assets
       WHERE app_id = ? AND id = ? FOR UPDATE`,
      [input.appId, input.assetId],
    )
    if (!existing) {
      const inserted = await tx.query(
        `INSERT INTO mip_media_assets (
           id, app_id, owner_user_id, purpose, object_key, cloud_file_id,
           content_sha256, content_type, content_bytes, width_px, height_px, status
         ) VALUES (?, ?, NULL, 'MEMBERSHIP_INVITATION_CODE', ?, ?, ?,
           'image/png', ?, 430, 430, 'PENDING')`,
        [
          input.assetId,
          input.appId,
          input.objectKey,
          input.codeUrl,
          input.contentSha256,
          input.contentBytes,
        ],
      )
      if (Number(inserted?.affectedRows) !== 1) {
        throw new Error('MEMBERSHIP_INVITATION_CODE_UNAVAILABLE')
      }
      return { state: 'PENDING' }
    }
    if (existing.purpose !== 'MEMBERSHIP_INVITATION_CODE'
      || existing.object_key !== input.objectKey) {
      throw new Error('MEMBERSHIP_INVITATION_CODE_UNAVAILABLE')
    }
    if (existing.status === 'READY' && existing.owner_user_id === input.inviterUserId) {
      return { state: 'READY' }
    }
    if (!['PENDING', 'DELETED'].includes(existing.status) || existing.owner_user_id != null) {
      throw new Error('MEMBERSHIP_INVITATION_CODE_UNAVAILABLE')
    }
    const pending = await tx.query(
      `UPDATE mip_media_assets
       SET cloud_file_id = ?, content_sha256 = ?, content_type = 'image/png',
           content_bytes = ?, width_px = 430, height_px = 430, status = 'PENDING'
       WHERE app_id = ? AND id = ? AND object_key = ? AND owner_user_id IS NULL
         AND purpose = 'MEMBERSHIP_INVITATION_CODE' AND status IN ('PENDING', 'DELETED')`,
      [
        input.codeUrl,
        input.contentSha256,
        input.contentBytes,
        input.appId,
        input.assetId,
        input.objectKey,
      ],
    )
    if (Number(pending?.affectedRows) !== 1) {
      throw new Error('MEMBERSHIP_INVITATION_CODE_UNAVAILABLE')
    }
    return { state: 'PENDING' }
  })
}

async function createMembershipInvitationCode({
  appId,
  inviterUserId,
  invitationId,
  leaseToken,
  allocationId,
  assetId,
  scene,
  cloud,
  database,
  env = process.env,
}) {
  if (!UUID_PATTERN.test(inviterUserId) || !UUID_PATTERN.test(invitationId)
    || !UUID_PATTERN.test(leaseToken) || !UUID_PATTERN.test(allocationId)
    || !UUID_PATTERN.test(assetId) || typeof database?.transaction !== 'function'
    || typeof database?.one !== 'function' || typeof database?.query !== 'function'
    || typeof cloud?.openapi?.wxacode?.getUnlimited !== 'function'
    || typeof cloud?.uploadFile !== 'function') {
    throw new Error('MEMBERSHIP_INVITATION_CODE_UNAVAILABLE')
  }
  const stage = deploymentStage(env.MIP_DEPLOYMENT_STAGE)
  const objectKey = invitationCodeKey({ appId, scene, allocationId, env })
  await bindAllocationObjectKey(database, {
    appId,
    inviterUserId,
    invitationId,
    leaseToken,
    allocationId,
    assetId,
    objectKey,
  })
  const response = await cloud.openapi.wxacode.getUnlimited({
    scene,
    page: 'pages/membership/index',
    width: 430,
    checkPath: false,
    envVersion: codeEnvironment(stage),
  })
  const content = Buffer.isBuffer(response) ? response : response?.buffer
  if (!Buffer.isBuffer(content) || content.length < PNG_SIGNATURE.length
    || content.length > 2 * 1024 * 1024
    || !content.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error('MEMBERSHIP_INVITATION_CODE_UNAVAILABLE')
  }
  const codeUrl = await uploadExactObject(cloud, objectKey, content)
  const assetInput = {
    appId,
    inviterUserId,
    invitationId,
    leaseToken,
    allocationId,
    assetId,
    objectKey,
    codeUrl,
    contentSha256: createHash('sha256').update(content).digest('hex'),
    contentBytes: content.length,
  }
  let registeredAssetId
  try {
    registeredAssetId = await ensurePendingAsset(database, assetInput)
    await finalizeInvitationCode(database, { ...assetInput, assetId: registeredAssetId })
    return { assetId: registeredAssetId, codeUrl, objectKey }
  }
  catch (error) {
    let outcome
    try {
      outcome = await readInvitationCodeOutcome(database, appId, invitationId)
    }
    catch {
      throw error
    }
    const currentAllocation = outcome?.allocation_id === allocationId
      && outcome?.allocation_asset_id === assetId
    const readyOutcome = outcome?.status === 'READY' && Number(outcome.unexpired) === 1
      && outcome.asset_status === 'READY' && outcome.owner_user_id === inviterUserId
    if (readyOutcome && currentAllocation && outcome.code_asset_id === assetId) {
      assertUploadedObject(outcome.cloud_file_id, outcome.object_key)
      return {
        assetId: outcome.code_asset_id,
        codeUrl: outcome.cloud_file_id,
        objectKey: outcome.object_key,
      }
    }
    const tombstone = await ensureDetachedTombstone(database, assetInput).catch(() => null)
    if (!tombstone) throw error
    if (tombstone.state === 'READY') throw error
    const deleted = await deleteUploadedObject(cloud, codeUrl, objectKey)
    if (!deleted) throw error
    if (currentAllocation && outcome?.status === 'PENDING' && outcome.lease_token === leaseToken) {
      await markFailedAfterDeletion(database, assetInput).catch(() => false)
      await markDetachedAllocationDeleted(database, assetInput).catch(() => false)
    }
    else {
      await markDetachedAllocationDeleted(database, assetInput).catch(() => false)
    }
    if (readyOutcome) {
      assertUploadedObject(outcome.cloud_file_id, outcome.object_key)
      return {
        assetId: outcome.code_asset_id,
        codeUrl: outcome.cloud_file_id,
        objectKey: outcome.object_key,
      }
    }
    throw error
  }
}

module.exports = {
  assertUploadedObject,
  bindAllocationObjectKey,
  codeEnvironment,
  createMembershipInvitationCode,
  deleteUploadedObject,
  deploymentStage,
  ensurePendingAsset,
  ensureDetachedTombstone,
  finalizeInvitationCode,
  invitationCodeKey,
  readInvitationCodeOutcome,
  uploadExactObject,
}
