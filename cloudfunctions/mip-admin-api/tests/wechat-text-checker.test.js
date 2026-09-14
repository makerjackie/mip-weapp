'use strict'

const assert = require('node:assert/strict')
const { it } = require('node:test')
const { createWechatTextChecker } = require('../lib/wechat-text-checker')
const { checkCompleteContentSafety } = require('../lib/content-safety')
const response = value => ({ ok: true, json: async () => value })

it('checks web-authored content through the authenticated WeChat API and reuses its token', async () => {
  const calls = []
  const checker = createWechatTextChecker({
    appId: 'test-app', appSecret: 'test-secret',
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      return response(url.includes('/token?') ? { access_token: 'test-token', expires_in: 7200 } : { errcode: 0, result: { suggest: 'pass' } })
    },
  })
  for (let index = 0; index < 2; index += 1) {
    assert.equal(await checkCompleteContentSafety({ title: '付费测试活动' }, { openId: 'test-user' }, checker), 'PASSED')
  }
  assert.equal(calls.length, 3)
  assert.match(calls[1].url, /\/wxa\/msg_sec_check\?access_token=test-token$/)
  assert.deepEqual(JSON.parse(calls[1].options.body), { content: '付费测试活动', version: 2, scene: 2, openid: 'test-user' })
})

it('refreshes an expired provider token once and preserves an unsafe verdict', async () => {
  const results = [{ access_token: 'old', expires_in: 7200 }, { errcode: 40001 }, { access_token: 'new', expires_in: 7200 }, { errcode: 0, result: { suggest: 'risky' } }]
  const checker = createWechatTextChecker({ appId: 'test-app', appSecret: 'test-secret', fetchImpl: async () => response(results.shift()) })
  assert.equal(await checkCompleteContentSafety({ title: 'test' }, { openId: 'test-user' }, checker), 'REJECTED')
  assert.equal(results.length, 0)
})

it('fails closed on provider or network failure without leaking credentials', async () => {
  for (const fetchImpl of [async () => { throw Error('https://secret-token') }, async () => response({ errcode: 40013 })]) {
    const checker = createWechatTextChecker({ appId: 'test-app', appSecret: 'test-secret', fetchImpl })
    await assert.rejects(() => checker({ content: 'test' }), /^Error: CONTENT_SAFETY_UNAVAILABLE$/)
    assert.equal(await checkCompleteContentSafety({ title: 'test' }, { openId: 'test-user' }, checker), 'ERROR')
  }
})
