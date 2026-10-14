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

type ParticipantKindFilter = 'PLAYER' | 'GUEST'
type ParticipantViewMode = 'PUBLIC' | 'SENT' | 'RECEIVED'
type HeartAccessState = 'loading' | 'ready' | 'restricted' | 'error'

interface ParticipantView {
  profileRef: string
  avatarUrl?: string
  displayName: string
  kindLabel: string
  metaText: string
  // MIW-52 统一三标签（地区MIP | 代表行业 | 身份状态）；metaText 保留作搜索口径（含分支名）。
  profileTags: string[]
  introductionText: string
  // MIW-73：嘉宾卡同构信息面——左上等级、左下勋章、右下邀请人；不造值，缺省空串/空数组。
  levelText: string
  medals: { id: string, imageUrl?: string }[]
  inviterName: string
  inviterAvatarUrl: string
  inviterKind: 'PLAYER' | 'PLATFORM'
  /** 心动票凭证（仅签到参与人持有）：卡片右上角心形可投的依据，undefined 表示不可投。 */
  heartTicket?: string
}

/** MIW-73：嘉宾卡同构字段映射（等级/勋章/邀请人），四个 tab 共用，同 mip-hearts 口径。 */
function presentCardPerson(source: {
  level?: { number: number, name: string }
  badges?: { id: string, name: string, imageUrl?: string }[]
  inviter?: { sourceType: 'USER' | 'PLATFORM', displayName: string, avatarUrl?: string }
}) {
  return {
    levelText: source.level ? `Lv.${source.level.number}` : '',
    medals: (source.badges || []).map(badge => ({ id: badge.id, imageUrl: badge.imageUrl })),
    inviterName: source.inviter?.displayName || '',
    inviterAvatarUrl: source.inviter?.avatarUrl || '',
    inviterKind: (source.inviter?.sourceType === 'PLATFORM' ? 'PLATFORM' : 'PLAYER') as 'PLAYER' | 'PLATFORM',
  }
}

function presentParticipant(participant: PublicEventParticipant, candidates: HeartCandidate[]): ParticipantView {
  const branchText = participant.primaryBranch
    ? [participant.primaryBranch.cityName, participant.primaryBranch.name].filter(Boolean).join(' · ')
    : ''
  return {
    ...participant,
    displayName: participant.nickname || '未公开姓名',
    kindLabel: participant.userKind === 'PLAYER' ? '玩家' : participant.userKind === 'GUEST' ? '嘉宾' : '',
    metaText: [branchText, participant.primaryIndustry?.label, participant.identityStatus].filter(Boolean).join(' · '),
    profileTags: [
      participant.primaryBranch?.cityName ? `${participant.primaryBranch.cityName}MIP` : '',
      participant.primaryIndustry?.label || '',
      participant.identityStatus || '',
    ].filter(Boolean).slice(0, 3),
    introductionText: participant.introduction || participant.headline || '',
    ...presentCardPerson(participant),
    heartTicket: candidates.find(candidate => candidate.profileRef === participant.profileRef)?.participantRef,
  }
}

