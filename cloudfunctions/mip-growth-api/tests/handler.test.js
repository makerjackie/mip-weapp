'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { createHandler } = require('../domain/handler')

test('health checks persistence without resolving a user', async () => {
  let healthCalls = 0
  const handler = createHandler({
    async health() {
      healthCalls += 1
      return { service: 'mip-growth-api', persistence: 'cloudbase-mysql' }
    },
    async resolveCaller() { throw new Error('unexpected caller') },
    service: {},
  })
  assert.deepEqual(await handler({ action: 'health' }), {
    ok: true,
    data: { service: 'mip-growth-api', persistence: 'cloudbase-mysql' },
  })
  assert.equal(healthCalls, 1)
})

test('routes an authenticated check-in transition to the compensation service', async () => {
  const transition = { appId: 'wx-app', transitionId: '10000000-0000-4000-8000-000000000001' }
  const handler = createHandler({
    verifyInternal: event => ({ appId: event.appId, transitionId: event.transitionId }),
    service: {
      applyCheckInTransition: async input => ({ ...input, status: 'APPLIED' }),
    },
  })
  assert.deepEqual(await handler({ action: 'applyCheckInTransition', ...transition }), {
    ok: true,
    data: { ...transition, status: 'APPLIED' },
  })
})
