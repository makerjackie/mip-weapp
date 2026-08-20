'use strict'

/**
 * Injectable short-lived export object store.
 * Production uses private CloudBase storage; tests inject memory.
 * Env mode "memory" is never a production option.
 *
 * Contract:
 * - put() returns both app-scoped objectKey and full cloud:// fileID from the SDK.
 * - DB must persist the SDK fileID for download/delete; objectKey is for path guard/audit.
 * - bare cloudPath keys are rejected as fileIDs.
 */

const DEFAULT_TTL_MS = 15 * 60 * 1000
const PRIVATE_PREFIX = 'membership-exports'
const MEMORY_FILE_ID_PREFIX = 'cloud://memory-export'

function assertSafeKey(key) {
  if (typeof key !== 'string' || !key || key.includes('..') || key.startsWith('/') || key.includes('\\')) {
    throw new Error('INVALID_EXPORT_KEY')
  }
}

function sanitizeAppId(appId) {
  return String(appId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)
}

function appScopedObjectKey(appId, key) {
  const appScope = sanitizeAppId(appId)
  if (!appScope) {
    throw new Error('INVALID_EXPORT_KEY')
  }
  assertSafeKey(key)
  return `${PRIVATE_PREFIX}/${appScope}/${key}`
}

/**
 * Full CloudBase file identifiers always start with cloud://.
 * Bare object keys / cloudPath strings are never accepted as fileIDs.
 */
function parseCloudFileId(fileId) {
  if (typeof fileId !== 'string' || !fileId) {
    throw new Error('INVALID_EXPORT_FILE_ID')
  }
  if (!fileId.startsWith('cloud://')) {
    throw new Error('INVALID_EXPORT_FILE_ID')
  }
  if (fileId.includes('..') || fileId.includes('\\') || /\s/.test(fileId)) {
    throw new Error('INVALID_EXPORT_FILE_ID')
  }
  // cloud://envId.bucket/path... or cloud://envId/path...
  const withoutScheme = fileId.slice('cloud://'.length)
  const slash = withoutScheme.indexOf('/')
  if (slash <= 0 || slash === withoutScheme.length - 1) {
    throw new Error('INVALID_EXPORT_FILE_ID')
  }
  const objectPath = withoutScheme.slice(slash + 1)
  if (!objectPath || objectPath.startsWith('/') || objectPath.includes('//')) {
    throw new Error('INVALID_EXPORT_FILE_ID')
  }
  return {
    fileId,
    objectPath,
  }
}

/**
 * Exact app segment guard: membership-exports/<appId>/…
 * Prefix-only checks on membership-exports are insufficient and rejected.
 */
function assertAppScopedPath(objectPath, appId) {
  const appScope = sanitizeAppId(appId)
  if (!appScope) {
    throw new Error('EXPORT_NOT_FOUND')
  }
  const expectedPrefix = `${PRIVATE_PREFIX}/${appScope}/`
  if (!objectPath.startsWith(expectedPrefix)) {
    throw new Error('EXPORT_NOT_FOUND')
  }
  const rest = objectPath.slice(expectedPrefix.length)
  // rest may be a single segment key; reject escapes and empty tails.
  if (!rest || rest.includes('..') || rest.startsWith('/') || rest.includes('//') || rest.includes('\\')) {
    throw new Error('EXPORT_NOT_FOUND')
  }
  return objectPath
}

function resolveObjectKeyFromRefs({ fileId, objectKey, appId }) {
  if (fileId) {
    const parsed = parseCloudFileId(fileId)
    if (appId) {
      assertAppScopedPath(parsed.objectPath, appId)
    }
    else if (!parsed.objectPath.startsWith(`${PRIVATE_PREFIX}/`)) {
      throw new Error('EXPORT_NOT_FOUND')
    }
    return parsed.objectPath
  }
  if (typeof objectKey === 'string' && objectKey) {
    if (appId) {
      return assertAppScopedPath(objectKey, appId)
    }
    if (!objectKey.startsWith(`${PRIVATE_PREFIX}/`)) {
      throw new Error('EXPORT_NOT_FOUND')
    }
    return objectKey
  }
  throw new Error('EXPORT_NOT_FOUND')
}

function inspectDeleteFileResult(result, expectedFileId) {
  const list = result?.fileList || result?.file_list || []
  if (!Array.isArray(list) || !list.length) {
    throw new Error('EXPORT_DELETE_FAILED')
  }
  let matched = false
  for (const item of list) {
    const itemId = item?.fileID || item?.fileId || item?.file_id || ''
    if (expectedFileId && itemId && itemId !== expectedFileId) {
      continue
    }
    matched = true
    const status = item?.status
    // CloudBase: status 0 means success; any other numeric status is failure.
    if (status === 0 || status === '0') {
      continue
    }
    throw new Error('EXPORT_DELETE_FAILED')
  }
  if (!matched) {
    throw new Error('EXPORT_DELETE_FAILED')
  }
}

