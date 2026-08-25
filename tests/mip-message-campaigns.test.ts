import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  parseMessageCampaign,
  parseMessageCampaignPublication,
  parseMessageRecipientPage,
} from '../src/modules/mip-admin/message-campaigns'

const campaign = {
  id: '20000000-0000-4000-8000-000000000001',
  scopeType: 'PLATFORM',
  branchId: null,
  branchName: '',
  audienceType: 'ALL',
  recipientRefs: [],
  name: '八月活动提醒',
  title: '活动安排已更新',
  body: '请在活动页面查看最新安排。',
  status: 'READY',
  contentSafetyStatus: 'PASSED',
  recipientCount: 12,
  deliveryStats: { submittedCount: 0, inboxReadyCount: 0, failedCount: 0 },
  snapshotAt: '2026-08-24T08:00:00.000Z',
  publishedAt: null,
  withdrawnAt: null,
  withdrawalReason: '',
  activeDispatch: null,
  version: 3,
  updatedAt: '2026-08-24T08:00:00.000Z',
}

describe('MIP message campaign admin contract', () => {
  it('parses bounded campaign, recipient and publication responses without internal user ids', () => {
    const parsedCampaign = parseMessageCampaign(campaign)
    expect(parsedCampaign.recipientCount).toBe(12)
    expect(parsedCampaign.deliveryStats.outboxStats).toEqual({
      pendingCount: 0,
      processingCount: 0,
      retryingCount: 0,
      deliveredCount: 0,
      terminalCount: 0,
    })
    expect(parsedCampaign.deliveryStats.externalTaskStats).toEqual({
      pendingCount: 0,
      processingCount: 0,
      retryingCount: 0,
      deliveredCount: 0,
      terminalCount: 0,
    })
    const profileRef = `p1.${'a'.repeat(16)}.${'b'.repeat(48)}.${'c'.repeat(22)}`
    const recipients = parseMessageRecipientPage({
      items: [{ profileRef, nickname: '林然', headline: '产品经理', branchName: '深圳分会' }],
      nextCursor: null,
    })
    expect(recipients.items[0]?.profileRef).toBe(profileRef)
    expect(parseMessageCampaignPublication({
      campaignId: campaign.id,
      status: 'PUBLISHED',
      recipientCount: 12,
      queuedCount: 12,
      wechatDelivery: 'NOT_CONFIGURED',
      version: 4,
      idempotent: false,
    }).queuedCount).toBe(12)
    expect(() => parseMessageRecipientPage({
      items: [{ profileRef, nickname: '林然', headline: '', branchName: '', userId: 'hidden' }],
      nextCursor: null,
    })).toThrow()
  })

  it('accepts typed outbox and external task breakdowns without weakening response validation', () => {
    const parsed = parseMessageCampaign({
      ...campaign,
      deliveryStats: {
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
      },
    })

    expect(parsed.deliveryStats.outboxStats.deliveredCount).toBe(3)
    expect(parsed.deliveryStats.externalTaskStats.terminalCount).toBe(1)
    expect(() => parseMessageCampaign({
      ...campaign,
      deliveryStats: {
        submittedCount: 1,
        inboxReadyCount: 1,
        failedCount: 0,
        outboxStats: {
          pendingCount: 0,
          processingCount: 0,
          retryingCount: 0,
          deliveredCount: 1,
          terminalCount: -1,
        },
      },
    })).toThrow()
  })

  it('strictly parses the public active dispatch and rejects malformed or internal scheduling data', () => {
    const activeDispatch = {
      status: 'FAILED',
      scheduledFor: '2030-08-24T08:00:00.000Z',
      attempts: 2,
      lastOutcome: 'KNOWN_FAILED',
      retryDisposition: 'RETRIABLE',
      lastErrorCode: 'PROVIDER_UNAVAILABLE',
      version: 3,
      updatedAt: '2030-08-24T08:01:00.000Z',
    }
    expect(parseMessageCampaign({ ...campaign, activeDispatch }).activeDispatch).toEqual(activeDispatch)
    expect(() => parseMessageCampaign({
      ...campaign,
      activeDispatch: { ...activeDispatch, retryDisposition: 'AUTO_RETRY' },
    })).toThrow()
    expect(() => parseMessageCampaign({
      ...campaign,
      activeDispatch: { ...activeDispatch, scheduledFor: '2030-08-24 16:00' },
    })).toThrow()
    expect(() => parseMessageCampaign({
      ...campaign,
      activeDispatch: { ...activeDispatch, scheduledFor: '2030-02-31T08:00:00.000Z' },
    })).toThrow()
    expect(() => parseMessageCampaign({
      ...campaign,
      activeDispatch: { ...activeDispatch, version: 0 },
    })).toThrow()
    expect(() => parseMessageCampaign({
      ...campaign,
      activeDispatch: { ...activeDispatch, attempts: 6 },
    })).toThrow()
    expect(() => parseMessageCampaign({
      ...campaign,
      activeDispatch: { ...activeDispatch, leaseToken: 'private' },
    })).toThrow()
    const { activeDispatch: _activeDispatch, ...missingDispatch } = campaign
    expect(() => parseMessageCampaign(missingDispatch)).toThrow()
  })

  it('keeps message management separate from announcements and exposes complete page states', () => {
    const operations = readFileSync('cloudfunctions/mip-admin-api/domain/operations/messaging.js', 'utf8')
    const gateway = readFileSync('src/modules/mip-admin/cloudbase-gateway.ts', 'utf8')
    const types = readFileSync('src/modules/mip-admin/types.ts', 'utf8')
    const page = readFileSync('src/packages/admin/message-campaigns/index.wxml', 'utf8')
    expect(operations).toContain('mip.admin.messageCampaigns.publish')
    expect(types).toContain('messages.manage')
    expect(gateway).toContain('mip.admin.messageCampaigns.snapshot')
    expect(page).toContain('消息管理')
    expect(page).toContain('state === \'forbidden\'')
    expect(page).toContain('state === \'error\' || state === \'conflict\'')
    expect(page).toContain('暂无消息活动')
    expect(page).toContain('生成收件人快照')
    expect(page).toContain('送达结果以用户消息列表为准')
  })

  it('adds append-only campaign storage and preserves per-recipient operation facts', () => {
    const migration = readFileSync('database/mysql/mip/031_message_campaigns.sql', 'utf8')
    const domain = readFileSync('cloudfunctions/mip-admin-api/domain/message-campaigns.js', 'utf8')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS mip_message_campaigns')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS mip_message_campaign_recipients')
    expect(domain).toContain('INSERT INTO mip_operations_messages')
    expect(domain).toContain('operations.notification_published')
    expect(domain).not.toMatch(/DELETE\s+FROM\s+mip_message_campaign_recipients/i)
  })
})
