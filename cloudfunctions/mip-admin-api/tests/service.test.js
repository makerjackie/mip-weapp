'use strict'

const assert = require('node:assert/strict')
const { createCipheriv, createHash, createHmac } = require('node:crypto')
const { describe, it } = require('node:test')
const { createAdminService } = require('../domain/service')

const secret = 'phone-encryption-secret-with-at-least-32-characters'
const caller = { appId: 'wx-trusted', identityKey: 'identity-key' }

function encryptedPhone(context) {
  const master = createHash('sha256').update(secret).digest()
  const key = createHmac('sha256', master).update('mip-phone-encryption-v1').digest()
  const iv = Buffer.alloc(12, 7)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(`${context.appId}\0${context.userId}`))
  const ciphertext = Buffer.concat([cipher.update('+86:13800138000'), cipher.final()])
  return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), ciphertext])
}

function repository(roleKey = 'PLATFORM_OWNER', scopeType = 'PLATFORM', scopeId = '00000000-0000-0000-0000-000000000000') {
  const audits = []
  return {
    audits,
    resolveUser: async () => ({
      id: 'admin-user', status: 'ACTIVE', agreementsAccepted: true,
      phoneBound: true, profileComplete: true,
    }),
    listRoleBindings: async () => [{
      roleKey,
      scopeType,
      scopeId: scopeType === 'PLATFORM' ? null : scopeId,
    }],
    listUsers: async () => [{
      id: 'target-user', status: 'ACTIVE', kind: 'PLAYER', nickname: '用户', headline: '',
      introduction: '', primaryBranchId: 'branch-a', branchName: '广州分会', cityName: '广州',
      phoneBound: true, phoneCiphertext: encryptedPhone({ appId: caller.appId, userId: 'target-user' }),
      controls: [], visibility: {}, userVersion: 1, profileVersion: 1, updatedAt: new Date().toISOString(),
    }],
    getUserDetail: async () => ({
      id: 'target-user', status: 'ACTIVE', kind: 'PLAYER', nickname: '用户', headline: '产品负责人',
      introduction: '个人介绍', primaryBranchId: 'branch-a', branchName: '广州分会', cityName: '广州',
      phoneBound: true, phoneCiphertext: encryptedPhone({ appId: caller.appId, userId: 'target-user' }),
      controls: [], visibility: {}, userVersion: 1, profileVersion: 1,
      companies: [{ name: '示例公司', role: '负责人' }], organizations: [],
      membership: { status: 'ACTIVE', startsAt: '2026-01-01T00:00:00.000Z', endsAt: '2027-01-01T00:00:00.000Z' },
      growth: { levelName: '一级', experience: 10, contribution: 2, coin: 1 },
      counts: { registrations: 3, attended: 2, orders: 1, opportunities: 1, cooperationCards: 1, superCases: 1 },
      tags: [], roles: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-08-24T00:00:00.000Z',
    }),
    recordAudit: async audit => audits.push(audit),
    getUserScope: async () => ({ scopeType: 'BRANCH', scopeId: 'branch-a' }),
    updateUserFields: async input => input,
    setUserControl: async input => input,
    createExportTicket: async input => ({ ticketId: 'ticket-a', token: 'one-time-token', status: 'PENDING', expiresAt: input.now.toISOString() }),
    getEventScope: async () => ({ scopeType: 'EVENT', scopeId: 'event-a', branchId: 'branch-a', status: 'DRAFT' }),
    getEvent: async () => ({
      id: 'event-a', title: '活动', summary: '摘要', description: '介绍', notices: '', version: 3,
    }),
    cloneEvent: async input => ({
      id: 'event-copy', status: 'DRAFT', version: 1,
      startsAt: '2026-09-01T02:00:00.000Z', idempotent: false, captured: input,
    }),
    listRoster: async () => [],
    reviewRegistration: async input => ({
      id: input.registrationId,
      status: input.decision === 'APPROVE' ? 'REGISTERED' : 'REJECTED',
      version: input.expectedVersion + 1,
    }),
    publishEventReminder: async input => ({
      publicationId: 'publication-a',
      recipientCount: 0,
      sendWechatReminder: input.sendWechatReminder,
      wechatDelivery: input.sendWechatReminder ? 'BEST_EFFORT' : 'NOT_REQUESTED',
      idempotent: false,
    }),
    listRoles: async () => [],
    setRole: async input => input,
    getOrderScope: async () => ({ scopeType: 'PLATFORM', scopeId: null }),
    getRefundScope: async () => ({ scopeType: 'PLATFORM', scopeId: null, refundStatus: 'PENDING' }),
    listOrders: async () => [],
    authorizeRefundRetry: async input => {
      audits.push(input.audit)
      return { id: input.refundId, status: 'PENDING' }
    },
    submitRefund: async input => ({ id: 'refund-a', orderId: input.orderId, amountCents: 1000, status: 'PENDING' }),
  }
}

