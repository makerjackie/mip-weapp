import type { BlockedMember } from '../../../modules/membership/types'
import { membershipModule } from '../../../modules/membership/client'

interface BlockedMemberView extends BlockedMember {
  initial: string
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    items: [] as BlockedMemberView[],
    processingId: '',
    message: '',
  },

  onLoad() {
    void this.loadItems()
  },

  async loadItems(force = false) {
    const cached = membershipModule.peekBlockedMembers()
    if (cached) {
      this.applyItems(cached)
    }
    else if (this.data.state !== 'ready') {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      this.applyItems(await membershipModule.listBlockedMembers({ force }))
    }
    catch (error) {
      this.setData(this.data.items.length
        ? { message: '列表更新失败，已保留上次结果。' }
        : { state: 'error', message: error instanceof Error ? error.message : '列表加载失败' })
    }
  },

  applyItems(items: BlockedMember[]) {
    this.setData({
      state: 'ready',
      items: items.map(item => ({ ...item, initial: item.nickname.slice(0, 1) || '友' })),
      message: '',
    })
  },

  async unblock(event: WechatMiniprogram.TouchEvent) {
    const memberId = String(event.currentTarget.dataset.id || '')
    if (!memberId || this.data.processingId) {
      return
    }
    const confirmed = await wx.showModal({
      title: '恢复显示',
      content: '恢复后，你们可能重新出现在成员推荐和公开活动参与者中。',
      confirmText: '恢复',
    }).catch(() => null)
    if (!confirmed?.confirm) {
      return
    }
    this.setData({ processingId: memberId, message: '' })
    try {
      await membershipModule.setMemberBlock(memberId, false)
      await this.loadItems(true)
      wx.showToast({ title: '已恢复', icon: 'success' })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '恢复失败' })
    }
    finally {
      this.setData({ processingId: '' })
    }
  },

  async onPullDownRefresh() {
    try {
      await this.loadItems(true)
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },
})
