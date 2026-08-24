import type { AdminGrowthEntry, AdminUser } from '../../../modules/mip-admin'
import type { AdminPageState } from '../shared/page-state'
import { hasCapability, mipAdminModule } from '../../../modules/mip-admin'
import { formatLocalDateTime } from '../../../utils/date'
import { adminLoadFailure } from '../shared/page-state'

type GrowthEntryView = AdminGrowthEntry & { createdText: string, sourceLabel: string }

const sourceOptions = [
  { label: '全部来源', value: '' },
  { label: '完善资料', value: 'identity.profile_completed' },
  { label: '完成活动签到', value: 'event.checked_in' },
  { label: '撤销活动签到', value: 'event.checkin_revoked' },
  { label: '确认有效引荐', value: 'referral.confirmed' },
  { label: '发布超级案例', value: 'super_case.published' },
  { label: '人工调整', value: 'ADMIN_ADJUSTMENT' },
]

function sourceLabel(value: string) {
  return sourceOptions.find(option => option.value === value)?.label || '其他业务记录'
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

function entryFilters(data: {
  selectedUserId: string
  metric: string
  sourceEventType: string
  createdFromDate: string
  createdToDate: string
}) {
  return {
    userId: data.selectedUserId,
    metric: data.metric || '',
    sourceEventType: data.sourceEventType.trim(),
    createdFrom: data.createdFromDate ? dateBoundary(data.createdFromDate, false) : '',
    createdTo: data.createdToDate ? dateBoundary(data.createdToDate, true) : '',
  }
}

function entryView(item: AdminGrowthEntry): GrowthEntryView {
  return {
    ...item,
    createdText: item.createdAt ? formatLocalDateTime(item.createdAt) : '—',
    sourceLabel: sourceLabel(item.sourceEventType),
  }
}

Page({
  data: {
    state: 'loading' as AdminPageState,
    entries: [] as GrowthEntryView[],
    candidates: [] as AdminUser[],
    query: '',
    selectedUserId: '',
    selectedUserName: '',
    metric: 'EXPERIENCE',
    sourceEventType: '',
    sourceIndex: 0,
    sourceOptions,
    createdFromDate: '',
    createdToDate: '',
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
        mipAdminModule.listGrowthEntries({ filters: entryFilters(this.data) }, force),
      ])
      this.setData({ state: 'ready', entries: response.items.map(entryView), canAdjust: hasCapability(session.capabilities, 'growth.adjust'), canExport: hasCapability(session.capabilities, 'exports.create'), nextCursor: response.nextCursor || null, loadingMore: false, message: '' })
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
        filters: entryFilters(this.data),
      })
      this.setData({ entries: this.data.entries.concat(response.items.map(entryView)), nextCursor: response.nextCursor || null })
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
  changeSource(event: WechatMiniprogram.CustomEvent<{ value: string | number }>) {
    const sourceIndex = Number(event.detail.value)
    const option = this.data.sourceOptions[sourceIndex]
    if (option) {
      this.setData({ sourceIndex, sourceEventType: option.value })
      void this.loadEntries(true)
    }
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
    void this.loadEntries(true)
  },
  applyFilters() { void this.loadEntries(true) },
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
      const result = await mipAdminModule.mutate(() => mipAdminModule.exportAndOpen({ exportType: 'GROWTH_ENTRIES', includesPhone: false, filters: entryFilters(this.data) }))
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
