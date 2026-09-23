import type { ProfileInterestPerson } from '../../../modules/mip-opportunities'
import { MipOpportunityError, opportunityModule } from '../../../modules/mip-opportunities'
import { caseNavigateTo } from '../../../platform/navigation/client'

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'empty' | 'blocked' | 'error',
    profileRef: '',
    people: [] as ProfileInterestPerson[],
    totalCount: 0,
    nextCursor: '',
    loadingMore: false,
    message: '',
  },
  loading: false,
  onLoad(query: Record<string, string | undefined>) {
    this.setData({ profileRef: String(query.profileRef || '') })
  },
  onShow() { void this.load() },
  onReachBottom() { void this.loadMore() },
  async load() {
    if (this.loading || this.data.loadingMore) {
      return
    }
    if (!this.data.profileRef) {
      this.setData({ state: 'error', message: '档案信息不完整。' })
      return
    }
    this.loading = true
    this.setData({ state: 'loading', message: '' })
    try {
      const page = await opportunityModule.listProfileInterests(this.data.profileRef)
      this.setData({
        state: page.items.length ? 'ready' : 'empty',
        people: page.items,
        totalCount: page.totalCount,
        nextCursor: page.nextCursor || '',
        message: '',
      })
    }
    catch (error) {
      const blocked = error instanceof MipOpportunityError && ['FORBIDDEN', 'AUTH_REQUIRED', 'NOT_FOUND'].includes(error.code)
      this.setData({
        state: blocked ? 'blocked' : 'error',
        people: [],
        nextCursor: '',
        message: blocked ? '仅玩家可查看已公开的感兴趣名单。' : error instanceof Error ? error.message : '名单暂时无法加载。',
      })
    }
    finally { this.loading = false }
  },
  async loadMore() {
    if (this.loading || this.data.loadingMore || !this.data.nextCursor) {
      return
    }
    this.setData({ loadingMore: true, message: '' })
    try {
      const page = await opportunityModule.listProfileInterests(this.data.profileRef, this.data.nextCursor)
      const seen = new Set(this.data.people.map(person => person.profileRef))
      this.setData({
        people: [...this.data.people, ...page.items.filter(person => !seen.has(person.profileRef))],
        totalCount: page.totalCount,
        nextCursor: page.nextCursor || '',
      })
    }
    catch (error) {
      if (error instanceof MipOpportunityError && ['FORBIDDEN', 'AUTH_REQUIRED', 'NOT_FOUND'].includes(error.code)) {
        this.setData({ state: 'blocked', people: [], nextCursor: '', message: '当前名单已不可查看。' })
      }
      else {
        this.setData({ message: error instanceof Error ? error.message : '更多名单暂时无法加载，请重试。' })
      }
    }
    finally { this.setData({ loadingMore: false }) }
  },
  openProfile(event: WechatMiniprogram.TouchEvent) {
    const profileRef = String(event.currentTarget.dataset.profileRef || '')
    if (this.data.people.some(person => person.profileRef === profileRef)) {
      caseNavigateTo({ url: `/packages/member/mip-public-profile/index?profileRef=${encodeURIComponent(profileRef)}` })
    }
  },
})
