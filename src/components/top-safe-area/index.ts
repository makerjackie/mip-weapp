import { getCustomNavigationStatusBarHeight } from '@weapp/platform/navigation'

Component({
  data: {
    height: getCustomNavigationStatusBarHeight(),
  },

  lifetimes: {
    ready() {
      this.syncHeight()
    },
  },

  pageLifetimes: {
    show() {
      this.syncHeight()
    },
  },

  methods: {
    syncHeight() {
      const height = getCustomNavigationStatusBarHeight()
      if (height !== this.data.height) {
        this.setData({ height })
      }
    },
  },
})
