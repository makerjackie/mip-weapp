import { isEventAccessRequirementError } from '../../../../modules/mip-events'
import { mipEventsModule } from '../../../../modules/mip-events/client'
import { mipAccessPageUrl } from '../../../../modules/mip-identity'
import { mipIdentityModule } from '../../../../modules/mip-identity/client'
import { mipMessagingModule } from '../../../../modules/mip-messaging/client'
import { caseNavigateTo } from '../../../../modules/platform/case-navigation'

function decoded(value: string) {
  try {
    return decodeURIComponent(value)
  }
  catch {
    return ''
  }
}

function scanTokenFromResult(...values: Array<string | undefined>) {
  for (const value of values) {
    const trimmed = String(value || '').trim()
    if (!trimmed) {
      continue
    }
    const query = trimmed.includes('?') ? trimmed.slice(trimmed.indexOf('?') + 1) : trimmed
    for (const key of ['token', 'scene']) {
      const match = new RegExp(`(?:^|&)${key}=([^&]+)`).exec(query)
      const token = match ? decoded(match[1]) : ''
      if (/^s1\.[\w-]{11}\.[\w-]{11}$/.test(token)) {
        return token
      }
    }
    const direct = decoded(trimmed) || trimmed
    if (/^s1\.[\w-]{11}\.[\w-]{11}$/.test(direct)) {
      return direct
    }
  }
  return ''
}

Page({
  data: {
    state: 'idle' as 'idle' | 'checking' | 'success' | 'error',
    eventId: '',
    scanToken: '',
    checkedInAt: '',
    message: '',
  },
  resumeCheckIn: false,
  accessRetryAttempted: false,

  onLoad(query: Record<string, string>) {
    const source = query.token || query.scene || ''
    const scanToken = scanTokenFromResult(source)
    this.setData(source && !scanToken
      ? {
          eventId: query.eventId || '',
          scanToken: '',
          state: 'error',
          message: '未识别到有效活动码，请打开微信扫一扫重新扫码。',
        }
      : { eventId: query.eventId || '', scanToken })
    if (scanToken) {
      void this.confirmCheckIn()
    }
  },

  onShow() {
    const resume = mipIdentityModule.consumePendingResume('packages/member/mip-events/check-in/index')
    if (resume?.action === 'INTERACT' && this.resumeCheckIn && this.data.scanToken) {
      this.resumeCheckIn = false
      this.accessRetryAttempted = true
      void this.confirmCheckIn()
    }
    else if (this.resumeCheckIn) {
      this.resumeCheckIn = false
    }
  },

  async scanCode() {
    try {
      if (mipMessagingModule.subscriptionCapability('CHECKIN_RESULT').available) {
        await mipMessagingModule.requestWechatSubscription('CHECKIN_RESULT').catch(() => undefined)
      }
      if (this.data.scanToken) {
        this.accessRetryAttempted = false
        await this.confirmCheckIn()
        return
      }
      const result = await wx.scanCode({ scanType: ['qrCode'] })
      const scanToken = scanTokenFromResult(result.path, result.result)
      if (!scanToken) {
        this.setData({ state: 'error', message: '未识别到有效活动码，请打开微信扫一扫重新扫码。' })
        return
      }
      this.accessRetryAttempted = false
      this.setData({ scanToken })
      await this.confirmCheckIn()
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!message.includes('cancel')) {
        this.setData({ state: 'error', message: '暂时无法扫描，请打开微信扫一扫重新扫码。' })
      }
    }
  },

  async confirmCheckIn() {
    if (!this.data.scanToken || this.data.state === 'checking') {
      return
    }
    this.setData({ state: 'checking', message: '' })
    try {
      const result = await mipEventsModule.checkIn(this.data.scanToken)
      this.setData({ state: 'success', eventId: String(result.eventId), checkedInAt: result.checkedInAt })
    }
    catch (error) {
      if (isEventAccessRequirementError(error)) {
        await this.recoverCheckInAccess()
        return
      }
      const message = error instanceof Error ? error.message : '签到失败'
      const invalidCredential = /活动码|token|credential/i.test(message)
      this.setData({
        scanToken: invalidCredential ? '' : this.data.scanToken,
        state: 'error',
        message: invalidCredential
          ? '未识别到有效活动码，请打开微信扫一扫重新扫码。'
          : message,
      })
    }
  },

  async recoverCheckInAccess() {
    if (this.accessRetryAttempted) {
      this.setData({ state: 'error', message: '身份状态仍未满足签到条件，请返回活动详情后重试。' })
      return
    }
    this.resumeCheckIn = true
    this.setData({ state: 'idle', message: '' })
    try {
      const session = await mipIdentityModule.beginProtectedAction({
        action: 'INTERACT',
        source: {
          navigation: 'navigateBack',
          route: 'packages/member/mip-events/check-in/index',
          query: {
            eventId: this.data.eventId,
            scene: this.data.scanToken,
          },
        },
      })
      if (!session.decision.ready) {
        caseNavigateTo({ url: mipAccessPageUrl(session.token) })
        return
      }
      this.resumeCheckIn = false
      this.accessRetryAttempted = true
      await this.confirmCheckIn()
    }
    catch {
      this.resumeCheckIn = false
      this.setData({ state: 'error', message: '身份状态暂时无法确认，请稍后重试。' })
    }
  },

  openInteraction() {
    if (this.data.eventId) {
      caseNavigateTo({ url: `/packages/member/mip-events/interaction/index?eventId=${encodeURIComponent(this.data.eventId)}` })
    }
  },
})
