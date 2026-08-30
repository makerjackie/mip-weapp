import { leaveSecondaryPage } from '@weapp/platform/navigation'

Component({
  properties: {
    label: { type: String, value: '返回' },
    tabUrl: { type: String, value: '/pages/index/index' },
    primary: { type: Boolean, value: false },
    managed: { type: Boolean, value: false },
    always: { type: Boolean, value: false },
  },

  data: {
    visible: false,
  },

  lifetimes: {
    ready() {
      this.syncVisibility()
    },
  },

  pageLifetimes: {
    show() {
      this.syncVisibility()
    },
  },

  methods: {
    syncVisibility() {
      const visible = this.data.managed || this.data.always || getCurrentPages().length <= 1
      if (visible !== this.data.visible) {
        this.setData({ visible })
      }
    },

    onExit() {
      if (this.data.managed) {
        this.triggerEvent('exit')
        return
      }
      leaveSecondaryPage(this.data.tabUrl)
    },
  },
})
