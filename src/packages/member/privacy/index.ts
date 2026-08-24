import {
  accountClosureConfirmationPhrase,
  createAccountClosureRequestTracker,
  MipIdentityGatewayError,
} from '../../../modules/mip-identity'
import { mipIdentityModule } from '../../../modules/mip-identity/client'
import { caseNavigateTo } from '../../../modules/platform/case-navigation'

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'processing' | 'success' | 'blocked' | 'conflict' | 'error',
    closureState: 'idle' as 'idle' | 'confirming' | 'processing' | 'failed',
    confirmationPhrase: '',
    requiredConfirmationPhrase: accountClosureConfirmationPhrase,
    userVersion: 0,
    closedAt: '',
    message: '',
  },
  closureRequest: null as ReturnType<typeof createAccountClosureRequestTracker> | null,

  onLoad() {
    // WeChat deep-clones free Page fields during instantiation, so create the stateful tracker afterwards.
    this.closureRequest = createAccountClosureRequestTracker()
    void this.loadAccountState()
  },

  accountClosureRequest() {
    if (!this.closureRequest) {
      this.closureRequest = createAccountClosureRequestTracker()
    }
    return this.closureRequest
  },

  async loadAccountState() {
    if (this.data.closureState === 'processing') {
      return
    }
    this.setData({ state: 'loading', message: '' })
    try {
      const snapshot = await mipIdentityModule.loadSnapshot()
      if (snapshot.userStatus === 'CLOSED') {
        this.accountClosureRequest().reset()
        this.setData({ state: 'success', closureState: 'idle', userVersion: snapshot.userVersion })
        return
      }
      this.setData({
        state: 'ready',
        closureState: 'idle',
        userVersion: snapshot.userVersion,
        message: '',
      })
    }
    catch (error) {
      this.setData({
        state: 'error',
        message: error instanceof Error ? error.message : '账号状态加载失败。',
      })
    }
  },

  openProfilePrivacy() {
    caseNavigateTo({ url: '/packages/member/mip-profile/index' })
  },

  openBlockedProfiles() {
    caseNavigateTo({ url: '/packages/member/mip-blocked/index' })
  },

  startAccountClosure() {
    if (this.data.state !== 'ready' || this.data.closureState === 'processing') {
      return
    }
    this.accountClosureRequest().reset()
    this.setData({
      closureState: 'confirming',
      confirmationPhrase: '',
      message: '',
    })
  },

  updateConfirmationPhrase(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    if (this.data.closureState === 'processing') {
      return
    }
    this.accountClosureRequest().reset()
    this.setData({ confirmationPhrase: event.detail.value, message: '' })
  },

  cancelAccountClosure() {
    if (this.data.closureState === 'processing') {
      return
    }
    this.accountClosureRequest().reset()
    this.setData({ closureState: 'idle', confirmationPhrase: '', message: '' })
  },

  async submitAccountClosure() {
    if (this.data.closureState === 'processing') {
      return
    }
    if (this.data.confirmationPhrase.trim() !== accountClosureConfirmationPhrase) {
      this.setData({ closureState: 'failed', message: `请输入“${accountClosureConfirmationPhrase}”` })
      return
    }
    const confirmed = await wx.showModal({
      title: '确认注销账号',
      content: '注销后无法恢复。公开资料和可撤销状态将关闭；订单、支付、退款、活动和审计记录按规则保留。',
      confirmText: '确认注销',
      confirmColor: '#C43D3D',
    }).catch(() => null)
    if (!confirmed?.confirm) {
      return
    }

    this.setData({ state: 'processing', closureState: 'processing', message: '' })
    try {
      const result = await mipIdentityModule.closeAccount({
        confirmationPhrase: accountClosureConfirmationPhrase,
        expectedVersion: this.data.userVersion,
        idempotencyKey: this.accountClosureRequest().current(),
      })
      this.accountClosureRequest().reset()
      this.setData({
        state: 'success',
        closureState: 'idle',
        confirmationPhrase: '',
        userVersion: result.version,
        closedAt: result.closedAt,
        message: '',
      })
    }
    catch (error) {
      const message = error instanceof Error ? error.message : '账号注销失败，请重试。'
      try {
        const snapshot = await mipIdentityModule.loadSnapshot()
        if (snapshot.userStatus === 'CLOSED') {
          this.accountClosureRequest().reset()
          this.setData({
            state: 'success',
            closureState: 'idle',
            confirmationPhrase: '',
            userVersion: snapshot.userVersion,
            message: '',
          })
          return
        }
        this.setData({ userVersion: snapshot.userVersion })
      }
      catch {}
      const state = error instanceof MipIdentityGatewayError
        ? error.code === 'ACCOUNT_CLOSURE_PENDING_SETTLEMENT'
          ? 'blocked'
          : error.code === 'ACCOUNT_CLOSURE_CONFLICT'
            ? 'conflict'
            : 'ready'
        : 'ready'
      this.setData({ state, closureState: 'failed', message })
    }
  },
})
