import type { AdminAnnouncement, AdminAnnouncementDraft } from '../src/modules/mip-admin/announcements'
import type { AdminMessageCampaign, AdminMessageCampaignDraft } from '../src/modules/mip-admin/message-campaigns'
import type { MipMessagingAdmin } from '../src/modules/mip-admin/messaging-admin'
import type { MipAdminGateway } from '../src/modules/mip-admin/types'
import { describe, expect, it, vi } from 'vitest'
import { createMipAdminModule } from '../src/modules/mip-admin/client'
import { MipAdminError } from '../src/modules/mip-admin/types'

const announcement: AdminAnnouncement = {
  id: '10000000-0000-4000-8000-000000000001',
  scopeType: 'PLATFORM',
  branchId: null,
  branchName: '',
  title: '活动安排',
  summary: '本周活动安排已更新。',
  body: '请查看最新活动安排。',
  targetType: null,
  targetId: null,
  status: 'DRAFT',
  contentSafetyStatus: 'PASSED',
  isPinned: false,
  visibleFrom: '2026-08-25T08:00:00.000Z',
  visibleUntil: null,
  publishedAt: null,
  withdrawnAt: null,
  version: 1,
  updatedAt: '2026-08-25T08:00:00.000Z',
}

const campaign: AdminMessageCampaign = {
  id: '20000000-0000-4000-8000-000000000001',
  scopeType: 'PLATFORM',
  branchId: null,
  branchName: '',
  audienceType: 'ALL',
  recipientRefs: [],
  name: '八月活动提醒',
  title: '活动安排已更新',
  body: '请在活动页面查看最新安排。',
  status: 'DRAFT',
  contentSafetyStatus: 'PASSED',
  recipientCount: 0,
  deliveryStats: { submittedCount: 0, inboxReadyCount: 0, failedCount: 0 },
  snapshotAt: null,
  publishedAt: null,
  withdrawnAt: null,
  withdrawalReason: '',
  activeDispatch: null,
  version: 1,
  updatedAt: '2026-08-25T08:00:00.000Z',
}

function createHarness() {
  const spies = {
    getAnnouncementScopes: vi.fn<MipAdminGateway['getAnnouncementScopes']>(async () => ({
      platform: true,
      branches: [{ id: 'branch-a', name: '深圳分会' }],
    })),
    listAnnouncements: vi.fn<MipAdminGateway['listAnnouncements']>(async () => ({
      items: [announcement],
      nextCursor: null,
    })),
    getAnnouncement: vi.fn<MipAdminGateway['getAnnouncement']>(async () => announcement),
    saveAnnouncement: vi.fn<MipAdminGateway['saveAnnouncement']>(async () => announcement),
    publishAnnouncement: vi.fn<MipAdminGateway['publishAnnouncement']>(async () => ({
      ...announcement,
      status: 'PUBLISHED',
      version: 2,
    })),
    withdrawAnnouncement: vi.fn<MipAdminGateway['withdrawAnnouncement']>(async () => ({
      ...announcement,
      status: 'WITHDRAWN',
      version: 2,
    })),
    setAnnouncementPinned: vi.fn<MipAdminGateway['setAnnouncementPinned']>(async () => ({
      ...announcement,
      isPinned: true,
      version: 2,
    })),
    getMessageCampaignScopes: vi.fn<MipAdminGateway['getMessageCampaignScopes']>(async () => ({
      platform: true,
      branches: [{ id: 'branch-a', name: '深圳分会' }],
    })),
    listMessageCampaigns: vi.fn<MipAdminGateway['listMessageCampaigns']>(async () => ({
      items: [campaign],
      nextCursor: null,
    })),
    getMessageCampaign: vi.fn<MipAdminGateway['getMessageCampaign']>(async () => campaign),
    searchMessageRecipients: vi.fn<MipAdminGateway['searchMessageRecipients']>(async () => ({
      items: [{
        profileRef: `p1.${'a'.repeat(16)}.${'b'.repeat(48)}.${'c'.repeat(22)}`,
        nickname: '林然',
        headline: '产品经理',
        branchName: '深圳分会',
      }],
      nextCursor: null,
    })),
    saveMessageCampaign: vi.fn<MipAdminGateway['saveMessageCampaign']>(async () => campaign),
    snapshotMessageCampaign: vi.fn<MipAdminGateway['snapshotMessageCampaign']>(async () => ({
      ...campaign,
      status: 'READY',
      version: 2,
    })),
    publishMessageCampaign: vi.fn<MipAdminGateway['publishMessageCampaign']>(async () => ({
      campaignId: campaign.id,
      status: 'PUBLISHED',
      recipientCount: 1,
      queuedCount: 1,
      wechatDelivery: 'NOT_CONFIGURED',
      version: 2,
      idempotent: false,
    })),
    scheduleMessageCampaign: vi.fn<MipAdminGateway['scheduleMessageCampaign']>(async () => ({
      ...campaign,
      status: 'READY',
      activeDispatch: {
        status: 'SCHEDULED',
        scheduledFor: '2030-09-01T08:00:00.000Z',
        attempts: 0,
        lastOutcome: 'NOT_ATTEMPTED',
        retryDisposition: 'RETRIABLE',
        lastErrorCode: null,
        version: 1,
        updatedAt: '2026-08-25T08:00:00.000Z',
      },
      version: 2,
    })),
    cancelMessageCampaignSchedule: vi.fn<MipAdminGateway['cancelMessageCampaignSchedule']>(async () => ({
      ...campaign,
      status: 'READY',
      activeDispatch: null,
      version: 2,
    })),
    withdrawMessageCampaign: vi.fn<MipAdminGateway['withdrawMessageCampaign']>(async () => ({
      ...campaign,
      status: 'WITHDRAWN',
      version: 2,
    })),
  }
  const gateway = spies as unknown as MipAdminGateway
  return { module: createMipAdminModule(gateway), spies }
}

