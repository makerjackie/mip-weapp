import type { QueryOptions } from '@weapp/shared/cache'
import type {
  AnnouncementSummary,
  EventSummary,
  MembershipOverview,
  RecommendationSummary,
} from '../../modules/membership/types'
import { prepareApp } from '../../bootstrap'
import { brand } from '../../config/brand'
import { runtimeConfig } from '../../config/runtime'
import { membershipModule } from '../../modules/membership/client'
import { caseNavigateTo, caseSwitchPrimary, syncCaseNavigation } from '../../modules/platform/case-navigation'
import { formatLocalDate, formatLocalMonthDayTime } from '../../utils/date'

prepareApp()

interface HomeEvent extends EventSummary {
  availabilityText: string
  startsText: string
}

interface HomeMember extends RecommendationSummary {
  initial: string
}

function membershipCopy(overview: MembershipOverview) {
  const expiresAt = overview.membership.expiresAt
  const expired = Boolean(expiresAt && new Date(expiresAt).getTime() <= Date.now())
  if (overview.membership.active) {
    return {
      label: `${brand.productName}会员`,
      action: '查看会员凭证',
      description: expiresAt ? `有效期至 ${formatLocalDate(expiresAt)}` : '会员权益使用中',
    }
  }
  if (expired) {
    return {
      label: '会员已到期',
      action: '重新开通会员',
      description: '续费后恢复完整成员资料与会员活动',
    }
  }
  return {
    label: `欢迎加入${brand.productName}`,
    action: '了解会员权益',
    description: '加入后解锁完整成员资料与会员活动',
  }
}

function homeEvent(event: EventSummary): HomeEvent {
  const remaining = event.capacity === null ? null : Math.max(0, event.capacity - event.registrationCount)
  return {
    ...event,
    availabilityText: event.registered ? '已报名' : remaining === null ? '开放报名' : `剩余 ${remaining} 位`,
    startsText: formatLocalMonthDayTime(event.startsAt),
  }
}

function overviewData(overview: MembershipOverview) {
  const nextEvent = overview.events.find(event => event.registered) || overview.events[0]
  const membership = membershipCopy(overview)
  return {
    state: 'ready' as const,
    membershipLabel: membership.label,
    membershipAction: membership.action,
    expiresText: membership.description,
    profileCompletion: overview.profile.completion,
    nicknameInitial: (overview.profile.nickname || '同').slice(0, 1),
    avatarUrl: overview.profile.avatarUrl,
    nextEvent: nextEvent ? homeEvent(nextEvent) : null,
    events: overview.events.slice(0, 2).map(homeEvent),
    recommendations: overview.recommendations.slice(0, 4).map(item => ({
      ...item,
      initial: item.nickname.slice(0, 1) || '友',
    })),
    announcement: overview.announcements[0] || null,
  }
}

function overviewSignature(overview: MembershipOverview) {
  return JSON.stringify(overviewData(overview))
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    membershipLabel: '',
    membershipAction: '查看会员权益',
    expiresText: '',
    profileCompletion: 0,
    nicknameInitial: '同',
    avatarUrl: '',
    message: '',
    nextEvent: null as HomeEvent | null,
    events: [] as HomeEvent[],
    recommendations: [] as HomeMember[],
    announcement: null as AnnouncementSummary | null,
    overviewSignature: '',
    isEmbeddedCase: false,
    productName: brand.productName,
    tagline: brand.tagline,
    logoPath: brand.logoPath,
    serviceUnconfigured: runtimeConfig.unconfigured.cloudbase,
  },

  onShow() {
    syncCaseNavigation(this, 'pages/index/index')
    void this.loadOverview()
  },

  async loadOverview(options: QueryOptions = {}) {
    const cached = membershipModule.peekOverview()
    if (cached) {
      this.applyOverview(cached)
    }
    else if (this.data.state !== 'ready') {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const overview = await membershipModule.load(options)
      this.applyOverview(overview)
    }
    catch (error) {
      if (cached || this.data.state === 'ready') {
        this.setData({ message: '内容更新失败，已保留上次结果。' })
      }
      else {
        this.setData({ state: 'error', message: error instanceof Error ? error.message : '首页加载失败' })
      }
    }
  },

  applyOverview(overview: MembershipOverview) {
    const signature = overviewSignature(overview)
    if (this.data.state === 'ready' && this.data.overviewSignature === signature) {
      if (this.data.message) {
        this.setData({ message: '' })
      }
      return
    }
    this.setData({
      ...overviewData(overview),
      message: '',
      overviewSignature: signature,
    })
  },

  async onPullDownRefresh() {
    try {
      await this.loadOverview({ force: true })
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  openMembership() {
    caseNavigateTo({ url: '/pages/membership/index' })
  },

  openAnnouncements() {
    caseNavigateTo({ url: '/packages/member/announcements/index' })
  },

  openAnnouncement(event: WechatMiniprogram.TouchEvent) {
    const announcementId = String(event.currentTarget.dataset.id || '')
    if (announcementId) {
      caseNavigateTo({
        url: `/packages/member/announcement-detail/index?announcementId=${encodeURIComponent(announcementId)}`,
      })
    }
  },

  openExplore() {
    caseSwitchPrimary('/pages/explore/index')
  },

  openEvents() {
    caseSwitchPrimary('/pages/events/index')
  },

  openProfile() {
    caseSwitchPrimary('/pages/profile/index')
  },

  openMember(event: WechatMiniprogram.CustomEvent<{ id: string }>) {
    const memberId = event.detail.id
    if (!memberId) {
      return
    }
    caseNavigateTo({ url: `/packages/member/member-detail/index?memberId=${encodeURIComponent(memberId)}` })
  },

  openMemberAvatar(event: WechatMiniprogram.TouchEvent) {
    const memberId = String(event.currentTarget.dataset.id || '')
    if (memberId) {
      caseNavigateTo({ url: `/packages/member/member-detail/index?memberId=${encodeURIComponent(memberId)}` })
    }
  },

  openEvent(event: WechatMiniprogram.CustomEvent<{ id: string }>) {
    const eventId = event.detail.id
    if (eventId) {
      caseNavigateTo({ url: `/packages/member/event-detail/index?eventId=${encodeURIComponent(eventId)}` })
    }
  },

  openFeaturedEvent(event: WechatMiniprogram.TouchEvent) {
    const eventId = String(event.currentTarget.dataset.id || '')
    if (eventId) {
      caseNavigateTo({ url: `/packages/member/event-detail/index?eventId=${encodeURIComponent(eventId)}` })
    }
  },
})