function createMemoryExportStorage({ now = () => Date.now(), ttlMs = DEFAULT_TTL_MS } = {}) {
  const objects = new Map()

  function purgeExpired(current = now()) {
    for (const [key, value] of objects.entries()) {
      if (value.expiresAt <= current) {
        objects.delete(key)
      }
    }
  }

  function memoryFileId(objectKey) {
    return `${MEMORY_FILE_ID_PREFIX}/${objectKey}`
  }

  function resolveStoredKey(fileId, objectKey, appId) {
    if (fileId) {
      const parsed = parseCloudFileId(fileId)
      if (appId) {
        assertAppScopedPath(parsed.objectPath, appId)
      }
      return parsed.objectPath
    }
    if (objectKey) {
      if (appId) {
        return assertAppScopedPath(objectKey, appId)
      }
      return objectKey
    }
    throw new Error('EXPORT_NOT_FOUND')
  }

  return {
    kind: 'memory',
    async put(key, payload, options = {}) {
      assertSafeKey(key)
      const expiresAt = Number(options.expiresAt || (now() + ttlMs))
      const objectKey = appScopedObjectKey(options.appId, key)
      const content = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8')
      const fileId = memoryFileId(objectKey)
      objects.set(objectKey, {
        content,
        contentType: options.contentType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        fileName: options.fileName || 'event-roster.xlsx',
        appId: options.appId || '',
        fileId,
        expiresAt,
        consumed: false,
        metadata: options.metadata || {},
      })
      purgeExpired()
      return { key: objectKey, fileId, expiresAt }
    },
    async read(fileIdOrKey, options = {}) {
      const objectKey = resolveStoredKey(
        options.fileId || (typeof fileIdOrKey === 'string' && fileIdOrKey.startsWith('cloud://') ? fileIdOrKey : null),
        options.objectKey || (typeof fileIdOrKey === 'string' && !fileIdOrKey.startsWith('cloud://') ? fileIdOrKey : null),
        options.appId,
      )
      const item = objects.get(objectKey)
      if (!item) {
        purgeExpired()
        throw new Error('EXPORT_NOT_FOUND')
      }
      if (options.appId && item.appId && item.appId !== options.appId) {
        throw new Error('EXPORT_NOT_FOUND')
      }
      if (item.expiresAt <= now()) {
        throw new Error('EXPORT_EXPIRED')
      }
      return {
        content: Buffer.from(item.content),
        contentType: item.contentType,
        fileName: item.fileName,
        metadata: item.metadata,
        objectKey,
        fileId: item.fileId,
      }
    },
    async take(fileIdOrKey, options = {}) {
      const payload = await this.read(fileIdOrKey, options)
      objects.delete(payload.objectKey)
      return payload
    },
    async markConsumed(fileIdOrKey, options = {}) {
      const objectKey = resolveStoredKey(
        options.fileId || (typeof fileIdOrKey === 'string' && fileIdOrKey.startsWith('cloud://') ? fileIdOrKey : null),
        options.objectKey || (typeof fileIdOrKey === 'string' && !fileIdOrKey.startsWith('cloud://') ? fileIdOrKey : null),
        options.appId,
      )
      const item = objects.get(objectKey)
      if (item) {
        item.consumed = true
        objects.set(objectKey, item)
      }
    },
    async delete(fileIdOrKey, options = {}) {
      let objectKey
      try {
        objectKey = resolveStoredKey(
          options.fileId || (typeof fileIdOrKey === 'string' && fileIdOrKey.startsWith('cloud://') ? fileIdOrKey : null),
          options.objectKey || (typeof fileIdOrKey === 'string' && !fileIdOrKey.startsWith('cloud://') ? fileIdOrKey : null),
          options.appId,
        )
      }
      catch {
        throw new Error('EXPORT_DELETE_FAILED')
      }
      if (!objects.has(objectKey)) {
        throw new Error('EXPORT_DELETE_FAILED')
      }
      objects.delete(objectKey)
    },
    clear() {
      objects.clear()
    },
  }
}

/**
 * Private CloudBase storage adapter.
 * Writes under membership-exports/<appId>/… and never returns public URLs.
 * Persists/returns the SDK fileID (cloud://…); never treats bare cloudPath as fileID.
 */
