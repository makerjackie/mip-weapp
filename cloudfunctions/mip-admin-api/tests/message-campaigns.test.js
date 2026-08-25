'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { CAPABILITIES, roleCapabilities } = require('../domain/capabilities')
const {
  campaignDto,
  createMessageCampaignRepository,
  publishRequestHash,
} = require('../domain/message-campaigns')
const { createProfileRef, readProfileRef } = require('../lib/profile-ref')
const { withTestAuthorization } = require('./test-authorization')

const appId = 'wx-message-test'
const actorUserId = '10000000-0000-4000-8000-000000000001'
const campaignId = '20000000-0000-4000-8000-000000000001'
const recipientId = '30000000-0000-4000-8000-000000000001'

function row(overrides = {}) {
  return {
    id: campaignId,
    scope_type: 'PLATFORM',
    branch_id: null,
    branch_name: '',
    audience_type: 'ALL',
    audience_user_ids_json: '[]',
    name: '八月活动提醒',
    title: '活动安排已更新',
    body: '请在活动页面查看最新安排。',
    status: 'READY',
    content_safety_status: 'PASSED',
    recipient_count: 1,
    submitted_count: 0,
    inbox_ready_count: 0,
    failed_count: 0,
    outbox_pending_count: 0,
    outbox_processing_count: 0,
    outbox_retrying_count: 0,
    outbox_delivered_count: 0,
    outbox_terminal_count: 0,
    external_task_pending_count: 0,
    external_task_processing_count: 0,
    external_task_retrying_count: 0,
    external_task_delivered_count: 0,
    external_task_terminal_count: 0,
    snapshot_at: new Date('2026-08-24T08:00:00.000Z'),
    published_at: null,
    withdrawn_at: null,
    withdrawal_reason: null,
    publish_idempotency_key: null,
    publish_request_hash: null,
    version: 3,
    updated_at: new Date('2026-08-24T08:00:00.000Z'),
    ...overrides,
  }
}

function ids() {
  let next = 0
  return () => `90000000-0000-4000-8000-${String(++next).padStart(12, '0')}`
}

function repository(tx, options = {}) {
  const database = {
    transaction: work => work(tx),
    one: (...args) => tx.one(...args),
    query: (...args) => tx.query(...args),
  }
  return createMessageCampaignRepository(database, withTestAuthorization({
    createId: ids(),
    now: () => new Date('2026-08-24T09:00:00.000Z'),
    ...options,
  }))
}

function authorization() {
  return {
    capability: CAPABILITIES.MESSAGES_MANAGE,
    effectiveGrant: { roleKey: 'PLATFORM_OWNER', scopeType: 'PLATFORM', scopeId: null },
  }
}

