'use strict'

const assert = require('node:assert/strict')
const { Buffer } = require('node:buffer')
const { createHash } = require('node:crypto')
const { describe, it } = require('node:test')

const { createAdminAccess } = require('../domain/access')
const { CAPABILITIES } = require('../domain/capabilities')
const { createAdminExports } = require('../domain/exports')
const { createAdminService } = require('../domain/service')
const { expectedObjectKey } = require('../lib/export-storage')
const { buildXlsx, XLSX_CONTENT_TYPE } = require('../lib/xlsx')

const APP_ID = 'wx-exports-module'
const ACTOR_ID = '10000000-0000-4000-8000-000000000001'
const BRANCH_ID = '20000000-0000-4000-8000-000000000002'
const EVENT_ID = '30000000-0000-4000-8000-000000000003'
const TICKET_ID = '40000000-0000-4000-8000-000000000004'
const TOKEN = 'a'.repeat(43)
const TOKEN_HASH = createHash('sha256').update(TOKEN).digest('hex')
const NOW = new Date('2030-08-25T00:00:00.000Z')
const caller = {
  appId: APP_ID,
  identityKey: 'wechat-identity',
  roles: [{ roleKey: 'PLATFORM_OWNER', scopeType: 'PLATFORM', scopeId: null }],
  userId: 'forged-user',
}

function error(code) {
  const value = new Error(code)
  value.code = code
  return value
}

function ticket(overrides = {}) {
  return {
    ticketId: TICKET_ID,
    appId: APP_ID,
    actorUserId: ACTOR_ID,
    exportType: 'USERS',
    scopeType: 'PLATFORM',
    scopeId: null,
    filters: {},
    includesPhone: false,
    objectKey: expectedObjectKey(APP_ID, TICKET_ID),
    fileId: null,
    contentSha256: null,
    contentBytes: null,
    rowCount: null,
    status: 'PENDING',
    reservedUntil: null,
    expiresAt: '2030-08-25T00:15:00.000Z',
    consumedAt: null,
    failedReasonCode: null,
    createdAt: NOW.toISOString(),
    ...overrides,
  }
}

function repository(options = {}) {
  const repo = {
    user: {
      id: ACTOR_ID,
      status: 'ACTIVE',
      agreementsAccepted: true,
      phoneBound: true,
      profileComplete: true,
    },
    roleBindings: options.roleBindings || [{
      roleKey: 'PLATFORM_OWNER',
      scopeType: 'PLATFORM',
      scopeId: null,
    }],
    currentTicket: ticket(options.ticket),
    rows: options.rows || [{
      id: 'user-a',
      userId: 'user-a',
      nickname: '用户',
      kind: 'PLAYER',
      status: 'ACTIVE',
      controls: [],
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    }],
    claimState: options.claimState || 'CLAIMED',
    calls: [],
    resolveReads: 0,
    ticketWrites: 0,
    async resolveUser(input) {
      repo.resolveReads += 1
      repo.calls.push({ type: 'resolveUser', input })
      return { ...repo.user }
    },
    async listRoleBindings(appId, userId) {
      repo.calls.push({ type: 'listRoleBindings', appId, userId })
      return repo.roleBindings.map(binding => ({ ...binding }))
    },
    async getEventScope(appId, eventId) {
      repo.calls.push({ type: 'getEventScope', appId, eventId })
      if (eventId === 'missing-event') {
        return null
      }
      return { scopeType: 'EVENT', scopeId: eventId, branchId: BRANCH_ID }
    },
    async createExportTicket(input) {
      repo.ticketWrites += 1
      repo.calls.push({ type: 'createExportTicket', input })
      return {
        ticketId: TICKET_ID,
        token: TOKEN,
        status: 'PENDING',
        expiresAt: repo.currentTicket.expiresAt,
      }
    },
    async getExportTicket(input) {
      repo.calls.push({ type: 'getExportTicket', input })
      if (input.appId !== repo.currentTicket.appId
        || input.actorUserId !== repo.currentTicket.actorUserId
        || input.ticketId !== repo.currentTicket.ticketId
        || input.tokenHash !== TOKEN_HASH) {
        throw error('EXPORT_NOT_FOUND')
      }
      return { ...repo.currentTicket }
    },
    async claimExportBuild(input) {
      repo.calls.push({ type: 'claimExportBuild', input })
      return { state: repo.claimState, ticket: { ...repo.currentTicket } }
    },
    async listExportRows(value, pageLimit) {
      repo.calls.push({ type: 'listExportRows', ticket: value, pageLimit })
      return repo.rows
    },
    async finishExportBuild(input) {
      repo.ticketWrites += 1
      repo.calls.push({ type: 'finishExportBuild', input })
      Object.assign(repo.currentTicket, {
        status: 'READY',
        fileId: input.fileId,
        contentSha256: input.contentSha256,
        contentBytes: input.contentBytes,
        rowCount: input.rowCount,
      })
    },
    async failExportBuild(input) {
      repo.ticketWrites += 1
      repo.calls.push({ type: 'failExportBuild', input })
      repo.currentTicket.status = 'FAILED'
      repo.currentTicket.failedReasonCode = input.reasonCode
    },
    async issueExportDownload(input, issue) {
      repo.calls.push({ type: 'issueExportDownload', input })
      const issuance = await issue({ ...repo.currentTicket })
      if (issuance.state === 'REVOKED') {
        repo.currentTicket.status = 'REVOKED'
        repo.currentTicket.failedReasonCode = issuance.reasonCode
        return { state: 'REVOKED', ticket: { ...repo.currentTicket } }
      }
      repo.currentTicket.status = 'RESERVED'
      return {
        state: 'RESERVED',
        ticket: { ...repo.currentTicket },
        value: issuance.value,
      }
    },
    async consumeExportDownload(input) {
      repo.ticketWrites += 1
      repo.calls.push({ type: 'consumeExportDownload', input })
      repo.currentTicket.status = 'CONSUMED'
      repo.currentTicket.consumedAt = input.now.toISOString()
      return { ...repo.currentTicket }
    },
  }
  return Object.assign(repo, options.overrides || {})
}

