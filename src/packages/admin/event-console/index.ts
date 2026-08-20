import type { AdminManagedEvent } from '../../../modules/admin/types'
import type { AdminPageState } from '../shared/page-state'
import { adminModule } from '../../../modules/admin/client'
import { caseNavigateTo } from '../../../modules/platform/case-navigation'
import { formatLocalDateTime } from '../../../utils/date'
import { adminLoadFailure } from '../shared/page-state'

const roleLabels: Record<AdminManagedEvent['managerRole'], string> = {
  GLOBAL: '平台活动运营',
  EVENT_OWNER: '活动负责人',
  EVENT_MANAGER: '活动管理员',
  EVENT_STAFF: '现场工作人员',
}

const statusLabels: Record<AdminManagedEvent['status'], string> = {
  DRAFT: '草稿',
  PUBLISHED: '已发布',
  CANCELLED: '已取消',
  COMPLETED: '已结束',
}

interface EventConsoleView extends AdminManagedEvent {
  startsText: string
  roleText: string
  statusText: string
}

function displayEvent(item: AdminManagedEvent): EventConsoleView {
  return {
    ...item,
    startsText: formatLocalDateTime(item.startsAt),
    roleText: roleLabels[item.managerRole],
    statusText: statusLabels[item.status],
  }
}

Page({
  data: {
    state: 'loading' as AdminPageState,
    eventId: '',
    item: null as EventConsoleView | null,
    message: '',
  },

  onLoad(query: Record<string, string>) {
    this.setData({ eventId: query.eventId || '' })
  },

  onShow() {
    void this.load()
  },

  async load(force = false) {
    if (!this.data.eventId) {
      this.setData({ state: 'error', message: '缺少活动参数' })
      return
    }
    const cached = adminModule.peekManagedEvents()
    const cachedItem = cached?.find(item => item.id === this.data.eventId)
    if (cachedItem) {
      this.setData({ state: 'ready', item: displayEvent(cachedItem), message: '' })
    }
    else if (this.data.state !== 'ready') {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const items = await adminModule.listManagedEvents({ force })
      const item = items.find(candidate => candidate.id === this.data.eventId)
      if (!item) {
        this.setData({ state: 'error', item: null, message: '活动不存在或你已没有管理权限' })
        return
      }
      this.setData({ state: 'ready', item: displayEvent(item), message: '' })
    }
    catch (error) {
      this.setData(adminLoadFailure(error, {
        hasContent: Boolean(cachedItem) || this.data.state === 'ready',
        fallbackMessage: '活动管理信息加载失败',
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

  openPreview() {
    if (this.data.item) {
      caseNavigateTo({
        url: `/packages/member/event-detail/index?eventId=${encodeURIComponent(this.data.item.id)}`,
      })
    }
  },

  openEditor() {
    if (this.data.item?.canEdit) {
      caseNavigateTo({
        url: `/packages/admin/events/index?eventId=${encodeURIComponent(this.data.item.id)}`,
      })
    }
  },

  openRoster() {
    if (this.data.item && (this.data.item.canRoster || this.data.item.canCheckIn)) {
      caseNavigateTo({
        url: `/packages/admin/event-registrations/index?eventId=${encodeURIComponent(this.data.item.id)}&title=${encodeURIComponent(this.data.item.title)}`,
      })
    }
  },

  openManagers() {
    if (this.data.item?.canManageTeam) {
      caseNavigateTo({
        url: `/packages/admin/event-managers/index?eventId=${encodeURIComponent(this.data.item.id)}&title=${encodeURIComponent(this.data.item.title)}&startsAt=${encodeURIComponent(this.data.item.startsAt)}`,
      })
    }
  },

  openAlbum() {
    if (this.data.item?.canAlbum) {
      caseNavigateTo({
        url: `/packages/admin/event-album/index?eventId=${encodeURIComponent(this.data.item.id)}&title=${encodeURIComponent(this.data.item.title)}&startsAt=${encodeURIComponent(this.data.item.startsAt)}`,
      })
    }
  },

  openMoreActions() {
    if (this.data.item?.canEdit) {
      caseNavigateTo({
        url: `/packages/admin/events/index?eventId=${encodeURIComponent(this.data.item.id)}&section=actions`,
      })
    }
  },
})
