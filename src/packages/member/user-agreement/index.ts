import { mipGlobalAccessGuard } from '../../../modules/mip-identity/runtime'

Page({
  data: {
    state: 'ready' as const,
    effectiveDate: '2026年8月24日',
  },

  leavePage() {
    mipGlobalAccessGuard.leaveDocument()
  },
})
