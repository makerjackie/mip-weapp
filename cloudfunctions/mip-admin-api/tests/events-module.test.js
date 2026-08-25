'use strict'

const assert = require('node:assert/strict')
const { createCipheriv, createHash, createHmac } = require('node:crypto')
const { describe, it } = require('node:test')
const { createAdminAccess } = require('../domain/access')
const { createAdminEvents } = require('../domain/events')
const { AdminError } = require('../domain/validation')

const APP_ID = 'wx-app'
const EVENT_ID = 'event-a'
const BRANCH_ID = 'branch-a'
const PHONE_SECRET = 'phone-encryption-secret-with-at-least-32-characters'
const caller = { appId: APP_ID, identityKey: 'identity-key' }

function encryptedPhone(userId) {
  const master = createHash('sha256').update(PHONE_SECRET).digest()
  const key = createHmac('sha256', master).update('mip-phone-encryption-v1').digest()
  const iv = Buffer.alloc(12, 7)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(`${APP_ID}\0${userId}`))
  const ciphertext = Buffer.concat([cipher.update('+86:13800138000'), cipher.final()])
  return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), ciphertext])
}

function repository(overrides = {}) {
  const audits = []
  const repo = {
    audits,
    roleBindings: [{ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: BRANCH_ID }],
    resolveReads: 0,
    eventReads: 0,
    async resolveUser() {
      repo.resolveReads += 1
      return {
        id: 'admin-user', status: 'ACTIVE', agreementsAccepted: true,
        phoneBound: true, profileComplete: true,
      }
    },
    async listRoleBindings() {
      return repo.roleBindings
    },
    async getEventScope(_appId, eventId) {
      if (eventId === 'event-missing') return null
      return {
        scopeType: 'EVENT', scopeId: eventId,
        eventScopeType: 'BRANCH', branchId: BRANCH_ID,
        status: 'DRAFT', version: 3,
      }
    },
    async getEvent(_appId, eventId) {
      repo.eventReads += 1
      return {
        id: eventId, title: '城市交流会', summary: '摘要', description: '介绍',
        notices: '须知', version: 3,
      }
    },
    async recordAudit(value) {
      audits.push(value)
    },
    ...overrides,
  }
  return repo
}

function events(repo, ports = {}) {
  return createAdminEvents({
    repository: repo,
    access: createAdminAccess({ repository: repo }),
    phoneEncryptionKey: PHONE_SECRET,
    ...ports,
  })
}

function eventDraft(overrides = {}) {
  return {
    scopeType: 'BRANCH',
    branchId: BRANCH_ID,
    title: '城市交流会',
    summary: '活动摘要',
    description: '活动介绍',
    notices: '活动须知',
    eventTypeKey: 'general',
    eventMode: 'OFFLINE',
    accessType: 'FREE',
    registrationPolicy: 'AUTO',
    startsAt: '2030-08-25T10:00:00.000Z',
    endsAt: '2030-08-25T12:00:00.000Z',
    registrationDeadline: null,
    cancellationDeadline: null,
    venueName: '活动场地',
    address: '广州市',
    cityName: '广州',
    onlineUrl: '',
    capacity: null,
    waitlistEnabled: false,
    priceCents: 0,
    registrationSchema: [],
    ...overrides,
  }
}

