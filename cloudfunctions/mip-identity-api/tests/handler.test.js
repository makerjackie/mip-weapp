'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  CONTRACT_VERSION,
  actions,
  createHandler,
  normalizeRequest,
} = require('../domain/handler')

describe('MIP identity handler', () => {
  it('fixes the public contract at thirteen business actions plus health', async () => {
    assert.equal(CONTRACT_VERSION, 1)
    assert.deepEqual(Object.keys(actions).sort(), [
      'acceptAgreements',
      'bindWechatPhone',
      'closeAccount',
      'getAccessSnapshot',
      'getMyProfileCardCode',
      'getProfile',
      'getPublicProfile',
      'listBranches',
      'listProfileTags',
      'resolveProfileCardScene',
      'setPrimaryBranch',
      'updateCard',
      'updateProfile',
    ])

    let resolved = false
    const handler = createHandler({
      getContext: () => ({}),
      resolveCaller: () => {
        resolved = true
        return {}
      },
      service: {},
    })
    assert.deepEqual(await handler({ contractVersion: 1, action: 'health', input: {} }), {
      ok: true,
      data: { status: 'ok' },
    })
    assert.equal(resolved, false)
  })

  it('dispatches direct v1 business input without rebuilding a nested service envelope', async () => {
    const calls = []
    const caller = { appId: 'trusted-app', identityKey: 'a'.repeat(64) }
    const handler = createHandler({
      getContext: () => ({ APPID: 'trusted-app' }),
      resolveCaller: () => caller,
      service: {
        async acceptAgreements(receivedCaller, value) {
          calls.push({ action: 'acceptAgreements', receivedCaller, value })
          return { accepted: true }
        },
        async updateProfile(receivedCaller, value) {
          calls.push({ action: 'updateProfile', receivedCaller, value })
          return { updated: true }
        },
      },
    })

    assert.deepEqual(await handler({
      contractVersion: 1,
      action: 'acceptAgreements',
      input: { agreements: [{ key: 'SERVICE_AGREEMENT', version: '1' }] },
    }), { ok: true, data: { accepted: true } })
    assert.deepEqual(await handler({
      contractVersion: 1,
      action: 'updateProfile',
      input: { expectedVersion: 2, nickname: '测试用户' },
    }), { ok: true, data: { updated: true } })
    assert.deepEqual(calls, [
      {
        action: 'acceptAgreements',
        receivedCaller: caller,
        value: { agreements: [{ key: 'SERVICE_AGREEMENT', version: '1' }] },
      },
      {
        action: 'updateProfile',
        receivedCaller: caller,
        value: { input: { expectedVersion: 2, nickname: '测试用户' } },
      },
    ])
    assert.equal(Object.hasOwn(calls[0].value, 'input'), false)
  })

  it('keeps legacy flat and previously nested requests compatible after CloudBase metadata injection', async () => {
    assert.deepEqual(normalizeRequest({
      action: 'bindWechatPhone',
      code: 'legacy-code',
    }), {
      action: 'bindWechatPhone',
      input: { code: 'legacy-code' },
      legacy: true,
    })
    assert.deepEqual(normalizeRequest({
      action: 'setPrimaryBranch',
      input: { branchId: 'branch-1', expectedVersion: 2 },
      tcbContext: {},
      userInfo: { appId: 'transport-only-app-id', openId: 'transport-only-open-id' },
    }), {
      action: 'setPrimaryBranch',
      input: { branchId: 'branch-1', expectedVersion: 2 },
      legacy: true,
    })
    assert.deepEqual(normalizeRequest({
      contractVersion: 1,
      action: 'acceptAgreements',
      input: { agreements: [{ key: 'SERVICE_AGREEMENT', version: '1' }] },
      userInfo: { openId: 'transport-only-open-id' },
    }), {
      action: 'acceptAgreements',
      input: { agreements: [{ key: 'SERVICE_AGREEMENT', version: '1' }] },
      legacy: false,
    })
  })

  it('rejects v1 top-level business fields and nested route injection', async () => {
    const calls = []
    const handler = createHandler({
      getContext: () => ({ APPID: 'trusted-app' }),
      resolveCaller: () => ({ appId: 'trusted-app', identityKey: 'a'.repeat(64) }),
      service: {
        async bindWechatPhone(_caller, value) {
          calls.push(value)
          return { phoneBound: true }
        },
        async closeAccount() {
          throw new Error('FORBIDDEN')
        },
      },
    })

    assert.deepEqual(await handler({
      contractVersion: 1,
      action: 'bindWechatPhone',
      input: { code: 'trusted-route-code' },
      code: 'flat-code',
    }), {
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: '提交的资料格式不正确',
        retryable: false,
      },
    })
    assert.deepEqual(await handler({
      contractVersion: 1,
      action: 'bindWechatPhone',
      input: {
        action: 'closeAccount',
        contractVersion: 999,
        input: { confirmationPhrase: '确认注销账号' },
        code: 'trusted-route-code',
      },
    }), {
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: '提交的资料格式不正确',
        retryable: false,
      },
    })
    assert.deepEqual(calls, [])
  })

  it('rejects malformed platform metadata, double envelopes, and unknown top-level fields', () => {
    assert.throws(
      () => normalizeRequest({
        contractVersion: 1,
        action: 'acceptAgreements',
        input: { agreements: [] },
        userInfo: 'forged-open-id',
      }),
      /VALIDATION_FAILED/,
    )
    assert.throws(
      () => normalizeRequest({
        contractVersion: 1,
        action: 'acceptAgreements',
        input: { agreements: [] },
        tcbContext: 'forged-context',
      }),
      /VALIDATION_FAILED/,
    )
    assert.throws(
      () => normalizeRequest({
        contractVersion: 1,
        action: 'acceptAgreements',
        input: { input: { agreements: [] } },
      }),
      /VALIDATION_FAILED/,
    )
    assert.throws(
      () => normalizeRequest({
        contractVersion: 1,
        action: 'acceptAgreements',
        input: { agreements: [] },
        platformInfo: {},
      }),
      /VALIDATION_FAILED/,
    )
    assert.throws(
      () => normalizeRequest({
        action: 'acceptAgreements',
        input: { agreements: [] },
        unexpected: true,
      }),
      /VALIDATION_FAILED/,
    )
  })

  it('rejects unknown and prototype actions before resolving caller or service', async () => {
    let resolverCalls = 0
    const handler = createHandler({
      getContext: () => {
        throw new Error('MUST_NOT_READ_CONTEXT')
      },
      resolveCaller: () => {
        resolverCalls += 1
        throw new Error('MUST_NOT_RESOLVE_CALLER')
      },
      service: {},
    })
    const expected = {
      ok: false,
      error: {
        code: 'UNSUPPORTED_ACTION',
        message: '不支持该操作',
        retryable: false,
      },
    }
    for (const action of ['unknownAction', 'toString', 'constructor', '__proto__']) {
      assert.deepEqual(await handler({ contractVersion: 1, action, input: {} }), expected)
    }
    assert.equal(resolverCalls, 0)
  })

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

  it('returns actionable bounded phone provider states', async () => {
    const handler = createHandler({
      getContext: () => ({}),
      resolveCaller: () => ({ appId: 'trusted-app', identityKey: 'a'.repeat(64) }),
      service: {
        async bindWechatPhone(_caller, { code }) {
          throw new Error(code)
        },
      },
    })

    assert.deepEqual(await handler({ action: 'bindWechatPhone', code: 'PHONE_CODE_INVALID' }), {
      ok: false,
      error: {
        code: 'PHONE_CODE_INVALID',
        message: '手机号授权已失效，请重新授权',
        retryable: true,
      },
    })
    assert.deepEqual(await handler({ action: 'bindWechatPhone', code: 'PHONE_PERMISSION_REQUIRED' }), {
      ok: false,
      error: {
        code: 'PHONE_PERMISSION_REQUIRED',
        message: '手机号能力尚未开通，请联系管理员',
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
