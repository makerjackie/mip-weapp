import { Buffer } from 'node:buffer'
import { createHash, createHmac } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const APP_ID_PATTERN = /^wx[0-9a-f]{16}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const STAGES = new Set(['development', 'test', 'staging', 'production'])
const VERIFIED_EXPORT_PACKAGES = new WeakMap()
const VERIFIED_COPY_PLANS = new WeakSet()

export const MIP_MEDIA_COPY_PLAN_FORMAT = 'mip-long-term-media-copy-plan-v1'
export const MIP_MEDIA_COPY_RESULT_FORMAT = 'mip-long-term-media-copy-result-v1'
export const MIP_MEDIA_COPY_CHECKPOINT_FORMAT = 'mip-long-term-media-copy-checkpoint-v1'

export const MIP_LONG_TERM_MEDIA_PURPOSES = Object.freeze({
  AVATAR: 'avatars',
  BANNER: 'banners',
  DIGITAL_AVATAR: 'digital-avatars',
  EVENT_ALBUM: 'event-album',
  EVENT_CONTENT: 'event-content',
  EVENT_COVER: 'event-covers',
  OPPORTUNITY_COVER: 'opportunity-covers',
  SUPER_CASE_COVER: 'case-covers',
  SUPER_CASE_MEDIA: 'case-media',
  TASK_ATTACHMENT: 'task-attachments',
  TASK_TEMPLATE: 'task-templates',
})

const EXCLUDED_PURPOSES = Object.freeze({
  AI_AUDIO: 'EPHEMERAL_AI_AUDIO',
  CHECKIN_POSTER: 'REISSUABLE_MINIPROGRAM_CODE',
  EVENT_INVITATION_CODE: 'REISSUABLE_MINIPROGRAM_CODE',
})

const TEMPORARY_DIRECTORIES = new Set([
  'checkin-posters',
  'event-invitations',
  'exports',
  'membership-invitations',
  'profile-cards',
])

const LEGACY_LONG_TERM_DIRECTORY_ALIASES = Object.freeze({
  TASK_TEMPLATE: new Set(['event-covers']),
})

export function loadVerifiedMipMediaExportPackage({
  exportDirectory,
  sourceAppId,
  sourceEnvironmentId,
}) {
  assertAppId(sourceAppId, 'MIP_MEDIA_COPY_SOURCE_APP_INVALID')
  if (typeof sourceEnvironmentId !== 'string' || sourceEnvironmentId.length < 3 || sourceEnvironmentId.length > 128) {
    throw new Error('MIP_MEDIA_COPY_SOURCE_ENVIRONMENT_INVALID')
  }
  const root = path.resolve(String(exportDirectory || ''))
  const manifestPath = path.join(root, 'manifest.json')
  const checksumPath = path.join(root, 'checksums.sha256')
  const dataPath = path.join(root, 'data', 'mip_media_assets.jsonl')
  const inventoryPath = path.join(root, 'inventory', 'media.json')

  const manifest = readPrivateJson(manifestPath)
  const checksums = parseChecksums(checksumPath, 'MIP_MEDIA_COPY_EXPORT_FILE_INVALID')
  assertCompleteExportPackage({ root, checksums })
  const rows = readPrivateJsonLines(dataPath)
  const inventory = readPrivateJson(inventoryPath)
  assertExportManifest({
    manifest,
    sourceAppId,
    sourceEnvironmentId,
    dataPath,
    inventoryPath,
    rows,
  })
  assertMediaInventory({ inventory, rows, sourceAppId })

  const result = deepFreeze({
    format: 'mip-verified-media-export-package-v1',
    rows,
    inventory,
  })
  VERIFIED_EXPORT_PACKAGES.set(result, sourceAppId)
  return result
}

