'use strict'

const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const test = require('node:test')
const { PNG } = require('pngjs')
const { createImageLoader, normalizeOutputImage } = require('../lib/image')

function png(width = 256, height = 256) {
  const image = new PNG({ width, height })
  image.data.fill(180)
  return PNG.sync.write(image)
}

test('downloads and verifies the exact private source image bytes, hash, type, and dimensions', async () => {
  const content = png(512, 512)
  let fileID
  const loader = createImageLoader({
    async downloadFile(input) {
      fileID = input.fileID
      return { fileContent: content }
    },
  })
  const input = {
    sourceImageFileId: 'cloud://env/mip/development/0123456789abcdef01234567/avatars/89abcdef0123456789abcdef/30000000-0000-4000-8000-000000000001.png',
    sourceContentSha256: createHash('sha256').update(content).digest('hex'),
    sourceContentType: 'image/png',
    sourceContentBytes: content.length,
    sourceWidth: 512,
    sourceHeight: 512,
  }
  const result = await loader.load(input)
  assert.equal(fileID, input.sourceImageFileId)
  assert.equal(Buffer.from(result.contentBase64, 'base64').equals(content), true)
  await assert.rejects(() => loader.load({ ...input, sourceWidth: 511 }), /IMAGE_INVALID/)
  await assert.rejects(() => loader.load({ ...input, sourceContentSha256: '0'.repeat(64) }), /IMAGE_INVALID/)
})

test('accepts only canonical, bounded, square PNG/JPEG output', () => {
  const output = png()
  assert.equal(normalizeOutputImage(output.toString('base64'), 'image/png'), output.toString('base64'))
  assert.throws(() => normalizeOutputImage(output.toString('base64'), 'image/jpeg'), /RESPONSE_INVALID/)
  assert.throws(() => normalizeOutputImage(png(128, 128).toString('base64'), 'image/png'), /RESPONSE_INVALID/)
  assert.throws(() => normalizeOutputImage(png(256, 512).toString('base64'), 'image/png'), /RESPONSE_INVALID/)
  assert.throws(() => normalizeOutputImage('not-base64', 'image/png'), /RESPONSE_INVALID/)
})