function storage(options = {}) {
  const files = new Map()
  const calls = []
  return {
    files,
    calls,
    async put(input) {
      calls.push({ type: 'put', input })
      const fileId = `cloud://test-env/${input.objectKey}`
      files.set(fileId, Buffer.from(input.content))
      return { fileId }
    },
    async read(input) {
      calls.push({ type: 'read', input })
      const content = files.get(input.fileId)
      if (!content) {
        throw error('EXPORT_FILE_MISSING')
      }
      return options.corruptRead ? Buffer.from('not-an-xlsx') : Buffer.from(content)
    },
    async temporaryUrl(input) {
      calls.push({ type: 'temporaryUrl', input })
      if (options.urlError) {
        throw error(options.urlError)
      }
      return 'https://example.test/export.xlsx'
    },
    async delete(input) {
      calls.push({ type: 'delete', input })
      files.delete(input.fileId)
    },
  }
}

function filterNormalizers(calls = []) {
  return {
    users(input) {
      calls.push({ type: 'users', input })
      return { userStatus: input.status || '' }
    },
    events(exportType, input) {
      calls.push({ type: 'events', exportType, input })
      return { eventStatus: input.status || '', eventId: 'client-event' }
    },
    orders(input) {
      calls.push({ type: 'orders', input })
      return { orderStatus: input.status || '', eventId: input.eventId || '' }
    },
    growthEntries(input) {
      calls.push({ type: 'growthEntries', input })
      return { metric: input.metric || '' }
    },
    opportunities(input) {
      calls.push({ type: 'opportunities', input })
      return { opportunityStatus: input.status || '', branchId: 'client-branch' }
    },
  }
}

function exportsModule(repo, options = {}) {
  return createAdminExports({
    access: createAdminAccess({ repository: repo }),
    repository: repo,
    exportStorage: options.exportStorage,
    phoneEncryptionKey: options.phoneEncryptionKey || '',
    filterNormalizers: options.filterNormalizers || filterNormalizers(),
    now: options.now || (() => NOW),
    maxRows: options.maxRows ?? 5_000,
    maxBytes: options.maxBytes ?? 8 * 1024 * 1024,
    issuanceTimeoutMs: options.issuanceTimeoutMs ?? 15_000,
  })
}

function lastCall(value, type) {
  return value.calls.findLast(call => call.type === type)
}

function authorization(capability, roleKey = 'PLATFORM_OWNER', scopeType = 'PLATFORM', scopeId = null) {
  return {
    capability,
    effectiveGrant: { roleKey, scopeType, scopeId },
  }
}

