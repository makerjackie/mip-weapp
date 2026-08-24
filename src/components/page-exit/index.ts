import { leaveSecondaryPage } from '@weapp/platform/navigation'

Component({
  properties: {
    label: { type: String, value: '返回' },
    tabUrl: { type: String, value: '/pages/index/index' },
    primary: { type: Boolean, value: false },
    managed: { type: Boolean, value: false },
  },

  methods: {
    onExit() {
      if (this.data.managed) {
        this.triggerEvent('exit')
        return
      }
      leaveSecondaryPage(this.data.tabUrl)
    },
  },
})
