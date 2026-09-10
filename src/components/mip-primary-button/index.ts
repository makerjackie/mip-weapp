/** PrimaryButton — full-width glass halo and yellow 327×40 core. */
Component({
  options: {
    virtualHost: false,
  },
  properties: {
    label: { type: String, value: '保存' },
    disabled: { type: Boolean, value: false },
    loading: { type: Boolean, value: false },
  },
  methods: {
    handleTap() {
      if (this.data.disabled || this.data.loading) {
        return
      }
      this.triggerEvent('tap')
    },
  },
})
