import { selectionHaptic } from '@weapp/shared/haptics'
import { caseSwitchPrimary } from '../../modules/platform/case-navigation'

Component({
  properties: {
    value: {
      type: String,
      value: 'pages/index/index',
    },
  },

  methods: {
    change(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
      const value = String(event.detail.value || '')
      if (!value || value === this.properties.value) {
        return
      }
      selectionHaptic()
      caseSwitchPrimary(`/${value}`)
    },
  },
})
