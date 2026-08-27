'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  WEB_BFF_FIRST_QUERY_ACTIONS,
  WEB_BFF_MUTATION_ACTIONS,
  WEB_BFF_QUERY_ACTIONS,
  WEB_BFF_REVIEWED_MUTATION_MANIFEST,
  WEB_BFF_TRANSPORT,
  createQueryActionAllowlist,
  createReviewedMutationActionAllowlist,
  createWebBffRoute,
  signWebBffEnvelope,
} = require('../lib/web-bff-auth')
const { publicOperationContract } = require('../domain/public-operation-contract')

const SECRET = 'web-bff-test-secret-that-is-at-least-thirty-two-bytes'
const NOW = Date.UTC(2030, 0, 1)

function envelope(action = 'mip.admin.dashboard.overview.get', request = {}) {
  return signWebBffEnvelope({
    transport: WEB_BFF_TRANSPORT,
    timestamp: NOW,
    nonce: '0123456789abcdefghijklmn',
    principal: { appId: 'wx-mip-app', openId: 'openid-admin' },
    request: { contractVersion: 1, action, input: {}, ...request },
  }, SECRET)
}

function fixture() {
  const calls = []
  const issuedContexts = []
  const replayed = []
  const route = createWebBffRoute({
    application: {
      async execute(principal, action, input) {
        calls.push({ principal, action, input })
        return { action }
      },
    },
    issuePrincipal(context) {
      issuedContexts.push(context)
      return Object.freeze({
        trusted: true,
        appId: context.APPID,
        openId: context.OPENID,
        identityKey: 'a'.repeat(64),
      })
    },
    replayGuard: { consume: async input => replayed.push(input) },
    afterSuccessfulMutation: async () => null,
    secret: SECRET,
    now: () => NOW,
  })
  return { calls, issuedContexts, replayed, route }
}

