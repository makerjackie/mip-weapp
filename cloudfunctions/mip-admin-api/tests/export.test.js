'use strict'

const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { describe, it } = require('node:test')
const { createAdminService } = require('../domain/service')
const { workbookForExport } = require('../domain/export-workbook')
const {
  createCloudExportStorage,
  expectedObjectKey,
} = require('../lib/export-storage')
const { buildXlsx, unzipEntries } = require('../lib/xlsx')

const appId = 'wx-trusted'
const token = 'a'.repeat(43)
const tokenHash = createHash('sha256').update(token).digest('hex')
const now = new Date('2026-08-24T00:00:00.000Z')

function error(code) {
  const value = new Error(code)
  value.code = code
  return value
}

function ticket(overrides = {}) {
  return {
    ticketId: 'ticket-a',
    appId,
    actorUserId: 'admin-user',
    exportType: 'USERS',
    scopeType: 'PLATFORM',
    scopeId: null,
    filters: {},
    includesPhone: false,
    objectKey: expectedObjectKey(appId, 'ticket-a'),
    fileId: null,
    contentSha256: null,
    contentBytes: null,
    rowCount: null,
    status: 'PENDING',
    reservedUntil: null,
    expiresAt: '2026-08-24T00:15:00.000Z',
    consumedAt: null,
    failedReasonCode: null,
    createdAt: '2026-08-24T00:00:00.000Z',
    ...overrides,
  }
}

function fakeRepository(options = {}) {
  const state = { ticket: ticket(options.ticket), audits: [], reservation: null }
  return {
    state,
    resolveUser: async caller => ({
      id: caller.identityKey === 'other-identity' ? 'other-user' : 'admin-user',
      status: 'ACTIVE',
      agreementsAccepted: true,
      phoneBound: true,
      profileComplete: true,
    }),
    listRoleBindings: async () => [{
      roleKey: options.roleKey || 'PLATFORM_OWNER',
      scopeType: 'PLATFORM',
      scopeId: '00000000-0000-0000-0000-000000000000',
    }],
    async getExportTicket(input) {
      if (input.appId !== state.ticket.appId
        || input.actorUserId !== state.ticket.actorUserId
        || input.ticketId !== state.ticket.ticketId
        || input.tokenHash !== tokenHash) throw error('EXPORT_NOT_FOUND')
      return { ...state.ticket }
    },
    getEventScope: async () => ({ scopeType: 'EVENT', scopeId: 'event-a', branchId: 'branch-a' }),
    async claimExportBuild() {
      if (state.ticket.status === 'READY') return { state: 'READY', ticket: { ...state.ticket } }
      state.ticket.status = 'PENDING'
      return { state: 'CLAIMED', ticket: { ...state.ticket } }
    },
    listExportRows: async () => options.rows || [{
      id: 'user-a', userId: 'user-a', nickname: '=SUM(A1:A2)', kind: 'PLAYER', status: 'ACTIVE',
      branchName: '广州分会', cityName: '广\u0000州', controls: [], updatedAt: '2026-08-24T00:00:00.000Z',
    }],
    async finishExportBuild(input) {
      Object.assign(state.ticket, {
        status: 'READY',
        fileId: input.fileId,
        contentSha256: input.contentSha256,
        contentBytes: input.contentBytes,
        rowCount: input.rowCount,
      })
    },
    async failExportBuild(input) {
      state.ticket.status = 'FAILED'
      state.ticket.failedReasonCode = input.reasonCode
    },
    async issueExportDownload(input, issue) {
      if (state.ticket.status === 'RESERVED') throw error('EXPORT_BUSY')
      if (state.ticket.status !== 'READY') throw error('EXPORT_NOT_READY')
      const original = { ...state.ticket }
      state.ticket.status = 'RESERVED'
      state.reservation = input.reservedUntil
      try {
        const issuance = await issue(original)
        if (issuance.state === 'REVOKED') {
          state.ticket.status = 'REVOKED'
          state.ticket.failedReasonCode = issuance.reasonCode
          state.reservation = null
          return { state: 'REVOKED', ticket: { ...state.ticket } }
        }
        state.audits.push(input.audit)
        return { state: 'RESERVED', ticket: { ...state.ticket }, value: issuance.value }
      }
      catch (value) {
        state.ticket = original
        state.reservation = null
        throw value
      }
    },
    async consumeExportDownload(input) {
      if (state.ticket.status !== 'RESERVED') throw error('EXPORT_CONSUMED')
      state.ticket.status = 'CONSUMED'
      state.ticket.consumedAt = input.now.toISOString()
      state.audits.push(input.audit)
      return { ...state.ticket, consumedAt: state.ticket.consumedAt }
    },
    recordAudit: async audit => state.audits.push(audit),
  }
}