export function buildMipLongTermMediaCopyPlan({
  sourcePackage,
  sourceAppId,
  targetAppId,
  sourceMediaScopeSecret,
  targetMediaScopeSecret,
  targetStage,
}) {
  if (!VERIFIED_EXPORT_PACKAGES.has(sourcePackage)) {
    throw new Error('MIP_MEDIA_COPY_EXPORT_NOT_VERIFIED')
  }
  assertAppId(sourceAppId, 'MIP_MEDIA_COPY_SOURCE_APP_INVALID')
  assertAppId(targetAppId, 'MIP_MEDIA_COPY_TARGET_APP_INVALID')
  if (sourceAppId === targetAppId) {
    throw new Error('MIP_MEDIA_COPY_APP_SCOPE_MUST_CHANGE')
  }
  if (VERIFIED_EXPORT_PACKAGES.get(sourcePackage) !== sourceAppId) {
    throw new Error('MIP_MEDIA_COPY_SOURCE_APP_INVALID')
  }
  const stage = normalizedStage(targetStage)
  const sourceSecret = normalizedScopeSecret(sourceMediaScopeSecret)
  const targetSecret = normalizedScopeSecret(targetMediaScopeSecret)
  const sourceAppScope = mediaObjectScope(sourceSecret, sourceAppId)
  const targetAppScope = mediaObjectScope(targetSecret, targetAppId)
  const copied = []
  const excluded = []

  for (const row of sourcePackage.rows) {
    const media = normalizeMediaRow(row)
    const sourceObject = assertSourceMipObject({ media, sourceAppScope })
    const exclusion = exclusionReason(media, sourceObject.directory)
    if (exclusion) {
      excluded.push({ mediaId: media.id, reason: exclusion })
      continue
    }

    assertLongTermSourceObject({
      media,
      sourceAppId,
      sourceObject,
      sourceSecret,
    })
    const extension = extensionForContentType(media.contentType)
    const directory = MIP_LONG_TERM_MEDIA_PURPOSES[media.purpose]
    const targetUserScope = mediaObjectScope(
      targetSecret,
      `${targetAppId}\0${media.ownerUserId}`,
    )
    const targetObjectKey = `mip/${stage}/${targetAppScope}/${directory}/${targetUserScope}/${media.id}.${extension}`
    assertObjectKey(targetObjectKey)
    copied.push({
      mediaId: media.id,
      sourceCloudFileId: media.cloudFileId,
      sourceObjectKey: media.objectKey,
      targetObjectKey,
      contentBytes: media.contentBytes,
      contentSha256: media.contentSha256,
      contentType: media.contentType,
    })
  }

  copied.sort(compareBy('targetObjectKey', 'mediaId'))
  excluded.sort(compareBy('reason', 'mediaId'))
  const plan = deepFreeze({
    format: MIP_MEDIA_COPY_PLAN_FORMAT,
    copied,
    excluded,
    copiedCount: copied.length,
    excludedCount: excluded.length,
    contentBytes: copied.reduce((total, item) => total + item.contentBytes, 0),
    planSha256: sha256(canonicalPlanRecords(copied, excluded)),
  })
  VERIFIED_COPY_PLANS.add(plan)
  return plan
}