describe('admin exports deep module', () => {
  it('exposes only the five external export operations', () => {
    const module = createAdminExports({})
    assert.deepEqual(Object.keys(module).sort(), [
      'completeExportDownload',
      'createExport',
      'getExportStatus',
      'prepareExport',
      'reserveExportDownload',
    ])
  })

  it('reloads server user and role facts and ignores caller-supplied capabilities', async () => {
    const repo = repository()
    const module = exportsModule(repo)

    await module.createExport(caller, { exportType: 'USERS', filters: {} })
    repo.roleBindings = [{ roleKey: 'EVENT_STAFF', scopeType: 'EVENT', scopeId: EVENT_ID }]
    await assert.rejects(
      () => module.createExport(caller, { exportType: 'USERS', filters: {} }),
      errorValue => errorValue?.code === 'FORBIDDEN',
    )
    repo.roleBindings = [{ roleKey: 'PLATFORM_OWNER', scopeType: 'PLATFORM', scopeId: null }]
    repo.user.status = 'CLOSED'
    await assert.rejects(
      () => module.getExportStatus(caller, { ticketId: TICKET_ID, token: TOKEN }),
      errorValue => errorValue?.message === 'FORBIDDEN',
    )

    assert.equal(repo.resolveReads, 3)
    assert.equal(repo.ticketWrites, 1)
    assert.equal(lastCall(repo, 'listRoleBindings').userId, ACTOR_ID)
  })

  it('derives platform, branch, and event scope before applying exact filter seams', async () => {
    const normalizerCalls = []
    const repo = repository()
    const module = exportsModule(repo, {
      filterNormalizers: filterNormalizers(normalizerCalls),
    })

    await module.createExport(caller, {
      exportType: 'EVENT_ROSTER',
      eventId: EVENT_ID,
      filters: { status: 'APPROVED', eventId: 'forged-event' },
      includesPhone: true,
      idempotencyKey: 'web-export-create-0001',
    })
    let input = lastCall(repo, 'createExportTicket').input
    assert.equal(input.idempotencyKey, 'web-export-create-0001')
    assert.deepEqual(input.scope, {
      scopeType: 'EVENT',
      scopeId: EVENT_ID,
      branchId: BRANCH_ID,
    })
    assert.deepEqual(input.filters, { eventStatus: 'APPROVED', eventId: EVENT_ID })
    assert.deepEqual(input.authorization, authorization(
      CAPABILITIES.EXPORT_CREATE,
      'PLATFORM_OWNER',
    ))
    assert.deepEqual(input.phoneAuthorization, authorization(
      CAPABILITIES.USERS_PHONE_READ,
      'PLATFORM_OWNER',
    ))
    assert.deepEqual(input.audit.metadata, {
      exportType: 'EVENT_ROSTER',
      includesPhone: true,
    })

    await module.createExport(caller, {
      exportType: 'OPPORTUNITIES',
      branchId: BRANCH_ID,
      filters: { status: 'PUBLISHED', branchId: 'forged-branch' },
    })
    input = lastCall(repo, 'createExportTicket').input
    assert.deepEqual(input.scope, { scopeType: 'BRANCH', scopeId: BRANCH_ID })
    assert.deepEqual(input.filters, {
      opportunityStatus: 'PUBLISHED',
      branchId: BRANCH_ID,
    })

    repo.roleBindings = [{ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: BRANCH_ID }]
    await module.createExport(caller, { exportType: 'GROWTH_ENTRIES', filters: { metric: 'EXPERIENCE' } })
    input = lastCall(repo, 'createExportTicket').input
    assert.deepEqual(input.scope, { scopeType: 'BRANCH', scopeId: BRANCH_ID })
    assert.deepEqual(input.filters, { metric: 'EXPERIENCE', branchId: BRANCH_ID })
    assert.deepEqual(normalizerCalls.map(call => call.type), [
      'events',
      'opportunities',
      'growthEntries',
    ])
  })

  it('keeps finance and phone capabilities independent and resolves missing event scope first', async () => {
    const financeRepo = repository({
      roleBindings: [{ roleKey: 'PLATFORM_FINANCE', scopeType: 'PLATFORM', scopeId: null }],
      ticket: { exportType: 'ORDERS', includesPhone: true },
    })
    const finance = exportsModule(financeRepo, { exportStorage: storage() })
    await assert.rejects(
      () => finance.prepareExport(caller, { ticketId: TICKET_ID, token: TOKEN }),
      errorValue => errorValue?.code === 'FORBIDDEN',
    )
    assert.equal(lastCall(financeRepo, 'claimExportBuild'), undefined)

    const eventRepo = repository({ ticket: {
      exportType: 'EVENT_ROSTER',
      scopeType: 'EVENT',
      scopeId: 'missing-event',
    } })
    const eventModule = exportsModule(eventRepo)
    await assert.rejects(
      () => eventModule.getExportStatus(caller, { ticketId: TICKET_ID, token: TOKEN }),
      errorValue => errorValue?.code === 'EXPORT_NOT_FOUND',
    )
    assert.equal(lastCall(eventRepo, 'getEventScope').eventId, 'missing-event')
  })

  it('builds XLSX from server rows and commits only hash, size, count, authorization, and audit facts', async () => {
    const repo = repository()
    const fileStorage = storage()
    const module = exportsModule(repo, { exportStorage: fileStorage })

    const result = await module.prepareExport(caller, { ticketId: TICKET_ID, token: TOKEN })
    assert.equal(result.status, 'READY')
    assert.equal(result.rowCount, 1)
    assert.equal('fileId' in result, false)
    assert.equal('objectKey' in result, false)

    const rows = lastCall(repo, 'listExportRows')
    assert.equal(rows.pageLimit, 5_001)
    const put = lastCall(fileStorage, 'put').input
    const finish = lastCall(repo, 'finishExportBuild').input
    assert.equal(finish.fileId, `cloud://test-env/${repo.currentTicket.objectKey}`)
    assert.equal(finish.contentBytes, put.content.length)
    assert.equal(finish.contentSha256, createHash('sha256').update(put.content).digest('hex'))
    assert.equal(finish.rowCount, 1)
    assert.deepEqual(finish.authorization, authorization(CAPABILITIES.EXPORT_CREATE))
    assert.equal(finish.phoneAuthorization, null)
    assert.deepEqual(finish.audit, {
      appId: APP_ID,
      actorUserId: ACTOR_ID,
      scopeType: 'PLATFORM',
      scopeId: null,
      action: 'admin.export.prepare',
      resourceType: 'EXPORT_TICKET',
      resourceId: TICKET_ID,
      effectiveRole: 'PLATFORM_OWNER',
      metadata: { exportType: 'USERS', rowCount: 1 },
    })
  })

  it('keeps READY and BUSY preparation idempotent and records bounded build failures', async () => {
    for (const state of ['READY', 'BUSY']) {
      const repo = repository({ claimState: state })
      const fileStorage = storage()
      const module = exportsModule(repo, { exportStorage: fileStorage })
      const result = await module.prepareExport(caller, { ticketId: TICKET_ID, token: TOKEN })
      assert.equal(result.status, 'PENDING')
      assert.equal(result.retryAfterMs, state === 'BUSY' ? 1_000 : undefined)
      assert.equal(lastCall(repo, 'listExportRows'), undefined)
      assert.equal(lastCall(fileStorage, 'put'), undefined)
    }

    const oversizedRepo = repository({ rows: [{ id: 'a' }, { id: 'b' }] })
    const oversized = exportsModule(oversizedRepo, {
      exportStorage: storage(),
      maxRows: 1,
    })
    await assert.rejects(
      () => oversized.prepareExport(caller, { ticketId: TICKET_ID, token: TOKEN }),
      errorValue => errorValue?.code === 'EXPORT_TOO_LARGE',
    )
    const failed = lastCall(oversizedRepo, 'failExportBuild').input
    assert.equal(failed.reasonCode, 'EXPORT_TOO_LARGE')
    assert.deepEqual(failed.authorization, authorization(CAPABILITIES.EXPORT_CREATE))
  })

  it('projects expiry without changing terminal ticket states or exposing storage facts', async () => {
    const repo = repository({ ticket: {
      expiresAt: '2030-08-24T23:59:59.000Z',
      status: 'READY',
      rowCount: 4,
      failedReasonCode: null,
    } })
    const module = exportsModule(repo)
    const expired = await module.getExportStatus(caller, { ticketId: TICKET_ID, token: TOKEN })
    assert.deepEqual(expired, {
      status: 'EXPIRED',
      rowCount: 4,
      expiresAt: '2030-08-24T23:59:59.000Z',
      fileName: 'mip-users-20300825T000000000Z.xlsx',
      failureCode: null,
    })
    assert.equal('objectKey' in expired, false)

    repo.currentTicket.status = 'CONSUMED'
    const consumed = await module.getExportStatus(caller, { ticketId: TICKET_ID, token: TOKEN })
    assert.equal(consumed.status, 'CONSUMED')
  })

  it('verifies XLSX integrity before issuing a bounded reservation contract', async () => {
    const content = buildXlsx({ sheetName: '用户', header: ['昵称'], rows: [['用户']] })
    const fileId = `cloud://test-env/${expectedObjectKey(APP_ID, TICKET_ID)}`
    const repo = repository({ ticket: {
      status: 'READY',
      fileId,
      contentBytes: content.length,
      contentSha256: createHash('sha256').update(content).digest('hex'),
      rowCount: 1,
    } })
    const fileStorage = storage()
    fileStorage.files.set(fileId, content)
    const module = exportsModule(repo, { exportStorage: fileStorage })

    const result = await module.reserveExportDownload(caller, {
      ticketId: TICKET_ID,
      token: TOKEN,
    })
    assert.equal(result.status, 'RESERVED')
    assert.equal(result.contentType, XLSX_CONTENT_TYPE)
    assert.equal(result.contentBytes, content.length)
    assert.equal(result.contentSha256, repo.currentTicket.contentSha256)
    assert.equal(result.reservationExpiresAt, '2030-08-25T00:02:00.000Z')
    assert.equal(lastCall(fileStorage, 'temporaryUrl').input.maxAgeSeconds, 120)
    assert.equal(lastCall(repo, 'issueExportDownload').input.audit.action, 'admin.export.download.reserve')

    const consumed = await module.completeExportDownload(caller, {
      ticketId: TICKET_ID,
      token: TOKEN,
    })
    assert.deepEqual(consumed, {
      status: 'CONSUMED',
      consumedAt: NOW.toISOString(),
    })
    assert.equal(fileStorage.files.has(fileId), false)
    assert.equal(lastCall(repo, 'consumeExportDownload').input.audit.action, 'admin.export.download.consume')
  })

  it('revokes and removes corrupted files while preserving mapped storage errors', async () => {
    const content = buildXlsx({ sheetName: '用户', header: ['昵称'], rows: [['用户']] })
    const fileId = `cloud://test-env/${expectedObjectKey(APP_ID, TICKET_ID)}`
    const corruptRepo = repository({ ticket: {
      status: 'READY',
      fileId,
      contentBytes: content.length,
      contentSha256: createHash('sha256').update(content).digest('hex'),
    } })
    const corruptStorage = storage({ corruptRead: true })
    corruptStorage.files.set(fileId, content)
    const corrupt = exportsModule(corruptRepo, { exportStorage: corruptStorage })
    await assert.rejects(
      () => corrupt.reserveExportDownload(caller, { ticketId: TICKET_ID, token: TOKEN }),
      errorValue => errorValue?.code === 'EXPORT_INTEGRITY_FAILED',
    )
    assert.equal(corruptRepo.currentTicket.status, 'REVOKED')
    assert.equal(corruptStorage.files.has(fileId), false)

    const missingRepo = repository({ ticket: {
      status: 'READY',
      fileId,
      contentBytes: content.length,
      contentSha256: createHash('sha256').update(content).digest('hex'),
    } })
    const missing = exportsModule(missingRepo, { exportStorage: storage() })
    await assert.rejects(
      () => missing.reserveExportDownload(caller, { ticketId: TICKET_ID, token: TOKEN }),
      errorValue => errorValue?.code === 'EXPORT_FILE_MISSING'
        && errorValue?.message === '导出文件不存在',
    )
  })

  it('keeps createAdminService composition and all external operation names compatible', () => {
    const service = createAdminService({ repository: repository() })
    assert.deepEqual([
      'completeExportDownload',
      'createExport',
      'getExportStatus',
      'prepareExport',
      'reserveExportDownload',
    ].map(name => typeof service[name]), [
      'function',
      'function',
      'function',
      'function',
      'function',
    ])
  })
})
