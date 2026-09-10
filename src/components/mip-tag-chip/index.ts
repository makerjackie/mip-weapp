/** TagChip — 28px chip with the required brand keyline and state colors. */
Component({
  options: {
    virtualHost: false,
  },
  properties: {
    label: { type: String, value: '' },
    active: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
    block: { type: Boolean, value: false },
  },
  methods: {
    handleTap() {
      if (this.data.disabled) {
        return
      }
      this.triggerEvent('tap', { label: this.data.label, active: this.data.active })
    },
  },
})
