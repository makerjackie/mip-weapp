import type { EventId } from '../../../../modules/mip'
import type { PublicEventParticipant, PublicEventParticipantQuery } from '../../../../modules/mip-events'
import { mipEventsModule } from '../../../../modules/mip-events/client'
import { caseNavigateTo } from '../../../../modules/platform/case-navigation'

type ParticipantKindFilter = 'ALL' | 'PLAYER' | 'GUEST'

interface ParticipantView extends PublicEventParticipant {
  displayName: string
  kindLabel: string
  metaText: string
  introductionText: string
}

function presentParticipant(participant: PublicEventParticipant): ParticipantView {
  const branchText = participant.primaryBranch
    ? [participant.primaryBranch.cityName, participant.primaryBranch.name].filter(Boolean).join(' · ')
    : ''
  return {
    ...participant,
    displayName: participant.nickname || 'MIP 用户',
    kindLabel: participant.userKind === 'PLAYER' ? '玩家' : participant.userKind === 'GUEST' ? '嘉宾' : '',
    metaText: [branchText, participant.primaryIndustry?.label, participant.identityStatus].filter(Boolean).join(' · '),
    introductionText: participant.introduction || participant.headline || '',
  }
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    eventId: '' as EventId,
    items: [] as ParticipantView[],
    kind: 'ALL' as ParticipantKindFilter,
    searchInput: '',
    activeKeyword: '',
    nextCursor: '',
    loadingMore: false,
    message: '',
  },
  requestSeq: 0,

  onLoad(query: Record<string, string | undefined>) {
    this.setData({ eventId: String(query.eventId || '') as EventId })
    void this.loadParticipants()
  },

  currentQuery(cursor?: string): PublicEventParticipantQuery {
    return {
      keyword: this.data.activeKeyword || undefined,
      userKind: this.data.kind === 'ALL' ? undefined : this.data.kind,
      cursor,
      limit: 24,
    }
  },

  async loadParticipants(options: { append?: boolean } = {}) {
    if (!this.data.eventId) {
      this.setData({ state: 'error', message: '活动信息不完整。' })
      return
    }
    const append = options.append === true
    if (append && (!this.data.nextCursor || this.data.loadingMore)) {
      return
    }
    const requestSeq = this.requestSeq + 1
    this.requestSeq = requestSeq
    this.setData(append
      ? { loadingMore: true, message: '' }
      : { state: 'loading', loadingMore: false, message: '' })
    try {
      const page = await mipEventsModule.listPublicParticipants(
        this.data.eventId,
        this.currentQuery(append ? this.data.nextCursor : undefined),
      )
      if (requestSeq !== this.requestSeq) {
        return
      }
      const items = append
        ? [...this.data.items, ...page.items.map(presentParticipant)]
        : page.items.map(presentParticipant)
      const uniqueItems = [...new Map(items.map(item => [item.profileRef, item])).values()]
      this.setData({
        state: 'ready',
        items: uniqueItems,
        nextCursor: page.nextCursor || '',
        message: '',
      })
    }
    catch (error) {
      if (requestSeq !== this.requestSeq) {
        return
      }
      this.setData(append
        ? { message: '更多参与人加载失败，请稍后重试。' }
        : {
            state: this.data.items.length ? 'ready' : 'error',
            message: error instanceof Error ? error.message : '参与人列表加载失败。',
          })
    }
    finally {
      if (requestSeq === this.requestSeq) {
        this.setData({ loadingMore: false })
      }
    }
  },

  onSearchInput(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ searchInput: String(event.detail.value || '').slice(0, 80) })
  },

  onSearchConfirm() {
    const activeKeyword = this.data.searchInput.trim()
    if (activeKeyword === this.data.activeKeyword) {
      return
    }
    this.setData({ activeKeyword, nextCursor: '' })
    void this.loadParticipants()
  },

  clearSearch() {
    if (!this.data.searchInput && !this.data.activeKeyword) {
      return
    }
    this.setData({ searchInput: '', activeKeyword: '', nextCursor: '' })
    void this.loadParticipants()
  },

  changeKind(event: WechatMiniprogram.TouchEvent) {
    const kind = String(event.currentTarget.dataset.kind || '') as ParticipantKindFilter
    if (!['ALL', 'PLAYER', 'GUEST'].includes(kind) || kind === this.data.kind) {
      return
    }
    this.setData({ kind, nextCursor: '', message: '' })
    void this.loadParticipants()
  },

  loadMore() {
    void this.loadParticipants({ append: true })
  },

  onReachBottom() {
    this.loadMore()
  },

  async onPullDownRefresh() {
    try {
      await this.loadParticipants()
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  openProfile(event: WechatMiniprogram.TouchEvent) {
    const profileRef = String(event.currentTarget.dataset.profileRef || '')
    if (profileRef.startsWith('p1.')) {
      caseNavigateTo({ url: `/packages/member/mip-public-profile/index?profileRef=${encodeURIComponent(profileRef)}` })
    }
  },

  openInteraction(event: WechatMiniprogram.TouchEvent) {
    const viewMode = String(event.currentTarget.dataset.viewMode || 'SENT')
    caseNavigateTo({
      url: `/packages/member/mip-events/interaction/index?eventId=${encodeURIComponent(this.data.eventId)}&viewMode=${encodeURIComponent(viewMode)}`,
    })
  },

  onShareAppMessage() {
    return {
      title: '活动参与人',
      path: `/packages/member/mip-events/participants/index?eventId=${encodeURIComponent(this.data.eventId)}`,
    }
  },
})
