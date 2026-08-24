import type {
  AdminCommunityReport,
  AdminCommunityReportStatus,
} from '../../../modules/mip-admin'
import type { AdminPageState } from '../shared/page-state'
import { hasCapability, MipAdminError, mipAdminModule } from '../../../modules/mip-admin'
import { reportCategoryOptions } from '../../../modules/mip-community/types'
import { adminLoadFailure, isAdminForbiddenError, isAdminVersionConflict } from '../shared/page-state'

type ReviewAction = 'CLAIM' | 'RESOLVED' | 'DISMISSED'
type ReportView = AdminCommunityReport & {
  categoryLabel: string
  statusText: string
  createdText: string
  updatedText: string
  reviewedText: string
}

const categoryLabels = new Map(reportCategoryOptions.map(item => [item.value, item.label]))
const statusLabels: Record<AdminCommunityReportStatus, string> = {
  PENDING: '待领取',
  REVIEWING: '审核中',
  RESOLVED: '已处理',
  DISMISSED: '已驳回',
}

const statusOptions: Array<{ value: AdminCommunityReportStatus, label: string }> = [
  { value: 'PENDING', label: '待领取' },
  { value: 'REVIEWING', label: '审核中' },
  { value: 'RESOLVED', label: '已处理' },
  { value: 'DISMISSED', label: '已驳回' },
]

function localDateTime(value: string | null) {
  if (!value) {
    return ''
  }
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    return ''
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function reportView(report: AdminCommunityReport): ReportView {
  return {
    ...report,
    categoryLabel: categoryLabels.get(report.category) || '其他问题',
    statusText: statusLabels[report.status],
    createdText: localDateTime(report.createdAt),
    updatedText: localDateTime(report.updatedAt),
    reviewedText: localDateTime(report.reviewedAt),
  }
}

function actionCopy(action: ReviewAction) {
  if (action === 'CLAIM') {
    return { title: '领取举报', button: '确认领取', success: '举报已领取' }
  }
  if (action === 'RESOLVED') {
    return { title: '完成处理', button: '确认处理', success: '举报已处理' }
  }
  return { title: '驳回举报', button: '确认驳回', success: '举报已驳回' }
}

Page({
  data: {
    state: 'loading' as AdminPageState,
    reports: [] as ReportView[],
    status: 'PENDING' as AdminCommunityReportStatus,
    statusOptions,
    canManage: false,
    actionReportId: '',
    actionVersion: 0,
    action: '' as ReviewAction | '',
    actionTitle: '',
    actionButton: '',
    reason: '',
    processing: false,
    message: '',
  },

  onShow() {
    void this.loadReports()
  },

  async onPullDownRefresh() {
    try {
      await this.loadReports(true)
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  retryLoad() {
    void this.loadReports(true)
  },

  async loadReports(force = false) {
    const hasContent = this.data.reports.length > 0
    if (!hasContent) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const session = await mipAdminModule.getSession(force)
      const canManage = hasCapability(session.capabilities, 'community.reports.manage')
      if (!canManage) {
        this.setData({ state: 'forbidden', canManage: false, reports: [], message: '' })
        return
      }
      const response = await mipAdminModule.listCommunityReports(this.data.status, force)
      this.setData({
        state: 'ready',
        canManage: true,
        reports: response.items.map(reportView),
        message: '',
      })
    }
    catch (error) {
      if (isAdminForbiddenError(error)) {
        this.cancelAction()
        this.setData({ state: 'forbidden', canManage: false, reports: [], message: '' })
        return
      }
      this.setData(adminLoadFailure(error, { hasContent, fallbackMessage: '举报列表加载失败' }))
    }
  },

  chooseStatus(event: WechatMiniprogram.TouchEvent) {
    const status = String(event.currentTarget.dataset.status || '') as AdminCommunityReportStatus
    if (!statusLabels[status] || status === this.data.status || this.data.processing) {
      return
    }
    this.cancelAction()
    this.setData({ status, reports: [], state: 'loading', message: '' })
    void this.loadReports(true)
  },

  beginAction(event: WechatMiniprogram.TouchEvent) {
    const report = this.data.reports.find(item => item.reportId === String(event.currentTarget.dataset.id || ''))
    const action = String(event.currentTarget.dataset.action || '') as ReviewAction
    const valid = report && (
      (action === 'CLAIM' && report.status === 'PENDING')
      || (['RESOLVED', 'DISMISSED'].includes(action) && report.status === 'REVIEWING')
    )
    if (!valid || this.data.processing) {
      return
    }
    const copy = actionCopy(action)
    this.setData({
      actionReportId: report.reportId,
      actionVersion: report.version,
      action,
      actionTitle: copy.title,
      actionButton: copy.button,
      reason: '',
      message: '',
    })
  },

  updateReason(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ reason: event.detail.value })
  },

  cancelAction() {
    this.setData({
      actionReportId: '',
      actionVersion: 0,
      action: '',
      actionTitle: '',
      actionButton: '',
      reason: '',
    })
  },

  async confirmAction() {
    const action = this.data.action
    const reason = this.data.reason.trim()
    if (!this.data.canManage || !this.data.actionReportId || !action || this.data.processing) {
      return
    }
    if (!reason || reason.length > 300) {
      this.setData({ message: '请填写不超过 300 字的审核原因。' })
      return
    }
    const copy = actionCopy(action)
    const confirmation = await wx.showModal({
      title: copy.title,
      content: action === 'CLAIM'
        ? '领取后举报状态将变为审核中。'
        : `确认将举报标记为${action === 'RESOLVED' ? '已处理' : '已驳回'}。`,
      confirmText: copy.button,
    }).catch(() => null)
    if (!confirmation?.confirm) {
      return
    }
    this.setData({ processing: true, message: '' })
    try {
      if (action === 'CLAIM') {
        await mipAdminModule.mutate(() => mipAdminModule.gateway.claimCommunityReport({
          reportId: this.data.actionReportId,
          expectedVersion: this.data.actionVersion,
          reason,
        }))
      }
      else {
        await mipAdminModule.mutate(() => mipAdminModule.gateway.closeCommunityReport({
          reportId: this.data.actionReportId,
          expectedVersion: this.data.actionVersion,
          outcome: action,
          reason,
        }))
      }
      wx.showToast({ title: copy.success, icon: 'success' })
      this.cancelAction()
      await this.loadReports(true)
    }
    catch (error) {
      if (isAdminForbiddenError(error)) {
        this.cancelAction()
        this.setData({ state: 'forbidden', canManage: false, reports: [], message: '' })
      }
      else if (isAdminVersionConflict(error)
        || (error instanceof MipAdminError && error.code === 'INVALID_STATE')) {
        this.cancelAction()
        this.setData({ state: 'conflict', reports: [], message: '举报状态已变化，请重新加载后再操作。' })
      }
      else {
        this.setData({ message: error instanceof Error ? error.message : '举报审核失败' })
      }
    }
    finally {
      this.setData({ processing: false })
    }
  },
})
