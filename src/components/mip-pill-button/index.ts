/** PillButton — 40px primary/secondary action with an optional 20px icon slot. */
Component({
  options: {
    virtualHost: false,
  },
  properties: {
    label: { type: String, value: '' },
    variant: { type: String, value: 'primary' },
    withIcon: { type: Boolean, value: false },
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
