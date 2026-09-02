import type { AnnouncementSummary } from '../../../modules/mip-announcements'
import { mipAnnouncementsModule } from '../../../modules/mip-announcements'
import { caseNavigateTo } from '../../../platform/navigation/client'
import { formatLocalMonthDayTime } from '../../../utils/date'

interface AnnouncementView extends AnnouncementSummary {
  publishedText: string
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    items: [] as AnnouncementView[],
    branchId: '',
    nextCursor: '',
    loadingMore: false,
    message: '',
  },

  onLoad(query: Record<string, string>) {
    this.setData({ branchId: query.branchId || '' })
    void this.loadAnnouncements()
  },

  async loadAnnouncements(force = false) {
    const input = { branchId: this.data.branchId || undefined, limit: 20 }
    const cached = mipAnnouncementsModule.peekList(input)
    if (cached) {
      this.applyPage(cached)
    }
    else if (this.data.state !== 'ready') {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      this.applyPage(await mipAnnouncementsModule.list(input, force))
    }
    catch (error) {
      this.setData(this.data.items.length
        ? { message: '公告更新失败，已保留上次结果。' }
        : { state: 'error', message: error instanceof Error ? error.message : '公告加载失败' })
    }
  },

  applyPage(page: { items: AnnouncementSummary[], nextCursor?: string }) {
    this.setData({
      state: 'ready',
      items: page.items.map(item => ({
        ...item,
        publishedText: item.publishedAt ? formatLocalMonthDayTime(item.publishedAt) : '',
      })),
      nextCursor: page.nextCursor || '',
      message: '',
    })
  },

  async loadMore() {
    if (!this.data.nextCursor || this.data.loadingMore) {
      return
    }
    this.setData({ loadingMore: true })
    try {
      const page = await mipAnnouncementsModule.list({
        branchId: this.data.branchId || undefined,
        cursor: this.data.nextCursor,
        limit: 20,
      }, true)
      this.setData({
        items: [...this.data.items, ...page.items.map(item => ({
          ...item,
          publishedText: formatLocalMonthDayTime(item.publishedAt),
        }))],
        nextCursor: page.nextCursor || '',
        message: '',
      })
    }
    catch {
      this.setData({ message: '更多公告加载失败，请稍后重试。' })
    }
    finally {
      this.setData({ loadingMore: false })
    }
  },

  onReachBottom() {
    void this.loadMore()
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
