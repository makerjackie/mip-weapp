import type { AdminUnifiedBenefitLedgerItem, AdminUnifiedBenefitPageSize } from '../../../modules/mip-admin'
import type { AdminPageState } from '../shared/page-state'
import { hasCapability, mipAdminModule } from '../../../modules/mip-admin'
import { formatLocalDateTime } from '../../../utils/date'
import { adminLoadFailure } from '../shared/page-state'

type BenefitLedgerPageState = AdminPageState | 'empty'

const typeOptions = [
  { label: '全部权益', value: '' },
  { label: '会员权益', value: 'MEMBERSHIP' },
  { label: '成长权益', value: 'GROWTH' },
]
const pageSizeOptions: AdminUnifiedBenefitPageSize[] = [10, 20, 50, 100]

function dateBoundary(value: string, endOfDay: boolean) {
  const parts = value.split('-').map(Number)
  if (parts.length !== 3 || parts.some(part => !Number.isInteger(part))) {
    return ''
  }
  const date = new Date(parts[0], parts[1] - 1, parts[2], endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0)
  return Number.isFinite(date.getTime()) ? date.toISOString() : ''
}

function itemView(item: AdminUnifiedBenefitLedgerItem) {
  return {
    ...item,
    typeText: item.benefitType === 'MEMBERSHIP' ? '会员' : '成长',
    statusText: item.status === 'RECORDED' ? '已记录' : item.status === 'ACTIVE' ? '当前有效' : item.status,
    occurredText: item.occurredAt ? formatLocalDateTime(item.occurredAt) : '—',
    periodText: item.startsAt && item.endsAt ? `${formatLocalDateTime(item.startsAt)} 至 ${formatLocalDateTime(item.endsAt)}` : '—',
    orderText: item.order ? `${item.order.orderType} · ${item.order.status}` : '无关联订单',
    deltaText: item.deltaValue === null ? '—' : `${item.deltaValue > 0 ? '+' : ''}${item.deltaValue}`,
  }
}

Page({
  data: {
    state: 'loading' as BenefitLedgerPageState,
    items: [] as ReturnType<typeof itemView>[],
    message: '',
    canRead: false,
    query: '',
    benefitType: '',
    typeIndex: 0,
    typeOptions,
    createdFromDate: '',
    createdToDate: '',
    pageSize: 20 as AdminUnifiedBenefitPageSize,
    pageSizeIndex: 1,
    pageSizeOptions,
    nextCursor: null as string | null,
    loadingMore: false,
  },
  onShow() { void this.load() },
  filters() {
    return {
      benefitType: this.data.benefitType as '' | 'MEMBERSHIP' | 'GROWTH',
      query: this.data.query.trim(),
      createdFrom: this.data.createdFromDate ? dateBoundary(this.data.createdFromDate, false) : '',
      createdTo: this.data.createdToDate ? dateBoundary(this.data.createdToDate, true) : '',
    }
  },
  async load(force = false) {
    const hasContent = this.data.items.length > 0
    if (!hasContent) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const session = await mipAdminModule.getSession(force)
      const canRead = hasCapability(session.capabilities, 'memberships.read') || hasCapability(session.capabilities, 'growth.read')
      if (!canRead) {
        this.setData({ state: 'forbidden', canRead: false, items: [], message: '当前账号没有查看权益流水的权限。' })
        return
      }
      const response = await mipAdminModule.benefitLedger.list({ filters: this.filters(), limit: this.data.pageSize }, force)
      this.setData({ state: response.items.length > 0 ? 'ready' : 'empty', canRead: true, items: response.items.map(itemView), nextCursor: response.nextCursor || null, loadingMore: false, message: '' })
    }
    catch (error) {
      this.setData(adminLoadFailure(error, { hasContent, fallbackMessage: '统一权益流水加载失败' }))
    }
  },
  async loadMore() {
    if (!this.data.nextCursor || this.data.loadingMore || this.data.state !== 'ready') {
      return
    }
    this.setData({ loadingMore: true, message: '' })
    try {
      const response = await mipAdminModule.benefitLedger.list({ filters: this.filters(), limit: this.data.pageSize, cursor: this.data.nextCursor })
      this.setData({ items: this.data.items.concat(response.items.map(itemView)), nextCursor: response.nextCursor || null })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '更多权益流水加载失败' })
    }
    finally { this.setData({ loadingMore: false }) }
  },
  onReachBottom() { void this.loadMore() },
  updateQuery(event: WechatMiniprogram.CustomEvent<{ value: string }>) { this.setData({ query: event.detail.value }) },
  changeType(event: WechatMiniprogram.CustomEvent<{ value: string | number }>) {
    const typeIndex = Number(event.detail.value)
    const option = this.data.typeOptions[typeIndex]
    if (!option) {
      return
    }
    this.setData({ typeIndex, benefitType: option.value })
    void this.load(true)
  },
  changePageSize(event: WechatMiniprogram.CustomEvent<{ value: string | number }>) {
    const pageSizeIndex = Number(event.detail.value)
    const pageSize = this.data.pageSizeOptions[pageSizeIndex]
    if (!pageSize) {
      return
    }
    this.setData({ pageSizeIndex, pageSize })
    void this.load(true)
  },
  changeDate(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field = String(event.currentTarget.dataset.field || '')
    if (field === 'createdFromDate' || field === 'createdToDate') {
      this.setData({ [field]: event.detail.value })
    }
  },
  applyFilters() { void this.load(true) },
  clearDates() {
    this.setData({ createdFromDate: '', createdToDate: '' })
    void this.load(true)
  },
})
