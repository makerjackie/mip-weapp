import type {
  AdminDeliveryReviewItem,
  AdminDeliveryReviewResolutionIntent,
  AdminDeliveryReviewResourceRef,
} from '../../../modules/mip-admin/message-delivery-reviews'
import type { AdminPageState } from '../shared/page-state'
import { hasCapability, MipAdminError, mipAdminModule } from '../../../modules/mip-admin'
import { deliveryReviewMutationSignature } from '../../../modules/mip-admin/message-delivery-reviews'
import { formatLocalDateTime } from '../../../utils/date'
import {
  adminLoadFailure,
  isAdminForbiddenError,
  isAdminVersionConflict,
} from '../shared/page-state'

type ReviewDetailView = AdminDeliveryReviewItem & {
  sourceText: string
  classificationText: string
  workflowText: string
  statusText: string
  occurredText: string
  availableText: string
  sourceLeaseText: string
  deliveredText: string
  claimText: string
  outcomeText: string
  retryText: string
  evidenceTargetText: string
  resolutionText: string
}

const sourceLabels: Record<AdminDeliveryReviewResourceRef['type'], string> = {
  CAMPAIGN_DISPATCH: '消息活动派发',
  DELIVERY_TASK: '通知投递任务',
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

const stateLabels: Record<string, string> = {
  CANCELLED: '已取消',
  COMPLETED: '已完成',
  DELIVERED: '已送达',
  FAILED: '失败',
  PENDING: '等待处理',
  PROCESSING: '处理中',
  SCHEDULED: '已排期',
}

const outcomeLabels: Record<string, string> = {
  NONE: '无结论',
  UNKNOWN: '结果未知',
  DELIVERED: '已送达',
  FAILED: '已失败',
}

const retryLabels: Record<string, string> = {
  NONE: '无',
  RETRIABLE: '可重试',
  MANUAL_REVIEW: '人工复核',
  TERMINAL: '不可继续',
}

const targetLabels: Record<string, string> = {
  EVENT: '活动',
  ORDER: '订单',
  OPPORTUNITY: '机会',
  USER: '用户',
  GROWTH: '成长记录',
}

const pendingRequestKeys = new Map<string, string>()
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isReviewConflict(error: unknown) {
  return isAdminVersionConflict(error)
    || (error instanceof MipAdminError && error.code === 'EVIDENCE_CHANGED')
}

function textAt(value: string | null) {
  return value ? formatLocalDateTime(value) : '未记录'
}

function reviewView(item: AdminDeliveryReviewItem): ReviewDetailView {
  const sourceState = item.sourceState
  const claim = item.workflow.claim
  const resolution = item.workflow.resolution
  const targetRef = item.evidence.targetRef
  return {
    ...item,
    sourceText: sourceLabels[item.resourceRef.type],
    classificationText: classificationLabels[item.classification],
    workflowText: workflowLabels[item.workflow.status],
    statusText: stateLabels[sourceState.status] || sourceState.status,
    occurredText: textAt(sourceState.occurredAt),
    availableText: textAt(sourceState.availableAt),
    sourceLeaseText: textAt(sourceState.leaseExpiresAt),
    deliveredText: textAt(sourceState.deliveredAt),
    claimText: claim
      ? `${claim.claimedByMe ? '当前账号已认领' : '其他账号已认领'} · 认领于 ${textAt(claim.claimedAt)} · 到期 ${textAt(claim.expiresAt)}`
      : '当前没有有效认领租约',
    outcomeText: outcomeLabels[sourceState.lastOutcome] || sourceState.lastOutcome || '无结论',
    retryText: retryLabels[sourceState.retryDisposition] || sourceState.retryDisposition || '无',
    evidenceTargetText: targetRef ? targetLabels[targetRef.type] || targetRef.type : '未关联业务目标',
    resolutionText: resolution
      ? `${resolution.code === 'UNKNOWN_NO_REPLAY'
        ? '已确认未知结果，不重放'
        : resolution.code === 'TERMINAL_ACCEPTED'
          ? '已接受终止结果'
          : '系统状态已收敛'}${resolution.note ? ` · ${resolution.note}` : ''}`
      : '',
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
  loadSequence: 0,

  data: {
    state: 'loading' as AdminPageState,
    sourceType: '' as AdminDeliveryReviewResourceRef['type'] | '',
    sourceId: '',
    item: null as ReviewDetailView | null,
    resolutionNote: '',
    evidenceReference: '',
    busyAction: '' as '' | 'claim' | 'reconcile' | 'resolve',
    message: '',
  },

  onLoad(query: Record<string, string | undefined>) {
    const sourceType = String(query.sourceType || '') as AdminDeliveryReviewResourceRef['type']
    const sourceId = String(query.sourceId || '').trim()
    if (['CAMPAIGN_DISPATCH', 'DELIVERY_TASK'].includes(sourceType)
      && uuidPattern.test(sourceId)) {
      this.setData({ sourceType, sourceId })
    }
    else {
      this.setData({ state: 'error', message: '投递复核记录标识无效' })
    }
  },

  onShow() {
    if (this.data.sourceType && this.data.sourceId) {
      void this.load()
    }
  },

  async onPullDownRefresh() {
    try {
      await this.load(true)
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  retryLoad() {
    void this.load(true)
  },

  async load(force = false) {
    if (!this.data.sourceType || !this.data.sourceId) {
      return false
    }
    const sequence = this.loadSequence + 1
    this.loadSequence = sequence
    const hasContent = Boolean(this.data.item)
    this.setData({ ...(hasContent ? {} : { state: 'loading' as AdminPageState }), message: '' })
    try {
      const session = await mipAdminModule.getSession(force)
      if (sequence !== this.loadSequence) {
        return false
      }
      if (!session.enabled || !hasCapability(session.capabilities, 'messages.delivery.review')) {
        this.setData({ state: 'forbidden', item: null, message: '' })
        return false
      }
      const item = await mipAdminModule.messaging.getDeliveryReview({
        type: this.data.sourceType,
        id: this.data.sourceId,
      }, force)
      if (sequence !== this.loadSequence) {
        return false
      }
      this.setData({ state: 'ready', item: reviewView(item), message: '' })
      return true
    }
    catch (error) {
      if (sequence !== this.loadSequence) {
        return false
      }
      if (isAdminForbiddenError(error)) {
        this.setData({ state: 'forbidden', item: null, message: '' })
        return false
      }
      if (isReviewConflict(error)) {
        this.setData({ state: 'conflict', message: '记录状态已变化，请刷新后重试' })
        return false
      }
      this.setData(adminLoadFailure(error, {
        hasContent,
        fallbackMessage: '投递复核详情加载失败',
      }))
      return false
    }
  },

  backToList() {
    void wx.navigateBack({ delta: 1 })
  },

  updateResolutionNote(event: WechatMiniprogram.Input) {
    this.setData({ resolutionNote: String(event.detail.value || '').slice(0, 500) })
  },

  updateEvidenceReference(event: WechatMiniprogram.Input) {
    this.setData({ evidenceReference: String(event.detail.value || '').slice(0, 300) })
  },

  claimReview() {
    void this.mutateReview('claim')
  },

  reconcileReview() {
    void this.mutateReview('reconcile')
  },

  resolveReview() {
    void this.mutateReview('resolve')
  },

  async mutateReview(action: 'claim' | 'reconcile' | 'resolve') {
    const item = this.data.item
    if (!item || this.data.busyAction) {
      return
    }
    const requiresNote = item.classification === 'MANUAL_REVIEW'
    if (action === 'resolve'
      && requiresNote
      && !this.data.resolutionNote.trim()) {
      this.setData({ message: '投递结果未知时必须填写处理说明' })
      return
    }
    const resolution: AdminDeliveryReviewResolutionIntent | undefined = action === 'resolve'
      ? {
          resolutionCode: requiresNote ? 'UNKNOWN_NO_REPLAY' : 'TERMINAL_ACCEPTED',
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
    this.setData({ busyAction: action, message: '' })
    try {
      if (action === 'claim') {
        await mipAdminModule.messaging.claimDeliveryReview(base)
      }
      else if (action === 'reconcile') {
        await mipAdminModule.messaging.reconcileDeliveryReview(base)
      }
      else {
        await mipAdminModule.messaging.resolveDeliveryReview({ ...base, ...resolution! })
      }
      pendingRequestKeys.delete(signature)
      this.setData({ resolutionNote: '', evidenceReference: '' })
      await this.load(true)
      wx.showToast({ title: '处理结果已记录', icon: 'success' })
    }
    catch (error) {
      if (isAdminForbiddenError(error)) {
        this.setData({ state: 'forbidden', message: '' })
      }
      else if (isReviewConflict(error)) {
        this.setData({ state: 'conflict', message: '记录状态已变化，请刷新后重试' })
      }
      else {
        this.setData({ message: error instanceof Error ? error.message : '投递复核处理失败' })
      }
    }
    finally {
      this.setData({ busyAction: '' })
    }
  },
})
