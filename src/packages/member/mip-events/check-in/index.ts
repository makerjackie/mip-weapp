import type { CheckInScene } from '../../../../modules/mip-events'
import { isEventAccessRequirementError, MipEventsError } from '../../../../modules/mip-events'
import { mipCheckInResumeStore, mipEventsModule } from '../../../../modules/mip-events/client'
import { mipAccessPageUrl } from '../../../../modules/mip-identity'
import { mipIdentityModule } from '../../../../modules/mip-identity/client'
import { caseNavigateTo } from '../../../../platform/navigation/client'
import { formatChineseMonthDayTime } from '../../../../utils/date'

function decoded(value: string) {
  try {
    return decodeURIComponent(value)
  }
  catch {
    return ''
  }
}

/** MIW-103：CHECKIN_NOT_OPEN 详情里的 opensAt（开始前 6 小时起）转中文提示；缺失时退化为通用文案。 */
function checkInNotOpenMessage(details: Record<string, unknown> | null) {
  const opensAt = Date.parse(String(details?.opensAt || ''))
  return Number.isFinite(opensAt)
    ? `活动未开始，${formatChineseMonthDayTime(new Date(opensAt))}起可现场扫码签到（开始前 6 小时开放）。`
    : '活动未开始，开始前 6 小时起可现场扫码签到。'
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
    state: 'idle' as 'idle' | 'checking' | 'success' | 'registration-required' | 'registration-pending' | 'not-open' | 'error',
    eventId: '',
    hasScanToken: false,
    checkedInAt: '',
    message: '',
  },
  scanToken: '',
  resumeToken: '',
  resolvedScene: null as CheckInScene | null,
  resumeCheckIn: false,
  accessRetryAttempted: false,

  onLoad(query: Record<string, string>) {
    if (query.resumeCheckIn === '1') {
      const intent = mipCheckInResumeStore.peek(query.eventId || undefined)
      if (!intent) {
        this.setData({
          eventId: query.eventId || '',
          hasScanToken: false,
          state: 'error',
          message: '请重新扫描现场签到码。',
        })
        return
      }
      this.resumeToken = intent.resumeToken
      this.setData({ eventId: intent.eventId, hasScanToken: true })
      void this.confirmCheckIn()
      return
    }
    const source = query.token || query.scene || ''
    const scanToken = scanTokenFromResult(source)
    this.scanToken = scanToken
    this.setData(source && !scanToken
      ? {
          eventId: query.eventId || '',
          hasScanToken: false,
          state: 'error',
          message: '未识别到有效活动码，请打开微信扫一扫重新扫码。',
        }
      : { eventId: query.eventId || '', hasScanToken: Boolean(scanToken) })
    if (scanToken) {
      void this.confirmCheckIn()
    }
  },

  onShow() {
    const resume = mipIdentityModule.consumePendingResume('packages/member/mip-events/check-in/index')
    if (resume?.action === 'INTERACT' && this.resumeCheckIn && this.hasCheckInCredential()) {
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
      if (this.hasCheckInCredential()) {
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
      this.scanToken = scanToken
      this.resumeToken = ''
      this.resolvedScene = null
      this.setData({ eventId: '', hasScanToken: true })
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
    if (!this.hasCheckInCredential() || this.data.state === 'checking') {
      return
    }
    this.setData({ state: 'checking', message: '' })
    try {
      if (!this.resumeToken) {
        const scene = await mipEventsModule.resolveCheckInScene(this.scanToken)
        if (this.data.eventId && String(scene.eventId) !== this.data.eventId) {
          throw new MipEventsError('VALIDATION_FAILED', '活动码与当前活动不一致')
        }
        this.resolvedScene = scene
        this.resumeToken = scene.resumeToken
        this.scanToken = ''
        this.setData({ eventId: String(scene.eventId) })
      }
      const result = await mipEventsModule.checkIn(this.resumeToken)
      mipCheckInResumeStore.clear(String(result.eventId))
      this.resumeToken = ''
      this.resolvedScene = null
      this.setData({ state: 'success', eventId: String(result.eventId), checkedInAt: result.checkedInAt })
    }
    catch (error) {
      if (isEventAccessRequirementError(error)) {
        await this.recoverCheckInAccess()
        return
      }
      // MIW-103：活动未开始是可预期的正常状态，给引导态而不是错误态；签到意图保留，
      // not-open 态出口是「查看活动详情/重新扫码」，重扫或经报名续签（resumeCheckIn=1
      // 自动 confirmCheckIn）回本页即可补签，详情页同款横幅到点也会自动补签。
      if (error instanceof MipEventsError && error.code === 'CHECKIN_NOT_OPEN') {
        this.retainCheckInIntent()
        this.setData({
          state: 'not-open',
          message: checkInNotOpenMessage(error.details),
        })
        return
      }
      if (error instanceof MipEventsError && error.code === 'CHECKIN_EXPIRED') {
        mipCheckInResumeStore.clear(this.data.eventId || undefined)
        this.scanToken = ''
        this.resumeToken = ''
        this.resolvedScene = null
        this.setData({
          hasScanToken: false,
          state: 'error',
          message: '现场活动码已过期，请向工作人员获取最新活动码。',
        })
        return
      }
      if (error instanceof MipEventsError && error.code === 'REGISTRATION_REQUIRED') {
        this.retainCheckInIntent()
        this.setData({
          state: 'registration-required',
          message: '当前账号尚未完成本场活动报名。报名成功后仍会重新核对活动码、有效期和报名资格。',
        })
        return
      }
      if (error instanceof MipEventsError && error.code === 'REGISTRATION_PENDING') {
        this.retainCheckInIntent()
        this.setData({
          state: 'registration-pending',
          message: '报名尚未完成，请先在“我的活动”查看报名结果。',
        })
        return
      }
      const message = error instanceof Error ? error.message : '签到失败'
      const invalidCredential = /活动码|凭证|失效|签到时间|token|credential/i.test(message)
      if (invalidCredential) {
        mipCheckInResumeStore.clear(this.data.eventId || undefined)
        this.scanToken = ''
        this.resumeToken = ''
        this.resolvedScene = null
      }
      this.setData({
        hasScanToken: invalidCredential ? false : this.hasCheckInCredential(),
        state: 'error',
        message: invalidCredential
          ? '未识别到有效活动码，请打开微信扫一扫重新扫码。'
          : message,
      })
    }
  },

  hasCheckInCredential() {
    return Boolean(this.scanToken || this.resumeToken)
  },

  async recoverCheckInAccess() {
    if (this.accessRetryAttempted) {
      this.setData({ state: 'error', message: '身份状态仍未满足签到条件，请返回活动详情后重试。' })
      return
    }
    this.resumeCheckIn = true
    this.retainCheckInIntent()
    this.setData({ state: 'idle', message: '' })
    try {
      const session = await mipIdentityModule.beginProtectedAction({
        action: 'INTERACT',
        source: {
          navigation: 'navigateBack',
          route: 'packages/member/mip-events/check-in/index',
          query: {
            eventId: this.data.eventId,
            resumeCheckIn: '1',
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

  retainCheckInIntent() {
    if (this.resolvedScene) {
      mipCheckInResumeStore.save(this.resolvedScene)
    }
  },

  openRegistration() {
    const intent = mipCheckInResumeStore.peek(this.data.eventId)
    if (!intent) {
      this.scanToken = ''
      this.resumeToken = ''
      this.resolvedScene = null
      this.setData({ state: 'error', hasScanToken: false, message: '请重新扫描现场签到码。' })
      return
    }
    caseNavigateTo({
      url: `/packages/member/mip-events/registration/index?eventId=${encodeURIComponent(intent.eventId)}&resumeCheckIn=1`,
    })
  },

  retryRegistration() {
    void this.confirmCheckIn()
  },

  scanAnother() {
    mipCheckInResumeStore.clear(this.data.eventId || undefined)
    this.scanToken = ''
    this.resumeToken = ''
    this.resolvedScene = null
    this.accessRetryAttempted = false
    this.setData({ state: 'idle', eventId: '', hasScanToken: false, message: '' })
    void this.scanCode()
  },

  openMyEvents() {
    caseNavigateTo({ url: '/packages/member/mip-events/mine/index' })
  },

  /** MIW-103：活动未开始时引导用户先浏览活动详情，开放后再回来签到。 */
  openEventDetail() {
    if (!this.data.eventId) {
      return
    }
    caseNavigateTo({
      url: `/packages/member/mip-events/detail/index?eventId=${encodeURIComponent(this.data.eventId)}`,
    })
  },

  openInteraction() {
    if (this.data.eventId) {
      // journey-review J2-02：互动页并入参与人列表，直达「我的心动」tab。
      caseNavigateTo({ url: `/packages/member/mip-events/participants/index?eventId=${encodeURIComponent(this.data.eventId)}&view=SENT` })
    }
  },
})
