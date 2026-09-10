/** Dialog — iOS-style 640rpx dialog; frame-only mode is used by pixel fixtures. */
Component({
  options: {
    virtualHost: false,
  },
  properties: {
    open: { type: Boolean, value: false },
    title: { type: String, value: '' },
    cancelText: { type: String, value: '取消' },
    confirmText: { type: String, value: '确定' },
    confirmDisabled: { type: Boolean, value: false },
    single: { type: Boolean, value: false },
    frameOnly: { type: Boolean, value: false },
    button: { type: String, value: '' },
  },
  methods: {
    handleCancel() {
      this.triggerEvent('cancel')
    },
    handleConfirm() {
      if (this.data.confirmDisabled) {
        return
      }
      this.triggerEvent('confirm')
    },
  },
})