export async function executeMipLongTermMediaCopy({
  plan,
  transport,
  onProgress,
  resumeUpdates = [],
  onCheckpoint,
}) {
  if (!VERIFIED_COPY_PLANS.has(plan)) {
    throw new Error('MIP_MEDIA_COPY_PLAN_NOT_VERIFIED')
  }
  assertTransport(transport)
  assertProgressCallback(onProgress)
  assertCheckpointCallback(onCheckpoint)
  const total = plan.copied.length
  const updates = []
  const resumeByMediaId = validateResumeUpdates(plan, resumeUpdates)

  progress(onProgress, { phase: 'STARTED', completed: 0, total })
  for (const item of plan.copied) {
    const resumed = resumeByMediaId.get(item.mediaId)
    if (resumed) {
      const targetResponse = await transportCall(
        () => transport.downloadTarget({ cloudFileId: resumed.cloudFileId }),
        'MIP_MEDIA_COPY_TARGET_DOWNLOAD_FAILED',
      )
      assertContent(targetResponse, item, 'MIP_MEDIA_COPY_TARGET_CONTENT_MISMATCH')
      updates.push(resumed)
      progress(onProgress, {
        phase: 'RESUMED',
        completed: updates.length,
        total,
      })
      continue
    }
    const sourceResponse = await transportCall(
      () => transport.downloadSource({
        cloudFileId: item.sourceCloudFileId,
        objectKey: item.sourceObjectKey,
      }),
      'MIP_MEDIA_COPY_SOURCE_DOWNLOAD_FAILED',
    )
    const sourceBytes = assertContent(
      sourceResponse,
      item,
      'MIP_MEDIA_COPY_SOURCE_CONTENT_MISMATCH',
    )

    const uploaded = await transportCall(
      () => transport.uploadTarget({
        objectKey: item.targetObjectKey,
        content: sourceBytes,
        contentType: item.contentType,
      }),
      'MIP_MEDIA_COPY_TARGET_UPLOAD_FAILED',
    )
    const targetCloudFileId = uploadedCloudFileId(uploaded)
    if (cloudObjectKey(targetCloudFileId) !== item.targetObjectKey) {
      throw new Error('MIP_MEDIA_COPY_TARGET_REFERENCE_INVALID')
    }

    const targetResponse = await transportCall(
      () => transport.downloadTarget({ cloudFileId: targetCloudFileId }),
      'MIP_MEDIA_COPY_TARGET_DOWNLOAD_FAILED',
    )
    const targetBytes = assertContent(
      targetResponse,
      item,
      'MIP_MEDIA_COPY_TARGET_CONTENT_MISMATCH',
    )
    if (!targetBytes.equals(sourceBytes)) {
      throw new Error('MIP_MEDIA_COPY_TARGET_CONTENT_MISMATCH')
    }

    const update = {
      mediaId: item.mediaId,
      objectKey: item.targetObjectKey,
      cloudFileId: targetCloudFileId,
    }
    updates.push(update)
    await checkpoint(onCheckpoint, update)
    progress(onProgress, {
      phase: 'COPIED',
      completed: updates.length,
      total,
    })
  }

  const byMediaId = Object.fromEntries(
    updates.map(update => [update.mediaId, {
      object_key: update.objectKey,
      cloud_file_id: update.cloudFileId,
    }]),
  )
  const result = deepFreeze({
    format: MIP_MEDIA_COPY_RESULT_FORMAT,
    copiedCount: updates.length,
    updates,
    byMediaId,
    recordsSha256: sha256(updates.map(update => JSON.stringify(update)).join('\n')),
  })
  progress(onProgress, { phase: 'COMPLETE', completed: total, total })
  return result
}

export function createMipMediaCopyCheckpoint({ plan, updates = [] }) {
  if (!VERIFIED_COPY_PLANS.has(plan)) {
    throw new Error('MIP_MEDIA_COPY_PLAN_NOT_VERIFIED')
  }
  const normalized = [...validateResumeUpdates(plan, updates).values()]
    .sort(compareBy('objectKey', 'mediaId'))
  return deepFreeze({
    format: MIP_MEDIA_COPY_CHECKPOINT_FORMAT,
    planSha256: plan.planSha256,
    updates: normalized,
    completedCount: normalized.length,
    recordsSha256: sha256(normalized.map(update => JSON.stringify(update)).join('\n')),
  })
}

