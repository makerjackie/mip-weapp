'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createAnnouncementRepository: createProductionAnnouncementRepository } = require('../domain/announcements')
const { createAdminService } = require('../domain/service')
const { withTestAuthorization } = require('./test-authorization')
const {
  normalizeAnnouncementDraft,
  normalizeAnnouncementFilters,
  normalizeAnnouncementReason,
} = require('../domain/announcement-validation')

const appId = 'wx-announcement-test'
const actorUserId = '10000000-0000-4000-8000-000000000001'
const announcementId = '20000000-0000-4000-8000-000000000002'

function createAnnouncementRepository(database, options) {
  return createProductionAnnouncementRepository(database, withTestAuthorization(options))
}

function row(overrides = {}) {
  return {
    id: announcementId,
    scope_type: 'PLATFORM',
    branch_id: null,
    branch_name: null,
    title: '活动安排调整',
    summary: '本周活动时间已经更新。',
    body: '活动开始时间调整为周六下午。',
    target_type: null,
    target_id: null,
    status: 'DRAFT',
    content_safety_status: 'PASSED',
    is_pinned: 0,
    visible_from: '2026-08-24T07:00:00.000Z',
    visible_until: '2026-09-24T07:00:00.000Z',
    published_at: null,
    withdrawn_at: null,
    version: 1,
    updated_at: '2026-08-24T07:00:00.000Z',
    ...overrides,
  }
}

function draft(overrides = {}) {
  return {
    scopeType: 'PLATFORM',
    branchId: null,
    title: '活动安排调整',
    summary: '本周活动时间已经更新。',
    body: '活动开始时间调整为周六下午。',
    targetType: null,
    targetId: null,
    visibleFrom: new Date('2026-08-24T07:00:00.000Z'),
    visibleUntil: new Date('2026-09-24T07:00:00.000Z'),
    ...overrides,
  }
}

function audit(resourceId, action, metadata) {
  return {
    appId,
    actorUserId,
    scopeType: 'PLATFORM',
    scopeId: null,
    action,
    resourceId,
    effectiveRole: 'PLATFORM_OPERATIONS',
    metadata,
  }
}

