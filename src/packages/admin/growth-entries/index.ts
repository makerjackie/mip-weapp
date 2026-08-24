import type { AdminGrowthEntry, AdminUser } from '../../../modules/mip-admin'
import type { AdminPageState } from '../shared/page-state'
import { hasCapability, mipAdminModule } from '../../../modules/mip-admin'
import { adminLoadFailure } from '../shared/page-state'

Page({
  data: {
    state: 'loading' as AdminPageState,
    entries: [] as AdminGrowthEntry[],
    candidates: [] as AdminUser[],
    query: '',
    selectedUserId: '',
    selectedUserName: '',
    metric: 'EXPERIENCE',
    deltaValue: '',
    reason: '',
    canAdjust: false,
    canExport: false,
    processing: false,
    exportPending: false,
    message: '',
    nextCursor: null as string | null,
    loadingMore: false,
  },
  onShow() { void this.loadEntries() },
  async loadEntries(force = false) {
    const hasContent = this.data.entries.length > 0
    if (!hasContent) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const [session, response] = await Promise.all([
        mipAdminModule.getSession(force),
        mipAdminModule.listGrowthEntries({ filters: { userId: this.data.selectedUserId, metric: this.data.metric || '' } }, force),
      ])
      this.setData({ state: 'ready', entries: response.items, canAdjust: hasCapability(session.capabilities, 'growth.adjust'), canExport: hasCapability(session.capabilities, 'exports.create'), nextCursor: response.nextCursor || null, loadingMore: false, message: '' })
    }
    catch (error) {
      this.setData(adminLoadFailure(error, { hasContent, fallbackMessage: '成长流水加载失败' }))
    }
  },
  async loadMoreEntries() {
    if (!this.data.nextCursor || this.data.loadingMore || this.data.state !== 'ready') {
      return
    }
    this.setData({ loadingMore: true, message: '' })
    try {
      const response = await mipAdminModule.listGrowthEntries({
        cursor: this.data.nextCursor,
        filters: { userId: this.data.selectedUserId, metric: this.data.metric || '' },
      })
      this.setData({ entries: this.data.entries.concat(response.items), nextCursor: response.nextCursor || null })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '更多成长流水加载失败' })
    }
    finally {
      this.setData({ loadingMore: false })
    }
  },
  onReachBottom() { void this.loadMoreEntries() },
  updateQuery(event: WechatMiniprogram.CustomEvent<{ value: string }>) { this.setData({ query: event.detail.value }) },
  updateDelta(event: WechatMiniprogram.CustomEvent<{ value: string }>) { this.setData({ deltaValue: event.detail.value }) },
  updateReason(event: WechatMiniprogram.CustomEvent<{ value: string }>) { this.setData({ reason: event.detail.value }) },
  chooseMetric(event: WechatMiniprogram.TouchEvent) {
    this.setData({ metric: String(event.currentTarget.dataset.value || 'EXPERIENCE') })
    void this.loadEntries(true)
  },
  async searchUsers() {
    const query = this.data.query.trim()
    if (!query) {
      this.setData({ candidates: [] })
      return
    }
    try {
      const response = await mipAdminModule.listUsers({ includePhone: false, filters: { query } }, true)
      this.setData({ candidates: response.items })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '用户搜索失败' })
    }
  },
  chooseUser(event: WechatMiniprogram.TouchEvent) {
    this.setData({ selectedUserId: String(event.currentTarget.dataset.id || ''), selectedUserName: String(event.currentTarget.dataset.name || ''), candidates: [] })
    void this.loadEntries(true)
  },
  async adjust() {
    if (!this.data.canAdjust || !this.data.selectedUserId || this.data.processing) {
      return
    }
    this.setData({ processing: true, message: '' })
    try {
      const modal = await wx.showModal({ title: '确认人工调整', content: '人工调整会生成不可变成长流水和审计记录。' })
      if (!modal.confirm) {
        return
      }
      await mipAdminModule.mutate(() => mipAdminModule.gateway.adjustGrowth({
        userId: this.data.selectedUserId,
        metric: this.data.metric,
        deltaValue: Number(this.data.deltaValue),
        reason: this.data.reason,
        idempotencyKey: `admin-growth-${this.data.selectedUserId}-${Date.now()}`,
      }))
      wx.showToast({ title: '成长值已调整', icon: 'success' })
      this.setData({ deltaValue: '', reason: '' })
      await this.loadEntries(true)
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '成长值调整失败' })
    }
    finally {
      this.setData({ processing: false })
    }
  },
  async createExport() {
    if (!this.data.canExport || this.data.exportPending || this.data.processing) {
      return
    }
    this.setData({ exportPending: true, message: '' })
    try {
      const result = await mipAdminModule.mutate(() => mipAdminModule.exportAndOpen({ exportType: 'GROWTH_ENTRIES', includesPhone: false, filters: { userId: this.data.selectedUserId, metric: this.data.metric } }))
      wx.showToast({ title: `已导出 ${result.rowCount} 条`, icon: 'success' })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '导出任务创建失败' })
    }
    finally {
      this.setData({ exportPending: false })
    }
  },
})
