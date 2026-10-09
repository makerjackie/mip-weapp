import type { ProfileInterestPerson } from '../../../modules/mip-opportunities'
import { MipOpportunityError, opportunityModule } from '../../../modules/mip-opportunities'
import { caseNavigateTo } from '../../../platform/navigation/client'

// MIW-24：名单卡走统一嘉宾卡组件 grid 壳；medals 只接服务端佩戴口径
// （PublicPersonDetails.badges 由 mip_user_badge_equipment 过滤），未返回不造值。
interface ProfileInterestView {
  profileRef: string
  displayName: string
  avatarUrl: string
  levelText: string
  // MIW-52 统一三标签（地区MIP | 代表行业 | 身份状态），替换旧 metaText 斜杠串。
  profileTags: string[]
  supportingText: string
  medals: { id: string, imageUrl?: string }[]
  // G3（审计 2026-10-09）：邀请来源标注（figma 2189_43192），服务端无归档时省略不渲染。
  inviterName: string
  inviterAvatarUrl: string
  inviterKind: 'PLAYER' | 'PLATFORM'
}

function presentProfileInterest(person: ProfileInterestPerson): ProfileInterestView {
  return {
    profileRef: person.profileRef,
    displayName: person.nickname,
    avatarUrl: person.avatarUrl || '',
    levelText: person.level ? `Lv.${person.level.number}` : '',
    profileTags: [person.cityName ? `${person.cityName}MIP` : '', person.industryLabel || '', person.identityStatus || ''].filter(Boolean).slice(0, 3),
    supportingText: person.introduction || person.headline || '',
    medals: (person.badges || []).map(badge => ({ id: badge.id, imageUrl: badge.imageUrl })),
    inviterName: person.inviter?.displayName || '',
    inviterAvatarUrl: person.inviter?.avatarUrl || '',
    inviterKind: person.inviter?.sourceType === 'PLATFORM' ? 'PLATFORM' : 'PLAYER',
  }
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'empty' | 'blocked' | 'error',
    profileRef: '',
    people: [] as ProfileInterestView[],
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
        people: page.items.map(presentProfileInterest),
        totalCount: page.totalCount,
        nextCursor: page.nextCursor || '',
        message: '',
      })
    }
    catch (error) {
      const blocked = error instanceof MipOpportunityError && ['FORBIDDEN', 'AUTH_REQUIRED', 'NOT_FOUND'].includes(error.code)
      if (!blocked && this.data.people.length) {
        this.setData({ message: error instanceof Error ? error.message : '名单暂时无法加载。' })
        return
      }
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
        people: [...this.data.people, ...page.items.filter(person => !seen.has(person.profileRef)).map(presentProfileInterest)],
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
