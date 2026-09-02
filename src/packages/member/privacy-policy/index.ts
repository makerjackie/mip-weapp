import { mipGlobalAccessGuard } from '../../../modules/mip-identity/runtime'
import { mipMessagingModule } from '../../../modules/mip-messaging/client'

Page({
  data: {
    state: 'ready' as const,
    effectiveDate: '2026年8月31日',
  },

  leavePage() {
    mipGlobalAccessGuard.leaveDocument()
  },

  recordCustomerServiceInteraction() {
    void mipMessagingModule.recordCustomerServiceInteraction().catch(() => undefined)
  },
})
