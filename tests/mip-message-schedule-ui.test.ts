import type {
  AdminMessageCampaign,
  AdminMessageCampaignDispatch,
} from '../src/modules/mip-admin'
import type { AdminTransport } from '../src/modules/mip-admin/transport'
import { readFileSync } from 'node:fs'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createMipAdminGateway } from '../src/modules/mip-admin/cloudbase-gateway'
import { readActions } from '../src/modules/mip-admin/cloudbase-transport'

vi.mock('../src/modules/platform/cloudbase', () => ({
  requireCloudClient: vi.fn(),
}))

vi.mock('../src/config/runtime', () => ({
  runtimeConfig: { cloudbase: { adminFunctionName: 'mip-admin-api' } },
}))

type PageData = Record<string, unknown>
type PageDefinition = PageData & {
  data: PageData
  setData: (patch: PageData) => void
}

let definition: PageDefinition
let adminApi: typeof import('../src/modules/mip-admin')

const showModal = vi.fn(async () => ({ confirm: true, cancel: false, content: '' }))
const showToast = vi.fn()

function record(value: unknown): value is PageData {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function setPath(target: PageData, path: string, value: unknown) {
  const parts = path.split('.')
  const leaf = parts.pop()
  if (!leaf) {
    return
  }
  let cursor = target
  for (const part of parts) {
    if (!record(cursor[part])) {
      cursor[part] = {}
    }
    cursor = cursor[part] as PageData
  }
  cursor[leaf] = value
}

function createPage(overrides: PageData = {}) {
  const page = Object.create(definition) as PageDefinition
  page.data = { ...structuredClone(definition.data), ...structuredClone(overrides) }
  page.setData = (patch) => {
    for (const [path, value] of Object.entries(patch)) {
      setPath(page.data, path, value)
    }
  }
  return page
}

function callPage(page: PageDefinition, method: string, ...args: unknown[]) {
  const handler = page[method]
  if (typeof handler !== 'function') {
    throw new TypeError(`Missing page method: ${method}`)
  }
  return Reflect.apply(handler, page, args) as unknown
}

function picker(value: string) {
  return { detail: { value } } as unknown as WechatMiniprogram.CustomEvent<{ value: string }>
}

const emptyStageStats = {
  pendingCount: 0,
  processingCount: 0,
  retryingCount: 0,
  deliveredCount: 0,
  terminalCount: 0,
}

function activeDispatch(
  overrides: Partial<AdminMessageCampaignDispatch> = {},
): AdminMessageCampaignDispatch {
  return {
    status: 'SCHEDULED',
    scheduledFor: '2030-09-02T08:00:00.000Z',
    attempts: 0,
    lastOutcome: 'NOT_ATTEMPTED',
    retryDisposition: 'RETRIABLE',
    lastErrorCode: null,
    version: 4,
    updatedAt: '2030-09-01T00:00:00.000Z',
    ...overrides,
  }
}

function campaign(overrides: Partial<AdminMessageCampaign> = {}): AdminMessageCampaign {
  return {
    id: '20000000-0000-4000-8000-000000000001',
    scopeType: 'PLATFORM',
    branchId: null,
    branchName: '',
    audienceType: 'ALL',
    recipientRefs: [],
    name: '九月活动提醒',
    title: '活动安排已更新',
    body: '请在活动页查看最新安排。',
    status: 'READY',
    contentSafetyStatus: 'PASSED',
    recipientCount: 12,
    deliveryStats: {
      submittedCount: 0,
      inboxReadyCount: 0,
      failedCount: 0,
      outboxStats: emptyStageStats,
      externalTaskStats: emptyStageStats,
    },
    snapshotAt: '2030-09-01T00:00:00.000Z',
    publishedAt: null,
    withdrawnAt: null,
    activeDispatch: null,
    version: 3,
    updatedAt: '2030-09-01T00:00:00.000Z',
    ...overrides,
  }
}

function localPickerParts(value: Date) {
  const pad = (part: number) => String(part).padStart(2, '0')
  return {
    date: `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`,
    time: `${pad(value.getHours())}:${pad(value.getMinutes())}`,
  }
}

beforeAll(async () => {
  vi.stubGlobal('wx', {
    getStorageSync: vi.fn(),
    setStorageSync: vi.fn(),
    removeStorageSync: vi.fn(),
    showModal,
    showToast,
    stopPullDownRefresh: vi.fn(),
  })
  vi.stubGlobal('Page', (input: PageDefinition) => {
    definition = input
  })
  adminApi = await import('../src/modules/mip-admin')
  await import('../src/packages/admin/message-campaigns/index')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  showModal.mockReset()
  showModal.mockResolvedValue({ confirm: true, cancel: false, content: '' })
  showToast.mockClear()
})

describe('MIP message campaign schedule contract and UI', () => {
  it('uses neutral schedule actions and keeps idempotency keys in the request envelope', async () => {
    const requests: Array<Record<string, unknown>> = []
    const scheduled = campaign({ activeDispatch: activeDispatch() })
    const transport: AdminTransport = {
      async request(request) {
        requests.push(structuredClone(request) as unknown as Record<string, unknown>)
        return request.action.endsWith('.cancelSchedule')
          ? campaign({ version: 4 }) as never
          : scheduled as never
      },
    }
    const gateway = createMipAdminGateway(transport)

    await gateway.scheduleMessageCampaign({
      campaignId: scheduled.id,
      expectedVersion: 3,
      scheduledFor: '2030-09-02T08:00:00.000Z',
      idempotencyKey: 'schedule-a',
      expectedDispatchVersion: 4,
    })
    await gateway.cancelMessageCampaignSchedule({
      campaignId: scheduled.id,
      expectedVersion: 3,
      expectedDispatchVersion: 4,
      reason: '活动时间调整',
      idempotencyKey: 'cancel-a',
    })

    expect(requests).toEqual([
      {
        contractVersion: 1,
        action: 'mip.admin.messageCampaigns.schedule',
        input: {
          campaignId: scheduled.id,
          expectedVersion: 3,
          scheduledFor: '2030-09-02T08:00:00.000Z',
          expectedDispatchVersion: 4,
        },
        idempotencyKey: 'schedule-a',
      },
      {
        contractVersion: 1,
        action: 'mip.admin.messageCampaigns.cancelSchedule',
        input: {
          campaignId: scheduled.id,
          expectedVersion: 3,
          expectedDispatchVersion: 4,
          reason: '活动时间调整',
        },
        idempotencyKey: 'cancel-a',
      },
    ])
    expect(readActions.has('mip.admin.messageCampaigns.schedule')).toBe(false)
    expect(readActions.has('mip.admin.messageCampaigns.cancelSchedule')).toBe(false)
  })

  it('combines local date and time into UTC and reloads both detail and list after scheduling', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2030, 8, 1, 23, 50, 0, 0))
    const item = campaign()
    const future = new Date(Date.now() + 15 * 60 * 1000)
    future.setSeconds(0, 0)
    const input = localPickerParts(future)
    const updated = campaign({
      version: 4,
      activeDispatch: activeDispatch({ scheduledFor: future.toISOString(), version: 1 }),
    })
    const scheduleCampaign = vi.spyOn(adminApi.mipAdminModule.messaging, 'scheduleCampaign')
      .mockResolvedValue(updated)
    const getCampaign = vi.spyOn(adminApi.mipAdminModule.messaging, 'getCampaign')
      .mockResolvedValue(updated)
    const listCampaigns = vi.spyOn(adminApi.mipAdminModule.messaging, 'listCampaigns')
      .mockResolvedValue({ items: [updated], nextCursor: null })
    const page = createPage({
      campaignId: item.id,
      campaignStatus: 'READY',
      version: item.version,
      recipientCount: item.recipientCount,
      activeDispatch: null,
      canScheduleCampaign: true,
      processing: '',
      statusFilter: '',
      scheduleDate: input.date,
      scheduleTime: input.time,
    })

    await callPage(page, 'scheduleCampaign')

    expect(scheduleCampaign).toHaveBeenCalledWith(expect.objectContaining({
      campaignId: item.id,
      expectedVersion: item.version,
      scheduledFor: future.toISOString(),
      idempotencyKey: expect.stringMatching(/^message-campaign-schedule-/),
    }))
    expect(scheduleCampaign.mock.calls[0]?.[0]).not.toHaveProperty('expectedDispatchVersion')
    expect(getCampaign).toHaveBeenCalledWith(item.id, true)
    expect(listCampaigns).toHaveBeenCalledWith({ status: '' }, true)
    expect(page.data.activeDispatch).toMatchObject({ status: 'SCHEDULED', version: 1 })
    expect(showToast).toHaveBeenCalledWith({ title: '发送计划已设置', icon: 'success' })
  })

  it('keeps the picker and client guard at least five minutes ahead without replacing server authority', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2030, 8, 1, 23, 50, 0, 0))
    const tooSoon = new Date(Date.now() + 4 * 60 * 1000)
    const input = localPickerParts(tooSoon)
    const scheduleCampaign = vi.spyOn(adminApi.mipAdminModule.messaging, 'scheduleCampaign')
    const page = createPage({
      campaignId: campaign().id,
      campaignStatus: 'READY',
      version: 3,
      recipientCount: 12,
      canScheduleCampaign: true,
      processing: '',
      scheduleDate: input.date,
      scheduleTime: input.time,
    })

    await callPage(page, 'scheduleCampaign')

    expect(scheduleCampaign).not.toHaveBeenCalled()
    expect(showModal).not.toHaveBeenCalled()
    expect(page.data.message).toBe('发送时间需至少晚于当前时间 5 分钟。')
    const markup = readFileSync('src/packages/admin/message-campaigns/index.wxml', 'utf8')
    expect(markup).toContain('start="{{scheduleMinDate}}"')
    expect(markup).toContain('start="{{scheduleTimeStart}}"')
  })

  it('gives default and automatically corrected times a one-minute scheduling buffer', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2030, 8, 1, 23, 50, 0, 0))
    const page = createPage()

    callPage(page, 'applyCampaign', campaign())

    const selected = new Date(`${String(page.data.scheduleDate)}T${String(page.data.scheduleTime)}:00`)
    expect(selected.getTime()).toBeGreaterThanOrEqual(Date.now() + 6 * 60 * 1000)
    expect(page.data.scheduleMinDate).toBe('2030-09-01')
  })

  it('preserves an existing valid plan inside the default scheduling buffer', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2030, 8, 1, 23, 50, 30, 0))
    const scheduled = new Date(2030, 8, 1, 23, 56, 0, 0)
    const page = createPage()

    callPage(page, 'applyCampaign', campaign({
      activeDispatch: activeDispatch({ scheduledFor: scheduled.toISOString() }),
    }))

    expect(page.data.scheduleDate).toBe('2030-09-01')
    expect(page.data.scheduleTime).toBe('23:56')
  })

  it('uses dispatch version when modifying a scheduled or retryable known-failure plan', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2030-09-01T00:00:00.000Z'))
    const originalDispatch = activeDispatch({
      status: 'FAILED',
      lastOutcome: 'KNOWN_FAILED',
      retryDisposition: 'RETRIABLE',
      attempts: 1,
      version: 7,
    })
    const item = campaign({ activeDispatch: originalDispatch })
    const future = new Date(Date.now() + 20 * 60 * 1000)
    future.setSeconds(0, 0)
    const updated = campaign({
      version: 4,
      activeDispatch: activeDispatch({ scheduledFor: future.toISOString(), version: 8 }),
    })
    const scheduleCampaign = vi.spyOn(adminApi.mipAdminModule.messaging, 'scheduleCampaign')
      .mockResolvedValue(updated)
    vi.spyOn(adminApi.mipAdminModule.messaging, 'getCampaign').mockResolvedValue(updated)
    vi.spyOn(adminApi.mipAdminModule.messaging, 'listCampaigns')
      .mockResolvedValue({ items: [updated], nextCursor: null })
    const page = createPage({ statusFilter: '' })
    callPage(page, 'applyCampaign', item)
    const input = localPickerParts(future)
    callPage(page, 'changeScheduleDate', picker(input.date))
    callPage(page, 'changeScheduleTime', picker(input.time))

    await callPage(page, 'scheduleCampaign')

    expect(page.data.canScheduleCampaign).toBe(true)
    expect(scheduleCampaign).toHaveBeenCalledWith(expect.objectContaining({
      expectedVersion: item.version,
      expectedDispatchVersion: originalDispatch.version,
      scheduledFor: future.toISOString(),
    }))
    expect(showToast).toHaveBeenCalledWith({ title: '发送计划已修改', icon: 'success' })
  })

  it('requires a cancellation reason and sends a separate cancellation idempotency key', async () => {
    const dispatch = activeDispatch({ version: 9 })
    const item = campaign({ activeDispatch: dispatch, version: 5 })
    const cancelled = campaign({ activeDispatch: null, version: 6 })
    const cancelSchedule = vi.spyOn(adminApi.mipAdminModule.messaging, 'cancelCampaignSchedule')
      .mockResolvedValue(cancelled)
    vi.spyOn(adminApi.mipAdminModule.messaging, 'getCampaign').mockResolvedValue(cancelled)
    vi.spyOn(adminApi.mipAdminModule.messaging, 'listCampaigns')
      .mockResolvedValue({ items: [cancelled], nextCursor: null })
    const page = createPage({ statusFilter: '' })
    callPage(page, 'applyCampaign', item)

    showModal.mockResolvedValueOnce({ confirm: true, cancel: false, content: '  ' })
    await callPage(page, 'cancelCampaignSchedule')
    expect(cancelSchedule).not.toHaveBeenCalled()
    expect(page.data.message).toBe('请填写取消原因。')

    showModal.mockResolvedValueOnce({ confirm: true, cancel: false, content: '  活动时间调整  ' })
    await callPage(page, 'cancelCampaignSchedule')

    expect(cancelSchedule).toHaveBeenCalledWith({
      campaignId: item.id,
      expectedVersion: item.version,
      expectedDispatchVersion: dispatch.version,
      reason: '活动时间调整',
      idempotencyKey: expect.stringMatching(/^message-campaign-cancel-schedule-/),
    })
    expect(page.data.activeDispatch).toBeNull()
    expect(showToast).toHaveBeenCalledWith({ title: '发送计划已取消', icon: 'success' })
  })

  it('blocks immediate publishing while a plan exists and isolates uncertain outcomes for manual review', async () => {
    const publishCampaign = vi.spyOn(adminApi.mipAdminModule.messaging, 'publishCampaign')
    const page = createPage()
    callPage(page, 'applyCampaign', campaign({
      activeDispatch: activeDispatch({
        status: 'FAILED',
        lastOutcome: 'UNKNOWN',
        retryDisposition: 'MANUAL_REVIEW',
      }),
    }))

    await callPage(page, 'publishCampaign')

    expect(publishCampaign).not.toHaveBeenCalled()
    expect(showModal).toHaveBeenCalledWith(expect.objectContaining({
      title: '需要人工核对',
      content: '发送结果待人工核对，核对完成前不能立即发布。',
      showCancel: false,
    }))
    expect(page.data.canScheduleCampaign).toBe(false)
    expect(page.data.activeDispatch).toMatchObject({
      needsManualReview: true,
      noteText: '需要人工核对',
      canCancel: false,
    })

    callPage(page, 'applyCampaign', campaign({ activeDispatch: activeDispatch() }))
    await callPage(page, 'publishCampaign')
    expect(showModal).toHaveBeenLastCalledWith(expect.objectContaining({
      title: '先取消发送计划',
      content: expect.stringContaining('请先取消计划'),
    }))

    callPage(page, 'applyCampaign', campaign({
      activeDispatch: activeDispatch({ status: 'PROCESSING' }),
    }))
    expect(page.data.activeDispatch).toMatchObject({ canModify: false, canCancel: false })

    const markup = readFileSync('src/packages/admin/message-campaigns/index.wxml', 'utf8')
    expect(markup).toContain('需要人工核对')
    expect(markup).toContain('mip-admin-card-list mt-3 flex max-h-[520rpx]')
    expect(markup).not.toContain('重试发送')
    expect(markup).not.toContain('bind:tap="retrySchedule"')
  })
})
