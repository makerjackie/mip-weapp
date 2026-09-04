'use strict'

const { createHash, createHmac, timingSafeEqual } = require('node:crypto')
const { canonicalJson } = require('./web-bff-auth')

const WEB_LOGIN_QR_TRANSPORT = 'MIP_WEB_LOGIN_QR_V1'
const WEB_LOGIN_QR_MAX_CLOCK_SKEW_MS = 60_000
const WEB_LOGIN_QR_PAGE = 'packages/admin/web-login-confirm/index'
const MAX_QR_CODE_BYTES = 512 * 1024
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff])
const envelopeKeys = new Set(['appId', 'challengeToken', 'nonce', 'signature', 'timestamp', 'transport'])

function isWebLoginQrCodeEvent(value) {
  return Boolean(value && typeof value === 'object' && value.transport === WEB_LOGIN_QR_TRANSPORT)
}

function createWebLoginQrCodeRoute({
  cloud,
  allowedAppIds,
  replayGuard,
  secret,
  stage,
  now = Date.now,
} = {}) {
  return async function runWebLoginQrCode(event = {}) {
    try {
      const verified = verifyEnvelope(event, { allowedAppIds, secret, now: now() })
      await consumeReplay(replayGuard, verified)
      const image = await generateQrCode(cloud, verified.challengeToken, stage)
      return { ok: true, data: image }
    }
    catch (error) {
      const authenticationFailure = error?.message === 'WEB_LOGIN_QR_AUTH_REQUIRED'
      const replayed = error?.message === 'WEB_BFF_REPLAYED'
      const diagnostic = !authenticationFailure && !replayed
        ? providerDiagnostic(error)
        : null
      return {
        ok: false,
        error: {
          code: authenticationFailure
            ? 'AUTH_REQUIRED'
            : replayed ? 'WEB_LOGIN_QR_REPLAYED' : 'WEB_LOGIN_QR_UNAVAILABLE',
          message: authenticationFailure
            ? '请求未通过验证'
            : replayed ? '请求已处理' : '小程序码暂时无法生成',
          retryable: !authenticationFailure && !replayed,
          ...(diagnostic ? { diagnostic } : {}),
        },
      }
    }
  }
}

function verifyEnvelope(value, { allowedAppIds, secret, now }) {
  if (typeof secret !== 'string' || secret.length < 32 || !Number.isSafeInteger(now)) {
    throw new Error('WEB_LOGIN_QR_CONFIG_REQUIRED')
  }
  if (!isPlainRecord(value) || !hasExactKeys(value, envelopeKeys)
    || value.transport !== WEB_LOGIN_QR_TRANSPORT
    || !Number.isSafeInteger(value.timestamp)
    || Math.abs(now - value.timestamp) > WEB_LOGIN_QR_MAX_CLOCK_SKEW_MS
    || typeof value.nonce !== 'string'
    || !/^[A-Za-z0-9_-]{24,128}$/.test(value.nonce)
    || typeof value.appId !== 'string'
    || !/^[A-Za-z0-9_-]{1,64}$/.test(value.appId)
    || !(allowedAppIds instanceof Set)
    || !allowedAppIds.has(value.appId)
    || typeof value.challengeToken !== 'string'
    || !/^[A-Za-z0-9_-]{32}$/.test(value.challengeToken)
    || typeof value.signature !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.signature)) {
    throw new Error('WEB_LOGIN_QR_AUTH_REQUIRED')
  }
  const { signature, ...unsigned } = value
  const expected = createHmac('sha256', secret).update(canonicalJson(unsigned)).digest()
  const supplied = Buffer.from(signature, 'hex')
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new Error('WEB_LOGIN_QR_AUTH_REQUIRED')
  }
  return unsigned
}

async function consumeReplay(replayGuard, verified) {
  if (!replayGuard || typeof replayGuard.consume !== 'function') {
    throw new Error('WEB_LOGIN_QR_CONFIG_REQUIRED')
  }
  await replayGuard.consume({
    appId: verified.appId,
    nonce: verified.nonce,
    principalIdentityKey: createHash('sha256')
      .update(`${WEB_LOGIN_QR_TRANSPORT}\0${verified.appId}`)
      .digest('hex'),
    action: 'mip.admin.webLogin.qr.generate',
    requestHash: createHash('sha256').update(canonicalJson(verified)).digest('hex'),
  })
}

async function generateQrCode(cloud, challengeToken, stage) {
  if (typeof cloud?.openapi?.wxacode?.getUnlimited !== 'function') {
    throw new Error('WEB_LOGIN_QR_CONFIG_REQUIRED')
  }
  const environment = codeEnvironment(stage)
  const response = await cloud.openapi.wxacode.getUnlimited({
    scene: challengeToken,
    page: WEB_LOGIN_QR_PAGE,
    width: 430,
    checkPath: environment === 'release',
    envVersion: environment,
  })
  const content = binaryBuffer(Buffer.isBuffer(response) ? response : response?.buffer)
  if (!Buffer.isBuffer(content) || content.length < JPEG_SIGNATURE.length || content.length > MAX_QR_CODE_BYTES) {
    throw new Error('WEB_LOGIN_QR_INVALID_RESPONSE')
  }
  const png = content.length >= PNG_SIGNATURE.length
    && content.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  const jpeg = content.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)
  if (!png && !jpeg) throw new Error('WEB_LOGIN_QR_INVALID_RESPONSE')
  return {
    contentType: png ? 'image/png' : 'image/jpeg',
    imageBase64: content.toString('base64'),
  }
}

function codeEnvironment(value) {
  const stage = String(value || '').trim().toLowerCase()
  if (!['development', 'test', 'staging', 'production'].includes(stage)) {
    throw new Error('WEB_LOGIN_QR_CONFIG_REQUIRED')
  }
  if (stage === 'production') return 'release'
  if (stage === 'staging') return 'trial'
  return 'develop'
}

function binaryBuffer(value) {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  if (value instanceof ArrayBuffer) return Buffer.from(new Uint8Array(value))
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  if (value && value.type === 'Buffer' && Array.isArray(value.data)) return Buffer.from(value.data)
  return null
}

function providerDiagnostic(error) {
  const code = safeDiagnosticText(
    error?.errCode ?? error?.errcode ?? error?.code ?? error?.errorCode,
    64,
  )
  const reason = safeDiagnosticText(
    error?.errMsg ?? error?.errmsg ?? error?.message,
    160,
  )
  if (!code && !reason) return null
  return {
    ...(code ? { code } : {}),
    ...(reason ? { reason } : {}),
  }
}

function safeDiagnosticText(value, maximum) {
  if (!['string', 'number'].includes(typeof value)) return ''
  return String(value)
    .replace(/(access[_ -]?token|secret|password|authorization)(\s*[:=]\s*)[^\s,;]+/gi, '$1$2[redacted]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted]')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, maximum)
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasExactKeys(value, expected) {
  const keys = Reflect.ownKeys(value)
  return keys.length === expected.size
    && keys.every(key => typeof key === 'string' && expected.has(key))
}

module.exports = {
  WEB_LOGIN_QR_PAGE,
  WEB_LOGIN_QR_TRANSPORT,
  codeEnvironment,
  createWebLoginQrCodeRoute,
  isWebLoginQrCodeEvent,
}
