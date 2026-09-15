'use strict'

const { createHash, createHmac, randomUUID } = require('node:crypto')
const { DomainError } = require('../domain/rules')
const { createWechatCodeProvider } = require('./wechat-code-provider')

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff])
const DIAGNOSTIC_CODE_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const EVENT_CODE_SPECS = Object.freeze({
  CHECKIN_POSTER: {
    directory: 'checkin-posters',
    scenePattern: /^s1\.[A-Za-z0-9_-]{11}\.[A-Za-z0-9_-]{11}$/,
    forbiddenMessage: '当前账号不能生成签到海报',
  },
  EVENT_INVITATION_CODE: {
    directory: 'event-invitations',
    scenePattern: /^i1\.[A-Za-z0-9_-]{11}\.[A-Za-z0-9_-]{11}$/,
    forbiddenMessage: '当前账号不能生成活动分享码',
  },
})
let recentWechatProvider
let recentWechatProviderKey = ''

function deploymentStage(value) {
  const stage = String(value || '').trim().toLowerCase()
  if (!['development', 'test', 'staging', 'production'].includes(stage)) {
    throw new Error('CHECKIN_POSTER_CONFIG_REQUIRED')
  }
  return stage
}

function buildEventCodeKey({ appId, eventId, referenceId, purpose, extension = 'png', env = process.env }) {
  const spec = EVENT_CODE_SPECS[purpose]
  const secret = String(env.MIP_MEDIA_SCOPE_SECRET || '')
  if (typeof appId !== 'string'
    || !appId
    || !spec
    || !ID_PATTERN.test(eventId)
    || !ID_PATTERN.test(referenceId)
    || secret.length < 32) {
    throw new Error('CHECKIN_POSTER_CONFIG_REQUIRED')
  }
  const stage = deploymentStage(env.MIP_DEPLOYMENT_STAGE)
  const appScope = createHmac('sha256', secret).update(appId).digest('hex').slice(0, 24)
  if (!['png', 'jpg'].includes(extension)) throw new Error('CHECKIN_POSTER_CONFIG_REQUIRED')
  return `mip/${stage}/${appScope}/${spec.directory}/${eventId}/${referenceId}.${extension}`
}

function buildCheckInCodeKey({ appId, eventId, credentialId, env = process.env }) {
  return buildEventCodeKey({
    appId,
    eventId,
    referenceId: credentialId,
    purpose: 'CHECKIN_POSTER',
    env,
  })
}

function buildInvitationCodeKey({ appId, eventId, invitationId, env = process.env }) {
  return buildEventCodeKey({
    appId,
    eventId,
    referenceId: invitationId,
    purpose: 'EVENT_INVITATION_CODE',
    env,
  })
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

function binaryBuffer(value) {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof ArrayBuffer) return Buffer.from(value)
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  return null
}

function imageContent(content) {
  if (content.length >= PNG_SIGNATURE.length && content.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return { contentType: 'image/png', extension: 'png' }
  }
  if (content.length >= JPEG_SIGNATURE.length && content.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)) {
    return { contentType: 'image/jpeg', extension: 'jpg' }
  }
  return null
}

function diagnosticCode(error) {
  const value = error?.errCode ?? error?.errcode ?? error?.code ?? error?.errorCode
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return typeof value === 'string' && DIAGNOSTIC_CODE_PATTERN.test(value) ? value : 'UNKNOWN'
}

function posterDiagnostic(error, stage, code) {
  const wrapped = error instanceof Error ? error : new Error('CHECKIN_POSTER_UNAVAILABLE')
  wrapped.posterDiagnostic = { stage, code: code || diagnosticCode(error) }
  return wrapped
}

