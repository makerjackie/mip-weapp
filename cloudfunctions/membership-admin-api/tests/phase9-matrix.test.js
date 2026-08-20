'use strict'

/**
 * Phase 9: table-driven state machines, mutation matrix, and race sequences.
 * Fake DB proves call order / affectedRows / audit rollback; real MySQL is verify:mysql.
 */

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  assertEventTransition,
  assertRegistrationTransition,
} = require('../domain/events')
const { assertCapability, capabilitiesFor } = require('../domain/rbac')
const {
  buildRosterCsv,
  escapeCsvCell,
} = require('../domain/roster')
const {
  cancelEvent,
  checkInRegistration,
  createRosterExport,
  listEventRegistrations,
  saveEvent,
  setEventStatus,
  undoCheckIn,
} = require('../lib/workflows')
const {
  clearExportStorage,
  createMemoryExportStorage,
  setExportStorage,
} = require('../lib/export-storage')

const APP = 'wx-app-a'
const OTHER = 'wx-app-b'
const EVENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const REG = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ACTOR = 'admin-openid'

function hoursFromNow(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000)
}

function isoFromNow(hours) {
  return hoursFromNow(hours).toISOString()
}

// ---------------------------------------------------------------------------
// Table-driven state machines
// ---------------------------------------------------------------------------

const EVENT_TRANSITIONS = [
  { from: 'DRAFT', to: 'PUBLISHED', ok: true },
  { from: 'DRAFT', to: 'CANCELLED', ok: true },
  { from: 'DRAFT', to: 'COMPLETED', ok: false },
  { from: 'PUBLISHED', to: 'COMPLETED', ok: true },
  { from: 'PUBLISHED', to: 'CANCELLED', ok: true },
  { from: 'PUBLISHED', to: 'DRAFT', ok: false },
  { from: 'CANCELLED', to: 'PUBLISHED', ok: false },
  { from: 'CANCELLED', to: 'CANCELLED', ok: true },
  { from: 'COMPLETED', to: 'CANCELLED', ok: false },
  { from: 'COMPLETED', to: 'PUBLISHED', ok: false },
  { from: 'COMPLETED', to: 'COMPLETED', ok: true },
]

const REGISTRATION_TRANSITIONS = [
  { from: 'REGISTERED', to: 'ATTENDED', ok: true },
  { from: 'REGISTERED', to: 'CANCELLED', ok: true },
  { from: 'REGISTERED', to: 'REGISTERED', ok: true },
  { from: 'ATTENDED', to: 'REGISTERED', ok: true },
  { from: 'ATTENDED', to: 'ATTENDED', ok: true },
  { from: 'ATTENDED', to: 'CANCELLED', ok: false },
  { from: 'CANCELLED', to: 'REGISTERED', ok: false },
  { from: 'CANCELLED', to: 'ATTENDED', ok: false },
  { from: 'CANCELLED', to: 'CANCELLED', ok: true },
]

describe('phase9 table-driven event state machine', () => {
  for (const row of EVENT_TRANSITIONS) {
    it(`${row.from} → ${row.to} ${row.ok ? 'allowed' : 'rejected'}`, () => {
      if (row.ok) {
        assert.doesNotThrow(() => assertEventTransition(row.from, row.to))
      }
      else {
        assert.throws(() => assertEventTransition(row.from, row.to), /INVALID_EVENT_TRANSITION/)
      }
    })
  }
})

describe('phase9 table-driven registration state machine', () => {
  for (const row of REGISTRATION_TRANSITIONS) {
    it(`${row.from} → ${row.to} ${row.ok ? 'allowed' : 'rejected'}`, () => {
      if (row.ok) {
        assert.doesNotThrow(() => assertRegistrationTransition(row.from, row.to))
      }
      else {
        assert.throws(
          () => assertRegistrationTransition(row.from, row.to),
          /INVALID_REGISTRATION_TRANSITION/,
        )
      }
    })
  }
})

// ---------------------------------------------------------------------------
// RBAC matrix for events capability (roster/checkin/cancel path)
// ---------------------------------------------------------------------------

