'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createAdminMediaProjection } = require('../lib/admin-media-projection')
test('projects authorized media URLs without changing saved references or unrelated cloud strings', async () => {
  const input = { coverAssetId: 'saved-id', coverUrl: 'cloud://cover', contentMedia: [{ assetId: 'image-id', imageUrl: 'cloud://cover' }], body: 'cloud://text' }
  let calls = 0
  const project = createAdminMediaProjection({ getTempFileURL: async request => {
    calls += 1; assert.deepEqual(request.fileList, ['cloud://cover'])
    return { fileList: [{ fileID: 'cloud://cover', tempFileURL: 'https://media.example/cover' }] }
  } })
  const result = await project(input)
  assert.equal(result.coverAssetId, 'saved-id'); assert.equal(result.coverUrl, 'https://media.example/cover')
  assert.equal(result.contentMedia[0].assetId, 'image-id'); assert.equal(result.body, 'cloud://text')
  assert.equal(input.coverUrl, 'cloud://cover'); assert.equal(calls, 1)
})
test('a failed optional media projection preserves the successful business response', async () => {
  const project = createAdminMediaProjection({ getTempFileURL: async () => { throw new Error('unavailable') } })
  assert.deepEqual(await project({ id: 'event', title: '真实标题', coverAssetId: 'saved', coverUrl: 'cloud://cover' }), { id: 'event', title: '真实标题', coverAssetId: 'saved', coverUrl: '' })
})