export function applyMipMediaCopyResultToTransformedPackage({
  packageDirectory,
  sourceAppId,
  targetAppId,
  plan,
  result,
}) {
  if (!VERIFIED_COPY_PLANS.has(plan)) {
    throw new Error('MIP_MEDIA_COPY_PLAN_NOT_VERIFIED')
  }
  assertAppId(sourceAppId, 'MIP_MEDIA_COPY_SOURCE_APP_INVALID')
  assertAppId(targetAppId, 'MIP_MEDIA_COPY_TARGET_APP_INVALID')
  if (!result || result.format !== MIP_MEDIA_COPY_RESULT_FORMAT
    || result.copiedCount !== plan.copiedCount
    || result.recordsSha256 !== sha256(result.updates.map(update => JSON.stringify(update)).join('\n'))) {
    throw new Error('MIP_MEDIA_COPY_RESULT_INVALID')
  }
  const updates = validateResumeUpdates(plan, result.updates)
  if (updates.size !== plan.copiedCount) {
    throw new Error('MIP_MEDIA_COPY_RESULT_INVALID')
  }

  const root = path.resolve(String(packageDirectory || ''))
  const manifestPath = path.join(root, 'manifest.json')
  const checksumPath = path.join(root, 'checksums.sha256')
  const dataPath = path.join(root, 'data', 'mip_media_assets.jsonl')
  const manifest = readPrivateJson(manifestPath)
  const checksums = parseChecksums(checksumPath)
  const table = Array.isArray(manifest?.tables)
    ? manifest.tables.find(item => item?.table === 'mip_media_assets')
    : null
  if (manifest?.format !== 'mip-app-scope-transform-v1'
    || manifest?.migrationReadiness !== 'transformed-verified'
    || manifest?.sourceAppScopeFingerprint !== sha256(sourceAppId).slice(0, 16)
    || manifest?.targetAppScopeFingerprint !== sha256(targetAppId).slice(0, 16)
    || table?.relativeFile !== 'data/mip_media_assets.jsonl'
    || checksums.get(table.relativeFile) !== table.sha256
    || sha256File(dataPath) !== table.sha256) {
    throw new Error('MIP_MEDIA_COPY_TRANSFORM_PACKAGE_INVALID')
  }
  const rows = readPrivateJsonLines(dataPath)
  if (rows.length !== table.rowsExported) {
    throw new Error('MIP_MEDIA_COPY_TRANSFORM_PACKAGE_INVALID')
  }
  const rowIds = new Set()
  const updatedRows = rows.map((row) => {
    const media = normalizeMediaRow(row)
    if (row.app_id !== targetAppId || rowIds.has(media.id)) {
      throw new Error('MIP_MEDIA_COPY_TRANSFORM_PACKAGE_INVALID')
    }
    rowIds.add(media.id)
    const update = updates.get(media.id)
    return update
      ? { ...row, object_key: update.objectKey, cloud_file_id: update.cloudFileId }
      : row
  })
  if ([...updates.keys()].some(mediaId => !rowIds.has(mediaId))) {
    throw new Error('MIP_MEDIA_COPY_RESULT_INVALID')
  }

  const dataContent = updatedRows.map(row => JSON.stringify(row)).join('\n')
  replacePrivateFile(dataPath, dataContent ? `${dataContent}\n` : '')
  const dataSha256 = sha256File(dataPath)
  const dataBytes = fs.statSync(dataPath).size
  checksums.set(table.relativeFile, dataSha256)
  replacePrivateFile(checksumPath, `${[...checksums.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([relativeFile, digest]) => `${digest}  ${relativeFile}`)
    .join('\n')}\n`)
  const updatedManifest = {
    ...manifest,
    tables: manifest.tables.map(item => item.table === table.table
      ? { ...item, bytes: dataBytes, sha256: dataSha256 }
      : item),
    mediaCopy: {
      format: MIP_MEDIA_COPY_RESULT_FORMAT,
      targetStage: 'staging',
      copiedCount: result.copiedCount,
      excludedCount: plan.excludedCount,
      contentBytes: plan.contentBytes,
      planSha256: plan.planSha256,
      recordsSha256: result.recordsSha256,
      validation: 'source-upload-readback-verified',
    },
  }
  replacePrivateFile(manifestPath, `${JSON.stringify(updatedManifest, null, 2)}\n`)
  if (sha256File(dataPath) !== dataSha256
    || parseChecksums(checksumPath).get(table.relativeFile) !== dataSha256
    || readPrivateJson(manifestPath)?.mediaCopy?.recordsSha256 !== result.recordsSha256) {
    throw new Error('MIP_MEDIA_COPY_PACKAGE_UPDATE_FAILED')
  }
  return Object.freeze({
    copiedCount: result.copiedCount,
    excludedCount: plan.excludedCount,
    contentBytes: plan.contentBytes,
  })
}

export function mediaObjectScope(secret, value) {
  const normalized = normalizedScopeSecret(secret)
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('MIP_MEDIA_COPY_SCOPE_INPUT_INVALID')
  }
  return createHmac('sha256', normalized).update(value).digest('hex').slice(0, 24)
}

function assertExportManifest({
  manifest,
  sourceAppId,
  sourceEnvironmentId,
  dataPath,
  inventoryPath,
  rows,
}) {
  const mediaTable = Array.isArray(manifest?.tables)
    ? manifest.tables.find(item => item?.table === 'mip_media_assets')
    : null
  if (manifest?.format !== 'mip-app-scope-export-v1'
    || manifest?.consistency !== 'row-count-verified'
    || manifest?.sourceWritesFrozen !== true
    || manifest?.primaryKeyInventoryVerified !== true
    || manifest?.migrationReadiness !== 'export-verified'
    || manifest?.sourceAppScopeFingerprint !== sha256(sourceAppId).slice(0, 16)
    || manifest?.sourceEnvironmentFingerprint !== sha256(sourceEnvironmentId).slice(0, 16)
    || mediaTable?.relativeFile !== 'data/mip_media_assets.jsonl'
    || mediaTable?.scope !== 'source-app'
    || mediaTable?.rowCountStable !== true
    || mediaTable?.primaryKeyInventoryStable !== true
    || mediaTable?.rowsExported !== rows.length
    || mediaTable?.sha256 !== sha256File(dataPath)
    || manifest?.mediaInventory?.relativeFile !== 'inventory/media.json'
    || manifest?.mediaInventory?.sha256 !== sha256File(inventoryPath)) {
    throw new Error('MIP_MEDIA_COPY_EXPORT_INVALID')
  }
}

