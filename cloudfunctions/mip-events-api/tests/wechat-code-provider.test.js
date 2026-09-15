'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createWechatCodeProvider } = require('../lib/wechat-code-provider')

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)])
function response(body, ok = true, status = 200) {
  const content = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))
  return { ok, status, headers: { get() { return String(content.length) } }, async arrayBuffer() { return content } }
}

describe('MIP WeChat code provider', () => {
  it('reuses a token for sequential requests and sends the exact WeChat field names', async () => {
    let tokens = 0
    const provider = createWechatCodeProvider({ appId: 'wx-app', appSecret: 'test-secret-value-123456', fetchImpl: async (url, options) => {
      if (url.includes('/cgi-bin/token')) { tokens += 1; return new Response(JSON.stringify({ access_token: 'test-token-abcdefghijklmnopqrstuvwxyz-1234', expires_in: 3600 })) }
      assert.deepEqual(JSON.parse(options.body), { scene: 'scene', page: 'page', width: 430, check_path: false, env_version: 'trial' })
      return new Response(png)
    } })
    await provider.getUnlimited({ scene: 'scene', page: 'page' })
    await provider.getUnlimited({ scene: 'scene', page: 'page' })
    assert.equal(tokens, 1)
  })

  it('cancels an oversized streaming image before reading the rest', async () => {
    let cancelled = false
    const provider = createWechatCodeProvider({ appId: 'wx-app', appSecret: 'test-secret-value-123456', fetchImpl: async url => {
      if (url.includes('/cgi-bin/token')) return new Response(JSON.stringify({ access_token: 'test-token-abcdefghijklmnopqrstuvwxyz-1234', expires_in: 3600 }))
      return new Response(new ReadableStream({
        pull(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)) },
        cancel() { cancelled = true },
      }))
    } })
    await assert.rejects(provider.getUnlimited({ scene: 'scene', page: 'page' }), /WECHAT_CODE_PROVIDER_UNAVAILABLE/)
    assert.equal(cancelled, true)
  })

  it('never exposes network or body-read error URLs', async () => {
    for (const bodyFailure of [false, true]) {
      const provider = createWechatCodeProvider({ appId: 'wx-app', appSecret: 'test-secret-value-123456', fetchImpl: async () => {
        if (!bodyFailure) throw new Error('https://api.weixin.qq.com?secret=test-secret-value-123456')
        return new Response(new ReadableStream({ start(controller) { controller.error(new Error('test-secret-value-123456')) } }))
      } })
      await assert.rejects(provider.getUnlimited({ scene: 'scene', page: 'page' }), error => {
        assert.doesNotMatch(error.message, /secret|https/)
        return true
      })
    }
  })

  it('gets a token and returns a successful image over HTTPS', async () => {
    const urls = []
    const provider = createWechatCodeProvider({ appId: 'wx-app', appSecret: 'test-secret-value-123456', fetchImpl: async url => {
      urls.push(url)
      return urls.length === 1 ? response({ access_token: 'test-token-value-abcdefghijklmnopqrstuvwxyz', expires_in: 3600 }) : response(png)
    } })
    const result = await provider.getUnlimited({ scene: 's1.scene', page: 'packages/member/mip-events/detail/index', envVersion: 'trial' })
    assert.deepEqual(result.buffer, png)
    assert.match(urls[1], /^https:\/\/api\.weixin\.qq\.com\/wxa\/getwxacodeunlimit\?access_token=/)
    assert.equal(urls[1].includes('secret-value'), false)
  })

  it('refreshes once for an invalid token and does not retry other provider errors', async () => {
    let calls = 0
    const provider = createWechatCodeProvider({ appId: 'wx-app', appSecret: 'test-secret-value-123456', fetchImpl: async url => {
      calls += 1
      if (url.includes('/cgi-bin/token')) return response({ access_token: calls === 1 ? 'test-token-old-abcdefghijklmnopqrstuvwxyz' : 'test-token-new-abcdefghijklmnopqrstuvwxyz', expires_in: 3600 })
      return calls === 2 ? response({ errcode: 40001 }, false, 400) : response(png)
    } })
    await assert.doesNotReject(provider.getUnlimited({ scene: 'scene', page: 'page' }))
    assert.equal(calls, 4)

    const failing = createWechatCodeProvider({ appId: 'wx-app', appSecret: 'test-secret-value-123456', fetchImpl: async url => {
      if (url.includes('/cgi-bin/token')) return response({ access_token: 'test-token-new-abcdefghijklmnopqrstuvwxyz', expires_in: 3600 })
      return response({ errcode: 40003, errmsg: 'secret-value' }, false, 400)
    } })
    await assert.rejects(failing.getUnlimited({ scene: 'scene', page: 'page' }), error => {
      assert.equal(error.errCode, '40003')
      assert.equal(error.message.includes('secret-value'), false)
      return true
    })
  })

  it('rejects an AppID mismatch before making an HTTP call', () => {
    assert.throws(() => createWechatCodeProvider({ appId: 'wx-other', expectedAppId: 'wx-real', appSecret: 'test-secret-value-123456', fetchImpl: async () => response(png) }), /APP_ID_MISMATCH/)
  })
})
