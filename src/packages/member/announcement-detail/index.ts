import type { AnnouncementDetail } from '../../../modules/mip-announcements'
import { mipAnnouncementsModule } from '../../../modules/mip-announcements'
import { caseNavigateTo } from '../../../modules/platform/case-navigation'
import { formatLocalMonthDayTime } from '../../../utils/date'

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    announcementId: '',
    item: null as AnnouncementDetail | null,
    publishedText: '',
    message: '',
  },

  onLoad(query: Record<string, string>) {
    const announcementId = query.announcementId || ''
    const cached = mipAnnouncementsModule.peek(announcementId)
    this.setData({ announcementId })
    if (cached) {
      this.applyItem(cached)
    }
    void this.loadAnnouncement()
  },

  async loadAnnouncement(force = false) {
    if (this.data.state !== 'ready') {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      this.applyItem(await mipAnnouncementsModule.get(this.data.announcementId, force))
    }
    catch (error) {
      this.setData(this.data.item
        ? { message: '公告更新失败，已保留上次内容。' }
        : { state: 'error', message: error instanceof Error ? error.message : '公告加载失败' })
    }
  },

  applyItem(item: AnnouncementDetail) {
    this.setData({
      state: 'ready',
      item,
      publishedText: item.publishedAt ? formatLocalMonthDayTime(item.publishedAt) : '',
      message: '',
    })
  },

  openTarget() {
    const item = this.data.item
    if (!item?.targetId) {
      return
    }
    if (item.targetType === 'EVENT') {
      caseNavigateTo({ url: `/packages/member/mip-events/detail/index?eventId=${encodeURIComponent(item.targetId)}` })
    }
    else if (item.targetType === 'OPPORTUNITY') {
      caseNavigateTo({ url: `/packages/member/mip-opportunities/detail/index?id=${encodeURIComponent(item.targetId)}` })
    }
  },
})