describe('admin events deep module', () => {
  it('exposes only event administration and the export filter seam', () => {
    const api = createAdminEvents({ repository: {}, access: {} })
    assert.deepEqual(Object.keys(api).sort(), [
      'archiveEvent',
      'changeEventStatus',
      'checkIn',
      'cloneEvent',
      'getEvent',
      'getEventPolicy',
      'listEventAlbumPhotos',
      'listEvents',
      'listRoster',
      'listRosterAll',
      'normalizeExportFilters',
      'publishEventReminder',
      'reviewEventAlbumPhoto',
      'reviewRegistration',
      'saveEvent',
      'saveEventPolicy',
      'undoCheckIn',
    ])
  })

  it('reloads server-owned roles for every request and resolves NOT_FOUND before scope authorization', async () => {
    const repo = repository()
    const service = events(repo)

    assert.equal((await service.getEvent(caller, { eventId: EVENT_ID })).id, EVENT_ID)
    repo.roleBindings = [{ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: 'branch-b' }]
    await assert.rejects(
      () => service.getEvent(caller, { eventId: EVENT_ID }),
      error => error?.code === 'FORBIDDEN',
    )
    await assert.rejects(
      () => service.getEvent(caller, { eventId: 'event-missing' }),
      error => error?.code === 'NOT_FOUND',
    )

    assert.equal(repo.resolveReads, 3)
    assert.equal(repo.eventReads, 1)
  })

  it('keeps event scope, content safety, expectedVersion and repository authorization intact', async () => {
    const captured = []
    const checked = []
    const repo = repository({
      async saveEvent(input) {
        captured.push(input)
        if (input.expectedVersion === 7) {
          throw new AdminError('CONFLICT', '活动信息已更新，请刷新后重试')
        }
        return { id: input.eventId, status: 'DRAFT', version: input.expectedVersion + 1 }
      },
    })
    const service = events(repo, {
      contentSafety: async (content) => {
        checked.push(content)
        return 'PASSED'
      },
    })

    const result = await service.saveEvent(caller, {
      eventId: EVENT_ID,
      expectedVersion: 3,
      draft: eventDraft(),
    })
    assert.deepEqual(result, { id: EVENT_ID, status: 'DRAFT', version: 4 })
    assert.deepEqual(checked, [{
      title: '城市交流会', summary: '活动摘要', description: '活动介绍', notices: '活动须知',
    }])
    assert.deepEqual(captured[0].authorizedScope, {
      scopeType: 'EVENT', scopeId: EVENT_ID,
      eventScopeType: 'BRANCH', branchId: BRANCH_ID,
      status: 'DRAFT', version: 3,
    })
    assert.equal(captured[0].authorization.capability, 'events.write')
    assert.deepEqual(captured[0].authorization.effectiveGrant, {
      roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: BRANCH_ID,
    })
    assert.equal(captured[0].audit(EVENT_ID).action, 'admin.events.update')

    await assert.rejects(() => service.saveEvent(caller, {
      eventId: EVENT_ID,
      expectedVersion: 3,
      draft: eventDraft({ branchId: 'branch-b' }),
    }), error => error?.code === 'FORBIDDEN')
    assert.equal(captured.length, 1)
    assert.equal(checked.length, 1)

    await assert.rejects(() => service.saveEvent(caller, {
      eventId: EVENT_ID,
      expectedVersion: 7,
      draft: eventDraft(),
    }), error => error?.code === 'CONFLICT')
    assert.equal(captured.at(-1).expectedVersion, 7)
  })

  it('clones the server-read definition with a stable idempotency key and preserves conflicts', async () => {
    const cloned = []
    let sourceVersion = 3
    const repo = repository({
      async getEvent(_appId, eventId) {
        return {
          id: eventId, title: '城市交流会', summary: '摘要', description: '介绍',
          notices: '须知', version: sourceVersion,
        }
      },
      async cloneEvent(input) {
        if (input.expectedVersion !== 3) {
          throw new AdminError('CONFLICT', '活动信息已更新，请刷新后重试')
        }
        cloned.push(input)
        return {
          id: 'event-copy', status: 'DRAFT', version: 1,
          idempotent: cloned.length > 1,
        }
      },
    })
    const checked = []
    const service = events(repo, {
      contentSafety: async (content) => {
        checked.push(content)
        return 'PASSED'
      },
    })
    const input = {
      sourceEventId: EVENT_ID,
      expectedVersion: 3,
      idempotencyKey: 'clone-request-0001',
      title: '客户端标题',
      startsAt: '2000-01-01T00:00:00.000Z',
    }

    assert.equal((await service.cloneEvent(caller, input)).idempotent, false)
    sourceVersion = 4
    assert.equal((await service.cloneEvent(caller, input)).idempotent, true)
    assert.equal(cloned[0].idempotencyKey, 'clone-request-0001')
    assert.equal(cloned[1].idempotencyKey, 'clone-request-0001')
    assert.equal(cloned[0].title, '城市交流会（副本）')
    assert.equal(Object.hasOwn(cloned[0], 'startsAt'), false)
    assert.deepEqual(checked[0], {
      title: '城市交流会（副本）', summary: '摘要', description: '介绍', notices: '须知',
    })

    await assert.rejects(() => service.cloneEvent(caller, {
      ...input,
      expectedVersion: 2,
    }), error => error?.code === 'CONFLICT')
    assert.equal(cloned.length, 2)

    repo.roleBindings = [
      { roleKey: 'EVENT_OWNER', scopeType: 'EVENT', scopeId: EVENT_ID },
      { roleKey: 'PLATFORM_OPERATIONS', scopeType: 'PLATFORM', scopeId: null },
    ]
    assert.equal((await service.cloneEvent(caller, input)).idempotent, true)
    assert.equal(cloned.at(-1).authorization.effectiveGrant.scopeType, 'PLATFORM')

    repo.roleBindings = [{ roleKey: 'EVENT_OWNER', scopeType: 'EVENT', scopeId: EVENT_ID }]
    await assert.rejects(() => service.cloneEvent(caller, input), error => error?.code === 'FORBIDDEN')
    assert.equal(cloned.length, 3)

    repo.roleBindings = [{ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: 'branch-b' }]
    await assert.rejects(() => service.cloneEvent(caller, input), error => error?.code === 'FORBIDDEN')
    assert.equal(cloned.length, 3)

    repo.roleBindings = [{ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: BRANCH_ID }]
    repo.getEvent = async () => null
    await assert.rejects(() => service.cloneEvent(caller, input), error => error?.code === 'NOT_FOUND')
    assert.equal(cloned.length, 3)
  })

  it('dispatches cancellation refunds only after the repository transaction has returned', async () => {
    const trace = []
    let release
    const transactionGate = new Promise(resolve => { release = resolve })
    const repo = repository({
      async changeEventStatus() {
        trace.push('transaction-started')
        await transactionGate
        trace.push('transaction-committed')
        return {
          id: EVENT_ID, status: 'CANCELLED', version: 4, affectedCount: 2,
          refundIds: ['refund-a', 'refund-b'],
        }
      },
    })
    const service = events(repo, {
      async dispatchCancellationRefunds(appId, refundIds) {
        trace.push('refund-dispatched')
        assert.equal(appId, APP_ID)
        assert.deepEqual(refundIds, ['refund-a', 'refund-b'])
        return { requested: 2, attempted: 2, deferred: 0, failed: 0 }
      },
    })

    const pending = service.changeEventStatus(caller, {
      eventId: EVENT_ID,
      expectedVersion: 3,
      status: 'CANCELLED',
      reason: '场地无法使用',
    })
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(trace, ['transaction-started'])
    release()
    const result = await pending

    assert.deepEqual(trace, ['transaction-started', 'transaction-committed', 'refund-dispatched'])
    assert.equal(Object.hasOwn(result, 'refundIds'), false)
    assert.deepEqual(result.refundDispatch, {
      requested: 2, attempted: 2, deferred: 0, failed: 0,
    })
  })

  it('keeps roster filters, phone scope, redaction and export normalization inside the module', async () => {
    const rosterCalls = []
    const userId = 'target-user'
    const row = {
      id: 'registration-a', userId, nickname: '用户', status: 'REGISTERED',
      phoneCiphertext: encryptedPhone(userId), version: 2,
    }
    const repo = repository({
      async listRoster(...args) {
        rosterCalls.push({ type: 'event', args })
        return { items: [row], nextCursor: 'next-event' }
      },
      async listRosterAll(...args) {
        rosterCalls.push({ type: 'all', args })
        return { items: [row], nextCursor: 'next-all' }
      },
    })
    repo.roleBindings = [{ roleKey: 'PLATFORM_OWNER', scopeType: 'PLATFORM', scopeId: null }]
    const service = events(repo)
    const filters = {
      query: ' 用户 ',
      status: 'registered',
      createdFrom: '2030-01-01T00:00:00.000Z',
      createdTo: '2030-02-01T00:00:00.000Z',
    }

    const page = await service.listRoster(caller, {
      eventId: EVENT_ID, includePhone: true, filters,
    })
    assert.equal(page.items[0].phoneNumber, '+86 13800138000')
    assert.equal(Object.hasOwn(page.items[0], 'phoneCiphertext'), false)
    assert.equal(Object.hasOwn(page.items[0], 'userId'), false)
    assert.deepEqual(rosterCalls[0].args[2], {
      query: '用户', status: 'REGISTERED',
      createdFrom: '2030-01-01 00:00:00.000',
      createdTo: '2030-02-01 00:00:00.000',
    })
    assert.equal(repo.audits.at(-1).action, 'admin.events.roster.phone.view')

    const all = await service.listRosterAll(caller, {
      includePhone: true,
      filters: { ...filters, eventId: EVENT_ID, branchId: BRANCH_ID },
    })
    assert.equal(all.items[0].userId, userId)
    assert.equal(Object.hasOwn(all.items[0], 'phoneCiphertext'), false)
    assert.equal(repo.audits.at(-1).action, 'admin.events.roster.all.phone.view')
    assert.deepEqual(service.normalizeExportFilters('EVENT_ROSTER_ALL', {
      ...filters, eventId: EVENT_ID, branchId: BRANCH_ID,
    }), {
      query: '用户', status: 'REGISTERED',
      createdFrom: '2030-01-01 00:00:00.000',
      createdTo: '2030-02-01 00:00:00.000',
      eventId: EVENT_ID,
      branchId: BRANCH_ID,
    })

    assert.throws(() => service.normalizeExportFilters('EVENT_ROSTER', {
      createdFrom: '2030-02-01T00:00:00.000Z',
      createdTo: '2030-01-01T00:00:00.000Z',
    }), error => error?.code === 'VALIDATION_FAILED')
  })

  it('passes scoped mutation authorization, audits and repository conflicts through unchanged', async () => {
    const captures = {}
    const repo = repository({
      async checkIn(input) {
        captures.checkIn = input
        throw new AdminError('CONFLICT', '报名信息已更新，请刷新后重试')
      },
      async reviewRegistration(input) {
        captures.review = input
        return { id: input.registrationId, status: 'REGISTERED', version: input.expectedVersion + 1 }
      },
      async publishEventReminder(input) {
        captures.reminder = input
        return {
          publicationId: 'publication-a', recipientCount: 2,
          sendWechatReminder: input.sendWechatReminder,
          wechatDelivery: 'BEST_EFFORT', idempotent: false,
        }
      },
    })
    const service = events(repo)

    await assert.rejects(() => service.checkIn(caller, {
      eventId: EVENT_ID, registrationId: 'registration-a', expectedVersion: 2,
    }), error => error?.code === 'CONFLICT')
    assert.equal(captures.checkIn.authorization.capability, 'events.checkin.manage')
    assert.equal(captures.checkIn.expectedVersion, 2)

    const reviewed = await service.reviewRegistration(caller, {
      eventId: EVENT_ID, registrationId: 'registration-a', expectedVersion: 2,
      decision: 'APPROVE',
    })
    assert.equal(reviewed.status, 'REGISTERED')
    assert.equal(captures.review.authorization.capability, 'events.registrations.manage')
    assert.equal(captures.review.audit('REGISTERED').action, 'admin.events.registration.approve')

    await service.publishEventReminder(caller, {
      eventId: EVENT_ID,
      expectedVersion: 3,
      idempotencyKey: 'event-reminder-0001',
      sendWechatReminder: true,
      recipientUserIds: ['forged-user'],
    })
    assert.deepEqual(Object.keys(captures.reminder).sort(), [
      'actorUserId', 'appId', 'audit', 'authorization', 'authorizedScope', 'eventId',
      'expectedVersion', 'idempotencyKey', 'sendWechatReminder',
    ])
    assert.equal(captures.reminder.audit('publication-a', {
      recipientCount: 2, sendWechatReminder: true,
    }).action, 'admin.communications.publish')
  })
})
