import type {
  MembershipBenefitsSnapshot,
  MembershipPlan,
} from '../../../modules/mip-commerce'
import type { MembershipBenefitPresentation, MembershipHistoryPresentation } from './presentation'
import { mipCommerceModule } from '../../../modules/mip-commerce/client'
import { caseNavigateTo } from '../../../platform/navigation/client'
import { presentMembershipBenefits } from './presentation'

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    plans: [] as MembershipPlan[],
    plansKnown: false,
    membershipLabel: '会员状态',
    membershipDescription: '正在读取会员权益',
    membershipEndsText: '',
    planEndsText: '',
    currentSourceText: '',
    activeBenefits: [] as MembershipBenefitPresentation[],
    membershipHistory: [] as MembershipHistoryPresentation[],
    isPlayer: false,
    membershipKnown: false,
    message: '',
  },
  loadPromise: null as Promise<void> | null,

  onShow() {
    void this.load()
  },

  async load() {
    if (this.loadPromise) {
      return this.loadPromise
    }
    const loadPromise = this.loadOnce()
    this.loadPromise = loadPromise
    try {
      await loadPromise
    }
    finally {
      if (this.loadPromise === loadPromise) {
        this.loadPromise = null
      }
    }
  },

  async loadOnce() {
    const cachedMembership = mipCommerceModule.peekMembershipBenefits()
    const cachedPlans = mipCommerceModule.peekPlans()
    if (cachedMembership) {
      this.presentMembership(cachedMembership)
    }
    if (cachedPlans !== undefined) {
      this.setData({ plans: cachedPlans, plansKnown: true })
    }
    if (cachedMembership) {
      this.setData({ state: 'ready', message: '' })
    }
    else if (this.data.state !== 'ready') {
      this.setData({ state: 'loading', message: '' })
    }
    const [membershipResult, plansResult] = await Promise.allSettled([
      mipCommerceModule.getMembershipBenefits({ force: cachedMembership !== undefined }),
      mipCommerceModule.listPlans({ force: cachedPlans !== undefined }),
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
      this.setData({ plans: plansResult.value, plansKnown: true })
    }
    if (membershipResult.status === 'rejected' && !this.data.membershipKnown) {
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
    this.setData({
      ...presentMembershipBenefits(snapshot),
      membershipKnown: true,
    })
  },

  openMembership() {
    caseNavigateTo({ url: '/pages/membership/index' })
  },
})
