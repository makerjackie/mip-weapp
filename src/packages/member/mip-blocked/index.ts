import type { BlockedProfile } from '../../../modules/mip-community'
import { mipCommunityModule } from '../../../modules/mip-community'
import { mipAccessPageUrl } from '../../../modules/mip-identity'
import { mipIdentityModule } from '../../../modules/mip-identity/client'
import { caseNavigateTo } from '../../../platform/navigation/client'

type PageState = 'loading' | 'ready' | 'empty' | 'error' | 'access'

interface BlockedProfileView extends BlockedProfile {
  initial: string
  blockedText: string
}

function present(item: BlockedProfile): BlockedProfileView {
  const date = new Date(item.blockedAt)
  return {
    ...item,
    initial: item.nickname.slice(0, 1) || '用',
    blockedText: Number.isFinite(date.getTime())
      ? `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日屏蔽`
      : '',
  }
}

Page({
  data: {
    state: 'loading' as PageState,
    items: [] as BlockedProfileView[],
    nextCursor: '',
    accessToken: '',
    processingRef: '',
    loadingMore: false,
    message: '',
  },
  accessReady: false,
  checkingAccess: false,

  onShow() {
    const resumed = mipIdentityModule.consumePendingResume()
    if (!this.accessReady || resumed) {
      void this.checkAccess()
      return
    }
    void this.loadItems(true)
  },

  async checkAccess() {
    if (this.checkingAccess) {
      return
    }
    this.checkingAccess = true
    if (!this.accessReady) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const session = await mipIdentityModule.beginProtectedAction({
        action: 'INTERACT',
        source: { navigation: 'navigateBack' },
      })
      if (!session.decision.ready) {
        this.accessReady = false
        this.setData({ state: 'access', accessToken: session.token, message: '' })
        return
      }
      this.accessReady = true
      this.setData({ accessToken: '' })
      await this.loadItems(true)
    }
    catch {
      this.setData({ state: 'error', message: '身份状态暂时无法确认。' })
    }
    finally {
      this.checkingAccess = false
    }
  },

  openAccess() {
    if (this.data.accessToken) {
      caseNavigateTo({ url: mipAccessPageUrl(this.data.accessToken) })
    }
  },

  async loadItems(reset = false) {
    if (!this.accessReady || (!reset && (!this.data.nextCursor || this.data.loadingMore))) {
      return
    }
    if (reset && !this.data.items.length) {
      this.setData({ state: 'loading', message: '' })
    }
    if (!reset) {
      this.setData({ loadingMore: true, message: '' })
    }
    try {
      const page = await mipCommunityModule.listBlocked(reset ? undefined : this.data.nextCursor)
      const items = reset
        ? page.items.map(present)
        : [...this.data.items, ...page.items.map(present)]
      this.setData({
        state: items.length ? 'ready' : 'empty',
        items,
        nextCursor: page.nextCursor || '',
        message: '',
      })
    }
    catch (error) {
      this.setData(this.data.items.length
        ? { state: 'ready', message: '列表更新失败，已保留当前结果。' }
        : {
            state: 'error',
            message: error instanceof Error ? error.message : '屏蔽列表加载失败。',
          })
    }
    finally {
      this.setData({ loadingMore: false })
    }
  },

  loadMore() {
    void this.loadItems(false)
  },

  async unblock(event: WechatMiniprogram.TouchEvent) {
    const profileRef = String(event.currentTarget.dataset.profileRef || '')
    if (!profileRef.startsWith('p1.') || this.data.processingRef) {
      return
    }
    const confirmed = await wx.showModal({
      title: '解除屏蔽',
      content: '解除后，你们可能重新出现在公开档案和相关列表中。',
      confirmText: '解除',
    }).catch(() => null)
    if (!confirmed?.confirm) {
      return
    }
    this.setData({ processingRef: profileRef, message: '' })
    try {
      await mipCommunityModule.unblock(profileRef)
      const items = this.data.items.filter(item => item.profileRef !== profileRef)
      this.setData({ state: items.length ? 'ready' : 'empty', items })
      wx.showToast({ title: '已解除', icon: 'success' })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '解除屏蔽失败。' })
    }
    finally {
      this.setData({ processingRef: '' })
    }
  },

  retry() {
    if (this.data.state === 'error') {
      void this.loadItems(true)
    }
  },

  async onPullDownRefresh() {
    try {
      if (this.accessReady) {
        await this.loadItems(true)
      }
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },
})
