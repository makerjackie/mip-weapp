'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  checkIn,
  createRegistration,
  saveFeedback,
  setHeart,
} = require('../domain/event-service')
const {
  configuredAgreements,
  createParticipationAccessPolicy,
} = require('../domain/participation-access')
const { DomainError } = require('../domain/rules')

const appId = 'wx-app'
const userId = '10000000-0000-4000-8000-000000000001'
const eventId = '20000000-0000-4000-8000-000000000001'
const now = new Date('2026-08-25T00:00:00.000Z')
const agreements = [
  { key: 'SERVICE_AGREEMENT', version: 'service-v2' },
  { key: 'PRIVACY_POLICY', version: 'privacy-v3' },
]

function completeFacts(overrides = {}) {
  return {
    id: userId,
    status: 'ACTIVE',
    primary_branch_id: '30000000-0000-4000-8000-000000000001',
    nickname: 'MIP 成员',
    phone_verified_at: now,
    agreement_0_accepted: 1,
    agreement_1_accepted: 1,
    ...overrides,
  }
}

async function requireFacts(row, configured = agreements) {
  const calls = []
  const policy = createParticipationAccessPolicy({ agreements: configured })
  const result = await policy.requireAccess({
    async one(sql, params) {
      calls.push({ sql, params })
      return typeof row === 'function' ? row(params) : row
    },
  }, appId, userId)
  return { calls, result }
}

async function rejectCode(work, code) {
  await assert.rejects(work, error => error?.code === code)
}

function registrationInput() {
  return {
    eventId,
    formVersion: 1,
    answers: {},
    shareProfile: false,
    idempotencyKey: 'event-registration-request-1',
  }
}

function recoveryDatabase({ replay = null, existing = null } = {}) {
  const calls = []
  let requestHash = ''
  const tx = {
    async one(sql, params) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim()
      calls.push({ kind: 'one', sql: normalized, params })
      if (normalized.includes('FROM mip_users')) {
        return { id: userId, status: 'ACTIVE' }
      }
      if (normalized.includes('FROM mip_idempotency_keys')) {
        return replay
          ? { request_hash: requestHash, status: 'COMPLETED', response_json: JSON.stringify(replay) }
          : null
      }
      if (normalized.includes('FROM mip_events')) {
        return { id: eventId, form_version: 1 }
      }
      if (normalized.includes('FROM mip_event_registrations')) {
        return existing
      }
      throw new Error(`unexpected read: ${normalized}`)
    },
    async query(sql, params) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim()
      calls.push({ kind: 'query', sql: normalized, params })
      if (normalized.includes('INSERT INTO mip_idempotency_keys')) {
        requestHash = params[5]
        if (replay) {
          const duplicate = new Error('duplicate')
          duplicate.errno = 1062
          throw duplicate
        }
      }
      return { affectedRows: 1 }
    },
  }
  return { calls, database: { transaction: work => work(tx) } }
}

