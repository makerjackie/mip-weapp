import type { SuperCaseId } from '../../../../modules/mip'
import type { SuperCaseDetail } from '../../../../modules/mip-cases'
import type { ProfileInterestMutationSnapshot } from '../../../../modules/mip-opportunities'
import { mipOperationsConfig } from '../../../../config/mip-operations'
import { superCaseModule } from '../../../../modules/mip-cases'
import { evaluateAccess, mipAccessPageUrl } from '../../../../modules/mip-identity'
import { mipIdentityModule } from '../../../../modules/mip-identity/client'
import { profileInterestMutations } from '../../../../modules/mip-opportunities'
import { caseNavigateTo, leaveSecondaryPage } from '../../../../platform/navigation/client'

interface SuperCaseDetailView extends SuperCaseDetail {
  coverUrl: string
  periodText: string
  classificationText: string
  statusText: string
}

const CASE_STATUS_LABELS = {
  DRAFT: '草稿',
  PUBLISHED: '已发布',
  UNPUBLISHED: '已下架',
  ARCHIVED: '已删除',
} as const

function formatCaseDate(value?: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.replace(/-/g, '.') : value || ''
}

function presentCase(item: SuperCaseDetail): SuperCaseDetailView {
  const startedOn = formatCaseDate(item.startedOn)
  const endedOn = formatCaseDate(item.endedOn)
  return {
    ...item,
    coverUrl: item.coverUrl || mipOperationsConfig.defaultCoverPaths.superCase,
    periodText: startedOn && endedOn
      ? `${startedOn} 至 ${endedOn}`
      : startedOn
        ? `${startedOn} 至今`
        : endedOn || '未填写',
    classificationText: [...new Set([item.industryLabel, item.caseType].filter(Boolean))].join('、') || '未填写',
    statusText: CASE_STATUS_LABELS[item.status],
  }
}

Page({
  data: {
    id: '' as SuperCaseId,
    state: 'loading' as 'loading' | 'ready' | 'error',
    item: null as SuperCaseDetailView | null,
    mediaUrls: [] as string[],
    acting: false,
    interestPending: false,
    message: '',
  },
  resumeInterest: false,
  stopInterestSubscription: null as (() => void) | null,

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

  onUnload() {
    this.stopInterestSubscription?.()
    this.stopInterestSubscription = null
  },

  async load() {
    if (!this.data.id) {
      this.setData({ state: 'error', message: '案例信息不完整' })
      return
    }
    this.setData({ state: 'loading', message: '' })
    try {
      const item = await superCaseModule.get(this.data.id)
      const presented = presentCase(item)
      const interest = profileInterestMutations.mergeServer(item.author.profileRef, item.interestActive)
      this.observeInterest(item.author.profileRef)
      this.setData({
        state: 'ready',
        item: { ...presented, interestActive: interest.active },
        interestPending: interest.pending,
        mediaUrls: presented.media.map(media => media.url).filter(Boolean),
        message: '',
      })
    }
    catch (error) {
      this.setData({ state: 'error', message: error instanceof Error ? error.message : '案例加载失败' })
    }
  },

  async toggleInterest() {
    const item = this.data.item
    if (!item || item.mine || this.data.acting || this.data.interestPending) {
      return
    }
    if (this.hasCachedInterestAccess()) {
      this.performToggleInterest()
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
      this.performToggleInterest()
    }
    catch {
      this.resumeInterest = false
      wx.showToast({ title: '身份状态暂时无法确认', icon: 'none' })
    }
    finally {
      this.setData({ acting: false })
    }
  },

  observeInterest(profileRef: string) {
    this.stopInterestSubscription?.()
    this.stopInterestSubscription = profileInterestMutations.subscribe(profileRef, (interest) => {
      if (this.data.item?.author.profileRef !== profileRef) {
        return
      }
      this.applyInterest(interest)
      if (interest.error) {
        wx.showToast({ title: interest.error.message, icon: 'none' })
      }
    })
  },

  applyInterest(interest: ProfileInterestMutationSnapshot) {
    this.setData({
      'item.interestActive': interest.active,
      'interestPending': interest.pending,
    })
  },

  hasCachedInterestAccess() {
    const snapshot = mipIdentityModule.peekSnapshot()
    return Boolean(snapshot && evaluateAccess(snapshot, {
      action: 'INTERACT',
      source: { navigation: 'navigateBack' },
    }).ready)
  },

  performToggleInterest() {
    const item = this.data.item
    if (!item || item.mine || this.data.interestPending) {
      return
    }
    const interest = profileInterestMutations.mutate({
      targetProfileRef: item.author.profileRef,
      active: !item.interestActive,
      currentActive: item.interestActive,
      source: { sourceType: 'SUPER_CASE', sourceId: item.id },
    })
    this.applyInterest(interest)
  },

  openAuthor() {
    const profileRef = this.data.item?.author.profileRef
    if (profileRef) {
      caseNavigateTo({ url: `/packages/member/mip-public-profile/index?profileRef=${encodeURIComponent(profileRef)}` })
    }
  },

  previewImage(event: WechatMiniprogram.TouchEvent) {
    const current = String(event.currentTarget.dataset.url || '')
    const urls = this.data.mediaUrls
    if (current && urls.includes(current)) {
      wx.previewImage({ current, urls })
    }
  },

  edit() {
    if (this.data.item?.canEdit && !this.data.acting) {
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
        'item.statusText': CASE_STATUS_LABELS[result.status],
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
