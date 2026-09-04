import { MipAdminError, mipAdminModule } from '../../../modules/mip-admin'
import { mipAccessPageUrl } from '../../../modules/mip-identity'
import { mipIdentityModule } from '../../../modules/mip-identity/client'

const PAGE_ROUTE = 'packages/admin/web-login-confirm/index'
const WEB_LOGIN_TOKEN_PATTERN = /^[\w-]{32}$/

type WebLoginConfirmState
  = | 'loading'
    | 'ready'
    | 'access'
    | 'confirming'
    | 'success'
    | 'expired'
    | 'error'
    | 'forbidden'

function confirmationFailure(error: unknown): { state: WebLoginConfirmState, message: string } {
  if (!(error instanceof MipAdminError)) {
    return { state: 'error', message: '网页登录确认失败，请稍后重试。' }
  }
  switch (error.code) {
    case 'FORBIDDEN':
      return { state: 'forbidden', message: '当前账号没有运营管理权限。' }
    case 'VALIDATION_FAILED':
    case 'WEB_LOGIN_INVALID_CODE':
      return { state: 'expired', message: '登录请求无效或已过期，请在电脑后台刷新二维码。' }
    case 'WEB_LOGIN_RATE_LIMITED':
      return { state: 'error', message: '尝试次数过多，请稍后在电脑后台刷新二维码。' }
    case 'WEB_LOGIN_CONFIGURATION_ERROR':
      return { state: 'error', message: '网页登录服务配置异常，请联系管理员。' }
    case 'WEB_LOGIN_TIMEOUT':
      return { state: 'error', message: '网页登录服务响应超时，请稍后重试。' }
    case 'WEB_LOGIN_NETWORK_ERROR':
      return { state: 'error', message: '网络连接失败，请检查网络后重试。' }
    case 'WEB_LOGIN_REQUEST_INVALID':
    case 'WEB_LOGIN_UNAVAILABLE':
    case 'SERVICE_UNAVAILABLE':
      return { state: 'error', message: '网页登录服务暂时不可用，请稍后重试。' }
    default:
      return { state: 'error', message: '网页登录确认失败，请稍后重试。' }
  }
}

Page({
  data: {
    state: 'loading' as WebLoginConfirmState,
    message: '',
    hasChallenge: false,
  },

  challengeToken: '',
  waitingForAccess: false,
  confirmationRequested: false,

  onLoad(query: Record<string, string>) {
    const scene = String(query.scene || '').trim()
    if (!WEB_LOGIN_TOKEN_PATTERN.test(scene)) {
      this.setData({
        state: 'ready',
        message: '请从电脑后台获取登录二维码后使用微信扫码。',
      })
      return
    }
    this.challengeToken = scene
    this.setData({ state: 'ready', message: '', hasChallenge: true })
  },

  onShow() {
    if (!this.waitingForAccess) {
      return
    }
    this.waitingForAccess = false
    const resume = mipIdentityModule.consumePendingResume(PAGE_ROUTE)
    if (resume?.action === 'ENTER_ADMIN' && this.confirmationRequested) {
      void this.submitConfirmation()
      return
    }
    this.confirmationRequested = false
    this.setData({ state: 'ready', message: '' })
  },

  async confirmWebLogin() {
    if (this.data.state === 'confirming' || this.data.state === 'success') {
      return
    }
    if (!WEB_LOGIN_TOKEN_PATTERN.test(this.challengeToken)) {
      this.setData({
        state: 'expired',
        message: '登录请求无效或已过期，请在电脑后台刷新二维码。',
      })
      return
    }
    this.confirmationRequested = true
    this.setData({ state: 'access', message: '' })
    try {
      const session = await mipIdentityModule.beginProtectedAction({
        action: 'ENTER_ADMIN',
        requiredCapability: 'admin:enter',
        source: { navigation: 'navigateBack' },
      })
      if (session.decision.ready) {
        await this.submitConfirmation()
        return
      }
      if (session.decision.block === 'FORBIDDEN') {
        this.confirmationRequested = false
        this.setData({ state: 'forbidden', message: '当前账号没有运营管理权限。' })
        return
      }
      this.waitingForAccess = true
      wx.navigateTo({
        url: mipAccessPageUrl(session.token),
        fail: () => {
          this.waitingForAccess = false
          this.confirmationRequested = false
          this.setData({ state: 'error', message: '身份确认页面无法打开，请稍后重试。' })
        },
      })
    }
    catch {
      this.confirmationRequested = false
      this.setData({ state: 'error', message: '身份状态暂时无法确认，请稍后重试。' })
    }
  },

  async submitConfirmation() {
    if (!this.confirmationRequested || !WEB_LOGIN_TOKEN_PATTERN.test(this.challengeToken)) {
      return
    }
    this.setData({ state: 'confirming', message: '' })
    try {
      await mipAdminModule.session.confirmWebLoginToken(this.challengeToken)
      this.challengeToken = ''
      this.confirmationRequested = false
      this.setData({ state: 'success', message: '' })
    }
    catch (error) {
      this.confirmationRequested = false
      this.setData(confirmationFailure(error))
    }
  },
})
