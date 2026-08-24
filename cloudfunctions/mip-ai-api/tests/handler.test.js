'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { createHandler } = require('../domain/handler')

test('health checks persistence without resolving a user or provider', async () => {
  const handler = createHandler({
    async health() {
      return { service: 'mip-ai-api', persistence: 'cloudbase-mysql' }
    },
    async resolveCaller() { throw new Error('unexpected caller') },
    service: {},
  })
  assert.deepEqual(await handler({ action: 'health' }), {
    ok: true,
    data: { service: 'mip-ai-api', persistence: 'cloudbase-mysql' },
  })
})
