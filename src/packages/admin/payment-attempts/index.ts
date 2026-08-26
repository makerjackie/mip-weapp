import type {
  AdminPaymentAttempt,
  AdminPaymentAttemptPageSize,
  AdminPaymentAttemptProvider,
  AdminPaymentAttemptStatus,
} from '../../../modules/mip-admin'
import type { AdminPageState } from '../shared/page-state'
import { hasCapability, mipAdminModule } from '../../../modules/mip-admin'
import { caseNavigateTo } from '../../../modules/platform/case-navigation'
import { formatLocalDateTime } from '../../../utils/date'
import { adminLoadFailure } from '../shared/page-state'

type PageState = AdminPageState | 'empty'
interface FilterOption<T extends string> { label: string, value: T | '' }

const providerOptions: Array<FilterOption<AdminPaymentAttemptProvider>> = [
  { label: '全部渠道', value: '' },
  { label: '微信支付', value: 'WECHAT_PAY' },
  { label: '测试支付', value: 'TEST' },
]
const statusOptions: Array<FilterOption<AdminPaymentAttemptStatus>> = [
  { label: '全部状态', value: '' },
  { label: '已创建', value: 'CREATED' },
  { label: '支付参数已生成', value: 'PARAMETERS_ISSUED' },
  { label: '处理中', value: 'PENDING' },
  { label: '已成功', value: 'SUCCEEDED' },
  { label: '已失败', value: 'FAILED' },
  { label: '已关闭', value: 'CLOSED' },
]
const pageSizeOptions: AdminPaymentAttemptPageSize[] = [10, 20, 50, 100]
const providerLabels: Record<AdminPaymentAttemptProvider, string> = {
  WECHAT_PAY: '微信支付',
  TEST: '测试支付',
}
const statusLabels: Record<AdminPaymentAttemptStatus, string> = {
  CREATED: '已创建',
  PARAMETERS_ISSUED: '支付参数已生成',
  PENDING: '处理中',
  SUCCEEDED: '已成功',
  FAILED: '已失败',
  CLOSED: '已关闭',
}

function dateBoundary(value: string, endOfDay: boolean) {
  const parts = value.split('-').map(Number)
  if (parts.length !== 3 || parts.some(part => !Number.isInteger(part))) {
    return ''
  }
  const date = new Date(parts[0], parts[1] - 1, parts[2], endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0)
  return Number.isFinite(date.getTime()) ? date.toISOString() : ''
}

function attemptView(item: AdminPaymentAttempt) {
  return {
    ...item,
    providerText: providerLabels[item.provider],
    statusText: statusLabels[item.status],
    statusTheme: item.status === 'FAILED' ? 'danger' : item.status === 'SUCCEEDED' ? 'success' : item.status === 'PENDING' ? 'warning' : 'default',
    amountText: `${item.currency} ${(item.amountCents / 100).toFixed(2)}`,
    createdText: item.createdAt ? formatLocalDateTime(item.createdAt) : '未记录',
    updatedText: item.updatedAt ? formatLocalDateTime(item.updatedAt) : '未记录',
  }
}

Page({
  data: {
    state: 'loading' as PageState,
    items: [] as ReturnType<typeof attemptView>[],
    message: '',
    canRead: false,
    query: '',
    provider: '' as AdminPaymentAttemptProvider | '',
    providerIndex: 0,
    providerOptions,
    status: '' as AdminPaymentAttemptStatus | '',
    statusIndex: 0,
    statusOptions,
    createdFromDate: '',
    createdToDate: '',
    pageSize: 20 as AdminPaymentAttemptPageSize,
    pageSizeIndex: 1,
    pageSizeOptions,
    nextCursor: null as string | null,
    loadingMore: false,
  },

  onShow() { void this.load() },

  async onPullDownRefresh() {
    try {
      await this.load(true)
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  filters() {
    return {
      query: this.data.query.trim(),
      provider: this.data.provider,
      status: this.data.status,
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
      const canRead = session.enabled && hasCapability(session.capabilities, 'orders.read')
      if (!canRead) {
        this.setData({ state: 'forbidden', canRead: false, items: [], nextCursor: null, message: '当前账号没有查看支付尝试记录的权限。' })
        return
      }
      const response = await mipAdminModule.paymentAttempts.list({ filters: this.filters(), limit: this.data.pageSize }, force)
      this.setData({ state: response.items.length ? 'ready' : 'empty', canRead: true, items: response.items.map(attemptView), nextCursor: response.nextCursor || null, loadingMore: false, message: '' })
    }
    catch (error) {
      this.setData(adminLoadFailure(error, { hasContent, fallbackMessage: '支付尝试记录加载失败' }))
    }
  },

  async loadMore() {
    if (!this.data.nextCursor || this.data.loadingMore || this.data.state !== 'ready') {
      return
    }
    this.setData({ loadingMore: true, message: '' })
    try {
      const response = await mipAdminModule.paymentAttempts.list({ filters: this.filters(), limit: this.data.pageSize, cursor: this.data.nextCursor })
      this.setData({ items: this.data.items.concat(response.items.map(attemptView)), nextCursor: response.nextCursor || null })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '更多支付尝试记录加载失败' })
    }
    finally { this.setData({ loadingMore: false }) }
  },

  onReachBottom() { void this.loadMore() },
  updateQuery(event: WechatMiniprogram.CustomEvent<{ value: string }>) { this.setData({ query: event.detail.value }) },
  applyFilters() { void this.load(true) },
  changeProvider(event: WechatMiniprogram.CustomEvent<{ value: string | number }>) {
    const providerIndex = Number(event.detail.value)
    const option = this.data.providerOptions[providerIndex]
    if (!option) {
      return
    }
    this.setData({ providerIndex, provider: option.value })
    void this.load(true)
  },
  changeStatus(event: WechatMiniprogram.CustomEvent<{ value: string | number }>) {
    const statusIndex = Number(event.detail.value)
    const option = this.data.statusOptions[statusIndex]
    if (!option) {
      return
    }
    this.setData({ statusIndex, status: option.value })
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
  clearDates() {
    this.setData({ createdFromDate: '', createdToDate: '' })
    void this.load(true)
  },
  openOrders() { caseNavigateTo({ url: '/packages/admin/orders/index' }) },
})
