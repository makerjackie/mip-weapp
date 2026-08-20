import type { MemberDetail, MemberReportCategory } from '../../../modules/membership/types'
import { membershipModule } from '../../../modules/membership/client'
import { caseNavigateTo } from '../../../modules/platform/case-navigation'

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    member: null as MemberDetail | null,
    memberId: '',
    initial: '友',
    followBusy: false,
    safetyBusy: false,
    message: '',
  },
  requestSeq: 0,

  onLoad(query: Record<string, string>) {
    const memberId = query.memberId || ''
    const cached = membershipModule.peekMember(memberId)
    this.setData({ memberId })
    if (cached) {
      this.setData({ state: 'ready', member: cached, initial: cached.nickname.slice(0, 1) || '友' })
    }
    void this.loadMember()
  },

  async loadMember() {
    if (this.data.state !== 'ready') {
      this.setData({ state: 'loading', message: '' })
    }
    const seq = this.requestSeq + 1
    this.requestSeq = seq
    try {
      const member = await membershipModule.getMember(this.data.memberId)
      if (seq !== this.requestSeq) {
        return
      }
      this.setData({ state: 'ready', member, initial: member.nickname.slice(0, 1) || '友', message: '' })
    }
    catch (error) {
      if (seq !== this.requestSeq) {
        return
      }
      this.setData(this.data.state === 'ready'
        ? { message: '资料更新失败，已保留上次结果。' }
        : { state: 'error', message: error instanceof Error ? error.message : '成员资料加载失败' })
    }
  },

  openMembership() {
    caseNavigateTo({ url: '/pages/membership/index' })
  },

  async toggleFollow() {
    if (!this.data.member || this.data.member.isSelf || this.data.followBusy) {
      return
    }
    const next = !this.data.member.isFollowing
    this.setData({ followBusy: true, message: '' })
    try {
      await membershipModule.setFollow(this.data.memberId, next)
      await this.loadMember()
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '操作失败，请重试' })
    }
    finally {
      this.setData({ followBusy: false })
    }
  },

  async openSafetyActions() {
    if (!this.data.member || this.data.member.isSelf || this.data.safetyBusy) {
      return
    }
    const selected = await wx.showActionSheet({ itemList: ['举报该成员', '不再看到该成员'] })
      .catch(() => null)
    if (!selected) {
      return
    }
    if (selected.tapIndex === 0) {
      await this.reportMember()
    }
    else if (selected.tapIndex === 1) {
      await this.blockMember()
    }
  },

  async reportMember() {
    const choices: Array<{ label: string, category: MemberReportCategory }> = [
      { label: '骚扰或攻击', category: 'HARASSMENT' },
      { label: '广告刷屏', category: 'SPAM' },
      { label: '诈骗风险', category: 'FRAUD' },
      { label: '不适宜内容', category: 'INAPPROPRIATE' },
      { label: '泄露隐私', category: 'PRIVACY' },
      { label: '其他', category: 'OTHER' },
    ]
    const selected = await wx.showActionSheet({ itemList: choices.map(item => item.label) })
      .catch(() => null)
    if (!selected) {
      return
    }
    const category = choices[selected.tapIndex]?.category
    if (!category) {
      return
    }
    const detail = await wx.showModal({
      title: '提交举报',
      content: '请补充必要说明（可留空）。举报会进入运营审核，不会自动处罚。',
      editable: true,
      placeholderText: '最多 200 字',
      confirmText: '提交',
    }).catch(() => null)
    if (!detail?.confirm) {
      return
    }
    this.setData({ safetyBusy: true, message: '' })
    try {
      await membershipModule.reportMember(this.data.memberId, category, detail.content || '')
      wx.showToast({ title: '已提交审核', icon: 'success' })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '举报提交失败' })
    }
    finally {
      this.setData({ safetyBusy: false })
    }
  },

  async blockMember() {
    const confirmed = await wx.showModal({
      title: '不再看到该成员',
      content: '双方会从成员推荐、关注关系和公开活动参与者中互相隐藏。你可以在隐私设置中恢复。',
      confirmText: '确认屏蔽',
      confirmColor: '#B8453E',
    }).catch(() => null)
    if (!confirmed?.confirm) {
      return
    }
    this.setData({ safetyBusy: true, message: '' })
    try {
      await membershipModule.setMemberBlock(this.data.memberId, true)
      wx.showToast({ title: '已屏蔽', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 500)
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '屏蔽失败' })
    }
    finally {
      this.setData({ safetyBusy: false })
    }
  },
})