const announcementDraft: AdminAnnouncementDraft = {
  announcementId: announcement.id,
  expectedVersion: 1,
  scopeType: 'PLATFORM',
  branchId: null,
  title: '活动安排',
  summary: '本周活动安排已更新。',
  body: '请查看最新活动安排。',
  targetType: null,
  targetId: null,
  visibleFrom: '2026-08-25T08:00:00.000Z',
  visibleUntil: null,
}

const campaignDraft: AdminMessageCampaignDraft = {
  campaignId: campaign.id,
  expectedVersion: 1,
  scopeType: 'PLATFORM',
  branchId: null,
  audienceType: 'ALL',
  recipientRefs: [],
  name: '八月活动提醒',
  title: '活动安排已更新',
  body: '请在活动页面查看最新安排。',
}

type QuerySpyName
  = | 'getAnnouncementScopes'
    | 'listAnnouncements'
    | 'getAnnouncement'
    | 'getMessageCampaignScopes'
    | 'listMessageCampaigns'
    | 'getMessageCampaign'
    | 'searchMessageRecipients'

interface MutationCase {
  name: string
  execute: (messaging: MipMessagingAdmin) => Promise<unknown>
  invalidated: QuerySpyName[]
}

const querySpies: QuerySpyName[] = [
  'getAnnouncementScopes',
  'listAnnouncements',
  'getAnnouncement',
  'getMessageCampaignScopes',
  'listMessageCampaigns',
  'getMessageCampaign',
  'searchMessageRecipients',
]

