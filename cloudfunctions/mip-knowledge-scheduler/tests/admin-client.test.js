'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createAdminClient, parseInvocationResult } = require('../lib/admin-client')
const {
  verifyKnowledgeSchedulerRequest,
} = require('../../mip-admin-api/lib/knowledge-scheduler-auth')

const APP_ID = 'wx0123456789abcdef'
const SECRET = 'scheduler-admin-client-secret-at-least-32-bytes'

describe('knowledge scheduler admin invocation', () => {
  it('uses synchronous SCF invocation with the dedicated strict admin HMAC', async () => {
    const calls = []
    const client = createAdminClient({
      config: {
        adminFunctionName: 'mip-admin-api',
        namespace: 'mip-test-env',
        secret: SECRET,
      },
      now: () => Date.parse('2030-08-25T10:00:00.000Z'),
      scf: {
        async InvokeFunction(input) {
          calls.push(input)
          return { Result: { RetCode: 0, RetMsg: JSON.stringify({
            ok: true,
            data: { nextWakeAt: '2030-08-25T10:05:00.000Z' },
          }) } }
        },
      },
    })
    const plan = await client.getWakePlan(APP_ID)
    assert.equal(plan.nextWakeAt, '2030-08-25T10:05:00.000Z')
    assert.equal(calls[0].LogType, 'None')
    assert.equal('InvocationType' in calls[0], false)
    assert.equal('ClientContext' in calls[0], false)
    const request = JSON.parse(calls[0].Event)
    assert.equal(verifyKnowledgeSchedulerRequest(request, {
      secret: SECRET,
      allowedAppIds: new Set([APP_ID]),
      now: () => request.timestamp,
    }).action, 'getKnowledgeIngestionWakePlan')

    await client.runDue(APP_ID, 2)
    const runRequest = JSON.parse(calls[1].Event)
    const trustedRun = verifyKnowledgeSchedulerRequest(runRequest, {
      secret: SECRET,
      allowedAppIds: new Set([APP_ID]),
      now: () => runRequest.timestamp,
    })
    assert.equal(trustedRun.action, 'runDueKnowledgeIngestionSchedules')
    assert.equal(trustedRun.limit, 2)
  })

  it('rejects uncertain function responses', () => {
    assert.throws(
      () => parseInvocationResult({ Result: { RetCode: 1, RetMsg: '' } }),
      /ADMIN_FUNCTION_INVOCATION_FAILED/,
    )
    assert.throws(
      () => parseInvocationResult({ Result: { InvokeResult: 1, ErrMsg: 'runtime error' } }),
      /ADMIN_FUNCTION_INVOCATION_FAILED/,
    )
    assert.throws(
      () => parseInvocationResult({ Result: { RetCode: 0, RetMsg: 'not-json' } }),
      /ADMIN_FUNCTION_RESPONSE_INVALID/,
    )
  })
})