function memoryStorage(options = {}) {
  const files = new Map()
  return {
    files,
    async put(input) {
      const fileId = `cloud://test-env/${input.objectKey}`
      files.set(fileId, Buffer.from(input.content))
      return { fileId }
    },
    async read(input) {
      const content = files.get(input.fileId)
      if (!content) throw error('EXPORT_FILE_MISSING')
      return options.corruptRead ? Buffer.from('not-an-xlsx') : Buffer.from(content)
    },
    async temporaryUrl() {
      if (options.urlFailure) throw error('EXPORT_URL_UNAVAILABLE')
      if (options.temporaryUrl) return options.temporaryUrl()
      return 'https://example.test/export.xlsx'
    },
    async delete(input) { files.delete(input.fileId) },
  }
}

describe('MIP admin XLSX', () => {
  it('neutralizes formulas and removes XML control characters', () => {
    const content = buildXlsx({
      sheetName: '用户',
      header: ['昵称'],
      rows: [['=2+2\u0000\u0007']],
    })
    const entries = unzipEntries(content)
    const shared = entries.get('xl/sharedStrings.xml').toString('utf8')
    assert.match(shared, /'=2\+2/)
    assert.doesNotMatch(shared, /[\u0000\u0007]/)
    assert.ok(entries.has('[Content_Types].xml'))
    assert.ok(entries.has('xl/worksheets/sheet1.xml'))
  })

  it('adds phone cells only when the separately authorized export requests them', () => {
    const withoutPhone = workbookForExport({
      appId,
      exportType: 'USERS',
      includesPhone: false,
      phoneEncryptionKey: '',
      rows: [{ id: 'user-a', nickname: '用户' }],
    })
    const shared = unzipEntries(withoutPhone.content).get('xl/sharedStrings.xml').toString('utf8')
    assert.doesNotMatch(shared, /手机号/)
  })
})

describe('MIP export lifecycle', () => {
  it('builds from server rows, stores only a private app-scoped object and reaches READY', async () => {
    const repository = fakeRepository()
    const storage = memoryStorage()
    const service = createAdminService({ repository, exportStorage: storage, now: () => now })
    const result = await service.prepareExport({ appId, identityKey: 'admin-identity' }, { ticketId: 'ticket-a', token })
    assert.equal(result.status, 'READY')
    assert.equal(result.rowCount, 1)
    assert.equal(repository.state.ticket.objectKey, `mip/exports/${createHash('sha256').update(appId).digest('hex').slice(0, 16)}/ticket-a.xlsx`)
    assert.equal('fileId' in result, false)
    assert.equal('objectKey' in result, false)
  })

  it('binds tickets to both trusted AppID and requester', async () => {
    const repository = fakeRepository()
    const service = createAdminService({ repository, exportStorage: memoryStorage(), now: () => now })
    await assert.rejects(
      () => service.getExportStatus({ appId: 'wx-other', identityKey: 'admin-identity' }, { ticketId: 'ticket-a', token }),
      /EXPORT_NOT_FOUND/,
    )
    await assert.rejects(
      () => service.getExportStatus({ appId, identityKey: 'other-identity' }, { ticketId: 'ticket-a', token }),
      /EXPORT_NOT_FOUND/,
    )
  })

  it('rechecks the independent phone capability before preparing a sensitive ticket', async () => {
    const repository = fakeRepository({
      roleKey: 'PLATFORM_FINANCE',
      ticket: { exportType: 'ORDERS', includesPhone: true },
    })
    const service = createAdminService({ repository, exportStorage: memoryStorage(), now: () => now })
    await assert.rejects(
      () => service.prepareExport({ appId, identityKey: 'admin-identity' }, { ticketId: 'ticket-a', token }),
      /FORBIDDEN/,
    )
  })

  it('allows only one concurrent download reservation and one consume transition', async () => {
    const workbook = buildXlsx({ sheetName: '用户', header: ['昵称'], rows: [['用户']] })
    const fileId = `cloud://test-env/${expectedObjectKey(appId, 'ticket-a')}`
    const repository = fakeRepository({ ticket: {
      status: 'READY', fileId, contentBytes: workbook.length,
      contentSha256: createHash('sha256').update(workbook).digest('hex'), rowCount: 1,
    } })
    const storage = memoryStorage()
    storage.files.set(fileId, workbook)
    const service = createAdminService({ repository, exportStorage: storage, now: () => now })
    const [first, second] = await Promise.allSettled([
      service.reserveExportDownload({ appId, identityKey: 'admin-identity' }, { ticketId: 'ticket-a', token }),
      service.reserveExportDownload({ appId, identityKey: 'admin-identity' }, { ticketId: 'ticket-a', token }),
    ])
    assert.equal([first, second].filter(item => item.status === 'fulfilled').length, 1)
    assert.equal([first, second].filter(item => item.status === 'rejected').length, 1)
    const consumed = await service.completeExportDownload(
      { appId, identityKey: 'admin-identity' },
      { ticketId: 'ticket-a', token },
    )
    assert.equal(consumed.status, 'CONSUMED')
    await assert.rejects(
      () => service.completeExportDownload({ appId, identityKey: 'admin-identity' }, { ticketId: 'ticket-a', token }),
      /EXPORT_CONSUMED/,
    )
  })

  it('revokes and deletes an object whose content hash or size no longer matches', async () => {
    const workbook = buildXlsx({ sheetName: '用户', header: ['昵称'], rows: [['用户']] })
    const fileId = `cloud://test-env/${expectedObjectKey(appId, 'ticket-a')}`
    const repository = fakeRepository({ ticket: {
      status: 'READY', fileId, contentBytes: workbook.length,
      contentSha256: createHash('sha256').update(workbook).digest('hex'), rowCount: 1,
    } })
    const storage = memoryStorage({ corruptRead: true })
    storage.files.set(fileId, workbook)
    const service = createAdminService({ repository, exportStorage: storage, now: () => now })
    await assert.rejects(
      () => service.reserveExportDownload({ appId, identityKey: 'admin-identity' }, { ticketId: 'ticket-a', token }),
      /导出文件校验失败/,
    )
    assert.equal(repository.state.ticket.status, 'REVOKED')
    assert.equal(storage.files.has(fileId), false)
  })

  it('rolls back the reservation when temporary URL issuance fails', async () => {
    const workbook = buildXlsx({ sheetName: '用户', header: ['昵称'], rows: [['用户']] })
    const fileId = `cloud://test-env/${expectedObjectKey(appId, 'ticket-a')}`
    const repository = fakeRepository({ ticket: {
      status: 'READY', fileId, contentBytes: workbook.length,
      contentSha256: createHash('sha256').update(workbook).digest('hex'), rowCount: 1,
    } })
    const storageOptions = { urlFailure: true }
    const storage = memoryStorage(storageOptions)
    storage.files.set(fileId, workbook)
    const service = createAdminService({ repository, exportStorage: storage, now: () => now })

    await assert.rejects(
      () => service.reserveExportDownload(
        { appId, identityKey: 'admin-identity' },
        { ticketId: 'ticket-a', token },
      ),
      errorValue => errorValue?.code === 'EXPORT_URL_UNAVAILABLE',
    )
    assert.equal(repository.state.ticket.status, 'READY')
    assert.equal(repository.state.audits.length, 0)
    storageOptions.urlFailure = false
    const retry = await service.reserveExportDownload(
      { appId, identityKey: 'admin-identity' },
      { ticketId: 'ticket-a', token },
    )
    assert.equal(retry.status, 'RESERVED')
    assert.equal(repository.state.audits.length, 1)
  })

  it('bounds the storage call while the final authorization fence is held', async () => {
    const workbook = buildXlsx({ sheetName: '用户', header: ['昵称'], rows: [['用户']] })
    const fileId = `cloud://test-env/${expectedObjectKey(appId, 'ticket-a')}`
    const repository = fakeRepository({ ticket: {
      status: 'READY', fileId, contentBytes: workbook.length,
      contentSha256: createHash('sha256').update(workbook).digest('hex'), rowCount: 1,
    } })
    let resolveLateUrl
    const lateUrl = new Promise((resolve) => { resolveLateUrl = resolve })
    const storage = memoryStorage({ temporaryUrl: () => lateUrl })
    storage.files.set(fileId, workbook)
    const service = createAdminService({
      repository,
      exportStorage: storage,
      exportIssuanceTimeoutMs: 5,
      now: () => now,
    })

    await assert.rejects(
      () => service.reserveExportDownload(
        { appId, identityKey: 'admin-identity' },
        { ticketId: 'ticket-a', token },
      ),
      errorValue => errorValue?.code === 'EXPORT_URL_UNAVAILABLE',
    )
    resolveLateUrl('https://example.test/late-export.xlsx')
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(repository.state.ticket.status, 'READY')
    assert.equal(repository.state.audits.length, 0)
  })
})

describe('MIP CloudBase export storage', () => {
  it('refuses a CloudBase file identifier outside the exact app-scoped object key', async () => {
    const storage = createCloudExportStorage({
      uploadFile: async () => ({ fileID: `cloud://test-env/${expectedObjectKey('wx-other', 'ticket-a')}` }),
      downloadFile: async () => ({ fileContent: Buffer.from('x') }),
      getTempFileURL: async () => ({ fileList: [] }),
      deleteFile: async () => ({ fileList: [] }),
    })
    await assert.rejects(
      () => storage.put({
        appId,
        ticketId: 'ticket-a',
        objectKey: expectedObjectKey(appId, 'ticket-a'),
        content: Buffer.from('x'),
      }),
      /EXPORT_FILE_INVALID/,
    )
  })
})