function presentHeartCandidate(candidate: HeartCandidate): ParticipantView {
  return {
    profileRef: candidate.profileRef,
    avatarUrl: candidate.avatarUrl,
    displayName: candidate.nickname || '未公开姓名',
    kindLabel: '',
    metaText: '',
    // MIW-73：心动 tab 补齐与名单 tab 同构的三标签（地区MIP | 代表行业 | 身份状态）与介绍。
    profileTags: [
      candidate.cityName ? `${candidate.cityName}MIP` : '',
      candidate.industryLabel || '',
      candidate.identityStatus || '',
    ].filter(Boolean).slice(0, 3),
    introductionText: candidate.introduction || candidate.headline || '',
    ...presentCardPerson(candidate),
    heartTicket: candidate.participantRef,
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

/**
 * MIW-101：由 (heart, candidates) 统一推导心动视图面——乐观态与服务端态共用同一推导，
 * 不出现双口径。徽标计数取 heart.counts（服务端事实；乐观态为「上次服务端计数 ± 本地意图」）。
 */
function deriveHeartViewPatch(
  heart: HeartState,
  candidates: HeartCandidate[],
  scope: { items: ParticipantView[], activeView: ParticipantViewMode, keyword: string },
): Record<string, unknown> {
  const markedCandidates = candidates.map(candidate => ({
    ...candidate,
    selected: Boolean(heart.targetRef) && heart.target?.profileRef === candidate.profileRef,
  }))
  const sentItems = heart.target
    ? [presentHeartCandidate(heart.target)]
    : []
  const receivedItems = heart.received
    .map(candidate => presentHeartCandidate(candidate))
  const patch: Record<string, unknown> = {
    candidates: markedCandidates,
    sentItems,
    receivedItems,
    heartMineCount: heart.counts?.myInterestCount ?? 0,
    heartReceivedCount: heart.counts?.receivedInterestCount ?? 0,
  }
  if (scope.activeView !== 'PUBLIC') {
    Object.assign(patch, privateViewData(scope.activeView, sentItems, receivedItems, scope.keyword))
  }
  else {
    // 公开列表的心动票凭证随候选集回填（先到者的已映射凭证不覆盖），保持卡片红心与可投状态同步。
    const items = scope.items.map(item => ({
      ...item,
      heartTicket: item.heartTicket
        ?? markedCandidates.find(candidate => candidate.profileRef === item.profileRef)?.participantRef,
    }))
    patch.items = items
    patch.displayItems = items
  }
  return patch
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
    /** MIW-36：tab 徽标计数来自服务端 heartCounts（与详情胶囊同源），非列表长度。 */
    heartMineCount: 0,
    heartReceivedCount: 0,
    /** 差异报告 C1（figma 1818:17230）：嘉宾/玩家胶囊计数，来自服务端 kindTotals。 */
    kindTotals: null as { PLAYER: number, GUEST: number } | null,
    candidates: [] as HeartCandidate[],
    heart: null as HeartState | null,
    activeView: 'PUBLIC' as ParticipantViewMode,
    emptyTitle: '暂无公开参与人',
    emptyDescription: '符合当前条件的公开资料会显示在这里。',
    kind: 'PLAYER' as ParticipantKindFilter,
    searchInput: '',
    activeKeyword: '',
    nextCursor: '',
    loadingMore: false,
    /** MIW-101：最近一次乐观点按的 profileRef——红心弹跳动画只在该卡播放一次，服务端事实到达后清除。 */
    heartPulseRef: '',
    message: '',
    heartMessage: '',
  },
  requestSeq: 0,
  heartRequestSeq: 0,
  hasShown: false,
  /** MIW-101：心动写同步单飞 worker 状态（非渲染数据）——同一时刻至多一个 setHeart 在途。 */
  heartSyncing: false,
  heartSyncQueued: false,
  heartSyncDesired: undefined as string | null | undefined,
  /** MIW-101：最后一次服务端心动事实——乐观更新失败时的回滚基准。 */
  lastServerHeart: null as HeartState | null,

  onLoad(query: Record<string, string | undefined>) {
    // journey-review J2-02：四 tab（嘉宾/玩家/我的心动/对我心动），默认 tab 由入口决定
    // ——参与人数/详情进「玩家」，与你互动胶囊直达对应心动 tab。
    const requestedView = String(query.view || '')
    const activeView = (['PUBLIC', 'SENT', 'RECEIVED'].includes(requestedView)
      ? requestedView
      : 'PUBLIC') as ParticipantViewMode
    const kind = (activeView === 'PUBLIC' && query.kind === 'GUEST' ? 'GUEST' : 'PLAYER') as ParticipantKindFilter
    this.setData({
      eventId: String(query.eventId || '') as EventId,
      activeView,
      kind,
    })
    if (activeView !== 'PUBLIC') {
      this.setData(privateViewData(activeView, [], [], ''))
    }
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
      userKind: this.data.kind,
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
      const candidates = this.data.candidates
      const items = append
        ? [...this.data.items, ...page.items.map(item => presentParticipant(item, candidates))]
        : page.items.map(item => presentParticipant(item, candidates))
      const uniqueItems = [...new Map(items.map(item => [item.profileRef, item])).values()]
      const patch: Record<string, unknown> = {
        state: 'ready',
        items: uniqueItems,
        nextCursor: page.nextCursor || '',
        message: '',
      }
      if (page.kindTotals) {
        patch.kindTotals = page.kindTotals
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
      this.applyHeartState(heart, candidates, requestSeq)
    }
    catch (error) {
      if (requestSeq !== this.heartRequestSeq) {
        return
      }
      if (isEventAccessRequirementError(error)
        || (error instanceof MipEventsError && error.code === 'FORBIDDEN')) {
        this.markHeartRestricted()
        return
      }
      this.setData({
        heartState: 'error',
        heartMessage: error instanceof Error ? error.message : '心动信息加载失败。',
        heartMineCount: 0,
        heartReceivedCount: 0,
        displayItems: this.data.activeView === 'PUBLIC' ? this.data.displayItems : [],
      })
    }
  },

  /** 以服务端心动事实刷新本地：sent/received 列表、候选选中态与服务端计数（MIW-36）。 */
  applyHeartState(heart: HeartState, candidates: HeartCandidate[], requestSeq?: number) {
    if (requestSeq !== undefined && requestSeq !== this.heartRequestSeq) {
      return
    }
    // MIW-101：服务端 version 随每次心动写入单调 +1（event-service setHeart），低版本必是
    // 旧快照。在途写回包（较新事实）可能先于并发读回包（旧快照，如下拉刷新恰逢投票）
    // 到达——丢弃旧快照，防止红心凭空消失、回滚基准（lastServerHeart）倒退。
    if (this.lastServerHeart && heart.version < this.lastServerHeart.version) {
      return
    }
    // MIW-101：记录最后一次服务端事实，作为乐观更新失败的回滚基准。
    this.lastServerHeart = heart
    const patch: Record<string, unknown> = {
      heartState: 'ready',
      heart,
      heartMessage: '',
      heartPulseRef: '',
      ...deriveHeartViewPatch(heart, candidates, {
        items: this.data.items,
        activeView: this.data.activeView,
        keyword: this.data.activeKeyword,
      }),
    }
    if (heart.counts) {
      // 回填详情胶囊（MIW-36）：返回详情页 onShow 应用缓存即见最新计数，免整页强刷。
      // 乐观态不回填——详情胶囊缓存只认服务端计数。
      mipEventsModule.patchEventInteractionSummary(this.data.eventId, heart.counts)
    }
    this.setData(patch)
  },

  /** MIW-101：乐观应用本地投票意图——红心/徽标/心动 tab 即时翻转，不等数据库链路。 */
  applyOptimisticHeart(heart: HeartState, profileRef: string) {
    this.setData({
      heart,
      heartPulseRef: profileRef,
      ...deriveHeartViewPatch(heart, this.data.candidates, {
        items: this.data.items,
        activeView: this.data.activeView,
        keyword: this.data.activeKeyword,
      }),
    })
  },

  /** 未签到/身份受限时心动面整体转为不可操作态（loadHeartState 与写同步 worker 共用口径）。 */
  markHeartRestricted() {
    this.setData({
      heartState: 'restricted',
      heart: null,
      candidates: [],
      sentItems: [],
      receivedItems: [],
      heartMineCount: 0,
      heartReceivedCount: 0,
      heartPulseRef: '',
      displayItems: this.data.activeView === 'PUBLIC' ? this.data.displayItems : [],
      heartMessage: '',
    })
  },

  /** MIW-101：回滚到最后一次服务端心动事实（详情胶囊缓存不动——它只认服务端计数）。 */
  restoreServerHeartView() {
    if (!this.lastServerHeart) {
      return
    }
    this.applyHeartState(this.lastServerHeart, this.data.candidates)
  },

  /**
   * MIW-101：心动写同步单飞 worker——同一时刻至多一个 setHeart 在途，同步期间的
   * 连续点按合并为「最新意图」，由在途轮次结束后继续消化。成功以服务端事实校准；
   * CONFLICT 回刷；受限转 restricted；其余失败在无排队意图时回滚并提示。
   */
  async pumpHeartSync() {
    if (this.heartSyncing) {
      return
    }
    this.heartSyncing = true
    try {
      while (this.heartSyncQueued) {
        this.heartSyncQueued = false
        const desired = this.heartSyncDesired
        this.heartSyncDesired = undefined
        try {
          const heart = await mipEventsModule.setHeart(
            this.data.eventId,
            desired ?? null,
            this.data.heart?.version,
          )
          this.applyHeartState(heart, this.data.candidates)
        }
        catch (error) {
          if (error instanceof MipEventsError && error.code === 'CONFLICT') {
            // 版本漂移：以服务端事实为准回刷，用户可再点。
            await this.loadHeartState()
            continue
          }
          if (isEventAccessRequirementError(error)
            || (error instanceof MipEventsError && error.code === 'FORBIDDEN')) {
            this.markHeartRestricted()
            wx.showToast({ title: '完成签到后可参与心动互动。', icon: 'none' })
            continue
          }
          // 无更新意图排队才回滚；否则保留乐观态交给下一轮同步裁决。
          if (!this.heartSyncQueued) {
            this.restoreServerHeartView()
          }
          wx.showToast({ title: error instanceof Error && error.message ? error.message : '心动状态保存失败，请稍后重试。', icon: 'none' })
        }
      }
    }
    finally {
      this.heartSyncing = false
    }
    // 关闭「最后一次 while 判空与 syncing 复位之间落点」的窗口：仍有排队意图则续跑。
    if (this.heartSyncQueued) {
      await this.pumpHeartSync()
    }
  },

  /**
   * journey-review J2-02：心动票直接落在参与人卡右上角——灰描边未投可点、点中变红
   * 实心、再点取消；每场仅 1 票，切换目标由服务端改选（单行 UPDATE）。
   * MIW-101：点击先本地乐观翻转（红心变色弹跳 + 徽标 ±1 + toast 即时反馈），服务端
   * 同步交给单飞 worker 串行跟进。名单内未签到者（无凭证）点按就地解释规则，不发
   * 注定失败的服务端调用；未签到会话（restricted）灰心不可点，仅提示。
   */
  async toggleHeartVote(event: WechatMiniprogram.TouchEvent) {
    if (this.data.heartState === 'restricted') {
      wx.showToast({ title: '完成签到后可参与心动互动。', icon: 'none' })
      return
    }
    if (this.data.heartState === 'error') {
      // error 态灰心仍按兜底渲染可见，点击不再静默：提示并就地重试心动状态。
      wx.showToast({ title: '心动信息暂时不可用，正在重试。', icon: 'none' })
      void this.loadHeartState()
      return
    }
    if (this.data.heartState !== 'ready') {
      wx.showToast({ title: '心动功能加载中，请稍候。', icon: 'none' })
      return
    }
    const profileRef = String(event.currentTarget.dataset.profileRef || '')
    const displayItem = this.data.displayItems.find(item => item.profileRef === profileRef)
    const ticket = displayItem?.heartTicket
      || this.data.candidates.find(candidate => candidate.profileRef === profileRef)?.participantRef
    const voted = this.data.heart?.target?.profileRef === profileRef
    if (!voted && !ticket) {
      // REQUIREMENTS §5：只能心动同场已签到的其他参与人——就地解释，不发起注定失败的请求。
      wx.showToast({ title: '只能心动同场已签到的其他参与人。', icon: 'none' })
      return
    }
    const candidate = (voted ? this.data.heart?.target : undefined)
      || this.data.candidates.find(item => item.profileRef === profileRef)
      || this.data.heart?.received.find(item => item.profileRef === profileRef)
      || (displayItem
        ? {
            participantRef: ticket || '',
            profileRef,
            nickname: displayItem.displayName,
            ...(displayItem.avatarUrl ? { avatarUrl: displayItem.avatarUrl } : {}),
            selected: true,
          }
        : undefined)
    if (!candidate) {
      return
    }
    // 乐观先行：目标红心立即变色弹跳、「我的心动」徽标即时到位、toast 即时。
    // 徽标增量 = 新意图票数 − 原服务端票数：换投（A→B）仍是一票不加不减，仅新投/取消 ±1，
    // 否则换投瞬间徽标闪成 2、服务端事实到达又弹回 1。
    const prevHeart = this.data.heart
    const nextTarget = voted ? undefined : { ...candidate, selected: true }
    this.applyOptimisticHeart({
      targetRef: nextTarget?.profileRef,
      ...(nextTarget ? { target: nextTarget } : {}),
      received: prevHeart?.received || [],
      counts: prevHeart?.counts
        ? {
            ...prevHeart.counts,
            myInterestCount: Math.max(0, prevHeart.counts.myInterestCount
            + (nextTarget ? 1 : 0)
            - (prevHeart.target ? 1 : 0)),
          }
        : undefined,
      version: prevHeart?.version || 0,
      updatedAt: prevHeart?.updatedAt,
    }, profileRef)
    wx.showToast({ title: voted ? '已取消心动' : '已心动', icon: 'success' })
    // 服务端同步：单飞 worker 串行消化最新意图（连续点按合并为最后一次目标）。
    // 凭证以展示层 heartTicket（候选集同源）优先，与投票入口判定同口径。
    this.heartSyncQueued = true
    this.heartSyncDesired = voted ? null : ticket
    await this.pumpHeartSync()
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
    if (!['PLAYER', 'GUEST'].includes(kind)
      || (kind === this.data.kind && this.data.activeView === 'PUBLIC')) {
      return
    }
    this.setData({
      activeView: 'PUBLIC',
      kind,
      nextCursor: '',
      items: [],
      displayItems: [],
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
      kind: 'PLAYER',
      nextCursor: '',
      items: [],
      displayItems: [],
      emptyTitle: '暂无公开参与人',
      emptyDescription: '符合当前条件的公开资料会显示在这里。',
    })
    // The cached public list may belong to the guest tab; reload for PLAYER.
    void this.loadParticipants()
  },

  retryHeartState() {
    void this.loadHeartState()
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
