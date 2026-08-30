import type { InboxMessage, InboxMessageId } from '../../../modules/mip-messaging'
import { isTrustedInboxRoute } from '../../../modules/mip-messaging'
import { mipMessagingModule } from '../../../modules/mip-messaging/client'
import { caseNavigateTo } from '../../../modules/platform/case-navigation'

interface MessageView extends InboxMessage {
  createdText: string
}

type SubscriptionTemplateKey = 'EVENT_REMINDER' | 'CHECKIN_RESULT' | 'HEART_RECEIVED'

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
    eventReminderAvailable: false,
    checkInResultAvailable: false,
    heartReceivedAvailable: false,
    requestingSubscription: '' as SubscriptionTemplateKey | '',
    message: '',
  },
  requestSeq: 0,
  openingMessageId: '' as InboxMessageId | '',

  onLoad() {
    const cached = mipMessagingModule.peekInbox()
    if (cached) {
      this.applyPage(cached)
    }
    this.setData({
      eventReminderAvailable: mipMessagingModule.subscriptionCapability('EVENT_REMINDER').available,
      checkInResultAvailable: mipMessagingModule.subscriptionCapability('CHECKIN_RESULT').available,
      heartReceivedAvailable: mipMessagingModule.subscriptionCapability('HEART_RECEIVED').available,
    })
    void this.loadInbox()
  },

  onHide() {
    this.requestSeq += 1
  },

  onUnload() {
    this.requestSeq += 1
  },

  async onPullDownRefresh() {
    await this.loadInbox(true)
    wx.stopPullDownRefresh()
  },

  async loadInbox(force = false) {
    const seq = this.requestSeq + 1
    this.requestSeq = seq
    if (!this.data.items.length) {
      this.setData({ state: 'loading', message: '' })
    }
    this.setData({ loadingMore: false })
    try {
      const page = await mipMessagingModule.listInbox(undefined, { force })
      if (seq !== this.requestSeq) {
        return
      }
      this.applyPage(page)
    }
    catch (error) {
      if (seq !== this.requestSeq) {
        return
      }
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
    if (!item || this.openingMessageId) {
      return
    }
    this.openingMessageId = id
    try {
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
        await caseNavigateTo({ url: route }).catch(() => undefined)
      }
    }
    finally {
      if (this.openingMessageId === id) {
        this.openingMessageId = ''
      }
    }
  },

  async loadMore() {
    if (!this.data.nextCursor || this.data.loadingMore) {
      return
    }
    const seq = this.requestSeq
    const cursor = this.data.nextCursor
    this.setData({ loadingMore: true })
    try {
      const page = await mipMessagingModule.listInbox(cursor)
      if (seq !== this.requestSeq) {
        return
      }
      this.setData({
        items: [...this.data.items, ...page.items.map(messageView)],
        unreadCount: page.unreadCount,
        nextCursor: page.nextCursor || '',
      })
    }
    catch {
      if (seq !== this.requestSeq) {
        return
      }
      this.setData({ message: '更多消息加载失败。' })
    }
    finally {
      if (seq === this.requestSeq) {
        this.setData({ loadingMore: false })
      }
    }
  },

  async requestWechatSubscription(event: WechatMiniprogram.TouchEvent) {
    const templateKey = String(event.currentTarget.dataset.templateKey || '') as SubscriptionTemplateKey
    const available = templateKey === 'EVENT_REMINDER'
      ? this.data.eventReminderAvailable
      : templateKey === 'CHECKIN_RESULT'
        ? this.data.checkInResultAvailable
        : templateKey === 'HEART_RECEIVED' && this.data.heartReceivedAvailable
    if (!available || this.data.requestingSubscription) {
      return
    }
    this.setData({ requestingSubscription: templateKey, message: '' })
    try {
      const result = await mipMessagingModule.requestWechatSubscription(templateKey)
      wx.showToast({
        title: result.grantAvailable ? '微信通知已授权' : '未授权微信通知',
        icon: result.grantAvailable ? 'success' : 'none',
      })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '微信提醒授权失败' })
    }
    finally {
      this.setData({ requestingSubscription: '' })
    }
  },
})