describe('admin service', () => {
  it('records a successful admin workspace entry with the effective scope', async () => {
    const repo = repository('BRANCH_ADMIN', 'BRANCH', 'branch-a')
    repo.dashboard = async () => ({
      totalUsers: 1, newUsers7d: 0, activePlayers: 1, totalEvents: 1,
      publishedEvents: 1, pendingRegistrations: 0, paidOrders: 0,
      pendingRefunds: 0, totalOpportunities: 0, publishedOpportunities: 0,
    })
    const service = createAdminService({ repository: repo, phoneEncryptionKey: secret })
    const result = await service.getDashboard(caller)
    assert.equal(result.counts.totalUsers, 1)
    assert.deepEqual(repo.audits.at(-1), {
      appId: caller.appId,
      actorUserId: 'admin-user',
      scopeType: 'BRANCH',
      scopeId: 'branch-a',
      action: 'admin.session.enter',
      resourceType: 'ADMIN_SESSION',
      resourceId: null,
      effectiveRole: 'BRANCH_ADMIN',
      metadata: {},
    })
  })

  it('rejects a role whose key and stored scope type do not match', async () => {
    const repo = repository('PLATFORM_OWNER', 'BRANCH', 'branch-a')
    const service = createAdminService({ repository: repo, phoneEncryptionKey: secret })
    await assert.rejects(() => service.getSession(caller), /当前账号没有运营权限/)
  })

  it('shows administrative role scopes only to a platform role-change grant', async () => {
    const operationsRepo = repository('PLATFORM_OPERATIONS')
    let operationsOptions
    operationsRepo.listRoles = async (_appId, _visibility, options) => {
      operationsOptions = options
      return []
    }
    const operations = createAdminService({ repository: operationsRepo, phoneEncryptionKey: secret })
    await operations.listRoles(caller)
    assert.deepEqual(operationsOptions, { includeAdministrativeScopes: false })

    const ownerRepo = repository('PLATFORM_OWNER')
    let ownerOptions
    ownerRepo.listRoles = async (_appId, _visibility, options) => {
      ownerOptions = options
      return []
    }
    const owner = createAdminService({ repository: ownerRepo, phoneEncryptionKey: secret })
    await owner.listRoles(caller)
    assert.deepEqual(ownerOptions, { includeAdministrativeScopes: true })
  })

  it('never returns ciphertext and audits original phone reads', async () => {
    const repo = repository()
    const service = createAdminService({ repository: repo, phoneEncryptionKey: secret })
    const response = await service.listUsers(caller, { includePhone: true })
    assert.equal(response.items[0].phoneNumber, '+86 13800138000')
    assert.equal('phoneCiphertext' in response.items[0], false)
    assert.equal(repo.audits.length, 1)
    assert.equal(repo.audits[0].action, 'admin.users.phone.view')
    assert.deepEqual(repo.audits[0].metadata, { count: 1, filters: {
      query: '', status: '', kind: '', branchId: '', controlType: '',
      phoneBound: '', profileComplete: '', joinedWithinDays: 0,
    }, cursor: false })
  })

  it('returns only phone binding state until an original phone read is authorized', async () => {
    const repo = repository('PLATFORM_OPERATIONS')
    const service = createAdminService({ repository: repo, phoneEncryptionKey: '' })
    const response = await service.listUsers(caller, { includePhone: false })
    assert.equal(response.items[0].phoneNumber, null)
    assert.equal(response.items[0].phoneBound, true)
    assert.equal(Object.hasOwn(response.items[0], 'phoneMasked'), false)
    assert.equal(repo.audits.length, 0)
  })

  it('returns an authorized user detail aggregate without leaking ciphertext', async () => {
    const repo = repository()
    const service = createAdminService({ repository: repo, phoneEncryptionKey: secret })
    const detail = await service.getUser(caller, { userId: 'target-user', includePhone: true })
    assert.equal(detail.phoneNumber, '+86 13800138000')
    assert.equal(detail.counts.attended, 2)
    assert.equal(detail.growth.experience, 10)
    assert.equal(Object.hasOwn(detail, 'phoneCiphertext'), false)
    assert.equal(repo.audits.at(-1).resourceType, 'USER')
    assert.deepEqual(repo.audits.at(-1).metadata, { detail: true })
  })

  it('does not cache or leak roster identity fields and audits original phone reads', async () => {
    const repo = repository()
    repo.listRoster = async () => [{
      id: 'registration-a',
      userId: 'target-user',
      nickname: '用户',
      cityName: '广州',
      status: 'REGISTERED',
      answers: {},
      answerItems: [],
      phoneBound: true,
      phoneCiphertext: encryptedPhone({ appId: caller.appId, userId: 'target-user' }),
      submittedAt: new Date().toISOString(),
      registeredAt: new Date().toISOString(),
      checkedInAt: null,
      version: 1,
    }]
    const service = createAdminService({ repository: repo, phoneEncryptionKey: secret })
    const response = await service.listRoster(caller, { eventId: 'event-a', includePhone: true })
    assert.equal(response.items[0].phoneNumber, '+86 13800138000')
    assert.equal(Object.hasOwn(response.items[0], 'userId'), false)
    assert.equal(Object.hasOwn(response.items[0], 'phoneCiphertext'), false)
    assert.equal(repo.audits[0].action, 'admin.events.roster.phone.view')
  })

  it('normalizes complete order filters and returns only server-authorized refund actions', async () => {
    const repo = repository('PLATFORM_FINANCE')
    let captured
    repo.listOrders = async (...args) => {
      captured = args
      return [{
        id: 'order-a', userId: 'target-user', nickname: '用户', orderType: 'MEMBERSHIP',
        resourceId: 'plan-a', resourceType: 'MEMBERSHIP_PLAN', resourceTitle: '年度会员',
        resourceBranchName: '', merchantOrderNoMasked: 'MIP1…0001', providerTransactionIdMasked: null,
        amountCents: 79900, refundedAmountCents: 0, currency: 'CNY', status: 'PAID',
        refundStatus: null, refundId: null, paidAt: '2026-08-20T00:00:00.000Z',
        createdAt: '2026-08-19T00:00:00.000Z', version: 2, branchId: null,
      }]
    }
    const service = createAdminService({ repository: repo, phoneEncryptionKey: secret })
    const response = await service.listOrders(caller, { filters: {
      query: ' MIP-0001 ', orderType: 'MEMBERSHIP', status: 'PAID', refundStatus: 'NONE',
      createdFrom: '2026-08-01T00:00:00.000Z', createdTo: '2026-08-24T23:59:59.999Z',
    } })
    assert.deepEqual(captured[2], {
      query: 'MIP-0001', eventId: '', orderType: 'MEMBERSHIP', status: 'PAID', refundStatus: 'NONE',
      createdFrom: '2026-08-01 00:00:00.000', createdTo: '2026-08-24 23:59:59.999',
    })
    assert.deepEqual(response.items[0].availableRefundActions, ['SUBMIT_REFUND'])
    assert.equal(Object.hasOwn(response.items[0], 'branchId'), false)

    const operationsRepo = repository('PLATFORM_OPERATIONS')
    operationsRepo.listOrders = repo.listOrders
    const operations = createAdminService({ repository: operationsRepo, phoneEncryptionKey: secret })
    const operationsPage = await operations.listOrders(caller)
    assert.deepEqual(operationsPage.items[0].availableRefundActions, [])
  })

  it('rejects invalid order time ranges before reading orders', async () => {
    const repo = repository('PLATFORM_FINANCE')
    let reads = 0
    repo.listOrders = async () => { reads += 1; return [] }
    const service = createAdminService({ repository: repo, phoneEncryptionKey: secret })
    await assert.rejects(() => service.listOrders(caller, { filters: {
      createdFrom: '2026-08-25T00:00:00.000Z',
      createdTo: '2026-08-24T00:00:00.000Z',
    } }), error => error?.code === 'VALIDATION_FAILED')
    assert.equal(reads, 0)
  })

  it('does not let operations submit refunds and does not let finance read phones', async () => {
    const operations = createAdminService({ repository: repository('PLATFORM_OPERATIONS'), phoneEncryptionKey: secret })
    await assert.rejects(() => operations.submitRefund(caller, {
      orderId: 'order-a', reason: '用户申请退款', idempotencyKey: 'refund-1',
    }), /FORBIDDEN/)
    const finance = createAdminService({ repository: repository('PLATFORM_FINANCE'), phoneEncryptionKey: secret })
    await assert.rejects(() => finance.listUsers(caller, { includePhone: true }), /FORBIDDEN/)
  })

  it('dispatches an authorized refund by server refund id without client amount', async () => {
    const calls = []
    const service = createAdminService({
      repository: repository('PLATFORM_FINANCE'),
      phoneEncryptionKey: secret,
      dispatchRefund: async input => {
        calls.push(input)
        return { status: 'PROVIDER_CREATED' }
      },
    })
    const result = await service.submitRefund(caller, {
      orderId: 'order-a', reason: '用户申请退款', idempotencyKey: 'refund-1', amountCents: 1,
    })
    assert.deepEqual(calls, [{ appId: caller.appId, refundId: 'refund-a' }])
    assert.equal(result.amountCents, 1000)
    assert.equal(result.providerDispatch.status, 'PROVIDER_CREATED')
  })

  it('retries only an authorized active refund and audits the attempt', async () => {
    const repo = repository('PLATFORM_FINANCE')
    const service = createAdminService({
      repository: repo,
      phoneEncryptionKey: secret,
      dispatchRefund: async () => ({ status: 'PROCESSING' }),
    })
    const result = await service.retryRefund(caller, { refundId: 'refund-a' })
    assert.equal(result.providerDispatch.status, 'PROCESSING')
    assert.equal(repo.audits.at(-1).action, 'admin.refunds.retry')
  })

  it('dispatches event-cancellation refund ids only after the repository transaction returns', async () => {
    const repo = repository('PLATFORM_OPERATIONS')
    repo.changeEventStatus = async () => ({
      id: 'event-a', status: 'CANCELLED', version: 2, affectedCount: 2,
      refundIds: ['refund-a', 'refund-b'],
    })
    const calls = []
    const service = createAdminService({
      repository: repo,
      phoneEncryptionKey: secret,
      dispatchRefunds: async input => {
        calls.push(input)
        return { scanned: 2, submitted: 2, reconciled: 0, pending: 0, failed: 0 }
      },
    })
    const result = await service.changeEventStatus(caller, {
      eventId: 'event-a', expectedVersion: 1, status: 'CANCELLED', reason: '场地无法使用',
    })
    assert.deepEqual(calls, [{ appId: caller.appId, refundIds: ['refund-a', 'refund-b'] }])
    assert.equal(Object.hasOwn(result, 'refundIds'), false)
    assert.deepEqual(result.refundDispatch, { requested: 2, attempted: 2, deferred: 0, failed: 0 })
  })

  it('uses a distinct scoped capability for registration review', async () => {
    const managerRepo = repository('EVENT_MANAGER', 'EVENT', 'event-a')
    const manager = createAdminService({ repository: managerRepo, phoneEncryptionKey: secret })
    const approved = await manager.reviewRegistration(caller, {
      eventId: 'event-a', registrationId: 'registration-a', expectedVersion: 2, decision: 'APPROVE',
    })
    assert.equal(approved.status, 'REGISTERED')

    const staff = createAdminService({ repository: repository('EVENT_STAFF', 'EVENT', 'event-a'), phoneEncryptionKey: secret })
    await assert.rejects(() => staff.reviewRegistration(caller, {
      eventId: 'event-a', registrationId: 'registration-a', expectedVersion: 2, decision: 'REJECT',
    }), /FORBIDDEN/)
    await assert.rejects(() => staff.listRoster(caller, {
      eventId: 'event-a', includePhone: true,
    }), /FORBIDDEN/)
  })

  it('allows managers but not event staff to undo a check-in with a reason', async () => {
    const managerRepo = repository('EVENT_MANAGER', 'EVENT', 'event-a')
    let captured
    managerRepo.undoCheckIn = async input => {
      captured = input
      return { id: input.registrationId, status: 'REGISTERED', version: input.expectedVersion + 1 }
    }
    const manager = createAdminService({ repository: managerRepo, phoneEncryptionKey: secret })
    const result = await manager.undoCheckIn(caller, {
      eventId: 'event-a',
      registrationId: 'registration-a',
      expectedVersion: 3,
      reason: ' 现场误操作 ',
    })
    assert.equal(result.status, 'REGISTERED')
    assert.equal(captured.reason, '现场误操作')
    assert.equal(captured.audit.action, 'admin.events.checkin.undo')

    const staff = createAdminService({ repository: repository('EVENT_STAFF', 'EVENT', 'event-a'), phoneEncryptionKey: secret })
    await assert.rejects(() => staff.undoCheckIn(caller, {
      eventId: 'event-a',
      registrationId: 'registration-a',
      expectedVersion: 3,
      reason: '现场误操作',
    }), /FORBIDDEN/)
  })

  it('publishes an event reminder only through the scoped communications capability', async () => {
    const repo = repository('BRANCH_ADMIN', 'BRANCH', 'branch-a')
    let captured
    let capturedAudit
    repo.publishEventReminder = async (input) => {
      captured = input
      capturedAudit = input.audit('publication-a', {
        recipientCount: 2,
        sendWechatReminder: true,
      })
      return {
        publicationId: 'publication-a', recipientCount: 2, sendWechatReminder: true,
        wechatDelivery: 'BEST_EFFORT', idempotent: false,
      }
    }
    const service = createAdminService({ repository: repo, phoneEncryptionKey: secret })
    const result = await service.publishEventReminder(caller, {
      eventId: 'event-a',
      expectedVersion: 7,
      idempotencyKey: 'event-reminder-request-0001',
      sendWechatReminder: true,
      recipientUserIds: ['forged-user'],
      title: '伪造标题',
    })
    assert.equal(result.recipientCount, 2)
    assert.deepEqual(Object.keys(captured).sort(), [
      'actorUserId', 'appId', 'audit', 'authorization', 'authorizedScope', 'eventId',
      'expectedVersion', 'idempotencyKey', 'sendWechatReminder',
    ])
    assert.equal(capturedAudit.scopeType, 'EVENT')
    assert.equal(capturedAudit.scopeId, 'event-a')
    assert.equal(capturedAudit.action, 'admin.communications.publish')
    assert.deepEqual(capturedAudit.metadata, {
      eventId: 'event-a', expectedVersion: 7, recipientCount: 2, sendWechatReminder: true,
    })

    for (const [role, scopeType] of [['PLATFORM_FINANCE', 'PLATFORM'], ['EVENT_STAFF', 'EVENT']]) {
      const denied = createAdminService({ repository: repository(role, scopeType, 'event-a'), phoneEncryptionKey: secret })
      await assert.rejects(() => denied.publishEventReminder(caller, {
        eventId: 'event-a', expectedVersion: 7,
        idempotencyKey: 'event-reminder-request-0001', sendWechatReminder: false,
      }), /FORBIDDEN/)
    }
  })

  it('clones only an authorized server-read event definition', async () => {
    const repo = repository('BRANCH_ADMIN', 'BRANCH', 'branch-a')
    let checked
    const service = createAdminService({
      repository: repo,
      phoneEncryptionKey: secret,
      contentSafety: async (content) => { checked = content; return 'PASSED' },
    })
    const result = await service.cloneEvent(caller, {
      sourceEventId: 'event-a',
      expectedVersion: 3,
      idempotencyKey: 'clone-request-0001',
      title: '客户端伪造标题',
      startsAt: '2000-01-01T00:00:00.000Z',
    })
    assert.deepEqual(checked, { title: '活动（副本）', summary: '摘要', description: '介绍', notices: '' })
    assert.equal(result.captured.title, '活动（副本）')
    assert.equal(result.captured.contentSafetyStatus, 'PASSED')
    assert.deepEqual(Object.keys(result.captured).sort(), [
      'actorUserId', 'appId', 'audit', 'authorization', 'authorizedScope',
      'contentSafetyStatus', 'expectedVersion', 'idempotencyKey', 'sourceEventId', 'title',
    ])
    assert.equal(result.captured.audit('event-copy').action, 'admin.events.clone')
    assert.equal(result.captured.audit('event-copy').scopeId, 'event-copy')
  })

  it('enforces branch scope for user changes', async () => {
    const repo = repository('BRANCH_ADMIN', 'BRANCH', 'branch-b')
    const service = createAdminService({ repository: repo, phoneEncryptionKey: secret })
    await assert.rejects(() => service.setUserControl(caller, {
      userId: 'target-user', controlType: 'BLOCKLIST', active: true, reason: '违反社区规则',
    }), /FORBIDDEN/)
  })

  it('creates only a short-lived storage ticket contract for exports', async () => {
    const repo = repository()
    const service = createAdminService({ repository: repo, phoneEncryptionKey: secret, now: () => new Date('2026-08-24T00:00:00.000Z') })
    const result = await service.createExport(caller, {
      exportType: 'USERS', filters: { kind: 'PLAYER' }, includesPhone: true,
    })
    assert.deepEqual(result, {
      ticketId: 'ticket-a', token: 'one-time-token', status: 'PENDING', expiresAt: '2026-08-24T00:00:00.000Z',
    })
    assert.equal('contentBase64' in result, false)
  })

  it('prevents an event manager from granting event owner', async () => {
    const repo = repository('EVENT_MANAGER', 'EVENT', 'event-a')
    const service = createAdminService({ repository: repo, phoneEncryptionKey: secret })
    await assert.rejects(() => service.setRole(caller, {
      userId: 'target-user', roleKey: 'EVENT_OWNER', scopeId: 'event-a', active: true,
    }), /当前账号不能设置活动负责人/)
  })

  it('prevents a branch administrator from moving an existing event to another branch', async () => {
    const repo = repository('BRANCH_ADMIN', 'BRANCH', 'branch-a')
    const service = createAdminService({ repository: repo, phoneEncryptionKey: secret })
    await assert.rejects(() => service.saveEvent(caller, {
      eventId: 'event-a',
      expectedVersion: 1,
      draft: {
        scopeType: 'BRANCH',
        branchId: 'branch-b',
        title: '活动',
        summary: '活动摘要',
        description: '活动介绍',
        notices: '',
        eventTypeKey: 'general',
        eventMode: 'OFFLINE',
        accessType: 'FREE',
        registrationPolicy: 'AUTO',
        startsAt: '2026-08-25T10:00:00.000Z',
        endsAt: '2026-08-25T12:00:00.000Z',
        registrationDeadline: null,
        cancellationDeadline: null,
        venueName: '活动场地',
        address: '',
        cityName: '广州',
        onlineUrl: '',
        capacity: null,
        waitlistEnabled: false,
        priceCents: 0,
        registrationSchema: [],
      },
    }), /当前账号不能修改活动归属/)
  })

  it('lets a branch administrator assign event roles only inside the branch scope', async () => {
    const repo = repository('BRANCH_ADMIN', 'BRANCH', 'branch-a')
    const service = createAdminService({ repository: repo, phoneEncryptionKey: secret })
    const result = await service.setRole(caller, {
      userId: 'target-user', roleKey: 'EVENT_OWNER', scopeId: 'event-a', active: true,
    })
    assert.equal(result.roleKey, 'EVENT_OWNER')
    assert.equal(result.scope.scopeId, 'event-a')
  })

  it('does not expose an admin path for creating arbitrary growth rules', async () => {
    const repo = repository()
    let called = false
    repo.saveGrowthRule = async () => { called = true }
    const service = createAdminService({ repository: repo, phoneEncryptionKey: secret })
    await assert.rejects(() => service.saveGrowthRule(caller, {
      draft: {
        ruleKey: 'event_attended',
        name: '完成活动签到',
        metric: 'EXPERIENCE',
        deltaValue: 100,
        dailyLimitValue: 300,
        sourceEventType: 'event.checked_in',
        status: 'ACTIVE',
      },
    }), /规则标识无效/)
    assert.equal(called, false)
  })

  it('rejects negative values for fixed reward rules before persistence', async () => {
    const repo = repository()
    let called = false
    repo.saveGrowthRule = async () => { called = true }
    const service = createAdminService({ repository: repo, phoneEncryptionKey: secret })
    await assert.rejects(() => service.saveGrowthRule(caller, {
      ruleId: 'rule-existing',
      expectedVersion: 1,
      draft: {
        ruleKey: 'event_attended',
        name: '完成活动签到',
        metric: 'EXPERIENCE',
        deltaValue: -100,
        dailyLimitValue: 300,
        sourceEventType: 'event.checked_in',
        status: 'ACTIVE',
      },
    }), /奖励数值无效/)
    assert.equal(called, false)
  })
})
