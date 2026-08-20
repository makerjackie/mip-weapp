import type {
  AdminEventManager,
  AdminProfileItem,
  EventManagerRole,
} from '../../../modules/admin/types'
import type { AdminPageState } from '../shared/page-state'
import { adminModule } from '../../../modules/admin/client'
import { formatLocalDateTime } from '../../../utils/date'
import { adminLoadFailure } from '../shared/page-state'

interface DisplayEventManager extends AdminEventManager {
  initial: string
  roleText: string
}

const roles: EventManagerRole[] = [
  'EVENT_OWNER',
  'EVENT_MANAGER',
  'EVENT_STAFF',
]
const roleLabels: Record<EventManagerRole, string> = {
  EVENT_OWNER: '活动负责人',
  EVENT_MANAGER: '活动管理员',
  EVENT_STAFF: '现场工作人员',
}
const roleDescriptions: Record<EventManagerRole, string> = {
  EVENT_OWNER: '可管理全部活动事务、团队、报名联系方式和名单导出',
  EVENT_MANAGER: '可编辑活动，查看报名联系方式，并处理审核、签到、导出与相册',
  EVENT_STAFF: '可查看报名名单与联系方式，完成签到和现场相册协作',
}

Page({
  data: {
    state: 'loading' as AdminPageState,
    eventId: '',
    eventTitle: '',
    startsText: '',
    managers: [] as DisplayEventManager[],
    profiles: [] as AdminProfileItem[],
    profileNames: [] as string[],
    selectedProfileIndex: 0,
    selectedRoleIndex: 0,
    roleNames: roles.map(role => roleLabels[role]),
    roleDescription: roleDescriptions[roles[0]],
    saving: false,
    message: '',
  },

  onLoad(query: Record<string, string>) {
    this.setData({
      eventId: query.eventId || '',
      eventTitle: query.title ? decodeURIComponent(query.title) : '',
      startsText: query.startsAt ? formatLocalDateTime(decodeURIComponent(query.startsAt)) : '',
    })
    void this.load(true)
  },

  async onPullDownRefresh() {
    try {
      await this.load(true)
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  async load(force = false) {
    if (this.data.state !== 'ready') {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const [managers, profiles, managedEvents] = await Promise.all([
        adminModule.listEventManagers(this.data.eventId, { force }),
        adminModule.listProfiles('APPROVED', { force }),
        adminModule.listManagedEvents({ force }),
      ])
      const currentEvent = managedEvents.find(item => item.id === this.data.eventId)
      this.setData({
        state: 'ready',
        eventTitle: currentEvent?.title || this.data.eventTitle,
        startsText: currentEvent?.startsAt
          ? formatLocalDateTime(currentEvent.startsAt)
          : this.data.startsText,
        managers: managers.map(item => ({
          ...item,
          initial: item.nickname.slice(0, 1) || '管',
          roleText: roleLabels[item.role],
        })),
        profiles,
        profileNames: profiles.map(item => `${item.nickname}${item.city ? ` · ${item.city}` : ''}`),
        message: '',
      })
    }
    catch (error) {
      this.setData(adminLoadFailure(error, {
        hasContent: this.data.managers.length > 0,
        fallbackMessage: '管理员加载失败',
      }))
    }
  },

  chooseProfile(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ selectedProfileIndex: Number(event.detail.value) || 0 })
  },

  chooseRole(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const selectedRoleIndex = Number(event.detail.value) || 0
    this.setData({
      selectedRoleIndex,
      roleDescription: roleDescriptions[roles[selectedRoleIndex] || roles[0]],
    })
  },

  async assign() {
    const profile = this.data.profiles[this.data.selectedProfileIndex]
    const role = roles[this.data.selectedRoleIndex]
    if (!profile || !role || this.data.saving) {
      this.setData({ message: '请选择成员和管理角色。' })
      return
    }
    this.setData({ saving: true, message: '' })
    try {
      await adminModule.setEventManager(this.data.eventId, profile.id, role, true)
      await this.load(true)
      wx.showToast({ title: '已添加', icon: 'success' })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '添加失败' })
    }
    finally {
      this.setData({ saving: false })
    }
  },

  async remove(event: WechatMiniprogram.BaseEvent) {
    const profileId = String(event.currentTarget.dataset.profileId || '')
    const role = String(event.currentTarget.dataset.role || '') as EventManagerRole
    if (!profileId || !roles.includes(role)) {
      return
    }
    const confirm = await wx.showModal({
      title: '移除活动管理员',
      content: '移除后，该成员将失去本场活动的相应管理权限。',
      confirmText: '移除',
      confirmColor: '#B84A43',
    })
    if (!confirm.confirm) {
      return
    }
    try {
      await adminModule.setEventManager(this.data.eventId, profileId, role, false)
      await this.load(true)
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '移除失败' })
    }
  },
})
