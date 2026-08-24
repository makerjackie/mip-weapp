'use strict'

function createContentSafety(cloudClient, options = {}) {
  return {
    async assertSafe(caller, values) {
      const content = values.map(value => String(value || '').trim()).filter(Boolean).join('\n').slice(0, 4000)
      if (!content || (options.allowInTests && process.env.NODE_ENV === 'test')) return
      const checker = cloudClient?.openapi?.security?.msgSecCheck
      if (typeof checker !== 'function') throw new Error('SERVICE_UNAVAILABLE')
      let response
      try {
        response = await checker({ content, version: 2, scene: 2, openid: caller.openId })
      }
      catch {
        throw new Error('SERVICE_UNAVAILABLE')
      }
      const errCode = Number(response?.errCode ?? response?.errcode)
      if (errCode !== 0 || response?.result?.suggest !== 'pass') throw new Error('CONTENT_REJECTED')
    },
  }
}

module.exports = { createContentSafety }
