'use strict'

const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { describe, it } = require('node:test')
const { createAdminAccess } = require('../domain/access')
const { CAPABILITIES } = require('../domain/capabilities')
const { createAdminMemberships } = require('../domain/memberships')
const { errorResponse } = require('../domain/handler')
const { encodeCursor } = require('../domain/pagination')

const APP_ID = 'wx-membership-app'
const ACTOR_ID = '10000000-0000-4000-8000-000000000001'
const USER_ID = '20000000-0000-4000-8000-000000000002'
const caller = {
  appId: APP_ID,
  identityKey: 'trusted-wechat-identity',
  roles: [{ roleKey: 'PLATFORM_OWNER', scopeType: 'PLATFORM', scopeId: null }],
}

function repository(overrides = {}) {
  const repo = {
    calls: [],
    roleBindings: [{ roleKey: 'PLATFORM_OPERATIONS', scopeType: 'PLATFORM', scopeId: null }],
    async resolveUser(received) {
      repo.calls.push({ type: 'resolveUser', received })
      return {
        id: ACTOR_ID,
        status: 'ACTIVE',
        agreementsAccepted: true,
        phoneBound: true,
        profileComplete: true,
      }
    },
    async listRoleBindings(appId, userId) {
      repo.calls.push({ type: 'listRoleBindings', appId, userId })
      return repo.roleBindings
    },
    async getMembership(input) {
      repo.calls.push({ type: 'getMembership', input })
      return { user: { id: input.userId }, chainVersion: 4 }
    },
    async grantMembership(input) {
      repo.calls.push({ type: 'grantMembership', input })
      return {
        adjustmentId: '30000000-0000-4000-8000-000000000003',
        resultChainVersion: input.expectedChainVersion + 1,
        startsAt: '2030-01-31T00:00:00.000Z',
        endsAt: '2030-02-28T00:00:00.000Z',
        idempotent: false,
      }
    },
    ...overrides,
  }
  return repo
}

function memberships(repo) {
  return createAdminMemberships({
    repository: repo,
    access: createAdminAccess({ repository: repo }),
  })
}

function grantInput(overrides = {}) {
  return {
    userId: USER_ID,
    durationMonths: 1,
    reason: '人工核验通过',
    expectedChainVersion: 7,
    idempotencyKey: 'membership-grant-request-1',
    ...overrides,
  }
}

