'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createMembershipRepository } = require('../domain/repositories/memberships')

const APP_ID = 'wx-membership-app'
const ACTOR_ID = '10000000-0000-4000-8000-000000000001'
const USER_ID = '20000000-0000-4000-8000-000000000002'
const ADJUSTMENT_ID = '30000000-0000-4000-8000-000000000003'
const ENTITLEMENT_ID = '40000000-0000-4000-8000-000000000004'
const OUTBOX_ID = '50000000-0000-4000-8000-000000000005'

function codeError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

function input(overrides = {}) {
  return {
    appId: APP_ID,
    actorUserId: ACTOR_ID,
    userId: USER_ID,
    durationMonths: 1,
    reason: '人工核验通过',
    expectedChainVersion: 7,
    idempotencyKey: 'membership-grant-request-1',
    requestHash: 'a'.repeat(64),
    authorization: {
      capability: 'memberships.adjust',
      effectiveGrant: { roleKey: 'PLATFORM_OPERATIONS', scopeType: 'PLATFORM', scopeId: null },
    },
    audit(adjustmentId, facts) {
      return {
        action: 'admin.memberships.grant',
        resourceId: adjustmentId,
        metadata: { reasonLength: 6, ...facts },
      }
    },
    ...overrides,
  }
}

function createRepository(database, overrides = {}) {
  const ids = [ADJUSTMENT_ID, ENTITLEMENT_ID, OUTBOX_ID]
  const state = { audits: [], outbox: [], authorizationLocks: 0, scopes: [] }
  const repository = createMembershipRepository(database, {
    createId: () => ids.shift(),
    now: () => new Date('2030-01-31T12:34:56.789Z'),
    async lockMutationAuthorization(_tx, request) {
      state.authorizationLocks += 1
      return request.authorization
    },
    assertMutationScope(authorization, scope) {
      state.scopes.push({ authorization, scope })
      if (scope.scopeType !== 'PLATFORM' || scope.scopeId !== null) throw codeError('FORBIDDEN')
    },
    repositorySupport: {
      codeError,
      duplicateConstraint(error) {
        return error?.code === 'ER_DUP_ENTRY'
      },
      iso: value => new Date(value).toISOString(),
    },
    async writeAudit(_tx, audit) { state.audits.push(audit) },
    async writeOutbox(_tx, event) { state.outbox.push(event) },
    ...overrides,
  })
  return { repository, state }
}

function transactionDatabase(txFactory) {
  const database = {
    transactions: 0,
    async transaction(work) {
      database.transactions += 1
      return work(txFactory(database.transactions))
    },
  }
  return database
}

function normalized(sql) {
  return sql.replace(/\s+/g, ' ').trim()
}

function successfulTx(overrides = {}) {
  const calls = []
  const tx = {
    calls,
    async one(sql, params) {
      calls.push({ type: 'one', sql: normalized(sql), params })
      if (sql.includes('FROM mip_users')) return { id: USER_ID, status: 'ACTIVE' }
      if (sql.includes('FROM mip_membership_chains')) {
        return { app_id: APP_ID, user_id: USER_ID, version: 7 }
      }
      if (sql.includes('FROM mip_membership_adjustments')) return null
      throw new Error(`unexpected one: ${normalized(sql)}`)
    },
    async query(sql, params) {
      calls.push({ type: 'query', sql: normalized(sql), params })
      if (sql.includes('SELECT id, status, starts_at, ends_at')) {
        return [{
          id: 'existing-entitlement',
          status: 'ACTIVE',
          starts_at: new Date('2030-01-01T00:00:00.000Z'),
          ends_at: new Date('2030-03-31T12:34:56.789Z'),
        }, {
          id: 'refunded-entitlement',
          status: 'REFUNDED',
          starts_at: new Date('2030-04-01T00:00:00.000Z'),
          ends_at: new Date('2031-01-01T00:00:00.000Z'),
        }]
      }
      return { affectedRows: 1 }
    },
    ...overrides,
  }
  return tx
}

