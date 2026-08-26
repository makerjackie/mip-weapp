'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { describe, it } = require('node:test')
const {
  DEFAULT_RECONCILE_TIMEOUT_MS,
  MAX_RECONCILE_TIMEOUT_MS,
  boundedTimeout,
  createMessageSchedulerClient,
} = require('../lib/message-scheduler-client')
const {
  verifySchedulerReconcile,
} = require('../../mip-message-scheduler/lib/auth')

const root = path.resolve(__dirname, '../../..')
const APP_ID = 'wx0123456789abcdef'
const SECRET = 'admin-scheduler-client-test-secret-at-least-32-bytes'
const NOW = Date.parse('2030-08-25T10:00:00.000Z')

describe('admin message scheduler handoff', () => {
  it('synchronously verifies the post-commit reconcile with a separated HMAC domain', async () => {
    const calls = []
    const verifiedRequests = []
    const client = createMessageSchedulerClient({
      cloud: {
        async callFunction(input) {
          calls.push(input)
          verifiedRequests.push(verifySchedulerReconcile({
            ...input.data,
            frameworkContext: { requestId: 'framework-injected' },
            tcbContext: {},
            userInfo: { appId: 'framework-injected', openId: 'framework-injected' },
          }, {
            allowedAppIds: new Set([APP_ID]),
            sourceFunction: 'mip-admin-api',
            secret: SECRET,
            now: () => NOW,
          }))
          return { result: { ok: true, data: { verified: true } } }
        },
      },
      functionName: 'mip-message-scheduler',
      sourceFunction: 'mip-admin-api',
      secret: SECRET,
      now: () => NOW,
    })
    const result = await client.afterSuccessfulMutation({
      action: 'mip.admin.messageCampaigns.schedule',
      appId: APP_ID,
      mutationActions: new Set(['mip.admin.messageCampaigns.schedule']),
    })
    assert.deepEqual(result, { status: 'VERIFIED' })
    assert.equal(calls.length, 1)
    const unsignedCall = { ...calls[0].data }
    delete unsignedCall.signature
    assert.deepEqual(verifiedRequests, [unsignedCall])
    assert.equal('frameworkContext' in verifiedRequests[0], false)
    assert.equal('tcbContext' in verifiedRequests[0], false)
    assert.equal('userInfo' in verifiedRequests[0], false)
  })

  it('returns an unverified state for missing config, timeout, or negative readback', async () => {
    const unconfigured = createMessageSchedulerClient({})
    assert.deepEqual(await unconfigured.afterSuccessfulMutation({
      action: 'schedule', appId: APP_ID, mutationActions: new Set(['schedule']),
    }), { status: 'FAILED' })

    const rejected = createMessageSchedulerClient({
      cloud: { async callFunction() { return { result: { ok: false } } } },
      functionName: 'mip-message-scheduler',
      sourceFunction: 'mip-admin-api',
      secret: SECRET,
    })
    assert.deepEqual(await rejected.afterSuccessfulMutation({
      action: 'schedule', appId: APP_ID, mutationActions: new Set(['schedule']),
    }), { status: 'FAILED' })

    assert.equal(boundedTimeout(undefined), DEFAULT_RECONCILE_TIMEOUT_MS)
    assert.equal(boundedTimeout(MAX_RECONCILE_TIMEOUT_MS), MAX_RECONCILE_TIMEOUT_MS)
    let attempts = 0
    const timed = createMessageSchedulerClient({
      cloud: {
        async callFunction() {
          attempts += 1
          return attempts === 1
            ? new Promise(resolve => setTimeout(
              () => resolve({ result: { ok: true, data: { verified: true } } }),
              500,
            ))
            : { result: { ok: true, data: { verified: true } } }
        },
      },
      functionName: 'mip-message-scheduler',
      sourceFunction: 'mip-admin-api',
      secret: SECRET,
      timeoutMs: 250,
    })
    const input = { action: 'schedule', appId: APP_ID, mutationActions: new Set(['schedule']) }
    assert.deepEqual(await timed.afterSuccessfulMutation(input), { status: 'FAILED' })
    assert.deepEqual(await timed.afterSuccessfulMutation(input), { status: 'VERIFIED' })
  })

  it('keeps schedule and cancel retries on the post-handler path', () => {
    const source = fs.readFileSync(path.join(root, 'cloudfunctions/mip-admin-api/index.js'), 'utf8')
    assert.match(source, /postCommitAutomationFor\(routeAction, result\.data\)/)
    assert.match(source, /if \(routeAutomation\.requiresTrustedAppId\)/)
    assert.match(source, /MESSAGE_SCHEDULE_AUTOMATION_UNVERIFIED/)
    assert.match(source, /retryable: true/)
    assert.ok(source.indexOf('const result = await handler(event)')
      < source.indexOf('messageSchedulerClient.afterSuccessfulMutation'))
  })
})
