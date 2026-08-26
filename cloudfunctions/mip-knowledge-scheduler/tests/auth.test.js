'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  ACTIVATE_ACTION,
  ACTIVATE_PROTOCOL,
  RECONCILE_ACTION,
  RECONCILE_PROTOCOL,
  createSchedulerActivation,
  createTimerMessage,
  parseTimerEvent,
  signSchedulerReconcile,
  verifySchedulerActivation,
  verifySchedulerReconcile,
  verifyTimerMessage,
} = require('../lib/auth')

const SECRET = 'scheduler-auth-test-secret-at-least-32-bytes'
const APP_ID = 'wx0123456789abcdef'
const config = Object.freeze({
  allowedAppIds: new Set([APP_ID]),
  namespace: 'mip-test-env',
  functionName: 'mip-knowledge-scheduler',
  triggerName: 'mip-knowledge-ingestion-next',
  sourceFunction: 'mip-admin-api',
  secret: SECRET,
})

describe('knowledge scheduler authentication', () => {
  it('domain-separates and strictly validates admin reconciliation', () => {
    const request = {
      action: RECONCILE_ACTION,
      protocol: RECONCILE_PROTOCOL,
      appId: APP_ID,
      sourceFunction: 'mip-admin-api',
      nonce: '1234567890abcdef12345678',
      timestamp: Date.parse('2030-08-25T10:00:00.000Z'),
    }
    const signed = { ...request, signature: signSchedulerReconcile(request, SECRET) }
    assert.deepEqual(verifySchedulerReconcile(signed, {
      ...config,
      now: () => request.timestamp,
    }), request)
    assert.deepEqual(verifySchedulerReconcile({
      ...signed,
      frameworkContext: { requestId: 'framework-injected' },
      tcbContext: {},
      userInfo: { appId: 'framework-injected', openId: 'framework-injected' },
    }, {
      ...config,
      now: () => request.timestamp,
    }), request)
    for (const metadata of [
      { frameworkContext: null },
      { tcbContext: [] },
      { userInfo: 'untrusted' },
    ]) {
      assert.throws(
        () => verifySchedulerReconcile({ ...signed, ...metadata }, {
          ...config, now: () => request.timestamp,
        }),
        /FORBIDDEN/,
      )
    }
    assert.throws(
      () => verifySchedulerReconcile({ ...signed, extra: true }, {
        ...config, now: () => request.timestamp,
      }),
      /FORBIDDEN/,
    )
    assert.throws(
      () => verifySchedulerReconcile({ ...signed, appId: 'wxaaaaaaaaaaaaaaaa' }, {
        ...config, now: () => request.timestamp,
      }),
      /FORBIDDEN/,
    )
  })

  it('authenticates every fixed timer field and the outer SCF event', () => {
    const message = createTimerMessage({
      namespace: config.namespace,
      functionName: config.functionName,
      triggerName: config.triggerName,
      fireAt: '2030-08-25T10:05:00.000Z',
      generation: '1234567890abcdef1234567890abcdef',
      activationGeneration: 'abcdefabcdefabcdefabcdefabcdefab',
      purpose: 'DISPATCH',
    }, SECRET)
    assert.deepEqual(verifyTimerMessage(message, config), {
      protocol: message.protocol,
      namespace: config.namespace,
      function: config.functionName,
      trigger: config.triggerName,
      fireAt: '2030-08-25T10:05:00.000Z',
      generation: '1234567890abcdef1234567890abcdef',
      activationGeneration: 'abcdefabcdefabcdefabcdefabcdefab',
      purpose: 'DISPATCH',
    })
    assert.equal(parseTimerEvent({
      Type: 'Timer',
      TriggerName: config.triggerName,
      Time: message.fireAt,
      Message: JSON.stringify(message),
    }, config).message.generation, message.generation)
    assert.throws(() => verifyTimerMessage({ ...message, fireAt: '2030-08-25T10:05:01.000Z' }, config), /FORBIDDEN/)
    assert.throws(() => verifyTimerMessage({ ...message, extra: true }, config), /FORBIDDEN/)
    assert.throws(() => createTimerMessage({
      namespace: config.namespace,
      functionName: config.functionName,
      triggerName: config.triggerName,
      fireAt: '2100-01-01T00:00:00.000Z',
      generation: message.generation,
      activationGeneration: message.activationGeneration,
      purpose: 'DISPATCH',
    }, SECRET), /FORBIDDEN/)
  })

  it('domain-separates canary activation and binds it to one function and generation', () => {
    const request = createSchedulerActivation({
      namespace: config.namespace,
      functionName: config.functionName,
      triggerName: config.triggerName,
      sourceFunction: config.sourceFunction,
      generation: '1234567890abcdef1234567890abcdef',
      nonce: '1234567890abcdef12345678',
      timestamp: Date.parse('2030-08-25T10:00:00.000Z'),
    }, SECRET)
    assert.equal(request.action, ACTIVATE_ACTION)
    assert.equal(request.protocol, ACTIVATE_PROTOCOL)
    assert.equal(verifySchedulerActivation(request, {
      ...config,
      now: () => request.timestamp,
    }).generation, request.generation)
    assert.throws(() => verifySchedulerActivation({
      ...request,
      generation: 'abcdefabcdefabcdefabcdefabcdefab',
    }, {
      ...config,
      now: () => request.timestamp,
    }), /FORBIDDEN/)
    assert.throws(() => verifySchedulerReconcile(request, {
      ...config,
      now: () => request.timestamp,
    }), /FORBIDDEN/)
  })
})
