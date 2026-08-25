import type {
  AdminDeliveryReviewItem,
  AdminDeliveryReviewResolutionIntent,
  AdminDeliveryReviewSourceType,
  AdminDeliveryReviewWorkflowFilter,
} from '../../../modules/mip-admin/message-delivery-reviews'
import type {
  AdminOperationalException,
  AdminOperationalExceptionStatus,
  AdminOperationalExceptionType,
} from '../../../modules/mip-admin/operational-exceptions'
import type { AdminPageState } from '../shared/page-state'
import { hasCapability, mipAdminModule } from '../../../modules/mip-admin'
import { deliveryReviewMutationSignature } from '../../../modules/mip-admin/message-delivery-reviews'
import { formatLocalDateTime } from '../../../utils/date'
import { adminLoadFailure, isAdminForbiddenError } from '../shared/page-state'

type SectionState = AdminPageState | 'empty' | 'hidden'

interface FilterOption<T extends string> {
  value: T | ''
  label: string
}

interface ExceptionView extends AdminOperationalException {
  sourceText: string
  statusText: string
  occurredText: string
}

interface DeliveryReviewView extends AdminDeliveryReviewItem {
  id: string
  sourceText: string
  classificationText: string
  workflowText: string
  occurredText: string
  stateSummary: string
  evidenceSummary: string
  resolutionText: string
  selected: boolean
  requiresNote: boolean
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

const reviewSourceLabels: Record<AdminDeliveryReviewSourceType, string> = {
  CAMPAIGN_DISPATCH: '消息活动',
  DELIVERY_TASK: '通知投递',
}

const classificationLabels: Record<AdminDeliveryReviewItem['classification'], string> = {
  PROCESSING_ACTIVE: '处理中',
  PROCESSING_STALLED: '处理超时',
  MANUAL_REVIEW: '待人工复核',
  RETRYABLE_FAILURE: '等待自动重试',
  TERMINAL_FAILURE: '已终止',
  SUCCEEDED: '已完成',
  PENDING: '等待处理',
}

const workflowLabels: Record<AdminDeliveryReviewItem['workflow']['status'], string> = {
  OPEN: '待认领',
  CLAIMED: '复核中',
  RESOLVED: '已闭环',
}

const reviewStateLabels: Record<string, string> = {
  CANCELLED: '已取消',
  COMPLETED: '已完成',
  DELIVERED: '已送达',
  FAILED: '失败',
  PENDING: '等待处理',
  PROCESSING: '处理中',
  SCHEDULED: '已排期',
}

const resolutionLabels: Record<NonNullable<AdminDeliveryReviewItem['workflow']['resolution']>['code'], string> = {
  AUTO_CONVERGED: '系统状态已收敛',
  TERMINAL_ACCEPTED: '已接受终止结果',
  UNKNOWN_NO_REPLAY: '已确认未知结果，不重放',
}

const pendingRequestKeys = new Map<string, string>()

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
      .map(([value, label]) => ({ value: value as AdminOperationalExceptionStatus, label })),
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

function reviewView(item: AdminDeliveryReviewItem, selectedId: string): DeliveryReviewView {
  const evidence = item.evidence
  const counts = item.resourceRef.type === 'CAMPAIGN_DISPATCH'
    ? `预期 ${evidence.recipientCount || 0} 人，已写入 ${evidence.submittedCount || 0} 条，已进入投递队列 ${evidence.outboxCoveredCount || 0} 条`
    : `通道 ${evidence.channel || '-'}，预留授权 ${evidence.reservedGrantCount || 0} 条`
  const resolution = item.workflow.resolution
  const id = `${item.resourceRef.type}:${item.resourceRef.id}`
  return {
    ...item,
    id,
    sourceText: reviewSourceLabels[item.resourceRef.type],
    classificationText: classificationLabels[item.classification],
    workflowText: workflowLabels[item.workflow.status],
    occurredText: formatLocalDateTime(item.sourceState.occurredAt),
    stateSummary: `业务状态 ${reviewStateLabels[item.sourceState.status] || item.sourceState.status} · 尝试 ${item.sourceState.attempts} 次${item.sourceState.lastErrorCode ? ` · 错误码 ${item.sourceState.lastErrorCode}` : ''}`,
    evidenceSummary: counts,
    resolutionText: resolution
      ? `${resolutionLabels[resolution.code]}${resolution.note ? ` · ${resolution.note}` : ''}`
      : '',
    selected: id === selectedId,
    requiresNote: item.classification === 'MANUAL_REVIEW',
  }
}

function mutationKey(signature: string, action: string) {
  const existing = pendingRequestKeys.get(signature)
  if (existing) {
    return existing
  }
  const key = `delivery-review-${action}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  pendingRequestKeys.set(signature, key)
  return key
}

Page({
  data: {
    state: 'loading' as SectionState,
    exceptionsState: 'hidden' as SectionState,
    reviewState: 'hidden' as SectionState,
    items: [] as ExceptionView[],
    reviewItems: [] as DeliveryReviewView[],
    reviewNextCursor: null as string | null,
    reviewLoadingMore: false,
    canOperationalExceptions: false,
    canDeliveryReview: false,
    type: '' as AdminOperationalExceptionType | '',
    status: '' as AdminOperationalExceptionStatus | '',
    reviewWorkflowStatus: 'ACTIVE' as AdminDeliveryReviewWorkflowFilter,
    selectedReviewId: '',
    resolutionNote: '',
    evidenceReference: '',
    busyReviewId: '',
    availableTypes: [] as AdminOperationalExceptionType[],
    typeOptions: typeOptions([]),
    statusOptions: statusOptions([], ''),
    message: '',
    exceptionsMessage: '',
    reviewMessage: '',
  },

  onShow() {
    void this.loadPage()
  },

  async onPullDownRefresh() {
    try {
      await this.loadPage(true)
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  retryLoad() {
    void this.loadPage(true)
  },

  async loadPage(force = false) {
    if (this.data.state !== 'ready') {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const session = await mipAdminModule.governance.getSession(force)
      const canOperationalExceptions = hasCapability(session.capabilities, 'operations.exceptions.read')
      const canDeliveryReview = hasCapability(session.capabilities, 'messages.delivery.review')
      if (!canOperationalExceptions && !canDeliveryReview) {
        this.setData({ state: 'forbidden', canOperationalExceptions, canDeliveryReview })
        return
      }
      this.setData({ state: 'ready', canOperationalExceptions, canDeliveryReview, message: '' })
      await Promise.all([
        canOperationalExceptions ? this.loadExceptions(force) : Promise.resolve(),
        canDeliveryReview ? this.loadDeliveryReviews(force) : Promise.resolve(),
      ])
    }
    catch (error) {
      if (isAdminForbiddenError(error)) {
        this.setData({ state: 'forbidden', message: '' })
        return
      }
      this.setData(adminLoadFailure(error, {
        hasContent: this.data.state === 'ready',
        fallbackMessage: '异常中心加载失败',
      }))
    }
  },

  async loadExceptions(force = false) {
    this.setData({ exceptionsState: 'loading', exceptionsMessage: '' })
    try {
      const response = await mipAdminModule.governance.listOperationalExceptions({
        type: this.data.type,
        status: this.data.status,
        limit: 50,
      }, force)
      this.setData({
        exceptionsState: response.items.length ? 'ready' : 'empty',
        items: response.items.map(exceptionView),
        availableTypes: response.availableTypes,
        typeOptions: typeOptions(response.availableTypes),
        statusOptions: statusOptions(response.availableTypes, this.data.type),
        exceptionsMessage: '',
      })
    }
    catch (error) {
      const failure = adminLoadFailure(error, {
        hasContent: this.data.items.length > 0,
        fallbackMessage: '异常列表加载失败',
      })
      this.setData({ exceptionsState: failure.state, exceptionsMessage: failure.message })
    }
  },

  async loadDeliveryReviews(force = false, append = false) {
    if (append) {
      this.setData({ reviewLoadingMore: true, reviewMessage: '' })
    }
    else {
      this.setData({ reviewState: 'loading', reviewNextCursor: null, reviewMessage: '' })
    }
    try {
      const response = await mipAdminModule.messaging.listDeliveryReviews({
        workflowStatus: this.data.reviewWorkflowStatus,
        ...(append && this.data.reviewNextCursor ? { cursor: this.data.reviewNextCursor } : {}),
        limit: 50,
      }, force)
      const combined = append
        ? [...this.data.reviewItems, ...response.items].filter((item, index, items) => (
            items.findIndex(candidate => (
              candidate.resourceRef.type === item.resourceRef.type
              && candidate.resourceRef.id === item.resourceRef.id
            )) === index
          ))
        : response.items
      const selectedReviewId = combined.some(item => (
        `${item.resourceRef.type}:${item.resourceRef.id}` === this.data.selectedReviewId
      ))
        ? this.data.selectedReviewId
        : ''
      this.setData({
        reviewState: combined.length ? 'ready' : 'empty',
        reviewItems: combined.map(item => reviewView(item, selectedReviewId)),
        reviewNextCursor: response.nextCursor,
        selectedReviewId,
        reviewMessage: '',
      })
    }
    catch (error) {
      const failure = adminLoadFailure(error, {
        hasContent: this.data.reviewItems.length > 0,
        fallbackMessage: '投递复核列表加载失败',
      })
      if (append) {
        this.setData({ reviewMessage: failure.message })
      }
      else {
        this.setData({ reviewState: failure.state, reviewMessage: failure.message })
      }
    }
    finally {
      this.setData({ reviewLoadingMore: false })
    }
  },

  loadMoreDeliveryReviews() {
    if (!this.data.reviewNextCursor || this.data.reviewLoadingMore) {
      return
    }
    void this.loadDeliveryReviews(false, true)
  },

  chooseReviewWorkflow(event: WechatMiniprogram.TouchEvent) {
    const value = String(event.currentTarget.dataset.value || '') as AdminDeliveryReviewWorkflowFilter
    if (!['ACTIVE', 'RESOLVED'].includes(value) || value === this.data.reviewWorkflowStatus) {
      return
    }
    this.setData({
      reviewWorkflowStatus: value,
      reviewItems: [],
      reviewNextCursor: null,
      selectedReviewId: '',
      resolutionNote: '',
      evidenceReference: '',
    })
    void this.loadDeliveryReviews(true)
  },

  toggleReview(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    const selectedReviewId = id === this.data.selectedReviewId ? '' : id
    this.setData({
      selectedReviewId,
      reviewItems: this.data.reviewItems.map(item => reviewView(item, selectedReviewId)),
      resolutionNote: '',
      evidenceReference: '',
      reviewMessage: '',
    })
  },

  updateResolutionNote(event: WechatMiniprogram.Input) {
    this.setData({ resolutionNote: String(event.detail.value || '').slice(0, 500) })
  },

  updateEvidenceReference(event: WechatMiniprogram.Input) {
    this.setData({ evidenceReference: String(event.detail.value || '').slice(0, 300) })
  },

  claimReview(event: WechatMiniprogram.TouchEvent) {
    void this.mutateReview('claim', String(event.currentTarget.dataset.id || ''))
  },

  reconcileReview(event: WechatMiniprogram.TouchEvent) {
    void this.mutateReview('reconcile', String(event.currentTarget.dataset.id || ''))
  },

  resolveReview(event: WechatMiniprogram.TouchEvent) {
    void this.mutateReview('resolve', String(event.currentTarget.dataset.id || ''))
  },

  async mutateReview(action: 'claim' | 'reconcile' | 'resolve', id: string) {
    const item = this.data.reviewItems.find(candidate => candidate.id === id)
    if (!item || this.data.busyReviewId) {
      return
    }
    if (action === 'resolve' && item.requiresNote && !this.data.resolutionNote.trim()) {
      this.setData({ reviewMessage: '投递结果未知时必须填写处理说明' })
      return
    }
    const resolution: AdminDeliveryReviewResolutionIntent | undefined = action === 'resolve'
      ? {
          resolutionCode: item.requiresNote ? 'UNKNOWN_NO_REPLAY' : 'TERMINAL_ACCEPTED',
          note: this.data.resolutionNote.trim(),
          evidenceReference: this.data.evidenceReference.trim(),
        }
      : undefined
    const signature = deliveryReviewMutationSignature(action, item, resolution)
    const base = {
      resourceRef: item.resourceRef,
      evidenceRevision: item.evidenceRevision,
      reviewVersion: item.workflow.version,
      idempotencyKey: mutationKey(signature, action),
    }
    this.setData({ busyReviewId: id, reviewMessage: '' })
    try {
      if (action === 'claim') {
        await mipAdminModule.messaging.claimDeliveryReview(base)
      }
      else if (action === 'reconcile') {
        await mipAdminModule.messaging.reconcileDeliveryReview(base)
      }
      else {
        await mipAdminModule.messaging.resolveDeliveryReview({
          ...base,
          ...resolution!,
        })
      }
      pendingRequestKeys.delete(signature)
      this.setData({ selectedReviewId: '', resolutionNote: '', evidenceReference: '' })
      await this.loadDeliveryReviews(true)
      void wx.showToast({ title: '处理结果已记录', icon: 'success' })
    }
    catch (error) {
      const failure = adminLoadFailure(error, {
        hasContent: true,
        fallbackMessage: '投递复核处理失败',
      })
      this.setData({ reviewMessage: failure.message })
    }
    finally {
      this.setData({ busyReviewId: '' })
    }
  },

  chooseType(event: WechatMiniprogram.TouchEvent) {
    const value = String(event.currentTarget.dataset.value || '') as AdminOperationalExceptionType | ''
    if (value === this.data.type || !this.data.typeOptions.some(item => item.value === value)) {
      return
    }
    const nextStatusOptions = statusOptions(this.data.availableTypes, value)
    const status = nextStatusOptions.some(item => item.value === this.data.status) ? this.data.status : ''
    this.setData({ type: value, status, statusOptions: nextStatusOptions, items: [] })
    void this.loadExceptions(true)
  },

  chooseStatus(event: WechatMiniprogram.TouchEvent) {
    const value = String(event.currentTarget.dataset.value || '') as AdminOperationalExceptionStatus | ''
    if (value === this.data.status || !this.data.statusOptions.some(item => item.value === value)) {
      return
    }
    this.setData({ status: value, items: [] })
    void this.loadExceptions(true)
  },

  openTarget(event: WechatMiniprogram.TouchEvent) {
    const item = this.data.items.find(candidate => candidate.id === String(event.currentTarget.dataset.id || ''))
    if (item?.target?.route.startsWith('/packages/admin/')) {
      void wx.navigateTo({ url: item.target.route })
    }
  },
})