function assertCompleteExportPackage({ root, checksums }) {
  const standardFiles = new Set(['README.txt', 'checksums.sha256', 'manifest.json'])
  const actualFiles = listPackageFiles(root)
  const expectedFiles = new Set([...checksums.keys(), ...standardFiles])
  if (actualFiles.size !== expectedFiles.size
    || [...actualFiles].some(file => !expectedFiles.has(file))) {
    throw new Error('MIP_MEDIA_COPY_EXPORT_FILE_INVALID')
  }
  for (const [relativeFile, digest] of checksums) {
    if (!isSafeRelativePackagePath(relativeFile)
      || sha256File(path.join(root, ...relativeFile.split('/'))) !== digest) {
      throw new Error('MIP_MEDIA_COPY_EXPORT_FILE_INVALID')
    }
  }
  for (const required of ['data/mip_media_assets.jsonl', 'inventory/media.json']) {
    if (!checksums.has(required)) {
      throw new Error('MIP_MEDIA_COPY_EXPORT_FILE_INVALID')
    }
  }
}

function assertMediaInventory({ inventory, rows, sourceAppId }) {
  if (inventory?.format !== 'mip-media-inventory-v1'
    || inventory?.sourceTable !== 'mip_media_assets'
    || !Array.isArray(inventory?.rows)
    || inventory.objectCount !== inventory.rows.length
    || inventory.objectCount !== rows.length
    || inventory.readyObjectCount !== inventory.rows.filter(row => row?.status === 'READY').length
    || inventory.contentBytes !== inventory.rows.reduce((total, row) => total + Number(row?.contentBytes), 0)
    || inventory.recordsSha256 !== sha256(canonicalInventoryRows(inventory.rows))) {
    throw new Error('MIP_MEDIA_COPY_INVENTORY_INVALID')
  }

  const rowsById = new Map()
  for (const row of rows) {
    const media = normalizeMediaRow(row)
    if (row.app_id !== sourceAppId || rowsById.has(media.id)) {
      throw new Error('MIP_MEDIA_COPY_DATA_SCOPE_INVALID')
    }
    rowsById.set(media.id, media)
  }

  const inventoryIds = new Set()
  const objectKeys = new Set()
  const cloudFileIds = new Set()
  for (const entry of inventory.rows) {
    const normalized = normalizeInventoryEntry(entry)
    const row = rowsById.get(normalized.id)
    if (!row || inventoryIds.has(normalized.id)
      || objectKeys.has(normalized.objectKey)
      || cloudFileIds.has(normalized.cloudFileId)
      || !sameMediaRecord(row, normalized)) {
      throw new Error('MIP_MEDIA_COPY_INVENTORY_MISMATCH')
    }
    inventoryIds.add(normalized.id)
    objectKeys.add(normalized.objectKey)
    cloudFileIds.add(normalized.cloudFileId)
  }
}

function normalizeMediaRow(row) {
  const media = {
    id: String(row?.id || ''),
    ownerUserId: row?.owner_user_id === null ? null : String(row?.owner_user_id || ''),
    purpose: String(row?.purpose || ''),
    objectKey: String(row?.object_key || ''),
    cloudFileId: String(row?.cloud_file_id || ''),
    contentSha256: String(row?.content_sha256 || '').toLowerCase(),
    contentType: String(row?.content_type || '').toLowerCase(),
    contentBytes: Number(row?.content_bytes),
    status: String(row?.status || ''),
  }
  assertMediaRecordShape(media)
  return media
}

