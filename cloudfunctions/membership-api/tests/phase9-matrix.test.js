'use strict'

/**
 * Phase 9: register / member-cancel matrix and last-seat race sequences.
 */

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { cancelEventRegistration, registerForEvent } = require('../lib/workflows')

const APP = 'wx-app'
const OTHER = 'wx-other'
const EVENT = 'event-1'
const USER_A = 'user-a'
const USER_B = 'user-b'

function hoursFromNow(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000)
}

/**
 * In-memory transactional fake that serializes FOR UPDATE via a promise queue.
 * Capacity is the count of seat-holding rows for the event.
 */
function createRaceDb({ capacity = 1, eventStatus = 'PUBLISHED' } = {}) {
  const registrations = new Map()
  const event = {
    id: EVENT,
    capacity,
    price_cents: 0,
    member_free: 0,
    registration_deadline: null,
    status: eventStatus,
    starts_at: hoursFromNow(48).toISOString(),
  }
  const phones = new Set([USER_A, USER_B])
  let lock = Promise.resolve()
  const calls = []

  async function withLock(work) {
    const previous = lock
    let release
    lock = new Promise((resolve) => {
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

  function activeCount() {
    let total = 0
    for (const row of registrations.values()) {
      if (['REGISTERED', 'CANCELLATION_PENDING', 'ATTENDED'].includes(row.status)) {
        total += 1
      }
    }
    return total
  }

  const tx = {
    async one(sql, params = []) {
      calls.push({ kind: 'one', sql, params })
      if (sql.includes('FROM member_events') && sql.includes('FOR UPDATE')) {
        if (params[1] !== APP) {
          return null
        }
        return { ...event }
      }
      if (sql.includes('FROM member_events') && sql.includes('FOR SHARE')) {
        if (params[0] !== APP || params[1] !== EVENT) {
          return null
        }
        if (new Date(event.starts_at).getTime() <= Date.now()) {
          return null
        }
        return { id: EVENT, status: event.status, starts_at: event.starts_at }
      }
      if (sql.includes('member_registrations') && sql.includes('user_id') && sql.includes('FOR UPDATE')) {
        const key = `${params[0]}:${params[1]}:${params[2]}`
        return registrations.get(key) ? { ...registrations.get(key) } : null
      }
      if (sql.includes('member_private_profiles')) {
        return phones.has(params[1]) ? { phone_number: '13800000000' } : null
      }
      if (sql.includes('member_entitlements')) {
        return { id: 'ent-1' }
      }
      if (sql.includes('COUNT(*)')) {
        return { total: activeCount() }
      }
      if (sql.includes('SELECT ticket_code FROM member_registrations')) {
        const row = [...registrations.values()].find(item => item.id === params[0])
        return row ? { ticket_code: row.ticket_code } : null
      }
      return null
    },
    async query(sql, params = []) {
      calls.push({ kind: 'query', sql, params })
      if (sql.includes('INSERT INTO member_registrations')) {
        const [id, appId, eventId, userId, status, ticketCode] = params
        const key = `${appId}:${eventId}:${userId}`
        if (registrations.has(key)) {
          throw new Error('ER_DUP_ENTRY')
        }
        if (activeCount() >= event.capacity) {
          // Simulate capacity race loss after COUNT under lock — should not happen if lock is correct.
          return { affectedRows: 0 }
        }
        registrations.set(key, {
          id,
          status,
          ticket_code: ticketCode,
          version: 1,
        })
        return { affectedRows: 1 }
      }
      // Member cancel: SET status='CANCELLED' ... WHERE status='REGISTERED'
      if (
        sql.includes('UPDATE member_registrations')
        && /status\s*=\s*'CANCELLED'/i.test(sql)
        && /status\s*=\s*'REGISTERED'/i.test(sql)
        && !/cancelled_by_type\s*=\s*NULL/i.test(sql)
      ) {
        const key = `${params[0]}:${params[1]}:${params[2]}`
        const row = registrations.get(key)
        if (!row || row.status !== 'REGISTERED') {
          return { affectedRows: 0 }
        }
        row.status = 'CANCELLED'
        row.version = Number(row.version || 1) + 1
        return { affectedRows: 1 }
      }
      // Reactivation uses a parameterized next status and accepts cancelled/rejected facts.
      if (
        sql.includes('UPDATE member_registrations')
        && /status\s*=\s*\?/i.test(sql)
        && /status IN \('CANCELLED', 'REJECTED'\)/i.test(sql)
      ) {
        const key = `${params[7]}:${params[8]}:${params[9]}`
        const row = registrations.get(key)
        if (!row || !['CANCELLED', 'REJECTED'].includes(row.status)) {
          return { affectedRows: 0 }
        }
        row.status = params[0]
        row.version = Number(row.version || 1) + 1
        row.ticket_code = row.ticket_code || params[2]
        return { affectedRows: 1 }
      }
      if (sql.includes('UPDATE member_registrations') && sql.includes('ticket_code')) {
        const row = [...registrations.values()].find(item => item.id === params[1])
        if (!row) {
          return { affectedRows: 0 }
        }
        if (!row.ticket_code) {
          row.ticket_code = params[0]
          return { affectedRows: 1 }
        }
        return { affectedRows: 0 }
      }
      return { affectedRows: 1 }
    },
  }

  return {
    calls,
    registrations,
    event,
    cancelEvent() {
      event.status = 'CANCELLED'
    },
    seed(userId, status = 'REGISTERED') {
      const suffix = userId === USER_A ? 'AAAAAAAAAA' : 'BBBBBBBBBB'
      registrations.set(`${APP}:${EVENT}:${userId}`, {
        id: `reg-${userId}`,
        status,
        ticket_code: `T${suffix}`,
        version: 1,
      })
    },
    async transaction(work) {
      return withLock(() => work(tx))
    },
  }
}

const REGISTER_CASES = [
  {
    name: 'new user on open free event',
    setup: db => db,
    userId: USER_A,
    expect: { status: 'REGISTERED' },
  },
  {
    name: 'already REGISTERED is idempotent',
    setup: (db) => {
      db.seed(USER_A, 'REGISTERED')
      return db
    },
    userId: USER_A,
    expect: { status: 'REGISTERED', sameId: true },
  },
  {
    name: 'already ATTENDED stays ATTENDED',
    setup: (db) => {
      db.seed(USER_A, 'ATTENDED')
      return db
    },
    userId: USER_A,
    expect: { status: 'ATTENDED', sameId: true },
  },
  {
    name: 'CANCELLED reactivates when capacity remains',
    setup: (db) => {
      db.seed(USER_A, 'CANCELLED')
      return db
    },
    userId: USER_A,
    expect: { status: 'REGISTERED', sameId: true },
  },
]

describe('phase9 register state table', () => {
  for (const row of REGISTER_CASES) {
    it(row.name, async () => {
      const db = row.setup(createRaceDb({ capacity: 2 }))
      const before = db.registrations.get(`${APP}:${EVENT}:${row.userId}`)
      const result = await registerForEvent(db, {
        appId: APP,
        userId: row.userId,
        eventId: EVENT,
      })
      assert.equal(result.status, row.expect.status)
      if (row.expect.sameId && before) {
        assert.equal(result.id, before.id)
      }
      assert.match(result.ticketCode, /^T[A-F0-9]+$/i)
    })
  }

  it('rejects cross-app event as EVENT_NOT_AVAILABLE', async () => {
    const db = createRaceDb()
    await assert.rejects(
      () => registerForEvent(db, { appId: OTHER, userId: USER_A, eventId: EVENT }),
      /EVENT_NOT_AVAILABLE/,
    )
  })

  it('rejects new registration when full', async () => {
    const db = createRaceDb({ capacity: 1 })
    db.seed(USER_A, 'REGISTERED')
    await assert.rejects(
      () => registerForEvent(db, { appId: APP, userId: USER_B, eventId: EVENT }),
      /EVENT_FULL/,
    )
  })

  it('rejects CANCELLED reactivation when full', async () => {
    const db = createRaceDb({ capacity: 1 })
    db.seed(USER_A, 'REGISTERED')
    db.seed(USER_B, 'CANCELLED')
    await assert.rejects(
      () => registerForEvent(db, { appId: APP, userId: USER_B, eventId: EVENT }),
      /EVENT_FULL/,
    )
  })
})

describe('phase9 last-seat race sequence', () => {
  it('serializes two concurrent registrations so only one occupies the last seat', async () => {
    const db = createRaceDb({ capacity: 1 })
    const results = await Promise.allSettled([
      registerForEvent(db, { appId: APP, userId: USER_A, eventId: EVENT }),
      registerForEvent(db, { appId: APP, userId: USER_B, eventId: EVENT }),
    ])
    const ok = results.filter(item => item.status === 'fulfilled')
    const fail = results.filter(item => item.status === 'rejected')
    assert.equal(ok.length, 1, 'exactly one registration must succeed')
    assert.equal(fail.length, 1, 'the other must fail')
    assert.match(String(fail[0].reason), /EVENT_FULL/)
    assert.equal(ok[0].value.status, 'REGISTERED')

    let active = 0
    for (const row of db.registrations.values()) {
      if (row.status === 'REGISTERED' || row.status === 'ATTENDED') {
        active += 1
      }
    }
    assert.equal(active, 1)
  })

  it('member cancel then re-register reclaims a seat after capacity frees', async () => {
    const db = createRaceDb({ capacity: 1 })
    await registerForEvent(db, { appId: APP, userId: USER_A, eventId: EVENT })
    await cancelEventRegistration(db, { appId: APP, userId: USER_A, eventId: EVENT })
    const again = await registerForEvent(db, { appId: APP, userId: USER_B, eventId: EVENT })
    assert.equal(again.status, 'REGISTERED')
  })

  it('host-cancelled event blocks new member cancel path as EVENT_CLOSED', async () => {
    const db = createRaceDb()
    db.seed(USER_A, 'REGISTERED')
    db.cancelEvent()
    await assert.rejects(
      () => cancelEventRegistration(db, { appId: APP, userId: USER_A, eventId: EVENT }),
      /EVENT_CLOSED/,
    )
  })

  it('locks event before registration and capacity COUNT for new inserts', async () => {
    const db = createRaceDb({ capacity: 2 })
    await registerForEvent(db, { appId: APP, userId: USER_A, eventId: EVENT })
    const eventIdx = db.calls.findIndex(call =>
      call.kind === 'one' && call.sql.includes('FROM member_events') && call.sql.includes('FOR UPDATE'))
    const regIdx = db.calls.findIndex(call =>
      call.kind === 'one' && call.sql.includes('user_id') && call.sql.includes('FOR UPDATE'))
    const countIdx = db.calls.findIndex(call => call.sql.includes('COUNT(*)'))
    assert.ok(eventIdx >= 0)
    assert.ok(regIdx > eventIdx)
    assert.ok(countIdx > regIdx)
  })
})
