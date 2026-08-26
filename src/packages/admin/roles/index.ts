import type {
  AdminBranch,
  AdminCapability,
  AdminCapabilityGrant,
  AdminEvent,
  AdminRoleBinding,
  AdminRoleCandidate,
  AdminRoleCapabilityPolicy,
  AdminRoleItem,
  AdminRoleKey,
} from '../../../modules/mip-admin'
import type { AdminPageState } from '../shared/page-state'
import {
  canDelegateAdminRole,
  hasCapability,
  hasScopedCapability,
  MipAdminError,
  mipAdminModule,
  scopeTypeForAdminRole,
} from '../../../modules/mip-admin'
import { adminLoadFailure } from '../shared/page-state'
import {
  clearPolicyCapabilitySelection,
  hasSelectedPolicyCapability,
  replacePolicyCapabilitySelection,
  selectedPolicyCapabilities,
  togglePolicyCapabilitySelection,
} from './private-policy-selection'

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

type ConfigurableRoleKey = Exclude<AdminRoleKey, 'PLATFORM_OWNER'>

const policyRoleOrder: ConfigurableRoleKey[] = [
  'PLATFORM_OPERATIONS',
  'PLATFORM_FINANCE',
  'BRANCH_ADMIN',
  'EVENT_OWNER',
  'EVENT_MANAGER',
  'EVENT_STAFF',
]

