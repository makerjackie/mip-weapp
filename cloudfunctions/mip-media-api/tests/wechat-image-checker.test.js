'use strict'

const assert = require('node:assert/strict')
const { it } = require('node:test')
const { createWechatImageChecker } = require('../lib/wechat-content-checker')
const appId = 'wx1111111111111111', caller = { appId }
const image = { buffer: Buffer.from([1, 2, 3]), contentType: 'image/png' }
const response = (value, ok = true) => ({ ok, json: async () => value })

it('sends the sanitized multipart image and shares token acquisition for concurrent requests', async () => {
  const calls = []
  const checker = createWechatImageChecker({ appId, appSecret: 'test-secret', fetchImpl: async (url, options) => {
    calls.push({ url, options })
    return response(url.includes('/token?') ? { access_token: 'test-token', expires_in: 7200 } : { errcode: 0 })
  } })
  const results = await Promise.all([checker(image, caller), checker(image, caller)])
  assert.deepEqual(results, [{ errcode: 0 }, { errcode: 0 }])
  assert.equal(calls.length, 3)
  for (const { url, options } of calls.slice(1)) {
    assert.match(url, /^https:\/\/api\.weixin\.qq\.com\/wxa\/img_sec_check\?access_token=test-token$/)
    const file = options.body.get('media')
    assert.equal(file.type, 'image/png')
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), image.buffer)
    assert.equal(options.headers, undefined)
    assert.equal(options.redirect, 'error')
  }
})

it('refreshes expired credentials once and retains a rejected image verdict', async () => {
  const values = [{ access_token: 'old', expires_in: 7200 }, { errcode: 40001 }, { access_token: 'new', expires_in: 7200 }, { errcode: 87014 }]
  const checker = createWechatImageChecker({ appId, appSecret: 'test-secret', fetchImpl: async () => response(values.shift()) })
  await assert.rejects(() => checker(image, caller), /^Error: IMAGE_CONTENT_REJECTED$/)
  assert.equal(values.length, 0)
})

it('blocks other applications and malformed/provider failures without leaking credentials', async () => {
  let calls = 0
  const checker = createWechatImageChecker({ appId, appSecret: 'test-secret', fetchImpl: async () => { calls++; return response({ errcode: 0 }) } })
  await assert.rejects(() => checker(image, { appId: 'wx2222222222222222' }), /IMAGE_SAFETY_UNAVAILABLE/)
  await assert.rejects(() => checker({ ...image, contentType: 'text/plain' }, caller), /IMAGE_SAFETY_UNAVAILABLE/)
  assert.equal(calls, 0)
  for (const verdict of [{ errcode: '0' }, { errcode: 50001 }, {}]) {
    const diagnostics = []
    const failing = createWechatImageChecker({ appId, appSecret: 'test-secret', report: value => diagnostics.push(value), fetchImpl: async url => response(url.includes('/token?') ? { access_token: 'private-token', expires_in: 7200 } : verdict) })
    await assert.rejects(() => failing(image, caller), /^Error: IMAGE_SAFETY_UNAVAILABLE$/)
    assert.equal(JSON.stringify(diagnostics).includes('private-token'), false)
  }
  const network = createWechatImageChecker({ appId, appSecret: 'test-secret', fetchImpl: async () => { throw new Error('https://private-token') } })
  await assert.rejects(() => network(image, caller), /^Error: IMAGE_SAFETY_UNAVAILABLE$/)
})