function mutationCases(): MutationCase[] {
  return [
    {
      name: 'saveAnnouncement',
      execute: messaging => messaging.saveAnnouncement(announcementDraft),
      invalidated: ['listAnnouncements', 'getAnnouncement'],
    },
    {
      name: 'publishAnnouncement',
      execute: messaging => messaging.publishAnnouncement(announcement.id, 1),
      invalidated: ['listAnnouncements', 'getAnnouncement'],
    },
    {
      name: 'withdrawAnnouncement',
      execute: messaging => messaging.withdrawAnnouncement(announcement.id, 1, '安排调整'),
      invalidated: ['listAnnouncements', 'getAnnouncement'],
    },
    {
      name: 'setAnnouncementPinned',
      execute: messaging => messaging.setAnnouncementPinned(announcement.id, true, 1),
      invalidated: ['listAnnouncements', 'getAnnouncement'],
    },
    {
      name: 'saveCampaign',
      execute: messaging => messaging.saveCampaign(campaignDraft),
      invalidated: ['listMessageCampaigns', 'getMessageCampaign'],
    },
    {
      name: 'snapshotCampaign',
      execute: messaging => messaging.snapshotCampaign(campaign.id, 1),
      invalidated: ['listMessageCampaigns', 'getMessageCampaign'],
    },
    {
      name: 'publishCampaign',
      execute: messaging => messaging.publishCampaign(campaign.id, 1, 'publish-a'),
      invalidated: ['listMessageCampaigns', 'getMessageCampaign'],
    },
    {
      name: 'scheduleCampaign',
      execute: messaging => messaging.scheduleCampaign({
        campaignId: campaign.id,
        expectedVersion: 1,
        scheduledFor: '2030-09-01T08:00:00.000Z',
        idempotencyKey: 'schedule-a',
      }),
      invalidated: ['listMessageCampaigns', 'getMessageCampaign'],
    },
    {
      name: 'cancelCampaignSchedule',
      execute: messaging => messaging.cancelCampaignSchedule({
        campaignId: campaign.id,
        expectedVersion: 1,
        expectedDispatchVersion: 2,
        reason: '安排调整',
        idempotencyKey: 'cancel-schedule-a',
      }),
      invalidated: ['listMessageCampaigns', 'getMessageCampaign'],
    },
    {
      name: 'withdrawCampaign',
      execute: messaging => messaging.withdrawCampaign(campaign.id, 1, '内容调整'),
      invalidated: ['listMessageCampaigns', 'getMessageCampaign'],
    },
  ]
}

async function warmMessagingQueries(messaging: MipMessagingAdmin) {
  await Promise.all([
    messaging.getAnnouncementScopes(),
    messaging.listAnnouncements({ status: 'DRAFT', query: '活动', limit: 25 }),
    messaging.getAnnouncement(announcement.id),
    messaging.getCampaignScopes(),
    messaging.listCampaigns({ status: 'DRAFT', query: '活动' }),
    messaging.getCampaign(campaign.id),
    messaging.searchRecipients({ branchId: 'branch-a', query: '林' }),
  ])
}

function runtimeCursorInput<T extends object>(input: T, cursor: string): T {
  return { ...input, cursor } as T
}

