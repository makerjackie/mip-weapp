import type { AdminOpportunity } from '../../../modules/mip-admin'
import type { AdminPageState } from '../shared/page-state'
import { hasCapability, mipAdminModule } from '../../../modules/mip-admin'
import { formatLocalDateTime } from '../../../utils/date'
import { adminLoadFailure } from '../shared/page-state'
import { opportunityActionFailure } from './action-state'

type AdminOpportunityView = AdminOpportunity & {
  statusText: string
  roleText: string
  tagText: string
  publishedText: string
  updatedText: string
  moderatedText: string
  archivedText: string
  deadlineText: string
  statusTheme: 'default' | 'primary' | 'success' | 'warning' | 'danger'
  safetyText: string
}

const statusThemes: Record<AdminOpportunity['status'], AdminOpportunityView['statusTheme']> = {
  DRAFT: 'default',
  PUBLISHED: 'success',
  ENDED: 'warning',
  UNPUBLISHED: 'danger',
  ARCHIVED: 'default',
}

const safetyLabels: Record<AdminOpportunity['contentSafetyStatus'], string> = {
  PENDING: '待检查',
  APPROVED: '已通过',
  REJECTED: '未通过',
  ERROR: '待重试',
}

const statusLabels: Record<AdminOpportunity['status'], string> = {
  DRAFT: '草稿',
  PUBLISHED: '招募中',
  ENDED: '已结束',
  UNPUBLISHED: '已下架',
  ARCHIVED: '已归档',
}

