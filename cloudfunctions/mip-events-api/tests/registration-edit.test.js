'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { describe, it } = require('node:test')
const {
  canEditRegistration,
  getMyRegistration,
  updateRegistration,
} = require('../domain/event-service')

const now = new Date('2026-08-24T00:00:00.000Z')

function eventRow(overrides = {}) {
  return {
    id: 'event-1',
    status: 'PUBLISHED',
    starts_at: '2026-08-26T00:00:00.000Z',
    registration_deadline: '2026-08-25T00:00:00.000Z',
    registration_schema_json: JSON.stringify([
      { key: 'role', label: '参与身份', type: 'SELECT', required: true, options: ['玩家', '嘉宾'] },
      { key: 'introduction', label: '自我介绍', type: 'TEXT', required: false, maxLength: 120 },
    ]),
    form_version: 2,
    ...overrides,
  }
}

function registrationRow(overrides = {}) {
  return {
    id: 'registration-1',
    status: 'PENDING_REVIEW',
    version: 4,
    form_version: 1,
    answers_json: JSON.stringify({ role: '嘉宾', introduction: '旧内容' }),
    share_profile: 0,
    ...overrides,
  }
}

function updateInput(overrides = {}) {
  return {
    eventId: 'event-1',
    formVersion: 2,
    expectedVersion: 4,
    answers: { role: ' 玩家 ', introduction: ' 新内容 ' },
    shareProfile: true,
    idempotencyKey: 'registration-update-request-1',
    ...overrides,
  }
}

function updateDatabase({ event = eventRow(), registration = registrationRow(), replay = null, affectedRows = 1 } = {}) {
  const calls = []
  const tx = {
    async one(sql, params) {
      calls.push({ kind: 'one', sql, params })
      if (sql.includes('FROM mip_users')) {
        return { id: 'user-1', status: 'ACTIVE' }
      }
      if (sql.includes('FROM mip_idempotency_keys')) {
        return replay
      }
      if (sql.includes('FROM mip_events')) {
        return event
      }
      if (sql.includes('FROM mip_event_registrations')) {
        return registration
      }
      throw new Error(`unexpected one query: ${sql}`)
    },
    async query(sql, params) {
      calls.push({ kind: 'query', sql, params })
      if (sql.includes('INSERT INTO mip_idempotency_keys') && replay) {
        const duplicate = new Error('duplicate')
        duplicate.errno = 1062
        throw duplicate
      }
      if (sql.includes('UPDATE mip_event_registrations SET')) {
        return { affectedRows }
      }
      return { affectedRows: 1 }
    },
  }
  return {
    calls,
    database: { transaction: work => work(tx) },
  }
}

async function rejectCode(work, code) {
  await assert.rejects(work, error => error?.code === code)
}

describe('MIP registration edit eligibility', () => {
  it('accepts only the three editable statuses', () => {
    const event = eventRow()
    for (const status of ['PENDING_REVIEW', 'WAITLISTED', 'REGISTERED']) {
      assert.equal(canEditRegistration(event, status, now), true)
    }
    for (const status of ['ATTENDED', 'CANCELLED', 'REJECTED', 'PAYMENT_PENDING', 'CANCELLATION_PENDING']) {
      assert.equal(canEditRegistration(event, status, now), false)
    }
  })

  it('uses the registration deadline for confirmed registrations and starts_at as its fallback', () => {
    assert.equal(canEditRegistration(eventRow(), 'REGISTERED', new Date('2026-08-24T23:59:59.999Z')), true)
    assert.equal(canEditRegistration(eventRow(), 'REGISTERED', new Date('2026-08-25T00:00:00.000Z')), false)
    const fallback = eventRow({ registration_deadline: null })
    assert.equal(canEditRegistration(fallback, 'REGISTERED', new Date('2026-08-25T23:59:59.999Z')), true)
    assert.equal(canEditRegistration(fallback, 'REGISTERED', new Date('2026-08-26T00:00:00.000Z')), false)
  })

  it('requires pending and waitlisted registrations to remain published and before activity start', () => {
    assert.equal(canEditRegistration(eventRow({ status: 'UNPUBLISHED' }), 'PENDING_REVIEW', now), false)
    assert.equal(canEditRegistration(eventRow({ status: 'CANCELLED' }), 'WAITLISTED', now), false)
    assert.equal(canEditRegistration(eventRow(), 'PENDING_REVIEW', new Date('2026-08-26T00:00:00.000Z')), false)
  })
})

