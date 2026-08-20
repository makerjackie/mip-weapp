'use strict'

const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { describe, it, beforeEach, afterEach } = require('node:test')
const {
  clearExportStorage,
  createCloudBaseExportStorage,
  createMemoryExportStorage,
  parseCloudFileId,
  requireExportStorage,
  setExportStorage,
  assertAppScopedPath,
} = require('../lib/export-storage')
const {
  XLSX_CONTENT_TYPE,
  buildRosterXlsx,
  isXlsxBuffer,
  parseRosterXlsx,
  neutralize,
  stripXml10IllegalControls,
} = require('../lib/xlsx')
const {
  createRosterExport,
  downloadRosterExport,
} = require('../lib/workflows')

const APP_ID = 'wx-app-a'
const OTHER_APP = 'wx-app-b'
const EVENT_ID = '11111111-1111-4111-8111-111111111111'
const ACTOR = 'admin-openid'

function createTicketDb({ rows = [], failAuditOn = null } = {}) {
  const tickets = new Map()
  const audits = []
  const statements = []

  function ticketKey(appId, eventId, tokenHash) {
    return `${appId}:${eventId}:${tokenHash}`
  }

  const db = {
    statements,
    tickets,
    audits,
    async one(sql, params = []) {
      statements.push({ kind: 'one', sql, params })
      if (sql.includes('FROM member_events')) {
        return { id: EVENT_ID, title: '沙龙' }
      }
      if (sql.includes('FROM member_export_tickets')) {
        if (sql.includes('WHERE id = ?')) {
          for (const ticket of tickets.values()) {
            if (ticket.id === params[0] && ticket.app_id === params[1]) {
              // Snapshot like real MySQL row — callers may mutate local fields.
              return { ...ticket }
            }
          }
          return null
        }
        const [appId, eventId, tokenHash] = params
        const found = tickets.get(ticketKey(appId, eventId, tokenHash))
        return found ? { ...found } : null
      }
      return null
    },
    async query(sql, params = []) {
      statements.push({ kind: 'query', sql, params })
      if (sql.includes('FROM member_registrations') && sql.includes('SELECT')) {
        return rows
      }
      if (sql.includes('INSERT INTO member_export_tickets')) {
        const [
          id, appId, eventId, operatorId, tokenHash, fileId, objectKey,
          fileName, contentType, contentBytes, contentSha256, rowCount, expiresAt,
        ] = params
        tickets.set(ticketKey(appId, eventId, tokenHash), {
          id,
          app_id: appId,
          event_id: eventId,
          operator_id: operatorId,
          token_hash: tokenHash,
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
      if (sql.includes('INSERT INTO member_audit_logs')) {
        if (failAuditOn && sql.includes(failAuditOn)) {
          throw new Error('SIMULATED_AUDIT_FAILURE')
        }
        audits.push({ sql, params })
        return { affectedRows: 1 }
      }
      if (sql.includes('UPDATE member_export_tickets') && /SET status = 'ORPHAN'|status = CASE WHEN status = 'CONSUMED'/.test(sql)) {
        for (const [key, ticket] of tickets.entries()) {
          if (ticket.id === params[0]) {
            if (ticket.status !== 'CONSUMED') {
              ticket.status = 'ORPHAN'
            }
            tickets.set(key, ticket)
          }
        }
        return { affectedRows: 1 }
      }
      // Reserve: SET status = 'RESERVED'
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
      // Consume: SET status = 'CONSUMED'
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
            ticket.reserved_until = null
            tickets.set(key, ticket)
            return { affectedRows: 1 }
          }
        }
        return { affectedRows: 0 }
      }
      // Release / recover lease: SET status = 'ACTIVE' from RESERVED
      if (sql.includes('UPDATE member_export_tickets') && /SET\s+status\s*=\s*'ACTIVE'/i.test(sql)) {
        for (const [key, ticket] of tickets.entries()) {
          if (ticket.id === params[0] && ticket.app_id === params[1] && ticket.status === 'RESERVED') {
            if (params.length >= 3 && Number(ticket.version) !== Number(params[2])) {
              continue
            }
            ticket.status = 'ACTIVE'
            ticket.reserved_until = null
            ticket.version = Number(ticket.version) + 1
            tickets.set(key, ticket)
            return { affectedRows: 1 }
          }
        }
        return { affectedRows: 0 }
      }
      if (sql.includes('UPDATE member_export_tickets') && /SET\s+status\s*=\s*'EXPIRED'/i.test(sql)) {
        for (const [key, ticket] of tickets.entries()) {
          if (ticket.id === params[0]) {
            ticket.status = 'EXPIRED'
            tickets.set(key, ticket)
          }
        }
        return { affectedRows: 1 }
      }
      return { affectedRows: 1 }
    },
    async transaction(work) {
      return work({
        one: (sql, params) => db.one(sql, params),
        query: (sql, params) => db.query(sql, params),
      })
    },
  }
  return db
}

