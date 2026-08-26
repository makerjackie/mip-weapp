import type {
  AdminMembershipDetailView,
  AdminMembershipDurationMonths,
  AdminMembershipGrantIntent,
} from '../../../modules/mip-admin'
import type { AdminPageState } from '../shared/page-state'
import {
  createAdminMembershipDetailView,
  hasCapability,
  MipAdminError,
  mipAdminModule,
  retainAdminMembershipGrantIntent,
} from '../../../modules/mip-admin'
import { formatLocalDateTime } from '../../../utils/date'
import { adminLoadFailure } from '../shared/page-state'

const durationOptions: Array<{ label: string, value: AdminMembershipDurationMonths }> = [
  { label: '1 个月', value: 1 },
  { label: '3 个月', value: 3 },
  { label: '6 个月', value: 6 },
  { label: '12 个月', value: 12 },
]

Page({
  data: {
    state: 'loading' as AdminPageState,
    userId: '',
    detail: null as AdminMembershipDetailView | null,
    canGrant: false,
    durationOptions,
    durationMonths: 1 as AdminMembershipDurationMonths,
    reason: '',
    submitting: false,
    message: '',
  },
  requestSeq: 0,
  grantIntent: null as AdminMembershipGrantIntent | null,
  onLoad(options: Record<string, string | undefined>) {
    const userId = String(options.userId || '').trim()
    this.setData({ userId })
    if (!userId) {
      this.setData({ state: 'error', message: '缺少用户标识。' })
    }
  },
  onShow() {
    if (this.data.userId) {
      void this.loadMembership()
    }
  },
  onHide() {
    this.requestSeq += 1
  },
  onUnload() {
    this.requestSeq += 1
  },
  async loadMembership(force = false) {
    const hasContent = this.data.detail !== null
    if (!hasContent) {
      this.setData({ state: 'loading', message: '' })
    }
    const seq = this.requestSeq + 1
    this.requestSeq = seq
    try {
      const session = await mipAdminModule.getSession(force)
      if (seq !== this.requestSeq) {
        return false
      }
      const canRead = hasCapability(session.capabilities, 'memberships.read')
      const canGrant = hasCapability(session.capabilities, 'memberships.adjust')
      if (!canRead) {
        this.setData({
          state: 'forbidden',
          detail: null,
          canGrant: false,
          message: '当前账号没有查看会员记录的权限。',
        })
        return false
      }
      const detail = await mipAdminModule.memberships.get(this.data.userId, force)
      if (seq !== this.requestSeq) {
        return false
      }
      this.setData({
        state: 'ready',
        detail: createAdminMembershipDetailView(detail, formatLocalDateTime),
        canGrant,
        message: '',
      })
      return true
    }
    catch (error) {
      if (seq !== this.requestSeq) {
        return false
      }
      this.setData(adminLoadFailure(error, {
        hasContent,
        fallbackMessage: '会员记录加载失败',
      }))
      return false
    }
  },
  retry() {
    void this.loadMembership(true)
  },
  openLedger() {
    wx.navigateTo({
      url: `/packages/admin/membership-ledger/index?userId=${encodeURIComponent(this.data.userId)}`,
    })
  },
  chooseDuration(event: WechatMiniprogram.TouchEvent) {
    if (this.data.submitting || this.data.detail?.user.status === 'CLOSED') {
      return
    }
    const durationMonths = Number(event.currentTarget.dataset.value)
    if (![1, 3, 6, 12].includes(durationMonths)) {
      return
    }
    this.grantIntent = null
    this.setData({
      durationMonths: durationMonths as AdminMembershipDurationMonths,
      message: this.data.state === 'conflict' ? '' : this.data.message,
      state: this.data.state === 'conflict' ? 'ready' : this.data.state,
    })
  },
  updateReason(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.grantIntent = null
    this.setData({
      reason: event.detail.value,
      message: this.data.state === 'conflict' ? '' : this.data.message,
      state: this.data.state === 'conflict' ? 'ready' : this.data.state,
    })
  },
  async grantMembership() {
    const detail = this.data.detail
    const reason = this.data.reason.trim()
    if (!detail || !this.data.canGrant || this.data.submitting || detail.user.status === 'CLOSED') {
      return
    }
    if (!reason) {
      this.setData({ message: '请填写开通原因。' })
      return
    }
    const draft = {
      userId: detail.user.id,
      durationMonths: this.data.durationMonths,
      reason,
      expectedChainVersion: detail.chainVersion,
    }
    this.grantIntent = retainAdminMembershipGrantIntent(this.grantIntent, draft)
    const intent = this.grantIntent
    this.setData({ submitting: true, message: '' })
    try {
      await mipAdminModule.memberships.grant({
        ...draft,
        idempotencyKey: intent.idempotencyKey,
      })
      this.grantIntent = null
      this.setData({ reason: '' })
      await this.loadMembership(true)
      wx.showToast({ title: '会员已开通', icon: 'success' })
    }
    catch (error) {
      if (error instanceof MipAdminError && error.code === 'VERSION_CONFLICT') {
        this.grantIntent = null
        const refreshed = await this.loadMembership(true)
        if (refreshed) {
          this.setData({
            state: 'conflict',
            message: '会员记录已更新，请确认最新有效期后重新提交。',
          })
        }
      }
      else if (error instanceof MipAdminError && error.code === 'INVALID_STATE') {
        this.grantIntent = null
        const refreshed = await this.loadMembership(true)
        if (refreshed && this.data.detail?.user.status === 'CLOSED') {
          this.setData({
            state: 'ready',
            message: '用户账号已关闭，不能人工开通会员。',
          })
        }
        else if (refreshed) {
          this.setData({ message: error.message })
        }
      }
      else if (error instanceof MipAdminError && error.code === 'FORBIDDEN') {
        this.grantIntent = null
        this.setData({
          state: 'forbidden',
          canGrant: false,
          message: '当前账号没有人工开通会员的权限。',
        })
      }
      else {
        this.setData({
          message: error instanceof Error ? error.message : '会员开通失败，请重试。',
        })
      }
    }
    finally {
      this.setData({ submitting: false })
    }
  },
})
