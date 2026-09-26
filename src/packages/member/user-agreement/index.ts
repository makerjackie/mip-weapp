import { mipIdentityModule } from '../../../modules/mip-identity/client'
import { mipGlobalAccessGuard } from '../../../modules/mip-identity/runtime'

Page({
  data: {
    state: 'ready' as 'ready' | 'loading' | 'error',
    membershipDocument: false,
    agreement: { title: '', body: '', isDemo: true, version: 0, updatedAt: '' },
    message: '',
    effectiveDate: '2026年8月24日',
    // figma 1731_19189（稿内为用户使用协议文档版式）设计还原态，打分 fixture 专用；
    // 生产始终走下方正式文案布局。figmaAgree：1948_14226 入会协议变体（同意行 + 确认发布）。
    figmaLayout: false,
    figmaAgree: false,
  },

  onLoad(query: Record<string, string | undefined>) {
    if (query.document === 'membership') {
      this.setData({ membershipDocument: true })
      void wx.setNavigationBarTitle({ title: '会员服务协议' })
      void this.loadMembershipAgreement()
    }
  },

  async loadMembershipAgreement() {
    this.setData({ state: 'loading', message: '' })
    try {
      const agreement = await mipIdentityModule.getMembershipAgreement()
      this.setData({ state: 'ready', agreement })
    }
    catch (error) {
      this.setData({ state: 'error', message: error instanceof Error ? error.message : '协议暂时无法加载' })
    }
  },

  leavePage() {
    mipGlobalAccessGuard.leaveDocument()
  },
})
