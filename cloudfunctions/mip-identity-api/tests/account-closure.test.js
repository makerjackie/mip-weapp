'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createAccountClosureRepository } = require('../domain/account-closure')
const { createIdentityRepository } = require('../domain/repository')
const {
  ACCOUNT_CLOSURE_CONFIRMATION_PHRASE,
  createIdentityService,
  normalizeAccountClosureInput,
} = require('../domain/service')

const appId = 'wx0000000000000001'
const userId = '10000000-0000-4000-8000-000000000001'
const caller = { appId, identityKey: 'a'.repeat(64) }
const input = {
  confirmationPhrase: ACCOUNT_CLOSURE_CONFIRMATION_PHRASE,
  expectedVersion: 7,
  idempotencyKey: 'identity-close-request-1',
}

function harness(options = {}) {
  const calls = []
  let idSequence = 0
  const identity = options.identity || {
    id: '11000000-0000-4000-8000-000000000001',
    identity_key: 'a'.repeat(64),
    closed_identity_key: null,
  }
  const user = options.user || {
    id: userId,
    status: 'ACTIVE',
    version: 7,
    closed_at: null,
  }
  const tx = {
    async one(sql, params) {
      calls.push({ kind: 'one', sql, params })
      if (sql.includes('FROM mip_user_identities')) return identity
      if (sql.includes('FROM mip_users')) return user
      if (sql.includes('FROM mip_idempotency_keys')) return options.replay || null
      throw new Error(`unexpected one query: ${sql}`)
    },
    async query(sql, params) {
      calls.push({ kind: 'query', sql, params })
      if (sql.includes('INSERT INTO mip_idempotency_keys') && options.duplicate) {
        const error = new Error('duplicate')
        error.code = 'ER_DUP_ENTRY'
        throw error
      }
      if (/^SELECT /m.test(sql)) {
        if (sql.includes('SELECT referral.id')) return options.referrals || []
        return options.pendingTable && sql.includes(`FROM ${options.pendingTable}`) ? [{ id: 'pending-1' }] : []
      }
      return { affectedRows: 1 }
    },
  }
  const database = {
    async transaction(work) {
      return work(tx)
    },
  }
  const repository = createAccountClosureRepository(database, {
    id: () => `closure-id-${++idSequence}`,
    now: () => new Date('2026-08-24T08:00:00.000Z'),
  })
  return { calls, repository }
}

