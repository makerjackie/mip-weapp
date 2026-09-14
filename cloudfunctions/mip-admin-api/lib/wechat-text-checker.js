'use strict'

// Web BFF calls have no WeChat cloud-call token. Use the app's server credentials.
function createWechatTextChecker({ appId, appSecret, fetchImpl = globalThis.fetch, now = Date.now }) {
  let token = ''
  let expiresAt = 0
  return async function check(input) {
    if (!appId || !appSecret || typeof fetchImpl !== 'function') throw new Error('CONTENT_SAFETY_CONFIG_REQUIRED')
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (!token || now() >= expiresAt) {
          const query = new URLSearchParams({ grant_type: 'client_credential', appid: appId, secret: appSecret })
          const response = await fetchImpl(`https://api.weixin.qq.com/cgi-bin/token?${query}`, { signal: AbortSignal.timeout(3_000) })
          const data = await response.json()
          if (!response.ok || typeof data.access_token !== 'string' || !data.access_token || !(Number(data.expires_in) > 60)) {
            throw new Error('CONTENT_SAFETY_UNAVAILABLE')
          }
          token = data.access_token
          expiresAt = now() + (Number(data.expires_in) - 60) * 1_000
        }
        const response = await fetchImpl(`https://api.weixin.qq.com/wxa/msg_sec_check?access_token=${encodeURIComponent(token)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(3_000),
        })
        const data = await response.json()
        if (attempt === 0 && [40001, 40014, 42001].includes(Number(data.errcode))) {
          token = ''
          expiresAt = 0
          continue
        }
        if (!response.ok || Number(data.errcode) !== 0) throw new Error('CONTENT_SAFETY_UNAVAILABLE')
        return data
      }
    }
    catch {
      // Provider errors and request URLs may contain credentials; never expose them.
      throw new Error('CONTENT_SAFETY_UNAVAILABLE')
    }
    throw new Error('CONTENT_SAFETY_UNAVAILABLE')
  }
}

module.exports = { createWechatTextChecker }
