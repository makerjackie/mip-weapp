import type { BranchId, EventId, OpportunityId } from '../../modules/mip'
import type { AnnouncementSummary } from '../../modules/mip-announcements'
import type { MipBannerTargetType } from '../../modules/mip-banners'
import type { MipEventListItem } from '../../modules/mip-events'
import type { IdentityAccessSnapshot } from '../../modules/mip-identity'
import type { OpportunitySummary } from '../../modules/mip-opportunities'
import { brand } from '../../config/brand'
import { cooperationRoles } from '../../config/mip-catalogs'
import { mipOperationsConfig } from '../../config/mip-operations'
import { mipAnnouncementsModule } from '../../modules/mip-announcements'
import { mipBannerModule } from '../../modules/mip-banners'
import { mipEventsModule } from '../../modules/mip-events/client'
import { mipBranchesModule, mipIdentityModule } from '../../modules/mip-identity/client'
import { opportunityModule } from '../../modules/mip-opportunities'
import { membershipPresentation } from '../../modules/mip-shell'
import { caseNavigateTo, caseSwitchPrimary, syncCaseNavigation } from '../../modules/platform/case-navigation'
import { formatLocalMonthDayTime } from '../../utils/date'

interface DiscoverEvent extends MipEventListItem {
  startsText: string
  locationText: string
  accessLabel: string
}

interface DiscoverOpportunity extends OpportunitySummary {
  roleText: string
  locationText: string
  metaText: string
}

function presentEvent(event: MipEventListItem): DiscoverEvent {
  const accessLabel = event.accessType === 'MEMBER_INCLUDED'
    ? '玩家活动'
    : event.accessType === 'PAID' ? '付费活动' : '免费活动'
  return {
    ...event,
    coverUrl: event.coverUrl || mipOperationsConfig.defaultCoverPaths.event,
    startsText: formatLocalMonthDayTime(event.startsAt),
    locationText: [event.cityName, event.venueName].filter(Boolean).join(' · ') || '地点待公布',
    accessLabel,
  }
}

