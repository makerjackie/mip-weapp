import type { MipMessagingGateway, WechatSubscriptionRequester } from '../src/modules/mip-messaging/types'
import { beforeAll, expect, it, vi } from 'vitest'
import { createMipMessagingModule } from '../src/modules/mip-messaging/module'

const harness = vi.hoisted(() => ({ module: undefined as ReturnType<typeof createMipMessagingModule> | undefined }))
vi.mock('../src/modules/mip-messaging/client', () => ({
  get mipMessagingModule() { return harness.module },
}))
vi.mock('@weapp/shared/haptics', () => ({ selectionHaptic: vi.fn() }))
let definition: any
beforeAll(async () => {
  vi.stubGlobal('Component', (value: unknown) => {
    definition = value
  })
  vi.stubGlobal('getCurrentPages', () => [{ route: 'pages/profile/index' }])
  await import('../src/custom-tab-bar/index')
})
function setup() {
  let page: Awaited<ReturnType<MipMessagingGateway['listInbox']>> = {
    items: [{ id: 'message-1' as never, recipientUserId: 'user-1' as never, messageType: 'EVENT', title: '测试提醒', body: '测试', createdAt: '2026-10-27T00:00:00Z' }],
    unreadCount: 1,
  }
  const gateway = {
    listInbox: vi.fn(async () => page),
    markAllRead: vi.fn(async () => {
      page = { ...page, unreadCount: 0 }
      return { readAt: '2026-10-27T01:00:00Z' }
    }),
    markRead: vi.fn(),
    recordSubscriptionDecision: vi.fn(),
    recordCustomerServiceInteraction: vi.fn(),
  } satisfies MipMessagingGateway
  const requester = { capability: vi.fn(), request: vi.fn() } satisfies WechatSubscriptionRequester
  harness.module = createMipMessagingModule(gateway, requester)
  const mount = () => {
    const bar = Object.create(definition.methods)
    bar.data = structuredClone(definition.data)
    bar.setData = (patch: unknown) => Object.assign(bar.data, patch)
    definition.lifetimes.attached.call(bar)
    return bar
  }
  return { module: harness.module, gateway, mount }
}
it('clears all mounted tab badges after reading without requiring another page show event', async () => {
  const { module, mount } = setup()
  const profileTab = mount()
  const hiddenTab = mount()
  await vi.waitFor(() => expect(profileTab.data.unreadCount).toBe(1))
  expect(hiddenTab.data.unreadCount).toBe(1)
  await module.markAllRead()
  expect(profileTab.data.unreadCount).toBe(0)
  expect(hiddenTab.data.unreadCount).toBe(0)
  definition.lifetimes.detached.call(profileTab)
  const detachedUpdate = vi.spyOn(profileTab, 'setData')
  module.invalidate()
  expect(detachedUpdate).not.toHaveBeenCalled()
  definition.lifetimes.detached.call(hiddenTab)
})
it('keeps unread badges after a failed read and rejects stale unread results after a successful read', async () => {
  const { module, gateway, mount } = setup()
  const tab = mount()
  await vi.waitFor(() => expect(tab.data.unreadCount).toBe(1))
  gateway.markAllRead.mockRejectedValueOnce(new Error('network'))
  await expect(module.markAllRead()).rejects.toThrow('network')
  expect(tab.data.unreadCount).toBe(1)
  let resolveOld: (page: Awaited<ReturnType<MipMessagingGateway['listInbox']>>) => void = () => {}
  gateway.listInbox.mockImplementationOnce(() => new Promise((resolve) => {
    resolveOld = resolve
  }))
  const stale = module.refreshUnreadCount({ force: true })
  await module.markAllRead()
  resolveOld({ items: [], unreadCount: 1 })
  await expect(stale).resolves.toBe(0)
  expect(tab.data.unreadCount).toBe(0)
  definition.lifetimes.detached.call(tab)
})
