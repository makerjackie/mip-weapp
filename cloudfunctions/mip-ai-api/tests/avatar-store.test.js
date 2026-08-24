'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { PNG } = require('pngjs')
const {
  createAvatarStore,
  decodeAvatarImage,
} = require('../lib/avatar-store')

function pngBase64(width = 256, height = 256) {
  const image = new PNG({ width, height })
  image.data.fill(180)
  return PNG.sync.write(image).toString('base64')
}

test('sanitizes and stores a provider image only under the private MIP avatar prefix', async () => {
  const storageKey = 'avatar-storage-secret-that-is-longer-than-thirty-two'
  let uploadedPath = ''
  let safetyChecked = false
  const cloud = {
    async uploadFile(input) {
      uploadedPath = input.cloudPath
      return { fileID: `cloud://env/${input.cloudPath}` }
    },
    async deleteFile({ fileList }) {
      return { fileList: [{ fileID: fileList[0], status: 0 }] }
    },
  }
  const store = createAvatarStore(cloud, {
    storageKey,
    stage: 'development',
    async checkImage(image) {
      safetyChecked = image.width === 256 && image.height === 256
    },
  })
  const asset = await store.store({
    appId: 'wx-app',
    userId: '10000000-0000-4000-8000-000000000001',
    imageBase64: pngBase64(),
    contentType: 'image/png',
  })
  assert.equal(safetyChecked, true)
  assert.match(uploadedPath, /^mip\/development\/[0-9a-f]{24}\/digital-avatars\/[0-9a-f]{24}\/[0-9a-f-]{36}\.png$/)
  assert.equal(asset.cloudFileId, `cloud://env/${uploadedPath}`)
  assert.equal(asset.width, 256)
  assert.equal(await store.remove({
    appId: 'wx-app',
    userId: '10000000-0000-4000-8000-000000000001',
    objectKey: asset.objectKey,
    fileId: asset.cloudFileId,
  }), true)
})

test('rejects mismatched types and non-avatar dimensions before upload', () => {
  const image = pngBase64(128, 128)
  assert.throws(
    () => decodeAvatarImage(image, 'image/png'),
    /DIGITAL_AVATAR_IMAGE_DIMENSIONS_INVALID/,
  )
  assert.throws(
    () => decodeAvatarImage(pngBase64(), 'image/jpeg'),
    /DIGITAL_AVATAR_IMAGE_INVALID/,
  )
})
