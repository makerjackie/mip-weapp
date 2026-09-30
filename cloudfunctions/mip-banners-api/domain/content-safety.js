'use strict'

function createContentSafety(cloudClient, options = {}) {
  return {
    async assertSafe(caller, values) {
      const content = values.map(value => String(value || '').trim()).filter(Boolean).join('\n')
      if (!content || (options.allowInTests && process.env.NODE_ENV === 'test')) return
      const checker = options.checker || cloudClient?.openapi?.security?.msgSecCheck
      if (options.checker && caller.appId !== options.appId) throw new Error('SERVICE_UNAVAILABLE')
      if (!caller.openId) throw new Error('AUTH_REQUIRED')
      if (typeof checker !== 'function') throw new Error('SERVICE_UNAVAILABLE')
      const characters = Array.from(content)
      for (let offset = 0; offset < characters.length; offset += 1872) {
        let response
        try {
          response = await checker({ content: characters.slice(offset, offset + 2000).join(''), version: 2, scene: 2, openid: caller.openId })
        }
        catch {
          throw new Error('SERVICE_UNAVAILABLE')
        }
        const errCode = Number(response?.errCode ?? response?.errcode)
        if (errCode !== 0 || response?.result?.suggest !== 'pass') throw new Error('CONTENT_REJECTED')
        if (offset + 2000 >= characters.length) break
      }
    },
  }
}

module.exports = { createContentSafety }
