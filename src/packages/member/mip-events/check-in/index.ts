import { mipEventsModule } from '../../../../modules/mip-events/client'
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

  async scanCode() {
    try {
      const result = await wx.scanCode({ scanType: ['qrCode'] })
      const scanToken = scanTokenFromResult(result.path, result.result)
      if (!scanToken) {
        this.setData({ state: 'error', message: '未识别到有效活动码，请打开微信扫一扫重新扫码。' })
        return
      }
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
      const message = error instanceof Error ? error.message : '签到失败'
      this.setData({
        state: 'error',
        message: /活动码|token|credential/i.test(message)
          ? '未识别到有效活动码，请打开微信扫一扫重新扫码。'
          : message,
      })
    }
  },

  openInteraction() {
    if (this.data.eventId) {
      caseNavigateTo({ url: `/packages/member/mip-events/interaction/index?eventId=${encodeURIComponent(this.data.eventId)}` })
    }
  },
})