function createCloudBaseExportStorage({ cloud, now = () => Date.now() } = {}) {
  if (!cloud || typeof cloud.uploadFile !== 'function') {
    throw new Error('EXPORT_STORAGE_NOT_CONFIGURED')
  }

  return {
    kind: 'cloudbase',
    async put(key, payload, options = {}) {
      const objectKey = appScopedObjectKey(options.appId, key)
      const content = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8')
      const uploaded = await cloud.uploadFile({
        cloudPath: objectKey,
        fileContent: content,
      })
      const fileId = uploaded?.fileID || uploaded?.fileId || ''
      // SDK must return a full cloud:// fileID — never fall back to bare cloudPath.
      parseCloudFileId(fileId)
      const parsed = parseCloudFileId(fileId)
      assertAppScopedPath(parsed.objectPath, options.appId)
      return {
        key: objectKey,
        fileId,
        expiresAt: Number(options.expiresAt || (now() + DEFAULT_TTL_MS)),
      }
    },
    async read(fileIdOrKey, options = {}) {
      const fileId = options.fileId
        || (typeof fileIdOrKey === 'string' && fileIdOrKey.startsWith('cloud://') ? fileIdOrKey : null)
      if (!fileId) {
        // Compatibility parser: bare keys are never valid download identifiers.
        throw new Error('INVALID_EXPORT_FILE_ID')
      }
      const parsed = parseCloudFileId(fileId)
      if (options.appId) {
        assertAppScopedPath(parsed.objectPath, options.appId)
      }
      if (options.objectKey && options.objectKey !== parsed.objectPath) {
        // Stored object_key must match the path embedded in fileID.
        throw new Error('EXPORT_NOT_FOUND')
      }
      const downloaded = await cloud.downloadFile({ fileID: fileId })
      const content = downloaded?.fileContent
      if (!content) {
        throw new Error('EXPORT_NOT_FOUND')
      }
      return {
        content: Buffer.isBuffer(content) ? content : Buffer.from(content),
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        fileName: 'event-roster.xlsx',
        metadata: {},
        objectKey: parsed.objectPath,
        fileId,
      }
    },
    async take(fileIdOrKey, options = {}) {
      const payload = await this.read(fileIdOrKey, options)
      await this.delete(payload.fileId, { fileId: payload.fileId, appId: options.appId, objectKey: payload.objectKey })
      return payload
    },
    async delete(fileIdOrKey, options = {}) {
      const fileId = options.fileId
        || (typeof fileIdOrKey === 'string' && fileIdOrKey.startsWith('cloud://') ? fileIdOrKey : null)
      if (!fileId) {
        throw new Error('INVALID_EXPORT_FILE_ID')
      }
      parseCloudFileId(fileId)
      if (options.appId) {
        const parsed = parseCloudFileId(fileId)
        assertAppScopedPath(parsed.objectPath, options.appId)
      }
      let result
      try {
        result = await cloud.deleteFile({ fileList: [fileId] })
      }
      catch {
        throw new Error('EXPORT_DELETE_FAILED')
      }
      inspectDeleteFileResult(result, fileId)
    },
  }
}

let injectedStorage = null

function setExportStorage(storage) {
  injectedStorage = storage || null
}

function clearExportStorage() {
  injectedStorage = null
}

/**
 * Resolve export storage. Prefer explicit injection (tests), then CloudBase mode.
 * Never enable process-local memory as a production env option.
 */
function requireExportStorage({ cloud } = {}) {
  if (injectedStorage) {
    return injectedStorage
  }
  const mode = String(process.env.MEMBERSHIP_EXPORT_STORAGE || '').trim().toLowerCase()
  if (mode === 'cloudbase') {
    const sdk = cloud || global.__membershipCloud || null
    if (!sdk) {
      try {
        // eslint-disable-next-line global-require
        const wxCloud = require('wx-server-sdk')
        return createCloudBaseExportStorage({ cloud: wxCloud })
      }
      catch {
        throw new Error('EXPORT_STORAGE_NOT_CONFIGURED')
      }
    }
    return createCloudBaseExportStorage({ cloud: sdk })
  }
  if (mode === 'memory') {
    throw new Error('EXPORT_STORAGE_NOT_CONFIGURED')
  }
  throw new Error('EXPORT_STORAGE_NOT_CONFIGURED')
}

module.exports = {
  PRIVATE_PREFIX,
  appScopedObjectKey,
  assertAppScopedPath,
  clearExportStorage,
  createCloudBaseExportStorage,
  createMemoryExportStorage,
  parseCloudFileId,
  requireExportStorage,
  resolveObjectKeyFromRefs,
  setExportStorage,
}
