'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  buildCustomerServiceRequest,
  buildServiceAccountRequest,
  createServiceAccountSender,
  parseServiceAccountConfig,
} = require('../lib/channel-adapters')

const task = {
  taskId: '30000000-0000-4000-8000-000000000001',
  app_id: 'wx-app',
  recipient_user_id: '10000000-0000-4000-8000-000000000001',
  target_route: '/packages/member/mip-events/detail/index?eventId=40000000-0000-4000-8000-000000000001',
}

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
      return { ok: true }
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
    async fetchImpl() { return { ok: false } },
  })
  await assert.rejects(() => failed({ ...task, idempotencyKey: task.taskId }), {
    message: 'WECHAT_SERVICE_ACCOUNT_FAILED',
  })
})

test('rejects non-HTTPS service-account endpoints', () => {
  assert.throws(() => parseServiceAccountConfig(JSON.stringify({
    endpoint: 'http://notify.example.com/mip',
    templates: { EVENT_NOTICE: 'provider-event-template' },
  })), /SERVICE_ACCOUNT_ADAPTER_CONFIG_INVALID/)
})
