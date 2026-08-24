import type { AdminRoleItem, AdminRoleKey, AdminUser } from '../../../modules/mip-admin'
import type { AdminPageState } from '../shared/page-state'
import { mipAdminModule } from '../../../modules/mip-admin'
import { mipBranchesModule } from '../../../modules/mip-identity/client'
import { adminLoadFailure } from '../shared/page-state'

const roleLabels: Record<AdminRoleKey, string> = {
  PLATFORM_OWNER: '平台超级管理员',
  PLATFORM_OPERATIONS: '平台运营',
  PLATFORM_FINANCE: '平台财务',
  BRANCH_ADMIN: '城市管理员',
  EVENT_OWNER: '活动负责人',
  EVENT_MANAGER: '活动管理员',
  EVENT_STAFF: '现场人员',
}

type RoleView = AdminRoleItem & { roleLabel: string, scopeLabel: string }

Page({
  data: {
    state: 'loading' as AdminPageState,
    roles: [] as RoleView[],
    candidates: [] as AdminUser[],
    query: '',
    selectedUserId: '',
    selectedUserName: '',
    selectedRole: 'PLATFORM_OPERATIONS' as AdminRoleKey,
    selectedRoleLabel: roleLabels.PLATFORM_OPERATIONS,
    selectedRoleIsScoped: false,
    scopeId: '',
    branches: [] as Array<{ id: string, name: string }>,
    branchIndex: -1,
    events: [] as Array<{ id: string, title: string }>,
    eventIndex: -1,
    canPlatformChange: false,
    processing: false,
    message: '',
  },
  onShow() { void this.loadRoles() },
  async loadRoles(force = false) {
    const hasContent = this.data.roles.length > 0
    if (!hasContent) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const [session, response, branchSnapshot, eventsResponse] = await Promise.all([
        mipAdminModule.getSession(force),
        mipAdminModule.listRoles(force),
        mipBranchesModule.load(),
        mipAdminModule.listEvents({ limit: 50 }, force),
      ])
      const branches = branchSnapshot.branches
        .filter(item => item.status === 'ACTIVE')
        .map(item => ({ id: String(item.id), name: item.name }))
      const events = eventsResponse.items.map(item => ({ id: item.id, title: item.title }))
      const branchNames = new Map(branches.map(item => [item.id, item.name]))
      const eventNames = new Map(events.map(item => [item.id, item.title]))
      this.setData({
        state: 'ready',
        roles: response.items.map(item => ({
          ...item,
          roleLabel: roleLabels[item.roleKey],
          scopeLabel: item.scopeType === 'PLATFORM'
            ? '平台'
            : item.scopeType === 'BRANCH'
              ? branchNames.get(item.scopeId || '') || '城市分会'
              : eventNames.get(item.scopeId || '') || '活动',
        })),
        branches,
        events,
        branchIndex: branches.findIndex(item => item.id === this.data.scopeId),
        eventIndex: events.findIndex(item => item.id === this.data.scopeId),
        canPlatformChange: session.capabilities.some(item => item.capability === 'roles.change' && item.scopeType === 'PLATFORM'),
        message: '',
      })
    }
    catch (error) {
      this.setData(adminLoadFailure(error, { hasContent, fallbackMessage: '角色列表加载失败' }))
    }
  },
  updateQuery(event: WechatMiniprogram.CustomEvent<{ value: string }>) { this.setData({ query: event.detail.value }) },
  chooseRole(event: WechatMiniprogram.TouchEvent) {
    const role = String(event.currentTarget.dataset.role || '') as AdminRoleKey
    if (!roleLabels[role]) {
      return
    }
    const selectedRoleIsScoped = role === 'BRANCH_ADMIN' || role.startsWith('EVENT_')
    const branchIndex = role === 'BRANCH_ADMIN' && this.data.branches.length ? 0 : -1
    const eventIndex = role.startsWith('EVENT_') && this.data.events.length ? 0 : -1
    const scopeId = branchIndex >= 0
      ? this.data.branches[branchIndex].id
      : eventIndex >= 0
        ? this.data.events[eventIndex].id
        : ''
    this.setData({
      selectedRole: role,
      selectedRoleLabel: roleLabels[role],
      selectedRoleIsScoped,
      scopeId,
      branchIndex,
      eventIndex,
    })
  },
  changeBranch(event: WechatMiniprogram.CustomEvent<{ value: string | number }>) {
    const branchIndex = Number(event.detail.value)
    const branch = this.data.branches[branchIndex]
    if (branch) {
      this.setData({ branchIndex, scopeId: branch.id })
    }
  },
  changeEvent(event: WechatMiniprogram.CustomEvent<{ value: string | number }>) {
    const eventIndex = Number(event.detail.value)
    const selected = this.data.events[eventIndex]
    if (selected) {
      this.setData({ eventIndex, scopeId: selected.id })
    }
  },
  async searchUsers() {
    const query = this.data.query.trim()
    if (!query) {
      this.setData({ candidates: [] })
      return
    }
    try {
      const response = await mipAdminModule.listUsers({ includePhone: false, filters: { query } }, true)
      this.setData({ candidates: response.items, message: '' })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '用户搜索失败' })
    }
  },
  chooseUser(event: WechatMiniprogram.TouchEvent) {
    this.setData({
      selectedUserId: String(event.currentTarget.dataset.id || ''),
      selectedUserName: String(event.currentTarget.dataset.name || ''),
      candidates: [],
    })
  },
  async grant() {
    if (!this.data.canPlatformChange || !this.data.selectedUserId || this.data.processing) {
      return
    }
    if (this.data.selectedRoleIsScoped && !this.data.scopeId.trim()) {
      this.setData({ message: '请填写分会或活动标识' })
      return
    }
    this.setData({ processing: true, message: '' })
    try {
      const modal = await wx.showModal({
        title: '设置角色',
        content: `确认将 ${this.data.selectedUserName} 设置为${this.data.selectedRoleLabel}。`,
      })
      if (!modal.confirm) {
        return
      }
      await mipAdminModule.mutate(() => mipAdminModule.gateway.setRole({
        userId: this.data.selectedUserId,
        roleKey: this.data.selectedRole,
        scopeId: this.data.scopeId.trim() || undefined,
        active: true,
      }))
      wx.showToast({ title: '角色已设置', icon: 'success' })
      this.setData({ selectedUserId: '', selectedUserName: '', scopeId: '' })
      await this.loadRoles(true)
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '角色设置失败' })
    }
    finally {
      this.setData({ processing: false })
    }
  },
  async revoke(event: WechatMiniprogram.TouchEvent) {
    const userId = String(event.currentTarget.dataset.userId || '')
    const roleKey = String(event.currentTarget.dataset.role || '') as AdminRoleKey
    const scopeId = String(event.currentTarget.dataset.scopeId || '')
    if (!this.data.canPlatformChange || !userId || !roleLabels[roleKey] || this.data.processing) {
      return
    }
    this.setData({ processing: true, message: '' })
    try {
      const modal = await wx.showModal({
        title: '撤销角色',
        content: `撤销后该账号立即失去${roleLabels[roleKey]}权限。`,
      })
      if (!modal.confirm) {
        return
      }
      await mipAdminModule.mutate(() => mipAdminModule.gateway.setRole({
        userId,
        roleKey,
        scopeId: scopeId || undefined,
        active: false,
      }))
      wx.showToast({ title: '角色已撤销', icon: 'success' })
      await this.loadRoles(true)
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '角色撤销失败' })
    }
    finally {
      this.setData({ processing: false })
    }
  },
})
