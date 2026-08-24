'use strict'

const { createHash } = require('node:crypto')

function appScope(appId) {
  return createHash('sha256').update(String(appId || '')).digest('hex').slice(0, 16)
}

function expectedObjectKey(appId, ticketId) {
  if (!/^[A-Za-z0-9_-]{1,36}$/.test(String(ticketId || ''))) throw new Error('EXPORT_PATH_INVALID')
  return `mip/exports/${appScope(appId)}/${ticketId}.xlsx`
}

function parseCloudFileId(fileId) {
  if (typeof fileId !== 'string' || !fileId.startsWith('cloud://') || fileId.includes('..') || fileId.includes('\\') || /\s/.test(fileId)) {
    throw new Error('EXPORT_FILE_INVALID')
  }
  const tail = fileId.slice('cloud://'.length)
  const slash = tail.indexOf('/')
  if (slash <= 0 || slash === tail.length - 1) throw new Error('EXPORT_FILE_INVALID')
  return { fileId, objectKey: tail.slice(slash + 1) }
}

function assertStoredFile({ appId, ticketId, objectKey, fileId }) {
  const expected = expectedObjectKey(appId, ticketId)
  const parsed = parseCloudFileId(fileId)
  if (objectKey !== expected || parsed.objectKey !== expected) throw new Error('EXPORT_FILE_INVALID')
  return parsed
}

function createCloudExportStorage(cloud) {
  if (!cloud
    || typeof cloud.uploadFile !== 'function'
    || typeof cloud.downloadFile !== 'function'
    || typeof cloud.getTempFileURL !== 'function'
    || typeof cloud.deleteFile !== 'function') {
    throw new Error('EXPORT_STORAGE_NOT_CONFIGURED')
  }
  return {
    async put({ appId, ticketId, objectKey, content }) {
      const expected = expectedObjectKey(appId, ticketId)
      if (objectKey !== expected || !Buffer.isBuffer(content)) throw new Error('EXPORT_FILE_INVALID')
      const uploaded = await cloud.uploadFile({ cloudPath: expected, fileContent: content })
      const fileId = uploaded?.fileID || uploaded?.fileId || ''
      assertStoredFile({ appId, ticketId, objectKey, fileId })
      return { fileId }
    },
    async read({ appId, ticketId, objectKey, fileId }) {
      assertStoredFile({ appId, ticketId, objectKey, fileId })
      const result = await cloud.downloadFile({ fileID: fileId })
      if (!result?.fileContent) throw new Error('EXPORT_FILE_MISSING')
      return Buffer.isBuffer(result.fileContent) ? result.fileContent : Buffer.from(result.fileContent)
    },
    async temporaryUrl({ appId, ticketId, objectKey, fileId, maxAgeSeconds = 120 }) {
      assertStoredFile({ appId, ticketId, objectKey, fileId })
      const result = await cloud.getTempFileURL({ fileList: [fileId], maxAge: maxAgeSeconds })
      const item = Array.isArray(result?.fileList) ? result.fileList.find((entry) => {
        const current = entry?.fileID || entry?.fileId || ''
        return current === fileId
      }) : null
      const url = item?.tempFileURL || item?.tempFileUrl || ''
      const status = Number(item?.status ?? 0)
      if (status !== 0 || typeof url !== 'string' || !/^https:\/\//.test(url)) {
        throw new Error('EXPORT_URL_UNAVAILABLE')
      }
      return url
    },
    async delete({ appId, ticketId, objectKey, fileId }) {
      assertStoredFile({ appId, ticketId, objectKey, fileId })
      const result = await cloud.deleteFile({ fileList: [fileId] })
      const item = Array.isArray(result?.fileList) ? result.fileList.find((entry) => {
        const current = entry?.fileID || entry?.fileId || ''
        return !current || current === fileId
      }) : null
      if (!item || Number(item.status) !== 0) throw new Error('EXPORT_DELETE_FAILED')
    },
  }
}

module.exports = {
  appScope,
  assertStoredFile,
  createCloudExportStorage,
  expectedObjectKey,
  parseCloudFileId,
}
