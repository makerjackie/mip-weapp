import { membershipModule } from '../../../modules/membership/client'
import { caseNavigateTo, leaveSecondaryPage } from '../../../modules/platform/case-navigation'

const reasonCopy = {
  event: { title: '登录后继续报名', description: '用于活动联系、订单与售后' },
  membership: { title: '登录后继续支付', description: '用于会员凭证、订单与售后' },
  profile: { title: '微信手机号快捷登录', description: '用于活动、订单与必要联系' },
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    reason: 'profile' as 'event' | 'membership' | 'profile',
    title: reasonCopy.profile.title,
    description: reasonCopy.profile.description,
    phoneBound: false,
    bindingPhone: false,
    complete: false,
    message: '',
  },

  onLoad(query: Record<string, string>) {
    const reason = query.reason === 'event' || query.reason === 'membership' ? query.reason : 'profile'
    this.setData({ reason, ...reasonCopy[reason] })
  },

  onShow() {
    void this.loadState()
  },

  async loadState() {
    const cached = membershipModule.peekOverview()
    if (cached) {
      this.applyProfile(cached.profile)
    }
    else if (this.data.state !== 'ready') {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const overview = await membershipModule.load({ force: true })
      this.applyProfile(overview.profile)
    }
    catch (error) {
      this.setData(cached ? { message: '资料更新失败，已保留当前状态。' } : { state: 'error', message: error instanceof Error ? error.message : '资料加载失败' })
    }
  },

  applyProfile(profile: Awaited<ReturnType<typeof membershipModule.load>>['profile']) {
    this.setData({
      state: 'ready',
      phoneBound: profile.phoneBound,
      complete: profile.phoneBound,
      message: '',
    })
  },

  async bindPhone(event: WechatMiniprogram.CustomEvent<{ code?: string, errMsg?: string }>) {
    if (this.data.bindingPhone) {
      return
    }
    const code = event.detail.code
    if (!code) {
      const errMsg = event.detail.errMsg || ''
      this.setData({
        message: errMsg.includes('deny') || errMsg.includes('cancel')
          ? '你已取消授权，可稍后再完成。'
          : '手机号授权需在微信真机完成，模拟器无法代替。',
      })
      return
    }
    this.setData({ bindingPhone: true, message: '' })
    try {
      const profile = await membershipModule.bindPhone(code)
      if (!profile.phoneBound) {
        this.setData({ message: '手机号尚未绑定成功，请重试。' })
        return
      }
      this.applyProfile(profile)
      wx.showToast({ title: '登录成功', icon: 'success' })
      setTimeout(leaveSecondaryPage, 350, '/pages/index/index')
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '手机号授权失败' })
    }
    finally {
      this.setData({ bindingPhone: false })
    }
  },

  browseFirst() {
    leaveSecondaryPage('/pages/index/index')
  },

  openAgreement() {
    caseNavigateTo({ url: '/packages/member/about/index' })
  },

  openPrivacy() {
    caseNavigateTo({ url: '/packages/member/privacy/index' })
  },
})
