import { selectionHaptic } from '@weapp/shared/haptics'

Component({
  data: {
    value: 'pages/index/index',
  },

  lifetimes: {
    attached() {
      const pages = getCurrentPages()
      const route = pages[pages.length - 1]?.route
      if (route) {
        this.setData({ value: route })
      }
    },
  },

  methods: {
    change(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
      const value = String(event.detail.value || '')
      if (!value || value === this.data.value) {
        return
      }
      wx.switchTab({
        url: `/${value}`,
        success: () => selectionHaptic(),
      })
    },
  },
})
