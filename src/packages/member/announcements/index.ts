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
    refreshing: false,
    message: '',
  },
  // BUG-10.1（审计 2026-10-12）：整表加载代际号。loadMore 在途时下拉刷新会整表重置，
  // 旧游标结果若直接追加会把已刷新的首页再拼一遍（wx:key="id" 重复）。
  // 参照 orders/index.ts 的 requestSeq 模式：每次整表加载代际 +1，追加请求
  // 绑定发起时的代际，返回后代际已变即丢弃；refreshing 再挡住「刷新在途时用旧
  // 游标发起新追加」的窗口，去重做最后兜底。
  requestSeq: 0,

  onLoad(query: Record<string, string>) {
    this.setData({ branchId: query.branchId || '' })
    void this.loadAnnouncements()
  },

  async loadAnnouncements(force = false) {
    const requestSeq = ++this.requestSeq
    const input = { branchId: this.data.branchId || undefined, limit: 20 }
    const cached = mipAnnouncementsModule.peekList(input)
    if (cached) {
      this.applyPage(cached)
    }
    else if (this.data.state !== 'ready') {
      this.setData({ state: 'loading', message: '' })
    }
    // 整表重置后旧的追加锁可能因代际失配不再自复位，这里统一归零。
    this.setData({ loadingMore: false, refreshing: true })
    try {
      const page = await mipAnnouncementsModule.list(input, force)
      if (requestSeq !== this.requestSeq) {
        return
      }
      this.applyPage(page)
    }
    catch (error) {
      if (requestSeq !== this.requestSeq) {
        return
      }
      this.setData(this.data.items.length
        ? { message: '公告更新失败，已保留上次结果。' }
        : { state: 'error', message: error instanceof Error ? error.message : '公告加载失败' })
    }
    finally {
      if (requestSeq === this.requestSeq) {
        this.setData({ refreshing: false })
      }
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
    if (!this.data.nextCursor || this.data.loadingMore || this.data.refreshing) {
      return
    }
    // 追加请求绑定当前整表代际：在途期间发生整表重置（下拉刷新）则结果整体作废。
    const requestSeq = this.requestSeq
    this.setData({ loadingMore: true })
    try {
      const page = await mipAnnouncementsModule.list({
        branchId: this.data.branchId || undefined,
        cursor: this.data.nextCursor,
        limit: 20,
      }, true)
      if (requestSeq !== this.requestSeq) {
        return
      }
      // 按 id 去重兜底（同 participants/orders 的 Map 合并写法）：即使游标窗口
      // 与刷新后的首页重叠，也不会让 wx:key="id" 出现重复项。
      const incoming = page.items.map(item => ({
        ...item,
        publishedText: item.publishedAt ? formatLocalMonthDayTime(item.publishedAt) : '',
      }))
      const items = [...new Map([...this.data.items, ...incoming].map(item => [item.id, item])).values()]
      this.setData({
        items,
        nextCursor: page.nextCursor || '',
        message: '',
      })
    }
    catch {
      if (requestSeq === this.requestSeq) {
        this.setData({ message: '更多公告加载失败，请稍后重试。' })
      }
    }
    finally {
      if (requestSeq === this.requestSeq) {
        this.setData({ loadingMore: false })
      }
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