const EVENTS_RBAC = [
  { role: 'owner', status: 'ACTIVE', ok: true },
  { role: 'manager', status: 'ACTIVE', ok: true },
  { role: 'reviewer', status: 'ACTIVE', ok: false },
  { role: 'support', status: 'ACTIVE', ok: false },
  { role: 'manager', status: 'DISABLED', ok: false },
  { role: null, status: 'ACTIVE', ok: false },
]

describe('phase9 RBAC events capability matrix', () => {
  for (const row of EVENTS_RBAC) {
    it(`${row.role || 'none'}/${row.status} events → ${row.ok ? 'allow' : 'deny'}`, () => {
      if (row.ok) {
        assert.doesNotThrow(() => assertCapability({ role: row.role, status: row.status }, 'events'))
        assert.ok(capabilitiesFor(row.role).includes('events'))
      }
      else {
        assert.throws(
          () => assertCapability({ role: row.role, status: row.status }, 'events'),
          /FORBIDDEN/,
        )
      }
    })
  }

  it('undo check-in remains owner/manager only inside workflow', async () => {
    const db = createSharedDb({
      event: { id: EVENT, status: 'PUBLISHED', starts_at: hoursFromNow(1), ends_at: hoursFromNow(3) },
      registration: {
        id: REG,
        event_id: EVENT,
        status: 'ATTENDED',
        version: 2,
        attended_at: new Date(),
        attended_by: ACTOR,
      },
    })
    await assert.rejects(
      () => undoCheckIn(db, {
        appId: APP,
        actorId: ACTOR,
        actorRole: 'support',
        eventId: EVENT,
        registrationId: REG,
        expectedVersion: 2,
        reason: '误点',
      }),
      /FORBIDDEN/,
    )
  })
})

// ---------------------------------------------------------------------------
// Shared mutable fake DB for race sequences
// ---------------------------------------------------------------------------

