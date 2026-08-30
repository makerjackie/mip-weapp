'use strict'

const { createHash, createHmac, randomUUID } = require('node:crypto')

const maximumAudioBytes = 2 * 1024 * 1024

function decodeMp3(value) {
  if (typeof value !== 'string' || !value || value.length > Math.ceil(maximumAudioBytes / 3) * 4 + 8
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error('AI_AUDIO_INVALID')
  }
  const buffer = Buffer.from(value, 'base64')
  if (!buffer.length || buffer.length > maximumAudioBytes || !hasMp3Header(buffer)) {
    throw new Error('AI_AUDIO_INVALID')
  }
  return buffer
}

function hasMp3Header(buffer) {
  if (buffer.length < 3) return false
  if (buffer.subarray(0, 3).toString('ascii') === 'ID3') return true
  for (let index = 0; index < Math.min(buffer.length - 1, 4096); index += 1) {
    if (buffer[index] === 0xff && (buffer[index + 1] & 0xe0) === 0xe0) return true
  }
  return false
}

function cloudObjectKey(fileId) {
  if (typeof fileId !== 'string' || fileId.length > 1024 || !fileId.startsWith('cloud://')
    || fileId.includes('..') || fileId.includes('\\') || /\s/.test(fileId)) {
    throw new Error('AI_AUDIO_FILE_INVALID')
  }
  const tail = fileId.slice('cloud://'.length)
  const slash = tail.indexOf('/')
  if (slash <= 0 || slash === tail.length - 1) throw new Error('AI_AUDIO_FILE_INVALID')
  return tail.slice(slash + 1)
}

function assertAppScopedAudioFile({ appId, objectKey, fileId, storageKey }) {
  if (typeof storageKey !== 'string' || storageKey.length < 32
    || typeof appId !== 'string' || !appId) {
    throw new Error('AI_AUDIO_FILE_INVALID')
  }
  const appScope = scope(storageKey, 'app', appId)
  if (typeof objectKey !== 'string'
    || !new RegExp(
      `^mip/(?:development|test|staging|production)/${appScope}/ai/[0-9a-f]{24}/[0-9a-f-]{36}\\.mp3$`,
    ).test(objectKey)
    || objectKey.includes('..')
    || objectKey.includes('\\')
    || /\s/.test(objectKey)
    || cloudObjectKey(fileId) !== objectKey) {
    throw new Error('AI_AUDIO_FILE_INVALID')
  }
  return true
}

function assertOwnedAudioFile(input) {
  assertAppScopedAudioFile(input)
  if (typeof input.userId !== 'string' || !input.userId) {
    throw new Error('AI_AUDIO_FILE_INVALID')
  }
  const userScope = scope(input.storageKey, 'user', input.userId)
  if (!new RegExp(`/ai/${userScope}/[0-9a-f-]{36}\\.mp3$`).test(input.objectKey)) {
    throw new Error('AI_AUDIO_FILE_INVALID')
  }
  return true
}

function createAudioStore(cloud, options = {}) {
  const storageKey = options.storageKey
  const createId = options.createId || randomUUID
  const stage = ['development', 'test', 'staging', 'production'].includes(options.stage)
    ? options.stage
    : 'development'

  function preallocate(input) {
    const assetId = input.assetId || createId()
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(assetId)) {
      throw new Error('AI_AUDIO_INVALID')
    }
    const appScope = scope(storageKey, 'app', input.appId)
    const userScope = scope(storageKey, 'user', input.userId)
    const objectKey = `mip/${stage}/${appScope}/ai/${userScope}/${assetId}.mp3`
    if (input.objectKey !== undefined && input.objectKey !== objectKey) {
      throw new Error('AI_AUDIO_FILE_INVALID')
    }
    return { assetId, objectKey }
  }

  async function remove(input = {}) {
    if (typeof cloud?.deleteFile !== 'function') return false
    try {
      if (input.userId) assertOwnedAudioFile({ ...input, storageKey })
      else assertAppScopedAudioFile({ ...input, storageKey })
    }
    catch {
      return false
    }
    const result = await cloud.deleteFile({ fileList: [input.fileId] })
    const item = Array.isArray(result?.fileList)
      ? result.fileList.find((entry) => {
          const returnedId = entry?.fileID || entry?.fileId || entry?.file_id || ''
          return returnedId === input.fileId
        })
      : null
    return Number(item?.status) === 0
  }
  if (typeof storageKey !== 'string' || storageKey.length < 32) {
    return {
      configured: false,
      preallocate() { throw new Error('AI_STORAGE_UNAVAILABLE') },
      async store() { throw new Error('AI_STORAGE_UNAVAILABLE') },
      remove,
    }
  }
  return {
    configured: true,
    preallocate,
    async store(input) {
      if (input.contentType !== 'audio/mpeg') throw new Error('AI_AUDIO_INVALID')
      const fileContent = decodeMp3(input.audioBase64)
      const { assetId, objectKey } = preallocate(input)
      const uploaded = await cloud.uploadFile({ cloudPath: objectKey, fileContent })
      const cloudFileId = typeof uploaded?.fileID === 'string' ? uploaded.fileID : ''
      if (!cloudFileId.startsWith('cloud://')) throw new Error('AI_AUDIO_UPLOAD_FAILED')
      assertOwnedAudioFile({
        appId: input.appId,
        userId: input.userId,
        objectKey,
        fileId: cloudFileId,
        storageKey,
      })
      return {
        assetId,
        objectKey,
        cloudFileId,
        contentSha256: createHash('sha256').update(fileContent).digest('hex'),
        contentType: input.contentType,
        contentBytes: fileContent.length,
      }
    },
    remove,
  }
}

function scope(key, kind, value) {
  return createHmac('sha256', key).update(`MIP_AI_STORAGE_V1\0${kind}\0${value}`).digest('hex').slice(0, 24)
}

module.exports = {
  assertAppScopedAudioFile,
  assertOwnedAudioFile,
  cloudObjectKey,
  createAudioStore,
  decodeMp3,
  hasMp3Header,
  maximumAudioBytes,
  scope,
}
