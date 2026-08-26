import type { PaymentAdapter, WechatPaymentParameters } from './types'
import { runtimeConfig } from '../../config/runtime'
import { registerMipLocalUserCache } from '../mip-identity/local-session'
import { cloudbaseMembershipGateway } from './cloudbase-gateway'
import { createMembershipModule } from './module'

const wechatPaymentAdapter: PaymentAdapter = {
  async request(parameters: WechatPaymentParameters) {
    try {
      await wx.requestPayment(parameters)
      return 'accepted'
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('cancel')) {
        return 'cancelled'
      }
      throw error
    }
  },
}

export const membershipModule = createMembershipModule(cloudbaseMembershipGateway, wechatPaymentAdapter, {
  paymentMode: runtimeConfig.paymentMode,
})

registerMipLocalUserCache(() => membershipModule.invalidate())
