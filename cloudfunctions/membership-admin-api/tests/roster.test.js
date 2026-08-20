'use strict'

const assert = require('node:assert/strict')
const { describe, it, beforeEach, afterEach } = require('node:test')
const {
  buildRosterCsv,
  classifyRosterQuery,
  clampLimit,
  decodeRosterCursor,
  encodeRosterCursor,
  escapeCsvCell,
  isWithinCheckInWindow,
  maskPhone,
  maskTicketCode,
  normalizeRosterQuery,
  normalizeRosterStatus,
} = require('../domain/roster')
const {
  clearExportStorage,
  createMemoryExportStorage,
  requireExportStorage,
  setExportStorage,
} = require('../lib/export-storage')
const {
  checkInRegistration,
  createRosterExport,
  downloadRosterExport,
  listEventRegistrations,
  undoCheckIn,
} = require('../lib/workflows')

const APP_ID = 'wx-app-a'
const OTHER_APP = 'wx-app-b'
const EVENT_ID = '11111111-1111-4111-8111-111111111111'
const REG_ID = '22222222-2222-4222-8222-222222222222'
const ACTOR = 'admin-openid'

function hoursFromNow(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000)
}

function createFakeDb(handlers) {
  const statements = []
  const tx = {
    async one(sql, params = []) {
      statements.push({ kind: 'one', sql, params })
      return handlers.one ? handlers.one(sql, params, statements) : null
    },
    async query(sql, params = []) {
      statements.push({ kind: 'query', sql, params })
      return handlers.query ? handlers.query(sql, params, statements) : { affectedRows: 1 }
    },
  }
  return {
    statements,
    async one(sql, params = []) {
      return tx.one(sql, params)
    },
    async query(sql, params = []) {
      return tx.query(sql, params)
    },
    async transaction(work) {
      return work(tx)
    },
  }
}

