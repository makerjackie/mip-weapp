/** StatHeader — four-column reference metric strip. */
Component({
  options: {
    virtualHost: false,
  },
  properties: {
    stats: { type: Array, value: [] },
  },
  methods: {
    handleSelect(event: WechatMiniprogram.TouchEvent) {
      const index = Number(event.currentTarget.dataset.index || 0)
      const stat = this.data.stats[index] as { label?: string } | undefined
      this.triggerEvent('select', { index, label: stat?.label || '' })
    },
  },
})