function replayRow(overrides = {}) {
  return {
    adjustment_id: ADJUSTMENT_ID,
    user_id: USER_ID,
    request_hash: 'a'.repeat(64),
    result_chain_version: 8,
    entitlement_id: ENTITLEMENT_ID,
    starts_at: new Date('2030-01-31T00:00:00.000Z'),
    ends_at: new Date('2030-02-28T00:00:00.000Z'),
    ...overrides,
  }
}

describe('membership repository', () => {
  it('keeps a two-operation repository surface', () => {
    const { repository } = createRepository({ query: async () => [] })
    assert.deepEqual(Object.keys(repository).sort(), ['getMembership', 'grantMembership'])
  })

  it('returns the privileged membership projection and derives active and scheduled windows', async () => {
    let captured
    const rows = [{
      user_id: USER_ID,
      user_status: 'ACTIVE',
      nickname: '目标会员',
      chain_version: 9,
      entitlement_id: '60000000-0000-4000-8000-000000000006',
      source_type: 'ADMIN_ADJUSTMENT',
      entitlement_status: 'ACTIVE',
      starts_at: new Date('2030-02-01T00:00:00.000Z'),
      ends_at: new Date('2030-05-01T00:00:00.000Z'),
      order_id: null,
      plan_id: null,
      source_adjustment_id: ADJUSTMENT_ID,
      adjustment_id: ADJUSTMENT_ID,
      adjustment_duration_months: 3,
      adjustment_reason: '人工核验通过',
      adjustment_created_at: new Date('2030-01-30T00:00:00.000Z'),
      expected_chain_version: 8,
      result_chain_version: 9,
      actor_nickname: '平台运营',
    }, {
      user_id: USER_ID,
      user_status: 'ACTIVE',
      nickname: '目标会员',
      chain_version: 9,
      entitlement_id: ENTITLEMENT_ID,
      source_type: 'ORDER',
      entitlement_status: 'ACTIVE',
      starts_at: new Date('2030-01-01T00:00:00.000Z'),
      ends_at: new Date('2030-02-01T00:00:00.000Z'),
      order_id: '70000000-0000-4000-8000-000000000007',
      plan_id: '80000000-0000-4000-8000-000000000008',
      source_adjustment_id: null,
      adjustment_id: null,
    }]
    const { repository } = createRepository({
      async query(sql, params) {
        captured = { sql: normalized(sql), params }
        return rows
      },
    }, { now: () => new Date('2030-01-31T12:00:00.000Z') })

    const result = await repository.getMembership({ appId: APP_ID, userId: USER_ID })

    assert.deepEqual(captured.params, [APP_ID, USER_ID])
    assert.match(captured.sql, /WHERE user_row\.app_id = \? AND user_row\.id = \?/)
    assert.match(captured.sql, /ORDER BY entitlement\.starts_at DESC, entitlement\.id DESC/)
    assert.deepEqual(result.user, { id: USER_ID, nickname: '目标会员', status: 'ACTIVE' })
    assert.equal(result.chainVersion, 9)
    assert.deepEqual(result.membership, {
      status: 'ACTIVE',
      active: true,
      currentEndsAt: '2030-02-01T00:00:00.000Z',
      nextStartsAt: '2030-02-01T00:00:00.000Z',
    })
    assert.deepEqual(result.entitlements[0].adjustment, {
      id: ADJUSTMENT_ID,
      durationMonths: 3,
      reason: '人工核验通过',
      actorNickname: '平台运营',
      createdAt: '2030-01-30T00:00:00.000Z',
      expectedChainVersion: 8,
      resultChainVersion: 9,
    })
    assert.equal(result.entitlements[0].currentlyActive, false)
    assert.equal(result.entitlements[1].currentlyActive, true)
    assert.equal(result.entitlements[1].adjustment, null)
  })

  it('returns an inactive empty projection and fails closed when the chain is missing', async () => {
    const base = {
      user_id: USER_ID,
      user_status: 'CLOSED',
      nickname: null,
      chain_version: 1,
      entitlement_id: null,
    }
    const { repository } = createRepository({ query: async () => [base] })
    assert.deepEqual(await repository.getMembership({ appId: APP_ID, userId: USER_ID }), {
      user: { id: USER_ID, nickname: '未填写昵称', status: 'CLOSED' },
      chainVersion: 1,
      membership: {
        status: 'INACTIVE', active: false, currentEndsAt: null, nextStartsAt: null,
      },
      entitlements: [],
    })

    const broken = createRepository({ query: async () => [{ ...base, chain_version: null }] }).repository
    await assert.rejects(
      () => broken.getMembership({ appId: APP_ID, userId: USER_ID }),
      error => error?.code === 'INVALID_STATE',
    )
  })

  it('locks user then chain, appends after non-refunded windows, clamps UTC month-end, and commits all facts', async () => {
    const tx = successfulTx()
    const database = transactionDatabase(() => tx)
    const { repository, state } = createRepository(database)

    const result = await repository.grantMembership(input())

    assert.deepEqual(result, {
      adjustmentId: ADJUSTMENT_ID,
      resultChainVersion: 8,
      startsAt: '2030-03-31T12:34:56.789Z',
      endsAt: '2030-04-30T12:34:56.789Z',
      idempotent: false,
    })
    assert.equal(state.authorizationLocks, 1)
    assert.deepEqual(state.scopes[0].scope, { scopeType: 'PLATFORM', scopeId: null })
    const statements = tx.calls.map(call => call.sql)
    const userLock = statements.findIndex(sql => sql.includes('FROM mip_users'))
    const chainLock = statements.findIndex(sql => sql.includes('FROM mip_membership_chains'))
    const replay = statements.findIndex(sql => sql.includes('FROM mip_membership_adjustments'))
    const entitlementLock = statements.findIndex(sql => sql.startsWith('SELECT id, status, starts_at, ends_at'))
    assert.ok(userLock >= 0 && userLock < chainLock)
    assert.ok(chainLock < replay && replay < entitlementLock)
    assert.doesNotMatch(statements[replay], /FOR UPDATE/)
    assert.ok(statements.every(sql => !/\bTRIGGER\b/i.test(sql)))

    const adjustmentInsert = tx.calls.find(call => call.sql.includes('INSERT INTO mip_membership_adjustments'))
    assert.deepEqual(adjustmentInsert.params, [
      ADJUSTMENT_ID, APP_ID, USER_ID, 1, '人工核验通过', ACTOR_ID,
      'membership-grant-request-1', 'a'.repeat(64), 7, 8,
    ])
    const entitlementInsert = tx.calls.find(call => call.sql.includes('INSERT INTO mip_membership_entitlements'))
    assert.match(entitlementInsert.sql, /NULL, NULL, 'ADMIN_ADJUSTMENT'/)
    assert.deepEqual(entitlementInsert.params.slice(0, 4), [ENTITLEMENT_ID, APP_ID, USER_ID, ADJUSTMENT_ID])
    assert.equal(state.audits.length, 1)
    assert.doesNotMatch(JSON.stringify(state.audits[0]), /人工核验通过/)
    assert.deepEqual(state.audits[0].metadata, {
      reasonLength: 6,
      startsAt: '2030-03-31T12:34:56.789Z',
      endsAt: '2030-04-30T12:34:56.789Z',
      resultChainVersion: 8,
    })
    assert.deepEqual(state.outbox, [{
      id: OUTBOX_ID,
      appId: APP_ID,
      aggregateType: 'MEMBERSHIP_ADJUSTMENT',
      aggregateId: ADJUSTMENT_ID,
      eventType: 'membership.adjustment_granted',
      sourceVersion: 8,
      payload: {},
    }])
  })

  it('uses now when every non-refunded entitlement has ended and clamps leap-day years', async () => {
    const tx = successfulTx({
      async query(sql, params) {
        tx.calls.push({ type: 'query', sql: normalized(sql), params })
        if (sql.includes('SELECT id, status, starts_at, ends_at')) return []
        return { affectedRows: 1 }
      },
    })
    const { repository } = createRepository(transactionDatabase(() => tx), {
      now: () => new Date('2032-02-29T08:15:00.000Z'),
    })
    const result = await repository.grantMembership(input({ durationMonths: 12 }))
    assert.equal(result.startsAt, '2032-02-29T08:15:00.000Z')
    assert.equal(result.endsAt, '2033-02-28T08:15:00.000Z')
  })

  it('allows a blocked user to receive a future entitlement but rejects a fresh closed user', async () => {
    const blockedTx = successfulTx({
      async one(sql, params) {
        blockedTx.calls.push({ type: 'one', sql: normalized(sql), params })
        if (sql.includes('FROM mip_users')) return { id: USER_ID, status: 'BLOCKED' }
        if (sql.includes('FROM mip_membership_chains')) {
          return { app_id: APP_ID, user_id: USER_ID, version: 7 }
        }
        if (sql.includes('FROM mip_membership_adjustments')) return null
        throw new Error(`unexpected one: ${normalized(sql)}`)
      },
    })
    const blocked = createRepository(transactionDatabase(() => blockedTx)).repository
    assert.equal((await blocked.grantMembership(input())).resultChainVersion, 8)

    const closedTx = successfulTx({
      async one(sql, params) {
        closedTx.calls.push({ type: 'one', sql: normalized(sql), params })
        if (sql.includes('FROM mip_users')) return { id: USER_ID, status: 'CLOSED' }
        if (sql.includes('FROM mip_membership_chains')) {
          return { app_id: APP_ID, user_id: USER_ID, version: 7 }
        }
        if (sql.includes('FROM mip_membership_adjustments')) return null
        throw new Error(`unexpected one: ${normalized(sql)}`)
      },
    })
    const closed = createRepository(transactionDatabase(() => closedTx)).repository
    await assert.rejects(
      () => closed.grantMembership(input()),
      error => error?.code === 'INVALID_STATE',
    )
    assert.equal(closedTx.calls.some(call => call.sql.includes('INSERT INTO')), false)
  })

  it('replays before current-version and target-status rejection using stored period facts', async () => {
    const tx = successfulTx({
      async one(sql, params) {
        tx.calls.push({ type: 'one', sql: normalized(sql), params })
        if (sql.includes('FROM mip_users')) return { id: USER_ID, status: 'CLOSED' }
        if (sql.includes('FROM mip_membership_chains')) {
          return { app_id: APP_ID, user_id: USER_ID, version: 99 }
        }
        if (sql.includes('FROM mip_membership_adjustments')) return replayRow()
        throw new Error(`unexpected one: ${normalized(sql)}`)
      },
    })
    const { repository, state } = createRepository(transactionDatabase(() => tx))

    assert.deepEqual(await repository.grantMembership(input()), {
      adjustmentId: ADJUSTMENT_ID,
      resultChainVersion: 8,
      startsAt: '2030-01-31T00:00:00.000Z',
      endsAt: '2030-02-28T00:00:00.000Z',
      idempotent: true,
    })
    assert.equal(tx.calls.some(call => call.sql.includes('INSERT INTO')), false)
    assert.equal(state.audits.length, 0)
    assert.equal(state.outbox.length, 0)
    assert.equal(tx.calls
      .filter(call => call.sql.includes('FROM mip_membership_adjustments'))
      .every(call => !call.sql.includes('FOR UPDATE')), true)
  })

  it('rejects changed idempotent payload before a stale chain and maps a true stale version', async () => {
    const conflictingTx = successfulTx({
      async one(sql, params) {
        conflictingTx.calls.push({ type: 'one', sql: normalized(sql), params })
        if (sql.includes('FROM mip_users')) return { id: USER_ID, status: 'ACTIVE' }
        if (sql.includes('FROM mip_membership_chains')) {
          return { app_id: APP_ID, user_id: USER_ID, version: 99 }
        }
        if (sql.includes('FROM mip_membership_adjustments')) {
          return replayRow({ request_hash: 'b'.repeat(64) })
        }
        throw new Error(`unexpected one: ${normalized(sql)}`)
      },
    })
    const conflicting = createRepository(transactionDatabase(() => conflictingTx)).repository
    await assert.rejects(
      () => conflicting.grantMembership(input()),
      error => error?.code === 'IDEMPOTENCY_CONFLICT',
    )

    const staleTx = successfulTx({
      async one(sql, params) {
        staleTx.calls.push({ type: 'one', sql: normalized(sql), params })
        if (sql.includes('FROM mip_users')) return { id: USER_ID, status: 'ACTIVE' }
        if (sql.includes('FROM mip_membership_chains')) {
          return { app_id: APP_ID, user_id: USER_ID, version: 8 }
        }
        if (sql.includes('FROM mip_membership_adjustments')) return null
        throw new Error(`unexpected one: ${normalized(sql)}`)
      },
    })
    const stale = createRepository(transactionDatabase(() => staleTx)).repository
    await assert.rejects(
      () => stale.grantMembership(input()),
      error => error?.code === 'VERSION_CONFLICT',
    )
    assert.equal(staleTx.calls.some(call => call.sql.includes('INSERT INTO')), false)
  })

  it('maps a failed chain CAS to VERSION_CONFLICT before audit or outbox writes', async () => {
    const tx = successfulTx({
      async query(sql, params) {
        tx.calls.push({ type: 'query', sql: normalized(sql), params })
        if (sql.includes('SELECT id, status, starts_at, ends_at')) return []
        if (sql.includes('UPDATE mip_membership_chains')) return { affectedRows: 0 }
        return { affectedRows: 1 }
      },
    })
    const { repository, state } = createRepository(transactionDatabase(() => tx))
    await assert.rejects(
      () => repository.grantMembership(input()),
      error => error?.code === 'VERSION_CONFLICT',
    )
    assert.equal(state.audits.length, 0)
    assert.equal(state.outbox.length, 0)
  })

  it('reauthorizes and resolves a unique-key race only through the stored idempotent result', async () => {
    const first = successfulTx({
      async query(sql, params) {
        first.calls.push({ type: 'query', sql: normalized(sql), params })
        if (sql.includes('SELECT id, status, starts_at, ends_at')) return []
        if (sql.includes('INSERT INTO mip_membership_adjustments')) {
          const error = new Error('duplicate idempotency key')
          error.code = 'ER_DUP_ENTRY'
          throw error
        }
        return { affectedRows: 1 }
      },
    })
    const second = successfulTx({
      async one(sql, params) {
        second.calls.push({ type: 'one', sql: normalized(sql), params })
        if (sql.includes('FROM mip_users')) return { id: USER_ID, status: 'ACTIVE' }
        if (sql.includes('FROM mip_membership_chains')) {
          return { app_id: APP_ID, user_id: USER_ID, version: 12 }
        }
        if (sql.includes('FROM mip_membership_adjustments')) return replayRow()
        throw new Error(`unexpected one: ${normalized(sql)}`)
      },
    })
    const database = transactionDatabase(attempt => attempt === 1 ? first : second)
    const { repository, state } = createRepository(database)

    const result = await repository.grantMembership(input())
    assert.equal(result.idempotent, true)
    assert.equal(result.resultChainVersion, 8)
    assert.equal(database.transactions, 2)
    assert.equal(state.authorizationLocks, 2)
    assert.equal([...first.calls, ...second.calls]
      .filter(call => call.sql.includes('FROM mip_membership_adjustments'))
      .every(call => !call.sql.includes('FOR UPDATE')), true)
    assert.equal(state.audits.length, 0)
    assert.equal(state.outbox.length, 0)
  })

  it('fails closed when a duplicate has no matching idempotency fact', async () => {
    const first = successfulTx({
      async query(sql, params) {
        first.calls.push({ type: 'query', sql: normalized(sql), params })
        if (sql.includes('SELECT id, status, starts_at, ends_at')) return []
        if (sql.includes('INSERT INTO mip_membership_adjustments')) {
          const error = new Error('unrelated duplicate')
          error.code = 'ER_DUP_ENTRY'
          throw error
        }
        return { affectedRows: 1 }
      },
    })
    const second = successfulTx()
    const { repository } = createRepository(transactionDatabase(attempt => attempt === 1 ? first : second))
    await assert.rejects(
      () => repository.grantMembership(input()),
      error => error?.code === 'CONFLICT',
    )
  })
})
