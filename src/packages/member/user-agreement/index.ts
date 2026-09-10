import { mipGlobalAccessGuard } from '../../../modules/mip-identity/runtime'

Page({
  data: {
    state: 'ready' as const,
    effectiveDate: '2026年8月24日',
    // figma 1731_19189（稿内为用户使用协议文档版式）设计还原态，打分 fixture 专用；
    // 生产始终走下方正式文案布局。
    figmaLayout: false,
  },

  leavePage() {
    mipGlobalAccessGuard.leaveDocument()
  },
})
