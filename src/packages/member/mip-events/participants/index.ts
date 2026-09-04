import type { EventId } from '../../../../modules/mip'
import type {
  HeartCandidate,
  HeartState,
  PublicEventParticipant,
  PublicEventParticipantQuery,
} from '../../../../modules/mip-events'
import { isEventAccessRequirementError, MipEventsError } from '../../../../modules/mip-events'
import { mipEventsModule } from '../../../../modules/mip-events/client'
import { caseNavigateTo } from '../../../../platform/navigation/client'

type ParticipantKindFilter = 'ALL' | 'PLAYER' | 'GUEST'
type ParticipantViewMode = 'PUBLIC' | 'SENT' | 'RECEIVED'
type HeartAccessState = 'loading' | 'ready' | 'restricted' | 'error'
type ParticipantHeartRelation = 'SENT' | 'RECEIVED' | 'MUTUAL'

interface ParticipantView {
  profileRef: string
  avatarUrl?: string
  displayName: string
  kindLabel: string
  metaText: string
  introductionText: string
  heartRelation?: ParticipantHeartRelation
}

function presentParticipant(participant: PublicEventParticipant): ParticipantView {
  const branchText = participant.primaryBranch
    ? [participant.primaryBranch.cityName, participant.primaryBranch.name].filter(Boolean).join(' · ')
    : ''
  return {
    ...participant,
    displayName: participant.nickname || '未公开姓名',
    kindLabel: participant.userKind === 'PLAYER' ? '玩家' : participant.userKind === 'GUEST' ? '嘉宾' : '',
    metaText: [branchText, participant.primaryIndustry?.label, participant.identityStatus].filter(Boolean).join(' · '),
    introductionText: participant.introduction || participant.headline || '',
    heartRelation: participant.heartRelation,
  }
}

function presentHeartCandidate(
  candidate: HeartCandidate,
  heartRelation: ParticipantHeartRelation,
): ParticipantView {
  return {
    profileRef: candidate.profileRef,
    avatarUrl: candidate.avatarUrl,
    displayName: candidate.nickname || '未公开姓名',
    kindLabel: '',
    metaText: '',
    introductionText: candidate.headline || '',
    heartRelation,
  }
}

function filterParticipants(items: ParticipantView[], keyword: string) {
  const normalized = keyword.trim().toLocaleLowerCase()
  if (!normalized) {
    return items
  }
  return items.filter(item => [item.displayName, item.metaText, item.introductionText]
    .filter(Boolean)
    .some(value => value.toLocaleLowerCase().includes(normalized)))
}

