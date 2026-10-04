/**
 * LoginSheet — phone-number authorization bottom sheet (journey-review login-sheet,
 * 2026-09-21 终审口径；MIW-20 起单主按钮按 restore-first 切换恢复/授权形态).
 * Renders the sheet chrome only; the hosting page owns the
 * identity session (bindWechatPhone / profile completion / intent resume).
 */
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

  methods: {
    onPhone(event: WechatMiniprogram.CustomEvent<{ code?: string, errMsg?: string }>) {
      this.triggerEvent('phone', event.detail)
    },

    onDismiss() {
      if (!this.data.busy) {
        this.triggerEvent('dismiss')
      }
    },

    onSignIn() {
      if (!this.data.busy) {
        this.triggerEvent('signin')
      }
    },
  },
})
