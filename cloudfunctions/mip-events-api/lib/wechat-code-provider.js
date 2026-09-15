'use strict'

const MAX_BYTES = 2 * 1024 * 1024
const TOKEN_REFRESH_CODES = new Set(['40001', '40014', '42001'])
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff])

function createWechatCodeProvider({ appId, appSecret, expectedAppId = appId, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const cache = { appId: '', secret: '', value: '', expiresAt: 0 }
  if (typeof fetchImpl !== 'function' || typeof appId !== 'string' || !appId
    || typeof appSecret !== 'string' || appSecret.length < 16 || /[\r\n]/.test(appSecret)) {
    throw new Error('WECHAT_CODE_PROVIDER_CONFIG_REQUIRED')
  }
  if (appId !== expectedAppId) throw new Error('WECHAT_CODE_PROVIDER_APP_ID_MISMATCH')
  return {
    async getUnlimited({ scene, page, width = 430, checkPath = false, envVersion = 'trial' }) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const accessToken = await accessTokenFor({ cache, appId, appSecret, fetchImpl, now })
        let response
        try {
          response = await fetchImpl(
            `https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${encodeURIComponent(accessToken)}`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ scene, page, width, check_path: checkPath, env_version: envVersion }),
              signal: AbortSignal.timeout(3_000),
            },
          )
        }
        catch {
          throw providerError('NETWORK')
        }
        const content = await responseBuffer(response)
        const image = imageContent(content)
        if (response.ok && image) return { buffer: content }
        const code = responseErrorCode(content)
        if (attempt === 0 && TOKEN_REFRESH_CODES.has(code)) {
          cache.value = ''
          cache.expiresAt = 0
          continue
        }
        throw providerError(code || `HTTP_${response.status}`)
      }
      throw new Error('WECHAT_CODE_PROVIDER_UNAVAILABLE')
    },
  }
}

async function accessTokenFor({ cache, appId, appSecret, fetchImpl, now }) {
  const current = now()
  if (cache.appId === appId && cache.secret === appSecret && cache.value && cache.expiresAt > current) return cache.value
  const query = new URLSearchParams({ grant_type: 'client_credential', appid: appId, secret: appSecret })
  let response
  try {
    response = await fetchImpl(`https://api.weixin.qq.com/cgi-bin/token?${query}`, { signal: AbortSignal.timeout(3_000) })
  }
  catch {
    throw providerError('NETWORK')
  }
  const content = await responseBuffer(response, 32 * 1024)
  let payload
  try { payload = JSON.parse(content.toString('utf8')) } catch { throw providerError(`HTTP_${response.status}`) }
  const value = typeof payload?.access_token === 'string' && payload.access_token.length >= 32 ? payload.access_token : ''
  const expiresIn = Number(payload?.expires_in)
  if (!response.ok || !value || !Number.isFinite(expiresIn) || expiresIn < 60) {
    throw providerError(String(payload?.errcode || `HTTP_${response.status}`))
  }
  cache.appId = appId
  cache.secret = appSecret
  cache.value = value
  cache.expiresAt = current + Math.max(60, expiresIn - 300) * 1_000
  return value
}

async function responseBuffer(response, maxBytes = MAX_BYTES) {
  try {
    return await readResponseBuffer(response, maxBytes)
  }
  catch { throw providerError('INVALID_RESPONSE') }
}

async function readResponseBuffer(response, maxBytes) {
  const length = Number(response?.headers?.get?.('content-length') || 0)
  if (length > maxBytes || typeof response?.arrayBuffer !== 'function') throw providerError('INVALID_RESPONSE')
  if (typeof response.body?.getReader === 'function') {
    const reader = response.body.getReader()
    const chunks = []
    let total = 0
    while (true) {
      const next = await reader.read()
      if (next.done) break
      const chunk = Buffer.from(next.value)
      total += chunk.length
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw providerError('INVALID_RESPONSE')
      }
      chunks.push(chunk)
    }
    return Buffer.concat(chunks, total)
  }
  const content = Buffer.from(await response.arrayBuffer())
  if (content.length > maxBytes) throw providerError('INVALID_RESPONSE')
  return content
}

function imageContent(content) {
  if (content.length >= PNG_SIGNATURE.length && content.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return 'image/png'
  if (content.length >= JPEG_SIGNATURE.length && content.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)) return 'image/jpeg'
  return ''
}

function responseErrorCode(content) {
  if (!content || content.length > 4096) return ''
  try {
    const value = JSON.parse(content.toString('utf8'))
    const code = value?.errcode ?? value?.errCode
    return typeof code === 'number' ? String(code) : ''
  } catch { return '' }
}

function providerError(code) {
  const error = new Error('WECHAT_CODE_PROVIDER_UNAVAILABLE')
  error.errCode = /^\d{1,10}$/.test(String(code)) ? String(code) : 'UNKNOWN'
  return error
}

module.exports = { createWechatCodeProvider }
