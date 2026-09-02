import type { AdminEvent, AdminEventStatus } from '../../../modules/mip-admin'
import type { AdminPageState } from '../shared/page-state'
import { mipAdminModule } from '../../../modules/mip-admin'
import { formatLocalDateTime } from '../../../utils/date'
import { adminLoadFailure } from '../shared/page-state'

type EventView = AdminEvent & {
  startsText: string
  statusText: string
  statusTheme: 'default' | 'success' | 'warning' | 'danger'
}

const statusOptions: Array<{ value: AdminEventStatus | '', label: string }> = [
  { value: 'PUBLISHED', label: '可签到' },
  { value: 'ENDED', label: '已结束' },
  { value: '', label: '全部' },
]

const statusLabels: Record<AdminEventStatus, string> = {
  DRAFT: '草稿',
  PUBLISHED: '已发布',
  UNPUBLISHED: '已下架',
  CANCELLED: '已取消',
  ENDED: '已结束',
  ARCHIVED: '已归档',
}

function eventView(item: AdminEvent): EventView {
  return {
    ...item,
    startsText: formatLocalDateTime(item.startsAt),
    statusText: statusLabels[item.status],
    statusTheme: item.status === 'PUBLISHED'
      ? 'success'
      : item.status === 'CANCELLED'
        ? 'danger'
        : item.status === 'ENDED' || item.status === 'UNPUBLISHED'
          ? 'warning'
          : 'default',
  }
}

Page({
  data: {
    state: 'loading' as AdminPageState,
    events: [] as EventView[],
    query: '',
    status: 'PUBLISHED' as AdminEventStatus | '',
    statusOptions,
    nextCursor: null as string | null,
    loadingMore: false,
    message: '',
  },
  requestSeq: 0,

  onShow() {
    void this.loadEvents()
  },

  onHide() {
    this.requestSeq += 1
  },

  onUnload() {
    this.requestSeq += 1
  },

  updateQuery(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ query: event.detail.value })
  },

  changeStatus(event: WechatMiniprogram.TouchEvent) {
    const status = String(event.currentTarget.dataset.value || '') as AdminEventStatus | ''
    this.setData({ status, events: [], nextCursor: null })
    void this.loadEvents(true)
  },

  search() {
    this.setData({ events: [], nextCursor: null })
    void this.loadEvents(true)
  },

  async loadEvents(force = false) {
    const hasContent = this.data.events.length > 0
    if (!hasContent) {
      this.setData({ state: 'loading', message: '' })
    }
    const seq = this.requestSeq + 1
    this.requestSeq = seq
    try {
      const response = await mipAdminModule.events.list({
        filters: {
          query: this.data.query.trim(),
          status: this.data.status,
        },
        sort: { field: 'startsAt', direction: 'ASC' },
      }, force)
      if (seq !== this.requestSeq) {
        return
      }
      this.setData({
        state: 'ready',
        events: response.items.map(eventView),
        nextCursor: response.nextCursor || null,
        loadingMore: false,
        message: '',
      })
    }
    catch (error) {
      if (seq !== this.requestSeq) {
        return
      }
      this.setData(adminLoadFailure(error, { hasContent, fallbackMessage: '活动列表加载失败' }))
    }
  },

  async loadMoreEvents() {
    if (!this.data.nextCursor || this.data.loadingMore || this.data.state !== 'ready') {
      return
    }
    const seq = this.requestSeq
    this.setData({ loadingMore: true, message: '' })
    try {
      const response = await mipAdminModule.events.list({
        filters: {
          query: this.data.query.trim(),
          status: this.data.status,
        },
        sort: { field: 'startsAt', direction: 'ASC' },
        cursor: this.data.nextCursor,
      })
      if (seq !== this.requestSeq) {
        return
      }
      this.setData({
        events: this.data.events.concat(response.items.map(eventView)),
        nextCursor: response.nextCursor || null,
      })
    }
    catch (error) {
      if (seq === this.requestSeq) {
        this.setData({ message: error instanceof Error ? error.message : '更多活动加载失败' })
      }
    }
    finally {
      if (seq === this.requestSeq) {
        this.setData({ loadingMore: false })
      }
    }
  },

  openEvent(event: WechatMiniprogram.TouchEvent) {
    const eventId = String(event.currentTarget.dataset.id || '')
    if (eventId) {
      void wx.navigateTo({
        url: `/packages/admin/event-console/index?eventId=${encodeURIComponent(eventId)}`,
      })
    }
  },

  async onPullDownRefresh() {
    try {
      await this.loadEvents(true)
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },
})
