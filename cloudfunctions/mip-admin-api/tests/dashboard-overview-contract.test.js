'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createDashboardOverview } = require('../domain/dashboard-overview')

const APP_ID = 'wx-dashboard'
const ACTOR_USER_ID = '10000000-0000-4000-8000-000000000001'
const BRANCH_ID = '20000000-0000-4000-8000-000000000002'
const EVENT_ID = '30000000-0000-4000-8000-000000000003'
const AS_OF = new Date('2026-08-25T12:00:00.000Z')

function snapshot() {
  return {
    scope: { type: 'AUTHORIZED', id: null },
    people: { availability: 'RESTRICTED' },
    membership: { availability: 'RESTRICTED' },
    events: { availability: 'RESTRICTED' },
    opportunities: { availability: 'RESTRICTED' },
    tasks: { availability: 'RESTRICTED' },
    operations: { availability: 'RESTRICTED' },
  }
}

function fixture(options = {}) {
  const calls = []
  const audits = []
  const sessionCalls = []
  const defaultSession = {
    caller: { appId: APP_ID, userId: ACTOR_USER_ID },
    bindings: [{ roleKey: 'PLATFORM_OWNER', scopeType: 'PLATFORM', scopeId: null }],
  }
  const access = {
    audit(context, grant, input) {
      return {
        appId: context.caller.appId,
        actorUserId: context.caller.userId,
        effectiveRole: grant.roleKey,
        ...input,
      }
    },
    async session(input) {
      sessionCalls.push(input)
      if (options.sessionError) {
        throw options.sessionError
      }
      return options.session
        ? {
            ...defaultSession,
            ...options.session,
            caller: { ...defaultSession.caller, ...options.session.caller },
          }
        : defaultSession
    },
  }
  const repository = {
    async recordAudit(input) {
      audits.push(input)
    },
    async readOverviewSnapshot(input) {
      calls.push(input)
      if (options.error) {
        throw options.error
      }
      return options.snapshot === undefined ? snapshot() : options.snapshot
    },
  }
  const module = createDashboardOverview({
    access,
    repository,
    clock: () => options.asOf || AS_OF,
  })
  return { audits, calls, module, sessionCalls }
}

function caller() {
  return { appId: APP_ID, actorUserId: ACTOR_USER_ID }
}