describe('MIP admin messaging facade', () => {
  it('uses complete filters and runtime cursors in read cache keys', async () => {
    const { module, spies } = createHarness()
    const announcementFilters = {
      status: 'DRAFT' as const,
      scopeType: 'BRANCH' as const,
      branchId: 'branch-a',
      query: '活动',
      limit: 25,
    }
    const campaignFilters = { status: 'DRAFT' as const, query: '活动' }
    const recipientFilters = { branchId: 'branch-a', query: '林' }

    await module.messaging.listAnnouncements(runtimeCursorInput(announcementFilters, 'announcement-a'))
    await module.messaging.listAnnouncements(runtimeCursorInput(announcementFilters, 'announcement-a'))
    await module.messaging.listAnnouncements(runtimeCursorInput(announcementFilters, 'announcement-b'))
    await module.messaging.listCampaigns(runtimeCursorInput(campaignFilters, 'campaign-a'))
    await module.messaging.listCampaigns(runtimeCursorInput(campaignFilters, 'campaign-b'))
    await module.messaging.searchRecipients(runtimeCursorInput(recipientFilters, 'recipient-a'))
    await module.messaging.searchRecipients(runtimeCursorInput(recipientFilters, 'recipient-b'))

    expect(spies.listAnnouncements).toHaveBeenCalledTimes(2)
    expect(spies.listMessageCampaigns).toHaveBeenCalledTimes(2)
    expect(spies.searchMessageRecipients).toHaveBeenCalledTimes(2)
    expect(spies.listAnnouncements.mock.calls[0]?.[0]).toMatchObject({
      ...announcementFilters,
      cursor: 'announcement-a',
    })
  })

  it('keeps legacy query aliases on the same cache', async () => {
    const { module, spies } = createHarness()

    await module.messaging.getAnnouncement(announcement.id)
    await module.messaging.getAnnouncement(announcement.id)
    await module.messaging.listCampaigns({ status: 'DRAFT' })
    await module.messaging.listCampaigns({ status: 'DRAFT' })
    await module.messaging.searchRecipients({ branchId: null, query: '林' })
    await module.messaging.searchRecipients({ branchId: null, query: '林' })

    expect(spies.getAnnouncement).toHaveBeenCalledTimes(1)
    expect(spies.listMessageCampaigns).toHaveBeenCalledTimes(1)
    expect(spies.searchMessageRecipients).toHaveBeenCalledTimes(1)
  })

  it('passes every mutation input to the neutral gateway unchanged', async () => {
    const { module, spies } = createHarness()

    await module.messaging.saveAnnouncement(announcementDraft)
    await module.messaging.publishAnnouncement(announcement.id, 1)
    await module.messaging.withdrawAnnouncement(announcement.id, 1, '安排调整')
    await module.messaging.setAnnouncementPinned(announcement.id, true, 1)
    await module.messaging.saveCampaign(campaignDraft)
    await module.messaging.snapshotCampaign(campaign.id, 1)
    await module.messaging.publishCampaign(campaign.id, 1, 'publish-a')
    await module.messaging.scheduleCampaign({
      campaignId: campaign.id,
      expectedVersion: 1,
      scheduledFor: '2030-09-01T08:00:00.000Z',
      idempotencyKey: 'schedule-a',
    })
    await module.messaging.cancelCampaignSchedule({
      campaignId: campaign.id,
      expectedVersion: 1,
      expectedDispatchVersion: 2,
      reason: '安排调整',
      idempotencyKey: 'cancel-schedule-a',
    })
    await module.messaging.withdrawCampaign(campaign.id, 1, '内容调整')

    expect(spies.saveAnnouncement.mock.calls[0]?.[0]).toBe(announcementDraft)
    expect(spies.publishAnnouncement.mock.calls[0]).toEqual([announcement.id, 1])
    expect(spies.withdrawAnnouncement.mock.calls[0]).toEqual([announcement.id, 1, '安排调整'])
    expect(spies.setAnnouncementPinned.mock.calls[0]).toEqual([announcement.id, true, 1])
    expect(spies.saveMessageCampaign.mock.calls[0]?.[0]).toBe(campaignDraft)
    expect(spies.snapshotMessageCampaign.mock.calls[0]).toEqual([campaign.id, 1])
    expect(spies.publishMessageCampaign.mock.calls[0]).toEqual([campaign.id, 1, 'publish-a'])
    expect(spies.scheduleMessageCampaign.mock.calls[0]?.[0]).toEqual({
      campaignId: campaign.id,
      expectedVersion: 1,
      scheduledFor: '2030-09-01T08:00:00.000Z',
      idempotencyKey: 'schedule-a',
    })
    expect(spies.cancelMessageCampaignSchedule.mock.calls[0]?.[0]).toEqual({
      campaignId: campaign.id,
      expectedVersion: 1,
      expectedDispatchVersion: 2,
      reason: '安排调整',
      idempotencyKey: 'cancel-schedule-a',
    })
    expect(spies.withdrawMessageCampaign.mock.calls[0]).toEqual([campaign.id, 1, '内容调整'])
  })

  for (const mutation of mutationCases()) {
    it(`invalidates only dependent caches after ${mutation.name}`, async () => {
      const { module, spies } = createHarness()
      await warmMessagingQueries(module.messaging)
      await warmMessagingQueries(module.messaging)

      await mutation.execute(module.messaging)
      await warmMessagingQueries(module.messaging)

      for (const query of querySpies) {
        expect(spies[query]).toHaveBeenCalledTimes(mutation.invalidated.includes(query) ? 2 : 1)
      }
    })
  }

  it('keeps cached reads and the original conflict after a failed mutation', async () => {
    const { module, spies } = createHarness()
    const conflict = new MipAdminError('CONFLICT', '公告已被其他管理员更新')
    spies.saveAnnouncement.mockRejectedValueOnce(conflict)
    await warmMessagingQueries(module.messaging)

    await expect(module.messaging.saveAnnouncement(announcementDraft)).rejects.toBe(conflict)
    await warmMessagingQueries(module.messaging)

    for (const query of querySpies) {
      expect(spies[query]).toHaveBeenCalledTimes(1)
    }
  })

  it('passes permission failures through without replacement', async () => {
    const { module, spies } = createHarness()
    const forbidden = new MipAdminError('FORBIDDEN', '当前账号不能发布消息活动')
    spies.publishMessageCampaign.mockRejectedValueOnce(forbidden)

    const error = await module.messaging.publishCampaign(campaign.id, 1, 'publish-a').catch(caught => caught)
    expect(error).toBe(forbidden)
  })
})
