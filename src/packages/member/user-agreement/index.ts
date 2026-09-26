import { mipIdentityModule } from '../../../modules/mip-identity/client'
import { mipGlobalAccessGuard } from '../../../modules/mip-identity/runtime'

Page({
  data: {
    state: 'loading' as 'ready' | 'loading' | 'error',
    document: 'user' as 'user' | 'membership',
    agreement: { title: '', body: '', isDemo: true, version: 0, updatedAt: '' },
    message: '',
  },

  onLoad(query: Record<string, string | undefined>) {
    const document = query.document === 'membership' ? 'membership' : 'user'
    this.setData({ document })
    void wx.setNavigationBarTitle({ title: document === 'membership' ? '会员服务协议' : '用户使用协议' })
    void this.loadAgreement()
  },

  async loadAgreement() {
    this.setData({ state: 'loading', message: '' })
    try {
      const agreement = await mipIdentityModule.getMembershipAgreement(this.data.document)
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
