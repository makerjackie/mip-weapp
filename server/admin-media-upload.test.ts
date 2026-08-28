import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ADMIN_MEDIA_PURPOSE_OPTIONS } from '../src/modules/admin-media-upload.ts'
import {
  ADMIN_MEDIA_MAX_IMAGE_BYTES,
  ADMIN_MEDIA_MAX_REQUEST_BYTES,
  ADMIN_MEDIA_PURPOSES,
  ADMIN_MEDIA_UPLOAD_ACTION,
  ADMIN_MEDIA_UPSTREAM_TIMEOUT_MS,
  AdminMediaUploadRequestError,
  createAdminMediaUpstreamRequestInit,
  inspectAdminMediaUploadValue,
  readAdminMediaUploadRequest,
} from './admin-media-upload.ts'

function png(width = 96, height = 64) {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  write32(bytes, 16, width)
  write32(bytes, 20, height)
  return bytes
}

function jpeg(width = 80, height = 60) {
  const bytes = new Uint8Array(21)
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08])
  bytes[7] = height >> 8
  bytes[8] = height & 0xff
  bytes[9] = width >> 8
  bytes[10] = width & 0xff
  bytes[11] = 3
  return bytes
}

function write32(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value >>> 24
  bytes[offset + 1] = value >>> 16
  bytes[offset + 2] = value >>> 8
  bytes[offset + 3] = value
}

function uploadValue(bytes: Uint8Array, purpose = 'BANNER') {
  return {
    action: ADMIN_MEDIA_UPLOAD_ACTION,
    input: { purpose, imageBase64: Buffer.from(bytes).toString('base64') },
  }
}

function jsonRequest(value: unknown, headers: HeadersInit = {}) {
  return new Request('https://admin.example.test/api/media/image', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
    body: JSON.stringify(value),
  })
}

describe('dedicated admin media upload request validation', () => {
  it('keeps the server and browser purpose allowlists aligned', () => {
    assert.deepEqual(ADMIN_MEDIA_PURPOSES, ADMIN_MEDIA_PURPOSE_OPTIONS.map(option => option.value))
    assert.equal(ADMIN_MEDIA_MAX_IMAGE_BYTES, 1024 * 1024)
    assert.equal(ADMIN_MEDIA_MAX_REQUEST_BYTES, 1.5 * 1024 * 1024)
  })

  it('reads only the exact upload action and returns inspected PNG facts', async () => {
    const value = uploadValue(png(96, 64), 'EVENT_COVER')
    const result = await readAdminMediaUploadRequest(jsonRequest(value))

    assert.deepEqual(result.request, value)
    assert.deepEqual(result.image, {
      contentType: 'image/png', byteLength: 24, width: 96, height: 64,
    })
  })

  it('recognizes a bounded JPEG from its SOF header', () => {
    const result = inspectAdminMediaUploadValue(uploadValue(jpeg(80, 60), 'TASK_TEMPLATE'))
    assert.deepEqual(result.image, {
      contentType: 'image/jpeg', byteLength: 21, width: 80, height: 60,
    })
  })

  it('rejects oversized declared, streamed, and decoded bodies with stable codes', async () => {
    const declared = jsonRequest(uploadValue(png()), {
      'content-length': String(ADMIN_MEDIA_MAX_REQUEST_BYTES + 1),
    })
    await assert.rejects(
      () => readAdminMediaUploadRequest(declared),
      (error: unknown) => error instanceof AdminMediaUploadRequestError
        && error.code === 'REQUEST_TOO_LARGE' && error.status === 413,
    )

    const streamed = new Request('https://admin.example.test/api/media/image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'x'.repeat(ADMIN_MEDIA_MAX_REQUEST_BYTES + 1),
    })
    await assert.rejects(
      () => readAdminMediaUploadRequest(streamed),
      (error: unknown) => error instanceof AdminMediaUploadRequestError
        && error.code === 'REQUEST_TOO_LARGE',
    )

    const tooLargeImage = new Uint8Array(ADMIN_MEDIA_MAX_IMAGE_BYTES + 1)
    assert.throws(
      () => inspectAdminMediaUploadValue(uploadValue(tooLargeImage)),
      (error: unknown) => error instanceof AdminMediaUploadRequestError
        && error.code === 'IMAGE_TOO_LARGE',
    )
  })

  it('rejects alternate actions, extra fields, unknown purposes, encodings, and fake images', async () => {
    const cases: Array<[unknown, string]> = [
      [{ ...uploadValue(png()), action: 'mip.admin.media.deleteAll' }, 'VALIDATION_FAILED'],
      [{ ...uploadValue(png()), browserCapability: 'banners.manage' }, 'VALIDATION_FAILED'],
      [{ action: ADMIN_MEDIA_UPLOAD_ACTION, input: { ...uploadValue(png()).input, capability: 'events.read' } }, 'VALIDATION_FAILED'],
      [uploadValue(png(), 'AVATAR'), 'PURPOSE_INVALID'],
      [{ action: ADMIN_MEDIA_UPLOAD_ACTION, input: { purpose: 'BANNER', imageBase64: 'not-base64' } }, 'IMAGE_INVALID'],
      [uploadValue(new TextEncoder().encode('plain text payload')), 'IMAGE_INVALID'],
    ]
    for (const [value, code] of cases) {
      assert.throws(
        () => inspectAdminMediaUploadValue(value),
        (error: unknown) => error instanceof AdminMediaUploadRequestError && error.code === code,
      )
    }
    await assert.rejects(
      () => readAdminMediaUploadRequest(new Request('https://admin.example.test/api/media/image', {
        method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}',
      })),
      (error: unknown) => error instanceof AdminMediaUploadRequestError
        && error.code === 'VALIDATION_FAILED',
    )
  })

  it('selects the dedicated 60 second upstream timeout without exposing configuration', () => {
    let selected = 0
    const signal = new AbortController().signal
    const init = createAdminMediaUpstreamRequestInit({ method: 'POST', body: '{}' }, milliseconds => {
      selected = milliseconds
      return signal
    })
    assert.equal(selected, ADMIN_MEDIA_UPSTREAM_TIMEOUT_MS)
    assert.equal(selected, 60_000)
    assert.equal(init.signal, signal)
    assert.equal(init.method, 'POST')
    assert.equal(init.body, '{}')
    assert.throws(
      () => createAdminMediaUpstreamRequestInit({ signal }),
      (error: unknown) => error instanceof AdminMediaUploadRequestError
        && error.code === 'VALIDATION_FAILED',
    )
  })
})
