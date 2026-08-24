'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { createCommunityService, normalizeReportInput } = require('../domain/service')
const { createProfileRef, readProfileRef } = require('../lib/profile-ref')

const appId = 'wx-community-test'
const callerUserId = '10000000-0000-4000-8000-000000000001'
const targetUserId = '20000000-0000-4000-8000-000000000002'
const pepper = 'community-service-test-pepper-value-over-32'
const profileRef = createProfileRef({ appId, userId: targetUserId }, pepper)
const caller = { appId, userId: callerUserId, primaryBranchId: 'branch-1' }

function service(database, options = {}) {
  return createCommunityService(database, {
    createProfileRef,
    readProfileRef,
    profileRefSecret: pepper,
    id: options.id || (() => '30000000-0000-4000-8000-000000000003'),
  })
}

test('blocks an opaque target without returning an internal user identifier or sending notifications', async () => {
  const reads = []
  const writes = []
  const tx = {
    async one(sql, params) {
      reads.push({ sql, params })
      if (sql.includes('FROM mip_users') && params[1] === callerUserId) {
        return { id: callerUserId, status: 'ACTIVE' }
      }
      if (sql.includes('FROM mip_users')) return { id: targetUserId }
      if (sql.includes('FROM mip_user_blocks')) return null
      throw new Error('unexpected query')
    },
    async query(sql, params) {
      writes.push({ sql, params })
      return { affectedRows: 1 }
    },
  }
  const result = await service({ transaction: work => work(tx) }).blockProfile(caller, { profileRef })
  assert.deepEqual(result, { profileRef, blocked: true, changed: true, version: 1 })
  assert.equal(JSON.stringify(result).includes(targetUserId), false)
  assert.match(reads[0].sql, /SELECT id, status FROM mip_users[\s\S]*FOR UPDATE/)
  assert.deepEqual(reads[0].params, [appId, callerUserId])
  assert.deepEqual(reads[1].params, [appId, targetUserId])
  assert.match(writes[0].sql, /INSERT INTO mip_user_blocks/)
  assert.doesNotMatch(writes[0].sql, /outbox|inbox|notification/i)
})

test('allows a caller to remove an existing block after the target account is no longer active', async () => {
  const writes = []
  const tx = {
    async one(sql, params) {
      if (sql.includes('FROM mip_users') && params[1] === callerUserId) {
        return { id: callerUserId, status: 'ACTIVE' }
      }
      if (sql.includes('FROM mip_users')) {
        assert.doesNotMatch(sql, /status = 'ACTIVE'/)
        return { id: targetUserId }
      }
      return { status: 'ACTIVE', version: 2 }
    },
    async query(sql, params) {
      writes.push({ sql, params })
      return { affectedRows: 1 }
    },
  }
  const result = await service({ transaction: work => work(tx) }).unblockProfile(caller, { profileRef })
  assert.deepEqual(result, { profileRef, blocked: false, changed: true, version: 3 })
  assert.match(writes[0].sql, /status = \?/)
  assert.equal(writes[0].params[0], 'INACTIVE')
})

test('rejects closed callers before target locks or community writes', async () => {
  const operations = [
    current => current.blockProfile(caller, { profileRef }),
    current => current.unblockProfile(caller, { profileRef }),
    current => current.reportProfile(caller, {
      profileRef,
      category: 'SPAM',
      requestId: 'community-report-closed-caller-0001',
    }),
  ]
  for (const operation of operations) {
    const reads = []
    const writes = []
    const database = {
      async transaction(work) {
        return work({
          async one(sql, params) {
            reads.push({ sql, params })
            return { id: callerUserId, status: 'CLOSED' }
          },
          async query(sql, params) {
            writes.push({ sql, params })
            return { affectedRows: 1 }
          },
        })
      },
    }
    await assert.rejects(operation(service(database)), /FORBIDDEN/)
    assert.equal(reads.length, 1)
    assert.match(reads[0].sql, /SELECT id, status FROM mip_users[\s\S]*FOR UPDATE/)
    assert.deepEqual(reads[0].params, [appId, callerUserId])
    assert.equal(writes.length, 0)
  }
})

