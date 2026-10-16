import { getCustomNavigationStatusBarHeight } from '@weapp/platform/navigation'
import { isTestEnvironment } from '../../config/runtime'

Component({
  data: {
    height: getCustomNavigationStatusBarHeight(),
    testEnvironment: isTestEnvironment(),
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