function normalizeInventoryEntry(row) {
  const media = {
    id: String(row?.id || ''),
    ownerUserId: row?.ownerUserId === null ? null : String(row?.ownerUserId || ''),
    purpose: String(row?.purpose || ''),
    objectKey: String(row?.objectKey || ''),
    cloudFileId: String(row?.cloudFileId || ''),
    contentSha256: String(row?.contentSha256 || '').toLowerCase(),
    contentType: String(row?.contentType || '').toLowerCase(),
    contentBytes: Number(row?.contentBytes),
    status: String(row?.status || ''),
  }
  assertMediaRecordShape(media)
  return media
}

function assertMediaRecordShape(media) {
  if (!UUID_PATTERN.test(media.id)
    || (media.ownerUserId !== null && !UUID_PATTERN.test(media.ownerUserId))
    || !/^[A-Z][A-Z0-9_]{1,31}$/.test(media.purpose)
    || !SHA256_PATTERN.test(media.contentSha256)
    || !/^[a-z]+\/[a-z0-9.+-]+$/.test(media.contentType)
    || !Number.isSafeInteger(media.contentBytes)
    || media.contentBytes < 1
    || media.contentBytes > 32 * 1024 * 1024
    || !['PENDING', 'READY', 'REJECTED', 'DELETED'].includes(media.status)
    || cloudObjectKey(media.cloudFileId) !== media.objectKey) {
    throw new Error('MIP_MEDIA_COPY_MEDIA_RECORD_INVALID')
  }
  assertObjectKey(media.objectKey)
}

function sameMediaRecord(left, right) {
  return left.id === right.id
    && left.ownerUserId === right.ownerUserId
    && left.purpose === right.purpose
    && left.objectKey === right.objectKey
    && left.cloudFileId === right.cloudFileId
    && left.contentSha256 === right.contentSha256
    && left.contentType === right.contentType
    && left.contentBytes === right.contentBytes
    && left.status === right.status
}

function assertSourceMipObject({ media, sourceAppScope }) {
  const match = /^mip\/(development|test|staging|production)\/([0-9a-f]{24})\/([a-z0-9-]+)(?:\/|$)/.exec(media.objectKey)
  if (!match || match[2] !== sourceAppScope) {
    throw new Error('MIP_MEDIA_COPY_SOURCE_SCOPE_INVALID')
  }
  return { stage: match[1], appScope: match[2], directory: match[3] }
}

function exclusionReason(media, directory) {
  if (media.status !== 'READY') {
    return 'NOT_READY'
  }
  if (TEMPORARY_DIRECTORIES.has(directory)) {
    return 'TEMPORARY_OR_REISSUABLE_OBJECT'
  }
  if (EXCLUDED_PURPOSES[media.purpose]) {
    return EXCLUDED_PURPOSES[media.purpose]
  }
  if (!MIP_LONG_TERM_MEDIA_PURPOSES[media.purpose]) {
    return 'UNSUPPORTED_MEDIA_PURPOSE'
  }
  return null
}

function assertLongTermSourceObject({ media, sourceAppId, sourceObject, sourceSecret }) {
  if (!media.ownerUserId) {
    throw new Error('MIP_MEDIA_COPY_LONG_TERM_OWNER_REQUIRED')
  }
  const extension = extensionForContentType(media.contentType)
  const expectedDirectory = MIP_LONG_TERM_MEDIA_PURPOSES[media.purpose]
  const expectedUserScope = mediaObjectScope(
    sourceSecret,
    `${sourceAppId}\0${media.ownerUserId}`,
  )
  const expected = `mip/${sourceObject.stage}/${sourceObject.appScope}/${expectedDirectory}/${expectedUserScope}/${media.id}.${extension}`
  const legacyDirectories = LEGACY_LONG_TERM_DIRECTORY_ALIASES[media.purpose]
  const legacyExpected = legacyDirectories?.has(sourceObject.directory)
    ? `mip/${sourceObject.stage}/${sourceObject.appScope}/${sourceObject.directory}/${expectedUserScope}/${media.id}.${extension}`
    : ''
  if (media.objectKey !== expected && media.objectKey !== legacyExpected) {
    throw new Error('MIP_MEDIA_COPY_SOURCE_SCOPE_INVALID')
  }
}

function extensionForContentType(value) {
  if (value === 'image/jpeg') {
    return 'jpg'
  }
  if (value === 'image/png') {
    return 'png'
  }
  throw new Error('MIP_MEDIA_COPY_LONG_TERM_CONTENT_TYPE_INVALID')
}