describe('event participation access policy', () => {
  it('queries exact current agreement versions and returns no private profile values', async () => {
    const { calls, result } = await requireFacts(completeFacts())

    assert.deepEqual(result, {
      id: userId,
      status: 'ACTIVE',
      phoneBound: true,
      profileComplete: true,
      agreementsAccepted: true,
    })
    assert.deepEqual(calls[0].params, [
      'SERVICE_AGREEMENT', 'service-v2',
      'PRIVACY_POLICY', 'privacy-v3',
      appId, userId,
    ])
    assert.match(calls[0].sql, /FROM mip_agreement_acceptances/)
    assert.match(calls[0].sql, /agreement_0\.agreement_key = \?[\s\S]*agreement_0\.agreement_version = \?/)
    assert.match(calls[0].sql, /LEFT JOIN mip_private_profiles/)
    assert.match(calls[0].sql, /LEFT JOIN mip_profiles/)
    assert.match(calls[0].sql, /u\.primary_branch_id/)
    assert.doesNotMatch(calls[0].sql, /FOR UPDATE/)
    assert.equal(Object.hasOwn(result, 'phone_verified_at'), false)
    assert.equal(Object.hasOwn(result, 'nickname'), false)
  })

  it('rejects a missing or old current agreement before later identity requirements', async () => {
    await rejectCode(() => requireFacts(completeFacts({ agreement_1_accepted: 0 })), 'AGREEMENT_REQUIRED')
    await rejectCode(() => requireFacts(params => completeFacts({
      agreement_0_accepted: Number(params[1] === 'service-v1'),
    })), 'AGREEMENT_REQUIRED')
  })

  it('rejects a missing verified phone', async () => {
    await rejectCode(() => requireFacts(completeFacts({ phone_verified_at: null })), 'PHONE_REQUIRED')
  })

  it('requires both a non-empty nickname and a primary branch', async () => {
    await rejectCode(() => requireFacts(completeFacts({ nickname: '   ' })), 'PROFILE_REQUIRED')
    await rejectCode(() => requireFacts(completeFacts({ primary_branch_id: null })), 'PROFILE_REQUIRED')
  })

  it('keeps agreement configuration aligned with the identity contract', () => {
    assert.deepEqual(configuredAgreements().map(({ key, version }) => ({ key, version })), [
      { key: 'SERVICE_AGREEMENT', version: 'draft-2026-08-24' },
      { key: 'PRIVACY_POLICY', version: 'draft-2026-08-24' },
    ])
    assert.deepEqual(configuredAgreements(JSON.stringify([{
      key: 'SERVICE_AGREEMENT',
      label: '用户协议',
      version: 'service-v3',
      documentPath: '/packages/member/user-agreement/index',
    }])).map(({ key, version }) => ({ key, version })), [
      { key: 'SERVICE_AGREEMENT', version: 'service-v3' },
    ])
    assert.throws(() => configuredAgreements('[]'), /AGREEMENT_CONFIG_INVALID/)
  })
})

describe('new event registration access ordering', () => {
  it('replays a completed identical request before loading participation access', async () => {
    const replay = {
      kind: 'REGISTERED',
      registrationId: '40000000-0000-4000-8000-000000000001',
      status: 'REGISTERED',
    }
    const fixture = recoveryDatabase({ replay })
    let accessLoads = 0
    const result = await createRegistration(fixture.database, {
      appId,
      userId,
      input: registrationInput(),
      now,
      participationAccessPolicy: {
        async requireAccess() {
          accessLoads += 1
          throw new Error('access policy must not load for a replay')
        },
      },
    })

    assert.deepEqual(result, replay)
    assert.equal(accessLoads, 0)
    assert.equal(fixture.calls.some(call => call.sql.includes('FROM mip_events')), false)
    assert.match(fixture.calls[0].sql, /FROM mip_users[\s\S]*FOR UPDATE/)
    assert.match(fixture.calls[1].sql, /INSERT INTO mip_idempotency_keys/)
  })

  it('restores an existing active registration before loading participation access', async () => {
    const registration = {
      id: '40000000-0000-4000-8000-000000000001',
      status: 'REGISTERED',
    }
    const fixture = recoveryDatabase({ existing: registration })
    let accessLoads = 0
    const result = await createRegistration(fixture.database, {
      appId,
      userId,
      input: registrationInput(),
      now,
      participationAccessPolicy: {
        async requireAccess() {
          accessLoads += 1
          throw new Error('access policy must not load for an existing active registration')
        },
      },
    })

    assert.deepEqual(result, {
      kind: 'REGISTERED',
      registrationId: registration.id,
      status: 'REGISTERED',
      waitlistPosition: undefined,
    })
    assert.equal(accessLoads, 0)
    assert.equal(fixture.calls.some(call => call.sql.includes('mip_event_seat_holds SET')), false)
    assert.equal(fixture.calls.some(call => call.sql.includes('INSERT INTO mip_event_registrations')), false)
  })

  it('loads participation access only for a new registration before the remaining state machine', async () => {
    const fixture = recoveryDatabase()
    const accessFailure = new DomainError('AGREEMENT_REQUIRED', '请先确认协议')
    await assert.rejects(() => createRegistration(fixture.database, {
      appId,
      userId,
      input: registrationInput(),
      now,
      participationAccessPolicy: {
        async requireAccess() {
          fixture.calls.push({ kind: 'policy', sql: 'participation-access', params: [] })
          throw accessFailure
        },
      },
    }), error => error === accessFailure)

    const registrationRead = fixture.calls.findIndex(call => call.sql.includes('FROM mip_event_registrations'))
    const accessCheck = fixture.calls.findIndex(call => call.kind === 'policy')
    assert.ok(registrationRead > -1)
    assert.ok(accessCheck > registrationRead)
    assert.equal(fixture.calls.some(call => call.sql.includes('mip_event_seat_holds SET')), false)
    assert.equal(fixture.calls.some(call => call.sql.includes('INSERT INTO mip_event_registrations')), false)
  })

})

