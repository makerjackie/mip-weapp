import { selectionHaptic } from '@weapp/shared/haptics'
import { tabIconSources } from '../config/tab-icons'
import { tabBarItems } from '../config/tabs'
import { mipMessagingModule } from '../modules/mip-messaging/client'

interface TabBarViewItem {
  value: string
  label: string
  iconOff: string
  iconOn: string
}

const tabs: TabBarViewItem[] = tabBarItems.map(item => ({
  value: item.value,
  label: item.label,
  iconOff: tabIconSources[item.label]?.iconOff ?? '',
  iconOn: tabIconSources[item.label]?.iconOn ?? '',
}))

function selectedIndex(value: string) {
  const index = tabBarItems.findIndex(item => item.value === value)
  return index >= 0 ? index : 0
}

const unreadSubscriptions = new WeakMap<object, () => void>()

Component({
  data: {
    selected: 0,
    value: 'pages/events/index',
    tabs,
    unreadCount: 0,
  },

  lifetimes: {
    attached() {
      unreadSubscriptions.get(this)?.()
      unreadSubscriptions.set(this, mipMessagingModule.subscribeUnreadCount((unreadCount) => {
        this.setData({ unreadCount })
      }))
      const pages = getCurrentPages()
      const route = pages[pages.length - 1]?.route
      if (route) {
        this.setData({
          value: route,
          selected: selectedIndex(route),
        })
      }
      void this.refreshUnreadCount()
    },
    detached() {
      unreadSubscriptions.get(this)?.()
      unreadSubscriptions.delete(this)
    },
  },

  pageLifetimes: {
    show() {
      void this.refreshUnreadCount()
    },
  },

  methods: {
    async refreshUnreadCount() {
      try {
        const unreadCount = await mipMessagingModule.refreshUnreadCount()
        this.setData({ unreadCount })
      }
      catch {
        this.setData({ unreadCount: 0 })
      }
    },

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
