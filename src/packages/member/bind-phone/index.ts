import type { IdentityAccessSnapshot } from '../../../modules/mip-identity/contracts'
import { mipIdentityModule } from '../../../modules/mip-identity/client'
import { mipGlobalAccessGuard } from '../../../modules/mip-identity/runtime'
import { leaveSecondaryPage } from '../../../platform/navigation/client'

const PHONE_PATTERN = /^1\d{10}$/
const SMS_CODE_PATTERN = /^\d{6}$/
// Both verification paths commit through the identity domain; the server owns phone conflicts.
Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    currentPhoneMasked: '',
    newPhone: '',
    smsCode: '',
    sendCountdown: 0,
    sendingSms: false,
    rebinding: false,
    message: '',
    loginSheetOpen: false,
    loginSheetBusy: false,
    loginSheetSubtitle: '将获取你微信绑定的手机号，用于换绑确认\n换绑成功后，新手机号替代原手机号用于登录与通知',
  },
  countdownTimer: undefined as ReturnType<typeof setInterval> | undefined,
  navigationTimer: undefined as ReturnType<typeof setTimeout> | undefined,

  active: true,
  smsChallenge: undefined as { id: string, phone: string, expiresAt: number } | undefined,
  countdownDeadline: 0,

  onLoad() {
    this.active = true
    void this.loadAccountState()
  },

  onShow() {
    this.updateCountdown()
  },

  onUnload() {
    this.active = false
    this.stopCountdown()
    if (this.navigationTimer !== undefined) {
      clearTimeout(this.navigationTimer)
      this.navigationTimer = undefined
    }
  },

  async loadAccountState() {
    this.setData({ state: 'loading', message: '' })
    try {
      const snapshot = await mipIdentityModule.loadSnapshot()
      if (!this.active) {
        return
      }
      if (!snapshot.authenticated) {
        mipGlobalAccessGuard.enterTarget({ path: 'pages/index/index' })
        return
      }
      // Access snapshots omit private contact data; only the caller's profile exposes its masked phone.
      const profile = await mipIdentityModule.getProfile()
      if (!this.active) {
        return
      }
      this.setData({
        state: 'ready',
        currentPhoneMasked: profile.privateContact?.phoneMasked || (snapshot.phoneBound ? '已绑定手机号' : ''),
      })
    }
    catch (error) {
      if (!this.active) {
        return
      }
      this.setData({
        state: 'error',
        message: error instanceof Error ? error.message : '账号状态加载失败。',
      })
    }
  },

  onNewPhoneInput(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    if (this.data.rebinding || this.data.loginSheetBusy) {
      return
    }
    if (event.detail.value !== this.data.newPhone) {
      this.smsChallenge = undefined
    }
    this.setData({ newPhone: event.detail.value, smsCode: '', message: '' })
  },

  onSmsCodeInput(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ smsCode: event.detail.value, message: '' })
  },

  // 路径 A：弹 mip-login-sheet（subtitle 换绑变体），授权由组件内 getPhoneNumber 完成。
  openWechatBind() {
    if (this.data.loginSheetOpen || this.data.sendingSms || this.data.rebinding) {
      return
    }
    this.setData({ loginSheetOpen: true, message: '' })
  },

  onLoginSheetDismiss() {
    this.setData({ loginSheetOpen: false })
  },

  async onLoginSheetPhone(event: WechatMiniprogram.CustomEvent<{ code?: string, errMsg?: string }>) {
    if (this.data.loginSheetBusy || this.data.sendingSms || this.data.rebinding) {
      return
    }
    const code = String(event.detail.code || '')
    if (!code) {
      const cancelled = /cancel|deny|denied/i.test(String(event.detail.errMsg || ''))
      this.setData({ loginSheetOpen: false })
      wx.showToast({
        title: cancelled ? '你已取消手机号授权，可以稍后再完成。' : '手机号授权必须在微信真机完成。',
        icon: 'none',
      })
      return
    }
    this.setData({ loginSheetBusy: true, message: '' })
    try {
      const snapshot = await mipIdentityModule.rebindWechatPhone(code)
      if (this.active) {
        this.finishRebind(snapshot)
      }
    }
    catch (error) {
      // 号码已被占用等错误：保留已输入内容，行内克制提示。
      if (!this.active) {
        return
      }
      this.setData({
        loginSheetOpen: false,
        loginSheetBusy: false,
        message: error instanceof Error ? error.message : '换绑失败，请重试。',
      })
    }
  },

  async requestSmsCode() {
    this.updateCountdown()
    if (this.data.sendCountdown > 0 || this.data.sendingSms || this.data.rebinding || this.data.loginSheetBusy) {
      return
    }
    const phone = this.data.newPhone.trim()
    if (!PHONE_PATTERN.test(phone)) {
      this.setData({ message: '请先输入 11 位新手机号。' })
      return
    }
    this.smsChallenge = undefined
    this.setData({ sendingSms: true, message: '' })
    try {
      const result = await mipIdentityModule.requestPhoneSms(phone)
      if (!this.active) {
        return
      }
      this.startCountdown(result.retryAfterSeconds)
      if (this.data.newPhone.trim() === phone) {
        this.smsChallenge = { id: result.challengeId, phone, expiresAt: Date.parse(result.expiresAt) }
        this.setData({ smsCode: '', message: '验证码请求已受理，请查看手机短信。' })
      }
    }
    catch (error) {
      if (this.active) {
        this.setData({ message: error instanceof Error ? error.message : '验证码发送失败，请稍后重试。' })
      }
    }
    finally {
      if (this.active) {
        this.setData({ sendingSms: false })
      }
    }
  },

  startCountdown(seconds: number) {
    this.stopCountdown()
    this.countdownDeadline = Date.now() + seconds * 1000
    this.updateCountdown()
    this.countdownTimer = setInterval(() => this.updateCountdown(), 1000)
  },

  updateCountdown() {
    const remaining = Math.max(0, Math.ceil((this.countdownDeadline - Date.now()) / 1000))
    if (this.active) {
      this.setData({ sendCountdown: remaining })
    }
    if (remaining === 0) {
      this.stopCountdown()
    }
  },

  stopCountdown() {
    if (this.countdownTimer !== undefined) {
      clearInterval(this.countdownTimer)
      this.countdownTimer = undefined
    }
  },

  async confirmRebind() {
    if (this.data.rebinding || this.data.sendingSms || this.data.loginSheetBusy) {
      return
    }
    const phone = this.data.newPhone.trim()
    const code = this.data.smsCode.trim()
    if (!PHONE_PATTERN.test(phone)) {
      this.setData({ message: '请输入 11 位新手机号。' })
      return
    }
    if (!SMS_CODE_PATTERN.test(code)) {
      this.setData({ message: '请输入 6 位短信验证码。' })
      return
    }
    const challenge = this.smsChallenge
    if (!challenge || challenge.phone !== phone || challenge.expiresAt <= Date.now()) {
      this.setData({ message: '请重新获取短信验证码。' })
      return
    }
    this.setData({ rebinding: true, message: '' })
    try {
      const snapshot = await mipIdentityModule.rebindSmsPhone({ phone, code, challengeId: challenge.id })
      if (this.active) {
        this.finishRebind(snapshot)
      }
    }
    catch (error) {
      if (this.active) {
        this.setData({ message: error instanceof Error ? error.message : '换绑失败，请重试。' })
      }
    }
    finally {
      if (this.active) {
        this.setData({ rebinding: false })
      }
    }
  },

  finishRebind(snapshot: IdentityAccessSnapshot) {
    this.smsChallenge = undefined
    this.countdownDeadline = 0
    this.stopCountdown()
    this.setData({
      loginSheetOpen: false,
      loginSheetBusy: false,
      currentPhoneMasked: snapshot.phoneBound ? '已绑定手机号' : '',
      newPhone: '',
      smsCode: '',
      sendCountdown: 0,
    })
    wx.showToast({ title: '换绑成功', icon: 'success' })
    this.navigationTimer = setTimeout(() => {
      this.navigationTimer = undefined
      leaveSecondaryPage('/pages/profile/index')
    }, 700)
  },
})