describe('roster domain helpers', () => {
  it('masks phone and ticket codes without exposing full values', () => {
    assert.equal(maskPhone('13812345678'), '138****5678')
    assert.equal(maskTicketCode('TAB12CD34EF'), 'TAB1****34EF')
    assert.equal(maskTicketCode('SHORT'), 'SH****')
  })

  it('classifies search intents and keeps alphabetic nicknames as profile search', () => {
    assert.deepEqual(classifyRosterQuery('13812345678'), { kind: 'phone', value: '13812345678' })
    assert.deepEqual(classifyRosterQuery('TAB12CD34EF'), { kind: 'ticket', value: 'TAB12CD34EF' })
    // Ordinary letter nickname is profile search, not ticket.
    assert.deepEqual(classifyRosterQuery('Jackie'), { kind: 'profile', value: 'Jackie' })
    assert.deepEqual(classifyRosterQuery('上海'), { kind: 'profile', value: '上海' })
    assert.throws(() => normalizeRosterQuery('a'), /INVALID_ROSTER_QUERY/)
    assert.equal(normalizeRosterStatus('ATTENDED'), 'ATTENDED')
    assert.throws(() => normalizeRosterStatus('DONE'), /INVALID_ROSTER_STATUS/)
    assert.equal(clampLimit(999), 50)
  })

  it('round-trips stable roster cursors bound to query signature', () => {
    const registeredAt = new Date('2026-07-20T10:00:00.000Z')
    const {
      rosterCursorSignature,
      escapeLikePattern,
      STATUS_SORT_RANK,
    } = require('../domain/roster')
    const signature = rosterCursorSignature({
      appId: APP_ID,
      eventId: EVENT_ID,
      status: 'ALL',
      query: '',
    })
    // Signature must include event/filter/query/sort so cross-filter cursors cannot be reused.
    assert.notEqual(
      signature,
      rosterCursorSignature({
        appId: APP_ID,
        eventId: EVENT_ID,
        status: 'REGISTERED',
        query: '',
      }),
    )
    assert.notEqual(
      signature,
      rosterCursorSignature({
        appId: APP_ID,
        eventId: EVENT_ID,
        status: 'ALL',
        query: '上海',
      }),
    )
    assert.equal(STATUS_SORT_RANK.REGISTERED < STATUS_SORT_RANK.ATTENDED, true)
    assert.equal(STATUS_SORT_RANK.ATTENDED < STATUS_SORT_RANK.CANCELLED, true)
    const cursor = encodeRosterCursor({
      registeredAt,
      id: REG_ID,
      status: 'REGISTERED',
      signature,
    })
    const decoded = decodeRosterCursor(cursor, signature)
    assert.equal(decoded.id, REG_ID)
    assert.equal(decoded.rank, STATUS_SORT_RANK.REGISTERED)
    assert.throws(() => decodeRosterCursor(cursor, '0'.repeat(16)), /INVALID_ROSTER_CURSOR/)
    assert.throws(() => decodeRosterCursor('not-base64'), /INVALID_ROSTER_CURSOR/)
    assert.equal(escapeLikePattern('100%_off'), '100\\%\\_off')
  })

  it('escapes CSV formula injection, newlines, and Chinese content with BOM', () => {
    assert.equal(escapeCsvCell('=cmd|\'/c calc\''), '\'=cmd|\'/c calc\'')
    assert.equal(escapeCsvCell('+1234'), '\'+1234')
    assert.equal(escapeCsvCell('-1+2'), '\'-1+2')
    assert.equal(escapeCsvCell('@SUM(A1)'), '\'@SUM(A1)')
    assert.equal(escapeCsvCell('line\nbreak'), 'line break')
    const csv = buildRosterCsv([
      {
        nickname: '张三,测试',
        phoneNumber: '13812345678',
        city: '上海',
        status: 'REGISTERED',
        registeredAt: '2026-07-20T10:00:00.000Z',
        attendedAt: '',
        ticketCodeMasked: 'TAB1****34EF',
      },
    ])
    assert.ok(csv.startsWith('\uFEFF'))
    assert.match(csv, /"张三,测试"/)
    assert.match(csv, /联系电话/)
    assert.match(csv, /13812345678/)
    assert.match(csv, /已报名/)
    assert.doesNotMatch(csv, /openid|phone_number/i)
  })

  it('evaluates check-in windows as start-6h to end+24h', () => {
    const starts = hoursFromNow(2)
    const ends = hoursFromNow(4)
    assert.equal(isWithinCheckInWindow({ starts_at: starts, ends_at: ends }, hoursFromNow(0)), true)
    assert.equal(isWithinCheckInWindow({ starts_at: starts, ends_at: ends }, hoursFromNow(-7)), false)
    assert.equal(isWithinCheckInWindow({ starts_at: starts, ends_at: ends }, hoursFromNow(30)), false)
  })
})

