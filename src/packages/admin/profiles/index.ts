import type { AdminBranch, AdminGrowthLevel, AdminUser, AdminUserDetail } from '../../../modules/mip-admin'
import type { AdminPageState } from '../shared/page-state'
import { hasCapability, mipAdminModule } from '../../../modules/mip-admin'
import { formatLocalDateTime } from '../../../utils/date'
import { adminLoadFailure } from '../shared/page-state'

type AdminUserView = AdminUser & {
  controlText: string
  hasAllowlist: boolean
  hasBlocklist: boolean
  createdText: string
  statusText: string
  statusTheme: 'default' | 'success' | 'danger'
}

type AdminUserDetailView = AdminUserDetail & {
  statusText: string
  membershipText: string
  membershipEndsText: string
  relatedRecords: AdminUserDetail['relatedRecords'] & {
    orders: Array<AdminUserDetail['relatedRecords']['orders'][number] & { amountText: string }>
  }
}

const userStatusLabels: Record<AdminUser['status'], string> = {
  ACTIVE: '正常',
  BLOCKED: '已限制',
  CLOSED: '已关闭',
}

const userStatusThemes: Record<AdminUser['status'], AdminUserView['statusTheme']> = {
  ACTIVE: 'success',
  BLOCKED: 'danger',
  CLOSED: 'default',
}

const membershipStatusLabels: Record<string, string> = {
  PENDING: '待生效',
  ACTIVE: '有效',
  EXPIRED: '已过期',
  CANCELLED: '已取消',
  REVOKED: '已撤销',
}

function userView(item: AdminUser): AdminUserView {
  return {
    ...item,
    controlText: item.controls.join('、'),
    hasAllowlist: item.controls.includes('ALLOWLIST'),
    hasBlocklist: item.controls.includes('BLOCKLIST'),
    createdText: item.createdAt ? formatLocalDateTime(item.createdAt) : '未记录',
    statusText: userStatusLabels[item.status],
    statusTheme: userStatusThemes[item.status],
  }
}

function userDetailView(detail: AdminUserDetail): AdminUserDetailView {
  return {
    ...detail,
    statusText: userStatusLabels[detail.status],
    membershipText: detail.membership
      ? membershipStatusLabels[detail.membership.status] || '状态待确认'
      : '非会员',
    membershipEndsText: detail.membership?.endsAt ? formatLocalDateTime(detail.membership.endsAt) : '未设置',
    relatedRecords: {
      ...detail.relatedRecords,
      orders: detail.relatedRecords.orders.map(order => ({
        ...order,
        amountText: `${(order.amountCents / 100).toFixed(2)} 元`,
      })),
    },
  }
}

function dateBoundary(value: string, endOfDay: boolean) {
  const parts = value.split('-').map(Number)
  if (parts.length !== 3 || parts.some(part => !Number.isInteger(part))) {
    return ''
  }
  const date = new Date(
    parts[0],
    parts[1] - 1,
    parts[2],
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0,
  )
  return Number.isFinite(date.getTime()) ? date.toISOString() : ''
}