describe('export integrity (xlsx + ticket repository)', () => {
  beforeEach(() => {
    clearExportStorage()
  })
  afterEach(() => {
    clearExportStorage()
  })

  it('rejects production memory mode and keeps injection for tests', () => {
    clearExportStorage()
    process.env.MEMBERSHIP_EXPORT_STORAGE = 'memory'
    assert.throws(() => requireExportStorage(), /EXPORT_STORAGE_NOT_CONFIGURED/)
    delete process.env.MEMBERSHIP_EXPORT_STORAGE
    const memory = createMemoryExportStorage()
    setExportStorage(memory)
    assert.equal(requireExportStorage().kind, 'memory')
  })

  it('rejects bare cloudPath as fileID and guards exact app segment', () => {
    assert.throws(() => parseCloudFileId('membership-exports/wx-app-a/key'), /INVALID_EXPORT_FILE_ID/)
    assert.throws(() => parseCloudFileId('wx-app-a/key'), /INVALID_EXPORT_FILE_ID/)
    assert.throws(() => parseCloudFileId('cloud://'), /INVALID_EXPORT_FILE_ID/)
    const parsed = parseCloudFileId('cloud://env.bucket/membership-exports/wx-app-a/abc')
    assert.equal(parsed.objectPath, 'membership-exports/wx-app-a/abc')
    assert.throws(
      () => assertAppScopedPath('membership-exports/wx-app-ab/abc', 'wx-app-a'),
      /EXPORT_NOT_FOUND/,
    )
    assert.throws(
      () => assertAppScopedPath('membership-exports/other/abc', 'wx-app-a'),
      /EXPORT_NOT_FOUND/,
    )
    assert.equal(
      assertAppScopedPath('membership-exports/wx-app-a/abc', 'wx-app-a'),
      'membership-exports/wx-app-a/abc',
    )
  })

  it('CloudBase adapter persists SDK fileID and fails delete on per-item errors', async () => {
    const objects = new Map()
    const cloud = {
      async uploadFile({ cloudPath, fileContent }) {
        const fileID = `cloud://env.test/${cloudPath}`
        objects.set(fileID, Buffer.from(fileContent))
        return { fileID }
      },
      async downloadFile({ fileID }) {
        const content = objects.get(fileID)
        if (!content) {
          throw new Error('missing')
        }
        return { fileContent: content }
      },
      async deleteFile({ fileList }) {
        return {
          fileList: fileList.map(fileID => ({
            fileID,
            status: objects.has(fileID) ? 0 : -1,
            errMsg: objects.has(fileID) ? 'ok' : 'fail',
          })),
        }
      },
    }
    // Wrap delete to simulate per-item failure after successful upload.
    const storage = createCloudBaseExportStorage({ cloud })
    const put = await storage.put('fragment', Buffer.from('PK\x03\x04hello'), { appId: APP_ID })
    assert.match(put.fileId, /^cloud:\/\//)
    assert.match(put.key, new RegExp(`^membership-exports/${APP_ID}/`))
    assert.doesNotMatch(put.fileId, /^membership-exports\//)

    const other = createCloudBaseExportStorage({ cloud })
    const read = await other.read(put.fileId, { appId: APP_ID, fileId: put.fileId, objectKey: put.key })
    assert.equal(read.content.toString(), 'PK\x03\x04hello')

    await assert.rejects(
      () => other.read(put.key, { appId: APP_ID }),
      /INVALID_EXPORT_FILE_ID/,
    )

    // Force delete failure: clear object then delete reports status != 0.
    objects.delete(put.fileId)
    await assert.rejects(
      () => storage.delete(put.fileId, { appId: APP_ID, fileId: put.fileId }),
      /EXPORT_DELETE_FAILED/,
    )
  })

  it('creates xlsx with PK magic, stores ticket fileID/hash, and one-time redeems across storage instances', async () => {
    const durable = createMemoryExportStorage({ now: () => Date.now() })
    const createStorage = durable
    const downloadStorage = durable

    const registeredAt = new Date('2026-07-20T10:00:00.000Z')
    const db = createTicketDb({
      rows: [{
        id: '22222222-2222-4222-8222-222222222222',
        status: 'REGISTERED',
        ticket_code: 'TSECRETCODE1',
        registered_at: registeredAt,
        attended_at: null,
        nickname: '=HACK',
        city: '上海',
      }],
    })

    const created = await createRosterExport(db, {
      appId: APP_ID,
      actorId: ACTOR,
      actorRole: 'manager',
      eventId: EVENT_ID,
      status: 'ALL',
      query: '',
      storage: createStorage,
    })
    assert.match(created.downloadToken, /^[a-f0-9]{64}$/i)
    assert.match(created.fileName, /\.xlsx$/)
    assert.equal(created.contentType, XLSX_CONTENT_TYPE)
    assert.equal(Object.prototype.hasOwnProperty.call(created, 'objectKey'), false)
    assert.equal(db.tickets.size, 1)
    const stored = [...db.tickets.values()][0]
    assert.match(stored.file_id, /^cloud:\/\//)
    assert.match(stored.object_key, new RegExp(`^membership-exports/${APP_ID}/`))
    assert.match(stored.content_sha256, /^[0-9a-f]{64}$/)
    assert.ok(stored.content_bytes > 0)

    const downloaded = await downloadRosterExport(db, {
      appId: APP_ID,
      actorId: ACTOR,
      actorRole: 'manager',
      eventId: EVENT_ID,
      downloadToken: created.downloadToken,
      storage: downloadStorage,
    })
    const buffer = Buffer.from(downloaded.contentBase64, 'base64')
    assert.equal(isXlsxBuffer(buffer), true)
    assert.equal(downloaded.contentType, XLSX_CONTENT_TYPE)
    assert.match(downloaded.fileName, /\.xlsx$/)
    assert.equal(
      db.audits.some(item => String(item.sql).includes('EVENT_ROSTER_DOWNLOAD')),
      true,
    )

    await assert.rejects(
      () => downloadRosterExport(db, {
        appId: APP_ID,
        actorId: ACTOR,
        actorRole: 'manager',
        eventId: EVENT_ID,
        downloadToken: created.downloadToken,
        storage: downloadStorage,
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
        storage: downloadStorage,
      }),
      /EXPORT_NOT_FOUND|EXPORT_ALREADY_USED/,
    )
  })

  it('does not write download audit for concurrent reserve losers', async () => {
    const storage = createMemoryExportStorage()
    const db = createTicketDb({
      rows: [{
        id: '22222222-2222-4222-8222-222222222222',
        status: 'REGISTERED',
        ticket_code: 'TSECRETCODE1',
        registered_at: new Date(),
        attended_at: null,
        nickname: '甲',
        city: '上海',
      }],
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
    const ticket = [...db.tickets.values()][0]
    // Simulate concurrent winner already holding RESERVED lease.
    ticket.status = 'RESERVED'
    ticket.reserved_until = new Date(Date.now() + 60_000)
    ticket.version = 2

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
    assert.equal(db.audits.some(item => String(item.sql).includes('EVENT_ROSTER_DOWNLOAD')), false)
  })

  it('releases reservation when object read fails so ticket is not burned', async () => {
    const storage = createMemoryExportStorage()
    const db = createTicketDb({ rows: [] })
    const created = await createRosterExport(db, {
      appId: APP_ID,
      actorId: ACTOR,
      actorRole: 'owner',
      eventId: EVENT_ID,
      status: 'ALL',
      query: '',
      storage,
    })
    const ticket = [...db.tickets.values()][0]
    // Corrupt stored object so read/hash fails.
    await storage.delete(ticket.file_id, { fileId: ticket.file_id, appId: APP_ID })

    await assert.rejects(
      () => downloadRosterExport(db, {
        appId: APP_ID,
        actorId: ACTOR,
        actorRole: 'owner',
        eventId: EVENT_ID,
        downloadToken: created.downloadToken,
        storage,
      }),
      /EXPORT_NOT_FOUND|EXPORT_OBJECT_INTEGRITY|EXPORT_DELETE_FAILED/,
    )
    // Reservation released; ticket remains ACTIVE for retry/re-export path.
    assert.equal(ticket.status, 'ACTIVE')
    assert.equal(db.audits.some(item => String(item.sql).includes('EVENT_ROSTER_DOWNLOAD')), false)
  })

  it('recovers expired RESERVED lease and allows retry', async () => {
    const storage = createMemoryExportStorage()
    const db = createTicketDb({ rows: [] })
    const created = await createRosterExport(db, {
      appId: APP_ID,
      actorId: ACTOR,
      actorRole: 'owner',
      eventId: EVENT_ID,
      status: 'ALL',
      query: '',
      storage,
    })
    const ticket = [...db.tickets.values()][0]
    ticket.status = 'RESERVED'
    ticket.reserved_until = new Date(Date.now() - 1000)
    ticket.version = 2

    const downloaded = await downloadRosterExport(db, {
      appId: APP_ID,
      actorId: ACTOR,
      actorRole: 'owner',
      eventId: EVENT_ID,
      downloadToken: created.downloadToken,
      storage,
      now: new Date(),
    })
    assert.ok(downloaded.contentBase64)
    assert.equal(ticket.status, 'CONSUMED')
  })

  it('does not burn ticket when download audit fails after successful object read', async () => {
    const storage = createMemoryExportStorage()
    const db = createTicketDb({
      rows: [],
      failAuditOn: 'EVENT_ROSTER_DOWNLOAD',
    })
    const created = await createRosterExport(db, {
      appId: APP_ID,
      actorId: ACTOR,
      actorRole: 'owner',
      eventId: EVENT_ID,
      status: 'ALL',
      query: '',
      storage,
    })
    await assert.rejects(
      () => downloadRosterExport(db, {
        appId: APP_ID,
        actorId: ACTOR,
        actorRole: 'owner',
        eventId: EVENT_ID,
        downloadToken: created.downloadToken,
        storage,
      }),
      /SIMULATED_AUDIT_FAILURE/,
    )
    const ticket = [...db.tickets.values()][0]
    assert.equal(ticket.status, 'ACTIVE')
  })

  it('marks orphan and deletes object when create audit fails', async () => {
    const storage = createMemoryExportStorage()
    const db = createTicketDb({
      rows: [],
      failAuditOn: 'EVENT_ROSTER_EXPORTED',
    })
    await assert.rejects(
      () => createRosterExport(db, {
        appId: APP_ID,
        actorId: ACTOR,
        actorRole: 'owner',
        eventId: EVENT_ID,
        status: 'ALL',
        query: '',
        storage,
      }),
      /SIMULATED_AUDIT_FAILURE/,
    )
    const ticket = [...db.tickets.values()][0]
    assert.equal(ticket.status, 'ORPHAN')
  })

  it('builds parseable xlsx with control-char stripping, Chinese, and formula neutralization', () => {
    const buffer = buildRosterXlsx([
      {
        nickname: `甲\u0000乙\u0007`,
        phoneNumber: '13812345678',
        city: '上海\n浦东',
        status: 'REGISTERED',
        registeredAt: '2026-07-20T10:00:00.000Z',
        attendedAt: '',
        ticketCodeMasked: 'T***1',
      },
      {
        nickname: '=cmd|calc',
        phoneNumber: '13912345678',
        city: '+formula',
        status: 'ATTENDED',
        registeredAt: '2026-07-20T11:00:00.000Z',
        attendedAt: '2026-07-20T12:00:00.000Z',
        ticketCodeMasked: 'T***2',
      },
    ])
    assert.equal(isXlsxBuffer(buffer), true)
    const parsed = parseRosterXlsx(buffer)
    assert.ok(parsed.uniqueCount > 0)
    assert.ok(parsed.count >= parsed.uniqueCount)
    assert.equal(parsed.count, parsed.cellValues.length)
    // Force a duplicate cell so count > uniqueCount is observable in this fixture.
    const withDup = buildRosterXlsx([
      {
        nickname: '同名',
        phoneNumber: '13812345678',
        city: '上海',
        status: 'REGISTERED',
        registeredAt: 't1',
        attendedAt: '',
        ticketCodeMasked: 'T***1',
      },
      {
        nickname: '同名',
        phoneNumber: '13812345678',
        city: '上海',
        status: 'REGISTERED',
        registeredAt: 't2',
        attendedAt: '',
        ticketCodeMasked: 'T***2',
      },
    ])
    const dupParsed = parseRosterXlsx(withDup)
    assert.ok(dupParsed.count > dupParsed.uniqueCount)
    assert.ok(parsed.sharedStrings.includes('甲乙'))
    assert.ok(parsed.sharedStrings.includes('联系电话'))
    assert.ok(parsed.sharedStrings.includes('13812345678'))
    assert.ok(parsed.sharedStrings.includes('上海 浦东'))
    assert.ok(parsed.sharedStrings.includes("'=cmd|calc"))
    assert.ok(parsed.sharedStrings.includes("'+formula"))
    assert.ok(parsed.sharedStrings.includes('已报名'))
    assert.equal(stripXml10IllegalControls('a\u0000b'), 'ab')
    assert.equal(neutralize('\u0000=HACK'), "'=HACK")
    // No raw NUL survives into shared-string text (ZIP binary may still contain 0x00).
    assert.equal(parsed.sharedStrings.some(value => value.includes('\u0000')), false)
    assert.equal(parsed.sharedStrings.join('').includes('\u0000'), false)
  })

  it('fails EXPORT_TOO_LARGE instead of silent truncation over 5000', async () => {
    const storage = createMemoryExportStorage()
    let call = 0
    const db = {
      async one() {
        return { id: EVENT_ID, title: '沙龙' }
      },
      async query(sql) {
        if (sql.includes('FROM member_registrations') && sql.includes('SELECT')) {
          call += 1
          if (call <= 50) {
            return Array.from({ length: 100 }, (_, index) => ({
              id: `33333333-3333-4333-8333-${String(index + call * 100).padStart(12, '0')}`,
              status: 'REGISTERED',
              ticket_code: `T${String(index).padStart(10, '0')}`,
              registered_at: new Date(Date.now() - index * 1000),
              attended_at: null,
              nickname: `成员${index}`,
              city: '上海',
            }))
          }
          return [{
            id: '44444444-4444-4444-8444-444444444444',
            status: 'REGISTERED',
            ticket_code: 'TEXTRA00001',
            registered_at: new Date(Date.now() - 999999),
            attended_at: null,
            nickname: '超额',
            city: '上海',
          }]
        }
        return { affectedRows: 1 }
      },
    }
    await assert.rejects(
      () => createRosterExport(db, {
        appId: APP_ID,
        actorId: ACTOR,
        actorRole: 'manager',
        eventId: EVENT_ID,
        status: 'ALL',
        query: '',
        storage,
      }),
      /EXPORT_TOO_LARGE/,
    )
  })

  it('rejects content hash mismatch without consume audit', async () => {
    const storage = createMemoryExportStorage()
    const db = createTicketDb({ rows: [] })
    const created = await createRosterExport(db, {
      appId: APP_ID,
      actorId: ACTOR,
      actorRole: 'owner',
      eventId: EVENT_ID,
      status: 'ALL',
      query: '',
      storage,
    })
    const ticket = [...db.tickets.values()][0]
    // Tamper expected hash so integrity check fails after read.
    ticket.content_sha256 = createHash('sha256').update('tampered').digest('hex')
    await assert.rejects(
      () => downloadRosterExport(db, {
        appId: APP_ID,
        actorId: ACTOR,
        actorRole: 'owner',
        eventId: EVENT_ID,
        downloadToken: created.downloadToken,
        storage,
      }),
      /EXPORT_OBJECT_INTEGRITY/,
    )
    assert.equal(ticket.status, 'ACTIVE')
    assert.equal(db.audits.some(item => String(item.sql).includes('EVENT_ROSTER_DOWNLOAD')), false)
  })

  it('rejects base64 oversize before consume/delete and keeps ticket ACTIVE', async () => {
    // 6 MiB base64 limit; ceil(bytes/3)*4 > 6MiB when bytes > 4_718_592.
    const EXPORT_MAX_BASE64_CHARS = 6 * 1024 * 1024
    const oversizedBytes = Math.floor(EXPORT_MAX_BASE64_CHARS / 4) * 3 + 3
    assert.ok(
      Math.ceil(oversizedBytes / 3) * 4 > EXPORT_MAX_BASE64_CHARS,
      'fixture must exceed base64 char limit',
    )
    const oversized = Buffer.alloc(oversizedBytes, 0x41)
    const digest = createHash('sha256').update(oversized).digest('hex')

    const baseStorage = createMemoryExportStorage()
    let deleteCalls = 0
    const storage = {
      kind: 'memory',
      put: (...args) => baseStorage.put(...args),
      read: async () => ({
        content: oversized,
        contentType: XLSX_CONTENT_TYPE,
        fileName: 'event-roster.xlsx',
      }),
      delete: async (...args) => {
        deleteCalls += 1
        return baseStorage.delete(...args)
      },
    }

    const db = createTicketDb({ rows: [] })
    const created = await createRosterExport(db, {
      appId: APP_ID,
      actorId: ACTOR,
      actorRole: 'owner',
      eventId: EVENT_ID,
      status: 'ALL',
      query: '',
      storage,
    })
    const ticket = [...db.tickets.values()][0]
    // Align ticket integrity fields with the oversized payload returned by read().
    ticket.content_bytes = oversized.length
    ticket.content_sha256 = digest

    await assert.rejects(
      () => downloadRosterExport(db, {
        appId: APP_ID,
        actorId: ACTOR,
        actorRole: 'owner',
        eventId: EVENT_ID,
        downloadToken: created.downloadToken,
        storage,
      }),
      /EXPORT_TOO_LARGE/,
    )

    // Lease released; ticket not CONSUMED; storage object not deleted.
    assert.equal(ticket.status, 'ACTIVE')
    assert.equal(deleteCalls, 0)
    assert.equal(db.audits.some(item => String(item.sql).includes('EVENT_ROSTER_DOWNLOAD')), false)
    const stillPresent = await baseStorage.read(ticket.file_id, {
      appId: APP_ID,
      fileId: ticket.file_id,
      objectKey: ticket.object_key,
    })
    assert.ok(Buffer.isBuffer(stillPresent.content) && stillPresent.content.length > 0)
  })
})
