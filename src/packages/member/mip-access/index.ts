import type { AccessReturnContext, AccessSession } from '../../../modules/mip-identity'
import { accessReturnUrl } from '../../../modules/mip-identity'
import { mipIdentityModule } from '../../../modules/mip-identity/client'
import {
  exitMipMiniProgram,
  mipGlobalAccessGuard,
} from '../../../modules/mip-identity/runtime'

const requirementCopy = {
  AUTHENTICATED: {
    title: '需要微信身份',
    description: '当前微信身份不可用，请返回后重试。',
  },
  AGREEMENTS: {
    title: '确认协议',
    description: '继续前请阅读并确认当前协议。',
  },
  PHONE: {
    title: '绑定手机号',
    description: '手机号用于活动联系、订单与售后，不会公开展示。',
  },
  PROFILE: {
    title: '完善资料',
    description: '请填写昵称并选择主城市分会。',
  },
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error' | 'expired',
    token: '',
    title: '',
    description: '',
    nextRequirement: '' as '' | keyof typeof requirementCopy,
    ready: false,
    agreements: [] as AccessSession['snapshot']['agreements'],
    agreementsChecked: false,
    membershipLabel: '嘉宾',
    globalGate: false,
    cancelLabel: '取消',
    submitting: false,
    message: '',
  },

  onLoad(query: Record<string, string>) {
    const token = String(query.token || '')
    const intent = token ? mipIdentityModule.peekIntent(token) : null
    if (!intent) {
      this.setData({ state: 'expired' })
      return
    }
    const globalGate = intent.action === 'ENTER_APP'
    this.setData({
      token,
      globalGate,
      cancelLabel: globalGate ? '退出小程序' : '取消',
    })
  },

  onShow() {
    if (this.data.token) {
      void this.loadAccess()
    }
  },

  async loadAccess() {
    this.setData({ state: 'loading', message: '' })
    try {
      const session = await mipIdentityModule.loadAccess(this.data.token)
      this.applySession(session)
      await this.continueGlobalAccess(session)
    }
    catch (error) {
      const message = error instanceof Error ? error.message : ''
      this.setData(message === 'ACCESS_INTENT_EXPIRED'
        ? { state: 'expired' }
        : { state: 'error', message: '身份服务暂时不可用，请稍后重试。' })
    }
  },

  applySession(session: AccessSession) {
    const requirement = session.decision.nextRequirement || ''
    const copy = requirement
      ? requirementCopy[requirement]
      : {
          title: '信息已完成',
          description: '现在可以返回并继续刚才的操作。',
        }
    this.setData({
      state: 'ready',
      title: copy.title,
      description: copy.description,
      nextRequirement: requirement,
      ready: session.decision.ready,
      agreements: session.snapshot.agreements,
      membershipLabel: session.snapshot.membership.kind === 'PLAYER' ? '玩家' : '嘉宾',
      globalGate: session.intent.action === 'ENTER_APP',
      cancelLabel: session.intent.action === 'ENTER_APP' ? '退出小程序' : '取消',
      message: session.decision.block === 'FORBIDDEN' ? '当前没有权限进入该功能。' : '',
    })
  },

  async continueGlobalAccess(session: AccessSession) {
    if (session.intent.action !== 'ENTER_APP' || !session.decision.ready) {
      return
    }
    this.setData({ submitting: false })
    await this.finish()
  },

  toggleAgreements(event: WechatMiniprogram.CheckboxGroupChange) {
    this.setData({ agreementsChecked: event.detail.value.includes('accepted') })
  },

  async acceptAgreements() {
    if (!this.data.agreementsChecked || this.data.submitting) {
      this.setData({ message: this.data.agreementsChecked ? '' : '请先确认已阅读并同意协议。' })
      return
    }
    this.setData({ submitting: true, message: '' })
    try {
      const agreements = this.data.agreements.map(agreement => ({
        key: agreement.key,
        version: agreement.version,
      }))
      const session = await mipIdentityModule.acceptAgreements(this.data.token, { agreements })
      this.applySession(session)
      await this.continueGlobalAccess(session)
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '协议确认失败，请重试。' })
    }
    finally {
      this.setData({ submitting: false })
    }
  },

  async bindPhone(event: WechatMiniprogram.CustomEvent<{ code?: string, errMsg?: string }>) {
    if (this.data.submitting) {
      return
    }
    const code = String(event.detail.code || '')
    if (!code) {
      const cancelled = /cancel|deny/i.test(String(event.detail.errMsg || ''))
      this.setData({
        message: cancelled
          ? '你已取消手机号授权，可以稍后再完成。'
          : '手机号授权必须在微信真机完成。',
      })
      return
    }
    this.setData({ submitting: true, message: '' })
    try {
      this.applySession(await mipIdentityModule.bindWechatPhone(this.data.token, code))
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '手机号绑定失败，请重试。' })
    }
    finally {
      this.setData({ submitting: false })
    }
  },

  openAgreement(event: WechatMiniprogram.TouchEvent) {
    const documentPath = String(event.currentTarget.dataset.path || '')
    if (/^\/[\w/-]+$/.test(documentPath)) {
      wx.navigateTo({ url: documentPath })
    }
  },

  openProfile() {
    wx.navigateTo({
      url: `/packages/member/mip-profile/index?token=${encodeURIComponent(this.data.token)}`,
    })
  },

  async finish() {
    if (this.data.submitting) {
      return
    }
    this.setData({ submitting: true, message: '' })
    try {
      const intent = mipIdentityModule.peekIntent(this.data.token)
      const context = await mipIdentityModule.complete(this.data.token)
      this.navigateToSource(context, intent?.action || '')
    }
    catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (message.endsWith('_REQUIRED')) {
        await this.loadAccess()
      }
      else {
        this.setData({ message: '状态确认失败，请重试。' })
      }
    }
    finally {
      this.setData({ submitting: false })
    }
  },

  cancel() {
    const intent = mipIdentityModule.peekIntent(this.data.token)
    const context = mipIdentityModule.cancel(this.data.token)
    if (intent?.action === 'ENTER_APP' || this.data.globalGate) {
      exitMipMiniProgram()
      return
    }
    this.navigateToSource(context, intent?.action || '')
  },

  restartAccess() {
    if (this.data.token) {
      mipIdentityModule.cancel(this.data.token)
    }
    mipGlobalAccessGuard.enterTarget({ path: 'pages/index/index' })
  },

  navigateToSource(context: AccessReturnContext | null, action: string) {
    if (!context || context.navigation === 'navigateBack') {
      const fallbackUrl = context
        ? accessReturnUrl(context, action || undefined) || '/pages/index/index'
        : '/pages/index/index'
      wx.navigateBack({
        delta: 1,
        fail: () => wx.reLaunch({ url: fallbackUrl }),
      })
      return
    }
    const resumeAction = action === 'ENTER_APP' ? undefined : action
    const url = accessReturnUrl(context, resumeAction) || '/pages/index/index'
    if (context.navigation === 'switchTab') {
      wx.switchTab({ url: context.route || '/pages/index/index' })
      return
    }
    if (context.navigation === 'reLaunch') {
      wx.reLaunch({ url })
      return
    }
    wx.redirectTo({
      url,
      fail: () => wx.reLaunch({ url: '/pages/index/index' }),
    })
  },
})
