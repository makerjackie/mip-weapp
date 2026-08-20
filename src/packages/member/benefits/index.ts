import { membershipModule } from '../../../modules/membership/client'
import { caseNavigateTo, caseSwitchPrimary } from '../../../modules/platform/case-navigation'
import { formatLocalDate } from '../../../utils/date'

Page({
  data: {
    state: 'ready' as 'ready' | 'error',
    membershipActive: false,
    expiresText: '',
    message: '',
  },

  onShow() {
    void this.load()
  },

  async load() {
    try {
      const overview = await membershipModule.load()
      this.setData({
        state: 'ready',
        membershipActive: overview.membership.active,
        expiresText: overview.membership.expiresAt ? formatLocalDate(overview.membership.expiresAt) : '',
        message: '',
      })
    }
    catch (error) {
      // Static benefit copy remains useful offline; only surface a soft message.
      this.setData({
        state: 'ready',
        message: this.data.membershipActive || this.data.expiresText
          ? '会员状态更新失败，已保留上次结果。'
          : (error instanceof Error ? error.message : ''),
      })
    }
  },

  openMembership() {
    caseNavigateTo({ url: '/pages/membership/index' })
  },

  backToHome() {
    caseSwitchPrimary('/pages/index/index')
  },
})
