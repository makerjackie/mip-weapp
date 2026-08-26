'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  RUN_DUE_ACTION,
  signKnowledgeSchedulerRequest,
  verifyKnowledgeSchedulerRequest,
} = require('../lib/knowledge-scheduler-auth')
const { createKnowledgeSchedulerClient } = require('../lib/knowledge-scheduler-client')
const { createKnowledgeSchedulerRoute } = require('../lib/knowledge-scheduler-route')
const {
  verifySchedulerReconcile,
} = require('../../mip-knowledge-scheduler/lib/auth')

const APP_ID = 'wx0123456789abcdef'
const SECRET = 'knowledge-scheduler-contract-secret-at-least-32-bytes'
const NOW = Date.parse('2030-08-25T10:00:00.000Z')

function signedRun(overrides = {}) {
  const request = {
    action: RUN_DUE_ACTION,
    appId: APP_ID,
    limit: 3,
    nonce: '1234567890abcdef12345678',
    timestamp: NOW,
    ...overrides,
  }
  request.signature = signKnowledgeSchedulerRequest(request, SECRET)
  return request
}

describe('knowledge scheduler internal contract', () => {
  it('binds exact action fields, AppID, nonce, timestamp, and dedicated secret', () => {
    assert.equal(verifyKnowledgeSchedulerRequest(signedRun(), {
      allowedAppIds: new Set([APP_ID]),
      now: () => NOW,
      secret: SECRET,
    }).limit, 3)
    assert.throws(() => verifyKnowledgeSchedulerRequest({ ...signedRun(), extra: true }, {
      allowedAppIds: new Set([APP_ID]), now: () => NOW, secret: SECRET,
    }), /FORBIDDEN/)
    assert.throws(() => verifyKnowledgeSchedulerRequest(signedRun(), {
      allowedAppIds: new Set([APP_ID]), now: () => NOW, secret: `${SECRET}-wrong`,
    }), /FORBIDDEN/)
  })

  it('routes only verified internal work and returns a neutral service envelope', async () => {
    const calls = []
    const route = createKnowledgeSchedulerRoute({
      allowedAppIds: new Set([APP_ID]),
      now: () => NOW,
      secret: SECRET,
      service: {
        async getWakePlan() { return { nextWakeAt: null } },
        async runDue(input) { calls.push(input); return { claimed: 0 } },
      },
    })
    assert.deepEqual(await route(signedRun()), { ok: true, data: { claimed: 0 } })
    assert.deepEqual(calls, [{ appId: APP_ID, limit: 3 }])
    assert.equal((await route({ action: RUN_DUE_ACTION })).error.code, 'FORBIDDEN')
  })

  it('uses a separate post-commit reconcile request for plan mutations', async () => {
    const calls = []
    const verifiedRequests = []
    const client = createKnowledgeSchedulerClient({
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
            now: () => NOW,
            secret: SECRET,
            sourceFunction: 'mip-admin-api',
          }))
          return { result: { ok: true, data: { verified: true } } }
        },
      },
      functionName: 'mip-knowledge-scheduler',
      now: () => NOW,
      secret: SECRET,
      sourceFunction: 'mip-admin-api',
    })
    assert.deepEqual(await client.reconcile({
      action: 'mip.admin.knowledge.schedules.save',
      appId: APP_ID,
      mutationActions: new Set(['mip.admin.knowledge.schedules.save']),
    }), { status: 'VERIFIED' })
    const unsignedCall = { ...calls[0].data }
    delete unsignedCall.signature
    assert.deepEqual(verifiedRequests, [unsignedCall])
    assert.equal('frameworkContext' in verifiedRequests[0], false)
    assert.equal('tcbContext' in verifiedRequests[0], false)
    assert.equal('userInfo' in verifiedRequests[0], false)
  })
})
