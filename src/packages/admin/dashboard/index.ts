import type { AdminPageState } from '../shared/page-state'
import { MipAdminError, mipAdminModule } from '../../../modules/mip-admin'
import { adminLoadFailure } from '../shared/page-state'

function webLoginFailureMessage(error: unknown): string {
  if (!(error instanceof MipAdminError)) {
    return '网页登录确认失败，请重试。'
  }
  switch (error.code) {
    case 'VALIDATION_FAILED':
      return '请输入网页显示的 6 位数字登录码。'
    case 'WEB_LOGIN_INVALID_CODE':
      return '登录码无效或已过期，请在网页获取新的登录码。'
    case 'WEB_LOGIN_REQUEST_INVALID':
      return '网页登录确认请求无效，请刷新网页后重试。'
    case 'WEB_LOGIN_RATE_LIMITED':
      return '尝试次数过多，请稍后在网页获取新的登录码。'
    case 'WEB_LOGIN_CONFIGURATION_ERROR':
      return '网页登录服务配置异常，请联系管理员。'
    case 'WEB_LOGIN_TIMEOUT':
      return '网页登录服务响应超时，请稍后重试。'
    case 'WEB_LOGIN_NETWORK_ERROR':
      return '网络连接失败，请检查网络后重试。'
    case 'WEB_LOGIN_UNAVAILABLE':
    case 'SERVICE_UNAVAILABLE':
      return '网页登录服务暂时不可用，请稍后重试。'
    default:
      return '网页登录确认失败，请重试。'
  }
}

Page({
  data: {
    state: 'loading' as AdminPageState,
    message: '',
    webLoginOpen: false,
    webLoginCode: '',
    webLoginBusy: false,
    webLoginError: '',
    webLoginConfirmed: false,
  },

  onShow() {
    void this.loadSession()
  },

  async loadSession(force = false) {
    const hasContent = this.data.state === 'ready'
    if (!hasContent) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const session = await mipAdminModule.session.get(force)
      this.setData({
        state: session.enabled ? 'ready' : 'forbidden',
        message: session.enabled ? '' : '当前账号没有现场工作台权限。',
      })
    }
    catch (error) {
      this.setData(adminLoadFailure(error, {
        hasContent,
        fallbackMessage: '现场工作台加载失败',
      }))
    }
  },

  retrySession() {
    void this.loadSession(true)
  },

  openEvents() {
    void wx.navigateTo({ url: '/packages/admin/managed-events/index' })
  },

  openWebLogin() {
    this.setData({
      webLoginOpen: true,
      webLoginCode: '',
      webLoginBusy: false,
      webLoginError: '',
      webLoginConfirmed: false,
    })
  },

  closeWebLogin() {
    if (!this.data.webLoginBusy) {
      this.setData({ webLoginOpen: false })
    }
  },

  changeWebLoginCode(event: WechatMiniprogram.Input) {
    const webLoginCode = String(event.detail.value || '')
      .replace(/\D/g, '')
      .slice(0, 6)
    this.setData({ webLoginCode, webLoginError: '', webLoginConfirmed: false })
  },

  async confirmWebLogin() {
    if (this.data.webLoginBusy) {
      return
    }
    if (!/^\d{6}$/.test(this.data.webLoginCode)) {
      this.setData({ webLoginError: '请输入网页显示的 6 位数字登录码。' })
      return
    }
    this.setData({ webLoginBusy: true, webLoginError: '', webLoginConfirmed: false })
    try {
      await mipAdminModule.session.confirmWebLogin(this.data.webLoginCode)
      this.setData({ webLoginBusy: false, webLoginConfirmed: true })
    }
    catch (error) {
      this.setData({
        webLoginBusy: false,
        webLoginError: webLoginFailureMessage(error),
      })
    }
  },

  async onPullDownRefresh() {
    try {
      await this.loadSession(true)
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },
})