function presentOpportunity(item: OpportunitySummary): DiscoverOpportunity {
  const roleText = item.roles
    .map(key => cooperationRoles.find(role => role.key === key)?.name || '')
    .filter(Boolean)
    .slice(0, 2)
    .join(' · ')
  const locationText = item.city?.label || item.branchName || '全国'
  return {
    ...item,
    roleText,
    locationText,
    metaText: [locationText, roleText].filter(Boolean).join(' · '),
  }
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready',
    logoPath: brand.logoPath,
    productName: brand.productName,
    bannerImagePath: mipOperationsConfig.homeBanner.imagePath as string,
    bannerAccessibilityLabel: mipOperationsConfig.homeBanner.accessibilityLabel as string,
    bannerTargetType: 'MINIPROGRAM_PATH' as MipBannerTargetType,
    bannerTargetValue: mipOperationsConfig.homeBanner.targetPath as string,
    identityState: 'loading' as 'loading' | 'ready' | 'error',
    membershipLabel: '嘉宾',
    membershipDescription: '当前没有有效会员权益',
    membershipEndsText: '',
    primaryBranchId: '' as BranchId | '',
    primaryBranchName: '全部城市',
    branchState: 'loading' as 'loading' | 'ready' | 'error',
    branchNames: [] as string[],
    branchNamesText: '',
    eventState: 'loading' as 'loading' | 'ready' | 'error',
    events: [] as DiscoverEvent[],
    opportunityState: 'loading' as 'loading' | 'ready' | 'error',
    opportunities: [] as DiscoverOpportunity[],
    announcement: null as AnnouncementSummary | null,
    hasAnnouncements: false,
  },
  onShow() {
    syncCaseNavigation(this, 'pages/index/index')
    void this.loadDiscover()
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
      this.setData({ eventState: 'ready', events: events.items.slice(0, 3).map(presentEvent) })
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
    const membership = membershipPresentation(snapshot.membership.kind, snapshot.membership.entitlement)
    const primaryBranchId = snapshot.primaryBranchId || ''
    const previousBranchId = this.data.primaryBranchId
    const branch = mipBranchesModule.peek()?.branches.find(item => item.id === primaryBranchId)
    this.setData({
      identityState: 'ready',
      membershipLabel: membership.label,
      membershipDescription: membership.description,
      membershipEndsText: membership.endsAt ? membership.endsAt.slice(0, 10) : '',
      primaryBranchId,
      primaryBranchName: branch?.name || this.data.primaryBranchName,
    })
    if (primaryBranchId !== previousBranchId) {
      void this.loadAnnouncements(primaryBranchId)
    }
  },

  async loadAnnouncements(branchId?: BranchId | '') {
    const selectedBranchId = branchId ?? this.data.primaryBranchId
    try {
      const page = await mipAnnouncementsModule.list({ branchId: selectedBranchId || undefined, limit: 5 })
      this.setData({
        hasAnnouncements: page.items.length > 0,
        announcement: page.items.find(item => item.isPinned) || null,
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
    catch {
      if (this.data.branchState !== 'ready') {
        this.setData({ branchState: 'error' })
      }
    }
  },

  applyBranches(branches: Awaited<ReturnType<typeof mipBranchesModule.load>>['branches']) {
    const active = branches.filter(branch => branch.status === 'ACTIVE')
    const primary = active.find(branch => branch.id === this.data.primaryBranchId)
    this.setData({
      branchState: 'ready',
      branchNames: active.slice(0, 3).map(branch => branch.name),
      branchNamesText: active.slice(0, 3).map(branch => branch.name).join(' · '),
      primaryBranchName: primary?.name || (this.data.primaryBranchId ? '主分会' : '全部城市'),
    })
  },

  async loadEvents(options: { force?: boolean }) {
    const query = { view: 'UPCOMING' as const, dateFilter: 'RECENT' as const, limit: 3 }
    const cached = mipEventsModule.peekEvents(query)
    if (cached) {
      this.setData({ eventState: 'ready', events: cached.items.slice(0, 3).map(presentEvent) })
    }
    try {
      const feed = await mipEventsModule.listEvents(query, options)
      this.setData({ eventState: 'ready', events: feed.items.slice(0, 3).map(presentEvent) })
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
        opportunities: result.items.slice(0, 3).map(presentOpportunity),
      })
    }
    catch {
      if (!this.data.opportunities.length) {
        this.setData({ opportunityState: 'error' })
      }
    }
  },

  async loadBanner(force = false) {
    try {
      const [banner] = await mipBannerModule.listActive(force)
      this.setData(banner
        ? {
            bannerImagePath: banner.imageUrl,
            bannerAccessibilityLabel: banner.accessibilityLabel,
            bannerTargetType: banner.targetType,
            bannerTargetValue: banner.targetValue,
          }
        : {
            bannerImagePath: mipOperationsConfig.homeBanner.imagePath,
            bannerAccessibilityLabel: mipOperationsConfig.homeBanner.accessibilityLabel,
            bannerTargetType: 'MINIPROGRAM_PATH',
            bannerTargetValue: mipOperationsConfig.homeBanner.targetPath,
          })
    }
    catch {}
  },

  async onPullDownRefresh() {
    try {
      await this.loadDiscover({ force: true })
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  openMembership() {
    caseNavigateTo({ url: '/pages/membership/index' })
  },

  openBanner() {
    if (this.data.bannerTargetType === 'ARTICLE_URL') {
      wx.openOfficialAccountArticle({
        url: this.data.bannerTargetValue,
        fail: () => wx.showToast({ title: '文章暂未配置', icon: 'none' }),
      })
      return
    }
    const targetPath = this.data.bannerTargetValue
    if (targetPath.startsWith('/') && !targetPath.startsWith('//') && targetPath.length < 300) {
      caseNavigateTo({ url: targetPath })
    }
  },

  openBranches() {
    caseNavigateTo({ url: '/packages/member/mip-branches/index' })
  },

  openBlindBoxes() {
    caseNavigateTo({ url: '/packages/member/mip-blind-box/index' })
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
    const eventId = String(event.currentTarget.dataset.id || '') as EventId
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
