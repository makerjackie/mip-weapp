import type { MembershipPlan } from '../../../modules/mip-commerce'
import { mipCommerceModule } from '../../../modules/mip-commerce/client'
import { mipIdentityModule } from '../../../modules/mip-identity/client'
import { membershipPresentation } from '../../../modules/mip-shell'
import { caseNavigateTo } from '../../../modules/platform/case-navigation'
import { formatLocalDate } from '../../../utils/date'

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    plans: [] as MembershipPlan[],
    membershipLabel: '嘉宾',
    membershipDescription: '当前没有有效会员权益',
    membershipEndsText: '',
    isPlayer: false,
    message: '',
  },

  onShow() {
    void this.load()
  },

  async load() {
    if (this.data.state !== 'ready') {
      this.setData({ state: 'loading', message: '' })
    }
    const identityRequest = mipIdentityModule.loadSnapshot().then((snapshot) => {
      const membership = membershipPresentation(snapshot.membership.kind, snapshot.membership.entitlement)
      this.setData({
        membershipLabel: membership.label,
        membershipDescription: membership.description,
        membershipEndsText: membership.endsAt ? formatLocalDate(membership.endsAt) : '',
        isPlayer: membership.label === '玩家',
      })
    }).catch(() => {
      this.setData({ message: '会员状态暂时无法更新。' })
    })
    try {
      const plans = await mipCommerceModule.listPlans()
      this.setData({ state: 'ready', plans })
      await identityRequest
    }
    catch {
      await identityRequest
      this.setData(this.data.plans.length
        ? { message: '权益说明更新失败，已保留上次结果。' }
        : { state: 'error', message: '会员权益暂时无法加载。' })
    }
  },

  openMembership() {
    caseNavigateTo({ url: '/pages/membership/index' })
  },
})
