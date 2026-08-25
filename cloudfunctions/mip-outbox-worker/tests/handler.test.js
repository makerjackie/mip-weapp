'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { createHandler } = require('../domain/handler')

test('probes authenticated downstream dependencies without running the outbox batch', async () => {
  let batches = 0
  const handler = createHandler({
    health: async () => ({}),
    probeDependencies: async input => ({
      growthAuthenticated: input.appId === 'wx-app',
      notificationAuthenticated: true,
    }),
    service: {
      async runBatch() {
        batches += 1
        return {}
      },
    },
    verifyInternal: event => ({ appId: event.appId }),
  })

  assert.deepEqual(await handler({ action: 'probeDependencies', appId: 'wx-app' }), {
    ok: true,
    data: {
      growthAuthenticated: true,
      notificationAuthenticated: true,
    },
  })
  assert.equal(batches, 0)
})
