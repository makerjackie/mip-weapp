import { mipIdentityModule } from '../../../modules/mip-identity/client'
import { mipGlobalAccessGuard } from '../../../modules/mip-identity/runtime'
import { leaveSecondaryPage } from '../../../platform/navigation/client'

const PHONE_PATTERN = /^1\d{10}$/
const SMS_CODE_PATTERN = /^\d{6}$/
const SMS_COUNTDOWN_SECONDS = 60

/**
 * journey-review J5-02 绑定手机 / 更换手机号（QS 三级页自拟承接）：
 * 单表单双路径——
 * A「微信一键获取」：mip-login-sheet（subtitle 换绑变体）+ 手机号快速验证 code，
 *   走 mipIdentityModule.rebindWechatPhone 免短信直接换绑，结果由服务端决定；
 * B 手动输入其他手机号 + 短信验证码：短信通道一期未接通（QS），
 *   先交付 UI 骨架（60s 倒计时防重发文案已按口径实现，发送与校验待通道落地，
 *   见 .tmp/shared-change-requests.md）。
 */
Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    currentPhoneMasked: '',
    newPhone: '',
    smsCode: '',
    sendCountdown: 0,
    rebinding: false,
    message: '',
    loginSheetOpen: false,
    loginSheetBusy: false,
    loginSheetSubtitle: '将获取你微信绑定的手机号，用于换绑确认\n换绑成功后，新手机号替代原手机号用于登录与通知',
  },
  countdownTimer: undefined as ReturnType<typeof setInterval> | undefined,
  navigationTimer: undefined as ReturnType<typeof setTimeout> | undefined,

  onLoad() {
    void this.loadAccountState()
  },

  onUnload() {
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
      if (!snapshot.authenticated) {
        mipGlobalAccessGuard.enterTarget({ path: 'pages/index/index' })
        return
      }
      this.setData({
        state: 'ready',
        currentPhoneMasked: snapshot.profile.privateContact?.phoneMasked || '',
      })
    }
    catch (error) {
      this.setData({
        state: 'error',
        message: error instanceof Error ? error.message : '账号状态加载失败。',
      })
    }
  },

  onNewPhoneInput(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ newPhone: event.detail.value, message: '' })
  },

  onSmsCodeInput(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ smsCode: event.detail.value, message: '' })
  },

  // 路径 A：弹 mip-login-sheet（subtitle 换绑变体），授权由组件内 getPhoneNumber 完成。
  openWechatBind() {
    if (this.data.rebinding || this.data.loginSheetOpen) {
      return
    }
    this.setData({ loginSheetOpen: true, message: '' })
  },

  onLoginSheetDismiss() {
    this.setData({ loginSheetOpen: false })
  },

  async onLoginSheetPhone(event: WechatMiniprogram.CustomEvent<{ code?: string, errMsg?: string }>) {
    if (this.data.loginSheetBusy) {
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
      this.setData({
        loginSheetOpen: false,
        loginSheetBusy: false,
        currentPhoneMasked: snapshot.profile.privateContact?.phoneMasked || this.data.currentPhoneMasked,
        newPhone: '',
        smsCode: '',
      })
      wx.showToast({ title: '换绑成功', icon: 'success' })
      // 换绑完成 → 账号设置（J5-01）；延迟返回让 toast 可见。
      this.navigationTimer = setTimeout(() => {
        this.navigationTimer = undefined
        leaveSecondaryPage('/pages/profile/index')
      }, 700)
    }
    catch (error) {
      // 号码已被占用等错误：保留已输入内容，行内克制提示。
      this.setData({
        loginSheetOpen: false,
        loginSheetBusy: false,
        message: error instanceof Error ? error.message : '换绑失败，请重试。',
      })
    }
  },

  // 路径 B：短信通道一期未接通（QS）。校验与 60s 防重发口径已就位，
  // 通道落地后在此接入发送接口并调用 startCountdown()。
  requestSmsCode() {
    if (this.data.rebinding || this.data.sendCountdown > 0) {
      return
    }
    if (!PHONE_PATTERN.test(this.data.newPhone)) {
      this.setData({ message: '请先输入 11 位新手机号。' })
      return
    }
    this.setData({ message: '短信验证码暂未开通，可使用「微信一键获取」完成换绑。' })
  },

  startCountdown() {
    this.stopCountdown()
    this.setData({ sendCountdown: SMS_COUNTDOWN_SECONDS })
    this.countdownTimer = setInterval(() => {
      const next = this.data.sendCountdown - 1
      if (next <= 0) {
        this.stopCountdown()
        return
      }
      this.setData({ sendCountdown: next })
    }, 1000)
  },

  stopCountdown() {
    if (this.countdownTimer !== undefined) {
      clearInterval(this.countdownTimer)
      this.countdownTimer = undefined
    }
    if (this.data.sendCountdown > 0) {
      this.setData({ sendCountdown: 0 })
    }
  },

  async confirmRebind() {
    if (this.data.rebinding) {
      return
    }
    if (!PHONE_PATTERN.test(this.data.newPhone)) {
      this.setData({ message: '请输入 11 位新手机号。' })
      return
    }
    if (!SMS_CODE_PATTERN.test(this.data.smsCode)) {
      this.setData({ message: '请输入 6 位短信验证码。' })
      return
    }
    // 短信验证码换绑接口待身份域提供（QS）；错误态保留输入，仅提示。
    this.setData({ message: '短信验证码暂未开通，可使用「微信一键获取」完成换绑。' })
  },
})