function assertObjectKey(value) {
  if (typeof value !== 'string'
    || value.length > 512
    || !/^mip\/(?:development|test|staging|production)\/[0-9a-f]{24}\/[a-z0-9-]+(?:\/[a-z0-9._-]+)+$/.test(value)
    || value.includes('..')
    || value.includes('\\')
    || /\s/.test(value)) {
    throw new Error('MIP_MEDIA_COPY_OBJECT_KEY_INVALID')
  }
}

function cloudObjectKey(value) {
  if (typeof value !== 'string' || value.length > 1024 || !value.startsWith('cloud://')
    || value.includes('..') || value.includes('\\') || /\s/.test(value)) {
    throw new Error('MIP_MEDIA_COPY_CLOUD_FILE_INVALID')
  }
  const tail = value.slice('cloud://'.length)
  const slash = tail.indexOf('/')
  const authority = tail.slice(0, slash)
  if (slash <= 0 || slash === tail.length - 1
    || !/^[a-z0-9][\w.-]{0,127}$/i.test(authority)) {
    throw new Error('MIP_MEDIA_COPY_CLOUD_FILE_INVALID')
  }
  return tail.slice(slash + 1)
}

function uploadedCloudFileId(value) {
  const result = typeof value === 'string'
    ? value
    : value?.fileID ?? value?.fileId ?? value?.file_id
  if (typeof result !== 'string') {
    throw new TypeError('MIP_MEDIA_COPY_TARGET_REFERENCE_INVALID')
  }
  cloudObjectKey(result)
  return result
}

function assertContent(value, item, errorCode) {
  const content = binaryBuffer(value)
  if (!content
    || content.length !== item.contentBytes
    || sha256(content) !== item.contentSha256) {
    throw new Error(errorCode)
  }
  return content
}

function binaryBuffer(value) {
  if (Buffer.isBuffer(value)) {
    return value
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  }
  if (value?.content !== undefined) {
    return binaryBuffer(value.content)
  }
  if (value?.body !== undefined) {
    return binaryBuffer(value.body)
  }
  if (value?.fileContent !== undefined) {
    return binaryBuffer(value.fileContent)
  }
  return null
}

function assertTransport(transport) {
  if (!transport
    || typeof transport.downloadSource !== 'function'
    || typeof transport.uploadTarget !== 'function'
    || typeof transport.downloadTarget !== 'function') {
    throw new Error('MIP_MEDIA_COPY_TRANSPORT_INVALID')
  }
}

function assertProgressCallback(callback) {
  if (callback !== undefined && typeof callback !== 'function') {
    throw new Error('MIP_MEDIA_COPY_PROGRESS_CALLBACK_INVALID')
  }
}

function assertCheckpointCallback(callback) {
  if (callback !== undefined && typeof callback !== 'function') {
    throw new Error('MIP_MEDIA_COPY_CHECKPOINT_CALLBACK_INVALID')
  }
}

function validateResumeUpdates(plan, value) {
  if (!Array.isArray(value)) {
    throw new TypeError('MIP_MEDIA_COPY_CHECKPOINT_INVALID')
  }
  const items = new Map(plan.copied.map(item => [item.mediaId, item]))
  const updates = new Map()
  for (const raw of value) {
    const update = {
      mediaId: String(raw?.mediaId || ''),
      objectKey: String(raw?.objectKey || ''),
      cloudFileId: String(raw?.cloudFileId || ''),
    }
    const item = items.get(update.mediaId)
    if (!item || updates.has(update.mediaId)
      || update.objectKey !== item.targetObjectKey
      || cloudObjectKey(update.cloudFileId) !== item.targetObjectKey) {
      throw new Error('MIP_MEDIA_COPY_CHECKPOINT_INVALID')
    }
    updates.set(update.mediaId, Object.freeze(update))
  }
  return updates
}

async function checkpoint(callback, update) {
  if (!callback) {
    return
  }
  try {
    await callback(Object.freeze({ ...update }))
  }
  catch {
    throw new Error('MIP_MEDIA_COPY_CHECKPOINT_WRITE_FAILED')
  }
}

async function transportCall(action, errorCode) {
  try {
    return await action()
  }
  catch {
    throw new Error(errorCode)
  }
}

function progress(callback, value) {
  if (!callback) {
    return
  }
  try {
    callback(Object.freeze(value))
  }
  catch {
    throw new Error('MIP_MEDIA_COPY_PROGRESS_FAILED')
  }
}

