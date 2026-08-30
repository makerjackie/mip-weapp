'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  assertWechatSuccess,
  buildCustomerServiceRequest,
  buildServiceAccountRequest,
  createServiceAccountSender,
  createWechatOpenapiSender,
  parseServiceAccountConfig,
} = require('../lib/channel-adapters')

const task = {
  taskId: '30000000-0000-4000-8000-000000000001',
  app_id: 'wx-app',
  recipient_user_id: '10000000-0000-4000-8000-000000000001',
  target_route: '/packages/member/mip-events/detail/index?eventId=40000000-0000-4000-8000-000000000001',
}

test('classifies WeChat acknowledgements without retrying an unknown result', () => {
  assert.doesNotThrow(() => assertWechatSuccess({ errCode: 0 }))
  assert.throws(() => assertWechatSuccess({ errcode: -1 }), /WECHAT_PROVIDER_BUSY/)
  assert.throws(() => assertWechatSuccess({ errCode: 45009 }), /WECHAT_DELIVERY_REJECTED/)
  assert.throws(() => assertWechatSuccess({}), /DELIVERY_OUTCOME_UNKNOWN/)
  assert.throws(() => assertWechatSuccess({ errCode: '' }), /DELIVERY_OUTCOME_UNKNOWN/)
})

test('bounds WeChat OpenAPI calls and classifies a timeout as outcome unknown', async () => {
  let captured
  const sender = createWechatOpenapiSender(async (request) => {
    captured = request
    return { errCode: 0 }
  }, { timeoutMs: 50 })
  await sender({ touser: 'openid-private' })
  assert.deepEqual(captured, { touser: 'openid-private' })

  const timedOut = createWechatOpenapiSender(
    () => new Promise(() => {}),
    { timeoutMs: 5 },
  )
  await assert.rejects(() => timedOut({ touser: 'openid-private' }), {
    message: 'DELIVERY_OUTCOME_UNKNOWN',
  })
})

test('builds customer-service text without exposing an internal user id', () => {
  assert.deepEqual(buildCustomerServiceRequest({
    ...task,
    template_key: 'CUSTOMER_SERVICE_TEXT',
    payload_json: JSON.stringify({ fields: { content: '你收到了一条新消息，请在小程序内查看。' } }),
  }, 'openid-private'), {
    touser: 'openid-private',
    msgtype: 'text',
    text: { content: '你收到了一条新消息，请在小程序内查看。' },
  })
})

test('builds a service-account adapter request with a stable idempotency key', () => {
  const config = parseServiceAccountConfig(JSON.stringify({
    endpoint: 'https://notify.example.com/mip',
    templates: { EVENT_NOTICE: 'provider-event-template' },
  }))
  const request = buildServiceAccountRequest(config, {
    ...task,
    template_key: 'EVENT_NOTICE',
    payload_json: JSON.stringify({ fields: { title: '活动通知', status: '活动信息已更新' } }),
  })
  assert.equal(request.idempotencyKey, task.taskId)
  assert.equal(request.templateId, 'provider-event-template')
  assert.equal(request.page.startsWith('packages/'), true)
})

test('signs service-account adapter calls and reports only a stable error code', async () => {
  const config = parseServiceAccountConfig(JSON.stringify({
    endpoint: 'https://notify.example.com/mip',
    templates: { EVENT_NOTICE: 'provider-event-template' },
  }))
  let captured
  const sender = createServiceAccountSender({
    config,
    secret: 'service-account-adapter-secret-longer-than-32-bytes',
    clock: () => Date.parse('2026-08-24T00:00:00.000Z'),
    async fetchImpl(endpoint, options) {
      captured = { endpoint, options }
      return { ok: true, status: 200 }
    },
  })
  await sender({ ...task, idempotencyKey: task.taskId })
  assert.equal(captured.endpoint, 'https://notify.example.com/mip')
  assert.equal(captured.options.headers['x-mip-timestamp'], '1787529600')
  assert.match(captured.options.headers['x-mip-signature'], /^sha256=[a-f0-9]{64}$/)
  assert.equal(captured.options.headers['x-mip-idempotency-key'], task.taskId)

  const failed = createServiceAccountSender({
    config,
    secret: 'service-account-adapter-secret-longer-than-32-bytes',
    async fetchImpl() { return { ok: false, status: 400 } },
  })
  await assert.rejects(() => failed({ ...task, idempotencyKey: task.taskId }), {
    message: 'SERVICE_ACCOUNT_DELIVERY_REJECTED',
  })

  const rateLimited = createServiceAccountSender({
    config,
    secret: 'service-account-adapter-secret-longer-than-32-bytes',
    async fetchImpl() { return { ok: false, status: 429 } },
  })
  await assert.rejects(() => rateLimited({ ...task, idempotencyKey: task.taskId }), {
    message: 'SERVICE_ACCOUNT_RATE_LIMITED',
  })

  const uncertain = createServiceAccountSender({
    config,
    secret: 'service-account-adapter-secret-longer-than-32-bytes',
    async fetchImpl() { throw new Error('socket closed') },
  })
  await assert.rejects(() => uncertain({ ...task, idempotencyKey: task.taskId }), {
    message: 'DELIVERY_OUTCOME_UNKNOWN',
  })

  const malformed = createServiceAccountSender({
    config,
    secret: 'service-account-adapter-secret-longer-than-32-bytes',
    async fetchImpl() { return { ok: true } },
  })
  await assert.rejects(() => malformed({ ...task, idempotencyKey: task.taskId }), {
    message: 'DELIVERY_OUTCOME_UNKNOWN',
  })
})

test('rejects non-HTTPS service-account endpoints', () => {
  assert.throws(() => parseServiceAccountConfig(JSON.stringify({
    endpoint: 'http://notify.example.com/mip',
    templates: { EVENT_NOTICE: 'provider-event-template' },
  })), /SERVICE_ACCOUNT_ADAPTER_CONFIG_INVALID/)
})
