import { membershipModule } from '../../../modules/membership/client'
import { caseNavigateTo, caseRelaunch } from '../../../modules/platform/case-navigation'

function returnToCaseHome() {
  caseRelaunch({ url: '/pages/index/index' })
}

Page({
  data: {
    state: 'ready' as const,
    deleting: false,
    message: '',
  },

  openBlockedMembers() {
    caseNavigateTo({ url: '/packages/member/blocked-members/index' })
  },

  async deleteAccount() {
    if (this.data.deleting) {
      return
    }
    // Latch before showModal so stacked taps cannot open parallel dialogs.
    this.setData({ deleting: true, message: '' })
    try {
      const first = await wx.showModal({
        title: '注销账号',
        content: '公开资料将匿名化，会员权益和未开始的报名会失效；依法需保留的支付订单不会删除。',
        confirmText: '继续',
        confirmColor: '#B8453E',
      })
      if (!first.confirm) {
        return
      }
      const second = await wx.showModal({
        title: '再次确认',
        content: '原公开资料和权益不可恢复；以后仍可重新填写资料注册。确认注销吗？',
        confirmText: '确认注销',
        confirmColor: '#B8453E',
      })
      if (!second.confirm) {
        return
      }
      await membershipModule.requestAccountDeletion('DELETE')
      wx.showToast({ title: '账号已注销', icon: 'success' })
      setTimeout(returnToCaseHome, 800)
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '账号注销失败' })
    }
    finally {
      this.setData({ deleting: false })
    }
  },
})
