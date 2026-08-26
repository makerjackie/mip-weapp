'use strict'

const { createHash, timingSafeEqual } = require('node:crypto')

function createAudioLoader(cloud) {
  return {
    async load(input) {
      if (typeof cloud?.downloadFile !== 'function') {
        throw new Error('AI_DRAFT_PROVIDER_AUDIO_UNAVAILABLE')
      }
      let result
      try {
        result = await cloud.downloadFile({ fileID: input.audioFileId })
      }
      catch {
        throw new Error('AI_DRAFT_PROVIDER_AUDIO_UNAVAILABLE')
      }
      const content = Buffer.isBuffer(result?.fileContent)
        ? result.fileContent
        : Buffer.from(result?.fileContent || '')
      const actualDigest = createHash('sha256').update(content).digest()
      const expectedDigest = Buffer.from(input.audioContentSha256, 'hex')
      if (input.audioContentType !== 'audio/mpeg'
        || content.length !== input.audioContentBytes
        || content.length < 1
        || content.length > 2 * 1024 * 1024
        || expectedDigest.length !== actualDigest.length
        || !timingSafeEqual(actualDigest, expectedDigest)
        || !hasMp3Header(content)) {
        throw new Error('AI_DRAFT_PROVIDER_AUDIO_INVALID')
      }
      return {
        contentBase64: content.toString('base64'),
        contentSha256: input.audioContentSha256,
        contentType: input.audioContentType,
        contentBytes: content.length,
      }
    },
  }
}

function hasMp3Header(buffer) {
  if (buffer.length < 3) return false
  if (buffer.subarray(0, 3).toString('ascii') === 'ID3') return true
  for (let index = 0; index < Math.min(buffer.length - 1, 4096); index += 1) {
    if (buffer[index] === 0xff && (buffer[index + 1] & 0xe0) === 0xe0) return true
  }
  return false
}

module.exports = { createAudioLoader, hasMp3Header }