describe('listEventRegistrations', () => {
  it('rejects unknown event ids without leaking cross-app existence', async () => {
    const db = createFakeDb({
      one: () => null,
    })
    await assert.rejects(
      () => listEventRegistrations(db, {
        appId: OTHER_APP,
        eventId: EVENT_ID,
        status: 'ALL',
        query: '',
        cursor: '',
        limit: 20,
      }),
      /EVENT_NOT_FOUND/,
    )
  })

  it('returns minimized DTO rows with keyset pagination and no internal ids', async () => {
    const registeredAt = new Date('2026-07-20T10:00:00.000Z')
    const rows = Array.from({ length: 3 }, (_, index) => ({
      id: `33333333-3333-4333-8333-33333333333${index}`,
      status: index === 0 ? 'ATTENDED' : 'REGISTERED',
      ticket_code: `TCODE00000${index}`,
      registered_at: new Date(registeredAt.getTime() - index * 1000),
      attended_at: index === 0 ? new Date('2026-07-20T12:00:00.000Z') : null,
      version: 1,
      nickname: `成员${index}`,
      city: '上海',
      cloud_file_id: '',
      phone_number: '13812345678',
      answer_snapshot: JSON.stringify({ emergencyPhone: '13912345678' }),
    }))
    const db = createFakeDb({
      one(sql) {
        if (sql.includes('FROM member_events')) {
          return {
            id: EVENT_ID,
            title: '沙龙',
            starts_at: hoursFromNow(2),
            ends_at: hoursFromNow(4),
            status: 'PUBLISHED',
            version: 1,
            registration_schema: JSON.stringify([
              {
                id: 'emergencyPhone',
                label: '备用联系电话',
                type: 'PHONE',
              },
            ]),
          }
        }
        if (sql.includes('COUNT(*)')) {
          return {
            total: 3,
            registered_count: 2,
            attended_count: 1,
            cancelled_count: 0,
          }
        }
        return null
      },
      query(sql, params) {
        if (sql.includes('FROM member_registrations')) {
          assert.doesNotMatch(sql, /LIMIT \?/)
          assert.match(sql, /LIMIT 3/)
          assert.deepEqual(params, [APP_ID, EVENT_ID])
          return rows
        }
        return { affectedRows: 0 }
      },
    })

    const page = await listEventRegistrations(db, {
      appId: APP_ID,
      eventId: EVENT_ID,
      status: 'ALL',
      query: '',
      cursor: '',
      limit: 2,
    })

    assert.equal(page.event.registrationCount, 3)
    assert.equal(page.event.attendedCount, 1)
    assert.equal(page.items.length, 2)
    assert.ok(page.nextCursor)
    assert.equal(Object.prototype.hasOwnProperty.call(page.items[0], 'phoneMasked'), false)
    assert.equal(page.items[0].ticketCodeMasked, 'TCOD****0000')
    assert.equal(page.items[0].phoneBound, true)
    assert.equal(page.items[0].answers[0].value, '139****5678')
    assert.equal(Object.prototype.hasOwnProperty.call(page.items[0], 'userId'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(page.items[0], 'openid'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(page.items[0], 'ticketCode'), false)
    assert.doesNotMatch(JSON.stringify(page), /13812345678|TCODE000000|phoneMasked/)

    const ownerPage = await listEventRegistrations(db, {
      appId: APP_ID,
      eventId: EVENT_ID,
      status: 'ALL',
      query: '',
      cursor: '',
      limit: 2,
      includeContact: true,
    })
    assert.equal(ownerPage.items[0].phoneNumber, '13812345678')
    assert.equal(ownerPage.items[0].answers[0].value, '13912345678')
  })
})

describe('check-in and undo', () => {
  it('checks in REGISTERED rows, is idempotent for ATTENDED, and rejects cancelled/version conflicts', async () => {
    let registration = {
      id: REG_ID,
      event_id: EVENT_ID,
      status: 'REGISTERED',
      version: 2,
      attended_at: null,
      attended_by: null,
    }
    let auditCount = 0
    const db = createFakeDb({
      one(sql) {
        if (sql.includes('FROM member_events')) {
          return {
            id: EVENT_ID,
            status: 'PUBLISHED',
            starts_at: hoursFromNow(1),
            ends_at: hoursFromNow(3),
          }
        }
        if (sql.includes('FROM member_registrations')) {
          return { ...registration }
        }
        return null
      },
      query(sql) {
        if (sql.includes('UPDATE member_registrations') && sql.includes('ATTENDED')) {
          if (registration.status !== 'REGISTERED' || registration.version !== 2) {
            return { affectedRows: 0 }
          }
          registration = {
            ...registration,
            status: 'ATTENDED',
            version: 3,
            attended_at: new Date(),
            attended_by: ACTOR,
          }
          return { affectedRows: 1 }
        }
        if (sql.includes('INSERT INTO member_audit_logs')) {
          auditCount += 1
          return { affectedRows: 1 }
        }
        return { affectedRows: 1 }
      },
    })

    const first = await checkInRegistration(db, {
      appId: APP_ID,
      actorId: ACTOR,
      actorRole: 'manager',
      eventId: EVENT_ID,
      registrationId: REG_ID,
      expectedVersion: 2,
      now: hoursFromNow(0),
    })
    assert.equal(first.status, 'ATTENDED')
    assert.equal(first.version, 3)
    assert.equal(first.idempotent, false)
    assert.equal(auditCount, 1)

    const second = await checkInRegistration(db, {
      appId: APP_ID,
      actorId: ACTOR,
      actorRole: 'manager',
      eventId: EVENT_ID,
      registrationId: REG_ID,
      expectedVersion: 2,
      now: hoursFromNow(0),
    })
    assert.equal(second.status, 'ATTENDED')
    assert.equal(second.idempotent, true)
    assert.equal(auditCount, 1)

    registration = {
      id: REG_ID,
      event_id: EVENT_ID,
      status: 'CANCELLED',
      version: 4,
      attended_at: null,
      attended_by: null,
    }
    await assert.rejects(
      () => checkInRegistration(db, {
        appId: APP_ID,
        actorId: ACTOR,
        actorRole: 'manager',
        eventId: EVENT_ID,
        registrationId: REG_ID,
        expectedVersion: 4,
      }),
      /REGISTRATION_CANCELLED/,
    )

    registration = {
      id: REG_ID,
      event_id: EVENT_ID,
      status: 'REGISTERED',
      version: 5,
      attended_at: null,
      attended_by: null,
    }
    await assert.rejects(
      () => checkInRegistration(db, {
        appId: APP_ID,
        actorId: ACTOR,
        actorRole: 'manager',
        eventId: EVENT_ID,
        registrationId: REG_ID,
        expectedVersion: 4,
      }),
      /REGISTRATION_VERSION_CONFLICT/,
    )
  })

  it('rolls back when audit insert fails after check-in update', async () => {
    const db = createFakeDb({
      one(sql) {
        if (sql.includes('FROM member_events')) {
          return {
            id: EVENT_ID,
            status: 'PUBLISHED',
            starts_at: hoursFromNow(1),
            ends_at: hoursFromNow(3),
          }
        }
        return {
          id: REG_ID,
          event_id: EVENT_ID,
          status: 'REGISTERED',
          version: 1,
          attended_at: null,
          attended_by: null,
        }
      },
      query(sql) {
        if (sql.includes('INSERT INTO member_audit_logs')) {
          throw new Error('SIMULATED_AUDIT_FAILURE')
        }
        return { affectedRows: 1 }
      },
    })

    await assert.rejects(
      () => checkInRegistration(db, {
        appId: APP_ID,
        actorId: ACTOR,
        actorRole: 'owner',
        eventId: EVENT_ID,
        registrationId: REG_ID,
        expectedVersion: 1,
      }),
      /SIMULATED_AUDIT_FAILURE/,
    )
  })

  it('undoes check-in for owner/manager with reason and rejects support', async () => {
    let registration = {
      id: REG_ID,
      event_id: EVENT_ID,
      status: 'ATTENDED',
      version: 3,
      attended_at: new Date(),
      attended_by: ACTOR,
    }
    const db = createFakeDb({
      one(sql) {
        if (sql.includes('FROM member_events')) {
          return { id: EVENT_ID, status: 'PUBLISHED' }
        }
        return { ...registration }
      },
      query(sql) {
        if (sql.includes('UPDATE member_registrations') && sql.includes('REGISTERED')) {
          registration = {
            ...registration,
            status: 'REGISTERED',
            version: 4,
            attended_at: null,
            attended_by: null,
          }
          return { affectedRows: 1 }
        }
        return { affectedRows: 1 }
      },
    })

    await assert.rejects(
      () => undoCheckIn(db, {
        appId: APP_ID,
        actorId: ACTOR,
        actorRole: 'reviewer',
        eventId: EVENT_ID,
        registrationId: REG_ID,
        expectedVersion: 3,
        reason: '误点',
      }),
      /FORBIDDEN/,
    )

    const result = await undoCheckIn(db, {
      appId: APP_ID,
      actorId: ACTOR,
      actorRole: 'manager',
      eventId: EVENT_ID,
      registrationId: REG_ID,
      expectedVersion: 3,
      reason: '误点签到',
    })
    assert.equal(result.status, 'REGISTERED')
    assert.equal(result.version, 4)
    assert.equal(result.attendedAt, null)
  })
})

describe('secure roster export', () => {
  beforeEach(() => {
    clearExportStorage()
    setExportStorage(createMemoryExportStorage({ now: () => Date.now() }))
  })

  afterEach(() => {
    clearExportStorage()
  })

  it('fails closed when export storage is not configured', async () => {
    clearExportStorage()
    assert.throws(() => requireExportStorage(), /EXPORT_STORAGE_NOT_CONFIGURED/)
  })

  it('creates xlsx export with ticket repository and one-time download', async () => {
    const storage = createMemoryExportStorage({ now: () => Date.now() })
    setExportStorage(storage)
    const registeredAt = new Date('2026-07-20T10:00:00.000Z')
    const tickets = new Map()
    const db = createFakeDb({
      one(sql, params = []) {
        if (sql.includes('FROM member_events')) {
          return { id: EVENT_ID, title: '沙龙' }
        }
        if (sql.includes('FROM member_export_tickets')) {
          if (sql.includes('WHERE id = ?')) {
            for (const ticket of tickets.values()) {
              if (ticket.id === params[0] && ticket.app_id === params[1]) {
                return { ...ticket }
              }
            }
            return null
          }
          const found = tickets.get(`${params[0]}:${params[1]}:${params[2]}`)
          return found ? { ...found } : null
        }
        return null
      },
      query(sql, params = []) {
        if (sql.includes('FROM member_registrations') && sql.includes('SELECT')) {
          return [
            {
              id: REG_ID,
              status: 'REGISTERED',
              ticket_code: 'TSECRETCODE1',
              registered_at: registeredAt,
              attended_at: null,
              nickname: '=HACK',
              phone_number: '13812345678',
              city: '上海\n浦东',
            },
          ]
        }
        if (sql.includes('INSERT INTO member_export_tickets')) {
          const [
            id, appId, eventId, , tokenHash, fileId, objectKey,
            fileName, contentType, contentBytes, contentSha256, rowCount, expiresAt,
          ] = params
          tickets.set(`${appId}:${eventId}:${tokenHash}`, {
            id,
            app_id: appId,
            file_id: fileId,
            object_key: objectKey,
            file_name: fileName,
            content_type: contentType,
            content_bytes: contentBytes,
            content_sha256: contentSha256,
            row_count: rowCount,
            expires_at: expiresAt,
            reserved_until: null,
            status: 'ACTIVE',
            version: 1,
          })
          return { affectedRows: 1 }
        }
        if (sql.includes('UPDATE member_export_tickets') && /SET\s+status\s*=\s*'RESERVED'/i.test(sql)) {
          for (const [key, ticket] of tickets.entries()) {
            if (
              ticket.id === params[1]
              && ticket.app_id === params[2]
              && ticket.status === 'ACTIVE'
              && Number(ticket.version) === Number(params[3])
            ) {
              ticket.status = 'RESERVED'
              ticket.reserved_until = params[0]
              ticket.version = Number(ticket.version) + 1
              tickets.set(key, ticket)
              return { affectedRows: 1 }
            }
          }
          return { affectedRows: 0 }
        }
        if (sql.includes('UPDATE member_export_tickets') && /SET\s+status\s*=\s*'CONSUMED'/i.test(sql)) {
          for (const [key, ticket] of tickets.entries()) {
            if (
              ticket.id === params[0]
              && ticket.app_id === params[1]
              && ticket.status === 'RESERVED'
              && Number(ticket.version) === Number(params[2])
            ) {
              ticket.status = 'CONSUMED'
              ticket.version = Number(ticket.version) + 1
              tickets.set(key, ticket)
              return { affectedRows: 1 }
            }
          }
          return { affectedRows: 0 }
        }
        if (sql.includes('UPDATE member_export_tickets') && /SET\s+status\s*=\s*'ACTIVE'/i.test(sql)) {
          for (const [key, ticket] of tickets.entries()) {
            if (ticket.id === params[0] && ticket.app_id === params[1] && ticket.status === 'RESERVED') {
              ticket.status = 'ACTIVE'
              ticket.reserved_until = null
              ticket.version = Number(ticket.version) + 1
              tickets.set(key, ticket)
              return { affectedRows: 1 }
            }
          }
          return { affectedRows: 0 }
        }
        return { affectedRows: 1 }
      },
    })

    const created = await createRosterExport(db, {
      appId: APP_ID,
      actorId: ACTOR,
      actorRole: 'manager',
      eventId: EVENT_ID,
      status: 'ALL',
      query: '',
      storage,
    })
    assert.ok(created.downloadToken)
    assert.match(created.fileName, /\.xlsx$/)
    assert.doesNotMatch(created.fileName, /wx-app|openid|138/)
    assert.equal(created.rowCount, 1)
    assert.equal(Object.prototype.hasOwnProperty.call(created, 'objectKey'), false)
    const stored = [...tickets.values()][0]
    assert.match(stored.file_id, /^cloud:\/\//)

    const downloaded = await downloadRosterExport(db, {
      appId: APP_ID,
      actorId: ACTOR,
      actorRole: 'manager',
      eventId: EVENT_ID,
      downloadToken: created.downloadToken,
      storage,
    })
    const buffer = Buffer.from(downloaded.contentBase64, 'base64')
    assert.equal(buffer[0], 0x50)
    assert.equal(buffer[1], 0x4B)
    assert.match(downloaded.contentType, /spreadsheetml/)
    const { parseRosterXlsx } = require('../lib/xlsx')
    const parsed = parseRosterXlsx(buffer)
    assert.ok(parsed.sharedStrings.includes('联系电话'))
    assert.ok(parsed.sharedStrings.includes('13812345678'))
    assert.equal(parsed.sharedStrings.some(value => /openid|TSECRETCODE1/i.test(value)), false)

    await assert.rejects(
      () => downloadRosterExport(db, {
        appId: APP_ID,
        actorId: ACTOR,
        actorRole: 'manager',
        eventId: EVENT_ID,
        downloadToken: created.downloadToken,
        storage,
      }),
      /EXPORT_ALREADY_USED/,
    )

    await assert.rejects(
      () => downloadRosterExport(db, {
        appId: OTHER_APP,
        actorId: ACTOR,
        actorRole: 'manager',
        eventId: EVENT_ID,
        downloadToken: created.downloadToken,
        storage,
      }),
      /EXPORT_NOT_FOUND|EXPORT_ALREADY_USED/,
    )
  })

  it('rejects expired export tickets', async () => {
    let now = Date.now()
    const storage = createMemoryExportStorage({ now: () => now, ttlMs: 1000 })
    const tickets = new Map()
    const db = createFakeDb({
      one: (sql, params = []) => {
        if (sql.includes('FROM member_export_tickets')) {
          if (sql.includes('WHERE id = ?')) {
            for (const ticket of tickets.values()) {
              if (ticket.id === params[0]) return { ...ticket }
            }
            return null
          }
          return tickets.get(`${params[0]}:${params[1]}:${params[2]}`) || null
        }
        return { id: EVENT_ID, title: '沙龙' }
      },
      query: (sql, params = []) => {
        if (sql.includes('FROM member_registrations') && sql.includes('SELECT')) {
          return []
        }
        if (sql.includes('INSERT INTO member_export_tickets')) {
          const [
            id, appId, eventId, , tokenHash, fileId, objectKey,
            fileName, contentType, contentBytes, contentSha256, rowCount, expiresAt,
          ] = params
          tickets.set(`${appId}:${eventId}:${tokenHash}`, {
            id,
            app_id: appId,
            file_id: fileId,
            object_key: objectKey,
            file_name: fileName,
            content_type: contentType,
            content_bytes: contentBytes,
            content_sha256: contentSha256,
            row_count: rowCount,
            expires_at: expiresAt,
            reserved_until: null,
            status: 'ACTIVE',
            version: 1,
          })
          return { affectedRows: 1 }
        }
        if (sql.includes('UPDATE member_export_tickets') && sql.includes('EXPIRED')) {
          for (const ticket of tickets.values()) {
            if (ticket.id === params[0]) {
              ticket.status = 'EXPIRED'
            }
          }
          return { affectedRows: 1 }
        }
        return { affectedRows: 1 }
      },
    })
    const created = await createRosterExport(db, {
      appId: APP_ID,
      actorId: ACTOR,
      actorRole: 'owner',
      eventId: EVENT_ID,
      status: 'ALL',
      query: '',
      storage,
      now: new Date(now),
    })
    // createRosterExport stamps a 15-minute absolute expiry independent of storage default TTL.
    now += 16 * 60_000
    await assert.rejects(
      () => downloadRosterExport(db, {
        appId: APP_ID,
        actorId: ACTOR,
        actorRole: 'owner',
        eventId: EVENT_ID,
        downloadToken: created.downloadToken,
        storage,
        now: new Date(now),
      }),
      /EXPORT_EXPIRED/,
    )
  })
})
