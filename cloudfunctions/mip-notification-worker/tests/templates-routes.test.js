'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { buildTarget } = require('../domain/routes')
const { normalizeMessage } = require('../domain/validation')
const { buildWechatRequest, parseTemplateConfig } = require('../lib/templates')

test('builds only trusted in-app target routes', () => {
  assert.equal(
    buildTarget('OPPORTUNITY', '10000000-0000-4000-8000-000000000001').route,
    '/packages/member/mip-opportunities/detail/index?id=10000000-0000-4000-8000-000000000001',
  )
  assert.throws(() => buildTarget('EXTERNAL_URL', '10000000-0000-4000-8000-000000000001'), /INBOX_TARGET_INVALID/)
  const profileRef = `p1.${'a'.repeat(16)}.${'b'.repeat(48)}.${'c'.repeat(22)}`
  assert.equal(
    buildTarget('PROFILE', profileRef).route,
    `/packages/member/mip-public-profile/index?profileRef=${profileRef}`,
  )
  assert.throws(() => buildTarget('PROFILE', '10000000-0000-4000-8000-000000000001'), /INBOX_TARGET_INVALID/)
})

test('normalizes an inbox message before any external delivery is scheduled', () => {
  const message = normalizeMessage({
    recipientUserId: '10000000-0000-4000-8000-000000000001',
    messageType: 'EVENT',
    title: ' 活动提醒 ',
    body: ' 活动将在明天开始。 ',
    targetType: 'EVENT',
    targetId: '20000000-0000-4000-8000-000000000001',
    dedupeKey: 'event:reminder:1',
    external: {
      channel: 'WECHAT_SUBSCRIPTION',
      templateKey: 'EVENT_REMINDER',
      fields: { title: '城市活动', startsAt: '明天 10:00' },
    },
  })
  assert.equal(message.title, '活动提醒')
  assert.equal(message.target.route, '/packages/member/mip-events/detail/index?eventId=20000000-0000-4000-8000-000000000001')
})

test('maps logical fields through server template configuration', () => {
  const config = parseTemplateConfig(JSON.stringify({
    EVENT_REMINDER: {
      templateId: 'template-id',
      fields: { title: 'thing1', startsAt: 'time2', location: 'thing3' },
    },
  })).EVENT_REMINDER
  const request = buildWechatRequest(config, {
    payload_json: JSON.stringify({
      fields: { title: '城市活动', startsAt: '2026-08-25 10:00', location: '广州活动中心' },
    }),
    target_route: '/packages/member/mip-events/detail/index?eventId=20000000-0000-4000-8000-000000000001',
  }, 'openid-private', { miniprogramState: 'trial' })
  assert.deepEqual(request.data, {
    thing1: { value: '城市活动' },
    time2: { value: '2026-08-25 10:00' },
    thing3: { value: '广州活动中心' },
  })
  assert.equal(request.page.startsWith('packages/'), true)
})

test('rejects template mappings outside the EVENT_REMINDER logical field contract', () => {
  assert.throws(() => parseTemplateConfig(JSON.stringify({
    EVENT_REMINDER: {
      templateId: 'template-id',
      fields: { title: 'thing1', attackerField: 'thing2' },
    },
  })), /NOTIFICATION_TEMPLATE_CONFIG_INVALID/)
})