describe('admin membership service', () => {
  it('keeps the membership query and mutation surface', () => {
    assert.deepEqual(Object.keys(createAdminMemberships({ repository: {}, access: {} })).sort(), [
      'getMembership',
      'grantMembership',
      'listMembershipTimeline',
    ])
  })

  it('lists a normalized, platform-scoped timeline with cursor pagination', async () => {
    const repo = repository({
      async listMembershipTimeline(input) {
        repo.calls.push({ type: 'listMembershipTimeline', input })
        return { items: [], nextCursor: null }
      },
    })
    await memberships(repo).listMembershipTimeline(caller, {
      filters: {
        userId: USER_ID.toUpperCase(),
        userQuery: '  玩家 42  ',
        status: 'ACTIVE',
        sourceType: 'ORDER',
        createdFrom: '2030-01-01T00:00:00.000Z',
        createdTo: '2030-01-31T23:59:59.999Z',
      },
      limit: 20,
      cursor: encodeCursor({ createdAt: '2030-02-01T00:00:00.000Z', id: USER_ID }),
    })
    assert.deepEqual(repo.calls.at(-1), {
      type: 'listMembershipTimeline',
      input: {
        appId: APP_ID,
        userId: USER_ID,
        userQuery: '玩家 42',
        status: 'ACTIVE',
        sourceType: 'ORDER',
        createdFrom: '2030-01-01 00:00:00.000',
        createdTo: '2030-01-31 23:59:59.999',
        pageLimit: 20,
        cursor: { v: 1, createdAt: '2030-02-01T00:00:00.000Z', id: USER_ID },
      },
    })
  })

  it('rejects invalid timeline filters before repository access', async () => {
    for (const filters of [
      { userId: 'user-a' },
      { userQuery: 'a'.repeat(65) },
      { unexpected: true },
      { status: 'UNKNOWN' },
      { sourceType: 'UNKNOWN' },
      { createdFrom: '2030-02-01', createdTo: '2030-01-01' },
    ]) {
      const repo = repository({ listMembershipTimeline: async () => ({ items: [], nextCursor: null }) })
      await assert.rejects(
        () => memberships(repo).listMembershipTimeline(caller, { filters }),
        error => error?.code === 'VALIDATION_FAILED',
      )
      assert.equal(repo.calls.some(call => call.type === 'listMembershipTimeline'), false)
    }
  })

  it('reloads server identity and grants a platform-scoped membership read', async () => {
    const repo = repository()
    const result = await memberships(repo).getMembership(caller, { userId: USER_ID.toUpperCase() })

    assert.equal(result.chainVersion, 4)
    assert.deepEqual(repo.calls.map(call => call.type), [
      'resolveUser',
      'listRoleBindings',
      'getMembership',
    ])
    assert.deepEqual(repo.calls.at(-1).input, { appId: APP_ID, userId: USER_ID })
  })

  it('defaults both capabilities only to platform owner and platform operations', async () => {
    for (const roleKey of ['PLATFORM_OWNER', 'PLATFORM_OPERATIONS']) {
      const repo = repository({
        roleBindings: [{ roleKey, scopeType: 'PLATFORM', scopeId: null }],
      })
      await memberships(repo).getMembership(caller, { userId: USER_ID })
      await memberships(repo).grantMembership(caller, grantInput())
    }

    for (const binding of [
      { roleKey: 'PLATFORM_FINANCE', scopeType: 'PLATFORM', scopeId: null },
      { roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: 'branch-a' },
      { roleKey: 'EVENT_OWNER', scopeType: 'EVENT', scopeId: 'event-a' },
    ]) {
      const repo = repository({ roleBindings: [binding] })
      await assert.rejects(
        () => memberships(repo).getMembership(caller, { userId: USER_ID }),
        error => error?.code === 'FORBIDDEN',
      )
      assert.equal(repo.calls.some(call => call.type === 'getMembership'), false)
    }
  })

  it('honors a reduced configurable policy independently for read and adjust', async () => {
    const repo = repository({
      roleBindings: [{
        roleKey: 'PLATFORM_OPERATIONS',
        scopeType: 'PLATFORM',
        scopeId: null,
        capabilities: [CAPABILITIES.MEMBERSHIPS_READ],
      }],
    })
    const service = memberships(repo)
    await service.getMembership(caller, { userId: USER_ID })
    await assert.rejects(
      () => service.grantMembership(caller, grantInput()),
      error => error?.code === 'FORBIDDEN',
    )
    assert.equal(repo.calls.some(call => call.type === 'grantMembership'), false)
  })

  it('normalizes the exact grant input and derives server-owned hash, authorization, and safe audit', async () => {
    const repo = repository()
    const service = memberships(repo)
    await service.grantMembership(caller, grantInput({
      reason: '  人工核验通过  ',
      idempotencyKey: '  membership-grant-request-1  ',
    }))
    const call = repo.calls.find(item => item.type === 'grantMembership').input

    assert.equal(call.reason, '人工核验通过')
    assert.equal(call.idempotencyKey, 'membership-grant-request-1')
    assert.match(call.requestHash, /^[0-9a-f]{64}$/)
    assert.equal(call.requestHash, createHash('sha256').update(JSON.stringify([
      APP_ID,
      ACTOR_ID,
      USER_ID,
      1,
      '人工核验通过',
      7,
    ])).digest('hex'))
    assert.deepEqual(call.authorization, {
      capability: CAPABILITIES.MEMBERSHIPS_ADJUST,
      effectiveGrant: {
        roleKey: 'PLATFORM_OPERATIONS',
        scopeType: 'PLATFORM',
        scopeId: null,
      },
    })
    const audit = call.audit('30000000-0000-4000-8000-000000000003', {
      startsAt: '2030-01-31T00:00:00.000Z',
      endsAt: '2030-02-28T00:00:00.000Z',
      resultChainVersion: 8,
    })
    assert.equal(audit.appId, APP_ID)
    assert.equal(audit.actorUserId, ACTOR_ID)
    assert.equal(audit.effectiveRole, 'PLATFORM_OPERATIONS')
    assert.deepEqual(audit.metadata, {
      userId: USER_ID,
      durationMonths: 1,
      reasonLength: 6,
      startsAt: '2030-01-31T00:00:00.000Z',
      endsAt: '2030-02-28T00:00:00.000Z',
      expectedChainVersion: 7,
      resultChainVersion: 8,
    })
    assert.doesNotMatch(JSON.stringify(audit), /人工核验通过/)

    await service.grantMembership(caller, grantInput({ reason: '另一项调整原因' }))
    const hashes = repo.calls
      .filter(item => item.type === 'grantMembership')
      .map(item => item.input.requestHash)
    assert.notEqual(hashes[0], hashes[1])
  })

  it('rejects extra fields, loose identifiers, invalid durations, versions, reasons, and keys', async () => {
    const cases = [
      { ...grantInput(), roleKey: 'PLATFORM_OWNER' },
      grantInput({ userId: 'user-a' }),
      grantInput({ userId: '20000000-0000-8000-8000-000000000002' }),
      grantInput({ durationMonths: 2 }),
      grantInput({ expectedChainVersion: '7' }),
      grantInput({ reason: '   ' }),
      grantInput({ reason: 'a'.repeat(301) }),
      grantInput({ idempotencyKey: 'unsafe key' }),
      grantInput({ idempotencyKey: 'a'.repeat(129) }),
    ]
    for (const input of cases) {
      const repo = repository()
      await assert.rejects(
        () => memberships(repo).grantMembership(caller, input),
        error => error?.code === 'VALIDATION_FAILED',
      )
      assert.equal(repo.calls.some(call => call.type === 'grantMembership'), false)
    }
  })

  it('maps stale membership versions to the neutral retryable error envelope', () => {
    assert.deepEqual(errorResponse(Object.assign(new Error('VERSION_CONFLICT'), {
      code: 'VERSION_CONFLICT',
    })), {
      ok: false,
      error: {
        code: 'VERSION_CONFLICT',
        message: '会员状态已变化，请刷新后重试',
        retryable: true,
      },
    })
  })
})
