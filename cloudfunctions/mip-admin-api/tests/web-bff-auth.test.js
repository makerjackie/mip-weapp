'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  WEB_BFF_FIRST_QUERY_ACTIONS,
  WEB_BFF_QUERY_ACTIONS,
  WEB_BFF_TRANSPORT,
  createQueryActionAllowlist,
  createWebBffRoute,
  signWebBffEnvelope,
} = require('../lib/web-bff-auth')
const { publicOperationContract } = require('../domain/public-operation-contract')

const SECRET = 'web-bff-test-secret-that-is-at-least-thirty-two-bytes'
const NOW = Date.UTC(2030, 0, 1)

function envelope(action = 'mip.admin.dashboard.overview.get') {
  return signWebBffEnvelope({
    transport: WEB_BFF_TRANSPORT,
    timestamp: NOW,
    nonce: '0123456789abcdefghijklmn',
    principal: { appId: 'wx-mip-app', openId: 'openid-admin' },
    request: { contractVersion: 1, action, input: {} },
  }, SECRET)
}

function fixture() {
  const calls = []
  const issuedContexts = []
  const route = createWebBffRoute({
    application: {
      async execute(principal, action, input) {
        calls.push({ principal, action, input })
        return { action }
      },
    },
    issuePrincipal(context) {
      issuedContexts.push(context)
      return Object.freeze({ trusted: true, appId: context.APPID, openId: context.OPENID })
    },
    secret: SECRET,
    now: () => NOW,
  })
  return { calls, issuedContexts, route }
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

    assert.deepEqual(WEB_BFF_FIRST_QUERY_ACTIONS, expected)
    assert.deepEqual([...WEB_BFF_QUERY_ACTIONS], expected)
    for (const action of WEB_BFF_QUERY_ACTIONS) {
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

  it('issues a fresh trusted principal for every allowed signed query', async () => {
    const { calls, issuedContexts, route } = fixture()
    for (const action of WEB_BFF_QUERY_ACTIONS) {
      const result = await route(envelope(action))
      assert.equal(result.ok, true, action)
    }

    assert.equal(calls.length, WEB_BFF_QUERY_ACTIONS.size)
    assert.equal(issuedContexts.length, WEB_BFF_QUERY_ACTIONS.size)
    assert.deepEqual(
      calls.map(call => call.action),
      [...WEB_BFF_QUERY_ACTIONS],
    )
    for (const call of calls) {
      assert.deepEqual(call.principal, {
        trusted: true,
        appId: 'wx-mip-app',
        openId: 'openid-admin',
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

  it('rejects expired envelopes, unknown actions, and every contract mutation', async () => {
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
      assert.equal(mutationResult.error.code, 'FORBIDDEN', operation.action)
    }
    assert.equal(calls.length, 0)
  })

  it('fails closed when the shared BFF secret is not configured', async () => {
    const calls = []
    const route = createWebBffRoute({
      application: { execute: async () => calls.push('executed') },
      issuePrincipal: () => calls.push('issued'),
      secret: '',
      now: () => NOW,
    })

    const result = await route(envelope())

    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'SERVICE_UNAVAILABLE')
    assert.equal(calls.length, 0)
  })
})
