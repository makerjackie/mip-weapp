import type { AdminUser } from '../../../modules/mip-admin'
import type { AdminPageState } from '../shared/page-state'
import { hasCapability, mipAdminModule } from '../../../modules/mip-admin'
import { adminLoadFailure } from '../shared/page-state'

type AdminUserView = AdminUser & {
  controlText: string
  hasAllowlist: boolean
  hasBlocklist: boolean
}

Page({
  data: {
    state: 'loading' as AdminPageState,
    users: [] as AdminUserView[],
    query: '',
    kind: '',
    status: '',
    controlType: '',
    includePhone: false,
    canPhone: false,
    canEdit: false,
    canControl: false,
    canExport: false,
    processingId: '',
    exportPending: false,
    message: '',
    nextCursor: null as string | null,
    loadingMore: false,
  },
  requestSeq: 0,
  confirmationBusy: false,
  onShow() { void this.loadUsers() },
  onHide() {
    this.requestSeq += 1
    mipAdminModule.clearSensitive()
    this.setData({
      includePhone: false,
      users: this.data.users.map(item => ({ ...item, phoneNumber: null })),
    })
  },
  onUnload() {
    this.requestSeq += 1
    mipAdminModule.clearSensitive()
  },
  updateQuery(event: WechatMiniprogram.CustomEvent<{ value: string }>) { this.setData({ query: event.detail.value }) },
  chooseFilter(event: WechatMiniprogram.TouchEvent) {
    const field = String(event.currentTarget.dataset.field || '')
    if (!['kind', 'status', 'controlType'].includes(field)) {
      return
    }
    this.setData({ [field]: String(event.currentTarget.dataset.value || '') })
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
        mipAdminModule.listUsers({
          includePhone: this.data.includePhone,
          filters: { query: this.data.query.trim(), kind: this.data.kind, status: this.data.status, controlType: this.data.controlType },
        }, force),
      ])
      if (seq !== this.requestSeq) {
        return
      }
      this.setData({
        state: 'ready',
        users: response.items.map(item => ({
          ...item,
          controlText: item.controls.join('、'),
          hasAllowlist: item.controls.includes('ALLOWLIST'),
          hasBlocklist: item.controls.includes('BLOCKLIST'),
        })),
        canPhone: hasCapability(session.capabilities, 'users.phone.read'),
        canEdit: hasCapability(session.capabilities, 'users.fields.edit'),
        canControl: hasCapability(session.capabilities, 'users.access.manage'),
        canExport: hasCapability(session.capabilities, 'exports.create'),
        nextCursor: response.nextCursor || null,
        loadingMore: false,
        message: '',
      })
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
      const response = await mipAdminModule.listUsers({
        includePhone: this.data.includePhone,
        cursor: this.data.nextCursor,
        filters: { query: this.data.query.trim(), kind: this.data.kind, status: this.data.status, controlType: this.data.controlType },
      })
      const users = response.items.map(item => ({
        ...item,
        controlText: item.controls.join('、'),
        hasAllowlist: item.controls.includes('ALLOWLIST'),
        hasBlocklist: item.controls.includes('BLOCKLIST'),
      }))
      this.setData({ users: this.data.users.concat(users), nextCursor: response.nextCursor || null })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '更多用户加载失败' })
    }
    finally {
      this.setData({ loadingMore: false })
    }
  },
  onReachBottom() { void this.loadMoreUsers() },
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
      await mipAdminModule.mutate(() => mipAdminModule.gateway.updateUser({
        userId,
        expectedVersion: version,
        fields: { [field]: modal.content },
      }))
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
      await mipAdminModule.mutate(() => mipAdminModule.gateway.setUserControl({ userId, controlType, active, reason: modal.content }))
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
      const result = await mipAdminModule.mutate(() => mipAdminModule.exportAndOpen({
        exportType: 'USERS',
        includesPhone: this.data.includePhone,
        filters: { query: this.data.query, kind: this.data.kind, controlType: this.data.controlType },
      }))
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
