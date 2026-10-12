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
      // BUG-01（交互审计 2026-10-12）：事件名不能叫 'tap'——会与原生冒泡 tap 同名，
      // 宿主在标签上 bind:tap 时一次点按收两次；本组件用法由外层容器依赖原生
      // 冒泡接住点击，根节点保持 bind:tap 不动，只把自定义事件改名。
      this.triggerEvent('select', { count: this.data.count })
    },
  },
})
