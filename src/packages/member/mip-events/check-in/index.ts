import { mipEventsModule } from '../../../../modules/mip-events/client'
import { caseNavigateTo } from '../../../../modules/platform/case-navigation'

function scanTokenFromResult(value: string) {
  const trimmed = value.trim()
  const marker = 'token='
  const markerIndex = trimmed.indexOf(marker)
  if (markerIndex >= 0) {
    return decodeURIComponent(trimmed.slice(markerIndex + marker.length).split('&')[0])
  }
  return trimmed
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
    const scanToken = source ? decodeURIComponent(source) : ''
    this.setData({ eventId: query.eventId || '', scanToken })
    if (scanToken) {
      void this.confirmCheckIn()
    }
  },

  async scanCode() {
    try {
      const result = await wx.scanCode({ scanType: ['qrCode'] })
      const scanToken = scanTokenFromResult(result.result)
      if (!scanToken) {
        this.setData({ state: 'error', message: '未识别到有效的活动码。' })
        return
      }
      this.setData({ scanToken })
      await this.confirmCheckIn()
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!message.includes('cancel')) {
        this.setData({ state: 'error', message: '暂时无法扫描活动码。' })
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
      this.setData({ state: 'error', message: error instanceof Error ? error.message : '签到失败' })
    }
  },

  openInteraction() {
    if (this.data.eventId) {
      caseNavigateTo({ url: `/packages/member/mip-events/interaction/index?eventId=${encodeURIComponent(this.data.eventId)}` })
    }
  },
})