describe('dashboard overview neutral v1 contract', () => {
  it('keeps one deep read interface with authorized month defaults', async () => {
    const { audits, calls, module, sessionCalls } = fixture()
    assert.deepEqual(Object.keys(module), ['getOverview'])

    const result = await module.getOverview(caller(), {})

    assert.equal(result.schemaVersion, 1)
    assert.equal(result.asOf, AS_OF.toISOString())
    assert.equal(result.timeZone, 'Asia/Shanghai')
    assert.deepEqual(result.scope, { type: 'AUTHORIZED', id: null })
    assert.deepEqual(result.period, {
      preset: 'THIS_MONTH',
      startAt: '2026-07-31T16:00:00.000Z',
      endAt: AS_OF.toISOString(),
      comparisonStartAt: '2026-07-06T20:00:00.000Z',
      comparisonEndAt: '2026-07-31T16:00:00.000Z',
      granularity: 'DAY',
    })
    assert.equal(calls.length, 1)
    assert.deepEqual(sessionCalls, [caller()])
    assert.equal(calls[0].appId, APP_ID)
    assert.equal(calls[0].actorUserId, ACTOR_USER_ID)
    assert.deepEqual(calls[0].scope, { type: 'AUTHORIZED', id: null })
    assert.equal(calls[0].period.startAt.toISOString(), result.period.startAt)
    assert.equal(calls[0].period.endAt.toISOString(), result.period.endAt)
    assert.deepEqual(calls[0].period.bucketStartDates.slice(0, 2), [
      '2026-08-01',
      '2026-08-02',
    ])
    assert.equal(calls[0].period.bucketStartDates.at(-1), '2026-08-25')
    assert.deepEqual(audits, [{
      appId: APP_ID,
      actorUserId: ACTOR_USER_ID,
      scopeType: 'PLATFORM',
      scopeId: null,
      action: 'admin.session.enter',
      resourceType: 'ADMIN_SESSION',
      effectiveRole: 'PLATFORM_OWNER',
      metadata: {},
    }])
  })

  it('normalizes explicit UUID scope without accepting client ownership facts', async () => {
    const { calls, module } = fixture()
    await module.getOverview(caller(), {
      scope: { type: 'BRANCH', id: BRANCH_ID.toUpperCase() },
      period: { preset: 'TODAY' },
    })
    assert.deepEqual(calls[0].scope, { type: 'BRANCH', id: BRANCH_ID })
    assert.equal(calls[0].period.startAt.toISOString(), '2026-08-24T16:00:00.000Z')
    assert.equal(calls[0].period.endAt.toISOString(), AS_OF.toISOString())
    assert.equal(calls[0].period.granularity, 'DAY')

    await module.getOverview(caller(), {
      scope: { type: 'EVENT', id: EVENT_ID },
      period: { preset: 'THIS_WEEK' },
    })
    assert.equal(calls[1].period.startAt.toISOString(), '2026-08-23T16:00:00.000Z')
  })

  it('uses inclusive Shanghai custom dates and clamps the current day to asOf', async () => {
    const { calls, module } = fixture()
    const result = await module.getOverview(caller(), {
      scope: { type: 'PLATFORM' },
      period: {
        preset: 'CUSTOM',
        startDate: '2026-06-01',
        endDate: '2026-08-25',
        granularity: 'WEEK',
      },
    })

    assert.deepEqual(result.period, {
      preset: 'CUSTOM',
      startAt: '2026-05-31T16:00:00.000Z',
      endAt: AS_OF.toISOString(),
      comparisonStartAt: '2026-03-06T20:00:00.000Z',
      comparisonEndAt: '2026-05-31T16:00:00.000Z',
      granularity: 'WEEK',
    })
    assert.equal(calls[0].period.bucketStartDates[0], '2026-06-01')
    assert.equal(calls[0].period.bucketStartDates.at(-1), '2026-08-24')
  })

  it('rejects unknown keys, forged trusted facts, and ambiguous scope shapes', async () => {
    const { calls, module } = fixture()
    const invalid = [
      { appId: 'forged' },
      { userId: ACTOR_USER_ID },
      { scope: { type: 'PLATFORM', id: BRANCH_ID } },
      { scope: { type: 'AUTHORIZED', extra: true } },
      { scope: { type: 'BRANCH', id: 'branch-a' } },
      { scope: { type: 'EVENT' } },
      { period: { preset: 'TODAY', startDate: '2026-08-25' } },
      { period: { preset: 'today' } },
    ]
    for (const input of invalid) {
      await assert.rejects(
        () => module.getOverview(caller(), input),
        error => error?.code === 'VALIDATION_FAILED',
      )
    }
    assert.equal(calls.length, 0)
  })

  it('rejects invalid, future, reversed, and oversized custom windows', async () => {
    const { calls, module } = fixture()
    const periods = [
      { preset: 'CUSTOM', startDate: '2026-02-29', endDate: '2026-03-01' },
      { preset: 'CUSTOM', startDate: '2026-08-26', endDate: '2026-08-26' },
      { preset: 'CUSTOM', startDate: '2026-08-10', endDate: '2026-08-01' },
      { preset: 'CUSTOM', startDate: '2025-08-24', endDate: '2026-08-25' },
      {
        preset: 'CUSTOM',
        startDate: '2026-01-01',
        endDate: '2026-08-25',
        granularity: 'DAY',
      },
      {
        preset: 'CUSTOM',
        startDate: '2026-01-01',
        endDate: '2026-08-25',
        granularity: 'WEEK',
      },
    ]
    for (const period of periods) {
      await assert.rejects(
        () => module.getOverview(caller(), { period }),
        error => error?.code === 'VALIDATION_FAILED',
      )
    }
    assert.equal(calls.length, 0)
  })

  it('fails closed for invalid clocks and incomplete repository snapshots', async () => {
    const invalidClock = fixture({ asOf: new Date('invalid') })
    await assert.rejects(
      () => invalidClock.module.getOverview(caller()),
      error => error?.code === 'DASHBOARD_OVERVIEW_CLOCK_INVALID',
    )
    const invalidSnapshot = fixture({ snapshot: { scope: {} } })
    await assert.rejects(
      () => invalidSnapshot.module.getOverview(caller()),
      error => error?.code === 'DASHBOARD_OVERVIEW_INVALID_STATE',
    )
  })

  it('preserves repository authorization failures without translating them into empty data', async () => {
    const forbidden = Object.assign(new Error('FORBIDDEN'), { code: 'FORBIDDEN' })
    const { module } = fixture({ error: forbidden })
    await assert.rejects(() => module.getOverview(caller()), error => error === forbidden)
  })

  it('applies the unified full-access session before reading repository facts', async () => {
    const agreementRequired = Object.assign(new Error('AGREEMENT_REQUIRED'), {
      code: 'AGREEMENT_REQUIRED',
    })
    const { calls, module, sessionCalls } = fixture({ sessionError: agreementRequired })

    await assert.rejects(() => module.getOverview(caller()), error => error === agreementRequired)

    assert.deepEqual(sessionCalls, [caller()])
    assert.equal(calls.length, 0)
  })

  it('uses only the identity resolved by the unified session', async () => {
    const { calls, module } = fixture({
      session: { caller: { appId: APP_ID, userId: ACTOR_USER_ID } },
    })

    await module.getOverview({
      appId: 'forged-app',
      actorUserId: 'forged-user',
      identityKey: 'trusted-by-access-only',
    })

    assert.equal(calls[0].appId, APP_ID)
    assert.equal(calls[0].actorUserId, ACTOR_USER_ID)
  })
})
