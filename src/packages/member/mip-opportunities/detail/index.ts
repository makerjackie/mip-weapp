import type { OpportunityId } from '../../../../modules/mip'
import type { OpportunityDetail } from '../../../../modules/mip-opportunities'
import { cooperationRoles } from '../../../../config/mip-catalogs'
import { mipAccessPageUrl } from '../../../../modules/mip-identity'
import { mipIdentityModule } from '../../../../modules/mip-identity/client'
import { opportunityModule } from '../../../../modules/mip-opportunities'
import { caseNavigateTo } from '../../../../modules/platform/case-navigation'

Page({
  data: {
    id: '' as OpportunityId,
    state: 'loading' as 'loading' | 'ready' | 'error',
    item: null as OpportunityDetail | null,
    roleNames: [] as string[],
    message: '',
    acting: false,
  },
  resumeInteraction: '' as '' | 'referral' | 'interest',

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

  async toggleInterest() {
    await this.authorizeInteraction('interest')
  },

  async authorizeInteraction(interaction: 'referral' | 'interest') {
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

  async performInteraction(interaction: 'referral' | 'interest') {
    const item = this.data.item
    if (!item || this.data.acting) {
      return
    }
    this.setData({ acting: true })
    try {
      if (interaction === 'referral') {
        const result = await opportunityModule.setReferral(item.id, !item.referralActive)
        this.setData({
          'item.referralActive': result.active,
          'item.referralCount': result.referralCount ?? item.referralCount,
        })
        wx.showToast({ title: result.active ? '已提交引荐意向' : '已取消引荐意向', icon: 'none' })
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

  openAuthor() {
    const profileRef = this.data.item?.author.profileRef
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