describe('admin message campaigns', () => {
  it('uses a distinct capability for platform and branch operators only', () => {
    assert.equal(roleCapabilities.PLATFORM_OPERATIONS.includes(CAPABILITIES.MESSAGES_MANAGE), true)
    assert.equal(roleCapabilities.BRANCH_ADMIN.includes(CAPABILITIES.MESSAGES_MANAGE), true)
    for (const role of ['PLATFORM_FINANCE', 'EVENT_OWNER', 'EVENT_MANAGER', 'EVENT_STAFF']) {
      assert.equal(roleCapabilities[role].includes(CAPABILITIES.MESSAGES_MANAGE), false)
    }
  })

  it('reports inbox, business outbox, and external delivery task facts independently', () => {
    const campaign = campaignDto(row({
      submitted_count: 4,
      inbox_ready_count: 3,
      failed_count: 1,
      outbox_pending_count: 0,
      outbox_processing_count: 0,
      outbox_retrying_count: 1,
      outbox_delivered_count: 3,
      outbox_terminal_count: 0,
      external_task_pending_count: 0,
      external_task_processing_count: 0,
      external_task_retrying_count: 1,
      external_task_delivered_count: 1,
      external_task_terminal_count: 1,
    }))

    assert.deepEqual(campaign.deliveryStats, {
      submittedCount: 4,
      inboxReadyCount: 3,
      failedCount: 1,
      outboxStats: {
        pendingCount: 0,
        processingCount: 0,
        retryingCount: 1,
        deliveredCount: 3,
        terminalCount: 0,
      },
      externalTaskStats: {
        pendingCount: 0,
        processingCount: 0,
        retryingCount: 1,
        deliveredCount: 1,
        terminalCount: 1,
      },
    })
  })

  it('derives inbox readiness from the durable inbox row rather than outbox or external status', async () => {
    const calls = []
    const tx = {
      async one() { return null },
      async query(sql, params) {
        calls.push({ sql, params })
        return [row()]
      },
    }

    await repository(tx).listCampaigns(
      appId,
      { platform: true, branchIds: [] },
      {},
      20,
    )
    const sql = calls[0].sql
    const inboxStart = sql.indexOf('(SELECT COUNT(*) FROM mip_operations_messages ready_message')
    const inboxEnd = sql.indexOf(') AS inbox_ready_count')
    const inboxSql = sql.slice(inboxStart, inboxEnd)
    assert.match(inboxSql, /INNER JOIN mip_inbox_messages ready_inbox/)
    assert.match(inboxSql, /ready_inbox\.recipient_user_id = ready_message\.recipient_user_id/)
    assert.match(inboxSql, /ready_inbox\.dedupe_key = CONCAT\('outbox:', ready_outbox\.id, ':operations'\)/)
    assert.doesNotMatch(inboxSql, /ready_outbox\.status/)
    assert.match(sql, /counted_outbox\.status = 'FAILED'/)
    assert.match(sql, /counted_outbox\.status = 'CANCELLED'/)
    assert.match(sql, /INNER JOIN mip_delivery_tasks external_task/)
    assert.match(sql, /external_task\.status = 'FAILED'/)
    assert.match(sql, /external_task\.status = 'CANCELLED'/)
  })

  it('creates an immutable recipient snapshot from current app-scoped server facts', async () => {
    const calls = []
    let readCount = 0
    const tx = {
      async one(sql, params) {
        calls.push({ sql, params })
        readCount += 1
        return readCount === 1 ? row({ status: 'DRAFT', recipient_count: 0, snapshot_at: null, version: 2 }) : row()
      },
      async query(sql, params) {
        calls.push({ sql, params })
        if (sql.includes('FROM mip_users user') && sql.includes('ORDER BY user.id')) {
          return [{ id: recipientId, primary_branch_id: null, kind: 'PLAYER' }]
        }
        return { affectedRows: 1 }
      },
    }
    const result = await repository(tx).snapshotCampaign({
      appId,
      actorUserId,
      campaignId,
      expectedVersion: 2,
      authorization: authorization(),
      authorizedScope: { scopeType: 'PLATFORM', scopeId: null },
      audit: (resourceId, action, metadata) => ({
        appId, actorUserId, scopeType: 'PLATFORM', resourceId, action, metadata,
      }),
    })
    assert.equal(result.status, 'READY')
    const recipientRead = calls.find(call => call.sql.includes('FROM mip_users user') && call.sql.includes('ORDER BY user.id'))
    assert.match(recipientRead.sql, /user\.app_id = \? AND user\.status = 'ACTIVE'/)
    assert.match(recipientRead.sql, /mip_membership_entitlements/)
    const snapshotInsert = calls.find(call => call.sql.includes('INSERT INTO mip_message_campaign_recipients'))
    assert.equal(snapshotInsert.params.includes(recipientId), true)
    assert.equal(calls.some(call => call.sql.includes('DELETE FROM mip_message_campaign_recipients')), false)
  })

  it('publishes one authoritative operation fact and outbox event per snapshotted recipient', async () => {
    const calls = []
    const tx = {
      async one(sql, params) {
        calls.push({ sql, params })
        return row()
      },
      async query(sql, params) {
        calls.push({ sql, params })
        if (sql.includes('FROM mip_message_campaign_recipients')) {
          return [{ recipient_user_id: recipientId }]
        }
        return { affectedRows: 1 }
      },
    }
    const input = {
      appId,
      actorUserId,
      campaignId,
      expectedVersion: 3,
      idempotencyKey: 'message-publish-request-001',
      authorization: authorization(),
      authorizedScope: { scopeType: 'PLATFORM', scopeId: null },
      audit: (resourceId, action, metadata) => ({
        appId, actorUserId, scopeType: 'PLATFORM', resourceId, action, metadata,
      }),
    }
    const result = await repository(tx).publishCampaign(input)
    assert.deepEqual(result, {
      campaignId,
      status: 'PUBLISHED',
      recipientCount: 1,
      queuedCount: 1,
      wechatDelivery: 'NOT_CONFIGURED',
      version: 4,
      idempotent: false,
    })
    const messages = calls.find(call => call.sql.includes('INSERT INTO mip_operations_messages'))
    assert.equal(messages.params.includes(recipientId), true)
    assert.equal(messages.params.includes('活动安排已更新'), true)
    const outbox = calls.find(call => call.sql.includes('INSERT INTO mip_outbox_events'))
    assert.match(outbox.sql, /operations\.notification_published/)
    assert.match(outbox.sql, /JSON_OBJECT\(\)/)
    assert.equal(calls.filter(call => call.sql.includes('INSERT INTO mip_audit_logs')).length, 1)
  })

  it('replays the same publish request without appending another message', async () => {
    const input = {
      appId,
      actorUserId,
      campaignId,
      expectedVersion: 3,
      idempotencyKey: 'message-publish-request-001',
      authorization: authorization(),
      authorizedScope: { scopeType: 'PLATFORM', scopeId: null },
      audit: () => ({}),
    }
    const calls = []
    const tx = {
      async one(sql, params) {
        calls.push({ sql, params })
        return row({
          status: 'PUBLISHED',
          published_at: new Date('2026-08-24T09:00:00.000Z'),
          publish_idempotency_key: input.idempotencyKey,
          publish_request_hash: publishRequestHash(input),
          version: 4,
        })
      },
      async query(sql, params) {
        calls.push({ sql, params })
        return { affectedRows: 1 }
      },
    }
    const result = await repository(tx).publishCampaign(input)
    assert.equal(result.idempotent, true)
    assert.equal(result.version, 4)
    assert.equal(calls.some(call => call.sql.includes('INSERT INTO mip_operations_messages')), false)
    assert.equal(calls.some(call => call.sql.includes('INSERT INTO mip_outbox_events')), false)
  })

  it('withdraws campaign state without deleting or rewriting published recipient facts', async () => {
    const calls = []
    let reads = 0
    const tx = {
      async one(sql, params) {
        calls.push({ sql, params })
        reads += 1
        return reads === 1
          ? row({ status: 'PUBLISHED', published_at: new Date('2026-08-24T09:00:00.000Z'), version: 4 })
          : row({
              status: 'WITHDRAWN',
              published_at: new Date('2026-08-24T09:00:00.000Z'),
              withdrawn_at: new Date('2026-08-24T10:00:00.000Z'),
              withdrawal_reason: '内容已过期',
              version: 5,
            })
      },
      async query(sql, params) {
        calls.push({ sql, params })
        return { affectedRows: 1 }
      },
    }
    const result = await repository(tx).withdrawCampaign({
      appId,
      actorUserId,
      campaignId,
      expectedVersion: 4,
      reason: '内容已过期',
      authorization: authorization(),
      authorizedScope: { scopeType: 'PLATFORM', scopeId: null },
      audit: (resourceId, action, metadata) => ({
        appId, actorUserId, scopeType: 'PLATFORM', resourceId, action, metadata,
      }),
    })
    assert.equal(result.status, 'WITHDRAWN')
    assert.equal(calls.some(call => /UPDATE\s+mip_operations_messages/i.test(call.sql)), false)
    assert.equal(calls.some(call => /DELETE\s+FROM\s+mip_operations_messages/i.test(call.sql)), false)
  })

  it('uses stable AppID-bound opaque recipient references', () => {
    const pepper = 'message-campaign-profile-reference-secret-2026'
    const first = createProfileRef({ appId, userId: recipientId }, pepper)
    const second = createProfileRef({ appId, userId: recipientId }, pepper)
    assert.equal(first, second)
    assert.equal(first.includes(recipientId), false)
    assert.equal(readProfileRef(first, appId, pepper), recipientId)
    assert.throws(() => readProfileRef(first, 'wx-other-app', pepper), /TARGET_NOT_FOUND/)
  })
})
