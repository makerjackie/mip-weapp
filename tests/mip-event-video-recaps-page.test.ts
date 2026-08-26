import type { EventVideoRecap } from '../src/modules/mip-events'
import { readFileSync } from 'node:fs'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  openWechatChannelsDestination: vi.fn(),
}))

vi.mock('../src/platform/wechat/channels', () => ({
  openWechatChannelsDestination: mocks.openWechatChannelsDestination,
}))
vi.mock('../src/modules/mip-events/client', () => ({
  mipCheckInResumeStore: { peek: vi.fn(), save: vi.fn(), clear: vi.fn() },
  mipEventsModule: {
    peekEvent: vi.fn(),
    getEvent: vi.fn(),
    createInvitation: vi.fn(),
  },
}))
vi.mock('../src/modules/mip-messaging/client', () => ({
  mipMessagingModule: {
    subscriptionCapability: vi.fn(() => ({ available: false })),
    requestWechatSubscription: vi.fn(),
  },
}))
vi.mock('../src/modules/platform/case-navigation', () => ({ caseNavigateTo: vi.fn() }))

interface PageDefinition {
  data: Record<string, unknown>
  openVideoRecap: (event: { currentTarget: { dataset: { id: string } } }) => Promise<void>
}

let definition: PageDefinition

const recap: EventVideoRecap = {
  id: '22222222-2222-4222-8222-222222222222',
  title: '活动回顾',
  summary: '查看活动视频',
  destination: {
    provider: 'WECHAT_CHANNELS',
    type: 'ACTIVITY',
    finderUserName: 'sphMIP2026',
    feedId: 'feed-token-1',
  },
}

function page() {
  return {
    data: {
      ...structuredClone(definition.data),
      event: { videoRecaps: [recap] },
    },
    setData(update: Record<string, unknown>) {
      Object.assign(this.data, update)
    },
  }
}

function tap() {
  return { currentTarget: { dataset: { id: recap.id } } }
}

beforeAll(async () => {
  vi.stubGlobal('Page', (value: PageDefinition) => {
    definition = value
  })
  await import('../src/packages/member/mip-events/detail/index')
})

beforeEach(() => {
  mocks.openWechatChannelsDestination.mockReset()
})

describe('MIP event video recap page', () => {
  it.each([
    ['unsupported', '当前微信版本不支持打开视频号，请升级微信后重试。'],
    ['cancelled', '已取消打开视频回顾。'],
    ['failed', '视频回顾暂时无法打开，请稍后重试。'],
  ] as const)('shows the %s native result without claiming success', async (status, message) => {
    mocks.openWechatChannelsDestination.mockResolvedValue({ status })
    const instance = page()

    await definition.openVideoRecap.call(instance, tap())

    expect(mocks.openWechatChannelsDestination).toHaveBeenCalledWith(recap.destination)
    expect(instance.data.message).toBe(message)
    expect(instance.data.videoRecapBusyId).toBe('')
  })

  it('only clears the busy state after a confirmed native success', async () => {
    mocks.openWechatChannelsDestination.mockResolvedValue({ status: 'opened' })
    const instance = page()

    await definition.openVideoRecap.call(instance, tap())

    expect(instance.data.message).toBe('')
    expect(instance.data.videoRecapBusyId).toBe('')
  })

  it('coalesces rapid taps until the native adapter settles', async () => {
    let resolveOpen!: (value: { status: 'opened' }) => void
    mocks.openWechatChannelsDestination.mockImplementation(() => new Promise((resolve) => {
      resolveOpen = resolve
    }))
    const instance = page()

    const first = definition.openVideoRecap.call(instance, tap())
    const second = definition.openVideoRecap.call(instance, tap())

    expect(mocks.openWechatChannelsDestination).toHaveBeenCalledTimes(1)
    expect(instance.data.videoRecapBusyId).toBe(recap.id)
    resolveOpen({ status: 'opened' })
    await Promise.all([first, second])
    expect(instance.data.videoRecapBusyId).toBe('')
  })

  it('renders catalog tags and recap controls without direct native API calls in the page', () => {
    const view = readFileSync(new URL('../src/packages/member/mip-events/detail/index.wxml', import.meta.url), 'utf8')
    const script = readFileSync(new URL('../src/packages/member/mip-events/detail/index.ts', import.meta.url), 'utf8')
    expect(view).toContain('event.tags')
    expect(view).toContain('event.videoRecaps')
    expect(view).toContain('bind:tap="openVideoRecap"')
    expect(script).toContain('openWechatChannelsDestination(recap.destination)')
    expect(script).not.toContain('wx.openChannelsUserProfile')
    expect(script).not.toContain('wx.openChannelsActivity')
  })
})
