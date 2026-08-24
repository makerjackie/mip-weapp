import type { InboxMessage, InboxMessageId } from '../../../modules/mip-messaging'
import { isTrustedInboxRoute } from '../../../modules/mip-messaging'
import { mipMessagingModule } from '../../../modules/mip-messaging/client'
import { caseNavigateTo } from '../../../modules/platform/case-navigation'

interface MessageView extends InboxMessage {
  createdText: string
}

function dateText(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    return ''
  }
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function messageView(item: InboxMessage): MessageView {
  return { ...item, createdText: dateText(item.createdAt) }
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    items: [] as MessageView[],
    unreadCount: 0,
    nextCursor: '',
    loadingMore: false,
    subscriptionAvailable: false,
    requestingSubscription: false,
    message: '',
  },

  onLoad() {
    const cached = mipMessagingModule.peekInbox()
    if (cached) {
      this.applyPage(cached)
    }
    const capability = mipMessagingModule.subscriptionCapability('EVENT_REMINDER')
    this.setData({ subscriptionAvailable: capability.available })
    void this.loadInbox()
  },

  async onPullDownRefresh() {
    await this.loadInbox(true)
    wx.stopPullDownRefresh()
  },

  async loadInbox(force = false) {
    if (!this.data.items.length) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      this.applyPage(await mipMessagingModule.listInbox(undefined, { force }))
    }
    catch (error) {
      this.setData(this.data.items.length
        ? { message: '消息更新失败，已保留上次结果。' }
        : { state: 'error', message: error instanceof Error ? error.message : '消息加载失败' })
    }
  },

  applyPage(page: { items: InboxMessage[], unreadCount: number, nextCursor?: string }) {
    this.setData({
      state: 'ready',
      items: page.items.map(messageView),
      unreadCount: page.unreadCount,
      nextCursor: page.nextCursor || '',
      message: '',
    })
  },

  async openMessage(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '') as InboxMessageId
    const item = this.data.items.find(message => message.id === id)
    if (!item) {
      return
    }
    if (!item.readAt) {
      try {
        const result = await mipMessagingModule.markRead(id)
        this.setData({
          unreadCount: Math.max(0, this.data.unreadCount - 1),
          items: this.data.items.map(message => message.id === id ? { ...message, readAt: result.readAt } : message),
        })
      }
      catch {
        this.setData({ message: '消息已打开，但未读状态更新失败。' })
      }
    }
    const route = item.target?.route
    if (route && isTrustedInboxRoute(route)) {
      caseNavigateTo({ url: route })
    }
  },

  async loadMore() {
    if (!this.data.nextCursor || this.data.loadingMore) {
      return
    }
    this.setData({ loadingMore: true })
    try {
      const page = await mipMessagingModule.listInbox(this.data.nextCursor)
      this.setData({
        items: [...this.data.items, ...page.items.map(messageView)],
        unreadCount: page.unreadCount,
        nextCursor: page.nextCursor || '',
      })
    }
    catch {
      this.setData({ message: '更多消息加载失败。' })
    }
    finally {
      this.setData({ loadingMore: false })
    }
  },

  async requestEventReminder() {
    if (!this.data.subscriptionAvailable || this.data.requestingSubscription) {
      return
    }
    this.setData({ requestingSubscription: true, message: '' })
    try {
      const result = await mipMessagingModule.requestWechatSubscription('EVENT_REMINDER')
      wx.showToast({
        title: result.grantAvailable ? '微信提醒已授权' : '未授权微信提醒',
        icon: result.grantAvailable ? 'success' : 'none',
      })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '微信提醒授权失败' })
    }
    finally {
      this.setData({ requestingSubscription: false })
    }
  },
})
