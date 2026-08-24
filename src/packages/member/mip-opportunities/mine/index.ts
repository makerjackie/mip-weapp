import type { OpportunitySummary, ReceivedReferral } from '../../../../modules/mip-opportunities'
import { mipMessagingModule } from '../../../../modules/mip-messaging/client'
import { opportunityModule } from '../../../../modules/mip-opportunities'
import { caseNavigateTo } from '../../../../modules/platform/case-navigation'
import { formatLocalDateTime } from '../../../../utils/date'

type OpportunityTab = 'PUBLISHED' | 'REFERRED'
type SectionState = 'loading' | 'ready' | 'error'

interface ReferralView extends ReceivedReferral {
  viewKey: string
  actorName: string
  actorInitial: string
  statusText: string
  updatedText: string
}

function presentReferral(item: ReceivedReferral, index: number): ReferralView {
  const actorName = item.actor.nickname || 'MIP 用户'
  return {
    ...item,
    viewKey: item.messageId || `${item.opportunity.id}-${item.actor.profileRef}-${index}`,
    actorName,
    actorInitial: actorName.slice(0, 1),
    statusText: item.status === 'ACTIVE' ? '有效' : '已取消',
    updatedText: formatLocalDateTime(item.updatedAt),
  }
}

Page({
  data: {
    tab: 'PUBLISHED' as OpportunityTab,
    publishedState: 'loading' as SectionState,
    publishedItems: [] as OpportunitySummary[],
    publishedNextCursor: '',
    referredState: 'loading' as SectionState,
    referredItems: [] as ReferralView[],
    referredNextCursor: '',
    referredUnreadCount: 0,
    loadingMore: false,
    openingKey: '',
    message: '',
  },

  onShow() {
    void Promise.allSettled([
      this.loadPublished(true),
      this.loadReferred(true),
    ])
  },

  changeTab(event: WechatMiniprogram.TouchEvent) {
    const tab = String(event.currentTarget.dataset.tab || '') as OpportunityTab
    if (['PUBLISHED', 'REFERRED'].includes(tab)) {
      this.setData({ tab, message: '' })
    }
  },

  async loadPublished(reset = false) {
    if (!reset && (!this.data.publishedNextCursor || this.data.loadingMore)) {
      return
    }
    this.setData(reset
      ? { publishedState: 'loading', publishedNextCursor: '', message: '' }
      : { loadingMore: true, message: '' })
    try {
      const page = await opportunityModule.listMine(
        reset ? undefined : this.data.publishedNextCursor || undefined,
      )
      this.setData({
        publishedState: 'ready',
        publishedItems: reset ? page.items : [...this.data.publishedItems, ...page.items],
        publishedNextCursor: page.nextCursor || '',
      })
    }
    catch (error) {
      this.setData({
        publishedState: this.data.publishedItems.length ? 'ready' : 'error',
        message: error instanceof Error ? error.message : '已发布机会加载失败',
      })
    }
    finally {
      this.setData({ loadingMore: false })
    }
  },

  async loadReferred(reset = false) {
    if (!reset && (!this.data.referredNextCursor || this.data.loadingMore)) {
      return
    }
    this.setData(reset
      ? { referredState: 'loading', referredNextCursor: '', message: '' }
      : { loadingMore: true, message: '' })
    try {
      const page = await opportunityModule.listReceived(
        'REFERRAL',
        reset ? undefined : this.data.referredNextCursor || undefined,
      )
      const referrals = page.items.filter((item): item is ReceivedReferral => item.kind === 'REFERRAL')
      const offset = reset ? 0 : this.data.referredItems.length
      this.setData({
        referredState: 'ready',
        referredItems: reset
          ? referrals.map(presentReferral)
          : [...this.data.referredItems, ...referrals.map((item, index) => presentReferral(item, offset + index))],
        referredNextCursor: page.nextCursor || '',
        referredUnreadCount: page.unreadCount,
      })
    }
    catch (error) {
      this.setData({
        referredState: this.data.referredItems.length ? 'ready' : 'error',
        message: error instanceof Error ? error.message : '被引荐机会加载失败',
      })
    }
    finally {
      this.setData({ loadingMore: false })
    }
  },

  retry() {
    if (this.data.tab === 'PUBLISHED') {
      void this.loadPublished(true)
    }
    else {
      void this.loadReferred(true)
    }
  },

  onReachBottom() {
    if (this.data.tab === 'PUBLISHED') {
      void this.loadPublished(false)
    }
    else {
      void this.loadReferred(false)
    }
  },

  create() {
    caseNavigateTo({ url: '/packages/member/mip-opportunities/editor/index' })
  },

  openPublished(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    if (id) {
      caseNavigateTo({ url: `/packages/member/mip-opportunities/detail/index?id=${encodeURIComponent(id)}` })
    }
  },

  async openReferred(event: WechatMiniprogram.TouchEvent) {
    const viewKey = String(event.currentTarget.dataset.key || '')
    if (!viewKey || this.data.openingKey) {
      return
    }
    const item = this.data.referredItems.find(entry => entry.viewKey === viewKey)
    if (!item) {
      return
    }
    this.setData({ openingKey: viewKey, message: '' })
    if (item.unread && item.messageId) {
      try {
        await opportunityModule.markReceivedRead(item.messageId)
        const referredItems = this.data.referredItems.map(entry => (
          entry.viewKey === viewKey ? { ...entry, unread: false } : entry
        ))
        this.setData({
          referredItems,
          referredUnreadCount: Math.max(0, this.data.referredUnreadCount - 1),
        })
        mipMessagingModule.invalidate()
      }
      catch {
        this.setData({ message: '未读状态更新失败。' })
      }
    }
    this.setData({ openingKey: '' })
    caseNavigateTo({
      url: `/packages/member/mip-opportunities/detail/index?id=${encodeURIComponent(item.opportunity.id)}`,
    })
  },

  openReferrer(event: WechatMiniprogram.TouchEvent) {
    const profileRef = String(event.currentTarget.dataset.profileRef || '')
    if (profileRef) {
      caseNavigateTo({
        url: `/packages/member/mip-public-profile/index?profileRef=${encodeURIComponent(profileRef)}`,
      })
    }
  },

  openAllReceived() {
    caseNavigateTo({ url: '/packages/member/mip-received/index' })
  },
})
