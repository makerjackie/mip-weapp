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
    large: { type: Boolean, value: false },
  },
  methods: {
    handleTap() {
      if (this.data.disabled) {
        return
      }
      // BUG-01（交互审计 2026-10-12）：事件名不能叫 'tap'——会与原生冒泡 tap 同名，
      // 宿主在标签上 bind:tap 时一次点按收两次；本组件多数用法由外层容器
      // 依赖原生冒泡接住点击，根节点保持 bind:tap 不动，只把自定义事件改名。
      this.triggerEvent('select', { label: this.data.label, active: this.data.active })
    },
  },
})
