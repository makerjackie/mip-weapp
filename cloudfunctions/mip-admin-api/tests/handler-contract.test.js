'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { describe, it } = require('node:test')
const { createAdminApplication } = require('../domain/application')
const { actions, createHandler, normalizeAdminRequest } = require('../domain/handler')
const { createTrustedPrincipalIssuer } = require('../lib/identity')

describe('admin handler and isolation contract', () => {
  it('normalizes v1 requests without mixing route and business fields', () => {
    const event = {
      contractVersion: 1,
      action: 'mip.admin.opportunityComments.moderate',
      input: {
        opportunityId: 'opportunity-a',
        commentId: 'comment-a',
        expectedVersion: 3,
        action: 'PUBLISH',
        reason: '内容符合要求',
      },
      idempotencyKey: 'moderate-comment-request-a',
    }

    assert.deepEqual(normalizeAdminRequest(event), {
      action: 'mip.admin.opportunityComments.moderate',
      input: {
        opportunityId: 'opportunity-a',
        commentId: 'comment-a',
        expectedVersion: 3,
        action: 'PUBLISH',
        reason: '内容符合要求',
        idempotencyKey: 'moderate-comment-request-a',
      },
    })
    assert.equal(Object.hasOwn(event.input, 'idempotencyKey'), false)
  })

  it('removes CloudBase transport metadata without trusting it as caller identity', async () => {
    let issuedContext
    const handler = createHandler({
      application: {
        execute: async (_principal, action, input) => ({ action, input }),
        probe: async () => ({ status: 'ok' }),
      },
      getContext: () => ({ APPID: 'trusted-app-id', OPENID: 'trusted-open-id' }),
      issuePrincipal: (context) => {
        issuedContext = context
        return { appId: context.APPID, actorUserId: 'user-a' }
      },
    })
    const response = await handler({
      contractVersion: 1,
      action: 'mip.admin.session',
      input: {},
      tcbContext: {},
      userInfo: { appId: 'untrusted-app-id', openId: 'untrusted-open-id' },
    })

    assert.equal(response.ok, true)
    assert.deepEqual(issuedContext, { APPID: 'trusted-app-id', OPENID: 'trusted-open-id' })
    assert.deepEqual(response.data, { action: 'mip.admin.session', input: {} })
  })

  it('passes only normalized v1 input to the business dispatch', async () => {
    let received
    const handler = createHandler({
      getContext: () => ({ APPID: 'wx', OPENID: 'openid' }),
      resolveCaller: () => ({ appId: 'wx', identityKey: 'key' }),
      service: {
        async updateUser(_caller, input) {
          received = input
          return { userId: input.userId, version: input.expectedVersion + 1 }
        },
      },
    })
    const response = await handler({
      contractVersion: 1,
      action: 'mip.admin.users.update',
      input: { userId: 'user-a', expectedVersion: 4, fields: { nickname: '示例用户' } },
      idempotencyKey: 'update-user-request-a',
    })

    assert.equal(response.ok, true)
    assert.deepEqual(received, {
      userId: 'user-a',
      expectedVersion: 4,
      fields: { nickname: '示例用户' },
      idempotencyKey: 'update-user-request-a',
    })
  })

  it('keeps the flat legacy request compatible while removing its route action from input', () => {
    const legacy = {
      action: 'mip.admin.users.get',
      userId: 'user-a',
      includePhone: true,
    }
    assert.deepEqual(normalizeAdminRequest(legacy), {
      action: 'mip.admin.users.get',
      input: { userId: 'user-a', includePhone: true },
    })
    assert.deepEqual(legacy, {
      action: 'mip.admin.users.get',
      userId: 'user-a',
      includePhone: true,
    })
  })

  it('repairs the legacy opportunity comment action collision', async () => {
    let received
    const handler = createHandler({
      getContext: () => ({}),
      resolveCaller: () => ({ appId: 'wx', identityKey: 'key' }),
      service: {
        async moderateOpportunityComment(_caller, input) {
          received = input
          return { id: input.commentId, status: input.action, version: input.expectedVersion + 1 }
        },
      },
    })
    const response = await handler({
      action: 'HIDE',
      opportunityId: 'opportunity-a',
      commentId: 'comment-a',
      expectedVersion: 2,
      reason: '内容不符合要求',
    })

    assert.equal(response.ok, true)
    assert.deepEqual(received, {
      action: 'HIDE',
      opportunityId: 'opportunity-a',
      commentId: 'comment-a',
      expectedVersion: 2,
      reason: '内容不符合要求',
    })
  })

  it('uses v1 only for an own contractVersion property', () => {
    const event = Object.create({ contractVersion: 99 })
    event.action = 'mip.admin.session'
    event.sentinel = 'legacy'
    assert.deepEqual(normalizeAdminRequest(event), {
      action: 'mip.admin.session',
      input: { sentinel: 'legacy' },
    })
  })

  it('rejects unsupported versions, extra envelope fields, non-object input, and duplicate idempotency', async () => {
    const handler = createHandler({
      getContext: () => ({}),
      resolveCaller: () => { throw new Error('must not resolve invalid request') },
      service: {},
    })
    const cases = [
      {
        event: { contractVersion: 2, action: 'mip.admin.session', input: {} },
        code: 'CONTRACT_VERSION_UNSUPPORTED',
        message: '管理请求协议版本不受支持',
      },
      {
        event: { contractVersion: 1, action: 'mip.admin.session', input: {}, appId: 'untrusted' },
        code: 'VALIDATION_FAILED',
        message: '运营请求格式无效',
      },
      {
        event: { contractVersion: 1, action: 'mip.admin.session', input: {}, userInfo: 'untrusted' },
        code: 'VALIDATION_FAILED',
        message: '运营请求格式无效',
      },
      {
        event: { contractVersion: 1, action: 'mip.admin.session', input: {}, tcbContext: [] },
        code: 'VALIDATION_FAILED',
        message: '运营请求格式无效',
      },
      {
        event: { contractVersion: 1, action: 'mip.admin.session', input: [] },
        code: 'VALIDATION_FAILED',
        message: '运营请求格式无效',
      },
      {
        event: {
          contractVersion: 1,
          action: 'mip.admin.growth.adjust',
          input: { idempotencyKey: 'nested-request-key' },
          idempotencyKey: 'top-level-request-key',
        },
        code: 'VALIDATION_FAILED',
        message: '运营请求格式无效',
      },
      {
        event: {
          contractVersion: 1,
          action: 'mip.admin.growth.adjust',
          input: {},
          idempotencyKey: 42,
        },
        code: 'VALIDATION_FAILED',
        message: '运营请求格式无效',
      },
    ]

    for (const testCase of cases) {
      const response = await handler(testCase.event)
      assert.deepEqual(response.error, {
        code: testCase.code,
        message: testCase.message,
        retryable: false,
      })
    }
  })

  it('runs the public health probe against MySQL without resolving a user', async () => {
    let resolved = false
    const handler = createHandler({
      getContext: () => ({}),
      resolveCaller: () => { resolved = true; throw new Error('unexpected') },
      service: { health: async () => ({ persistence: 'cloudbase-mysql' }) },
    })
    assert.deepEqual(await handler({ action: 'health' }), {
      ok: true, data: { persistence: 'cloudbase-mysql' },
    })
    assert.equal(resolved, false)
  })

  it('runs the modern health probe without reading context or issuing a principal', async () => {
    let contexts = 0
    let issues = 0
    const application = createAdminApplication({
      assertPrincipal() { throw new Error('unexpected principal check') },
      service: { health: async () => ({ persistence: 'cloudbase-mysql' }) },
    })
    const handler = createHandler({
      application,
      getContext() { contexts += 1; return {} },
      issuePrincipal() { issues += 1; throw new Error('unexpected principal issue') },
    })

    assert.deepEqual(await handler({ action: 'health' }), {
      ok: true, data: { persistence: 'cloudbase-mysql' },
    })
    assert.equal(contexts, 0)
    assert.equal(issues, 0)
  })

  it('keeps all 187 business actions compatible with the handler configuration', async () => {
    const caller = { appId: 'wx', identityKey: 'key' }
    const calls = []
    const service = new Proxy({}, {
      get(target, method) {
        if (!Object.hasOwn(target, method)) {
          target[method] = async (...args) => {
            calls.push({ method, args })
            return { method }
          }
        }
        return target[method]
      },
    })
    const handler = createHandler({
      getContext: () => ({ APPID: 'wx', OPENID: 'openid' }),
      resolveCaller: () => caller,
      service,
    })
    const businessActions = Object.keys(actions).filter(action => action !== 'health')

    assert.equal(businessActions.length, 187)
    for (const action of businessActions) {
      const before = calls.length
      const response = await handler({ contractVersion: 1, action, input: { marker: action } })
      assert.equal(response.ok, true, action)
      assert.ok(calls.length > before, action)
      assert.equal(calls.at(-1).args[0], caller, action)
    }
  })

  it('maps modern application errors through the existing response envelope', async () => {
    const options = {
      allowedAppIds: new Set(['wx']),
      pepper: 'identity-pepper-with-at-least-thirty-two-characters',
    }
    const issuer = createTrustedPrincipalIssuer(options)
    const application = createAdminApplication({
      assertPrincipal: issuer.assert,
      service: {
        async getSession() {
          const error = new Error('CONFLICT')
          error.code = 'CONFLICT'
          throw error
        },
      },
    })
    const handler = createHandler({
      application,
      getContext: () => ({ APPID: 'wx', OPENID: 'openid' }),
      issuePrincipal: issuer.issue,
    })

    assert.deepEqual((await handler({ action: 'mip.admin.session' })).error, {
      code: 'CONFLICT', message: '记录状态已变化，请刷新后重试', retryable: true,
    })
  })

  it('rejects mixed modern and legacy handler dependencies', () => {
    const dependencies = {
      application: { execute() {}, probe() {} },
      getContext: () => ({}),
      issuePrincipal: () => ({}),
      resolveCaller: () => ({}),
      service: {},
    }
    assert.throws(() => createHandler(dependencies), /HANDLER_CONFIG_INVALID/)
  })

  it('keeps the transport handler reusable and maps conflicts to retryable responses', async () => {
    const handler = createHandler({
      getContext: () => ({ FROM_APPID: 'wx', FROM_OPENID: 'openid' }),
      resolveCaller: () => ({ appId: 'wx', identityKey: 'key' }),
      service: {
        async getSession() {
          const error = new Error('CONFLICT')
          error.code = 'CONFLICT'
          throw error
        },
      },
    })
    const response = await handler({ action: 'mip.admin.session' })
    assert.equal(response.ok, false)
    assert.deepEqual(response.error, {
      code: 'CONFLICT', message: '记录状态已变化，请刷新后重试', retryable: true,
    })
  })

  it('returns stable neutral growth configuration conflicts', async () => {
    const cases = [
      ['GROWTH_BASE_LEVEL_REQUIRED', '必须保留一个门槛为 0 的启用基础等级'],
      ['GROWTH_LEVEL_THRESHOLD_CONFLICT', '等级经验门槛已存在'],
      ['GROWTH_RULE_ACTIVE_CONFLICT', '同一来源事件和成长类型只能启用一条规则'],
    ]
    for (const [code, message] of cases) {
      const handler = createHandler({
        getContext: () => ({ FROM_APPID: 'wx', FROM_OPENID: 'openid' }),
        resolveCaller: () => ({ appId: 'wx', identityKey: 'key' }),
        service: {
          async saveGrowthLevel() {
            const error = new Error(code)
            error.code = code
            throw error
          },
        },
      })
      const response = await handler({ action: 'mip.admin.growth.saveLevel' })
      assert.deepEqual(response.error, { code, message, retryable: false })
    }
  })

  it('returns stable event reminder errors without internal details', async () => {
    const handler = createHandler({
      getContext: () => ({ FROM_APPID: 'wx', FROM_OPENID: 'openid' }),
      resolveCaller: () => ({ appId: 'wx', identityKey: 'key' }),
      service: {
        async publishEventReminder() {
          const error = new Error('COMMUNICATIONS_RECIPIENT_LIMIT_EXCEEDED')
          error.code = 'COMMUNICATIONS_RECIPIENT_LIMIT_EXCEEDED'
          throw error
        },
      },
    })
    const response = await handler({ action: 'mip.admin.communications.publishEventReminder' })
    assert.deepEqual(response.error, {
      code: 'COMMUNICATIONS_RECIPIENT_LIMIT_EXCEEDED',
      message: '已确认参与者数量超过单次发送上限',
      retryable: false,
    })
  })

  it('rejects unknown operations without dispatching', async () => {
    const handler = createHandler({
      getContext: () => ({}),
      resolveCaller: () => { throw new Error('should not resolve') },
      service: {},
    })
    const response = await handler({ action: 'mip.admin.deleteEverything' })
    assert.equal(response.ok, false)
    assert.equal(response.error.code, 'NOT_FOUND')
  })

  it('rejects unknown operations in modern mode before reading context or issuing a principal', async () => {
    let touched = false
    const handler = createHandler({
      application: { execute() { touched = true }, probe() { touched = true } },
      getContext() { touched = true },
      issuePrincipal() { touched = true },
    })
    const response = await handler({ action: 'mip.admin.deleteEverything' })
    assert.equal(response.error.code, 'NOT_FOUND')
    assert.equal(touched, false)
  })

  it('references only mip-prefixed SQL facts and never issues physical business deletes', () => {
    const root = path.resolve(__dirname, '..')
    const repositoryFiles = [
      path.join(root, 'domain/repository.js'),
      path.join(root, 'domain/event-comment-governance.js'),
      path.join(root, 'domain/repositories/access.js'),
      path.join(root, 'domain/repositories/events.js'),
      path.join(root, 'domain/repositories/users.js'),
    ]
    const files = [
      ...repositoryFiles,
      path.resolve(root, '../../database/mysql/mip/006_admin.sql'),
    ]
    const source = files.map(file => fs.readFileSync(file, 'utf8')).join('\n')
    assert.doesNotMatch(source, /\b(?:FROM|JOIN|UPDATE|INTO)\s+(?:member|dating|sewing)_\w+/i)
    assert.doesNotMatch(repositoryFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n'), /\bDELETE\s+FROM\b/i)
    assert.match(source, /mip_audit_logs/)
    assert.match(source, /mip_admin_export_tickets/)
  })
})
