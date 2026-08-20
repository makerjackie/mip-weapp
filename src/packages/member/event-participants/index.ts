import type {
  EventParticipantsPage,
  EventParticipantSummary,
} from '../../../modules/membership/types'
import { membershipModule } from '../../../modules/membership/client'
import { caseNavigateTo } from '../../../modules/platform/case-navigation'

interface ParticipantView extends EventParticipantSummary {
  subtitle: string
  introduction: string
}

function views(items: EventParticipantSummary[]): ParticipantView[] {
  return items.map(item => ({
    ...item,
    subtitle: [item.roleTitle, item.organization, item.city].filter(Boolean).join(' · '),
    introduction: item.bio || item.headline || '这位成员还没有填写公开介绍。',
  }))
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    eventId: '',
    eventTitle: '',
    totalRegistrationCount: 0,
    visibleParticipantCount: 0,
    roleFilters: [] as string[],
    roleViews: [] as Array<{ label: string, selected: boolean }>,
    selectedRole: '',
    items: [] as ParticipantView[],
    nextCursor: '' as string,
    loadingMore: false,
    message: '',
  },
  requestSeq: 0,

  onLoad(query: Record<string, string>) {
    const eventId = query.eventId || ''
    this.setData({ eventId })
    const cached = membershipModule.peekEventParticipants(eventId)
    if (cached) {
      this.applyPage(cached)
    }
    void this.load()
  },

  applyPage(page: EventParticipantsPage, append = false) {
    const nextItems = views(page.items)
    this.setData({
      state: 'ready',
      eventTitle: page.eventTitle,
      totalRegistrationCount: page.totalRegistrationCount,
      visibleParticipantCount: page.visibleParticipantCount,
      roleFilters: page.roleFilters,
      roleViews: [
        { label: '', selected: this.data.selectedRole === '' },
        ...page.roleFilters.map(label => ({
          label,
          selected: label === this.data.selectedRole,
        })),
      ],
      items: append ? [...this.data.items, ...nextItems] : nextItems,
      nextCursor: page.nextCursor || '',
      message: '',
    })
  },

  async load(force = false) {
    if (this.data.state !== 'ready') {
      this.setData({ state: 'loading', message: '' })
    }
    const seq = this.requestSeq + 1
    this.requestSeq = seq
    try {
      const page = await membershipModule.listEventParticipants(
        this.data.eventId,
        '',
        this.data.selectedRole,
        { force },
      )
      if (seq === this.requestSeq) {
        this.applyPage(page)
      }
    }
    catch (error) {
      if (seq !== this.requestSeq) {
        return
      }
      this.setData(this.data.state === 'ready'
        ? { message: '参与者更新失败，已保留上次结果。' }
        : { state: 'error', message: error instanceof Error ? error.message : '参与者加载失败' })
    }
  },

  chooseRole(event: WechatMiniprogram.BaseEvent) {
    const role = String(event.currentTarget.dataset.role || '')
    if (role === this.data.selectedRole) {
      return
    }
    this.setData({ selectedRole: role, items: [], nextCursor: '' })
    void this.load(true)
  },

  openMember(event: WechatMiniprogram.BaseEvent) {
    const memberId = String(event.currentTarget.dataset.memberId || '')
    if (memberId) {
      caseNavigateTo({
        url: `/packages/member/member-detail/index?memberId=${encodeURIComponent(memberId)}`,
      })
    }
  },

  async loadMore() {
    if (!this.data.nextCursor || this.data.loadingMore) {
      return
    }
    this.setData({ loadingMore: true })
    try {
      const page = await membershipModule.listEventParticipants(
        this.data.eventId,
        this.data.nextCursor,
        this.data.selectedRole,
        { force: true },
      )
      this.applyPage(page, true)
    }
    catch {
      this.setData({ message: '更多参与者加载失败，请稍后重试。' })
    }
    finally {
      this.setData({ loadingMore: false })
    }
  },

  onReachBottom() {
    void this.loadMore()
  },

  async onPullDownRefresh() {
    try {
      await this.load(true)
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },
})
