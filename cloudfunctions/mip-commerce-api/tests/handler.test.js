'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const { createHandler } = require('../domain/handler')

test('rejects unknown and prototype commerce actions before resolving caller', async () => {
  let contextReads = 0
  let callerResolutions = 0
  const handler = createHandler({
    getContext() {
      contextReads += 1
      return {}
    },
    resolveCaller() {
      callerResolutions += 1
      return { appId: 'wx-commerce', identityKey: 'trusted-identity' }
    },
    service: {},
  })

  for (const action of ['unknownAction', 'toString', 'constructor', '__proto__']) {
    assert.deepEqual(await handler({ action }), {
      ok: false,
      error: { code: 'NOT_FOUND', message: '未找到相关记录' },
    })
  }
  assert.equal(contextReads, 0)
  assert.equal(callerResolutions, 0)
})

test('dispatches only an own commerce service action with trusted caller context', async () => {
  const caller = { appId: 'wx-commerce', identityKey: 'trusted-identity' }
  const event = { action: 'listPlans', appId: 'forged-app' }
  const handler = createHandler({
    getContext: () => ({ APPID: caller.appId }),
    resolveCaller: () => caller,
    service: {
      async listPlans(receivedCaller, receivedEvent) {
        assert.equal(receivedCaller, caller)
        assert.equal(receivedEvent, event)
        return []
      },
    },
  })

  assert.deepEqual(await handler(event), { ok: true, data: [] })
})