Page({
  data: {
    state: 'loading' as AdminPageState,
    users: [] as AdminUserView[],
    query: '',
    kind: '',
    status: '',
    controlType: '',
    phoneBound: '',
    profileComplete: '',
    joinedWithinDays: 0,
    branchId: '',
    branchLabel: '全部分会',
    branches: [] as AdminBranch[],
    levelId: '',
    levelLabel: '全部等级',
    levels: [] as AdminGrowthLevel[],
    experienceMin: '',
    experienceMax: '',
    createdFromDate: '',
    createdToDate: '',
    includePhone: false,
    canPhone: false,
    canEdit: false,
    canControl: false,
    canExport: false,
    canFilterBranches: false,
    processingId: '',
    exportPending: false,
    message: '',
    nextCursor: null as string | null,
    loadingMore: false,
    detailOpen: false,
    detailState: 'loading' as AdminPageState,
    detail: null as AdminUserDetailView | null,
    detailMessage: '',
  },
  requestSeq: 0,
  confirmationBusy: false,
  onShow() { void this.loadUsers() },
  onHide() {
    this.requestSeq += 1
    mipAdminModule.clearSensitive()
    this.setData({
      includePhone: false,
      detailOpen: false,
      detail: null,
      users: this.data.users.map(item => ({ ...item, phoneNumber: null })),
    })
  },
  onUnload() {
    this.requestSeq += 1
    mipAdminModule.clearSensitive()
  },
  updateQuery(event: WechatMiniprogram.CustomEvent<{ value: string }>) { this.setData({ query: event.detail.value }) },
  updateRangeFilter(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field = String(event.currentTarget.dataset.field || '')
    if (!['experienceMin', 'experienceMax'].includes(field)) {
      return
    }
    this.setData({ [field]: event.detail.value })
  },
  changeCreatedDate(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field = String(event.currentTarget.dataset.field || '')
    if (!['createdFromDate', 'createdToDate'].includes(field)) {
      return
    }
    this.setData({ [field]: event.detail.value })
  },
  clearCreatedDates() {
    this.setData({ createdFromDate: '', createdToDate: '' })
    void this.loadUsers(true)
  },
  chooseFilter(event: WechatMiniprogram.TouchEvent) {
    const field = String(event.currentTarget.dataset.field || '')
    if (!['kind', 'status', 'controlType', 'phoneBound', 'profileComplete', 'joinedWithinDays'].includes(field)) {
      return
    }
    this.setData({ [field]: field === 'joinedWithinDays'
      ? Number(event.currentTarget.dataset.value || 0)
      : String(event.currentTarget.dataset.value || '') })
    void this.loadUsers(true)
  },
  search() { void this.loadUsers(true) },
  async loadUsers(force = false) {
    const hasContent = this.data.users.length > 0
    if (!hasContent) {
      this.setData({ state: 'loading', message: '' })
    }
    const seq = this.requestSeq + 1
    this.requestSeq = seq
    try {
      const [session, response] = await Promise.all([
        mipAdminModule.getSession(force),
        mipAdminModule.users.list({
          includePhone: this.data.includePhone,
          filters: {
            query: this.data.query.trim(),
            kind: this.data.kind,
            status: this.data.status,
            controlType: this.data.controlType,
            phoneBound: this.data.phoneBound,
            profileComplete: this.data.profileComplete,
            joinedWithinDays: this.data.joinedWithinDays,
            branchId: this.data.branchId,
            levelId: this.data.levelId,
            experienceMin: this.data.experienceMin,
            experienceMax: this.data.experienceMax,
            createdFrom: this.data.createdFromDate ? dateBoundary(this.data.createdFromDate, false) : '',
            createdTo: this.data.createdToDate ? dateBoundary(this.data.createdToDate, true) : '',
          },
        }, force),
      ])
      if (seq !== this.requestSeq) {
        return
      }
      this.setData({
        state: 'ready',
        users: response.items.map(userView),
        canPhone: hasCapability(session.capabilities, 'users.phone.read'),
        canEdit: hasCapability(session.capabilities, 'users.fields.edit'),
        canControl: hasCapability(session.capabilities, 'users.access.manage'),
        canExport: hasCapability(session.capabilities, 'exports.create'),
        canFilterBranches: hasCapability(session.capabilities, 'branches.manage'),
        nextCursor: response.nextCursor || null,
        loadingMore: false,
        message: '',
      })
      if (hasCapability(session.capabilities, 'branches.manage') && !this.data.branches.length) {
        void this.loadBranches()
      }
      if (hasCapability(session.capabilities, 'growth.read') && !this.data.levels.length) {
        void this.loadGrowthLevels()
      }
    }
    catch (error) {
      if (seq !== this.requestSeq) {
        return
      }
      this.setData(adminLoadFailure(error, { hasContent, fallbackMessage: '用户列表加载失败' }))
    }
  },
  async loadMoreUsers() {
    if (!this.data.nextCursor || this.data.loadingMore || this.data.state !== 'ready') {
      return
    }
    this.setData({ loadingMore: true, message: '' })
    try {
      const response = await mipAdminModule.users.list({
        includePhone: this.data.includePhone,
        cursor: this.data.nextCursor,
        filters: {
          query: this.data.query.trim(),
          kind: this.data.kind,
          status: this.data.status,
          controlType: this.data.controlType,
          phoneBound: this.data.phoneBound,
          profileComplete: this.data.profileComplete,
          joinedWithinDays: this.data.joinedWithinDays,
          branchId: this.data.branchId,
          levelId: this.data.levelId,
          experienceMin: this.data.experienceMin,
          experienceMax: this.data.experienceMax,
          createdFrom: this.data.createdFromDate ? dateBoundary(this.data.createdFromDate, false) : '',
          createdTo: this.data.createdToDate ? dateBoundary(this.data.createdToDate, true) : '',
        },
      })
      const users = response.items.map(userView)
      this.setData({ users: this.data.users.concat(users), nextCursor: response.nextCursor || null })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '更多用户加载失败' })
    }
    finally {
      this.setData({ loadingMore: false })
    }
  },
  async loadBranches() {
    try {
      const response = await mipAdminModule.listBranches()
      this.setData({ branches: response.items })
    }
    catch {
      this.setData({ message: '分会筛选暂时无法加载。' })
    }
  },
  async loadGrowthLevels() {
    try {
      const response = await mipAdminModule.listGrowthLevels()
      this.setData({ levels: response.items })
    }
    catch {
      this.setData({ message: '等级筛选暂时无法加载。' })
    }
  },
  async chooseBranch() {
    if (!this.data.canFilterBranches || !this.data.branches.length) {
      return
    }
    try {
      const choices = ['全部分会', ...this.data.branches.map(branch => `${branch.name} · ${branch.cityName}`)]
      const result = await wx.showActionSheet({ itemList: choices })
      const branch = result.tapIndex > 0 ? this.data.branches[result.tapIndex - 1] : null
      this.setData({ branchId: branch?.id || '', branchLabel: branch?.name || '全部分会' })
      void this.loadUsers(true)
    }
    catch {
      // Closing the native selector leaves the current filter unchanged.
    }
  },
  async chooseLevel() {
    if (!this.data.levels.length) {
      return
    }
    try {
      const choices = ['全部等级', ...this.data.levels.map(level => `${level.name} · ${level.minimumExperience} 经验`)]
      const result = await wx.showActionSheet({ itemList: choices })
      const level = result.tapIndex > 0 ? this.data.levels[result.tapIndex - 1] : null
      this.setData({ levelId: level?.id || '', levelLabel: level?.name || '全部等级' })
      void this.loadUsers(true)
    }
    catch {
      // Closing the native selector leaves the current filter unchanged.
    }
  },
  onReachBottom() { void this.loadMoreUsers() },
  async openDetail(event: WechatMiniprogram.TouchEvent) {
    const userId = String(event.currentTarget.dataset.id || '')
    if (!userId) {
      return
    }
    this.setData({ detailOpen: true, detailState: 'loading', detail: null, detailMessage: '' })
    try {
      const detail = await mipAdminModule.users.get(userId, this.data.includePhone, true)
      if (!this.data.detailOpen) {
        return
      }
      this.setData({ detailState: 'ready', detail: userDetailView(detail) })
    }
    catch (error) {
      if (!this.data.detailOpen) {
        return
      }
      this.setData({
        detailState: 'error',
        detailMessage: error instanceof Error ? error.message : '用户详情加载失败',
      })
    }
  },
  closeDetail() {
    this.setData({ detailOpen: false, detail: null, detailMessage: '' })
    mipAdminModule.clearSensitive()
  },
  openRelatedOpportunity(event: WechatMiniprogram.TouchEvent) {
    void wx.navigateTo({ url: `/packages/admin/opportunity-detail/index?id=${String(event.currentTarget.dataset.id || '')}` })
  },
  openRelatedCase(event: WechatMiniprogram.TouchEvent) {
    void wx.navigateTo({ url: `/packages/member/mip-cases/detail/index?id=${String(event.currentTarget.dataset.id || '')}` })
  },
  openRelatedRegistration(event: WechatMiniprogram.TouchEvent) {
    void wx.navigateTo({ url: `/packages/admin/event-registrations/index?eventId=${String(event.currentTarget.dataset.id || '')}` })
  },
  openOrders() { void wx.navigateTo({ url: '/packages/admin/orders/index' }) },
  handleDetailVisibility(event: WechatMiniprogram.CustomEvent<{ visible?: boolean }>) {
    if (!event.detail.visible) {
      this.closeDetail()
    }
  },
  async showPhones() {
    if (!this.data.canPhone || this.data.processingId || this.data.exportPending || this.confirmationBusy) {
      return
    }
    this.confirmationBusy = true
    try {
      const modal = await wx.showModal({
        title: '查看手机号原文',
        content: '手机号仅用于已授权的会员服务和运营联系。',
      })
      if (!modal.confirm) {
        return
      }
      this.setData({ includePhone: true })
      await this.loadUsers(true)
      if (this.data.detailOpen && this.data.detail?.id) {
        this.setData({ detail: userDetailView(await mipAdminModule.users.get(this.data.detail.id, true, true)) })
      }
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '手机号加载失败' })
    }
    finally {
      this.confirmationBusy = false
    }
  },
  async editField(event: WechatMiniprogram.TouchEvent) {
    const userId = String(event.currentTarget.dataset.id || '')
    const version = Number(event.currentTarget.dataset.version)
    const field = String(event.currentTarget.dataset.field || '')
    const fieldLabels: Record<string, string> = {
      nickname: '昵称',
      headline: '资料标题',
      introduction: '个人介绍',
    }
    if (!userId || !fieldLabels[field] || !this.data.canEdit || this.data.processingId) {
      return
    }
    this.setData({ processingId: userId, message: '' })
    try {
      const modal = await wx.showModal({
        title: `编辑${fieldLabels[field]}`,
        editable: true,
        placeholderText: `输入${fieldLabels[field]}`,
      })
      if (!modal.confirm) {
        return
      }
      await mipAdminModule.users.update({
        userId,
        expectedVersion: version,
        fields: { [field]: modal.content },
      })
      wx.showToast({ title: '资料已更新', icon: 'success' })
      await this.loadUsers(true)
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '资料更新失败' })
    }
    finally {
      this.setData({ processingId: '' })
    }
  },
  async setControl(event: WechatMiniprogram.TouchEvent) {
    const userId = String(event.currentTarget.dataset.id || '')
    const controlType = String(event.currentTarget.dataset.type || '')
    const active = event.currentTarget.dataset.active === true || event.currentTarget.dataset.active === 'true'
    if (!userId || !this.data.canControl || this.data.processingId) {
      return
    }
    this.setData({ processingId: userId, message: '' })
    try {
      const modal = await wx.showModal({ title: active ? '设置名单' : '撤销名单', editable: true, placeholderText: '填写操作原因' })
      if (!modal.confirm || !modal.content.trim()) {
        return
      }
      await mipAdminModule.users.setControl({ userId, controlType, active, reason: modal.content })
      wx.showToast({ title: '名单状态已更新', icon: 'success' })
      await this.loadUsers(true)
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '名单状态更新失败' })
    }
    finally {
      this.setData({ processingId: '' })
    }
  },
  async createExport() {
    if (!this.data.canExport || this.data.exportPending || this.data.processingId || this.confirmationBusy) {
      return
    }
    this.confirmationBusy = true
    this.setData({ exportPending: true, message: '' })
    try {
      const modal = await wx.showModal({
        title: '创建用户导出',
        content: '导出文件仅用于已授权的运营工作，有效期较短。',
      })
      if (!modal.confirm) {
        return
      }
      const result = await mipAdminModule.exportAndOpen({
        exportType: 'USERS',
        includesPhone: this.data.includePhone,
        filters: {
          query: this.data.query,
          kind: this.data.kind,
          status: this.data.status,
          controlType: this.data.controlType,
          phoneBound: this.data.phoneBound,
          profileComplete: this.data.profileComplete,
          joinedWithinDays: this.data.joinedWithinDays,
          branchId: this.data.branchId,
          levelId: this.data.levelId,
          experienceMin: this.data.experienceMin,
          experienceMax: this.data.experienceMax,
          createdFrom: this.data.createdFromDate ? dateBoundary(this.data.createdFromDate, false) : '',
          createdTo: this.data.createdToDate ? dateBoundary(this.data.createdToDate, true) : '',
        },
      })
      wx.showToast({ title: `已导出 ${result.rowCount} 条`, icon: 'success' })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '导出任务创建失败' })
    }
    finally {
      this.confirmationBusy = false
      this.setData({ exportPending: false })
    }
  },
})
