'use strict'

const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const test = require('node:test')
const { createAudioLoader } = require('../lib/audio')

const audio = Buffer.from('ID3\u0004\u0000\u0000test', 'binary')

test('downloads the private file and verifies exact MP3 type, bytes, and SHA-256', async () => {
  let fileID
  const loader = createAudioLoader({
    async downloadFile(input) {
      fileID = input.fileID
      return { fileContent: audio }
    },
  })
  const input = {
    audioFileId: 'cloud://env/mip/development/scope/ai/user/file.mp3',
    audioContentSha256: createHash('sha256').update(audio).digest('hex'),
    audioContentType: 'audio/mpeg',
    audioContentBytes: audio.length,
  }
  const result = await loader.load(input)
  assert.equal(fileID, input.audioFileId)
  assert.equal(Buffer.from(result.contentBase64, 'base64').equals(audio), true)
  await assert.rejects(
    () => loader.load({ ...input, audioContentSha256: '0'.repeat(64) }),
    /AUDIO_INVALID/,
  )
})
