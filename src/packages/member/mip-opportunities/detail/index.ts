import type { OpportunityId } from '../../../../modules/mip'
import type { OpportunityDetail, PublicPerson } from '../../../../modules/mip-opportunities'
import { cooperationRoles } from '../../../../config/mip-catalogs'
import { mipAccessPageUrl } from '../../../../modules/mip-identity'
import { mipIdentityModule } from '../../../../modules/mip-identity/client'
import { opportunityModule } from '../../../../modules/mip-opportunities'
import { caseNavigateTo } from '../../../../modules/platform/case-navigation'
import { formatLocalDateTime } from '../../../../utils/date'

type Interaction = 'referral' | 'referral-cancel' | 'interest'

interface ReferralCandidate extends PublicPerson {
  displayName: string
  displayInitial: string
}

function presentCandidate(item: PublicPerson): ReferralCandidate {
  const displayName = item.nickname || 'MIP 用户'
  return { ...item, displayName, displayInitial: displayName.slice(0, 1) }
}

Page({
  data: {
    id: '' as OpportunityId,
    state: 'loading' as 'loading' | 'ready' | 'error',
    item: null as OpportunityDetail | null,
    publishedText: '',
    roleNames: [] as string[],
    message: '',
    acting: false,
    referralPickerVisible: false,
    referralKeyword: '',
    referralCandidates: [] as ReferralCandidate[],
    referralCandidatesLoading: false,
    referralCandidatesCursor: '',
    referralPickerMessage: '',
    selectedReferralTarget: null as ReferralCandidate | null,
  },
  resumeInteraction: '' as '' | Interaction,

  onLoad(options: Record<string, string | undefined>) {
    const id = String(options.id || '') as OpportunityId
    this.setData({ id })
    void this.load()
  },

  onShow() {
    const resume = mipIdentityModule.consumePendingResume('packages/member/mip-opportunities/detail/index')
    const interaction = this.resumeInteraction
    if (resume?.action === 'INTERACT' && interaction) {
      this.resumeInteraction = ''
      void this.performInteraction(interaction)
    }
    else if (interaction) {
      this.resumeInteraction = ''
    }
  },

  async load() {
    if (!this.data.id) {
      this.setData({ state: 'error', message: '机会信息不完整' })
      return
    }
    if (!this.data.item) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const item = await opportunityModule.get(this.data.id)
      this.setData({
        state: 'ready',
        item,
        publishedText: formatLocalDateTime(item.publishedAt),
        roleNames: item.roles.map(key => cooperationRoles.find(role => role.key === key)?.name || key),
        message: '',
      })
    }
    catch (error) {
      this.setData({
        state: 'error',
        message: error instanceof Error ? error.message : '机会加载失败',
      })
    }
  },

  async toggleReferral() {
    await this.authorizeInteraction('referral')
  },

  async changeReferralTarget() {
    await this.authorizeInteraction('referral')
  },

  async cancelReferral() {
    await this.authorizeInteraction('referral-cancel')
  },

  async toggleInterest() {
    await this.authorizeInteraction('interest')
  },

  async authorizeInteraction(interaction: Interaction) {
    const item = this.data.item
    if (!item || this.data.acting) {
      return
    }
    this.resumeInteraction = interaction
    this.setData({ acting: true })
    try {
      const session = await mipIdentityModule.beginProtectedAction({
        action: 'INTERACT',
        source: { navigation: 'navigateBack' },
      })
      if (!session.decision.ready) {
        caseNavigateTo({ url: mipAccessPageUrl(session.token) })
        return
      }
      this.resumeInteraction = ''
      this.setData({ acting: false })
      await this.performInteraction(interaction)
    }
    catch {
      this.resumeInteraction = ''
      wx.showToast({ title: '身份状态暂时无法确认', icon: 'none' })
    }
    finally {
      this.setData({ acting: false })
    }
  },

  async performInteraction(interaction: Interaction) {
    const item = this.data.item
    if (!item || this.data.acting) {
      return
    }
    this.setData({ acting: true })
    try {
      if (interaction === 'referral') {
        this.openReferralPicker()
        return
      }
      if (interaction === 'referral-cancel') {
        const result = await opportunityModule.setReferral(item.id, false)
        this.setData({
          'item.referralActive': result.active,
          'item.referralTarget': undefined,
          'item.referralCount': result.referralCount ?? item.referralCount,
        })
        wx.showToast({ title: '已取消引荐', icon: 'none' })
      }
      else {
        const result = await opportunityModule.setAuthorInterest(item.id, !item.interestActive)
        this.setData({ 'item.interestActive': result.active })
        wx.showToast({ title: result.active ? '已标记感兴趣' : '已取消感兴趣', icon: 'none' })
      }
    }
    catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '操作失败', icon: 'none' })
    }
    finally {
      this.setData({ acting: false })
    }
  },

  openReferralPicker() {
    const current = this.data.item?.referralTarget
    this.setData({
      referralPickerVisible: true,
      referralKeyword: '',
      referralCandidates: [],
      referralCandidatesCursor: '',
      referralPickerMessage: '',
      selectedReferralTarget: current
        ? presentCandidate({
            ...current,
            isSelf: false,
            userKind: 'GUEST',
            joinedAt: '',
          })
        : null,
    })
    void this.loadReferralCandidates(true)
  },

  closeReferralPicker() {
    if (!this.data.acting) {
      this.setData({ referralPickerVisible: false })
    }
  },

  handleReferralPickerVisibility(event: WechatMiniprogram.CustomEvent<{ visible?: boolean }>) {
    if (!event.detail.visible) {
      this.closeReferralPicker()
    }
  },

  updateReferralKeyword(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ referralKeyword: event.detail.value })
  },

  searchReferralCandidates() {
    void this.loadReferralCandidates(true)
  },

  loadMoreReferralCandidates() {
    if (this.data.referralCandidatesCursor) {
      void this.loadReferralCandidates(false)
    }
  },

  async loadReferralCandidates(reset: boolean) {
    if (this.data.referralCandidatesLoading || (!reset && !this.data.referralCandidatesCursor)) {
      return
    }
    this.setData({
      referralCandidatesLoading: true,
      referralPickerMessage: '',
      ...(reset ? { referralCandidates: [], referralCandidatesCursor: '' } : {}),
    })
    try {
      const page = await opportunityModule.listPeople({
        kind: 'ALL',
        scope: 'GLOBAL',
        keyword: this.data.referralKeyword.trim() || undefined,
        cursor: reset ? undefined : this.data.referralCandidatesCursor,
        limit: 20,
      })
      const incoming = page.items.filter(item => !item.isSelf).map(presentCandidate)
      const existing = reset ? [] : this.data.referralCandidates
      const profileRefs = new Set(existing.map(item => item.profileRef))
      this.setData({
        referralCandidates: [...existing, ...incoming.filter(item => !profileRefs.has(item.profileRef))],
        referralCandidatesCursor: page.nextCursor || '',
      })
    }
    catch (error) {
      this.setData({
        referralPickerMessage: error instanceof Error ? error.message : '候选人加载失败',
      })
    }
    finally {
      this.setData({ referralCandidatesLoading: false })
    }
  },

  selectReferralTarget(event: WechatMiniprogram.TouchEvent) {
    const profileRef = String(event.currentTarget.dataset.profileRef || '')
    const target = this.data.referralCandidates.find(item => item.profileRef === profileRef)
    if (target) {
      this.setData({ selectedReferralTarget: target, referralPickerMessage: '' })
    }
  },

  async confirmReferralTarget() {
    const item = this.data.item
    const target = this.data.selectedReferralTarget
    if (!item || !target || this.data.acting) {
      if (!target) {
        this.setData({ referralPickerMessage: '请选择被引荐人' })
      }
      return
    }
    this.setData({ acting: true, referralPickerMessage: '' })
    try {
      const result = await opportunityModule.setReferral(item.id, true, target.profileRef)
      this.setData({
        'referralPickerVisible': false,
        'item.referralActive': true,
        'item.referralTarget': {
          profileRef: target.profileRef,
          nickname: target.displayName,
          ...(target.avatarUrl ? { avatarUrl: target.avatarUrl } : {}),
          ...(target.headline ? { headline: target.headline } : {}),
        },
        'item.referralCount': result.referralCount ?? item.referralCount,
      })
      wx.showToast({ title: item.referralActive ? '已更新引荐对象' : '已引荐', icon: 'none' })
    }
    catch (error) {
      this.setData({ referralPickerMessage: error instanceof Error ? error.message : '引荐失败' })
    }
    finally {
      this.setData({ acting: false })
    }
  },

  openAuthor() {
    const profileRef = this.data.item?.author.profileRef
    if (profileRef) {
      caseNavigateTo({ url: `/packages/member/mip-public-profile/index?profileRef=${encodeURIComponent(profileRef)}` })
    }
  },

  openReferralTarget() {
    const profileRef = this.data.item?.referralTarget?.profileRef
    if (profileRef) {
      caseNavigateTo({ url: `/packages/member/mip-public-profile/index?profileRef=${encodeURIComponent(profileRef)}` })
    }
  },

  openTeamMember(event: WechatMiniprogram.TouchEvent) {
    const profileRef = String(event.currentTarget.dataset.profileRef || '')
    if (profileRef) {
      caseNavigateTo({ url: `/packages/member/mip-public-profile/index?profileRef=${encodeURIComponent(profileRef)}` })
    }
  },

  edit() {
    if (this.data.item?.canEdit) {
      caseNavigateTo({ url: `/packages/member/mip-opportunities/editor/index?id=${encodeURIComponent(this.data.id)}` })
    }
  },

  end() {
    const item = this.data.item
    if (!item || !item.canEdit || item.status !== 'PUBLISHED') {
      return
    }
    wx.showModal({
      title: '结束机会',
      content: '结束后会显示在“已完成”，已有引荐记录会保留。',
      confirmText: '确认结束',
      success: (result) => {
        if (result.confirm) {
          void this.confirmEnd(item)
        }
      },
    })
  },

  async confirmEnd(item: OpportunityDetail) {
    this.setData({ acting: true })
    try {
      await opportunityModule.end(item.id, item.version)
      await this.load()
      wx.showToast({ title: '机会已结束', icon: 'success' })
    }
    catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '操作失败', icon: 'none' })
    }
    finally {
      this.setData({ acting: false })
    }
  },

  onShareAppMessage() {
    return {
      title: this.data.item?.title || 'MIP 机会',
      path: `/packages/member/mip-opportunities/detail/index?id=${this.data.id}`,
    }
  },
})
