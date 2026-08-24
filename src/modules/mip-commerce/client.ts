import type { PaymentAdapter, WechatPaymentParameters } from './types'
import { runtimeConfig } from '../../config/runtime'
import { cloudbaseMipCommerceGateway } from './cloudbase-gateway'
import { createMipCommerceModule } from './module'

export const wechatMipPaymentAdapter: PaymentAdapter = {
  async request(parameters: WechatPaymentParameters) {
    try {
      await wx.requestPayment(parameters)
      return 'ACCEPTED'
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/cancel/i.test(message)) {
        return 'CANCELLED'
      }
      throw error
    }
  },
}

export const mipCommerceModule = createMipCommerceModule(
  cloudbaseMipCommerceGateway,
  wechatMipPaymentAdapter,
  {
    paymentMode: runtimeConfig.paymentMode,
    catalogStage: runtimeConfig.catalogStage,
  },
)
