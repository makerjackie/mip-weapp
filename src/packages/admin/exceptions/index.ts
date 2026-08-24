import type {
  AdminOperationalException,
  AdminOperationalExceptionStatus,
  AdminOperationalExceptionType,
} from '../../../modules/mip-admin/operational-exceptions'
import type { AdminPageState } from '../shared/page-state'
import { hasCapability, mipAdminModule } from '../../../modules/mip-admin'
import { formatLocalDateTime } from '../../../utils/date'
import { adminLoadFailure, isAdminForbiddenError } from '../shared/page-state'

type ExceptionPageState = AdminPageState | 'empty'

interface FilterOption<T extends string> {
  value: T | ''
  label: string
}

interface ExceptionView extends AdminOperationalException {
  sourceText: string
  statusText: string
  occurredText: string
}

const sourceLabels: Record<AdminOperationalExceptionType, string> = {
  OUTBOX: '业务事件',
  REFUND: '退款',
  PAYMENT: '支付',
  MEDIA: '图片',
  DELIVERY: '通知',
  AI: 'AI 草稿',
}

const statusLabels: Record<AdminOperationalExceptionStatus, string> = {
  FAILED: '失败',
  STALLED: '处理超时',
  REJECTED: '未通过',
  EXPIRED: '已过期',
  CLEANUP_PENDING: '待清理',
}

const sourceStatuses: Record<AdminOperationalExceptionType, AdminOperationalExceptionStatus[]> = {
  OUTBOX: ['FAILED', 'STALLED'],
  REFUND: ['FAILED', 'STALLED'],
  PAYMENT: ['FAILED', 'STALLED'],
  MEDIA: ['REJECTED', 'STALLED'],
  DELIVERY: ['FAILED', 'STALLED'],
  AI: ['FAILED', 'EXPIRED', 'CLEANUP_PENDING'],
}

function typeOptions(types: AdminOperationalExceptionType[]): Array<FilterOption<AdminOperationalExceptionType>> {
  return [
    { value: '', label: '全部类型' },
    ...types.map(value => ({ value, label: sourceLabels[value] })),
  ]
}

function statusOptions(
  types: AdminOperationalExceptionType[],
  selectedType: AdminOperationalExceptionType | '',
): Array<FilterOption<AdminOperationalExceptionStatus>> {
  const selectedTypes = selectedType ? [selectedType] : types
  const available = new Set(selectedTypes.flatMap(type => sourceStatuses[type]))
  return [
    { value: '', label: '全部状态' },
    ...Object.entries(statusLabels)
      .filter(([value]) => available.has(value as AdminOperationalExceptionStatus))
      .map(([value, label]) => ({
        value: value as AdminOperationalExceptionStatus,
        label,
      })),
  ]
}

function exceptionView(item: AdminOperationalException): ExceptionView {
  return {
    ...item,
    sourceText: sourceLabels[item.source],
    statusText: statusLabels[item.status],
    occurredText: formatLocalDateTime(item.occurredAt),
  }
}

Page({
  data: {
    state: 'loading' as ExceptionPageState,
    items: [] as ExceptionView[],
    type: '' as AdminOperationalExceptionType | '',
    status: '' as AdminOperationalExceptionStatus | '',
    availableTypes: [] as AdminOperationalExceptionType[],
    typeOptions: typeOptions([]),
    statusOptions: statusOptions([], ''),
    message: '',
  },

  onShow() {
    void this.loadExceptions()
  },

  async onPullDownRefresh() {
    try {
      await this.loadExceptions(true)
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  retryLoad() {
    void this.loadExceptions(true)
  },

  async loadExceptions(force = false) {
    const hasContent = this.data.items.length > 0
    if (!hasContent) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const session = await mipAdminModule.getSession(force)
      if (!hasCapability(session.capabilities, 'operations.exceptions.read')) {
        this.setData({ state: 'forbidden', items: [], message: '' })
        return
      }
      const response = await mipAdminModule.listOperationalExceptions({
        type: this.data.type,
        status: this.data.status,
        limit: 50,
      }, force)
      this.setData({
        state: response.items.length ? 'ready' : 'empty',
        items: response.items.map(exceptionView),
        availableTypes: response.availableTypes,
        typeOptions: typeOptions(response.availableTypes),
        statusOptions: statusOptions(response.availableTypes, this.data.type),
        message: '',
      })
    }
    catch (error) {
      if (isAdminForbiddenError(error)) {
        this.setData({ state: 'forbidden', items: [], message: '' })
        return
      }
      this.setData(adminLoadFailure(error, { hasContent, fallbackMessage: '异常列表加载失败' }))
    }
  },

  chooseType(event: WechatMiniprogram.TouchEvent) {
    const value = String(event.currentTarget.dataset.value || '') as AdminOperationalExceptionType | ''
    if (value === this.data.type || !this.data.typeOptions.some(item => item.value === value)) {
      return
    }
    const nextStatusOptions = statusOptions(this.data.availableTypes, value)
    const status = nextStatusOptions.some(item => item.value === this.data.status) ? this.data.status : ''
    this.setData({
      type: value,
      status,
      statusOptions: nextStatusOptions,
      items: [],
      state: 'loading',
      message: '',
    })
    void this.loadExceptions(true)
  },

  chooseStatus(event: WechatMiniprogram.TouchEvent) {
    const value = String(event.currentTarget.dataset.value || '') as AdminOperationalExceptionStatus | ''
    if (value === this.data.status || !this.data.statusOptions.some(item => item.value === value)) {
      return
    }
    this.setData({ status: value, items: [], state: 'loading', message: '' })
    void this.loadExceptions(true)
  },

  openTarget(event: WechatMiniprogram.TouchEvent) {
    const item = this.data.items.find(candidate => candidate.id === String(event.currentTarget.dataset.id || ''))
    if (!item?.target?.route.startsWith('/packages/admin/')) {
      return
    }
    void wx.navigateTo({ url: item.target.route })
  },
})
