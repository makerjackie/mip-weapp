/** SearchBar — 40px controlled search input. */
Component({
  options: {
    virtualHost: false,
  },
  properties: {
    value: { type: String, value: '' },
    placeholder: { type: String, value: '搜索' },
    disabled: { type: Boolean, value: false },
  },
  methods: {
    handleInput(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
      const value = String(event.detail.value || '')
      this.triggerEvent('change', { value })
    },
    handleConfirm(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
      this.triggerEvent('confirm', { value: String(event.detail.value || '') })
    },
  },
})
