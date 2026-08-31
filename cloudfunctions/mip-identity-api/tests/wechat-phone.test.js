'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  createWechatPhoneResolver,
  resolveWechatPhone,
} = require('../lib/wechat-phone')

test('returns the bounded WeChat phone payload', async () => {
  const calls = []
  const phoneInfo = { phoneNumber: '18800000000', countryCode: '86' }
  const resolver = createWechatPhoneResolver(async (input) => {
    calls.push(input)
    return { phoneInfo }
  })

  assert.deepEqual(await resolver('single-use-code'), phoneInfo)
  assert.deepEqual(calls, [{ code: 'single-use-code' }])
})

test('normalizes expired, invalid, and consumed authorization codes', async () => {
  for (const providerError of [
    { errCode: 40029, errMsg: 'invalid code' },
    { errcode: 40163, errmsg: 'code been used' },
    new Error('provider request failed: code expired'),
  ]) {
    await assert.rejects(
      resolveWechatPhone(async () => { throw providerError }, 'invalid-code'),
      error => error instanceof Error && error.message === 'PHONE_CODE_INVALID',
    )
  }
})

test('normalizes missing OpenAPI permission without leaking provider detail', async () => {
  await assert.rejects(
    resolveWechatPhone(async () => {
      throw { errCode: 48001, errMsg: 'api unauthorized with sensitive hint' }
    }, 'phone-code'),
    error => error instanceof Error
      && error.message === 'PHONE_PERMISSION_REQUIRED'
      && !error.message.includes('sensitive'),
  )
})

test('normalizes unknown provider failures as a retryable service state', async () => {
  await assert.rejects(
    resolveWechatPhone(async () => {
      throw new Error('upstream secret infrastructure detail')
    }, 'phone-code'),
    error => error instanceof Error
      && error.message === 'PHONE_SERVICE_UNAVAILABLE'
      && !error.message.includes('secret'),
  )
})

test('rejects provider error envelopes and malformed success payloads', async () => {
  await assert.rejects(
    resolveWechatPhone(async () => ({ errcode: 40029, errmsg: 'invalid code' }), 'phone-code'),
    /PHONE_CODE_INVALID/,
  )
  await assert.rejects(
    resolveWechatPhone(
      async () => ({ errCode: 'OPENAPI_ERROR', errMsg: 'api unauthorized' }),
      'phone-code',
    ),
    /PHONE_PERMISSION_REQUIRED/,
  )
  await assert.rejects(
    resolveWechatPhone(async () => ({ phoneInfo: null }), 'phone-code'),
    /PHONE_BIND_FAILED/,
  )
})
