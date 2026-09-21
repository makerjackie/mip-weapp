/**
 * LoginSheet — phone-number authorization bottom sheet (journey-review login-sheet,
 * 2026-09-21 终审口径). Renders the sheet chrome only; the hosting page owns the
 * identity session (bindWechatPhone / profile completion / intent resume).
 */
Component({
  properties: {
    visible: { type: Boolean, value: false },
    busy: { type: Boolean, value: false },
    brandName: { type: String, value: 'MIP' },
    logoPath: { type: String, value: '/assets/brand/mip-logo-yellow.png' },
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
  },
})
