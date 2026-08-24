import type { AdminRoleCandidate, AdminRoleItem, AdminRoleKey } from '../../../modules/mip-admin'
import type { AdminPageState } from '../shared/page-state'
import { hasScopedCapability, mipAdminModule } from '../../../modules/mip-admin'
import { adminLoadFailure } from '../shared/page-state'

const eventRoleLabels: Partial<Record<AdminRoleKey, string>> = {
  EVENT_OWNER: '活动负责人',
  EVENT_MANAGER: '活动管理员',
  EVENT_STAFF: '现场人员',
}

type AdminRoleView = AdminRoleItem & { canManage: boolean, roleLabel: string, statusLabel: string }

Page({
  data: {
    state: 'loading' as AdminPageState,
    eventId: '',
    roles: [] as AdminRoleView[],
    candidates: [] as AdminRoleCandidate[],
    query: '',
    selectedRole: 'EVENT_STAFF' as AdminRoleKey,
    selectedRoleLabel: '现场人员',
    canChange: false,
    canGrantOwner: false,
    canGrantManager: false,
    canGrantStaff: false,
    processingId: '',
    message: '',
  },
  onLoad(query: Record<string, string>) { this.setData({ eventId: query.eventId || '' }) },
  onShow() {
    if (this.data.eventId) {
      void this.loadRoles()
    }
  },
  async loadRoles(force = false) {
    const hasContent = this.data.roles.length > 0
    if (!hasContent) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const [session, event, response] = await Promise.all([
        mipAdminModule.getSession(force),
        mipAdminModule.getEvent(this.data.eventId, force),
        mipAdminModule.listRoles(force),
      ])
      const scope = { scopeType: 'EVENT' as const, scopeId: this.data.eventId, branchId: event.branchId }
      const canChange = hasScopedCapability(session.capabilities, 'roles.change', scope)
      const actorRoles = new Set(session.roles
        .filter(item => item.scopeType === 'PLATFORM'
          || (item.scopeType === 'BRANCH' && item.scopeId === event.branchId)
          || (item.scopeType === 'EVENT' && item.scopeId === this.data.eventId))
        .map(item => item.roleKey))
      const canGrantOwner = actorRoles.has('PLATFORM_OWNER') || actorRoles.has('BRANCH_ADMIN')
      const canGrantManager = canGrantOwner || actorRoles.has('EVENT_OWNER')
      const canGrantStaff = canGrantManager || actorRoles.has('EVENT_MANAGER')
      const manageableRoles = new Set<AdminRoleKey>([
        ...(canGrantOwner ? ['EVENT_OWNER' as const] : []),
        ...(canGrantManager ? ['EVENT_MANAGER' as const] : []),
        ...(canGrantStaff ? ['EVENT_STAFF' as const] : []),
      ])
      this.setData({
        state: 'ready',
        roles: response.items
          .filter(item => item.scopeType === 'EVENT' && item.scopeId === this.data.eventId)
          .map(item => ({
            ...item,
            canManage: manageableRoles.has(item.roleKey),
            roleLabel: eventRoleLabels[item.roleKey] || '活动成员',
            statusLabel: item.status === 'ACTIVE' ? '生效中' : '已撤销',
          })),
        canChange,
        canGrantOwner,
        canGrantManager,
        canGrantStaff,
        selectedRole: canGrantOwner ? 'EVENT_OWNER' : canGrantManager ? 'EVENT_MANAGER' : 'EVENT_STAFF',
        selectedRoleLabel: canGrantOwner ? '活动负责人' : canGrantManager ? '活动管理员' : '现场人员',
        message: '',
      })
    }
    catch (error) {
      this.setData(adminLoadFailure(error, { hasContent, fallbackMessage: '活动团队加载失败' }))
    }
  },
  updateQuery(event: WechatMiniprogram.CustomEvent<{ value: string }>) { this.setData({ query: event.detail.value }) },
  chooseRole(event: WechatMiniprogram.TouchEvent) {
    const role = String(event.currentTarget.dataset.role || '') as AdminRoleKey
    if ((role === 'EVENT_OWNER' && this.data.canGrantOwner)
      || (role === 'EVENT_MANAGER' && this.data.canGrantManager)
      || (role === 'EVENT_STAFF' && this.data.canGrantStaff)) {
      this.setData({ selectedRole: role, selectedRoleLabel: eventRoleLabels[role] || '活动成员' })
    }
  },
  async search() {
    const query = this.data.query.trim()
    if (!query) {
      this.setData({ candidates: [] })
      return
    }
    try {
      const response = await mipAdminModule.searchRoleCandidates(this.data.eventId, query)
      this.setData({ candidates: response.items, message: '' })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '成员搜索失败' })
    }
  },
  async grant(event: WechatMiniprogram.TouchEvent) {
    const userId = String(event.currentTarget.dataset.id || '')
    if (!userId || !this.data.canChange || this.data.processingId) {
      return
    }
    this.setData({ processingId: userId, message: '' })
    try {
      const modal = await wx.showModal({
        title: '设置活动角色',
        content: '角色设置后立即获得对应的活动管理权限。',
      })
      if (!modal.confirm) {
        return
      }
      await mipAdminModule.mutate(() => mipAdminModule.gateway.setRole({
        userId,
        roleKey: this.data.selectedRole,
        scopeId: this.data.eventId,
        active: true,
      }))
      wx.showToast({ title: '角色已设置', icon: 'success' })
      this.setData({ candidates: [], query: '' })
      await this.loadRoles(true)
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '角色设置失败' })
    }
    finally {
      this.setData({ processingId: '' })
    }
  },
  async revoke(event: WechatMiniprogram.TouchEvent) {
    const userId = String(event.currentTarget.dataset.userId || '')
    const roleKey = String(event.currentTarget.dataset.role || '') as AdminRoleKey
    if (!userId || !this.data.canChange || this.data.processingId) {
      return
    }
    this.setData({ processingId: userId, message: '' })
    try {
      const modal = await wx.showModal({ title: '撤销活动角色', content: '撤销后该账号立即失去对应管理权限。' })
      if (!modal.confirm) {
        return
      }
      await mipAdminModule.mutate(() => mipAdminModule.gateway.setRole({
        userId,
        roleKey,
        scopeId: this.data.eventId,
        active: false,
      }))
      wx.showToast({ title: '角色已撤销', icon: 'success' })
      await this.loadRoles(true)
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '角色撤销失败' })
    }
    finally {
      this.setData({ processingId: '' })
    }
  },
})
