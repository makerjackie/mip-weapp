import type { InboxMessagePage } from '../src/modules/mip-messaging/types'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  createPopupForegroundCoordinator,
  createPopupMessagePresenter,
} from '../src/modules/mip-messaging/popup'

function inbox(items: InboxMessagePage['items']): InboxMessagePage {
  return { items, unreadCount: items.filter(item => !item.readAt).length }
}

function popupMessage() {
  return {
    id: 'message-1',
    recipientUserId: 'user-1',
    messageType: 'GROWTH_LEVEL_UP' as const,
    title: '等级已提升',
    body: '当前等级为二级。',
    target: { type: 'GROWTH', id: 'growth', route: '/packages/member/mip-growth/index' },
    createdAt: new Date().toISOString(),
  }
}

describe('MIP popup messages', () => {
  it('waits for the cold-start snapshot and checks only the current foreground cycle', async () => {
    let resolveFirst: ((value: {
      authenticated: boolean
      agreements: Array<{ accepted: boolean }>
    }) => void) | undefined
    const firstSnapshot = new Promise<{
      authenticated: boolean
      agreements: Array<{ accepted: boolean }>
    }>((resolve) => { resolveFirst = resolve })
    const showNext = vi.fn(async () => true)
    const loadSnapshot = vi.fn()
      .mockReturnValueOnce(firstSnapshot)
      .mockResolvedValueOnce({ authenticated: true, agreements: [{ accepted: true }] })
    const coordinator = createPopupForegroundCoordinator({ loadSnapshot }, { showNext })

    const firstShow = coordinator.onShow()
    expect(showNext).not.toHaveBeenCalled()
    coordinator.onHide()
    resolveFirst?.({ authenticated: true, agreements: [{ accepted: true }] })
    await firstShow
    expect(showNext).not.toHaveBeenCalled()

    await coordinator.onShow()
    expect(showNext).toHaveBeenCalledOnce()
    expect(loadSnapshot).toHaveBeenCalledTimes(2)
  })

  it('wires snapshot-driven popup checks to both app foreground lifecycle edges', () => {
    const app = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8')
    expect(app).toContain('void popupForeground.onShow()')
    expect(app).toContain('popupForeground.onHide()')
    expect(app).toContain('registerMipLocalUserCache(() => popupForeground.invalidate())')
    expect(app).not.toContain('setTimeout')
  })

  it('does not open a private popup when logout invalidates an in-flight inbox request', async () => {
    let resolveInbox!: (page: InboxMessagePage) => void
    const showModal = vi.fn()
    const presenter = createPopupMessagePresenter({
      listInbox: vi.fn(() => new Promise<InboxMessagePage>((resolve) => {
        resolveInbox = resolve
      })),
    } as never, { read: () => [], write: vi.fn() }, {
      showModal: showModal as never,
      navigateTo: vi.fn(),
    })

    const pending = presenter.showNext()
    presenter.invalidate()
    resolveInbox(inbox([popupMessage()]))

    await expect(pending).resolves.toBe(false)
    expect(showModal).not.toHaveBeenCalled()
  })

  it('does not persist, mark or navigate when logout occurs while the modal is open', async () => {
    let resolveModal!: (result: { confirm: boolean, cancel: boolean }) => void
    const storageWrite = vi.fn()
    const markRead = vi.fn()
    const navigateTo = vi.fn()
    const showModal = vi.fn(() => new Promise((resolve) => {
      resolveModal = resolve
    }))
    const presenter = createPopupMessagePresenter({
      listInbox: vi.fn(async () => inbox([popupMessage()])),
      markRead,
    } as never, { read: () => [], write: storageWrite }, {
      showModal: showModal as never,
      navigateTo,
    })

    const pending = presenter.showNext()
    await vi.waitFor(() => expect(showModal).toHaveBeenCalledOnce())
    presenter.invalidate()
    resolveModal({ confirm: true, cancel: false })

    await expect(pending).resolves.toBe(false)
    expect(storageWrite).not.toHaveBeenCalled()
    expect(markRead).not.toHaveBeenCalled()
    expect(navigateTo).not.toHaveBeenCalled()
  })

  it('does not navigate or restore presentation state when logout occurs during mark-read', async () => {
    let resolveMarkRead!: (value: { messageId: string, readAt: string }) => void
    let stored: string[] = []
    const navigateTo = vi.fn()
    const markRead = vi.fn(() => new Promise((resolve) => {
      resolveMarkRead = resolve
    }))
    const presenter = createPopupMessagePresenter({
      listInbox: vi.fn(async () => inbox([popupMessage()])),
      markRead,
    } as never, {
      read: () => stored,
      write: (value) => { stored = value },
    }, {
      showModal: vi.fn(async () => ({ confirm: true, cancel: false })) as never,
      navigateTo,
    })

    const pending = presenter.showNext()
    await vi.waitFor(() => expect(markRead).toHaveBeenCalledOnce())
    presenter.invalidate()
    stored = []
    resolveMarkRead({ messageId: 'message-1', readAt: new Date().toISOString() })

    await expect(pending).resolves.toBe(false)
    expect(stored).toEqual([])
    expect(navigateTo).not.toHaveBeenCalled()
  })

  it('does not start a presenter after logout invalidates an in-flight identity snapshot', async () => {
    let resolveSnapshot!: (value: {
      authenticated: boolean
      agreements: Array<{ accepted: boolean }>
    }) => void
    const showNext = vi.fn()
    const coordinator = createPopupForegroundCoordinator({
      loadSnapshot: vi.fn(() => new Promise((resolve) => {
        resolveSnapshot = resolve
      })),
    }, { showNext })

    const pending = coordinator.onShow()
    coordinator.invalidate()
    resolveSnapshot({ authenticated: true, agreements: [{ accepted: true }] })

    await expect(pending).resolves.toBeUndefined()
    expect(showNext).not.toHaveBeenCalled()
  })

  it('presents one unread level-up message once and opens only its trusted target', async () => {
    let stored: string[] = []
    const markRead = vi.fn(async () => ({ messageId: 'message-1', readAt: new Date().toISOString() }))
    const navigateTo = vi.fn()
    const presenter = createPopupMessagePresenter({
      listInbox: vi.fn(async () => inbox([{
        ...popupMessage(),
      }])) as never,
      markRead,
    } as never, {
      read: () => stored,
      write: (value) => { stored = value },
    }, {
      showModal: vi.fn(async () => ({ confirm: true, cancel: false })) as never,
      navigateTo,
    })

    await expect(presenter.showNext()).resolves.toBe(true)
    await expect(presenter.showNext()).resolves.toBe(false)
    expect(stored).toEqual(['message-1'])
    expect(markRead).toHaveBeenCalledWith('message-1')
    expect(navigateTo).toHaveBeenCalledWith('/packages/member/mip-growth/index')
  })

  it('does not show an ordinary experience change as an upgrade popup', async () => {
    const showModal = vi.fn()
    const presenter = createPopupMessagePresenter({
      listInbox: vi.fn(async () => inbox([{
        id: 'message-growth',
        recipientUserId: 'user-1',
        messageType: 'GROWTH',
        title: '经验值已更新',
        body: '本次增加 10，当前余额 90。',
        target: { type: 'GROWTH', id: 'growth', route: '/packages/member/mip-growth/index' },
        createdAt: new Date().toISOString(),
      }])) as never,
    } as never, { read: () => [], write: vi.fn() }, {
      showModal: showModal as never,
      navigateTo: vi.fn(),
    })

    await expect(presenter.showNext()).resolves.toBe(false)
    expect(showModal).not.toHaveBeenCalled()
  })

  it('ignores ordinary inbox messages and never opens an untrusted route', async () => {
    const navigateTo = vi.fn()
    const presenter = createPopupMessagePresenter({
      listInbox: vi.fn(async () => inbox([{
        id: 'message-2',
        recipientUserId: 'user-1',
        messageType: 'EVENT',
        title: '活动提醒',
        body: '活动信息已更新。',
        target: { type: 'EVENT', id: 'event-1', route: '/pages/profile/index' },
        createdAt: new Date().toISOString(),
      }])) as never,
    } as never, { read: () => [], write: vi.fn() }, {
      showModal: vi.fn() as never,
      navigateTo,
    })

    await expect(presenter.showNext()).resolves.toBe(false)
    expect(navigateTo).not.toHaveBeenCalled()
  })

  it('keeps a target message eligible when the user chooses to view it later', async () => {
    let stored: string[] = []
    const markRead = vi.fn()
    const presenter = createPopupMessagePresenter({
      listInbox: vi.fn(async () => inbox([{
        id: 'message-3',
        recipientUserId: 'user-1',
        messageType: 'OPERATIONS',
        title: '系统消息',
        body: '当前有一条待查看消息。',
        target: { type: 'GAME', id: 'game', route: '/packages/member/mip-game/index' },
        createdAt: new Date().toISOString(),
      }])) as never,
      markRead,
    } as never, {
      read: () => stored,
      write: (value) => { stored = value },
    }, {
      showModal: vi.fn(async () => ({ confirm: false, cancel: true })) as never,
      navigateTo: vi.fn(),
    })

    await expect(presenter.showNext()).resolves.toBe(true)
    expect(stored).toEqual([])
    expect(markRead).not.toHaveBeenCalled()
  })
})
