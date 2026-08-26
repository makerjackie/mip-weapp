'use strict'

const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { describe, it } = require('node:test')

const { createAdminAccess } = require('../domain/access')
const { CAPABILITIES } = require('../domain/capabilities')
const { createUserInfluenceService } = require('../domain/user-influence')

const caller = { appId: 'wx-app', identityKey: 'wechat-identity' }
const context = {
  caller: { appId: caller.appId, userId: 'admin-user' },
  bindings: [],
  capabilities: [],
}

function influenceFact(overrides = {}) {
  return {
    id: 'heart-a',
    cursorOccurredAt: '2026-08-25 08:30:00.000',
    kind: 'HEART',
    direction: 'INCOMING',
    status: 'ACTIVE',
    occurredAt: '2026-08-25T08:30:00.000Z',
    eventTitle: '城市聚会',
    counterpartNickname: '林然',
    counterpartKind: 'PLAYER',
    counterpartState: 'AVAILABLE',
    sourceType: null,
    ...overrides,
  }
}

describe('admin user influence service', () => {
  it('establishes the admin session before rejecting every malformed exact-key input', async () => {
    const calls = []
    const service = createUserInfluenceService({
      access: {
        async session() { calls.push('session'); return context },
        async userAuthorization() { calls.push('authorization'); throw new Error('unexpected') },
      },
      repository: {
        async listUserInfluence() { calls.push('read'); throw new Error('unexpected') },
      },
    })
    const symbolInput = { userId: 'user-a', kind: 'HEART' }
    symbolInput[Symbol('private')] = true
    const invalidInputs = [
      { userId: 'user-a', kind: 'HEART', phone: '18800000000' },
      { userId: 'user-a', kind: 'UNKNOWN' },
      { userId: 'user-a', kind: 'HEART', direction: undefined },
      { userId: 'user-a', kind: 'HEART', occurredFrom: undefined },
      { userId: 'user-a', kind: 'HEART', limit: '20' },
      symbolInput,
    ]

    for (const input of invalidInputs) {
      calls.length = 0
      await assert.rejects(
        () => service.listUserInfluence(caller, input),
        error => error?.code === 'VALIDATION_FAILED',
      )
      assert.deepEqual(calls, ['session'])
    }
  })

  it('authorizes the target user, returns only public facts, and appends a minimal read audit', async () => {
    const calls = []
    let readArguments
    let audit
    const grant = { roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: 'branch-a' }
    const access = {
      async session(value) {
        calls.push('session')
        assert.equal(value, caller)
        return context
      },
      async userAuthorization(value, userId, capability) {
        calls.push('authorization')
        assert.equal(value, context)
        assert.equal(userId, 'user-a')
        assert.equal(capability, CAPABILITIES.USERS_READ)
        return { scope: { scopeType: 'BRANCH', scopeId: 'branch-a' }, grant }
      },
      audit(value, valueGrant, input) {
        assert.equal(value, context)
        assert.equal(valueGrant, grant)
        return input
      },
    }
    const repository = {
      async listUserInfluence(...args) {
        calls.push('read')
        readArguments = args
        return {
          items: [influenceFact({
            openId: 'must-not-leave-server',
            phoneNumber: '18800000000',
            profileRef: 'must-not-leave-server',
            counterpartUserId: 'user-private',
          })],
          nextCursor: 'cursor-next',
        }
      },
      async recordAudit(value) {
        calls.push('audit')
        audit = value
      },
    }
    const service = createUserInfluenceService({ access, repository })
    const expectedCursor = {
      subject: opaqueReference('subject', caller.appId, 'user-a'),
      kind: 'HEART',
      direction: 'INCOMING',
      from: '2026-08-01 00:00:00.000',
      to: '2026-08-31 23:59:59.999',
      occurredAt: '2026-08-25 08:30:00.000',
      id: 'heart-current',
    }
    const cursor = Buffer.from(JSON.stringify({ v: 1, ...expectedCursor }), 'utf8')
      .toString('base64url')

    const result = await service.listUserInfluence(caller, {
      userId: 'user-a',
      kind: 'HEART',
      direction: 'INCOMING',
      occurredFrom: '2026-08-01T00:00:00.000Z',
      occurredTo: '2026-08-31T23:59:59.999Z',
      cursor,
      limit: 10,
    })

    assert.deepEqual(calls, ['session', 'authorization', 'read', 'audit'])
    assert.equal(readArguments[0], caller.appId)
    assert.equal(readArguments[1], 'user-a')
    assert.deepEqual(readArguments[2], {
      kind: 'HEART',
      direction: 'INCOMING',
      occurredFrom: '2026-08-01 00:00:00.000',
      occurredTo: '2026-08-31 23:59:59.999',
      cursor: { v: 1, ...expectedCursor },
      cursorContext: {
        subject: expectedCursor.subject,
        kind: 'HEART',
        direction: 'INCOMING',
        from: '2026-08-01 00:00:00.000',
        to: '2026-08-31 23:59:59.999',
      },
    })
    assert.equal(readArguments[3], 10)
    assert.deepEqual(Object.keys(result).sort(), ['items', 'nextCursor', 'unavailableFacts'])
    assert.deepEqual(Object.keys(result.items[0]).sort(), [
      'counterpartKind',
      'counterpartNickname',
      'counterpartState',
      'direction',
      'eventTitle',
      'kind',
      'occurredAt',
      'reference',
      'sourceType',
      'status',
    ])
    assert.match(result.items[0].reference, /^if1\.[\w-]{22}$/)
    assert.equal(result.items[0].reference.includes('heart-a'), false)
    assert.doesNotMatch(
      JSON.stringify(result),
      /openId|phone|profileRef|counterpartUserId|cursorOccurredAt|heart-a|18800000000/i,
    )
    assert.deepEqual(result.unavailableFacts, ['CANCELLED_INCOMING_HEART'])
    assert.deepEqual(audit, {
      scopeType: 'BRANCH',
      scopeId: 'branch-a',
      action: 'admin.users.influence.view',
      resourceType: 'USER',
      resourceId: 'user-a',
      metadata: {
        kind: 'HEART',
        direction: 'INCOMING',
        count: 1,
        hasCursor: true,
        hasTimeRange: true,
      },
    })
    assert.doesNotMatch(JSON.stringify(audit.metadata), /heart-current|林然|nickname|phone|openid/i)
  })

  it('does not claim unavailable incoming heart history for an outgoing-only query', async () => {
    const service = createUserInfluenceService({
      access: {
        async session() { return context },
        async userAuthorization() {
          return {
            scope: { scopeType: 'PLATFORM', scopeId: null },
            grant: { roleKey: 'PLATFORM_OWNER', scopeType: 'PLATFORM', scopeId: null },
          }
        },
        audit(_context, _grant, input) { return input },
      },
      repository: {
        async listUserInfluence() { return { items: [], nextCursor: null } },
        async recordAudit() {},
      },
    })

    const result = await service.listUserInfluence(caller, {
      userId: 'user-a', kind: 'HEART', direction: 'OUTGOING',
    })
    assert.deepEqual(result.unavailableFacts, [])
  })

  it('binds the stable cursor to target, kind, direction, and time filters', async () => {
    let reads = 0
    const cursor = Buffer.from(JSON.stringify({
      v: 1,
      subject: opaqueReference('subject', caller.appId, 'user-a'),
      kind: 'HEART',
      direction: 'INCOMING',
      from: '-',
      to: '-',
      occurredAt: '2026-08-25 08:30:00.000',
      id: 'heart-a',
    }), 'utf8').toString('base64url')
    const service = createUserInfluenceService({
      access: {
        async session() { return context },
        async userAuthorization() {
          return {
            scope: { scopeType: 'PLATFORM', scopeId: null },
            grant: { roleKey: 'PLATFORM_OWNER', scopeType: 'PLATFORM', scopeId: null },
          }
        },
      },
      repository: {
        async listUserInfluence() { reads += 1; return { items: [], nextCursor: null } },
      },
    })

    await assert.rejects(
      () => service.listUserInfluence(caller, {
        userId: 'user-a', kind: 'HEART', direction: 'OUTGOING', cursor,
      }),
      error => error?.code === 'VALIDATION_FAILED',
    )
    assert.equal(reads, 0)
  })

  it('uses the existing users.read target scope and never reads or audits a hidden user', async () => {
    let reads = 0
    let audits = 0
    const repository = {
      async resolveUser() {
        return {
          id: 'admin-user', status: 'ACTIVE', agreementsAccepted: true,
          phoneBound: true, profileComplete: true,
        }
      },
      async listRoleBindings() {
        return [{ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: 'branch-a' }]
      },
      async getUserScope() { return { scopeType: 'BRANCH', scopeId: 'branch-b' } },
      async listUserInfluence() { reads += 1; return { items: [], nextCursor: null } },
      async recordAudit() { audits += 1 },
    }
    const service = createUserInfluenceService({
      access: createAdminAccess({ repository }),
      repository,
    })

    await assert.rejects(
      () => service.listUserInfluence(caller, { userId: 'user-b', kind: 'VISIT' }),
      error => error?.code === 'FORBIDDEN',
    )
    assert.equal(reads, 0)
    assert.equal(audits, 0)
  })
})

function opaqueReference(namespace, appId, id) {
  const digest = createHash('sha256')
    .update(`${namespace}\0${appId}\0${id}`, 'utf8')
    .digest('base64url')
    .slice(0, 22)
  return `if1.${digest}`
}
