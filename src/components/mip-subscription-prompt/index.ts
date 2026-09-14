import { mipMessagingModule } from '../../modules/mip-messaging/client'

Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    templateKey: { type: String, value: 'EVENT_REMINDER' },
    label: { type: String, value: '接收活动提醒' },
    description: { type: String, value: '通过微信接收活动提醒，可自愿开启。报名状态请在我的活动查看。' },
  },
  data: { available: false, requesting: false, granted: false, message: '' },
  lifetimes: {
    attached() {
      this.setData({ available: mipMessagingModule.subscriptionCapability(this.data.templateKey).available })
    },
  },
  methods: {
    async request() {
      if (!this.data.available || this.data.requesting || this.data.granted) {
        return
      }
      this.setData({ requesting: true, message: '' })
      try {
        const result = await mipMessagingModule.requestWechatSubscription(this.data.templateKey)
        this.setData({ granted: result.grantAvailable, message: result.grantAvailable ? '' : '未开启提醒，不影响继续使用。' })
      }
      catch {
        this.setData({ message: '提醒暂时未能开启，可稍后重试。' })
      }
      finally {
        this.setData({ requesting: false })
      }
    },
  },
})
