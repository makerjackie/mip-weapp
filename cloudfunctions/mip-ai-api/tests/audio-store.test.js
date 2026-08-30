'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  assertAppScopedAudioFile,
  assertOwnedAudioFile,
  createAudioStore,
  decodeMp3,
  hasMp3Header,
  scope,
} = require('../lib/audio-store')

const key = 'ai-storage-key-that-is-longer-than-thirty-two-bytes'

test('accepts bounded MP3 bytes and rejects unrelated data', () => {
  const mp3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64)]).toString('base64')
  assert.equal(hasMp3Header(decodeMp3(mp3)), true)
  assert.throws(() => decodeMp3(Buffer.from('plain text').toString('base64')), /AI_AUDIO_INVALID/)
})

test('stores voice assets only under the MIP object prefix', async () => {
  let cloudPath
  const store = createAudioStore({
    async uploadFile(input) {
      cloudPath = input.cloudPath
      return { fileID: `cloud://env/${input.cloudPath}` }
    },
    async deleteFile() {
      return { fileList: [{ status: 0 }] }
    },
  }, { storageKey: key, stage: 'development' })
  const result = await store.store({
    appId: 'wx-app',
    userId: '10000000-0000-4000-8000-000000000001',
    audioBase64: Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64)]).toString('base64'),
    contentType: 'audio/mpeg',
  })
  assert.match(cloudPath, /^mip\/development\/[a-f0-9]{24}\/ai\/[a-f0-9]{24}\/[0-9a-f-]+\.mp3$/)
  assert.equal(result.contentType, 'audio/mpeg')
  assert.equal(result.cloudFileId.startsWith('cloud://'), true)
})

test('uploads to the exact preallocated asset id and object key', async () => {
  const appId = 'wx1111111111111111'
  const userId = '10000000-0000-4000-8000-000000000001'
  const assetId = '30000000-0000-4000-8000-000000000001'
  let cloudPath = ''
  const store = createAudioStore({
    async uploadFile(input) {
      cloudPath = input.cloudPath
      return { fileID: `cloud://env/${input.cloudPath}` }
    },
  }, { storageKey: key, stage: 'test', createId: () => assetId })
  const allocation = store.preallocate({ appId, userId })
  const result = await store.store({
    appId,
    userId,
    ...allocation,
    audioBase64: Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64)]).toString('base64'),
    contentType: 'audio/mpeg',
  })
  assert.equal(result.assetId, assetId)
  assert.equal(result.objectKey, allocation.objectKey)
  assert.equal(cloudPath, allocation.objectKey)
  await assert.rejects(() => store.store({
    appId,
    userId,
    assetId,
    objectKey: 'mip/test/wrong/object.mp3',
    audioBase64: Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64)]).toString('base64'),
    contentType: 'audio/mpeg',
  }), /AI_AUDIO_FILE_INVALID/)
})

test('removes only an exact app-owned MIP audio object', async () => {
  let deleted = ''
  const appId = 'wx1111111111111111'
  const userId = '10000000-0000-4000-8000-000000000001'
  const objectKey = `mip/development/${scope(key, 'app', appId)}/ai/${scope(key, 'user', userId)}/30000000-0000-4000-8000-000000000001.mp3`
  const fileId = `cloud://env/${objectKey}`
  const store = createAudioStore({
    async deleteFile({ fileList }) {
      deleted = fileList[0]
      return { fileList: [{ fileID: fileId, status: 0 }] }
    },
  }, { storageKey: key })
  assert.equal(store.configured, true)
  assert.equal(await store.remove({ appId, userId, objectKey, fileId }), true)
  assert.equal(deleted, fileId)
  assert.equal(await store.remove({
    appId,
    userId,
    objectKey,
    fileId: 'cloud://env/other-project/audio.mp3',
  }), false)
  assert.equal(deleted, fileId)
  assert.equal(assertOwnedAudioFile({ appId, userId, objectKey, fileId, storageKey: key }), true)
  assert.equal(assertAppScopedAudioFile({ appId, objectKey, fileId, storageKey: key }), true)
  assert.equal(await store.remove({ appId, objectKey, fileId }), true)
  assert.equal(await store.remove({
    appId,
    userId: '20000000-0000-4000-8000-000000000001',
    objectKey,
    fileId,
  }), false)
})

test('does not delete audio when the stable storage key is unavailable', async () => {
  let called = false
  const store = createAudioStore({
    async deleteFile() {
      called = true
      return { fileList: [] }
    },
  })
  assert.equal(store.configured, false)
  assert.equal(await store.remove({
    appId: 'wx1111111111111111',
    userId: '10000000-0000-4000-8000-000000000001',
    objectKey: 'mip/development/unknown/ai/audio.mp3',
    fileId: 'cloud://env/mip/development/unknown/ai/audio.mp3',
  }), false)
  assert.equal(called, false)
})
