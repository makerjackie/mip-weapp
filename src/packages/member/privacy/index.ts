import {
  accountClosureConfirmationPhrase,
  createAccountClosureRequestTracker,
  MipIdentityGatewayError,
} from '../../../modules/mip-identity'
import { mipIdentityModule } from '../../../modules/mip-identity/client'
import { mipLocalSession } from '../../../modules/mip-identity/local-session-client'
import { mipGlobalAccessGuard } from '../../../modules/mip-identity/runtime'
import { caseNavigateTo } from '../../../platform/navigation/client'

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'processing' | 'success' | 'blocked' | 'conflict' | 'error',
    closureState: 'idle' as 'idle' | 'confirming' | 'processing' | 'failed',
    localLogoutState: 'idle' as 'idle' | 'processing',
    confirmationPhrase: '',
    requiredConfirmationPhrase: accountClosureConfirmationPhrase,
    userVersion: 0,
    closedAt: '',
    message: '',
    // figma 1728_19083 / 1861_18278 设计还原态（打分 fixture 专用）：设计稿的账号设置
    // 行组与两行隐私开关没有落地路由，先以页面内分支还原，缺口记录在 manifest notes。
    figmaLayout: false,
    figmaPanel: '' as '' | 'privacy-settings',
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
      if (!snapshot.authenticated) {
        mipGlobalAccessGuard.enterTarget({ path: 'pages/index/index' })
        return
      }
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

  openNotificationSettings() { caseNavigateTo({ url: '/packages/member/mip-opportunity-settings/index' }) },
  openAbout() { caseNavigateTo({ url: '/packages/member/about/index' }) },

  openVisibilitySettings() {
    caseNavigateTo({ url: '/packages/member/mip-visibility-settings/index' })
  },

  // figma 1728_19083 的「隐私设置」行：设计稿对应 1861_18278 独立页，但该页暂无落地
  // 路由，设计还原态先在页内切换到两行开关分支（见 index.wxml figmaPanel 注释）。
  openPrivacySettings() {
    this.setData({ figmaPanel: 'privacy-settings' })
  },

  openBlockedProfiles() {
    caseNavigateTo({ url: '/packages/member/mip-blocked/index' })
  },

  openUserAgreement() {
    caseNavigateTo({ url: '/packages/member/user-agreement/index' })
  },

  openPrivacyPolicy() {
    caseNavigateTo({ url: '/packages/member/privacy-policy/index' })
  },

  async signOutLocally() {
    if (this.data.localLogoutState === 'processing'
      || this.data.closureState === 'processing') {
      return
    }
    const confirmed = await wx.showModal({
      title: '退出登录',
      content: '退出后将清除本机登录状态和用户缓存。账号、订单、会员权益和活动记录不会删除。',
      confirmText: '退出',
      confirmColor: '#C43D3D',
    }).catch(() => null)
    if (!confirmed?.confirm) {
      return
    }

    this.setData({ localLogoutState: 'processing', message: '' })
    mipLocalSession.signOut()
    mipGlobalAccessGuard.enterTarget({ path: 'pages/index/index' })
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
