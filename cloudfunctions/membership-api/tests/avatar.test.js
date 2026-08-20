'use strict'

const assert = require('node:assert/strict')
const { describe, it, afterEach } = require('node:test')
const {
  assertAvatarContentSafe,
  buildMinimalJpeg,
  buildMinimalPng,
  clearAvatarCloudClient,
  clearAvatarContentChecker,
  createWxOpenApiImageChecker,
  crc32,
  decodeAvatar,
  setAvatarCloudClient,
  setAvatarContentChecker,
} = require('../domain/avatar')

/** Legacy 24-byte pseudo PNG that only has signature + fake dims at fixed offsets. */
function pseudoPng(width, height) {
  const buffer = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer)
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  return buffer.toString('base64')
}

function validPngBase64(width, height) {
  return buildMinimalPng(width, height).toString('base64')
}

afterEach(() => {
  clearAvatarContentChecker()
  clearAvatarCloudClient()
  delete process.env.MEMBERSHIP_DEPLOYMENT_STAGE
  delete process.env.MEMBERSHIP_IMAGE_SAFETY_ENABLED
  delete process.env.MEMBERSHIP_IMAGE_SAFETY_CHECKER
  delete process.env.MEMBERSHIP_PAYMENT_MODE
  delete process.env.NODE_ENV
})

describe('avatar image validation', () => {
  it('accepts a bounded fully-decoded PNG and returns sanitize re-encoded bytes', () => {
    const original = buildMinimalPng(256, 320)
    const { mimeType, width, height, bytes, buffer } = decodeAvatar(original.toString('base64'))
    assert.deepEqual({ mimeType, width, height }, { mimeType: 'image/png', width: 256, height: 320 })
    assert.ok(bytes > 24)
    assert.ok(Buffer.isBuffer(buffer))
    // Sanitize output must re-decode cleanly (READY only uses these bytes).
    const again = decodeAvatar(buffer.toString('base64'))
    assert.equal(again.width, 256)
    assert.equal(again.height, 320)
  })

  it('accepts a full JPEG with SOS+EOI and re-encodes', () => {
    const jpeg = buildMinimalJpeg(128, 128)
    const image = decodeAvatar(jpeg.toString('base64'))
    assert.equal(image.mimeType, 'image/jpeg')
    assert.equal(image.width, 128)
    assert.equal(image.height, 128)
    assert.ok(image.buffer[0] === 0xff && image.buffer[1] === 0xd8)
  })

  it('rejects a 24-byte pseudo PNG that only has signature + fake dims', () => {
    assert.throws(() => decodeAvatar(pseudoPng(256, 320)), /AVATAR_IMAGE_INVALID/)
  })

  it('rejects a PNG with a bad IHDR CRC', () => {
    const bad = buildMinimalPng(128, 128, { corruptCrc: true }).toString('base64')
    assert.throws(() => decodeAvatar(bad), /AVATAR_IMAGE_INVALID/)
  })

  it('rejects a PNG missing IDAT', () => {
    const noIdat = buildMinimalPng(128, 128, { omitIdat: true }).toString('base64')
    assert.throws(() => decodeAvatar(noIdat), /AVATAR_IMAGE_INVALID/)
  })

  it('rejects a truncated PNG missing IEND', () => {
    const full = buildMinimalPng(128, 128)
    const b64 = full.subarray(0, full.length - 12).toString('base64')
    assert.throws(() => decodeAvatar(b64), /AVATAR_IMAGE_INVALID/)
  })

  it('rejects truncated JPEG missing EOI', () => {
    const truncated = buildMinimalJpeg(128, 128, { truncate: true }).toString('base64')
    assert.throws(() => decodeAvatar(truncated), /AVATAR_IMAGE_INVALID/)
  })

  it('rejects oversized dimensions and oversized byte budget', () => {
    assert.throws(() => decodeAvatar(validPngBase64(16, 16)), /AVATAR_IMAGE_INVALID/)
    assert.throws(() => decodeAvatar(validPngBase64(3000, 128)), /AVATAR_IMAGE_INVALID/)
    assert.throws(() => decodeAvatar(validPngBase64(128, 3000)), /AVATAR_IMAGE_INVALID/)

    const largeBase64 = Buffer.alloc(600 * 1024).fill(0x41).toString('base64')
    assert.throws(() => decodeAvatar(largeBase64), /AVATAR_IMAGE_(INVALID|TOO_LARGE)/)
  })

  it('rejects unsupported and implausible image input', () => {
    assert.throws(() => decodeAvatar(Buffer.from('not-an-image').toString('base64')), /AVATAR_IMAGE_INVALID/)
  })

  it('crc32 matches a known PNG IEND empty-chunk digest', () => {
    assert.equal(crc32(Buffer.from('IEND', 'ascii')), 0xae426082)
  })
})