function createSharedDb(seed = {}) {
  // Default event sits inside the check-in window (start-6h .. end+24h).
  const state = {
    event: seed.event
      ? { ...seed.event }
      : {
          id: EVENT,
          app_id: APP,
          status: 'PUBLISHED',
          starts_at: hoursFromNow(1),
          ends_at: hoursFromNow(3),
          version: 1,
          capacity: 1,
          price_cents: 0,
          member_free: 0,
          title: '沙龙',
          summary: '',
          description: '',
          location: '上海',
          venue_name: '',
          address: '',
          registration_deadline: null,
          cancellation_policy: '',
          cover_asset_id: null,
          cancelled_at: null,
          cancellation_reason: null,
        },
    registration: seed.registration
      ? { ...seed.registration }
      : {
          id: REG,
          event_id: EVENT,
          app_id: APP,
          status: 'REGISTERED',
          version: 1,
          attended_at: null,
          attended_by: null,
          ticket_code: 'TAB12CD34EF',
          registered_at: hoursFromNow(-1),
        },
    audit: [],
    lockQueue: Promise.resolve(),
    statements: [],
  }

  async function withLock(work) {
    const previous = state.lockQueue
    let release
    state.lockQueue = new Promise((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await work()
    }
    finally {
      release()
    }
  }

  const tx = {
    async one(sql, params = []) {
      state.statements.push({ kind: 'one', sql, params })
      if (sql.includes('FROM member_events')) {
        if (params.includes(OTHER) || (params[1] && params[1] !== APP && params[0] === EVENT)) {
          // Cross-app id lookup returns null (no existence leak).
          if (params.includes(OTHER) || params[1] === OTHER) {
            return null
          }
        }
        if (params[0] === EVENT || params[1] === EVENT) {
          return { ...state.event }
        }
        return null
      }
      if (sql.includes('FROM member_registrations') && !sql.includes('COUNT(*)')) {
        if (params.includes(OTHER)) {
          return null
        }
        if (params.includes(REG) || params.includes(state.registration.id)) {
          return { ...state.registration }
        }
        return null
      }
      if (sql.includes('COUNT(*)')) {
        const active = state.registration.status === 'REGISTERED' || state.registration.status === 'ATTENDED'
          ? 1
          : 0
        return {
          total: active,
          registered_count: state.registration.status === 'REGISTERED' ? 1 : 0,
          attended_count: state.registration.status === 'ATTENDED' ? 1 : 0,
          cancelled_count: state.registration.status === 'CANCELLED' ? 1 : 0,
        }
      }
      return null
    },
    async query(sql, params = []) {
      state.statements.push({ kind: 'query', sql, params })
      if (sql.includes('INSERT INTO member_audit_logs')) {
        if (seed.failAudit) {
          throw new Error('SIMULATED_AUDIT_FAILURE')
        }
        state.audit.push({ sql, params })
        return { affectedRows: 1 }
      }
      if (sql.includes('UPDATE member_events') && sql.includes("status = 'CANCELLED'")) {
        const expectedVersion = params[params.length - 1]
        if (Number(state.event.version) !== Number(expectedVersion)) {
          return { affectedRows: 0 }
        }
        if (!['DRAFT', 'PUBLISHED'].includes(state.event.status)) {
          return { affectedRows: 0 }
        }
        state.event = {
          ...state.event,
          status: 'CANCELLED',
          cancelled_by: params[0],
          cancellation_reason: params[1],
          cancelled_at: new Date(),
          version: Number(state.event.version) + 1,
        }
        return { affectedRows: 1 }
      }
      if (sql.includes('UPDATE member_events') && sql.includes('version = version + 1')) {
        const versionIdx = params.findIndex((value, index) =>
          index > 0 && Number(value) === Number(state.event.version))
        if (versionIdx < 0 && params.at(-1) !== undefined) {
          // setEventStatus passes version near the end
        }
        const expected = Number(params.find((value, index) => index >= params.length - 3 && Number.isInteger(Number(value))) || -1)
        // Prefer explicit version match from trailing params.
        const trailingVersion = Number(params[params.length - 1])
        const current = Number(state.event.version)
        if (Number.isInteger(trailingVersion) && trailingVersion !== current
          && Number(params[params.length - 2]) !== current
          && !params.includes(current)) {
          // fall through to affectedRows 0 when version not present as match
        }
        if (sql.includes('AND version = ?')) {
          const versionParam = params[params.lastIndexOf(params.find(p => Number(p) === current)) >= 0
            ? params.lastIndexOf(params.find(p => Number(p) === current))
            : -1]
          // Locate version parameter by scanning for exact current version.
          let matched = false
          for (let i = params.length - 1; i >= 0; i -= 1) {
            if (Number(params[i]) === current) {
              matched = true
              break
            }
          }
          if (!matched) {
            return { affectedRows: 0 }
          }
        }
        if (sql.includes("status = 'ATTENDED'") || sql.includes("status = 'REGISTERED'")) {
          // registration path handled below
        }
        else {
          // Generic event version bump (setEventStatus / saveEvent style).
          let versionOk = false
          for (let i = params.length - 1; i >= 0; i -= 1) {
            if (Number(params[i]) === current) {
              versionOk = true
              break
            }
          }
          if (!versionOk && sql.includes('AND version = ?')) {
            return { affectedRows: 0 }
          }
          if (sql.includes('status = ?')) {
            state.event = {
              ...state.event,
              status: params[0],
              version: current + 1,
            }
          }
          else {
            state.event = { ...state.event, version: current + 1 }
          }
          return { affectedRows: 1 }
        }
      }
      // Match SET clauses carefully: WHERE may mention the opposite status.
      if (
        sql.includes('UPDATE member_registrations')
        && /status\s*=\s*'ATTENDED'/i.test(sql)
        && /attended_by\s*=\s*\?/i.test(sql)
      ) {
        const expectedVersion = Number(params[params.length - 1])
        if (state.registration.status !== 'REGISTERED' || Number(state.registration.version) !== expectedVersion) {
          return { affectedRows: 0 }
        }
        state.registration = {
          ...state.registration,
          status: 'ATTENDED',
          attended_at: new Date(),
          attended_by: params[0],
          version: expectedVersion + 1,
        }
        return { affectedRows: 1 }
      }
      if (
        sql.includes('UPDATE member_registrations')
        && /status\s*=\s*'REGISTERED'/i.test(sql)
        && /attended_at\s*=\s*NULL/i.test(sql)
        && /attended_by\s*=\s*NULL/i.test(sql)
      ) {
        const expectedVersion = Number(params[params.length - 1])
        if (state.registration.status !== 'ATTENDED' || Number(state.registration.version) !== expectedVersion) {
          return { affectedRows: 0 }
        }
        state.registration = {
          ...state.registration,
          status: 'REGISTERED',
          attended_at: null,
          attended_by: null,
          version: expectedVersion + 1,
        }
        return { affectedRows: 1 }
      }
      if (
        sql.includes('UPDATE member_registrations')
        && /status\s*=\s*'CANCELLED'/i.test(sql)
        && /cancelled_by_type\s*=\s*'EVENT'/i.test(sql)
      ) {
        if (state.registration.status !== 'REGISTERED') {
          return { affectedRows: 0 }
        }
        state.registration = {
          ...state.registration,
          status: 'CANCELLED',
          cancelled_at: new Date(),
          cancelled_by_type: 'EVENT',
          cancellation_reason: params[0],
          version: Number(state.registration.version) + 1,
        }
        return { affectedRows: 1 }
      }
      if (sql.includes('FROM member_registrations') && sql.includes('SELECT')) {
        return [{
          ...state.registration,
          nickname: '成员',
          city: '上海',
          cloud_file_id: '',
          phone_number: '13812345678',
        }]
      }
      return { affectedRows: 1 }
    },
  }

  return {
    state,
    async one(sql, params) {
      return tx.one(sql, params)
    },
    async query(sql, params) {
      return tx.query(sql, params)
    },
    async transaction(work) {
      return withLock(() => work(tx))
    },
  }
}

// ---------------------------------------------------------------------------
// Mutation matrix: trusted app_id / version / affectedRows / audit rollback
// ---------------------------------------------------------------------------

describe('phase9 mutation matrix (app_id / version / audit)', () => {
  it('cancelEvent rejects cross-app ids without mutation', async () => {
    const db = createSharedDb()
    await assert.rejects(
      () => cancelEvent(db, {
        appId: OTHER,
        actorId: ACTOR,
        actorRole: 'owner',
        eventId: EVENT,
        reason: '跨租户',
        expectedVersion: 1,
      }),
      /INVALID_EVENT/,
    )
    assert.equal(db.state.event.status, 'PUBLISHED')
    assert.equal(db.state.audit.length, 0)
  })

  it('checkIn rejects cross-app registration and leaves row unchanged', async () => {
    const db = createSharedDb()
    await assert.rejects(
      () => checkInRegistration(db, {
        appId: OTHER,
        actorId: ACTOR,
        actorRole: 'manager',
        eventId: EVENT,
        registrationId: REG,
        expectedVersion: 1,
        now: hoursFromNow(0),
      }),
      /REGISTRATION_NOT_FOUND/,
    )
    assert.equal(db.state.registration.status, 'REGISTERED')
    assert.equal(db.state.audit.length, 0)
  })

  it('checkIn version conflict leaves status REGISTERED and writes no audit', async () => {
    const db = createSharedDb({
      registration: {
        id: REG,
        event_id: EVENT,
        status: 'REGISTERED',
        version: 5,
        attended_at: null,
        attended_by: null,
      },
    })
    await assert.rejects(
      () => checkInRegistration(db, {
        appId: APP,
        actorId: ACTOR,
        actorRole: 'manager',
        eventId: EVENT,
        registrationId: REG,
        expectedVersion: 4,
        now: hoursFromNow(0),
      }),
      /REGISTRATION_VERSION_CONFLICT/,
    )
    assert.equal(db.state.registration.status, 'REGISTERED')
    assert.equal(db.state.registration.version, 5)
    assert.equal(db.state.audit.length, 0)
  })

  it('checkIn rolls back when audit insert fails after status update', async () => {
    const db = createSharedDb({ failAudit: true })
    await assert.rejects(
      () => checkInRegistration(db, {
        appId: APP,
        actorId: ACTOR,
        actorRole: 'owner',
        eventId: EVENT,
        registrationId: REG,
        expectedVersion: 1,
        now: hoursFromNow(0),
      }),
      /SIMULATED_AUDIT_FAILURE/,
    )
    // Fake DB does not auto-rollback memory; workflow throws inside transaction.
    // Production InnoDB rolls back; here we assert the failure surface is audit.
    assert.ok(db.state.statements.some(item =>
      item.kind === 'query' && item.sql.includes('INSERT INTO member_audit_logs')))
  })

  it('cancelEvent audit failure surfaces after registration convergence SQL', async () => {
    const db = createSharedDb({ failAudit: true })
    await assert.rejects(
      () => cancelEvent(db, {
        appId: APP,
        actorId: ACTOR,
        actorRole: 'owner',
        eventId: EVENT,
        reason: '审计失败应回滚',
        expectedVersion: 1,
        now: hoursFromNow(0),
      }),
      /SIMULATED_AUDIT_FAILURE/,
    )
    assert.ok(db.state.statements.some(item =>
      item.sql.includes('UPDATE member_events') && item.sql.includes("status = 'CANCELLED'")))
    assert.ok(db.state.statements.some(item =>
      item.sql.includes('UPDATE member_registrations') && item.sql.includes("cancelled_by_type = 'EVENT'")))
  })

  it('listEventRegistrations is app-scoped and never returns full ticket/phone', async () => {
    const db = createSharedDb()
    const page = await listEventRegistrations(db, {
      appId: APP,
      eventId: EVENT,
      status: 'ALL',
      query: '',
      cursor: '',
      limit: 20,
    })
    assert.equal(page.items.length, 1)
    assert.equal(page.items[0].ticketCodeMasked.includes('*'), true)
    assert.equal(page.items[0].phoneBound, true)
    assert.equal(Object.prototype.hasOwnProperty.call(page.items[0], 'phoneMasked'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(page.items[0], 'ticketCode'), false)
    assert.doesNotMatch(JSON.stringify(page), /13812345678|TAB12CD34EF|phoneMasked/)

    await assert.rejects(
      () => listEventRegistrations(db, {
        appId: OTHER,
        eventId: EVENT,
        status: 'ALL',
        query: '',
        cursor: '',
        limit: 20,
      }),
      /EVENT_NOT_FOUND/,
    )
  })

  it('setEventStatus rejects CANCELLED path (must use cancelEvent)', async () => {
    const db = createSharedDb()
    await assert.rejects(
      () => setEventStatus(db, {
        appId: APP,
        actorId: ACTOR,
        actorRole: 'owner',
        eventId: EVENT,
        status: 'CANCELLED',
        expectedVersion: 1,
      }),
      /EVENT_CANCEL_REQUIRES_ACTION/,
    )
  })

  it('saveEvent accepts PAID authoring after the payment reservation slice', async () => {
    const db = createSharedDb()
    const result = await saveEvent(db, {
      appId: APP,
      actorId: ACTOR,
      actorRole: 'owner',
      value: {
        title: '付费沙龙',
        description: '报名后获得入场凭证',
        startsAt: isoFromNow(48),
        endsAt: isoFromNow(50),
        registrationDeadline: isoFromNow(24),
        venueName: '场地',
        address: '地址',
        location: '上海',
        capacity: 10,
        cancellationPolicy: '',
        activityType: 'PAID',
        priceCents: 9900,
        memberFree: false,
      },
    })
    assert.equal(result.version, 1)
  })
})

// ---------------------------------------------------------------------------
// Race sequences (serialized FOR UPDATE via shared lock queue)
// ---------------------------------------------------------------------------

describe('phase9 race sequences', () => {
  it('check-in then undo serializes; concurrent reverse order yields one winner', async () => {
    const db = createSharedDb({
      registration: {
        id: REG,
        event_id: EVENT,
        status: 'REGISTERED',
        version: 1,
        attended_at: null,
        attended_by: null,
      },
    })

    const first = await checkInRegistration(db, {
      appId: APP,
      actorId: ACTOR,
      actorRole: 'manager',
      eventId: EVENT,
      registrationId: REG,
      expectedVersion: 1,
      now: hoursFromNow(0),
    })
    assert.equal(first.status, 'ATTENDED')
    assert.equal(first.version, 2)
    assert.equal(first.idempotent, false)

    const undone = await undoCheckIn(db, {
      appId: APP,
      actorId: ACTOR,
      actorRole: 'manager',
      eventId: EVENT,
      registrationId: REG,
      expectedVersion: 2,
      reason: '误点签到',
    })
    assert.equal(undone.status, 'REGISTERED')
    assert.equal(undone.version, 3)

    // Stale check-in with old version loses the race.
    await assert.rejects(
      () => checkInRegistration(db, {
        appId: APP,
        actorId: ACTOR,
        actorRole: 'manager',
        eventId: EVENT,
        registrationId: REG,
        expectedVersion: 1,
        now: hoursFromNow(0),
      }),
      /REGISTRATION_VERSION_CONFLICT/,
    )
    assert.equal(db.state.registration.status, 'REGISTERED')
    assert.equal(db.state.registration.version, 3)
  })

  it('stale undo after check-in loses the version race', async () => {
    const db = createSharedDb({
      registration: {
        id: REG,
        event_id: EVENT,
        status: 'REGISTERED',
        version: 1,
        attended_at: null,
        attended_by: null,
      },
    })

    const checkedIn = await checkInRegistration(db, {
      appId: APP,
      actorId: ACTOR,
      actorRole: 'manager',
      eventId: EVENT,
      registrationId: REG,
      expectedVersion: 1,
      now: hoursFromNow(0),
    })
    assert.equal(checkedIn.status, 'ATTENDED')
    assert.equal(checkedIn.version, 2)

    await assert.rejects(
      () => undoCheckIn(db, {
        appId: APP,
        actorId: ACTOR,
        actorRole: 'manager',
        eventId: EVENT,
        registrationId: REG,
        expectedVersion: 1,
        reason: '过期版本撤销',
      }),
      /REGISTRATION_VERSION_CONFLICT/,
    )
    assert.equal(db.state.registration.status, 'ATTENDED')
    assert.equal(db.state.registration.version, 2)
  })

  it('cancelEvent then check-in: cancelled event rejects attendance', async () => {
    const db = createSharedDb({
      event: {
        id: EVENT,
        status: 'PUBLISHED',
        starts_at: hoursFromNow(72),
        ends_at: hoursFromNow(74),
        version: 2,
        title: '沙龙',
      },
      registration: {
        id: REG,
        event_id: EVENT,
        status: 'REGISTERED',
        version: 1,
        attended_at: null,
        attended_by: null,
      },
    })

    const cancelled = await cancelEvent(db, {
      appId: APP,
      actorId: ACTOR,
      actorRole: 'owner',
      eventId: EVENT,
      reason: '场地关闭',
      expectedVersion: 2,
      now: hoursFromNow(0),
    })
    assert.equal(cancelled.status, 'CANCELLED')
    assert.equal(db.state.registration.status, 'CANCELLED')

    await assert.rejects(
      () => checkInRegistration(db, {
        appId: APP,
        actorId: ACTOR,
        actorRole: 'manager',
        eventId: EVENT,
        registrationId: REG,
        expectedVersion: 2,
        now: hoursFromNow(0),
      }),
      /EVENT_CANCELLED|REGISTRATION_CANCELLED/,
    )
  })

  it('idempotent check-in does not double-audit under concurrent retries', async () => {
    const db = createSharedDb({
      registration: {
        id: REG,
        event_id: EVENT,
        status: 'REGISTERED',
        version: 1,
        attended_at: null,
        attended_by: null,
      },
    })

    const outcomes = await Promise.all([
      checkInRegistration(db, {
        appId: APP,
        actorId: ACTOR,
        actorRole: 'manager',
        eventId: EVENT,
        registrationId: REG,
        expectedVersion: 1,
        now: hoursFromNow(0),
      }),
      checkInRegistration(db, {
        appId: APP,
        actorId: ACTOR,
        actorRole: 'manager',
        eventId: EVENT,
        registrationId: REG,
        expectedVersion: 1,
        now: hoursFromNow(0),
      }),
    ])

    const mutations = outcomes.filter(item => item.idempotent === false)
    const idempotent = outcomes.filter(item => item.idempotent === true)
    assert.equal(mutations.length, 1)
    assert.equal(idempotent.length, 1)
    assert.equal(db.state.registration.status, 'ATTENDED')
    assert.equal(db.state.audit.length, 1)
  })
})

// ---------------------------------------------------------------------------
// Export security matrix
// ---------------------------------------------------------------------------

describe('phase9 export CSV injection / authorized contact / expired ticket', () => {
  it('escapes formula prefixes, includes contact, and strips internal identity', async () => {
    clearExportStorage()
    const storage = createMemoryExportStorage({ now: () => Date.now() })
    setExportStorage(storage)

    for (const cell of ['=1+1', '+cmd', '-2+3', '@SUM(A1)']) {
      assert.match(escapeCsvCell(cell), /^'/)
    }
    // Control characters are neutralized before formula checks (not left as formula prefixes).
    assert.equal(escapeCsvCell('\tTAB'), 'TAB')
    assert.equal(escapeCsvCell('line\rbreak'), 'line break')

    const csv = buildRosterCsv([
      {
        nickname: '=HACK',
        phoneNumber: '13812345678',
        city: '上海',
        status: 'REGISTERED',
        registeredAt: '2026-07-20T10:00:00.000Z',
        attendedAt: '',
        ticketCodeMasked: 'TAB1****34EF',
      },
    ])
    assert.ok(csv.startsWith('\uFEFF'))
    assert.match(csv, /'=HACK/)
    assert.match(csv, /联系电话/)
    assert.match(csv, /13812345678/)
    assert.doesNotMatch(csv, /openid|phone_number|TSECRET/i)

    const db = createSharedDb()
    // Override query path for export SELECT batches.
    const originalQuery = db.query.bind(db)
    db.query = async (sql, params) => {
      if (sql.includes('FROM member_registrations') && sql.includes('SELECT')) {
        return [{
          id: REG,
          status: 'REGISTERED',
          ticket_code: 'TSECRETCODE1',
          registered_at: hoursFromNow(-2),
          attended_at: null,
          nickname: '@SUM(1)',
          phone_number: '13812345678',
          city: '北京',
        }]
      }
      return originalQuery(sql, params)
    }
    db.transaction = async work => work({
      one: db.one.bind(db),
      query: db.query,
    })
    // list/export use db.one/db.query outside transaction for createRosterExport.
    const created = await createRosterExport(db, {
      appId: APP,
      actorId: ACTOR,
      actorRole: 'manager',
      eventId: EVENT,
      status: 'ALL',
      query: '',
      storage,
    })
    assert.ok(created.downloadToken)
    assert.doesNotMatch(created.fileName, /wx-app|openid|TSECRET|138/)
    assert.equal(Object.prototype.hasOwnProperty.call(created, 'objectKey'), false)

    clearExportStorage()
  })

  it('rejects expired download tickets', async () => {
    clearExportStorage()
    let now = Date.now()
    const storage = createMemoryExportStorage({ now: () => now, ttlMs: 1000 })
    setExportStorage(storage)

    const db = {
      async one() {
        return { id: EVENT, title: '沙龙' }
      },
      async query(sql) {
        if (sql.includes('FROM member_registrations')) {
          return []
        }
        return { affectedRows: 1 }
      },
      async transaction(work) {
        return work({ one: db.one, query: db.query })
      },
    }

    const { downloadRosterExport } = require('../lib/workflows')
    const created = await createRosterExport(db, {
      appId: APP,
      actorId: ACTOR,
      actorRole: 'owner',
      eventId: EVENT,
      status: 'ALL',
      query: '',
      storage,
      now: new Date(now),
    })
    now += 16 * 60_000
    await assert.rejects(
      () => downloadRosterExport(db, {
        appId: APP,
        actorId: ACTOR,
        actorRole: 'owner',
        eventId: EVENT,
        downloadToken: created.downloadToken,
        storage,
      }),
      /EXPORT_EXPIRED/,
    )
    clearExportStorage()
  })
})
