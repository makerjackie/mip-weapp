import type { OpportunityCooperator, OpportunityId } from '../../../modules/mip-opportunities'
import { MipOpportunityError, opportunityModule } from '../../../modules/mip-opportunities'
import { caseNavigateTo } from '../../../platform/navigation/client'

// G1（审计 2026-10-09）：「+N想合作」独立二级页（figma 1769_37984）——机会详情胶囊
// 跳转本页，2 列竖版人才卡，字段口径对齐 mip-profile-interests（Lv / 三标签 /
// 两行简介 / 佩戴勋章 / 邀请人）。服务端已按 activated_at DESC（最新在前）排序并做
// 可见性/登录校验，页面按返回顺序展示；数据不可信字段一律省略不造值。
interface CooperatorView {
  profileRef: string
  displayName: string
  avatarUrl: string
  levelText: string
  profileTags: string[]
  supportingText: string
  medals: { id: string, imageUrl?: string }[]
  inviterName: string
  inviterAvatarUrl: string
  inviterKind: 'PLAYER' | 'PLATFORM'
}

function presentCooperator(person: OpportunityCooperator): CooperatorView {
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
    id: '' as OpportunityId,
    people: [] as CooperatorView[],
    nextCursor: '',
    loadingMore: false,
    message: '',
  },
  loading: false,
  onLoad(query: Record<string, string | undefined>) {
    this.setData({ id: String(query.id || '') as OpportunityId })
  },
  onShow() { void this.load() },
  onReachBottom() { void this.loadMore() },
  async load() {
    if (this.loading || this.data.loadingMore) {
      return
    }
    if (!this.data.id) {
      this.setData({ state: 'error', message: '机会信息不完整。' })
      return
    }
    this.loading = true
    this.setData({ state: 'loading', message: '' })
    try {
      const page = await opportunityModule.listCooperators(this.data.id)
      this.setData({
        state: page.items.length ? 'ready' : 'empty',
        people: page.items.map(presentCooperator),
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
        message: error instanceof Error ? error.message : '名单暂时无法加载。',
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
      const page = await opportunityModule.listCooperators(this.data.id, this.data.nextCursor)
      const seen = new Set(this.data.people.map(person => person.profileRef))
      this.setData({
        people: [...this.data.people, ...page.items.filter(person => !seen.has(person.profileRef)).map(presentCooperator)],
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