test('returns only public presentation fields in the caller block list', async () => {
  const database = {
    async query(sql, params) {
      assert.match(sql, /block\.app_id = \? AND block\.blocker_user_id = \?/)
      assert.deepEqual(params, [appId, callerUserId, 21, 0])
      return [{
        blocked_user_id: targetUserId,
        blocked_at: '2026-08-24T08:00:00.000Z',
        nickname: '测试用户',
        headline: '产品设计',
        visibility_json: '{}',
        avatar_file_id: 'cloud://avatar',
        city_name: '深圳',
      }]
    },
  }
  const result = await service(database).listBlocked(caller)
  assert.equal(result.items[0].nickname, '测试用户')
  assert.match(result.items[0].profileRef, /^p1\./)
  assert.equal(JSON.stringify(result).includes(targetUserId), false)
  assert.equal(JSON.stringify(result).includes('blocked_user_id'), false)
})

test('stores one immutable report for a request id and replays the same response', async () => {
  const inserted = []
  const tx = {
    async one(sql, params) {
      if (sql.includes('FROM mip_users') && params[1] === callerUserId) {
        return { id: callerUserId, status: 'ACTIVE' }
      }
      if (sql.includes('FROM mip_users')) return { id: targetUserId }
      if (sql.includes('FROM mip_reports')) return null
      throw new Error('unexpected query')
    },
    async query(sql, params) {
      inserted.push({ sql, params })
      return { affectedRows: 1 }
    },
  }
  const database = { transaction: work => work(tx) }
  const input = {
    profileRef,
    category: 'FRAUD',
    description: '疑似虚假交易信息',
    requestId: 'community-report-request-0001',
  }
  assert.deepEqual(await service(database).reportProfile(caller, input), {
    reportId: '30000000-0000-4000-8000-000000000003',
    status: 'PENDING',
    idempotent: false,
  })
  assert.match(inserted[0].sql, /INSERT INTO mip_reports/)
  assert.doesNotMatch(inserted[0].sql, /outbox|inbox|notification/i)

  const replayDatabase = {
    transaction: async (work) => work({
      async one(sql, params) {
        if (sql.includes('FROM mip_users') && params[1] === callerUserId) {
          return { id: callerUserId, status: 'ACTIVE' }
        }
        if (sql.includes('FROM mip_users')) return { id: targetUserId }
        return {
          id: 'report-existing',
          target_user_id: targetUserId,
          category: 'FRAUD',
          description: '疑似虚假交易信息',
          status: 'PENDING',
        }
      },
    }),
  }
  assert.deepEqual(await service(replayDatabase).reportProfile(caller, input), {
    reportId: 'report-existing',
    status: 'PENDING',
    idempotent: true,
  })
})

test('rejects request id reuse with different report content and self targeting', async () => {
  const existingDatabase = {
    transaction: async work => work({
      async one(sql, params) {
        if (sql.includes('FROM mip_users') && params[1] === callerUserId) {
          return { id: callerUserId, status: 'ACTIVE' }
        }
        if (sql.includes('FROM mip_users')) return { id: targetUserId }
        return {
          id: 'report-existing',
          target_user_id: targetUserId,
          category: 'SPAM',
          description: '',
          status: 'PENDING',
        }
      },
    }),
  }
  await assert.rejects(service(existingDatabase).reportProfile(caller, {
    profileRef,
    category: 'FRAUD',
    requestId: 'community-report-request-0001',
  }), /IDEMPOTENCY_CONFLICT/)

  const selfRef = createProfileRef({ appId, userId: callerUserId }, pepper)
  await assert.rejects(service({}).reportProfile(caller, {
    profileRef: selfRef,
    category: 'SPAM',
    requestId: 'community-report-request-0002',
  }), /SELF_TARGET/)
})

