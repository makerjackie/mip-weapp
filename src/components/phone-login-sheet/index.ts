Component({
  properties: {
    visible: { type: Boolean, value: false },
    title: { type: String, value: '登录后继续' },
    description: { type: String, value: '用于活动联系、订单与售后' },
    loading: { type: Boolean, value: false },
  },

  methods: {
    handleVisibleChange(event: WechatMiniprogram.CustomEvent<{ visible?: boolean }>) {
      if (!event.detail.visible) {
        this.triggerEvent('close')
      }
    },

    close() {
      if (!this.properties.loading) {
        this.triggerEvent('close')
      }
    },

    handlePhone(event: WechatMiniprogram.CustomEvent<{ code?: string, errMsg?: string }>) {
      if (this.properties.loading) {
        return
      }
      // Forward only; parents must not treat a missing code as success (simulator / deny).
      this.triggerEvent('phone', event.detail)
    },

    openAgreement() {
      this.triggerEvent('agreement')
    },

    openPrivacy() {
      this.triggerEvent('privacy')
    },
  },
})
