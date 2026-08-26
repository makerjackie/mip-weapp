'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createAdminAccess } = require('../domain/access')
const { createAdminPaymentAttempts } = require('../domain/payment-attempts')

const APP_ID = 'wx-mip'
const BRANCH_ID = 'branch-a'
const caller = { appId: APP_ID, identityKey: 'identity-key' }

function repository(overrides = {}) {
  const audits = []
  const repo = {
    audits,
    roleBindings: [{ roleKey: 'PLATFORM_FINANCE', scopeType: 'PLATFORM', scopeId: null }],
    listReads: 0,
    async resolveUser() {
      return { id: 'admin-user', status: 'ACTIVE', agreementsAccepted: true, phoneBound: true, profileComplete: true }
    },
    async listRoleBindings() { return repo.roleBindings },
    async listPaymentAttempts() {
      repo.listReads += 1
      return { items: [], nextCursor: null }
    },
    async recordAudit(value) { audits.push(value) },
    ...overrides,
  }
  return repo
}

function service(repo) {
  return createAdminPaymentAttempts({ repository: repo, access: createAdminAccess({ repository: repo }) })
}

describe('admin payment attempts service', () => {
  it('requires orders.read, passes AppID and order visibility, and records a read audit', async () => {
    let captured
    const repo = repository({
      roleBindings: [{ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: BRANCH_ID }],
      async listPaymentAttempts(...args) {
        repo.listReads += 1
        captured = args
        return { items: [], nextCursor: null }
      },
    })
    await service(repo).listPaymentAttempts(caller, {
      filters: { query: '12', provider: 'wechat_pay', status: 'failed' },
      limit: 100,
    })
    assert.equal(captured[0], APP_ID)
    assert.deepEqual(captured[1], { platform: false, branchIds: [BRANCH_ID], eventIds: [] })
    assert.deepEqual(captured[2], {
      query: '12', provider: 'WECHAT_PAY', status: 'FAILED', createdFrom: '', createdTo: '',
    })
    assert.equal(captured[3], 100)
    assert.equal(repo.audits.at(-1).action, 'admin.paymentAttempts.view')

    repo.roleBindings = [{ roleKey: 'EVENT_STAFF', scopeType: 'EVENT', scopeId: 'event-a' }]
    await assert.rejects(() => service(repo).listPaymentAttempts(caller), error => error?.code === 'FORBIDDEN')
    assert.equal(repo.listReads, 1)
  })

  it('rejects invalid date ranges and unsupported page sizes before reading persistence', async () => {
    const repo = repository()
    await assert.rejects(
      () => service(repo).listPaymentAttempts(caller, {
        filters: { createdFrom: '2030-02-02T00:00:00Z', createdTo: '2030-02-01T00:00:00Z' },
      }),
      error => error?.code === 'VALIDATION_FAILED',
    )
    await assert.rejects(
      () => service(repo).listPaymentAttempts(caller, { limit: 25 }),
      error => error?.code === 'VALIDATION_FAILED',
    )
    assert.equal(repo.listReads, 0)
  })
})
