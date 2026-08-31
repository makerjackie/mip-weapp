import type { PaymentAdapter, WechatPaymentParameters } from './types'
import { runtimeConfig } from '../../config/runtime'
import { registerMipLocalUserCache } from '../mip-identity/local-session'
import { cloudbaseMipCommerceGateway } from './cloudbase-gateway'
import { createMipCommerceModule } from './module'
import { createMembershipPlanCache } from './plan-cache'

const membershipPlanCacheKey = [
  'mip:commerce-plans:v1',
  runtimeConfig.appNamespace,
  runtimeConfig.cloudbase.envId || 'disabled',
  runtimeConfig.catalogStage,
].join(':')

const membershipPlanCache = createMembershipPlanCache({
  catalogStage: runtimeConfig.catalogStage,
  storage: {
    read: () => typeof wx === 'undefined' ? undefined : wx.getStorageSync(membershipPlanCacheKey) as unknown,
    write: value => typeof wx === 'undefined' ? undefined : wx.setStorageSync(membershipPlanCacheKey, value),
    clear: () => typeof wx === 'undefined' ? undefined : wx.removeStorageSync(membershipPlanCacheKey),
  },
})

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
    planCache: membershipPlanCache,
  },
)

registerMipLocalUserCache(() => mipCommerceModule.clearUserCache())