describe('Web BFF trusted query adapter', () => {
  it('derives the exact first query allowlist from the generated operation contract', () => {
    const expected = [
      'mip.admin.session',
      'mip.admin.dashboard.overview.get',
      'mip.admin.users.list',
      'mip.admin.events.list',
      'mip.admin.orders.list',
      'mip.admin.branches.list',
      'mip.admin.roles.list',
      'mip.admin.rolePolicies.list',
      'mip.admin.audit.list',
      'mip.admin.messageCampaigns.list',
      'mip.admin.messageTemplates.list',
      'mip.admin.knowledge.list',
    ]
    const operationByAction = new Map(
      publicOperationContract.operations.map(operation => [operation.action, operation]),
    )
    const firstQueryAllowlist = createQueryActionAllowlist(
      WEB_BFF_FIRST_QUERY_ACTIONS,
      publicOperationContract,
    )

    assert.deepEqual(WEB_BFF_FIRST_QUERY_ACTIONS, expected)
    assert.deepEqual([...firstQueryAllowlist], expected)
    for (const action of firstQueryAllowlist) {
      assert.deepEqual(operationByAction.get(action), {
        action,
        kind: 'QUERY',
        authentication: 'REQUIRED',
        session: 'REQUIRED',
        safeToRetry: true,
        idempotencyKeyRequired: null,
      })
    }
  })

  it('fails closed when an allowlisted action is absent or becomes a mutation', () => {
    assert.throws(
      () => createQueryActionAllowlist(['mip.admin.missing'], publicOperationContract),
      /WEB_BFF_QUERY_CONTRACT_INVALID/,
    )
    assert.throws(
      () => createQueryActionAllowlist(['mip.admin.users.update'], publicOperationContract),
      /WEB_BFF_QUERY_CONTRACT_INVALID/,
    )
  })

  it('derives an exact reviewed mutation manifest and rejects metadata drift', () => {
    assert.equal(WEB_BFF_REVIEWED_MUTATION_MANIFEST.length, 59)
    assert.deepEqual(
      [...WEB_BFF_MUTATION_ACTIONS],
      WEB_BFF_REVIEWED_MUTATION_MANIFEST.map(item => item.action),
    )
    for (const key of ['kind', 'authentication', 'session', 'safeToRetry', 'idempotencyKeyRequired']) {
      const drifted = WEB_BFF_REVIEWED_MUTATION_MANIFEST.map(item => ({ ...item }))
      drifted[0][key] = key === 'kind'
        ? 'QUERY'
        : key === 'safeToRetry' || key === 'idempotencyKeyRequired'
          ? !drifted[0][key]
          : 'OPTIONAL'
      assert.throws(
        () => createReviewedMutationActionAllowlist(drifted, publicOperationContract),
        /WEB_BFF_MUTATION_CONTRACT_INVALID/,
        key,
      )
    }
    const contractDrift = {
      ...publicOperationContract,
      operations: publicOperationContract.operations.map(operation => operation.action === 'mip.admin.events.clone'
        ? { ...operation, safeToRetry: true }
        : operation),
    }
    assert.throws(
      () => createReviewedMutationActionAllowlist(WEB_BFF_REVIEWED_MUTATION_MANIFEST, contractDrift),
      /WEB_BFF_MUTATION_CONTRACT_INVALID/,
    )
    const invalidForwardPolicy = WEB_BFF_REVIEWED_MUTATION_MANIFEST.map(item => ({ ...item }))
    invalidForwardPolicy[0].forwardIdempotencyKey = 'yes'
    assert.throws(
      () => createReviewedMutationActionAllowlist(invalidForwardPolicy, publicOperationContract),
      /WEB_BFF_MUTATION_CONTRACT_INVALID/,
    )
  })

  it('issues a fresh trusted principal for every allowed signed query', async () => {
    const { calls, issuedContexts, replayed, route } = fixture()
    for (const action of WEB_BFF_QUERY_ACTIONS) {
      const result = await route(envelope(action))
      assert.equal(result.ok, true, action)
    }

    assert.equal(calls.length, WEB_BFF_QUERY_ACTIONS.size)
    assert.equal(issuedContexts.length, WEB_BFF_QUERY_ACTIONS.size)
    assert.equal(replayed.length, WEB_BFF_QUERY_ACTIONS.size)
    assert.deepEqual(
      calls.map(call => call.action),
      [...WEB_BFF_QUERY_ACTIONS],
    )
    for (const call of calls) {
      assert.deepEqual(call.principal, {
        trusted: true,
        appId: 'wx-mip-app',
        openId: 'openid-admin',
        identityKey: 'a'.repeat(64),
      })
      assert.deepEqual(call.input, {})
    }
  })

  it('rejects a browser-forged principal before issuing it', async () => {
    const { calls, route } = fixture()
    const forged = envelope()
    forged.principal.openId = 'attacker'

    const result = await route(forged)

    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'AUTH_REQUIRED')
    assert.equal(calls.length, 0)
  })

  it('rejects expired envelopes, unknown actions, unreviewed mutations, and missing mutation keys', async () => {
    const { calls, route } = fixture()
    const expired = signWebBffEnvelope({ ...envelope(), timestamp: NOW - 60_001 }, SECRET)

    const expiredResult = await route(expired)
    const unknownResult = await route(envelope('mip.admin.missing'))

    assert.equal(expiredResult.ok, false)
    assert.equal(expiredResult.error.code, 'AUTH_REQUIRED')
    assert.equal(unknownResult.ok, false)
    assert.equal(unknownResult.error.code, 'FORBIDDEN')
    for (const operation of publicOperationContract.operations.filter(item => item.kind === 'MUTATION')) {
      const mutationResult = await route(envelope(operation.action))
      assert.equal(mutationResult.ok, false, operation.action)
      assert.equal(
        mutationResult.error.code,
        WEB_BFF_MUTATION_ACTIONS.has(operation.action) ? 'VALIDATION_FAILED' : 'FORBIDDEN',
        operation.action,
      )
    }
    assert.equal(calls.length, 0)
  })

  it('requires a non-empty business idempotency key for each reviewed mutation', async () => {
    const { calls, route } = fixture()
    for (const action of WEB_BFF_MUTATION_ACTIONS) {
      for (const idempotencyKey of ['', '  ', 'bad key', 'x'.repeat(129), 42]) {
        const result = await route(envelope(action, { idempotencyKey }))
        assert.equal(result.ok, false, `${action}:${String(idempotencyKey)}`)
        assert.equal(result.error.code, 'VALIDATION_FAILED', `${action}:${String(idempotencyKey)}`)
      }
    }
    assert.equal(calls.length, 0)
  })

  it('rejects browser-controlled fields outside each reviewed business input', async () => {
    const { calls, route } = fixture()
    const cases = [
      ['mip.admin.memberships.grant', { userId: 'user-a', forgedDurationMonths: 120 }],
      ['mip.admin.events.clone', { sourceEventId: 'event-a', expectedVersion: 1, title: '客户端标题' }],
      ['mip.admin.events.changeStatus', { eventId: 'event-a', expectedVersion: 1, status: 'PUBLISHED', forged: true }],
      ['mip.admin.events.archive', { eventId: 'event-a', expectedVersion: 1, reason: '归档', forged: true }],
      ['mip.admin.communications.publishEventReminder', {
        eventId: 'event-a', expectedVersion: 1, sendWechatReminder: false, recipientUserIds: ['forged-user'],
      }],
      ['mip.admin.refunds.submit', { orderId: 'order-a', reason: '运营退款', amountCents: 1 }],
    ]
    for (const [action, input] of cases) {
      const result = await route(envelope(action, { idempotencyKey: 'web-input-check-0001', input }))
      assert.equal(result.ok, false, action)
      assert.equal(result.error.code, 'VALIDATION_FAILED', action)
    }
    assert.equal(calls.length, 0)
  })

  it('accepts reviewed optional fields and rejects unknown fields for all reviewed mutations', async () => {
    const accepted = fixture()
    for (const mutation of WEB_BFF_REVIEWED_MUTATION_MANIFEST) {
      const input = Object.fromEntries(
        [...mutation.requiredInputKeys, ...mutation.optionalInputKeys].map(key => [key, `fixture-${key}`]),
      )
      const result = await accepted.route(envelope(mutation.action, {
        idempotencyKey: `web-structural-${mutation.action.split('.').pop()}`,
        input,
      }))
      assert.equal(result.ok, true, mutation.action)
    }
    assert.equal(accepted.calls.length, 59)

    const rejected = fixture()
    for (const mutation of WEB_BFF_REVIEWED_MUTATION_MANIFEST) {
      const input = Object.fromEntries(
        mutation.requiredInputKeys.map(key => [key, `fixture-${key}`]),
      )
      input.browserControlledField = true
      const result = await rejected.route(envelope(mutation.action, {
        idempotencyKey: `web-unknown-${mutation.action.split('.').pop()}`,
        input,
      }))
      assert.equal(result.ok, false, mutation.action)
      assert.equal(result.error.code, 'VALIDATION_FAILED', mutation.action)
    }
    assert.equal(rejected.calls.length, 0)
  })

  it('forwards transport idempotency only to domain-idempotent mutations', async () => {
    const { calls, route } = fixture()
    for (const mutation of WEB_BFF_REVIEWED_MUTATION_MANIFEST) {
      const input = Object.fromEntries(
        mutation.requiredInputKeys.map(key => [key, `fixture-${key}`]),
      )
      const result = await route(envelope(mutation.action, {
        idempotencyKey: 'web-forward-policy-0001',
        input,
      }))
      assert.equal(result.ok, true, mutation.action)
    }

    assert.equal(calls.length, 59)
    for (let index = 0; index < WEB_BFF_REVIEWED_MUTATION_MANIFEST.length; index += 1) {
      const mutation = WEB_BFF_REVIEWED_MUTATION_MANIFEST[index]
      assert.equal(
        Object.hasOwn(calls[index].input, 'idempotencyKey'),
        mutation.forwardIdempotencyKey,
        mutation.action,
      )
    }
    assert.deepEqual(
      WEB_BFF_REVIEWED_MUTATION_MANIFEST
        .filter(item => item.forwardIdempotencyKey)
        .map(item => item.action),
      [
        'mip.admin.memberships.grant',
        'mip.admin.events.clone',
        'mip.admin.events.changeStatus',
        'mip.admin.events.archive',
        'mip.admin.communications.publishEventReminder',
        'mip.admin.refunds.submit',
        'mip.admin.messageCampaigns.schedule',
        'mip.admin.messageCampaigns.cancelSchedule',
        'mip.admin.messageCampaigns.publish',
        'mip.admin.knowledge.schedules.save',
        'mip.admin.growth.adjust',
        'mip.admin.tasks.save',
        'mip.admin.tasks.publish',
        'mip.admin.tasks.unpublish',
        'mip.admin.tasks.delete',
        'mip.admin.tasks.assignMembers',
        'mip.admin.tasks.revokeMembers',
      ],
    )
  })

  it('does not leak an optional query transport key into query input', async () => {
    const { calls, route } = fixture()
    const result = await route(envelope('mip.admin.dashboard.overview.get', {
      idempotencyKey: 'unused-query-key',
    }))

    assert.equal(result.ok, true)
    assert.deepEqual(calls[0].input, {})
  })

  it('consumes the replay guard and runs post-commit automation for reviewed mutations', async () => {
    const calls = []
    const replayed = []
    const route = createWebBffRoute({
      application: {
        async execute(principal, action, input) {
          calls.push({ principal, action, input })
          return { action, idempotent: false }
        },
      },
      issuePrincipal: context => ({
        appId: context.APPID,
        openId: context.OPENID,
        identityKey: 'a'.repeat(64),
      }),
      replayGuard: { consume: async input => replayed.push(input) },
      afterSuccessfulMutation: async input => {
        calls.push({ postCommit: input.action, appId: input.principal.appId })
        return null
      },
      secret: SECRET,
      now: () => NOW,
    })
    const result = await route(envelope('mip.admin.events.clone', {
      idempotencyKey: 'web-clone-0001',
      input: { sourceEventId: 'event-a', expectedVersion: 1 },
    }))

    assert.equal(result.ok, true)
    assert.equal(replayed.length, 1)
    assert.deepEqual(calls[0].input, {
      sourceEventId: 'event-a',
      expectedVersion: 1,
      idempotencyKey: 'web-clone-0001',
    })
    assert.deepEqual(calls[1], {
      postCommit: 'mip.admin.events.clone',
      appId: 'wx-mip-app',
    })
  })

  it('consumes the signed nonce before dispatch and fails closed on replay storage errors', async () => {
    const calls = []
    const base = {
      application: { execute: async () => calls.push('executed') },
      issuePrincipal: () => ({ identityKey: 'a'.repeat(64) }),
      afterSuccessfulMutation: async () => null,
      secret: SECRET,
      now: () => NOW,
    }
    const replayed = createWebBffRoute({
      ...base,
      replayGuard: { consume: async () => { throw new Error('WEB_BFF_REPLAYED') } },
    })
    const unavailable = createWebBffRoute({
      ...base,
      replayGuard: { consume: async () => { throw new Error('WEB_BFF_REPLAY_GUARD_UNAVAILABLE') } },
    })

    const replayedResult = await replayed(envelope())
    const unavailableResult = await unavailable(envelope())

    assert.equal(replayedResult.ok, false)
    assert.equal(replayedResult.error.code, 'AUTH_REQUIRED')
    assert.equal(unavailableResult.ok, false)
    assert.deepEqual(unavailableResult.error, {
      code: 'SERVICE_UNAVAILABLE',
      message: '运营服务暂时不可用',
      retryable: true,
    })
    assert.deepEqual(calls, [])
  })

  it('fails closed when the shared BFF secret is not configured', async () => {
    const calls = []
    const route = createWebBffRoute({
      application: { execute: async () => calls.push('executed') },
      issuePrincipal: () => ({ identityKey: 'a'.repeat(64) }),
      replayGuard: { consume: async () => calls.push('consumed') },
      afterSuccessfulMutation: async () => null,
      secret: '',
      now: () => NOW,
    })

    const result = await route(envelope())

    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'SERVICE_UNAVAILABLE')
    assert.equal(calls.length, 0)
  })
})