describe('MIP announcement repository', () => {
  it('locks only the announcement alias when a transaction-local read requests a lock', async () => {
    const calls = []
    const adapter = {
      async one(sql, params) {
        calls.push({ sql, params })
        return row()
      },
    }
    const repository = createAnnouncementRepository(adapter)

    await repository.getAnnouncement(appId, announcementId, adapter)
    await repository.getAnnouncement(appId, announcementId, adapter, true)

    assert.doesNotMatch(calls[0].sql, /FOR UPDATE/)
    assert.match(calls[1].sql, /FROM mip_announcements announcement/)
    assert.match(calls[1].sql, /FOR UPDATE OF announcement$/)
    assert.deepEqual(calls.map(call => call.params), [
      [appId, announcementId],
      [appId, announcementId],
    ])
  })

  it('lists only announcement scopes covered by the caller visibility', async () => {
    const calls = []
    const repository = createAnnouncementRepository({
      async query(sql, params) {
        calls.push({ sql, params })
        return [{ id: 'branch-a', name: '深圳分会' }]
      },
    })
    const result = await repository.listAnnouncementScopes(appId, {
      platform: false,
      branchIds: ['branch-a'],
      eventIds: [],
    })
    assert.deepEqual(result, { platform: false, branches: [{ id: 'branch-a', name: '深圳分会' }] })
    assert.match(calls[0].sql, /app_id = \? AND status = 'ACTIVE'/)
    assert.deepEqual(calls[0].params, [appId, 'branch-a'])
  })

  it('creates an app-scoped draft with safety result and an immutable audit', async () => {
    const calls = []
    const tx = {
      async one(sql, params) {
        calls.push({ kind: 'one', sql, params })
        return row()
      },
      async query(sql, params) {
        calls.push({ kind: 'query', sql, params })
        return { affectedRows: 1 }
      },
    }
    const repository = createAnnouncementRepository({ transaction: work => work(tx) }, {
      id: () => announcementId,
    })
    const result = await repository.saveAnnouncement({
      appId,
      actorUserId,
      announcementId: null,
      expectedVersion: null,
      contentSafetyStatus: 'PASSED',
      draft: draft(),
      audit,
    })
    assert.equal(result.id, announcementId)
    const source = calls.map(call => call.sql).join('\n')
    assert.match(source, /INSERT INTO mip_announcements/)
    assert.match(source, /INSERT INTO mip_audit_logs/)
    assert.doesNotMatch(source, /DELETE FROM/)
    const insert = calls.find(call => call.sql.includes('INSERT INTO mip_announcements'))
    assert.equal(insert.params[1], appId)
    assert.equal(insert.params.at(-2), actorUserId)
    assert.equal(insert.params.at(-1), actorUserId)
  })

  it('cannot attach a new announcement after an opportunity has been archived', async () => {
    const writes = []
    const repository = createAnnouncementRepository({
      transaction: work => work({
        async one(sql) {
          assert.match(sql, /FROM mip_opportunities[\s\S]*FOR UPDATE/)
          return { scope_type: 'PLATFORM', branch_id: null, status: 'ARCHIVED' }
        },
        async query(sql) {
          writes.push(sql)
          return { affectedRows: 1 }
        },
      }),
    })
    await assert.rejects(() => repository.saveAnnouncement({
      appId,
      actorUserId,
      announcementId: null,
      expectedVersion: null,
      contentSafetyStatus: 'PASSED',
      draft: draft({ targetType: 'OPPORTUNITY', targetId: announcementId }),
      audit,
    }), /INVALID_STATE/)
    assert.equal(writes.length, 0)
  })

  it('publishes only a safety-approved visible fact and appends an outbox event', async () => {
    const calls = []
    let updated = false
    const tx = {
      async one(sql, params) {
        calls.push({ kind: 'one', sql, params })
        return updated
          ? row({ status: 'PUBLISHED', published_at: '2026-08-24T08:00:00.000Z', version: 2 })
          : row()
      },
      async query(sql, params) {
        calls.push({ kind: 'query', sql, params })
        if (sql.includes("SET status = 'PUBLISHED'")) updated = true
        return { affectedRows: 1 }
      },
    }
    const repository = createAnnouncementRepository({ transaction: work => work(tx) }, {
      id: () => '30000000-0000-4000-8000-000000000003',
      now: () => new Date('2026-08-24T08:00:00.000Z'),
    })
    const result = await repository.publishAnnouncement({
      appId,
      actorUserId,
      announcementId,
      expectedVersion: 1,
      audit,
    })
    assert.equal(result.status, 'PUBLISHED')
    assert.equal(result.version, 2)
    const source = calls.map(call => call.sql).join('\n')
    assert.match(source, /announcement\.published/)
    assert.match(source, /aggregate_type, aggregate_id, event_type/)

    const denied = createAnnouncementRepository({
      transaction: work => work({
        async one() { return row({ content_safety_status: 'REJECTED' }) },
        async query() { throw new Error('must not write') },
      }),
    })
    await assert.rejects(() => denied.publishAnnouncement({
      appId,
      actorUserId,
      announcementId,
      expectedVersion: 1,
      audit,
    }), /CONTENT_SAFETY_REQUIRED/)
  })

  it('replaces one pinned announcement in the same scope and records the replacement', async () => {
    const calls = []
    let updated = false
    const tx = {
      async one(sql, params) {
        calls.push({ kind: 'one', sql, params })
        return updated
          ? row({ status: 'PUBLISHED', is_pinned: 1, published_at: '2026-08-24T08:00:00.000Z', version: 3 })
          : row({ status: 'PUBLISHED', published_at: '2026-08-24T08:00:00.000Z', version: 2 })
      },
      async query(sql, params) {
        calls.push({ kind: 'query', sql, params })
        if (sql.startsWith('SELECT id FROM mip_announcements')) {
          return [{ id: '40000000-0000-4000-8000-000000000004' }]
        }
        if (sql.includes('WHERE app_id = ? AND id = ? AND version = ?')) updated = true
        return { affectedRows: 1 }
      },
    }
    const repository = createAnnouncementRepository({ transaction: work => work(tx) })
    const result = await repository.setAnnouncementPinned({
      appId,
      actorUserId,
      announcementId,
      expectedVersion: 2,
      pinned: true,
      audit,
    })
    assert.equal(result.isPinned, true)
    const replacedUpdate = calls.find(call => call.sql.includes('id IN'))
    assert.deepEqual(replacedUpdate.params, [
      actorUserId,
      appId,
      '40000000-0000-4000-8000-000000000004',
    ])
    const auditWrite = calls.find(call => call.sql.includes('INSERT INTO mip_audit_logs'))
    assert.match(String(auditWrite.params.at(-1)), /40000000-0000-4000-8000-000000000004/)
  })
})