describe('current participation access for event actions', () => {
  it('replays a completed check-in before reloading current participation access', async () => {
    const replay = {
      eventId,
      registrationId: '40000000-0000-4000-8000-000000000001',
      status: 'ATTENDED',
      checkedInAt: now.toISOString(),
      idempotent: false,
    }
    let requestHash = ''
    const tx = {
      async one(sql) {
        if (sql.includes('FROM mip_users')) return { id: userId, status: 'ACTIVE' }
        if (sql.includes('FROM mip_idempotency_keys')) {
          return {
            request_hash: requestHash,
            status: 'COMPLETED',
            response_json: JSON.stringify(replay),
          }
        }
        throw new Error(`unexpected read: ${sql}`)
      },
      async query(sql, params) {
        if (sql.includes('INSERT INTO mip_idempotency_keys')) {
          requestHash = params[5]
          const duplicate = new Error('duplicate')
          duplicate.errno = 1062
          throw duplicate
        }
        throw new Error(`unexpected write: ${sql}`)
      },
    }
    let accessLoads = 0
    const result = await checkIn({ transaction: work => work(tx) }, {
      appId,
      userId,
      scanToken: 's1.abcdefghijk.lmnopqrstuv',
      idempotencyKey: 'check-in-replay',
      participationAccessPolicy: {
        async requireAccess() {
          accessLoads += 1
          throw new Error('must not load access for a completed replay')
        },
      },
      now,
    })

    assert.deepEqual(result, replay)
    assert.equal(accessLoads, 0)
  })

  it('rechecks uncached access inside check-in, heart and feedback transactions', async () => {
    const accessFailure = new DomainError('AGREEMENT_REQUIRED', '请先确认协议')
    const cases = [
      {
        name: 'check-in',
        invoke: database => checkIn(database, {
          appId,
          userId,
          scanToken: 's1.abcdefghijk.lmnopqrstuv',
          idempotencyKey: 'check-in-access-fence',
          participationAccessPolicy: accessPolicy,
          now,
        }),
      },
      {
        name: 'heart',
        invoke: database => setHeart(database, {
          appId,
          userId,
          eventId,
          targetRef: null,
          participationAccessPolicy: accessPolicy,
          now,
        }),
      },
      {
        name: 'feedback',
        invoke: database => saveFeedback(database, {
          appId,
          userId,
          eventId,
          draft: { rating: 5, body: '活动反馈' },
          participationAccessPolicy: accessPolicy,
          now,
        }),
      },
    ]
    let calls
    let accessPolicy
    for (const entry of cases) {
      calls = []
      accessPolicy = {
        async requireAccess(queryable, policyAppId, policyUserId) {
          calls.push({ kind: 'policy', queryable, policyAppId, policyUserId })
          throw accessFailure
        },
      }
      const tx = {
        async one(sql) {
          calls.push({ kind: 'one', sql })
          if (sql.includes('FROM mip_users')) return { id: userId, status: 'ACTIVE' }
          throw new Error(`unexpected ${entry.name} read: ${sql}`)
        },
        async query(sql) {
          calls.push({ kind: 'query', sql })
          if (sql.includes('INSERT INTO mip_idempotency_keys')) return { affectedRows: 1 }
          throw new Error(`unexpected ${entry.name} write: ${sql}`)
        },
      }
      await assert.rejects(
        () => entry.invoke({ transaction: work => work(tx) }),
        error => error === accessFailure,
      )
      const policyCall = calls.find(call => call.kind === 'policy')
      assert.ok(policyCall, `${entry.name} must load participation access`)
      assert.equal(policyCall.queryable, tx)
      assert.equal(policyCall.policyAppId, appId)
      assert.equal(policyCall.policyUserId, userId)
      assert.equal(calls.some(call => /mip_event_(?:registrations|hearts|feedback)/.test(call.sql || '')), false)
    }
  })
})