test('accepts only fixed report categories and a bounded optional description', () => {
  assert.equal(normalizeReportInput({
    profileRef,
    category: 'harassment',
    description: '  反复发送骚扰内容  ',
    requestId: 'community-report-request-0003',
  }).category, 'HARASSMENT')
  assert.throws(() => normalizeReportInput({
    profileRef,
    category: 'CUSTOM',
    requestId: 'community-report-request-0004',
  }), /VALIDATION_FAILED/)
  assert.throws(() => normalizeReportInput({
    profileRef,
    category: 'OTHER',
    description: 'a'.repeat(301),
    requestId: 'community-report-request-0005',
  }), /VALIDATION_FAILED/)
})

test('lists only server-filtered visible announcements for the selected branch', async () => {
  const branchId = '40000000-0000-4000-8000-000000000004'
  const calls = []
  const database = {
    async query(sql, params) {
      calls.push({ sql, params })
      return [
        {
          id: '50000000-0000-4000-8000-000000000005',
          title: '活动安排调整',
          summary: '本周活动时间已经更新。',
          is_pinned: 1,
          published_at: '2026-08-24T08:00:00.000Z',
          visible_until: null,
          scope_type: 'BRANCH',
          branch_name: '深圳分会',
          target_type: 'EVENT',
          target_id: '60000000-0000-4000-8000-000000000006',
        },
        {
          id: '70000000-0000-4000-8000-000000000007',
          title: '平台服务通知',
          summary: '服务时间说明。',
          is_pinned: 0,
          published_at: '2026-08-23T08:00:00.000Z',
          visible_until: '2026-09-01T08:00:00.000Z',
          scope_type: 'PLATFORM',
        },
        {
          id: '80000000-0000-4000-8000-000000000008',
          title: '下一页',
          summary: '下一页记录。',
          is_pinned: 0,
          published_at: '2026-08-22T08:00:00.000Z',
          scope_type: 'PLATFORM',
        },
      ]
    },
  }
  const result = await service(database).listAnnouncements({ appId }, {
    branchId,
    limit: 2,
  })
  assert.equal(result.items.length, 2)
  assert.equal(result.items[0].branchName, '深圳分会')
  assert.equal(result.items[0].targetType, 'EVENT')
  assert.equal(result.nextCursor, '2')
  assert.match(calls[0].sql, /status = 'PUBLISHED'/)
  assert.match(calls[0].sql, /visible_from <= UTC_TIMESTAMP/)
  assert.match(calls[0].sql, /scope_type = 'PLATFORM'/)
  assert.deepEqual(calls[0].params, [appId, branchId, branchId, 3, 0])
})

test('returns an active announcement detail and rejects missing or invalid ids', async () => {
  const announcementId = '50000000-0000-4000-8000-000000000005'
  const database = {
    async one(sql, params) {
      assert.match(sql, /announcement\.body/)
      assert.match(sql, /visible_until > UTC_TIMESTAMP/)
      assert.deepEqual(params, [appId, announcementId])
      return {
        id: announcementId,
        title: '活动安排调整',
        summary: '本周活动时间已经更新。',
        body: '活动开始时间调整为周六下午。',
        is_pinned: 1,
        published_at: '2026-08-24T08:00:00.000Z',
        scope_type: 'PLATFORM',
      }
    },
  }
  const result = await service(database).getAnnouncement({ appId }, { announcementId })
  assert.equal(result.body, '活动开始时间调整为周六下午。')
  await assert.rejects(
    service({ async one() { return null } }).getAnnouncement({ appId }, { announcementId }),
    /ANNOUNCEMENT_NOT_FOUND/,
  )
  await assert.rejects(
    service(database).getAnnouncement({ appId }, { announcementId: 'internal-id' }),
    /VALIDATION_FAILED/,
  )
})

test('public announcement actions are dispatched before profile readiness checks', () => {
  const source = require('node:fs').readFileSync(require.resolve('../index'), 'utf8')
  const publicDispatch = source.indexOf("action === 'listAnnouncements'")
  const userResolution = source.indexOf('options.resolveUser(options.database, identity)')
  assert.ok(publicDispatch > 0)
  assert.ok(userResolution > publicDispatch)
})
