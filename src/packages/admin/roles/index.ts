import type { AdminProfileItem, AdminRoleItem } from '../../../modules/admin/types'
import type { AdminPageState } from '../shared/page-state'
import { adminModule } from '../../../modules/admin/client'
import { adminLoadFailure } from '../shared/page-state'

const roleValues = ['manager', 'reviewer', 'support'] as const
const roleLabels = ['管理员', '审核员', '客服']
const roleCopy: Record<string, string> = {
  owner: '全部权限',
  manager: '活动、成员、订单、退款与审计',
  reviewer: '成员资料与报名审核',
  support: '订单与售后退款',
}

function displayRoles(items: AdminRoleItem[]) {
  return items.map(item => ({
    ...item,
    roleText: item.role === 'owner' ? '主理人' : roleLabels[roleValues.indexOf(item.role as typeof roleValues[number])] || '管理员',
    permissionText: roleCopy[item.role] || '',
    active: item.status === 'ACTIVE',
    canEdit: item.role !== 'owner' && Boolean(item.profileId),
  }))
}

Page({
  data: {
    state: 'loading' as AdminPageState,
    roles: [] as ReturnType<typeof displayRoles>,
    profiles: [] as AdminProfileItem[],
    profileLabels: [] as string[],
    roleLabels,
    selectedProfileIndex: 0,
    selectedRoleIndex: 0,
    busyId: '',
    message: '',
  },
  onShow() { void this.load() },
  async onPullDownRefresh() {
    try {
      await this.load(true)
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },
  async load(force = false) {
    const cached = adminModule.peekAdminRoles()
    if (cached) {
      this.setData({ state: 'ready', roles: displayRoles(cached) })
    }
    try {
      const [roles, profiles] = await Promise.all([
        adminModule.listAdminRoles({ force }),
        adminModule.listProfiles('APPROVED', { force }),
      ])
      const assigned = new Set(roles.map(item => item.profileId).filter(Boolean))
      const candidates = profiles.filter(item => !assigned.has(item.id))
      this.setData({
        state: 'ready',
        roles: displayRoles(roles),
        profiles: candidates,
        profileLabels: candidates.map(item => `${item.nickname}${item.city ? ` · ${item.city}` : ''}`),
        selectedProfileIndex: 0,
        message: '',
      })
    }
    catch (error) {
      this.setData(adminLoadFailure(error, {
        hasContent: Boolean(cached),
        fallbackMessage: '管理员列表加载失败',
      }))
    }
  },
  chooseProfile(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ selectedProfileIndex: Number(event.detail.value) || 0 })
  },
  chooseRole(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ selectedRoleIndex: Number(event.detail.value) || 0 })
  },
  async addRole() {
    const profile = this.data.profiles[this.data.selectedProfileIndex]
    const role = roleValues[this.data.selectedRoleIndex]
    if (!profile || !role || this.data.busyId) {
      return
    }
    this.setData({ busyId: profile.id, message: '' })
    try {
      await adminModule.setAdminRole(profile.id, role, true)
      wx.showToast({ title: '管理员已添加', icon: 'success' })
      await this.load(true)
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '添加失败' })
    }
    finally {
      this.setData({ busyId: '' })
    }
  },
  async toggleRole(event: WechatMiniprogram.BaseEvent) {
    const profileId = String(event.currentTarget.dataset.profileId || '')
    const role = String(event.currentTarget.dataset.role || '') as typeof roleValues[number]
    const active = event.currentTarget.dataset.active === true || event.currentTarget.dataset.active === 'true'
    if (!profileId || !roleValues.includes(role) || this.data.busyId) {
      return
    }
    this.setData({ busyId: profileId, message: '' })
    try {
      await adminModule.setAdminRole(profileId, role, !active)
      wx.showToast({ title: active ? '权限已暂停' : '权限已恢复', icon: 'success' })
      await this.load(true)
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '更新失败' })
    }
    finally {
      this.setData({ busyId: '' })
    }
  },
})