const roleLabels: Record<string, string> = {
  connector: '皮条客',
  business_builder: '生意佬',
  capital_operator: '暴发户',
  strategist: '狗策划',
  visual_designer: '死美工',
  delivery_lead: '老保姆',
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

function filters(data: {
  query: string
  ownerQuery: string
  cityQuery: string
  status: string
  updatedFromDate: string
  updatedToDate: string
  deadlineFromDate: string
  deadlineToDate: string
  locationTypes?: string[]
  minAmountYuan: string
  maxAmountYuan: string
}) {
  const { minAmountCents, maxAmountCents } = amountRange(data.minAmountYuan, data.maxAmountYuan)
  return {
    query: data.query.trim(),
    ownerQuery: data.ownerQuery.trim(),
    cityQuery: data.cityQuery.trim(),
    status: data.status,
    updatedFrom: data.updatedFromDate ? dateBoundary(data.updatedFromDate, false) : '',
    updatedTo: data.updatedToDate ? dateBoundary(data.updatedToDate, true) : '',
    deadlineFrom: data.deadlineFromDate ? dateBoundary(data.deadlineFromDate, false) : '',
    deadlineTo: data.deadlineToDate ? dateBoundary(data.deadlineToDate, true) : '',
    locationTypes: data.locationTypes || [],
    ...(minAmountCents === undefined ? {} : { minAmountCents }),
    ...(maxAmountCents === undefined ? {} : { maxAmountCents }),
  }
}

function amountRange(minimum: string, maximum: string) {
  const toCents = (value: string) => {
    if (!value.trim()) return undefined
    const yuan = Number(value)
    const cents = Math.round(yuan * 100)
    if (!Number.isFinite(yuan) || yuan < 0 || !Number.isSafeInteger(cents)) {
      throw new Error('请填写有效的金额区间。')
    }
    return cents
  }
  const minAmountCents = toCents(minimum)
  const maxAmountCents = toCents(maximum)
  if (minAmountCents !== undefined && maxAmountCents !== undefined && minAmountCents > maxAmountCents) {
    throw new Error('最低金额不能大于最高金额。')
  }
  return { minAmountCents, maxAmountCents }
}

function opportunityView(item: AdminOpportunity): AdminOpportunityView {
  return {
    ...item,
    statusText: statusLabels[item.status],
    roleText: item.roleKeys.map(role => roleLabels[role] || role).join('、'),
    tagText: item.tags.join('、'),
    publishedText: item.publishedAt ? formatLocalDateTime(item.publishedAt) : '',
    updatedText: item.updatedAt ? formatLocalDateTime(item.updatedAt) : '',
    moderatedText: item.moderatedAt ? formatLocalDateTime(item.moderatedAt) : '',
    archivedText: item.archivedAt ? formatLocalDateTime(item.archivedAt) : '',
    deadlineText: item.deadlineAt ? formatLocalDateTime(item.deadlineAt) : '',
    statusTheme: statusThemes[item.status],
    safetyText: safetyLabels[item.contentSafetyStatus],
  }
}

Page({
  data: {
    state: 'loading' as AdminPageState,
    opportunities: [] as AdminOpportunityView[],
    query: '',
    ownerQuery: '',
    cityQuery: '',
    status: '',
    updatedFromDate: '',
    updatedToDate: '',
    deadlineFromDate: '',
    deadlineToDate: '',
    locationTypes: [] as string[],
    minAmountYuan: '',
    maxAmountYuan: '',
    canArchive: false,
    processingId: '',
    expandedId: '',
    message: '',
    nextCursor: null as string | null,
    loadingMore: false,
  },
  onShow() { void this.loadOpportunities() },
  updateQuery(event: WechatMiniprogram.CustomEvent<{ value: string }>) { this.setData({ query: event.detail.value }) },
  updateFilter(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field = String(event.currentTarget.dataset.field || '')
    if (['ownerQuery', 'cityQuery', 'minAmountYuan', 'maxAmountYuan'].includes(field)) {
      this.setData({ [field]: event.detail.value })
    }
  },
  changeUpdatedDate(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field = String(event.currentTarget.dataset.field || '')
    if (!['updatedFromDate', 'updatedToDate', 'deadlineFromDate', 'deadlineToDate'].includes(field)) {
      return
    }
    this.setData({ [field]: event.detail.value, opportunities: [], nextCursor: null })
    void this.loadOpportunities(true)
  },
  clearUpdatedDates() {
    this.setData({ updatedFromDate: '', updatedToDate: '', opportunities: [], nextCursor: null })
    void this.loadOpportunities(true)
  },
  clearDeadlineDates() {
    this.setData({ deadlineFromDate: '', deadlineToDate: '', opportunities: [], nextCursor: null })
    void this.loadOpportunities(true)
  },
  chooseStatus(event: WechatMiniprogram.TouchEvent) {
    this.setData({ status: String(event.currentTarget.dataset.value || '') })
    void this.loadOpportunities(true)
  },
  toggleLocationType(event: WechatMiniprogram.TouchEvent) {
    const type = String(event.currentTarget.dataset.type || '')
    if (!['NATIONAL', 'REMOTE', 'CITY'].includes(type)) return
    const selected = new Set(this.data.locationTypes)
    if (selected.has(type)) selected.delete(type)
    else selected.add(type)
    this.setData({ locationTypes: [...selected], opportunities: [], nextCursor: null })
    void this.loadOpportunities(true)
  },
  search() {
    try {
      amountRange(this.data.minAmountYuan, this.data.maxAmountYuan)
      void this.loadOpportunities(true)
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '金额区间无效' })
    }
  },
  createOpportunity() { void wx.navigateTo({ url: '/packages/admin/opportunity-editor/index' }) },
  editOpportunity(event: WechatMiniprogram.TouchEvent) {
    void wx.navigateTo({ url: `/packages/admin/opportunity-editor/index?id=${String(event.currentTarget.dataset.id || '')}` })
  },
  openDetail(event: WechatMiniprogram.TouchEvent) {
    void wx.navigateTo({ url: `/packages/admin/opportunity-detail/index?id=${String(event.currentTarget.dataset.id || '')}` })
  },
  async exportOpportunities() {
    try {
      await mipAdminModule.exportAndOpen({ exportType: 'OPPORTUNITIES', filters: filters(this.data) })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '机会导出失败' })
    }
  },
  async loadOpportunities(force = false) {
    const hasContent = this.data.opportunities.length > 0
    if (!hasContent) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const [response, session] = await Promise.all([
        mipAdminModule.opportunities.list({
          filters: filters(this.data),
        }, force),
        mipAdminModule.getSession(force),
      ])
      this.setData({
        state: 'ready',
        opportunities: response.items.map(opportunityView),
        canArchive: hasCapability(session.capabilities, 'opportunities.archive'),
        nextCursor: response.nextCursor || null,
        loadingMore: false,
        message: '',
      })
    }
    catch (error) {
      this.setData(adminLoadFailure(error, { hasContent, fallbackMessage: '机会列表加载失败' }))
    }
  },
  async loadMoreOpportunities() {
    if (!this.data.nextCursor || this.data.loadingMore || this.data.state !== 'ready') {
      return
    }
    this.setData({ loadingMore: true, message: '' })
    try {
      const response = await mipAdminModule.opportunities.list({
        cursor: this.data.nextCursor,
        filters: filters(this.data),
      })
      this.setData({ opportunities: this.data.opportunities.concat(response.items.map(opportunityView)), nextCursor: response.nextCursor || null })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '更多机会加载失败' })
    }
    finally {
      this.setData({ loadingMore: false })
    }
  },
  onReachBottom() { void this.loadMoreOpportunities() },
  toggleDetail(event: WechatMiniprogram.TouchEvent) {
    const opportunityId = String(event.currentTarget.dataset.id || '')
    this.setData({ expandedId: this.data.expandedId === opportunityId ? '' : opportunityId })
  },
  async unpublish(event: WechatMiniprogram.TouchEvent) {
    const opportunityId = String(event.currentTarget.dataset.id || '')
    const version = Number(event.currentTarget.dataset.version)
    if (!opportunityId || this.data.processingId) {
      return
    }
    this.setData({ processingId: opportunityId, message: '' })
    try {
      const modal = await wx.showModal({ title: '下架机会', editable: true, placeholderText: '填写下架原因' })
      if (!modal.confirm || !modal.content.trim()) {
        return
      }
      await mipAdminModule.opportunities.unpublish({
        opportunityId,
        expectedVersion: version,
        reason: modal.content,
      })
      wx.showToast({ title: '机会已下架', icon: 'success' })
      await this.loadOpportunities(true)
    }
    catch (error) {
      this.setData(opportunityActionFailure(error, '机会下架失败'))
    }
    finally {
      this.setData({ processingId: '' })
    }
  },
  async archive(event: WechatMiniprogram.TouchEvent) {
    const opportunityId = String(event.currentTarget.dataset.id || '')
    const status = String(event.currentTarget.dataset.status || '')
    const version = Number(event.currentTarget.dataset.version)
    if (!this.data.canArchive || status !== 'DRAFT' || !opportunityId || this.data.processingId) {
      return
    }
    this.setData({ processingId: opportunityId, message: '' })
    try {
      const modal = await wx.showModal({
        title: '归档机会草稿',
        content: '归档后将从用户端隐藏，且不能直接恢复。',
        editable: true,
        placeholderText: '填写归档原因',
      })
      const reason = String(modal.content || '').trim()
      if (!modal.confirm || !reason) {
        return
      }
      await mipAdminModule.opportunities.archive({
        opportunityId,
        expectedVersion: version,
        reason,
      })
      wx.showToast({ title: '草稿已归档', icon: 'success' })
      await this.loadOpportunities(true)
    }
    catch (error) {
      this.setData(opportunityActionFailure(error, '机会归档失败'))
    }
    finally {
      this.setData({ processingId: '' })
    }
  },
})
