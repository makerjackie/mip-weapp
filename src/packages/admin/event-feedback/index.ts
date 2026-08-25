import type { EventId } from '../../../modules/mip'
import type { AdminEventFeedback } from '../../../modules/mip-events'
import type { AdminPageState } from '../shared/page-state'
import { hasScopedCapability, mipAdminModule } from '../../../modules/mip-admin'
import { mipEventsModule } from '../../../modules/mip-events/client'
import { adminLoadFailure } from '../shared/page-state'

type FeedbackView = AdminEventFeedback & { submittedText: string, updatedText: string }

const ratingOptions = [
  { value: 0, label: '全部评分' },
  { value: 5, label: '5 分' },
  { value: 4, label: '4 分' },
  { value: 3, label: '3 分' },
  { value: 2, label: '2 分' },
  { value: 1, label: '1 分' },
]

function localDateTime(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    return ''
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function feedbackView(item: AdminEventFeedback): FeedbackView {
  return {
    ...item,
    submittedText: localDateTime(item.submittedAt),
    updatedText: localDateTime(item.updatedAt),
  }
}

Page({
  data: {
    state: 'loading' as AdminPageState | 'empty',
    eventId: '',
    eventTitle: '',
    rating: 0,
    ratingOptions,
    items: [] as FeedbackView[],
    nextCursor: '',
    loadingMore: false,
    canRead: false,
    message: '',
  },

  onLoad(query: Record<string, string>) {
    this.setData({ eventId: query.eventId || '' })
  },

  onShow() {
    void this.loadFeedback(true)
  },

  onPullDownRefresh() {
    void this.loadFeedback(true).finally(() => wx.stopPullDownRefresh())
  },

  retryLoad() {
    void this.loadFeedback(true)
  },

  async loadFeedback(force = false) {
    if (!this.data.eventId) {
      this.setData({ state: 'error', message: '活动标识无效。' })
      return
    }
    const hasContent = this.data.items.length > 0
    if (force || !hasContent) {
      this.setData({
        state: hasContent ? 'ready' : 'loading',
        nextCursor: force ? '' : this.data.nextCursor,
        message: '',
      })
    }
    try {
      const [event, session] = await Promise.all([
        mipAdminModule.events.get(this.data.eventId, force),
        mipAdminModule.getSession(force),
      ])
      const canRead = hasScopedCapability(session.capabilities, 'events.feedback.read', {
        scopeType: 'EVENT',
        scopeId: event.id,
        branchId: event.branchId,
      })
      if (!canRead) {
        this.setData({ state: 'forbidden', canRead: false, items: [], message: '' })
        return
      }
      const response = await mipEventsModule.listAdminFeedback(this.data.eventId as EventId, {
        rating: this.data.rating ? this.data.rating as 1 | 2 | 3 | 4 | 5 : undefined,
        cursor: force ? undefined : this.data.nextCursor || undefined,
        limit: 20,
      })
      const items = (force ? response.items : [...this.data.items, ...response.items]).map(feedbackView)
      this.setData({
        state: items.length ? 'ready' : 'empty',
        eventTitle: event.title,
        canRead: true,
        items,
        nextCursor: response.nextCursor || '',
        message: '',
      })
    }
    catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'FORBIDDEN') {
        this.setData({ state: 'forbidden', canRead: false, items: [], message: '' })
        return
      }
      this.setData(adminLoadFailure(error, { hasContent, fallbackMessage: '活动反馈加载失败' }))
    }
  },

  chooseRating(event: WechatMiniprogram.TouchEvent) {
    const rating = Number(event.currentTarget.dataset.rating || 0)
    if (!ratingOptions.some(item => item.value === rating) || rating === this.data.rating || this.data.loadingMore) {
      return
    }
    this.setData({ rating, items: [], nextCursor: '', state: 'loading', message: '' })
    void this.loadFeedback(true)
  },

  async loadMore() {
    if (!this.data.nextCursor || this.data.loadingMore || !this.data.canRead) {
      return
    }
    this.setData({ loadingMore: true, message: '' })
    try {
      await this.loadFeedback()
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '更多反馈加载失败' })
    }
    finally {
      this.setData({ loadingMore: false })
    }
  },
})
