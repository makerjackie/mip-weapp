'use strict'

// Authored here and generated into media, tasks and banners so each deployment stays self-contained.
// Web/internal calls do not carry a WeChat cloud-call token.
function createChecker({ appId, appSecret, fetchImpl = globalThis.fetch, now = Date.now, image = false, report = () => {} } = {}) {
  const unavailableCode = image ? 'IMAGE_SAFETY_UNAVAILABLE' : 'CONTENT_SAFETY_UNAVAILABLE'
  let token = '', expiresAt = 0, tokenFlight = null
  const unavailable = (stage, vendorCode) => {
    try { report({ stage, vendorCode: Number.isSafeInteger(vendorCode) ? vendorCode : null }) } catch { /* Keep the safety decision if diagnostics fail. */ }
    return new Error(unavailableCode)
  }
  async function accessToken() {
    if (token && now() < expiresAt) return token
    if (!tokenFlight) {
      tokenFlight = (async () => {
        const query = new URLSearchParams({ grant_type: 'client_credential', appid: appId, secret: appSecret })
        const response = await fetchImpl(`https://api.weixin.qq.com/cgi-bin/token?${query}`, { signal: AbortSignal.timeout(3_000), redirect: 'error' })
        const data = await response.json(), lifetime = Number(data.expires_in)
        if (!response.ok || typeof data.access_token !== 'string' || !data.access_token || data.access_token.length > 4096 || !Number.isFinite(lifetime) || lifetime <= 60) throw unavailable('http-token-failed', data.errcode)
        token = data.access_token
        expiresAt = now() + (Math.min(lifetime, 7200) - 60) * 1000
        return token
      })().finally(() => { tokenFlight = null })
    }
    return tokenFlight
  }
  return async function check(input, caller) {
    if (!appId || !appSecret || typeof fetchImpl !== 'function') throw unavailable('http-config-unavailable')
    if (image && (!/^wx[0-9a-f]{16}$/i.test(appId) || !caller || caller.appId !== appId || !Buffer.isBuffer(input?.buffer) || !['image/png', 'image/jpeg'].includes(input?.contentType) || !input.buffer.length || input.buffer.length > 1024 * 1024)) throw unavailable('http-app-or-image-invalid')
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const usedToken = await accessToken()
        let body = JSON.stringify(input)
        if (image) {
          body = new FormData()
          body.append('media', new Blob([input.buffer], { type: input.contentType }), input.contentType === 'image/png' ? 'image.png' : 'image.jpg')
        }
        const response = await fetchImpl(`https://api.weixin.qq.com/wxa/${image ? 'img' : 'msg'}_sec_check?access_token=${encodeURIComponent(usedToken)}`, {
          method: 'POST', ...(image ? {} : { headers: { 'content-type': 'application/json' } }), body,
          signal: AbortSignal.timeout(3_000), redirect: 'error',
        })
        const data = await response.json()
        if (attempt === 0 && [40001, 40014, 42001].includes(data.errcode)) {
          if (token === usedToken) { token = ''; expiresAt = 0 }
          continue
        }
        if (image && data.errcode === 87014) throw new Error('IMAGE_CONTENT_REJECTED')
        if (!response.ok || data.errcode !== 0) throw unavailable('http-check-failed', data.errcode)
        return data
      }
    }
    catch (error) {
      // URLs and provider error messages may contain credentials. Never return them.
      if (image && error?.message === 'IMAGE_CONTENT_REJECTED') throw error
      if (error?.message === unavailableCode) throw error
      throw unavailable('http-transport-failed')
    }
    throw unavailable('http-check-failed')
  }
}

function createWechatTextChecker(options) { return createChecker(options) }
function createWechatImageChecker(options) { return createChecker({ ...options, image: true }) }

module.exports = { createWechatTextChecker, createWechatImageChecker }
