import { mipIdentityModule } from '../../../modules/mip-identity/client'
import { mipGlobalAccessGuard } from '../../../modules/mip-identity/runtime'
import { mipMessagingModule } from '../../../modules/mip-messaging/client'

Page({
  data: {
    state: 'ready' as const,
    effectiveDate: '2026年8月31日',
    /**
     * MIW-121：static = 内置静态政策（未配置/演示内容/加载失败兜底，视觉与历史版本逐字一致）；
     * document = 后台保存的正式内容（isDemo=false 且有正文），渲染与 user-agreement 同款文档视图。
     */
    mode: 'static' as 'static' | 'document',
    agreement: { title: '', body: '', isDemo: true, version: 0, updatedAt: '' },
  },

  onLoad() {
    void this.loadPrivacyPolicy()
  },

  /** 读取失败静默保留静态兜底页，不打断浏览。 */
  async loadPrivacyPolicy() {
    try {
      const agreement = await mipIdentityModule.getMembershipAgreement('privacy')
      if (!agreement.isDemo && agreement.body) {
        this.setData({ mode: 'document', agreement })
      }
    }
    catch {
      // 保持静态兜底。
    }
  },

  leavePage() {
    mipGlobalAccessGuard.leaveDocument()
  },

  recordCustomerServiceInteraction() {
    void mipMessagingModule.recordCustomerServiceInteraction().catch(() => undefined)
  },
})
