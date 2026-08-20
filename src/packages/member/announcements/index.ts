import type { AnnouncementSummary } from '../../../modules/membership/types'
import { membershipModule } from '../../../modules/membership/client'
import { caseNavigateTo } from '../../../modules/platform/case-navigation'
import { formatLocalMonthDayTime } from '../../../utils/date'

interface AnnouncementView extends AnnouncementSummary {
  publishedText: string
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    items: [] as AnnouncementView[],
    message: '',
  },

  onLoad() {
    void this.loadAnnouncements()
  },

  async loadAnnouncements(force = false) {
    const cached = membershipModule.peekAnnouncements()
    if (cached) {
      this.applyItems(cached)
    }
    else if (this.data.state !== 'ready') {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      this.applyItems(await membershipModule.listAnnouncements({ force }))
    }
    catch (error) {
      this.setData(this.data.items.length
        ? { message: '公告更新失败，已保留上次结果。' }
        : { state: 'error', message: error instanceof Error ? error.message : '公告加载失败' })
    }
  },

  applyItems(items: AnnouncementSummary[]) {
    this.setData({
      state: 'ready',
      items: items.map(item => ({
        ...item,
        publishedText: item.publishedAt ? formatLocalMonthDayTime(item.publishedAt) : '',
      })),
      message: '',
    })
  },

  openItem(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    if (id) {
      caseNavigateTo({
        url: `/packages/member/announcement-detail/index?announcementId=${encodeURIComponent(id)}`,
      })
    }
  },

  async onPullDownRefresh() {
    try {
      await this.loadAnnouncements(true)
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },
})
