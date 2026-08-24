import type {
  AdminBranch,
  AdminEvent,
  AdminRoleBinding,
  AdminRoleCandidate,
  AdminRoleItem,
  AdminRoleKey,
} from '../../../modules/mip-admin'
import type { AdminPageState } from '../shared/page-state'
import {
  canDelegateAdminRole,
  hasCapability,
  mipAdminModule,
  scopeTypeForAdminRole,
} from '../../../modules/mip-admin'
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

const roleOrder: AdminRoleKey[] = [
  'PLATFORM_OPERATIONS',
  'PLATFORM_FINANCE',
  'BRANCH_ADMIN',
  'EVENT_OWNER',
  'EVENT_MANAGER',
  'EVENT_STAFF',
  'PLATFORM_OWNER',
]

interface Scope {
  scopeType: 'PLATFORM' | 'BRANCH' | 'EVENT'
  scopeId: string | null
  branchId: string | null
}
type BranchOption = Pick<AdminBranch, 'id' | 'name'>
type EventOption = Pick<AdminEvent, 'id' | 'title' | 'branchId'>
type RoleCandidateView = Pick<AdminRoleCandidate, 'id' | 'nickname' | 'cityName'>
type RoleView = AdminRoleItem & {
  roleLabel: string
  scopeLabel: string
  statusLabel: string
  canManage: boolean
}

function scopeTypeForRole(roleKey: AdminRoleKey): Scope['scopeType'] {
  return scopeTypeForAdminRole(roleKey)
}

function scopeForRole(roleKey: AdminRoleKey, scopeId: string, events: EventOption[]): Scope {
  const scopeType = scopeTypeForRole(roleKey)
  if (scopeType === 'PLATFORM') {
    return { scopeType, scopeId: null, branchId: null }
  }
  if (scopeType === 'BRANCH') {
    return { scopeType, scopeId, branchId: scopeId }
  }
  const event = events.find(item => item.id === scopeId)
  return { scopeType, scopeId, branchId: event?.branchId || null }
}

