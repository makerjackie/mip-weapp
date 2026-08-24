import type {
  MembershipBenefitItem,
  MembershipBenefitsSnapshot,
  MembershipPlan,
} from '../../../modules/mip-commerce'
import { mipCommerceModule } from '../../../modules/mip-commerce/client'
import { caseNavigateTo } from '../../../modules/platform/case-navigation'
import { formatLocalDate } from '../../../utils/date'

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    plans: [] as MembershipPlan[],
    membershipLabel: '会员状态',
    membershipDescription: '正在读取会员权益',
    membershipEndsText: '',
    planEndsText: '',
    currentPlanName: '',
    activeBenefits: [] as MembershipBenefitItem[],
    isPlayer: false,
    membershipKnown: false,
    message: '',
  },

  onShow() {
    void this.load()
  },

  async load() {
    if (this.data.state !== 'ready') {
      this.setData({ state: 'loading', message: '' })
    }
    const [membershipResult, plansResult] = await Promise.allSettled([
      mipCommerceModule.getMembershipBenefits(),
      mipCommerceModule.listPlans(),
    ])
    if (membershipResult.status === 'fulfilled') {
      this.presentMembership(membershipResult.value)
    }
    else if (!this.data.membershipKnown) {
      this.setData({
        membershipLabel: '会员状态暂不可用',
        membershipDescription: '请稍后重新加载',
      })
    }
    if (plansResult.status === 'fulfilled') {
      this.setData({ plans: plansResult.value })
    }
    if (membershipResult.status === 'rejected' && plansResult.status === 'rejected') {
      this.setData({ state: 'error', message: '会员权益暂时无法加载。' })
      return
    }
    this.setData({
      state: 'ready',
      message: membershipResult.status === 'rejected'
        ? '会员状态暂时无法更新。'
        : plansResult.status === 'rejected'
          ? '会员方案暂时无法更新。'
          : '',
    })
  },

  presentMembership(snapshot: MembershipBenefitsSnapshot) {
    if (snapshot.kind === 'GUEST') {
      this.setData({
        membershipLabel: '嘉宾',
        membershipDescription: '当前没有有效会员权益',
        membershipEndsText: '',
        planEndsText: '',
        currentPlanName: '',
        activeBenefits: [],
        isPlayer: false,
        membershipKnown: true,
      })
      return
    }
    this.setData({
      membershipLabel: '玩家',
      membershipDescription: snapshot.plan.description || snapshot.plan.name,
      membershipEndsText: formatLocalDate(snapshot.membershipEndsAt),
      planEndsText: formatLocalDate(snapshot.endsAt),
      currentPlanName: snapshot.plan.name,
      activeBenefits: snapshot.benefits,
      isPlayer: true,
      membershipKnown: true,
    })
  },

  openMembership() {
    caseNavigateTo({ url: '/pages/membership/index' })
  },
})
