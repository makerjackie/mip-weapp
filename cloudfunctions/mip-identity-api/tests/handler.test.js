'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createHandler } = require('../domain/handler')

describe('MIP identity handler', () => {
  it('builds caller scope only from the trusted context resolver', async () => {
    const calls = []
    const handler = createHandler({
      getContext: () => ({ APPID: 'trusted-app', OPENID: 'trusted-open-id' }),
      resolveCaller(context) {
        assert.equal(context.APPID, 'trusted-app')
        return { appId: 'trusted-app', identityKey: 'a'.repeat(64) }
      },
      service: {
        async listBranches(caller) {
          calls.push(caller)
          return []
        },
      },
    })

    const response = await handler({
      action: 'listBranches',
      appId: 'forged-app',
      userId: 'forged-user',
    })
    assert.deepEqual(response, { ok: true, data: [] })
    assert.deepEqual(calls, [{ appId: 'trusted-app', identityKey: 'a'.repeat(64) }])
  })

  it('returns a bounded error without internal provider detail', async () => {
    const handler = createHandler({
      getContext: () => ({}),
      resolveCaller() {
        throw new Error('database host secret detail')
      },
      service: {},
    })

    const response = await handler({ action: 'getProfile' })
    assert.deepEqual(response, {
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: '身份服务暂时不可用',
        retryable: false,
      },
    })
  })

  it('returns a bounded manual-review state for a UnionID conflict', async () => {
    const handler = createHandler({
      getContext: () => ({}),
      resolveCaller() {
        throw new Error('IDENTITY_UNION_CONFLICT')
      },
      service: {},
    })

    assert.deepEqual(await handler({ action: 'getProfile' }), {
      ok: false,
      error: {
        code: 'IDENTITY_UNION_CONFLICT',
        message: '账号身份需要人工核验',
        retryable: false,
      },
    })
  })

  it('exposes a retryable pending-settlement state for account closure', async () => {
    const handler = createHandler({
      getContext: () => ({}),
      resolveCaller: () => ({ appId: 'trusted-app', identityKey: 'a'.repeat(64) }),
      service: {
        async closeAccount() {
          throw new Error('ACCOUNT_CLOSURE_PENDING_SETTLEMENT')
        },
      },
    })
    assert.deepEqual(await handler({ action: 'closeAccount', input: {} }), {
      ok: false,
      error: {
        code: 'ACCOUNT_CLOSURE_PENDING_SETTLEMENT',
        message: '仍有支付或退款正在处理，请处理完成后再试',
        retryable: true,
      },
    })
  })
})
