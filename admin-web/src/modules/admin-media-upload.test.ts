import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ADMIN_MEDIA_MAX_IMAGE_BYTES,
  ADMIN_MEDIA_PURPOSE_CAPABILITIES,
  ADMIN_MEDIA_PURPOSE_OPTIONS,
  ADMIN_MEDIA_UPLOAD_ACTION,
  AdminMediaUploadError,
  availableAdminMediaPurposeOptions,
  hasAdminMediaUploadAccess,
  parseAdminMediaUploadResult,
  prepareAdminMediaUpload,
  validateAdminMediaFileMetadata,
  type AdminMediaFile,
} from './admin-media-upload.ts'

const assetId = '10000000-0000-4000-8000-000000000001'

function png(width = 96, height = 64) {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  write32(bytes, 16, width)
  write32(bytes, 20, height)
  return bytes
}

function jpeg() {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x40, 0x00, 0x60])
}

function write32(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value >>> 24
  bytes[offset + 1] = value >>> 16
  bytes[offset + 2] = value >>> 8
  bytes[offset + 3] = value
}

function file(bytes: Uint8Array, type: string, extra: Partial<AdminMediaFile> = {}): AdminMediaFile {
  const copy = Uint8Array.from(bytes)
  return {
    name: type === 'image/png' ? 'cover.png' : 'cover.jpg',
    size: copy.byteLength,
    type,
    arrayBuffer: async () => copy.buffer,
    ...extra,
  }
}

describe('browser admin media upload preparation', () => {
  it('exposes all eight neutral purpose options and encodes a PNG as canonical base64', async () => {
    const bytes = png()
    const prepared = await prepareAdminMediaUpload(file(bytes, 'image/png'), 'BANNER')

    assert.equal(ADMIN_MEDIA_PURPOSE_OPTIONS.length, 8)
    assert.deepEqual(prepared, {
      action: ADMIN_MEDIA_UPLOAD_ACTION,
      input: { purpose: 'BANNER', imageBase64: Buffer.from(bytes).toString('base64') },
    })
  })

  it('accepts JPEG and rejects MIME/header mismatch or unreadable length', async () => {
    const prepared = await prepareAdminMediaUpload(file(jpeg(), 'image/jpeg'), 'EVENT_ALBUM')
    assert.equal(prepared.input.purpose, 'EVENT_ALBUM')

    await assert.rejects(
      () => prepareAdminMediaUpload(file(png(), 'image/jpeg'), 'BANNER'),
      (error: unknown) => error instanceof AdminMediaUploadError && error.code === 'IMAGE_INVALID',
    )
    await assert.rejects(
      () => prepareAdminMediaUpload(file(png(), 'image/gif'), 'BANNER'),
      (error: unknown) => error instanceof AdminMediaUploadError && error.code === 'IMAGE_INVALID',
    )
    await assert.rejects(
      () => prepareAdminMediaUpload(file(png(), 'image/png', { size: 25 }), 'BANNER'),
      (error: unknown) => error instanceof AdminMediaUploadError && error.code === 'IMAGE_INVALID',
    )
  })

  it('rejects oversized or unknown-purpose files before reading bytes', async () => {
    let reads = 0
    const oversized = file(png(), 'image/png', {
      size: ADMIN_MEDIA_MAX_IMAGE_BYTES + 1,
      arrayBuffer: async () => { reads += 1; return new ArrayBuffer(0) },
    })
    await assert.rejects(
      () => prepareAdminMediaUpload(oversized, 'BANNER'),
      (error: unknown) => error instanceof AdminMediaUploadError && error.code === 'IMAGE_TOO_LARGE',
    )
    await assert.rejects(
      () => prepareAdminMediaUpload(file(png(), 'image/png'), 'AVATAR' as 'BANNER'),
      (error: unknown) => error instanceof AdminMediaUploadError && error.code === 'PURPOSE_INVALID',
    )
    assert.equal(reads, 0)
  })

  it('shows the page when any mapped capability is present and limits purpose choices exactly', () => {
    assert.deepEqual(ADMIN_MEDIA_PURPOSE_CAPABILITIES, {
      BANNER: 'banners.manage',
      EVENT_ALBUM: 'events.album.manage',
      EVENT_CONTENT: 'events.write',
      EVENT_COVER: 'events.write',
      OPPORTUNITY_COVER: 'opportunities.moderate',
      SUPER_CASE_COVER: 'userContent.moderate',
      SUPER_CASE_MEDIA: 'userContent.moderate',
      TASK_TEMPLATE: 'tasks.manage',
    })
    const platformGrants = [{ capability: 'events.write', scopeType: 'PLATFORM' }]
    assert.equal(hasAdminMediaUploadAccess(platformGrants), true)
    assert.deepEqual(availableAdminMediaPurposeOptions(platformGrants).map(option => option.value), [
      'EVENT_CONTENT', 'EVENT_COVER',
    ])
    assert.equal(hasAdminMediaUploadAccess([
      { capability: 'events.write', scopeType: 'BRANCH' },
      { capability: 'events.album.manage', scopeType: 'EVENT' },
    ]), false)
    assert.deepEqual(availableAdminMediaPurposeOptions([
      { capability: 'events.write', scopeType: 'BRANCH' },
    ]), [])
  })

  it('parses only a standard successful response with safe asset and image identifiers', () => {
    assert.deepEqual(parseAdminMediaUploadResult({
      ok: true,
      data: {
        assetId,
        imageUrl: 'cloud://env.mip/mip/live/app/banners/asset.png',
        width: 96,
        height: 64,
      },
    }), {
      assetId,
      imageUrl: 'cloud://env.mip/mip/live/app/banners/asset.png',
    })

    for (const value of [
      { ok: false, error: { code: 'UPLOAD_FAILED' } },
      { ok: true, data: { assetId: 'asset-a', imageUrl: 'cloud://env/file.png' } },
      { ok: true, data: { assetId, imageUrl: 'javascript:alert(1)' } },
    ]) {
      assert.throws(
        () => parseAdminMediaUploadResult(value),
        (error: unknown) => error instanceof AdminMediaUploadError && error.code === 'INVALID_RESPONSE',
      )
    }
  })
})