describe('MIP protected registration read', () => {
  it('is app/user scoped and returns only the editable private snapshot', async () => {
    let call
    const result = await getMyRegistration({
      async one(sql, params) {
        call = { sql, params }
        return {
          ...registrationRow(),
          event_status: 'PUBLISHED',
          registration_deadline: '2026-08-25T00:00:00.000Z',
          starts_at: '2026-08-26T00:00:00.000Z',
          user_id: 'must-not-leak',
          openid: 'must-not-leak',
          ticket_hash: 'must-not-leak',
        }
      },
    }, { appId: 'wx-app', userId: 'user-1', eventId: 'event-1', now })

    assert.match(call.sql, /WHERE r\.app_id = \? AND r\.event_id = \? AND r\.user_id = \?/)
    assert.deepEqual(call.params, ['wx-app', 'event-1', 'user-1'])
    assert.deepEqual(Object.keys(result).sort(), [
      'answers',
      'canEdit',
      'formVersion',
      'orderId',
      'shareProfile',
      'status',
      'version',
    ])
    assert.equal(JSON.stringify(result).includes('must-not-leak'), false)
  })

  it('returns null when the trusted caller has no registration for the event', async () => {
    const result = await getMyRegistration({ one: async () => null }, {
      appId: 'wx-app',
      userId: 'user-1',
      eventId: 'event-1',
      now,
    })
    assert.equal(result, null)
  })

  it('keeps both read and mutation actions behind the existing trusted user handler', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')
    const userActionSlice = source.slice(source.indexOf('const userActions'), source.indexOf('const adminActions'))
    assert.match(userActionSlice, /'mip\.events\.myRegistration'/)
    assert.match(userActionSlice, /'mip\.events\.updateRegistration'/)
    assert.match(source, /requireUser: !publicActions\.has\(action\)/)
    assert.match(source, /requireCaller: \['mip\.events\.resolveCheckInScene', 'mip\.events\.checkIn'\]\.includes\(action\)/)
    assert.match(source, /getMyRegistration\(mysqlDatabase\(\), \{ \.\.\.shared, eventId: event\.eventId \}\)/)
    assert.match(source, /updateRegistration\(mysqlDatabase\(\), \{ \.\.\.shared, input: event, participationAccessPolicy \}\)/)
  })
})