describe('MIP announcement validation', () => {
  it('normalizes a bounded branch announcement and related event', () => {
    const result = normalizeAnnouncementDraft({
      scopeType: 'BRANCH',
      branchId: '50000000-0000-4000-8000-000000000005',
      title: ' 活动安排调整 ',
      summary: ' 本周活动时间已经更新。 ',
      body: ' 活动开始时间调整为周六下午。 ',
      targetType: 'EVENT',
      targetId: '60000000-0000-4000-8000-000000000006',
      visibleFrom: '2026-08-24T08:00:00.000Z',
      visibleUntil: '2026-09-24T08:00:00.000Z',
    })
    assert.equal(result.scopeType, 'BRANCH')
    assert.equal(result.title, '活动安排调整')
    assert.equal(result.targetType, 'EVENT')
    assert.equal(result.visibleFrom.toISOString(), '2026-08-24T08:00:00.000Z')
  })

  it('rejects invalid windows, partial targets, filters, and empty reasons', () => {
    assert.throws(() => normalizeAnnouncementDraft({
      ...draft(),
      visibleUntil: '2026-08-24T06:00:00.000Z',
    }), /展示结束时间必须晚于开始时间/)
    assert.throws(() => normalizeAnnouncementDraft({
      ...draft(),
      targetType: 'EVENT',
    }), /公告关联内容无效/)
    assert.throws(() => normalizeAnnouncementFilters({ status: 'REMOVED' }), /公告状态无效/)
    assert.throws(() => normalizeAnnouncementReason(''), /撤回原因/)
  })
})

describe('MIP announcement service authorization', () => {
  function serviceRepository(roleKey, scopeType, scopeId) {
    const calls = []
    return {
      calls,
      resolveUser: async () => ({
        id: actorUserId, status: 'ACTIVE', agreementsAccepted: true,
        phoneBound: true, profileComplete: true,
      }),
      listRoleBindings: async () => [{ roleKey, scopeType, scopeId }],
      listAnnouncementScopes: async (resolvedAppId, visibility) => {
        calls.push({ type: 'scopes', resolvedAppId, visibility })
        return { platform: visibility.platform, branches: [] }
      },
      listAnnouncements: async (resolvedAppId, visibility, filters) => {
        calls.push({ type: 'list', resolvedAppId, visibility, filters })
        return []
      },
      getAnnouncementScope: async () => ({ scopeType: 'BRANCH', scopeId, status: 'DRAFT' }),
      getAnnouncement: async () => ({ ...row(), scopeType: 'BRANCH', scopeId }),
      saveAnnouncement: async input => {
        calls.push({ type: 'save', input })
        return { ...row(), body: input.draft.body }
      },
    }
  }

  it('limits branch administrators to their own announcement scope', async () => {
    const branchId = '50000000-0000-4000-8000-000000000005'
    const repository = serviceRepository('BRANCH_ADMIN', 'BRANCH', branchId)
    const service = createAdminService({ repository })
    await service.listAnnouncements({ appId, identityKey: 'identity' }, {})
    assert.deepEqual(repository.calls[0].visibility, {
      platform: false,
      branchIds: [branchId],
      eventIds: [],
    })
    await assert.rejects(() => service.saveAnnouncement({ appId, identityKey: 'identity' }, {
      ...draft(),
      visibleFrom: '2026-08-24T07:00:00.000Z',
      visibleUntil: '2026-09-24T07:00:00.000Z',
    }), /FORBIDDEN/)
    assert.equal(repository.calls.some(call => call.type === 'save'), false)
  })

  it('lets platform operations save a checked draft and denies event roles', async () => {
    const repository = serviceRepository('PLATFORM_OPERATIONS', 'PLATFORM', null)
    const checked = []
    const service = createAdminService({
      repository,
      contentSafety: async value => {
        checked.push(value.body)
        return 'PASSED'
      },
    })
    await service.saveAnnouncement({ appId, identityKey: 'identity' }, {
      ...draft(),
      visibleFrom: '2026-08-24T07:00:00.000Z',
      visibleUntil: '2026-09-24T07:00:00.000Z',
    })
    assert.deepEqual(checked, ['活动开始时间调整为周六下午。'])
    assert.equal(repository.calls.find(call => call.type === 'save').input.contentSafetyStatus, 'PASSED')

    const denied = createAdminService({
      repository: serviceRepository('EVENT_MANAGER', 'EVENT', '60000000-0000-4000-8000-000000000006'),
    })
    await assert.rejects(() => denied.listAnnouncementScopes({ appId, identityKey: 'identity' }), /FORBIDDEN/)
  })
})
