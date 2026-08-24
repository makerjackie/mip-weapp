'use strict'

const { createHash, createHmac, randomUUID } = require('node:crypto')
const { DomainError } = require('../domain/rules')

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function deploymentStage(value) {
  const stage = String(value || '').trim().toLowerCase()
  if (!['development', 'test', 'staging', 'production'].includes(stage)) {
    throw new Error('CHECKIN_POSTER_CONFIG_REQUIRED')
  }
  return stage
}

function buildCheckInCodeKey({ appId, eventId, credentialId, env = process.env }) {
  const secret = String(env.MIP_MEDIA_SCOPE_SECRET || '')
  if (typeof appId !== 'string'
    || !appId
    || !ID_PATTERN.test(eventId)
    || !ID_PATTERN.test(credentialId)
    || secret.length < 32) {
    throw new Error('CHECKIN_POSTER_CONFIG_REQUIRED')
  }
  const stage = deploymentStage(env.MIP_DEPLOYMENT_STAGE)
  const appScope = createHmac('sha256', secret).update(appId).digest('hex').slice(0, 24)
  return `mip/${stage}/${appScope}/checkin-posters/${eventId}/${credentialId}.png`
}

function codeEnvironment(stage) {
  if (stage === 'production') return 'release'
  if (stage === 'staging') return 'trial'
  return 'develop'
}

function assertUploadedObject(fileId, objectKey) {
  if (typeof fileId !== 'string' || fileId.length > 1024 || !fileId.startsWith('cloud://')
    || fileId.includes('..') || fileId.includes('\\') || /\s/.test(fileId)) {
    throw new Error('CHECKIN_POSTER_UNAVAILABLE')
  }
  const tail = fileId.slice('cloud://'.length)
  const slash = tail.indexOf('/')
  if (slash <= 0 || tail.slice(slash + 1) !== objectKey) {
    throw new Error('CHECKIN_POSTER_UNAVAILABLE')
  }
  return true
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

async function createCheckInCodeAsset({
  appId,
  eventId,
  credentialId,
  ownerUserId,
  scene,
  cloud,
  database,
  env = process.env,
  createId = randomUUID,
}) {
  if (!/^s1\.[A-Za-z0-9_-]{11}\.[A-Za-z0-9_-]{11}$/.test(scene)
    || scene.length > 32
    || typeof cloud?.openapi?.wxacode?.getUnlimited !== 'function'
    || typeof cloud?.uploadFile !== 'function') {
    throw new Error('CHECKIN_POSTER_UNAVAILABLE')
  }
  const stage = deploymentStage(env.MIP_DEPLOYMENT_STAGE)
  const objectKey = buildCheckInCodeKey({ appId, eventId, credentialId, env })
  const response = await cloud.openapi.wxacode.getUnlimited({
    scene,
    page: 'packages/member/mip-events/detail/index',
    width: 430,
    checkPath: false,
    envVersion: codeEnvironment(stage),
  })
  const content = Buffer.isBuffer(response) ? response : response?.buffer
  if (!Buffer.isBuffer(content)
    || content.length < PNG_SIGNATURE.length
    || content.length > 2 * 1024 * 1024
    || !content.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error('CHECKIN_POSTER_UNAVAILABLE')
  }
  const uploaded = await cloud.uploadFile({ cloudPath: objectKey, fileContent: content })
  const codeUrl = typeof uploaded?.fileID === 'string' ? uploaded.fileID.trim() : ''
  assertUploadedObject(codeUrl, objectKey)
  const assetId = createId()
  let tombstoneRegistered = false
  const registerTombstone = async () => {
    const pending = await database.query(
      `INSERT INTO mip_media_assets (
        id, app_id, owner_user_id, purpose, object_key, cloud_file_id,
        content_sha256, content_type, content_bytes, width_px, height_px, status
      ) VALUES (?, ?, NULL, 'CHECKIN_POSTER', ?, ?, ?, 'image/png', ?, 430, 430, 'PENDING')`,
      [
        assetId,
        appId,
        objectKey,
        codeUrl,
        createHash('sha256').update(content).digest('hex'),
        content.length,
      ],
    )
    if (Number(pending?.affectedRows) !== 1) throw new Error('CHECKIN_POSTER_UNAVAILABLE')
    tombstoneRegistered = true
  }
  try {
    await registerTombstone()
    await database.transaction(async (tx) => {
      const owner = await tx.one(
        `SELECT id, status FROM mip_users
         WHERE app_id = ? AND id = ? FOR UPDATE`,
        [appId, ownerUserId],
      )
      if (!owner || owner.status !== 'ACTIVE') {
        throw new DomainError('FORBIDDEN', '当前账号不能生成签到海报')
      }
      const result = await tx.query(
        `UPDATE mip_media_assets
         SET owner_user_id = ?, status = 'READY'
         WHERE app_id = ? AND id = ? AND owner_user_id IS NULL
           AND purpose = 'CHECKIN_POSTER' AND status = 'PENDING'`,
        [ownerUserId, appId, assetId],
      )
      if (Number(result?.affectedRows) !== 1) {
        throw new Error('CHECKIN_POSTER_UNAVAILABLE')
      }
    })
  }
  catch (error) {
    let uploadState
    let stateKnown = false
    try {
      uploadState = await database.one(
        `SELECT owner_user_id, status FROM mip_media_assets
         WHERE app_id = ? AND id = ?`,
        [appId, assetId],
      )
      stateKnown = true
    }
    catch {}
    if (uploadState?.status === 'READY' && uploadState.owner_user_id === ownerUserId) {
      return { assetId, codeUrl, objectKey }
    }
    if (!stateKnown) throw error
    if (!uploadState) {
      try {
        await registerTombstone()
        uploadState = { owner_user_id: null, status: 'PENDING' }
      }
      catch {
        try {
          uploadState = await database.one(
            `SELECT owner_user_id, status FROM mip_media_assets
             WHERE app_id = ? AND id = ?`,
            [appId, assetId],
          )
        }
        catch {
          throw error
        }
      }
    }
    if (uploadState?.status === 'READY' && uploadState.owner_user_id === ownerUserId) {
      return { assetId, codeUrl, objectKey }
    }
    if (uploadState
      && (uploadState.status !== 'PENDING' || uploadState.owner_user_id != null)) {
      throw error
    }
    const deleted = await deleteUploadedObject(cloud, codeUrl, objectKey)
    if (deleted && (tombstoneRegistered
      || (uploadState?.status === 'PENDING' && uploadState.owner_user_id == null))) {
      await database.query(
        `UPDATE mip_media_assets SET status = 'DELETED'
         WHERE app_id = ? AND id = ? AND owner_user_id IS NULL
           AND purpose = 'CHECKIN_POSTER' AND status = 'PENDING'`,
        [appId, assetId],
      ).catch(() => undefined)
    }
    throw error
  }
  return { assetId, codeUrl, objectKey }
}

module.exports = {
  assertUploadedObject,
  buildCheckInCodeKey,
  codeEnvironment,
  createCheckInCodeAsset,
  deleteUploadedObject,
  deploymentStage,
}
