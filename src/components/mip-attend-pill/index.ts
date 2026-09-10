/** AttendPill — 116×28 design px, with up to three 24px avatars. */
Component({
  options: {
    virtualHost: false,
  },
  properties: {
    count: { type: null, value: 45 },
    label: { type: String, value: '参加' },
    avatars: { type: Array, value: [] },
    variant: { type: String, value: 'dark' },
    disabled: { type: Boolean, value: false },
  },
  methods: {
    handleTap() {
      if (this.data.disabled) {
        return
      }
      this.triggerEvent('tap', { count: this.data.count })
    },
  },
})
