import { selectionHaptic } from '@weapp/shared/haptics'
import { tabBarItems } from '../config/tabs'

function selectedIndex(value: string) {
  const index = tabBarItems.findIndex(item => item.value === value)
  return index >= 0 ? index : 0
}

Component({
  data: {
    selected: 0,
    value: 'pages/index/index',
    tabs: tabBarItems,
  },

  lifetimes: {
    attached() {
      const pages = getCurrentPages()
      const route = pages[pages.length - 1]?.route
      if (route) {
        this.setData({
          value: route,
          selected: selectedIndex(route),
        })
      }
    },
  },

  methods: {
    switchTab(event: WechatMiniprogram.TouchEvent) {
      const index = Number(event.currentTarget.dataset.index)
      const item = this.data.tabs[index]
      if (!item || Number.isNaN(index) || index === this.data.selected) {
        return
      }
      wx.switchTab({
        url: `/${item.value}`,
        success: () => selectionHaptic(),
      })
    },
  },
})