Page({
  data: {
    state: 'loading' as AdminPageState,
    roles: [] as RoleView[],
    candidates: [] as RoleCandidateView[],
    query: '',
    selectedUserId: '',
    selectedUserName: '',
    selectedRole: 'PLATFORM_OPERATIONS' as AdminRoleKey,
    selectedRoleLabel: roleLabels.PLATFORM_OPERATIONS,
    selectedScopeType: 'PLATFORM' as Scope['scopeType'],
    scopeId: '',
    branches: [] as BranchOption[],
    branchIndex: -1,
    events: [] as EventOption[],
    eventIndex: -1,
    canChange: false,
    canGrantPlatformOwner: false,
    canGrantPlatformOperations: false,
    canGrantPlatformFinance: false,
    canGrantBranchAdmin: false,
    canGrantEventOwner: false,
    canGrantEventManager: false,
    canGrantEventStaff: false,
    processingId: '',
    message: '',
  },
  actorRoles: [] as AdminRoleBinding[],
  branchCatalog: [] as BranchOption[],
  eventCatalog: [] as EventOption[],
  availableRoleKeys: [] as AdminRoleKey[],

  onShow() { void this.loadRoles() },

  async loadEventCatalog(force: boolean) {
    const items: AdminEvent[] = []
    let cursor: string | null = null
    for (let page = 0; page < 10; page += 1) {
      const response = await mipAdminModule.listEvents({ limit: 50, ...(cursor ? { cursor } : {}) }, force)
      items.push(...response.items)
      cursor = response.nextCursor || null
      if (!cursor) {
        break
      }
    }
    return items.map(item => ({ id: item.id, title: item.title, branchId: item.branchId }))
  },

  roleCanBeGranted(roleKey: AdminRoleKey) {
    const scopeType = scopeTypeForRole(roleKey)
    if (scopeType === 'PLATFORM') {
      return canDelegateAdminRole(this.actorRoles, roleKey, { scopeType, scopeId: null, branchId: null })
    }
    if (scopeType === 'BRANCH') {
      return this.branchCatalog.some(item => canDelegateAdminRole(this.actorRoles, roleKey, {
        scopeType,
        scopeId: item.id,
        branchId: item.id,
      }))
    }
    return this.eventCatalog.some(item => canDelegateAdminRole(this.actorRoles, roleKey, {
      scopeType,
      scopeId: item.id,
      branchId: item.branchId,
    }))
  },

  applyRoleSelection(roleKey: AdminRoleKey) {
    const scopeType = scopeTypeForRole(roleKey)
    const branches = scopeType === 'BRANCH'
      ? this.branchCatalog.filter(item => canDelegateAdminRole(this.actorRoles, roleKey, {
          scopeType,
          scopeId: item.id,
          branchId: item.id,
        }))
      : []
    const events = scopeType === 'EVENT'
      ? this.eventCatalog.filter(item => canDelegateAdminRole(this.actorRoles, roleKey, {
          scopeType,
          scopeId: item.id,
          branchId: item.branchId,
        }))
      : []
    const branchIndex = branches.length ? 0 : -1
    const eventIndex = events.length ? 0 : -1
    this.setData({
      selectedRole: roleKey,
      selectedRoleLabel: roleLabels[roleKey],
      selectedScopeType: scopeType,
      branches,
      events,
      branchIndex,
      eventIndex,
      scopeId: scopeType === 'PLATFORM'
        ? ''
        : scopeType === 'BRANCH'
          ? branches[0]?.id || ''
          : events[0]?.id || '',
      candidates: [],
      selectedUserId: '',
      selectedUserName: '',
    })
  },

  async loadRoles(force = false) {
    const hasContent = this.data.roles.length > 0
    if (!hasContent) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const session = await mipAdminModule.getSession(force)
      const [response, events, branchResponse] = await Promise.all([
        mipAdminModule.listRoles(force),
        this.loadEventCatalog(force),
        hasCapability(session.capabilities, 'branches.manage')
          ? mipAdminModule.listBranches(force)
          : Promise.resolve({ items: [] as AdminBranch[], nextCursor: null }),
      ])
      this.actorRoles = session.roles
      this.branchCatalog = branchResponse.items
        .filter(item => item.status === 'ACTIVE')
        .map(item => ({ id: item.id, name: item.name }))
      this.eventCatalog = events
      this.availableRoleKeys = roleOrder.filter(roleKey => this.roleCanBeGranted(roleKey))
      const available = new Set(this.availableRoleKeys)
      const selectedRole = available.has(this.data.selectedRole)
        ? this.data.selectedRole
        : this.availableRoleKeys[0] || 'PLATFORM_OPERATIONS'
      this.setData({
        state: 'ready',
        roles: response.items.map(item => ({
          ...item,
          roleLabel: roleLabels[item.roleKey],
          scopeLabel: item.scopeName,
          statusLabel: item.status === 'ACTIVE' ? '生效中' : '已撤销',
          canManage: item.status === 'ACTIVE' && canDelegateAdminRole(this.actorRoles, item.roleKey, {
            scopeType: item.scopeType,
            scopeId: item.scopeId,
            branchId: item.branchId,
          }),
        })),
        canChange: this.availableRoleKeys.length > 0,
        canGrantPlatformOwner: available.has('PLATFORM_OWNER'),
        canGrantPlatformOperations: available.has('PLATFORM_OPERATIONS'),
        canGrantPlatformFinance: available.has('PLATFORM_FINANCE'),
        canGrantBranchAdmin: available.has('BRANCH_ADMIN'),
        canGrantEventOwner: available.has('EVENT_OWNER'),
        canGrantEventManager: available.has('EVENT_MANAGER'),
        canGrantEventStaff: available.has('EVENT_STAFF'),
        message: '',
      })
      this.applyRoleSelection(selectedRole)
    }
    catch (error) {
      this.setData(adminLoadFailure(error, { hasContent, fallbackMessage: '角色列表加载失败' }))
    }
  },

  updateQuery(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ query: event.detail.value })
  },

  chooseRole(event: WechatMiniprogram.TouchEvent) {
    const roleKey = String(event.currentTarget.dataset.role || '') as AdminRoleKey
    if (this.availableRoleKeys.includes(roleKey)) {
      this.applyRoleSelection(roleKey)
    }
  },

  changeBranch(event: WechatMiniprogram.CustomEvent<{ value: string | number }>) {
    const branchIndex = Number(event.detail.value)
    const branch = this.data.branches[branchIndex]
    if (branch) {
      this.setData({ branchIndex, scopeId: branch.id, candidates: [] })
    }
  },

  changeEvent(event: WechatMiniprogram.CustomEvent<{ value: string | number }>) {
    const eventIndex = Number(event.detail.value)
    const selected = this.data.events[eventIndex]
    if (selected) {
      this.setData({ eventIndex, scopeId: selected.id, candidates: [] })
    }
  },

  async searchUsers() {
    const query = this.data.query.trim()
    if (!query) {
      this.setData({ candidates: [] })
      return
    }
    if (this.data.selectedScopeType !== 'PLATFORM' && !this.data.scopeId) {
      this.setData({ message: '请先选择授权范围。' })
      return
    }
    try {
      const response = this.data.selectedScopeType === 'EVENT'
        ? await mipAdminModule.searchRoleCandidates(this.data.scopeId, query)
        : await mipAdminModule.listUsers({ includePhone: false, filters: { query } }, true)
      this.setData({
        candidates: response.items.map(item => ({
          id: item.id,
          nickname: item.nickname,
          cityName: 'cityName' in item ? item.cityName : '',
        })),
        message: '',
      })
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
    if (!this.data.canChange || !this.data.selectedUserId || this.data.processingId) {
      return
    }
    const scope = scopeForRole(this.data.selectedRole, this.data.scopeId, this.eventCatalog)
    if (!canDelegateAdminRole(this.actorRoles, this.data.selectedRole, scope)) {
      this.setData({ message: '当前账号不能设置该范围的角色。' })
      return
    }
    this.setData({ processingId: this.data.selectedUserId, message: '' })
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
        ...(scope.scopeId ? { scopeId: scope.scopeId } : {}),
        active: true,
      }))
      wx.showToast({ title: '角色已设置', icon: 'success' })
      this.setData({ selectedUserId: '', selectedUserName: '', query: '' })
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
    const roleId = String(event.currentTarget.dataset.id || '')
    const role = this.data.roles.find(item => item.id === roleId)
    if (!role?.canManage || this.data.processingId) {
      return
    }
    this.setData({ processingId: role.id, message: '' })
    try {
      const modal = await wx.showModal({
        title: '撤销角色',
        content: `撤销后该账号立即失去${role.roleLabel}权限。`,
      })
      if (!modal.confirm) {
        return
      }
      await mipAdminModule.mutate(() => mipAdminModule.gateway.setRole({
        userId: role.userId,
        roleKey: role.roleKey,
        ...(role.scopeId ? { scopeId: role.scopeId } : {}),
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