function privateViewData(
  view: Exclude<ParticipantViewMode, 'PUBLIC'>,
  sentItems: ParticipantView[],
  receivedItems: ParticipantView[],
  keyword: string,
) {
  const sent = view === 'SENT'
  const searching = Boolean(keyword.trim())
  return {
    displayItems: filterParticipants(sent ? sentItems : receivedItems, keyword),
    emptyTitle: searching ? '未找到匹配的参与者' : sent ? '暂无我的心动' : '暂无对我心动',
    emptyDescription: searching
      ? '请尝试其他关键词。'
      : sent
        ? '你还没有选择本场参与者。'
        : '本场暂时没有对你心动的参与者。',
  }
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    heartState: 'loading' as HeartAccessState,
    eventId: '' as EventId,
    items: [] as ParticipantView[],
    displayItems: [] as ParticipantView[],
    sentItems: [] as ParticipantView[],
    receivedItems: [] as ParticipantView[],
    heart: null as HeartState | null,
    activeView: 'PUBLIC' as ParticipantViewMode,
    emptyTitle: '暂无公开参与人',
    emptyDescription: '符合当前条件的公开资料会显示在这里。',
    kind: 'ALL' as ParticipantKindFilter,
    searchInput: '',
    activeKeyword: '',
    nextCursor: '',
    loadingMore: false,
    message: '',
    heartMessage: '',
  },
  requestSeq: 0,
  heartRequestSeq: 0,
  hasShown: false,

  onLoad(query: Record<string, string | undefined>) {
    this.setData({ eventId: String(query.eventId || '') as EventId })
    void this.loadPage()
  },

  onShow() {
    if (!this.hasShown) {
      this.hasShown = true
      return
    }
    void this.loadPage()
  },

  async loadPage() {
    await Promise.all([
      this.loadParticipants(),
      this.loadHeartState(),
    ])
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
      const patch: Record<string, unknown> = {
        state: 'ready',
        items: uniqueItems,
        nextCursor: page.nextCursor || '',
        message: '',
      }
      if (this.data.activeView === 'PUBLIC') {
        patch.displayItems = uniqueItems
      }
      this.setData(patch)
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

  async loadHeartState() {
    if (!this.data.eventId) {
      this.setData({ heartState: 'error', heartMessage: '活动信息不完整。' })
      return
    }
    const requestSeq = this.heartRequestSeq + 1
    this.heartRequestSeq = requestSeq
    this.setData({
      heartState: 'loading',
      heartMessage: '',
      ...(this.data.activeView === 'PUBLIC' ? {} : { displayItems: [] }),
    })
    try {
      const [candidates, heart] = await Promise.all([
        mipEventsModule.listHeartCandidates(this.data.eventId),
        mipEventsModule.getHeart(this.data.eventId),
      ])
      if (requestSeq !== this.heartRequestSeq) {
        return
      }
      const sentItems = candidates
        .filter(candidate => candidate.selected)
        .slice(0, 1)
        .map(candidate => presentHeartCandidate(candidate, 'SENT'))
      const receivedItems = heart.received
        .map(candidate => presentHeartCandidate(candidate, 'RECEIVED'))
      const patch: Record<string, unknown> = {
        heartState: 'ready',
        heart,
        sentItems,
        receivedItems,
        heartMessage: '',
      }
      if (this.data.activeView !== 'PUBLIC') {
        Object.assign(patch, privateViewData(
          this.data.activeView,
          sentItems,
          receivedItems,
          this.data.activeKeyword,
        ))
      }
      this.setData(patch)
    }
    catch (error) {
      if (requestSeq !== this.heartRequestSeq) {
        return
      }
      if (isEventAccessRequirementError(error)
        || (error instanceof MipEventsError && error.code === 'FORBIDDEN')) {
        this.setData({
          heartState: 'restricted',
          heart: null,
          sentItems: [],
          receivedItems: [],
          displayItems: this.data.activeView === 'PUBLIC' ? this.data.displayItems : [],
          heartMessage: '',
        })
        return
      }
      this.setData({
        heartState: 'error',
        heartMessage: error instanceof Error ? error.message : '心动信息加载失败。',
        displayItems: this.data.activeView === 'PUBLIC' ? this.data.displayItems : [],
      })
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
    if (this.data.activeView === 'PUBLIC') {
      void this.loadParticipants()
      return
    }
    this.setData(privateViewData(
      this.data.activeView,
      this.data.sentItems,
      this.data.receivedItems,
      activeKeyword,
    ))
  },

  clearSearch() {
    if (!this.data.searchInput && !this.data.activeKeyword) {
      return
    }
    this.setData({ searchInput: '', activeKeyword: '', nextCursor: '' })
    if (this.data.activeView === 'PUBLIC') {
      void this.loadParticipants()
      return
    }
    this.setData(privateViewData(
      this.data.activeView,
      this.data.sentItems,
      this.data.receivedItems,
      '',
    ))
  },

  changeKind(event: WechatMiniprogram.TouchEvent) {
    const kind = String(event.currentTarget.dataset.kind || '') as ParticipantKindFilter
    if (!['ALL', 'PLAYER', 'GUEST'].includes(kind)
      || (kind === this.data.kind && this.data.activeView === 'PUBLIC')) {
      return
    }
    this.setData({
      activeView: 'PUBLIC',
      kind,
      nextCursor: '',
      message: '',
      emptyTitle: '暂无公开参与人',
      emptyDescription: '符合当前条件的公开资料会显示在这里。',
    })
    void this.loadParticipants()
  },

  changeView(event: WechatMiniprogram.TouchEvent) {
    const requestedView = String(event.currentTarget.dataset.view || '')
    if (!['SENT', 'RECEIVED'].includes(requestedView) || requestedView === this.data.activeView) {
      return
    }
    const activeView = requestedView as Exclude<ParticipantViewMode, 'PUBLIC'>
    this.setData({
      activeView,
      message: '',
      ...privateViewData(
        activeView,
        this.data.sentItems,
        this.data.receivedItems,
        this.data.activeKeyword,
      ),
    })
  },

  showPublicParticipants() {
    this.setData({
      activeView: 'PUBLIC',
      displayItems: this.data.items,
      emptyTitle: '暂无公开参与人',
      emptyDescription: '符合当前条件的公开资料会显示在这里。',
    })
  },

  retryHeartState() {
    void this.loadHeartState()
  },

  openInteraction() {
    caseNavigateTo({
      url: `/packages/member/mip-events/interaction/index?eventId=${encodeURIComponent(this.data.eventId)}&viewMode=SENT`,
    })
  },

  loadMore() {
    if (this.data.activeView !== 'PUBLIC') {
      return
    }
    void this.loadParticipants({ append: true })
  },

  onReachBottom() {
    this.loadMore()
  },

  async onPullDownRefresh() {
    try {
      await this.loadPage()
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

  onShareAppMessage() {
    return {
      title: '活动参与人',
      path: `/packages/member/mip-events/participants/index?eventId=${encodeURIComponent(this.data.eventId)}`,
    }
  },
})
