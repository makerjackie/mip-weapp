import type { SuperCaseId } from '../../../../modules/mip'
import type { SuperCaseDetail } from '../../../../modules/mip-cases'
import { mipOperationsConfig } from '../../../../config/mip-operations'
import { superCaseModule } from '../../../../modules/mip-cases'
import { mipAccessPageUrl } from '../../../../modules/mip-identity'
import { mipIdentityModule } from '../../../../modules/mip-identity/client'
import { caseNavigateTo, leaveSecondaryPage } from '../../../../modules/platform/case-navigation'

Page({
  data: {
    id: '' as SuperCaseId,
    state: 'loading' as 'loading' | 'ready' | 'error',
    item: null as SuperCaseDetail | null,
    acting: false,
    message: '',
  },
  resumeInterest: false,

  onLoad(options: Record<string, string | undefined>) {
    this.setData({ id: String(options.id || '') as SuperCaseId })
    void this.load()
  },

  onShow() {
    const resume = mipIdentityModule.consumePendingResume('packages/member/mip-cases/detail/index')
    if (resume?.action === 'INTERACT' && this.resumeInterest) {
      this.resumeInterest = false
      void this.performToggleInterest()
    }
    else if (this.resumeInterest) {
      this.resumeInterest = false
    }
  },

  async load() {
    if (!this.data.id) {
      this.setData({ state: 'error', message: '案例信息不完整' })
      return
    }
    try {
      const item = await superCaseModule.get(this.data.id)
      this.setData({
        state: 'ready',
        item: {
          ...item,
          coverUrl: item.coverUrl || mipOperationsConfig.defaultCoverPaths.superCase,
        },
        message: '',
      })
    }
    catch (error) {
      this.setData({ state: 'error', message: error instanceof Error ? error.message : '案例加载失败' })
    }
  },

  async toggleInterest() {
    const item = this.data.item
    if (!item || item.mine || this.data.acting) {
      return
    }
    this.resumeInterest = true
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
      this.resumeInterest = false
      this.setData({ acting: false })
      await this.performToggleInterest()
    }
    catch {
      this.resumeInterest = false
      wx.showToast({ title: '身份状态暂时无法确认', icon: 'none' })
    }
    finally {
      this.setData({ acting: false })
    }
  },

  async performToggleInterest() {
    const item = this.data.item
    if (!item || item.mine || this.data.acting) {
      return
    }
    this.setData({ acting: true })
    try {
      const result = await superCaseModule.setOwnerInterest(item.id, !item.interestActive)
      this.setData({ 'item.interestActive': result.active })
      wx.showToast({ title: result.active ? '已标记感兴趣' : '已取消感兴趣', icon: 'none' })
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
      caseNavigateTo({ url: `/packages/member/mip-cases/editor/index?id=${encodeURIComponent(this.data.id)}` })
    }
  },

  async unpublish() {
    const item = this.data.item
    if (!item?.mine || item.status !== 'PUBLISHED' || this.data.acting) {
      return
    }
    const confirmation = await wx.showModal({
      title: '下架案例',
      content: '下架后，其他用户将无法查看这个案例。',
      confirmText: '确认下架',
      confirmColor: '#B30516',
    })
    if (!confirmation.confirm) {
      return
    }
    this.setData({ acting: true, message: '' })
    try {
      const result = await superCaseModule.unpublish(item.id, item.version)
      this.setData({
        'item.status': result.status,
        'item.version': result.version,
        'item.canEdit': true,
      })
      wx.showToast({ title: '案例已下架', icon: 'success' })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '案例下架失败' })
    }
    finally {
      this.setData({ acting: false })
    }
  },

  async deleteCase() {
    const item = this.data.item
    if (!item?.mine || this.data.acting) {
      return
    }
    const confirmation = await wx.showModal({
      title: '删除案例',
      content: '删除后，这个案例将不再显示，且无法恢复。',
      confirmText: '删除',
      confirmColor: '#B30516',
    })
    if (!confirmation.confirm) {
      return
    }
    this.setData({ acting: true, message: '' })
    try {
      await superCaseModule.archive(item.id, item.version)
      wx.showToast({ title: '已删除', icon: 'success' })
      leaveSecondaryPage('/pages/opportunities/index')
    }
    catch (error) {
      const message = error instanceof Error ? error.message : '案例删除失败'
      await this.load()
      wx.showToast({ title: message, icon: 'none' })
    }
    finally {
      this.setData({ acting: false })
    }
  },

  onShareAppMessage() {
    return {
      title: this.data.item?.projectName || 'MIP 超级案例',
      path: `/packages/member/mip-cases/detail/index?id=${this.data.id}`,
    }
  },
})