function responseErrorCode(response, content) {
  const direct = response && typeof response === 'object' && !Buffer.isBuffer(response) ? response : null
  const hasDirectCode = direct && (direct.errCode !== undefined || direct.errcode !== undefined || direct.errorCode !== undefined)
  const candidate = hasDirectCode
    ? direct
    : content && content.length <= 4096
      ? (() => { try { return JSON.parse(content.toString('utf8')) } catch { return null } })()
      : null
  const value = candidate?.errCode ?? candidate?.errcode ?? candidate?.errorCode
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
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

async function createEventCodeAsset({
  appId,
  eventId,
  referenceId,
  ownerUserId,
  scene,
  purpose,
  cloud,
  database,
  env = process.env,
  createId = randomUUID,
}) {
  const spec = EVENT_CODE_SPECS[purpose]
  const configuredAppId = String(env.MIP_WECHAT_APP_ID || '').trim()
  const configuredSecret = String(env.MIP_WECHAT_APP_SECRET || '')
  if (Boolean(configuredAppId) !== Boolean(configuredSecret)) {
    throw posterDiagnostic(new Error('CHECKIN_POSTER_CONFIG_REQUIRED'), 'wxacode.config')
  }
  if (!spec
    || !spec.scenePattern.test(scene)
    || scene.length > 32
    || (!configuredSecret && typeof cloud?.openapi?.wxacode?.getUnlimited !== 'function')
    || typeof cloud?.uploadFile !== 'function') {
    throw new Error('CHECKIN_POSTER_UNAVAILABLE')
  }
  const stage = deploymentStage(env.MIP_DEPLOYMENT_STAGE)
  // Validate the scope and configuration before making an external API call.
  buildEventCodeKey({ appId, eventId, referenceId, purpose, env })
  if (configuredSecret && configuredAppId !== appId) {
    throw posterDiagnostic(new Error('CHECKIN_POSTER_CONFIG_REQUIRED'), 'wxacode.config')
  }
  let codeProvider = cloud?.openapi?.wxacode
  if (configuredSecret) {
    const providerKey = `${configuredAppId}\0${configuredSecret}`
    if (providerKey !== recentWechatProviderKey) {
      recentWechatProvider = createWechatCodeProvider({ appId, appSecret: configuredSecret, expectedAppId: configuredAppId })
      recentWechatProviderKey = providerKey
    }
    codeProvider = recentWechatProvider
  }
  let response
  try {
    response = await codeProvider.getUnlimited({
      scene,
      page: 'packages/member/mip-events/detail/index',
      width: 430,
      checkPath: false,
      envVersion: codeEnvironment(stage),
    })
  }
  catch (error) {
    throw posterDiagnostic(error, 'wxacode.getUnlimited')
  }
  const content = binaryBuffer(response) || binaryBuffer(response?.buffer)
  const format = content && content.length <= 2 * 1024 * 1024 ? imageContent(content) : null
  if (!content || !format || content.length < 3) {
    throw posterDiagnostic(new Error('CHECKIN_POSTER_UNAVAILABLE'), 'wxacode.response', responseErrorCode(response, content))
  }
  const objectKey = buildEventCodeKey({ appId, eventId, referenceId, purpose, extension: format.extension, env })
  let uploaded
  try {
    uploaded = await cloud.uploadFile({ cloudPath: objectKey, fileContent: content })
  }
  catch (error) {
    throw posterDiagnostic(error, 'storage.uploadFile')
  }
  const codeUrl = typeof uploaded?.fileID === 'string' ? uploaded.fileID.trim() : ''
  try {
    assertUploadedObject(codeUrl, objectKey)
  }
  catch (error) {
    throw posterDiagnostic(error, 'storage.uploadFile.response')
  }
  const assetId = createId()
  let tombstoneRegistered = false
  const registerTombstone = async () => {
    let pending
    try {
      pending = await database.query(
      `INSERT INTO mip_media_assets (
        id, app_id, owner_user_id, purpose, object_key, cloud_file_id,
        content_sha256, content_type, content_bytes, width_px, height_px, status
      ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, 430, 430, 'PENDING')`,
      [
        assetId,
        appId,
        purpose,
        objectKey,
        codeUrl,
        createHash('sha256').update(content).digest('hex'),
        format.contentType,
        content.length,
      ],
      )
    }
    catch (error) {
      throw posterDiagnostic(error, 'media_assets.insert')
    }
    if (Number(pending?.affectedRows) !== 1) throw posterDiagnostic(new Error('CHECKIN_POSTER_UNAVAILABLE'), 'media_assets.insert')
    tombstoneRegistered = true
  }
  try {
    await registerTombstone()
    try {
      await database.transaction(async (tx) => {
      const owner = await tx.one(
        `SELECT id, status FROM mip_users
         WHERE app_id = ? AND id = ? FOR UPDATE`,
        [appId, ownerUserId],
      )
      if (!owner || owner.status !== 'ACTIVE') {
        throw new DomainError('FORBIDDEN', spec.forbiddenMessage)
      }
      const result = await tx.query(
        `UPDATE mip_media_assets
         SET owner_user_id = ?, status = 'READY'
         WHERE app_id = ? AND id = ? AND owner_user_id IS NULL
           AND purpose = ? AND status = 'PENDING'`,
        [ownerUserId, appId, assetId, purpose],
      )
      if (Number(result?.affectedRows) !== 1) {
        throw posterDiagnostic(new Error('CHECKIN_POSTER_UNAVAILABLE'), 'media_assets.bind')
      }
      })
    }
    catch (error) {
      if (error instanceof DomainError) throw error
      throw posterDiagnostic(error, 'media_assets.bind')
    }
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
           AND purpose = ? AND status = 'PENDING'`,
        [appId, assetId, purpose],
      ).catch(() => undefined)
    }
    throw error
  }
  return { assetId, codeUrl, objectKey }
}

function createCheckInCodeAsset(input) {
  return createEventCodeAsset({
    ...input,
    referenceId: input.credentialId,
    purpose: 'CHECKIN_POSTER',
  })
}

function createInvitationCodeAsset(input) {
  return createEventCodeAsset({
    ...input,
    referenceId: input.invitationId,
    purpose: 'EVENT_INVITATION_CODE',
  })
}

module.exports = {
  assertUploadedObject,
  buildCheckInCodeKey,
  buildEventCodeKey,
  buildInvitationCodeKey,
  codeEnvironment,
  createCheckInCodeAsset,
  createEventCodeAsset,
  createInvitationCodeAsset,
  deleteUploadedObject,
  deploymentStage,
}
