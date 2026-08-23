import { leaveSecondaryPage } from '@weapp/platform/navigation'

Component({
  properties: {
    label: { type: String, value: '返回' },
    tabUrl: { type: String, value: '/pages/index/index' },
    primary: { type: Boolean, value: false },
  },

  methods: {
    onExit() {
      leaveSecondaryPage(this.data.tabUrl)
    },
  },
})
