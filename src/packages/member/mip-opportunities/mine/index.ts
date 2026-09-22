import type { OpportunitySummary, ReceivedReferral } from '../../../../modules/mip-opportunities'
import { mipMessagingModule } from '../../../../modules/mip-messaging/client'
import { opportunityModule, opportunityStatusLabel } from '../../../../modules/mip-opportunities'
import { caseNavigateTo } from '../../../../platform/navigation/client'
import { formatLocalDateTime } from '../../../../utils/date'

type OpportunityTab = 'PUBLISHED' | 'REFERRED'
type SectionState = 'loading' | 'ready' | 'error'

interface PublishedView extends OpportunitySummary {
  statusLabel: string
  /** journey-review J6-03：已下架机会卡片置灰（招募中列表也不再展示）。 */
  dimmed: boolean
}

interface ReferralView extends ReceivedReferral {
  viewKey: string
  actorName: string
  actorInitial: string
  statusText: string
  updatedText: string
}

function presentPublished(item: OpportunitySummary): PublishedView {
  const label = opportunityStatusLabel(item)
  return {
    ...item,
    statusLabel: label,
    dimmed: label === '已下架',
  }
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
    state: 'loading' as SectionState,
    tab: 'PUBLISHED' as OpportunityTab,
    publishedState: 'loading' as SectionState,
    publishedItems: [] as PublishedView[],
    publishedNextCursor: '',
    referredState: 'loading' as SectionState,
    referredItems: [] as ReferralView[],
    referredNextCursor: '',
    referredUnreadCount: 0,
    loadingMore: false,
    openingKey: '',
    removingId: '',
    message: '',
  },
  publishedRequestSeq: 0,
  referredRequestSeq: 0,

  onLoad(query: { tab?: string }) {
    if (query.tab === 'REFERRED') {
      this.setData({ tab: 'REFERRED' })
    }
  },

  onShow() {
    void Promise.allSettled([
      this.loadPublished(true),
      this.loadReferred(true),
    ])
  },

  onHide() {
    this.publishedRequestSeq += 1
    this.referredRequestSeq += 1
  },

  onUnload() {
    this.publishedRequestSeq += 1
    this.referredRequestSeq += 1
  },

  changeTab(event: WechatMiniprogram.TouchEvent) {
    const tab = String(event.currentTarget.dataset.tab || '') as OpportunityTab
    if (['PUBLISHED', 'REFERRED'].includes(tab)) {
      this.setData({
        tab,
        state: tab === 'PUBLISHED' ? this.data.publishedState : this.data.referredState,
        message: '',
      })
    }
  },

  async loadPublished(reset = false) {
    if (!reset && (!this.data.publishedNextCursor || this.data.loadingMore)) {
      return
    }
    const sequence = this.publishedRequestSeq + 1
    this.publishedRequestSeq = sequence
    const cursor = reset ? undefined : this.data.publishedNextCursor || undefined
    this.setData(reset
      ? {
          publishedState: 'loading',
          publishedNextCursor: '',
          loadingMore: false,
          message: '',
          ...(this.data.tab === 'PUBLISHED' ? { state: 'loading' as SectionState } : {}),
        }
      : { loadingMore: true, message: '' })
    try {
      const page = await opportunityModule.listMine(cursor)
      if (sequence !== this.publishedRequestSeq) {
        return
      }
      this.setData({
        publishedState: 'ready',
        ...(this.data.tab === 'PUBLISHED' ? { state: 'ready' as SectionState } : {}),
        publishedItems: reset
          ? page.items.map(presentPublished)
          : [...this.data.publishedItems, ...page.items.map(presentPublished)],
        publishedNextCursor: page.nextCursor || '',
      })
    }
    catch (error) {
      if (sequence !== this.publishedRequestSeq) {
        return
      }
      this.setData({
        publishedState: this.data.publishedItems.length ? 'ready' : 'error',
        ...(this.data.tab === 'PUBLISHED'
          ? { state: this.data.publishedItems.length ? 'ready' as SectionState : 'error' as SectionState }
          : {}),
        message: error instanceof Error ? error.message : '已发布机会加载失败',
      })
    }
    finally {
      if (sequence === this.publishedRequestSeq) {
        this.setData({ loadingMore: false })
      }
    }
  },

  async loadReferred(reset = false) {
    if (!reset && (!this.data.referredNextCursor || this.data.loadingMore)) {
      return
    }
    const sequence = this.referredRequestSeq + 1
    this.referredRequestSeq = sequence
    const cursor = reset ? undefined : this.data.referredNextCursor || undefined
    this.setData(reset
      ? {
          referredState: 'loading',
          referredNextCursor: '',
          loadingMore: false,
          message: '',
          ...(this.data.tab === 'REFERRED' ? { state: 'loading' as SectionState } : {}),
        }
      : { loadingMore: true, message: '' })
    try {
      const page = await opportunityModule.listReceived(
        'REFERRAL',
        cursor,
      )
      if (sequence !== this.referredRequestSeq) {
        return
      }
      const referrals = page.items.filter((item): item is ReceivedReferral => item.kind === 'REFERRAL')
      const offset = reset ? 0 : this.data.referredItems.length
      this.setData({
        referredState: 'ready',
        ...(this.data.tab === 'REFERRED' ? { state: 'ready' as SectionState } : {}),
        referredItems: reset
          ? referrals.map(presentReferral)
          : [...this.data.referredItems, ...referrals.map((item, index) => presentReferral(item, offset + index))],
        referredNextCursor: page.nextCursor || '',
        referredUnreadCount: page.unreadCount,
      })
    }
    catch (error) {
      if (sequence !== this.referredRequestSeq) {
        return
      }
      this.setData({
        referredState: this.data.referredItems.length ? 'ready' : 'error',
        ...(this.data.tab === 'REFERRED'
          ? { state: this.data.referredItems.length ? 'ready' as SectionState : 'error' as SectionState }
          : {}),
        message: error instanceof Error ? error.message : '被引荐机会加载失败',
      })
    }
    finally {
      if (sequence === this.referredRequestSeq) {
        this.setData({ loadingMore: false })
      }
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

  /** journey-review J6-03（C5 拍板）：长按卡片删除 + 微信原生确认弹窗 + 系统 toast。 */
  confirmDeletePublished(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    const item = this.data.publishedItems.find(entry => entry.id === id)
    if (!item || this.data.removingId) {
      return
    }
    wx.showModal({
      title: '删除机会',
      content: '删除后将无法恢复，是否删除？',
      confirmText: '删除',
      confirmColor: '#FF4D5E',
      success: (result) => {
        if (result.confirm) {
          void this.deletePublished(item)
        }
      },
    })
  },

  async deletePublished(item: PublishedView) {
    if (this.data.removingId) {
      return
    }
    this.setData({ removingId: item.id, message: '' })
    try {
      // 列表 DTO 不带 version，先取详情拿并发版本再归档。
      const detail = await opportunityModule.get(item.id)
      await opportunityModule.remove(item.id, detail.version)
      this.setData({
        publishedItems: this.data.publishedItems.filter(entry => entry.id !== item.id),
      })
      wx.showToast({ title: '已删除', icon: 'none', duration: 1800 })
    }
    catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '删除失败，请稍后重试', icon: 'none' })
    }
    finally {
      this.setData({ removingId: '' })
    }
  },

  openPublished(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    if (id) {
      caseNavigateTo({ url: `/packages/member/mip-opportunities/detail/index?id=${encodeURIComponent(id)}` })
    }
  },

  editPublished(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    const item = this.data.publishedItems.find(entry => entry.id === id)
    if (item && ['DRAFT', 'PUBLISHED'].includes(item.status)) {
      caseNavigateTo({ url: `/packages/member/mip-opportunities/editor/index?id=${encodeURIComponent(id)}` })
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
