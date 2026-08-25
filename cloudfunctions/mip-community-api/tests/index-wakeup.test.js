'use strict'

const assert = require('node:assert/strict')
const Module = require('node:module')
const { describe, it } = require('node:test')

function loadHandlerFactory() {
  const indexPath = require.resolve('../index')
  delete require.cache[indexPath]
  const originalLoad = Module._load
  Module._load = function load(request, parent, isMain) {
    if (request === 'wx-server-sdk') {
      return {
        DYNAMIC_CURRENT_ENV: 'test',
        getWXContext: () => ({ APPID: 'wx-app', OPENID: 'openid-1' }),
        init: () => {},
        openapi: {},
      }
    }
    if (parent?.filename === indexPath && request === './domain/service') {
      return { createCommunityService: () => ({}) }
    }
    if (parent?.filename === indexPath && request === './lib/identity') {
      return {
        assertInteractionReady: async () => {},
        configuredAgreementRequirements: () => [],
        resolveActiveUser: async () => ({}),
        trustedWechatIdentity: () => ({}),
      }
    }
    if (parent?.filename === indexPath && request === './lib/mysql') {
      return { mysqlDatabase: () => ({}) }
    }
    if (parent?.filename === indexPath && request === './lib/outbox-wakeup') {
      return { createOutboxWakeup: () => ({ afterSuccessfulMutation: async () => ({ status: 'SKIPPED' }) }) }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    return require(indexPath)._test.createHandler
  }
  finally {
    Module._load = originalLoad
  }
}

function createHarness(options = {}) {
  const createHandler = loadHandlerFactory()
  const calls = []
  const warnings = []
  const result = options.result || {
    id: '00000000-0000-4000-8000-000000000003',
    status: 'PUBLISHED',
    version: 1,
  }
  const handler = createHandler({
    agreementRequirements: [],
    assertReady: async () => {},
    database: {},
    getContext: () => ({ APPID: 'wx-app', OPENID: 'openid-1' }),
    logger: { warn: (...args) => warnings.push(args) },
    outboxWakeup: {
      async afterSuccessfulMutation(input) {
        calls.push({ kind: 'wakeup', input })
        if (options.wakeupError) throw options.wakeupError
        return { status: 'INVOKED' }
      },
    },
    resolveIdentity: context => context,
    resolveUser: async () => ({ appId: 'wx-app', userId: 'user-1' }),
    service: {
      async createKnowledgeComment() {
        calls.push({ kind: 'mutation' })
        return result
      },
      async saveEventComment() {
        calls.push({ kind: 'mutation' })
        return result
      },
    },
  })
  return { calls, handler, result, warnings }
}

describe('community handler outbox wakeup', () => {
  it('wakes the worker only after an AUTO event comment is published', async () => {
    const harness = createHarness()

    assert.deepEqual(await harness.handler({ action: 'saveEventComment', eventId: 'event-1' }), {
      ok: true,
      data: harness.result,
    })
    assert.deepEqual(harness.calls.map(call => call.kind), ['mutation', 'wakeup'])
    assert.equal(harness.calls[1].input.action, 'saveEventComment')
    assert.equal(harness.calls[1].input.appId, 'wx-app')
    assert.equal(harness.calls[1].input.mutationActions.has('saveEventComment'), true)
  })

  it('wakes the worker after an AUTO knowledge comment is published', async () => {
    const harness = createHarness()

    assert.deepEqual(await harness.handler({
      action: 'createKnowledgeComment',
      contentId: 'knowledge-1',
    }), {
      ok: true,
      data: harness.result,
    })
    assert.deepEqual(harness.calls.map(call => call.kind), ['mutation', 'wakeup'])
    assert.equal(harness.calls[1].input.action, 'createKnowledgeComment')
    assert.equal(harness.calls[1].input.mutationActions.has('createKnowledgeComment'), true)
  })

  it('does not wake for REVIEW pending creation or published edits', async () => {
    const pending = createHarness({
      result: {
        id: '00000000-0000-4000-8000-000000000004',
        status: 'PENDING',
        version: 1,
      },
    })
    assert.equal((await pending.handler({ action: 'saveEventComment', eventId: 'event-1' })).ok, true)
    assert.deepEqual(pending.calls.map(call => call.kind), ['mutation'])

    const edit = createHarness()
    assert.equal((await edit.handler({
      action: 'saveEventComment',
      commentId: '00000000-0000-4000-8000-000000000003',
      eventId: 'event-1',
    })).ok, true)
    assert.deepEqual(edit.calls.map(call => call.kind), ['mutation'])
  })

  it('keeps a committed AUTO comment successful when wakeup throws', async () => {
    const harness = createHarness({ wakeupError: new Error('secret internal detail') })

    assert.deepEqual(await harness.handler({ action: 'saveEventComment', eventId: 'event-1' }), {
      ok: true,
      data: harness.result,
    })
    assert.deepEqual(harness.calls.map(call => call.kind), ['mutation', 'wakeup'])
    assert.deepEqual(harness.warnings[0], ['[mip-community-api]', {
      event: 'outbox_wakeup_failed',
      sourceAction: 'saveEventComment',
      code: 'INTERNAL_FUNCTION_FAILED',
    }])
    assert.doesNotMatch(JSON.stringify(harness.warnings), /secret internal detail/)
  })
})
