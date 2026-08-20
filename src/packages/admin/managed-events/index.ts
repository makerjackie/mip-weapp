import type { AdminManagedEvent } from '../../../modules/admin/types'
import type { AdminPageState } from '../shared/page-state'
import { adminModule } from '../../../modules/admin/client'
import { caseNavigateTo } from '../../../modules/platform/case-navigation'
import { formatLocalDateTime } from '../../../utils/date'
import { adminLoadFailure } from '../shared/page-state'

const roleLabels: Record<AdminManagedEvent['managerRole'], string> = {
  GLOBAL: '全局运营',
  EVENT_OWNER: '活动负责人',
  EVENT_MANAGER: '活动管理员',
  EVENT_STAFF: '现场工作人员',
}

const statusLabels: Record<AdminManagedEvent['status'], string> = {
  DRAFT: '草稿',
  PUBLISHED: '报名中',
  CANCELLED: '已取消',
  COMPLETED: '已结束',
}

interface DisplayManagedEvent extends AdminManagedEvent {
  startsText: string
  roleText: string
  statusText: string
}

type ManagedEventStatus = 'ALL' | AdminManagedEvent['status']

function displayEvents(items: AdminManagedEvent[]): DisplayManagedEvent[] {
  return items.map(item => ({
    ...item,
    startsText: formatLocalDateTime(item.startsAt),
    roleText: roleLabels[item.managerRole],
    statusText: statusLabels[item.status],
  }))
}

function filterEvents(
  items: DisplayManagedEvent[],
  status: ManagedEventStatus,
  query: string,
) {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  return items.filter((item) => {
    const matchesStatus = status === 'ALL' || item.status === status
    const matchesQuery = !normalizedQuery
      || item.title.toLocaleLowerCase().includes(normalizedQuery)
      || item.location.toLocaleLowerCase().includes(normalizedQuery)
    return matchesStatus && matchesQuery
  })
}

Page({
  data: {
    state: 'loading' as AdminPageState,
    allItems: [] as DisplayManagedEvent[],
    items: [] as DisplayManagedEvent[],
    globalAdmin: false,
    status: 'ALL' as ManagedEventStatus,
    query: '',
    message: '',
  },

  onShow() {
    void this.load()
  },

  async load(force = false) {
    const cached = adminModule.peekManagedEvents()
    if (cached) {
      const allItems = displayEvents(cached)
      this.setData({
        state: 'ready',
        allItems,
        items: filterEvents(allItems, this.data.status, this.data.query),
        globalAdmin: cached.some(item => item.managerRole === 'GLOBAL'),
        message: '',
      })
    }
    else if (this.data.state !== 'ready') {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const items = await adminModule.listManagedEvents({ force })
      const allItems = displayEvents(items)
      this.setData({
        state: 'ready',
        allItems,
        items: filterEvents(allItems, this.data.status, this.data.query),
        globalAdmin: items.some(item => item.managerRole === 'GLOBAL'),
        message: '',
      })
    }
    catch (error) {
      this.setData(adminLoadFailure(error, {
        hasContent: Boolean(cached) || this.data.state === 'ready',
        fallbackMessage: '活动管理列表加载失败',
      }))
    }
  },

  async onPullDownRefresh() {
    try {
      await this.load(true)
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  changeStatus(event: WechatMiniprogram.CustomEvent<{ value: ManagedEventStatus }>) {
    const status = event.detail.value
    this.setData({
      status,
      items: filterEvents(this.data.allItems, status, this.data.query),
    })
  },

  updateQuery(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const query = event.detail.value
    this.setData({
      query,
      items: filterEvents(this.data.allItems, this.data.status, query),
    })
  },

  clearQuery() {
    this.setData({
      query: '',
      items: filterEvents(this.data.allItems, this.data.status, ''),
    })
  },

  openEvent(event: WechatMiniprogram.BaseEvent) {
    const eventId = String(event.currentTarget.dataset.eventId || '')
    if (eventId) {
      caseNavigateTo({ url: `/packages/admin/event-console/index?eventId=${encodeURIComponent(eventId)}` })
    }
  },

  createEvent() {
    if (this.data.globalAdmin) {
      caseNavigateTo({ url: '/packages/admin/events/index?mode=create' })
    }
  },
})