describe('MIP account closure repository', () => {
  it('closes app-scoped identity and revokes only non-event public or interactive state', async () => {
    const opportunityId = '30000000-0000-4000-8000-000000000001'
    const { calls, repository } = harness({
      referrals: [
        { id: 'referral-1', opportunity_id: opportunityId },
        { id: 'referral-2', opportunity_id: opportunityId },
      ],
    })
    const result = await repository.closeAccount(caller, { id: userId }, input)

    assert.deepEqual(result, {
      status: 'CLOSED',
      version: 8,
      closedAt: '2026-08-24T08:00:00.000Z',
      idempotent: false,
    })
    assert.equal(JSON.stringify(result).includes(userId), false)
    assert.equal(JSON.stringify(result).includes(caller.identityKey), false)

    const source = calls.map(call => call.sql).join('\n')
    assert.match(source, /SET closed_identity_key = identity_key, identity_key = \?/)
    assert.match(source, /union_identity_key = NULL/)
    assert.match(source, /SET status = 'CLOSED', primary_branch_id = NULL, closed_at = \?, version = version \+ 1/)
    assert.match(source, /phone_hash = NULL, phone_ciphertext = NULL, phone_verified_at = NULL/)
    assert.match(source, /nickname = '已注销用户'/)
    assert.match(source, /IDENTITY_ACCOUNT_CLOSED/)
    assert.match(source, /UPDATE mip_opportunities/)
    assert.match(source, /UPDATE mip_cooperation_cards/)
    assert.match(source, /UPDATE mip_super_cases/)
    assert.match(source, /UPDATE mip_referral_intents referral/)
    assert.equal(calls.some(call => call.sql.includes('referral_count = GREATEST')
      && call.params[0] === 2
      && call.params[2] === opportunityId), true)
    assert.match(source, /UPDATE mip_profile_interests/)
    assert.match(source, /UPDATE mip_notification_grants/)
    assert.match(source, /recipient_ciphertext = \?/)
    assert.match(source, /status = CASE WHEN status IN \('AVAILABLE', 'RESERVED'\) THEN 'REVOKED' ELSE status END/)
    assert.match(source, /reservation_task_id = NULL/)
    assert.ok(source.indexOf('UPDATE mip_delivery_tasks') < source.indexOf('UPDATE mip_notification_grants'))
    assert.match(source, /UPDATE mip_ai_drafts/)
    assert.doesNotMatch(source, /UPDATE mip_orders/)
    assert.doesNotMatch(source, /UPDATE mip_payment_attempts/)
    assert.doesNotMatch(source, /UPDATE mip_refunds/)
    assert.doesNotMatch(source, /UPDATE mip_event_registrations/)
    assert.doesNotMatch(source, /UPDATE mip_membership_entitlements/)
    assert.doesNotMatch(source, /DELETE FROM/)

    for (const call of calls.filter(item => /mip_(orders|payment_attempts|refunds|event_registrations|event_seat_holds)/.test(item.sql))) {
      assert.deepEqual(call.params.slice(0, 2), [appId, userId])
    }
    for (const call of calls.filter(item => item.sql.includes('UPDATE mip_'))) {
      assert.equal(call.params.includes(appId), true)
    }
  })

  it('fails closed for every unsettled payment, refund, registration, or seat-hold source', async () => {
    for (const pendingTable of [
      'mip_orders',
      'mip_payment_attempts',
      'mip_refunds',
      'mip_event_registrations',
      'mip_event_seat_holds',
    ]) {
      const { calls, repository } = harness({ pendingTable })
      await assert.rejects(
        () => repository.closeAccount(caller, { id: userId }, input),
        /ACCOUNT_CLOSURE_PENDING_SETTLEMENT/,
      )
      assert.equal(calls.some(call => call.sql.includes("SET status = 'CLOSED'")), false)
      assert.equal(calls.some(call => call.sql.includes('IDENTITY_ACCOUNT_CLOSED')), false)
    }
  })

  it('enforces expectedVersion and replays a completed request without repeating effects', async () => {
    const stale = harness({ user: { id: userId, status: 'ACTIVE', version: 8, closed_at: null } })
    await assert.rejects(
      () => stale.repository.closeAccount(caller, { id: userId }, input),
      /ACCOUNT_CLOSURE_CONFLICT/,
    )
    assert.equal(stale.calls.some(call => call.sql.includes('UPDATE mip_profiles')), false)

    const replay = harness({
      duplicate: true,
      replay: {
        request_hash: require('node:crypto').createHash('sha256').update(JSON.stringify({
          confirmationPhrase: input.confirmationPhrase,
          expectedVersion: input.expectedVersion,
        })).digest('hex'),
        status: 'COMPLETED',
        response_json: JSON.stringify({
          status: 'CLOSED',
          version: 8,
          closedAt: '2026-08-24T08:00:00.000Z',
          idempotent: false,
        }),
      },
    })
    assert.deepEqual(
      await replay.repository.closeAccount(caller, { id: userId }, input),
      {
        status: 'CLOSED',
        version: 8,
        closedAt: '2026-08-24T08:00:00.000Z',
        idempotent: true,
      },
    )
    assert.equal(replay.calls.some(call => call.sql.includes('UPDATE mip_profiles')), false)
  })

  it('returns an already-closed account without repeating anonymization', async () => {
    const { calls, repository } = harness({
      identity: {
        id: '11000000-0000-4000-8000-000000000001',
        identity_key: 'b'.repeat(64),
        closed_identity_key: 'a'.repeat(64),
      },
      user: {
        id: userId,
        status: 'CLOSED',
        version: 7,
        closed_at: '2026-08-24T07:00:00.000Z',
      },
    })
    assert.deepEqual(await repository.closeAccount(caller, { id: userId }, input), {
      status: 'CLOSED',
      version: 7,
      closedAt: '2026-08-24T07:00:00.000Z',
      idempotent: true,
    })
    assert.equal(calls.some(call => call.sql.includes('UPDATE mip_profiles')), false)
  })
})

describe('MIP account closure identity and service boundary', () => {
  it('recognizes a closed identity tombstone and never creates or touches a new account', async () => {
    const calls = []
    const repository = createIdentityRepository({
      async one(sql, params) {
        calls.push({ sql, params })
        return {
          id: userId,
          status: 'CLOSED',
          version: 8,
          identity_id: '11000000-0000-4000-8000-000000000001',
          union_identity_key: null,
        }
      },
      async query(sql) {
        calls.push({ sql })
        throw new Error('closed identity must not be touched')
      },
    })
    const result = await repository.ensureUser(caller)
    assert.equal(result.status, 'CLOSED')
    assert.match(calls[0].sql, /i\.identity_key = \? OR i\.closed_identity_key = \?/)
    assert.deepEqual(calls[0].params, [appId, caller.identityKey, caller.identityKey])
    assert.equal(calls.some(call => call.sql.includes('INSERT INTO mip_users')), false)
  })

  it('requires the exact phrase, version, and idempotency key before allowing BLOCKED users to close', async () => {
    assert.throws(
      () => normalizeAccountClosureInput({ ...input, confirmationPhrase: '注销账号' }),
      /ACCOUNT_CLOSURE_CONFIRMATION_REQUIRED/,
    )
    assert.throws(
      () => normalizeAccountClosureInput({ ...input, expectedVersion: 0 }),
      /VALIDATION_FAILED/,
    )
    const closeCalls = []
    const service = createIdentityService({
      repository: {
        ensureUser: async () => ({ id: userId, status: 'BLOCKED', version: 7 }),
        async closeAccount(actualCaller, user, actualInput) {
          closeCalls.push({ actualCaller, user, actualInput })
          return { status: 'CLOSED', version: 8, closedAt: '2026-08-24T08:00:00.000Z', idempotent: false }
        },
      },
    })
    const result = await service.closeAccount(caller, { input })
    assert.equal(result.status, 'CLOSED')
    assert.deepEqual(closeCalls[0].actualInput, input)
  })
})