describe('MIP registration mutation', () => {
  it('locks app-scoped event and registration, validates the current schema, and writes an audit', async () => {
    const { database, calls } = updateDatabase()
    const result = await updateRegistration(database, {
      appId: 'wx-app',
      userId: 'user-1',
      participationAccessPolicy: { requireAccess: async () => ({}) },
      input: updateInput(),
      now,
    })

    assert.deepEqual(result, {
      status: 'PENDING_REVIEW',
      orderId: undefined,
      version: 5,
      formVersion: 2,
      answers: { role: '玩家', introduction: '新内容' },
      shareProfile: true,
      canEdit: true,
    })
    const eventLock = calls.find(call => call.kind === 'one' && call.sql.includes('FROM mip_events'))
    const registrationLock = calls.find(call => call.kind === 'one' && call.sql.includes('FROM mip_event_registrations'))
    const update = calls.find(call => call.kind === 'query' && call.sql.includes('UPDATE mip_event_registrations SET'))
    assert.match(eventLock.sql, /WHERE app_id = \? AND id = \? FOR UPDATE/)
    assert.deepEqual(eventLock.params, ['wx-app', 'event-1'])
    assert.match(registrationLock.sql, /WHERE app_id = \? AND event_id = \? AND user_id = \? FOR UPDATE/)
    assert.deepEqual(registrationLock.params, ['wx-app', 'event-1', 'user-1'])
    assert.match(update.sql, /app_id = \? AND event_id = \? AND user_id = \? AND id = \? AND version = \?/)
    assert.deepEqual(update.params.slice(3), ['wx-app', 'event-1', 'user-1', 'registration-1', 4])
    const audit = calls.find(call => call.kind === 'query' && call.sql.includes('INSERT INTO mip_audit_logs'))
    assert.ok(audit.params.includes('EVENT_REGISTRATION_UPDATED'))
    assert.equal(calls.some(call => call.sql.includes('mip_outbox_events')), false)
  })

  it('rejects every non-editable registration status', async () => {
    for (const status of ['ATTENDED', 'CANCELLED', 'REJECTED', 'PAYMENT_PENDING', 'CANCELLATION_PENDING']) {
      const { database } = updateDatabase({ registration: registrationRow({ status }) })
      await rejectCode(() => updateRegistration(database, {
        appId: 'wx-app',
        userId: 'user-1',
        participationAccessPolicy: { requireAccess: async () => ({}) },
        input: updateInput({ idempotencyKey: `status-${status}` }),
        now,
      }), 'CONFLICT')
    }
  })

  it('rejects stale registration and form versions before writing', async () => {
    const staleRegistration = updateDatabase({ registration: registrationRow({ version: 5 }) })
    await rejectCode(() => updateRegistration(staleRegistration.database, {
      appId: 'wx-app', userId: 'user-1', input: updateInput(), now,
      participationAccessPolicy: { requireAccess: async () => ({}) },
    }), 'CONFLICT')
    assert.equal(staleRegistration.calls.some(call => call.sql.includes('UPDATE mip_event_registrations SET')), false)

    const staleForm = updateDatabase({ event: eventRow({ form_version: 3 }) })
    await rejectCode(() => updateRegistration(staleForm.database, {
      appId: 'wx-app', userId: 'user-1', input: updateInput(), now,
      participationAccessPolicy: { requireAccess: async () => ({}) },
    }), 'CONFLICT')
    assert.equal(staleForm.calls.some(call => call.sql.includes('UPDATE mip_event_registrations SET')), false)
  })

  it('validates answers against the currently locked event schema', async () => {
    const { database, calls } = updateDatabase()
    await rejectCode(() => updateRegistration(database, {
      appId: 'wx-app',
      userId: 'user-1',
      participationAccessPolicy: { requireAccess: async () => ({}) },
      input: updateInput({ answers: { role: '观察员', introduction: '' } }),
      now,
    }), 'VALIDATION_FAILED')
    assert.equal(calls.some(call => call.sql.includes('UPDATE mip_event_registrations SET')), false)
  })

  it('turns a lost conditional update into a retryable version conflict', async () => {
    const { database } = updateDatabase({ affectedRows: 0 })
    await assert.rejects(() => updateRegistration(database, {
      appId: 'wx-app', userId: 'user-1', input: updateInput(), now,
      participationAccessPolicy: { requireAccess: async () => ({}) },
    }), error => error?.code === 'CONFLICT' && error?.retryable === true)
  })

  it('replays a completed identical request without locking or rewriting registration facts', async () => {
    const response = {
      status: 'WAITLISTED',
      version: 8,
      formVersion: 2,
      answers: { role: '玩家', introduction: '新内容' },
      shareProfile: true,
      canEdit: true,
    }
    const request = updateInput()
    const hash = require('node:crypto').createHash('sha256').update(JSON.stringify({
      eventId: request.eventId,
      formVersion: request.formVersion,
      expectedVersion: request.expectedVersion,
      answers: request.answers,
      shareProfile: request.shareProfile,
    })).digest('hex')
    const { database, calls } = updateDatabase({
      replay: { request_hash: hash, status: 'COMPLETED', response_json: JSON.stringify(response) },
    })
    const result = await updateRegistration(database, {
      appId: 'wx-app', userId: 'user-1', input: request, now,
    })
    assert.deepEqual(result, response)
    assert.equal(calls.some(call => call.sql.includes('FROM mip_events')), false)
    assert.equal(calls.some(call => call.sql.includes('UPDATE mip_event_registrations SET')), false)
  })
})
