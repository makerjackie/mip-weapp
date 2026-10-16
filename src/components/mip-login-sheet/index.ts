/**
 * LoginSheet — phone-number authorization bottom sheet (journey-review login-sheet,
 * 2026-09-21 终审口径；MIW-20 起单主按钮按 restore-first 切换恢复/授权形态).
 * Renders the sheet chrome only; the hosting page owns the
 * identity session (bindWechatPhone / profile completion / intent resume).
 * MIW-121：主按钮（两种形态）前置协议勾选门控——未勾选时 toast 提示且不外发
 * phone/signin 事件；手机号授权按钮的 open-type 随勾选置空，不拉起原生授权。
 */
import { brand } from '../../config/brand'

/** 与 wxml checkbox 的 value 一致；勾选判定按 checkbox-group detail.value。 */
const CONSENT_VALUE = 'agreed'

Component({
  properties: {
    visible: { type: Boolean, value: false },
    busy: { type: Boolean, value: false },
    /**
     * 主按钮先恢复会话（MIW-20）：退出过的老账号点按钮先按 OpenID 恢复，
     * 已绑手机号直接完成登录、不弹原生授权；未绑由页面切回手机号授权形态。
     */
    restoreFirst: { type: Boolean, value: false },
    logoPath: { type: String, value: '/assets/brand/mip-logo-yellow.png' },
    /** 可选副标题覆盖（journey-review J5-02 换绑变体）；留空时保持默认文案不变。 */
    subtitle: { type: String, value: '' },
  },

  data: {
    /** MIW-121 协议勾选状态放 data（Component 实例状态不收自定义字段）。 */
    agreed: false,
    userAgreementPath: brand.userAgreementPath,
    privacyPolicyPath: brand.privacyPolicyPath,
  },

  methods: {
    onConsentChange(event: WechatMiniprogram.CustomEvent<{ value?: string[] }>) {
      this.setData({ agreed: Array.isArray(event.detail?.value) && event.detail.value.includes(CONSENT_VALUE) })
    },

    /** 勾选门控：未同意时提示并返回 false，调用方据此拦截外发事件。 */
    assertConsented(): boolean {
      if (this.data.agreed) {
        return true
      }
      void wx.showToast({ title: '请先阅读并同意《服务协议》与《隐私政策》', icon: 'none' })
      return false
    },

    /** 手机号授权按钮 tap：勾选后由原生授权弹窗接管（getphonenumber），此处保持无感。 */
    onAuthTap() {
      this.assertConsented()
    },

    onPhone(event: WechatMiniprogram.CustomEvent<{ code?: string, errMsg?: string }>) {
      if (!this.assertConsented()) {
        return
      }
      this.triggerEvent('phone', event.detail)
    },

    onDismiss() {
      if (!this.data.busy) {
        this.triggerEvent('dismiss')
      }
    },

    onSignIn() {
      if (!this.data.busy && this.assertConsented()) {
        this.triggerEvent('signin')
      }
    },

    openUserAgreement() {
      void wx.navigateTo({ url: this.data.userAgreementPath })
    },

    openPrivacyPolicy() {
      void wx.navigateTo({ url: this.data.privacyPolicyPath })
    },
  },
})