function readPrivateJson(filePath) {
  try {
    assertRegularPrivateFile(filePath)
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  }
  catch {
    throw new Error('MIP_MEDIA_COPY_EXPORT_FILE_INVALID')
  }
}

function readPrivateJsonLines(filePath) {
  try {
    assertRegularPrivateFile(filePath)
    const source = fs.readFileSync(filePath, 'utf8')
    if (source && !source.endsWith('\n')) {
      throw new Error('unterminated')
    }
    return source.trimEnd() === ''
      ? []
      : source.trimEnd().split('\n').map(line => JSON.parse(line))
  }
  catch {
    throw new Error('MIP_MEDIA_COPY_EXPORT_FILE_INVALID')
  }
}

function parseChecksums(filePath, errorCode = 'MIP_MEDIA_COPY_TRANSFORM_PACKAGE_INVALID') {
  try {
    assertRegularPrivateFile(filePath)
    const content = fs.readFileSync(filePath, 'utf8')
    if (!content.endsWith('\n')) {
      throw new Error('invalid')
    }
    const result = new Map()
    for (const line of content.slice(0, -1).split('\n')) {
      const match = /^([0-9a-f]{64}) {2}(\S+)$/.exec(line)
      if (!match || result.has(match[2])) {
        throw new Error('invalid')
      }
      result.set(match[2], match[1])
    }
    return result
  }
  catch {
    throw new Error(errorCode)
  }
}

function listPackageFiles(root) {
  const result = new Set()
  function visit(directory) {
    const stat = fs.lstatSync(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
      throw new Error('MIP_MEDIA_COPY_EXPORT_FILE_INVALID')
    }
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        throw new Error('MIP_MEDIA_COPY_EXPORT_FILE_INVALID')
      }
      if (entry.isDirectory()) {
        visit(absolute)
        continue
      }
      if (!entry.isFile()) {
        throw new Error('MIP_MEDIA_COPY_EXPORT_FILE_INVALID')
      }
      assertRegularPrivateFile(absolute)
      result.add(path.relative(root, absolute).split(path.sep).join('/'))
    }
  }
  visit(root)
  return result
}

function isSafeRelativePackagePath(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 512
    && !path.posix.isAbsolute(value)
    && !value.split('/').some(part => !part || part === '.' || part === '..')
    && /^[\w./-]+$/.test(value)
}

function replacePrivateFile(filePath, content) {
  const temporary = `${filePath}.media-copy.tmp`
  fs.writeFileSync(temporary, content, { mode: 0o600 })
  fs.chmodSync(temporary, 0o600)
  fs.renameSync(temporary, filePath)
  fs.chmodSync(filePath, 0o600)
}

function assertRegularPrivateFile(filePath) {
  const stat = fs.lstatSync(filePath)
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error('invalid private file')
  }
}

function normalizedScopeSecret(value) {
  if (typeof value !== 'string' || value.length < 32 || value.length > 4096) {
    throw new Error('MIP_MEDIA_COPY_SCOPE_SECRET_INVALID')
  }
  return value
}

function normalizedStage(value) {
  const stage = String(value || '').trim().toLowerCase()
  if (!STAGES.has(stage)) {
    throw new Error('MIP_MEDIA_COPY_TARGET_STAGE_INVALID')
  }
  return stage
}

function assertAppId(value, errorCode) {
  if (typeof value !== 'string' || !APP_ID_PATTERN.test(value)) {
    throw new Error(errorCode)
  }
}

function canonicalInventoryRows(rows) {
  return rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '')
}

function canonicalPlanRecords(copied, excluded) {
  return JSON.stringify({ copied, excluded })
}

function compareBy(...keys) {
  return (left, right) => {
    for (const key of keys) {
      const compared = String(left[key] ?? '').localeCompare(String(right[key] ?? ''))
      if (compared !== 0) {
        return compared
      }
    }
    return 0
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function sha256File(filePath) {
  try {
    assertRegularPrivateFile(filePath)
    return sha256(fs.readFileSync(filePath))
  }
  catch {
    throw new Error('MIP_MEDIA_COPY_EXPORT_FILE_INVALID')
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value
  }
  for (const child of Object.values(value)) {
    deepFreeze(child)
  }
  return Object.freeze(value)
}
