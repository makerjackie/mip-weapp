import type { EventCardView } from '../../components/event-card/model'
import type { BranchId, EventId, OpportunityId } from '../../modules/mip'
import type { AnnouncementSummary } from '../../modules/mip-announcements'
import type { MipPublicBanner } from '../../modules/mip-banners'
import type { IdentityAccessSnapshot } from '../../modules/mip-identity'
import type { OpportunitySummary } from '../../modules/mip-opportunities'
import { presentEventCard } from '../../components/event-card/model'
import { brand } from '../../config/brand'
import { mipAnnouncementsModule } from '../../modules/mip-announcements'
import { mipBannerModule } from '../../modules/mip-banners'
import { mipEventsModule } from '../../modules/mip-events/client'
import { mipBranchesModule, mipIdentityModule } from '../../modules/mip-identity/client'
import { opportunityModule } from '../../modules/mip-opportunities'
import { caseNavigateTo, caseSwitchPrimary, syncCaseNavigation } from '../../platform/navigation/client'

Page({
  data: {
    state: 'loading' as 'loading' | 'ready',
    logoPath: brand.logoPath,
    productName: brand.productName,
    bannerState: 'loading' as 'loading' | 'ready' | 'empty' | 'error',
    banners: [] as MipPublicBanner[],
    identityState: 'loading' as 'loading' | 'ready' | 'error',
    primaryBranchId: '' as BranchId | '',
    primaryBranchName: '全部城市',
    eventState: 'loading' as 'loading' | 'ready' | 'error',
    events: [] as EventCardView[],
    opportunityState: 'loading' as 'loading' | 'ready' | 'error',
    opportunities: [] as OpportunitySummary[],
    announcement: null as AnnouncementSummary | null,
    hasAnnouncements: false,
  },
  announcementRequestSeq: 0,
  onShow() {
    syncCaseNavigation(this, 'pages/index/index')
    void this.loadDiscover()
  },

  onHide() {
    this.announcementRequestSeq += 1
  },

  onUnload() {
    this.announcementRequestSeq += 1
  },

  async loadDiscover(options: { force?: boolean } = {}) {
    if (this.data.state !== 'ready') {
      this.applyCachedContent()
    }
    await Promise.allSettled([
      this.loadIdentity(),
      this.loadBranches(options),
      this.loadEvents(options),
      this.loadOpportunities(),
      this.loadAnnouncements(),
      this.loadBanner(options.force === true),
    ])
    this.setData({ state: 'ready' })
  },

  applyCachedContent() {
    const identity = mipIdentityModule.peekSnapshot()
    if (identity) {
      this.applyIdentity(identity)
    }
    const branches = mipBranchesModule.peek()
    if (branches) {
      this.applyBranches(branches.branches)
    }
    const query = { view: 'UPCOMING' as const, dateFilter: 'RECENT' as const, limit: 3 }
    const events = mipEventsModule.peekEvents(query)
    if (events) {
      this.setData({ eventState: 'ready', events: events.items.slice(0, 3).map(presentEventCard) })
    }
  },

  async loadIdentity() {
    try {
      this.applyIdentity(await mipIdentityModule.loadSnapshot())
    }
    catch {
      if (this.data.identityState !== 'ready') {
        this.setData({ identityState: 'error' })
      }
    }
  },

  applyIdentity(snapshot: IdentityAccessSnapshot) {
    const primaryBranchId = snapshot.primaryBranchId || ''
    const previousBranchId = this.data.primaryBranchId
    const branch = mipBranchesModule.peek()?.branches.find(item => item.id === primaryBranchId)
    this.setData({
      identityState: 'ready',
      primaryBranchId,
      primaryBranchName: branch?.name || this.data.primaryBranchName,
    })
    if (primaryBranchId !== previousBranchId) {
      void this.loadAnnouncements(primaryBranchId)
    }
  },

  async loadAnnouncements(branchId?: BranchId | '') {
    const selectedBranchId = branchId ?? this.data.primaryBranchId
    const requestSeq = this.announcementRequestSeq + 1
    this.announcementRequestSeq = requestSeq
    try {
      const page = await mipAnnouncementsModule.list({ branchId: selectedBranchId || undefined, limit: 5 })
      if (requestSeq !== this.announcementRequestSeq || selectedBranchId !== this.data.primaryBranchId) {
        return
      }
      this.setData({
        hasAnnouncements: page.items.length > 0,
        announcement: page.items.find(item => item.isPinned) || page.items[0] || null,
      })
    }
    catch {}
  },

  async loadBranches(options: { force?: boolean }) {
    const cached = mipBranchesModule.peek()
    if (cached && !options.force) {
      this.applyBranches(cached.branches)
      return
    }
    try {
      const result = await mipBranchesModule.load()
      this.applyBranches(result.branches)
    }
    catch {}
  },

  applyBranches(branches: Awaited<ReturnType<typeof mipBranchesModule.load>>['branches']) {
    const active = branches.filter(branch => branch.status === 'ACTIVE')
    const primary = active.find(branch => branch.id === this.data.primaryBranchId)
    this.setData({
      primaryBranchName: primary?.name || (this.data.primaryBranchId ? '主分会' : '全部城市'),
    })
  },

  async loadEvents(options: { force?: boolean }) {
    const query = { view: 'UPCOMING' as const, dateFilter: 'RECENT' as const, limit: 3 }
    const cached = mipEventsModule.peekEvents(query)
    if (cached) {
      this.setData({ eventState: 'ready', events: cached.items.slice(0, 3).map(presentEventCard) })
    }
    try {
      const feed = await mipEventsModule.listEvents(query, {
        force: options.force === true || Boolean(cached),
      })
      this.setData({ eventState: 'ready', events: feed.items.slice(0, 3).map(presentEventCard) })
    }
    catch {
      if (!cached) {
        this.setData({ eventState: 'error' })
      }
    }
  },

  async loadOpportunities() {
    try {
      const result = await opportunityModule.list({ status: 'RECRUITING', limit: 3 })
      this.setData({
        opportunityState: 'ready',
        opportunities: result.items.slice(0, 3),
      })
    }
    catch {
      if (!this.data.opportunities.length) {
        this.setData({ opportunityState: 'error' })
      }
    }
  },

  async loadBanner(force = false) {
    if (!this.data.banners.length) {
      this.setData({ bannerState: 'loading' })
    }
    try {
      const banners = await mipBannerModule.listActive(force)
      this.setData({
        bannerState: banners.length ? 'ready' : 'empty',
        banners,
      })
    }
    catch {
      this.setData({ bannerState: this.data.banners.length ? 'ready' : 'error' })
    }
  },

  retryBanner() {
    void this.loadBanner(true)
  },

  async onPullDownRefresh() {
    try {
      await this.loadDiscover({ force: true })
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  openBanner(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index)
    const banner = Number.isInteger(index) ? this.data.banners[index] : undefined
    if (!banner) {
      return
    }
    if (banner.targetType === 'ARTICLE_URL') {
      wx.openOfficialAccountArticle({
        url: banner.targetValue,
        fail: () => wx.showToast({ title: '文章暂未配置', icon: 'none' }),
      })
      return
    }
    const targetPath = banner.targetValue
    if (targetPath.startsWith('/') && !targetPath.startsWith('//') && targetPath.length < 300) {
      caseNavigateTo({ url: targetPath })
    }
  },

  openBranches() {
    caseNavigateTo({ url: '/packages/member/mip-branches/index' })
  },

  openKnowledge() {
    caseNavigateTo({ url: '/packages/member/mip-knowledge/index' })
  },

  openEvents() {
    caseSwitchPrimary('/pages/events/index')
  },

  openOpportunities() {
    caseSwitchPrimary('/pages/opportunities/index')
  },

  openEvent(event: WechatMiniprogram.TouchEvent) {
    const detail = (event as unknown as { detail?: { id?: string } }).detail
    const eventId = String(detail?.id || event.currentTarget?.dataset?.id || '') as EventId
    if (eventId) {
      caseNavigateTo({ url: `/packages/member/mip-events/detail/index?eventId=${encodeURIComponent(eventId)}` })
    }
  },

  openOpportunity(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '') as OpportunityId
    if (id) {
      caseNavigateTo({ url: `/packages/member/mip-opportunities/detail/index?id=${encodeURIComponent(id)}` })
    }
  },

  openAnnouncements() {
    const query = this.data.primaryBranchId
      ? `?branchId=${encodeURIComponent(this.data.primaryBranchId)}`
      : ''
    caseNavigateTo({ url: `/packages/member/announcements/index${query}` })
  },

  openAnnouncement() {
    const id = this.data.announcement?.id
    if (id) {
      caseNavigateTo({ url: `/packages/member/announcement-detail/index?announcementId=${encodeURIComponent(id)}` })
    }
  },
})