const capabilityLabels: Record<AdminCapability, string> = {
  'admin.dashboard': '进入运营工作台',
  'branches.manage': '城市分会管理',
  'users.read': '用户资料查看',
  'users.phone.read': '用户手机号查看',
  'users.fields.edit': '用户资料编辑',
  'users.access.manage': '用户访问控制',
  'memberships.read': '会员记录查看',
  'memberships.adjust': '会员人工开通',
  'exports.create': '数据导出',
  'events.read': '活动查看',
  'events.write': '活动编辑',
  'events.roster.read': '活动名单查看',
  'events.registrations.manage': '活动报名审核',
  'events.checkin.manage': '活动签到',
  'events.checkin.undo': '撤销签到',
  'events.team.manage': '活动团队查看',
  'events.album.manage': '活动相册审核',
  'events.feedback.read': '活动反馈查看',
  'events.comments.manage': '活动评论管理',
  'events.catalog.manage': '活动目录管理',
  'events.recaps.manage': '视频回顾管理',
  'announcements.manage': '公告管理',
  'messages.manage': '消息管理',
  'messages.delivery.review': '消息投递复核',
  'communications.publish': '活动提醒发布',
  'community.reports.manage': '举报审核',
  'opportunities.moderate': '机会管理',
  'opportunities.archive': '机会归档',
  'growth.read': '成长数据查看',
  'growth.configure': '成长规则配置',
  'growth.adjust': '成长值调整',
  'tasks.manage': '任务管理',
  'banners.manage': 'Banner 管理',
  'badges.manage': '勋章管理',
  'game.manage': '赛季与队伍管理',
  'knowledge.manage': '知识内容管理',
  'orders.read': '订单查看',
  'refunds.submit': '退款提交',
  'operations.exceptions.read': '异常中心查看',
  'roles.change': '角色设置',
  'audit.read': '审计记录查看',
}

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
interface PolicyCapabilityView {
  key: AdminCapability
  label: string
  enabled: boolean
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
    canConfigurePolicies: false,
    policyLoading: false,
    policySaving: false,
    policyMessage: '',
    policyRoles: [] as Array<{ key: ConfigurableRoleKey, label: string }>,
    selectedPolicyRole: 'PLATFORM_OPERATIONS' as ConfigurableRoleKey,
    selectedPolicyRoleLabel: roleLabels.PLATFORM_OPERATIONS,
    policyCapabilities: [] as PolicyCapabilityView[],
    policyVersion: 0,
    policyIsCustom: false,
    policySourceLabel: '默认模板',
    processingId: '',
    message: '',
  },
  actorRoles: [] as AdminRoleBinding[],
  actorCapabilities: [] as AdminCapabilityGrant[],
  branchCatalog: [] as BranchOption[],
  eventCatalog: [] as EventOption[],
  availableRoleKeys: [] as AdminRoleKey[],
  policyCatalog: [] as AdminRoleCapabilityPolicy[],

  onShow() { void this.loadRoles() },

  onUnload() {
    clearPolicyCapabilitySelection(this)
  },

  async loadEventCatalog(force: boolean) {
    const items: AdminEvent[] = []
    let cursor: string | null = null
    for (let page = 0; page < 10; page += 1) {
      const response = await mipAdminModule.events.list({ limit: 50, ...(cursor ? { cursor } : {}) }, force)
      items.push(...response.items)
      cursor = response.nextCursor || null
      if (!cursor) {
        break
      }
    }
    return items.map(item => ({ id: item.id, title: item.title, branchId: item.branchId }))
  },

  canGrantRole(roleKey: AdminRoleKey, scope: Scope) {
    return hasScopedCapability(this.actorCapabilities, 'roles.change', scope)
      && canDelegateAdminRole(this.actorRoles, roleKey, scope)
  },

  roleCanBeGranted(roleKey: AdminRoleKey) {
    const scopeType = scopeTypeForRole(roleKey)
    if (scopeType === 'PLATFORM') {
      return this.canGrantRole(roleKey, { scopeType, scopeId: null, branchId: null })
    }
    if (scopeType === 'BRANCH') {
      return this.branchCatalog.some(item => this.canGrantRole(roleKey, {
        scopeType,
        scopeId: item.id,
        branchId: item.id,
      }))
    }
    return this.eventCatalog.some(item => this.canGrantRole(roleKey, {
      scopeType,
      scopeId: item.id,
      branchId: item.branchId,
    }))
  },

  applyRoleSelection(roleKey: AdminRoleKey) {
    const scopeType = scopeTypeForRole(roleKey)
    const branches = scopeType === 'BRANCH'
      ? this.branchCatalog.filter(item => this.canGrantRole(roleKey, {
          scopeType,
          scopeId: item.id,
          branchId: item.id,
        }))
      : []
    const events = scopeType === 'EVENT'
      ? this.eventCatalog.filter(item => this.canGrantRole(roleKey, {
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

  applyPolicySelection(roleKey: ConfigurableRoleKey) {
    const policy = this.policyCatalog.find(item => item.roleKey === roleKey)
    if (!policy) {
      return
    }
    replacePolicyCapabilitySelection(this, policy.capabilities)
    this.setData({
      selectedPolicyRole: roleKey,
      selectedPolicyRoleLabel: roleLabels[roleKey],
      policyCapabilities: policy.allowedCapabilities.map(capability => ({
        key: capability,
        label: capabilityLabels[capability],
        enabled: hasSelectedPolicyCapability(this, capability),
      })),
      policyVersion: policy.version,
      policyIsCustom: policy.source === 'CUSTOM',
      policySourceLabel: policy.source === 'DEFAULT' ? '默认模板' : '已配置',
      policyMessage: '',
    })
  },

  async loadRoles(force = false) {
    const hasContent = this.data.roles.length > 0
    if (!hasContent) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const session = await mipAdminModule.governance.getSession(force)
      const canConfigurePolicies = session.roles.some(role => role.roleKey === 'PLATFORM_OWNER'
        && role.scopeType === 'PLATFORM')
      const [response, events, branchResponse, policyResponse] = await Promise.all([
        mipAdminModule.governance.listRoles(force),
        this.loadEventCatalog(force),
        hasCapability(session.capabilities, 'branches.manage')
          ? mipAdminModule.governance.listBranches(force)
          : Promise.resolve({ items: [] as AdminBranch[], nextCursor: null }),
        canConfigurePolicies
          ? mipAdminModule.governance.listRoleCapabilityPolicies(force)
          : Promise.resolve({ items: [] as AdminRoleCapabilityPolicy[], nextCursor: null }),
      ])
      this.actorRoles = session.roles
      this.actorCapabilities = session.capabilities
      this.branchCatalog = branchResponse.items
        .filter(item => item.status === 'ACTIVE')
        .map(item => ({ id: item.id, name: item.name }))
      this.eventCatalog = events
      this.policyCatalog = policyResponse.items
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
          canManage: item.status === 'ACTIVE' && this.canGrantRole(item.roleKey, {
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
        canConfigurePolicies,
        policyRoles: canConfigurePolicies
          ? policyRoleOrder.map(key => ({ key, label: roleLabels[key] }))
          : [],
        policyLoading: false,
        message: '',
      })
      this.applyRoleSelection(selectedRole)
      if (canConfigurePolicies) {
        const selectedPolicyRole = this.policyCatalog.some(item => item.roleKey === this.data.selectedPolicyRole)
          ? this.data.selectedPolicyRole
          : this.policyCatalog[0]?.roleKey
        if (selectedPolicyRole) {
          this.applyPolicySelection(selectedPolicyRole)
        }
      }
      else {
        clearPolicyCapabilitySelection(this)
      }
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

  choosePolicyRole(event: WechatMiniprogram.TouchEvent) {
    const roleKey = String(event.currentTarget.dataset.role || '') as ConfigurableRoleKey
    if (policyRoleOrder.includes(roleKey)) {
      this.applyPolicySelection(roleKey)
    }
  },

  togglePolicyCapability(event: WechatMiniprogram.TouchEvent) {
    if (this.data.policySaving) {
      return
    }
    const capability = String(event.currentTarget.dataset.capability || '') as AdminCapability
    const policy = this.policyCatalog.find(item => item.roleKey === this.data.selectedPolicyRole)
    if (!policy?.allowedCapabilities.includes(capability)) {
      return
    }
    togglePolicyCapabilitySelection(this, capability)
    this.setData({
      policyCapabilities: policy.allowedCapabilities.map(item => ({
        key: item,
        label: capabilityLabels[item],
        enabled: hasSelectedPolicyCapability(this, item),
      })),
      policyMessage: '',
    })
  },

  async resetPolicyCapabilities() {
    const policy = this.policyCatalog.find(item => item.roleKey === this.data.selectedPolicyRole)
    if (!policy || policy.source !== 'CUSTOM' || !this.data.canConfigurePolicies || this.data.policySaving) {
      return
    }
    this.setData({ policySaving: true, policyMessage: '' })
    try {
      const modal = await wx.showModal({
        title: '恢复默认权限',
        content: `确认将${roleLabels[policy.roleKey]}恢复为默认权限。`,
      })
      if (!modal.confirm) {
        return
      }
      await mipAdminModule.governance.resetRoleCapabilityPolicy({
        roleKey: policy.roleKey,
        expectedVersion: policy.version,
      })
      wx.showToast({ title: '已恢复默认权限', icon: 'success' })
      await this.loadRoles(true)
    }
    catch (error) {
      if (error instanceof MipAdminError && error.code === 'CONFLICT') {
        await this.loadRoles(true)
        this.setData({ policyMessage: '权限配置已更新，请确认最新内容后重试。' })
      }
      else {
        this.setData({ policyMessage: error instanceof Error ? error.message : '恢复默认权限失败' })
      }
    }
    finally {
      this.setData({ policySaving: false })
    }
  },

  async savePolicy() {
    const policy = this.policyCatalog.find(item => item.roleKey === this.data.selectedPolicyRole)
    if (!policy || !this.data.canConfigurePolicies || this.data.policySaving) {
      return
    }
    this.setData({ policySaving: true, policyMessage: '' })
    try {
      await mipAdminModule.governance.updateRoleCapabilityPolicy({
        roleKey: policy.roleKey,
        capabilities: selectedPolicyCapabilities(this, policy.allowedCapabilities),
        expectedVersion: policy.version,
      })
      wx.showToast({ title: '权限已保存', icon: 'success' })
      await this.loadRoles(true)
    }
    catch (error) {
      if (error instanceof MipAdminError && error.code === 'CONFLICT') {
        await this.loadRoles(true)
        this.setData({ policyMessage: '权限配置已更新，请确认最新内容后重试。' })
      }
      else {
        this.setData({ policyMessage: error instanceof Error ? error.message : '权限保存失败' })
      }
    }
    finally {
      this.setData({ policySaving: false })
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
        ? await mipAdminModule.governance.searchRoleCandidates(this.data.scopeId, query)
        : await mipAdminModule.users.list({ includePhone: false, filters: { query } }, true)
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
    if (!this.canGrantRole(this.data.selectedRole, scope)) {
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
      await mipAdminModule.governance.setRole({
        userId: this.data.selectedUserId,
        roleKey: this.data.selectedRole,
        ...(scope.scopeId ? { scopeId: scope.scopeId } : {}),
        active: true,
      })
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
      await mipAdminModule.governance.setRole({
        userId: role.userId,
        roleKey: role.roleKey,
        ...(role.scopeId ? { scopeId: role.scopeId } : {}),
        active: false,
      })
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
