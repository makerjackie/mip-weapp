'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createOperationDispatcher, operationRegistry } = require('../domain/operation-registry')
const { createAdminService } = require('../domain/service')
const { createOwnerModules } = require('./owner-modules-test-helper')

const caller = { appId: 'wx1111111111111111', identityKey: 'trusted-identity' }
const user = {
  id: '11111111-1111-4111-8111-111111111111',
  status: 'ACTIVE',
  agreementsAccepted: true,
  phoneBound: true,
  profileComplete: true,
}
const platform = roleKey => ({ roleKey, scopeType: 'PLATFORM', scopeId: null })

function repository(bindings) {
  const calls = { reads: [], audits: [] }
  return {
    calls,
    async resolveUser() { return user },
    async listRoleBindings() { return bindings },
    async listOperationalExceptions(appId, request) {
      calls.reads.push({ appId, request })
      return [{
        id: 'PAYMENT:22222222-2222-4222-8222-222222222222',
        source: 'PAYMENT',
        status: 'FAILED',
        title: '支付处理失败',
        summary: '一笔支付未完成处理。',
        occurredAt: '2026-08-24T12:00:00.000Z',
        target: null,
      }]
    },
    async recordAudit(value) { calls.audits.push(value) },
  }
}

describe('operational exception service', () => {
  it('requires the platform capability, applies filters and audits every successful view', async () => {
    const store = repository([platform('PLATFORM_OPERATIONS')])
    const service = createAdminService({ repository: store })
    const result = await service.listOperationalExceptions(caller, {
      type: 'PAYMENT',
      status: 'FAILED',
      limit: 25,
    })

    assert.deepEqual(result.availableTypes, ['OUTBOX', 'REFUND', 'PAYMENT', 'MEDIA', 'DELIVERY', 'AI'])
    assert.equal(result.nextCursor, null)
    assert.equal(store.calls.reads.length, 1)
    assert.equal(store.calls.reads[0].appId, caller.appId)
    assert.deepEqual(store.calls.reads[0].request.types, ['PAYMENT'])
    assert.deepEqual(store.calls.reads[0].request.statuses, ['FAILED'])
    assert.equal(store.calls.audits.length, 1)
    assert.deepEqual(store.calls.audits[0], {
      appId: caller.appId,
      actorUserId: user.id,
      scopeType: 'PLATFORM',
      scopeId: null,
      action: 'admin.operational_exceptions.view',
      resourceType: 'OPERATIONAL_EXCEPTION_LIST',
      resourceId: null,
      effectiveRole: 'PLATFORM_OPERATIONS',
      metadata: { count: 1, type: 'PAYMENT', status: 'FAILED', limit: 25 },
    })
  })

  it('limits finance to payment and refund while excluding event roles from the endpoint', async () => {
    const financeStore = repository([platform('PLATFORM_FINANCE')])
    const finance = createAdminService({ repository: financeStore })
    const page = await finance.listOperationalExceptions(caller, {})
    assert.deepEqual(page.availableTypes, ['REFUND', 'PAYMENT'])
    assert.deepEqual(financeStore.calls.reads[0].request.types, ['REFUND', 'PAYMENT'])
    await assert.rejects(
      finance.listOperationalExceptions(caller, { type: 'MEDIA' }),
      error => error.code === 'FORBIDDEN',
    )

    const eventStore = repository([{
      roleKey: 'EVENT_OWNER',
      scopeType: 'EVENT',
      scopeId: '33333333-3333-4333-8333-333333333333',
    }])
    const event = createAdminService({ repository: eventStore })
    await assert.rejects(
      event.listOperationalExceptions(caller, {}),
      error => error.code === 'FORBIDDEN',
    )
    assert.equal(eventStore.calls.reads.length, 0)
  })

  it('dispatches a read-only handler action and exposes no mutation action', async () => {
    let received = null
    const result = (await createOperationDispatcher(createOwnerModules({
      async listOperationalExceptions(receivedCaller, event) {
        received = { receivedCaller, event }
        return { items: [], nextCursor: null, availableTypes: [] }
      },
    })).execute(caller, 'mip.admin.exceptions.list', { type: 'PAYMENT' })).data
    assert.deepEqual(result, { items: [], nextCursor: null, availableTypes: [] })
    assert.deepEqual(received, { receivedCaller: caller, event: { type: 'PAYMENT' } })
    assert.equal(operationRegistry.operationCatalog.some(operation => operation.action.startsWith('mip.admin.exceptions.')
      && operation.action !== 'mip.admin.exceptions.list'), false)
  })
})