describe('avatar content safety', () => {
  it('accepts when an injected checker reports ok', async () => {
    const result = await assertAvatarContentSafe(buildMinimalPng(64, 64), {
      checkImage: async () => ({ ok: true }),
    })
    assert.equal(result.ok, true)
  })

  it('rejects when an injected checker reports fail', async () => {
    await assert.rejects(
      () => assertAvatarContentSafe(buildMinimalPng(64, 64), {
        checkImage: async () => ({ ok: false }),
      }),
      /AVATAR_CONTENT_REJECTED/,
    )
    await assert.rejects(
      () => assertAvatarContentSafe(buildMinimalPng(64, 64), {
        checkImage: async () => {
          throw new Error('blocked')
        },
      }),
      /AVATAR_CONTENT_REJECTED/,
    )
  })

  it('fails closed in production when safety is not configured', async () => {
    process.env.MEMBERSHIP_DEPLOYMENT_STAGE = 'production'
    await assert.rejects(
      () => assertAvatarContentSafe(buildMinimalPng(64, 64)),
      /AVATAR_SAFETY_NOT_CONFIGURED/,
    )
  })

  it('fails closed in test cloud stage when OpenAPI is missing', async () => {
    process.env.MEMBERSHIP_DEPLOYMENT_STAGE = 'test'
    await assert.rejects(
      () => assertAvatarContentSafe(buildMinimalPng(64, 64)),
      /AVATAR_SAFETY_NOT_CONFIGURED/,
    )
  })

  it('fails closed when payment mode is test without OpenAPI', async () => {
    process.env.MEMBERSHIP_PAYMENT_MODE = 'test'
    await assert.rejects(
      () => assertAvatarContentSafe(buildMinimalPng(64, 64)),
      /AVATAR_SAFETY_NOT_CONFIGURED/,
    )
  })

  it('fails closed when payment mode is disabled without OpenAPI (never fail-open on payment alone)', async () => {
    process.env.MEMBERSHIP_PAYMENT_MODE = 'disabled'
    process.env.NODE_ENV = 'test'
    await assert.rejects(
      () => assertAvatarContentSafe(buildMinimalPng(64, 64)),
      /AVATAR_SAFETY_NOT_CONFIGURED/,
    )
  })

  it('fails closed in development stage when OpenAPI is missing', async () => {
    process.env.MEMBERSHIP_DEPLOYMENT_STAGE = 'development'
    await assert.rejects(
      () => assertAvatarContentSafe(buildMinimalPng(64, 64)),
      /AVATAR_SAFETY_NOT_CONFIGURED/,
    )
  })

  it('may skip only on pure unit-test path (NODE_ENV=test, no stage, no payment mode)', async () => {
    delete process.env.MEMBERSHIP_DEPLOYMENT_STAGE
    delete process.env.MEMBERSHIP_PAYMENT_MODE
    process.env.NODE_ENV = 'test'
    const result = await assertAvatarContentSafe(buildMinimalPng(64, 64))
    assert.equal(result.skipped, true)
    assert.equal(result.ok, true)
  })

  it('uses a process-wide configured checker when set', async () => {
    let seen = 0
    setAvatarContentChecker(async () => {
      seen += 1
      return { ok: true }
    })
    process.env.MEMBERSHIP_DEPLOYMENT_STAGE = 'production'
    await assertAvatarContentSafe(buildMinimalPng(64, 64))
    assert.equal(seen, 1)
  })

  it('default OpenAPI path accepts errCode 0 via fake SDK', async () => {
    process.env.MEMBERSHIP_DEPLOYMENT_STAGE = 'production'
    const fakeCloud = {
      openapi: {
        security: {
          async imgSecCheck() {
            return { errCode: 0 }
          },
        },
      },
    }
    setAvatarCloudClient(fakeCloud)
    const result = await assertAvatarContentSafe(buildMinimalPng(64, 64), { cloud: fakeCloud })
    assert.equal(result.ok, true)
    assert.equal(result.provider, 'wx.openapi.security.imgSecCheck')
    assert.equal(result.contentType, 'image/png')
  })

  it('default OpenAPI path rejects dangerous content', async () => {
    process.env.MEMBERSHIP_DEPLOYMENT_STAGE = 'production'
    const fakeCloud = {
      openapi: {
        security: {
          async imgSecCheck() {
            return { errCode: 87014 }
          },
        },
      },
    }
    await assert.rejects(
      () => assertAvatarContentSafe(buildMinimalPng(64, 64), { cloud: fakeCloud }),
      /AVATAR_CONTENT_REJECTED/,
    )
  })

  it('OpenAPI envelope fails closed for non-object / missing / non-numeric-zero errCode', async () => {
    process.env.MEMBERSHIP_DEPLOYMENT_STAGE = 'production'
    const { isOpenApiImgSecCheckSuccess } = require('../domain/avatar')

    // Pure predicate probes (no network).
    assert.equal(isOpenApiImgSecCheckSuccess(undefined), false)
    assert.equal(isOpenApiImgSecCheckSuccess(null), false)
    assert.equal(isOpenApiImgSecCheckSuccess({}), false)
    assert.equal(isOpenApiImgSecCheckSuccess({ foo: 1 }), false)
    assert.equal(isOpenApiImgSecCheckSuccess({ errCode: '0' }), false)
    assert.equal(isOpenApiImgSecCheckSuccess({ errcode: '0' }), false)
    assert.equal(isOpenApiImgSecCheckSuccess({ errCode: null }), false)
    assert.equal(isOpenApiImgSecCheckSuccess({ errCode: undefined }), false)
    assert.equal(isOpenApiImgSecCheckSuccess({ errCode: 0.0 }), true)
    assert.equal(isOpenApiImgSecCheckSuccess({ errcode: 0 }), true)
    assert.equal(isOpenApiImgSecCheckSuccess({ errCode: 0 }), true)
    assert.equal(isOpenApiImgSecCheckSuccess({ errCode: 1 }), false)
    assert.equal(isOpenApiImgSecCheckSuccess([]), false)
    assert.equal(isOpenApiImgSecCheckSuccess(0), false)

    const rejectCases = [
      undefined,
      null,
      {},
      { foo: 1 },
      { errCode: '0' },
      { errcode: '0' },
      { errCode: null },
    ]
    for (const payload of rejectCases) {
      const fakeCloud = {
        openapi: {
          security: {
            async imgSecCheck() {
              return payload
            },
          },
        },
      }
      await assert.rejects(
        () => assertAvatarContentSafe(buildMinimalPng(64, 64), { cloud: fakeCloud }),
        /AVATAR_CONTENT_REJECTED/,
        `payload=${JSON.stringify(payload)} must fail closed`,
      )
    }
  })

  it('default OpenAPI path fails closed on transport/error and missing openapi', async () => {
    process.env.MEMBERSHIP_DEPLOYMENT_STAGE = 'production'
    await assert.rejects(
      () => assertAvatarContentSafe(buildMinimalPng(64, 64), {
        cloud: { openapi: { security: {
          async imgSecCheck() {
            throw new Error('openapi permission denied')
          },
        } } },
      }),
      /AVATAR_SAFETY_NOT_CONFIGURED/,
    )
    await assert.rejects(
      () => assertAvatarContentSafe(buildMinimalPng(64, 64), {
        cloud: { openapi: {} },
      }),
      /AVATAR_SAFETY_NOT_CONFIGURED/,
    )
    await assert.rejects(
      () => assertAvatarContentSafe(buildMinimalPng(64, 64), { cloud: null }),
      /AVATAR_SAFETY_NOT_CONFIGURED/,
    )
  })

  it('createWxOpenApiImageChecker wires imgSecCheck with PNG contentType', async () => {
    let called = 0
    const checker = createWxOpenApiImageChecker({
      openapi: {
        security: {
          async imgSecCheck(payload) {
            called += 1
            assert.ok(Buffer.isBuffer(payload.media.value))
            assert.equal(payload.media.contentType, 'image/png')
            return { errCode: 0 }
          },
        },
      },
    })
    await checker(buildMinimalPng(64, 64))
    assert.equal(called, 1)
  })

  it('JPEG path calls imgSecCheck with contentType image/jpeg (not image/png)', async () => {
    process.env.MEMBERSHIP_DEPLOYMENT_STAGE = 'production'
    let seenContentType = null
    const fakeCloud = {
      openapi: {
        security: {
          async imgSecCheck(payload) {
            seenContentType = payload.media.contentType
            assert.ok(Buffer.isBuffer(payload.media.value))
            assert.equal(payload.media.value[0], 0xff)
            assert.equal(payload.media.value[1], 0xd8)
            return { errCode: 0 }
          },
        },
      },
    }
    const jpeg = buildMinimalJpeg(64, 64)
    const result = await assertAvatarContentSafe(jpeg, { cloud: fakeCloud })
    assert.equal(result.ok, true)
    assert.equal(seenContentType, 'image/jpeg')
    assert.equal(result.contentType, 'image/jpeg')

    // Direct checker also detects JPEG MIME from buffer signature.
    seenContentType = null
    const checker = createWxOpenApiImageChecker(fakeCloud)
    await checker(jpeg)
    assert.equal(seenContentType, 'image/jpeg')
  })
})
