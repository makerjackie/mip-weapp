import type { InboxMessage, InboxMessageId, InboxMessageType } from '../../../modules/mip-messaging'
import { isTrustedInboxRoute } from '../../../modules/mip-messaging'
import { mipMessagingModule } from '../../../modules/mip-messaging/client'
import { caseNavigateTo } from '../../../platform/navigation/client'

// journey-review J3-04b（QI 自拟承接稿，2026-09-21 终审）：站内信三类消息行。
// 心动通知 = PROFILE_INTEREST；活动提醒 = EVENT；其余类型（含无类型老数据）归入系统通知。
interface InboxRowType {
  key: 'HEART' | 'EVENT' | 'SYSTEM'
  label: string
  iconName: string
  iconColor: string
}

const inboxRowTypes: Record<string, InboxRowType> = {
  PROFILE_INTEREST: { key: 'HEART', label: '心动通知', iconName: 'heart-filled', iconColor: 'var(--color-danger)' },
  EVENT: { key: 'EVENT', label: '活动提醒', iconName: 'calendar', iconColor: 'var(--color-brand)' },
  SYSTEM: { key: 'SYSTEM', label: '系统通知', iconName: 'notification', iconColor: 'var(--color-muted)' },
}

function rowTypeOf(messageType: string): InboxRowType {
  return inboxRowTypes[messageType as InboxMessageType] || inboxRowTypes.SYSTEM
}

// 相对时间（自拟承接稿：刚刚 / N分钟前 / N小时前 / 昨天 / N天前 / 超过 7 天回退月日）。
function relativeTimeText(value: string, now = new Date()) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  const diffMs = now.getTime() - date.getTime()
  if (diffMs < 0) {
    return '刚刚'
  }
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) {
    return '刚刚'
  }
  if (minutes < 60) {
    return `${minutes}分钟前`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24 && date.getDate() === now.getDate()) {
    return `${hours}小时前`
  }
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const days = Math.floor((startOfToday - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) / 86400000)
  if (days === 1) {
    return '昨天'
  }
  if (days > 1 && days <= 7) {
    return `${days}天前`
  }
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

interface MessageView extends InboxMessage {
  createdText: string
  rowType: InboxRowType
}

function messageView(item: InboxMessage): MessageView {
  return {
    ...item,
    target: item.target && isTrustedInboxRoute(item.target.route) ? item.target : undefined,
    createdText: relativeTimeText(item.createdAt),
    rowType: rowTypeOf(item.messageType),
  }
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    items: [] as MessageView[],
    unreadCount: 0,
    nextCursor: '',
    loadingMore: false,
    refreshing: false,
    markingAllRead: false,
    message: '',
  },
  requestSeq: 0,
  openingMessageId: '' as InboxMessageId | '',

  onLoad() {
    const cached = mipMessagingModule.peekInbox()
    if (cached) {
      this.applyPage(cached)
    }
  },

  onShow() {
    void this.enterInbox()
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

  // 进入页面即视为已读（QI 拍板）：加载成功后清除全部未读，行内红点随 setData 消失；
  // 清除失败不打断浏览，保留红点，onShow 再次进入会重试。
  async enterInbox() {
    await this.loadInbox(true)
    if (this.data.unreadCount > 0 && !this.data.markingAllRead) {
      await this.markAllRead()
    }
  },

  async loadInbox(force = false) {
    if (this.data.markingAllRead || this.openingMessageId) {
      return
    }
    const seq = this.requestSeq + 1
    this.requestSeq = seq
    if (!this.data.items.length) {
      this.setData({ state: 'loading', message: '' })
    }
    this.setData({ loadingMore: false, refreshing: true })
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
    finally {
      if (seq === this.requestSeq) {
        this.setData({ refreshing: false })
      }
    }
  },

  onReachBottom() {
    void this.loadMore()
  },

  async markAllRead() {
    if (this.data.markingAllRead || this.data.refreshing || this.data.loadingMore || this.openingMessageId || !this.data.unreadCount) {
      return
    }
    this.requestSeq += 1
    this.setData({ markingAllRead: true, message: '' })
    try {
      const result = await mipMessagingModule.markAllRead()
      this.setData({
        unreadCount: 0,
        items: this.data.items.map(item => ({ ...item, readAt: item.readAt || result.readAt })),
      })
    }
    catch {
      this.setData({ message: '未读状态更新失败，请重试。' })
    }
    finally {
      this.setData({ markingAllRead: false })
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
    if (!item || this.openingMessageId || this.data.markingAllRead || this.data.refreshing || this.data.loadingMore) {
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
    if (!this.data.nextCursor || this.data.loadingMore || this.data.refreshing || this.data.markingAllRead || this.openingMessageId) {
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

})
