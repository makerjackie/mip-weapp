import type { MemberNotification } from '../../../modules/membership/types'
import { membershipModule } from '../../../modules/membership/client'
import { caseNavigateTo } from '../../../modules/platform/case-navigation'
import { formatLocalMonthDayTime } from '../../../utils/date'

interface NotificationView extends MemberNotification {
  createdText: string
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    items: [] as NotificationView[],
    message: '',
  },

  onLoad() {
    void this.loadNotifications()
  },

  async loadNotifications(force = false) {
    const cached = membershipModule.peekNotifications()
    if (cached) {
      this.applyItems(cached)
    }
    else if (this.data.state !== 'ready') {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const items = await membershipModule.listNotifications({ force })
      this.applyItems(items)
      if (items.some(item => item.status === 'UNREAD')) {
        await membershipModule.markNotificationsRead({ all: true })
        this.setData({
          items: this.data.items.map(item => ({ ...item, status: 'READ' as const })),
        })
      }
    }
    catch (error) {
      this.setData(this.data.items.length
        ? { message: '消息更新失败，已保留上次结果。' }
        : {
            state: 'error',
            message: error instanceof Error ? error.message : '消息加载失败',
          })
    }
  },

  applyItems(items: MemberNotification[]) {
    this.setData({
      state: 'ready',
      items: items.map(item => ({
        ...item,
        createdText: formatLocalMonthDayTime(item.createdAt),
      })),
      message: '',
    })
  },

  openNotification(event: WechatMiniprogram.BaseEvent) {
    const pagePath = String(event.currentTarget.dataset.pagePath || '')
    if (!pagePath.startsWith('/')) {
      return
    }
    caseNavigateTo({ url: pagePath })
  },

  async onPullDownRefresh() {
    try {
      await this.loadNotifications(true)
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },
})
