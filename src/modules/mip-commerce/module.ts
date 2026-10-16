import type { OrderId } from '../mip'
import type { MembershipPlanCache } from './plan-cache'
import type {
  CheckoutIntent,
  CommerceGateway,
  CommerceOrderFilter,
  MembershipBenefitsSnapshot,
  PaymentAdapter,
  PaymentCapabilities,
  RefundId,
  RefundIntent,
} from './types'
import { interpretClientPayment } from './domain'
import { createMembershipPlanCache } from './plan-cache'

interface CommerceReadOptions {
  force?: boolean
}

// MIW-119：模块不再持有构建期烘焙的 paymentMode/catalogStage。
// 支付可用性与目录 stage 一律由服务端裁决（describePaymentCapabilities /
// listPlans / 支付动作本身），客户端只做提前预取与展示。
interface MipCommerceModuleOptions {
  planCache?: MembershipPlanCache
}

export function createMipCommerceModule(
  gateway: CommerceGateway,
  payment: PaymentAdapter,
  options: MipCommerceModuleOptions = {},
) {
  const planCache = options.planCache || createMembershipPlanCache()
  let planRequest: Promise<Awaited<ReturnType<CommerceGateway['listPlans']>>> | null = null
  let membershipBenefits: MembershipBenefitsSnapshot | undefined
  let membershipBenefitsRequest: Promise<MembershipBenefitsSnapshot> | null = null
  let membershipBenefitsGeneration = 0
  let paymentCapability: PaymentCapabilities | undefined
  let paymentCapabilityRequest: Promise<PaymentCapabilities> | null = null

  function clearUserCache() {
    membershipBenefitsGeneration += 1
    membershipBenefits = undefined
    membershipBenefitsRequest = null
  }

  async function requestPayment(order: Awaited<ReturnType<CommerceGateway['createCheckout']>>) {
    const parameters = await gateway.createPayment(order.id)
    const requestResult = await payment.request(parameters)
    if (requestResult === 'CANCELLED') {
      return interpretClientPayment(requestResult, order)
    }
    try {
      const reconciled = await gateway.reconcileOrder(order.id)
      return interpretClientPayment(requestResult, reconciled)
    }
    catch {
      return interpretClientPayment(requestResult, order)
    }
  }

  return {
    peekPlans() {
      return planCache.peek()
    },

    async ensurePaymentCapability(readOptions: CommerceReadOptions = {}): Promise<PaymentCapabilities> {
      const force = readOptions.force ?? false
      if (!force && paymentCapability !== undefined) {
        return paymentCapability
      }
      if (paymentCapabilityRequest) {
        return paymentCapabilityRequest
      }
      const request = gateway.describePaymentCapabilities().then((capabilities) => {
        paymentCapability = capabilities
        // 能力快照常先于套餐列表返回：stage 已切换时先丢弃旧 stage 残留缓存，
        // 避免列表页闪现切换前的套餐。
        const cachedStage = planCache.stage()
        if (cachedStage && cachedStage !== capabilities.catalogStage) {
          planCache.clear()
        }
        return capabilities
      })
      paymentCapabilityRequest = request
      try {
        return await request
      }
      finally {
        if (paymentCapabilityRequest === request) {
          paymentCapabilityRequest = null
        }
      }
    },

    peekPaymentCapability() {
      return paymentCapability
    },

    async listPlans(readOptions: CommerceReadOptions = {}) {
      const cached = planCache.peek()
      if (!readOptions.force && cached !== undefined) {
        return cached
      }
      if (planRequest) {
        return planRequest
      }
      const request = gateway.listPlans().then(plans => planCache.prime(plans))
      planRequest = request
      try {
        return await request
      }
      finally {
        if (planRequest === request) {
          planRequest = null
        }
      }
    },

    peekMembershipBenefits() {
      return membershipBenefits
    },

    async getMembershipBenefits(readOptions: CommerceReadOptions = {}) {
      const force = readOptions.force ?? true
      if (!force && membershipBenefits !== undefined) {
        return membershipBenefits
      }
      if (membershipBenefitsRequest) {
        return membershipBenefitsRequest
      }
      const generation = membershipBenefitsGeneration
      const request = gateway.getMembershipBenefits().then((snapshot) => {
        if (generation === membershipBenefitsGeneration) {
          membershipBenefits = snapshot
        }
        return snapshot
      })
      membershipBenefitsRequest = request
      try {
        return await request
      }
      finally {
        if (membershipBenefitsRequest === request) {
          membershipBenefitsRequest = null
        }
      }
    },

    clearUserCache,

    clearPlanCache() {
      planCache.clear()
    },

    getOrder(orderId: OrderId) {
      return gateway.getOrder(orderId)
    },

    listOrders() {
      return gateway.listOrders()
    },

    listOrderPage(filter: CommerceOrderFilter = {}) {
      return gateway.listOrderPage(filter)
    },

    async purchase(intent: CheckoutIntent) {
      const order = await gateway.createCheckout(intent)
      const result = await requestPayment(order)
      clearUserCache()
      return result
    },

    async payOrder(orderId: OrderId) {
      const order = await gateway.getOrder(orderId)
      const result = await requestPayment(order)
      clearUserCache()
      return result
    },

    async reconcile(orderId: OrderId) {
      const order = await gateway.reconcileOrder(orderId)
      clearUserCache()
      return order
    },

    requestRefund(intent: RefundIntent) {
      return gateway.requestRefund(intent).then((result) => {
        clearUserCache()
        return result
      })
    },

    submitRefund(refundId: RefundId) {
      return gateway.submitRefund(refundId).then((result) => {
        clearUserCache()
        return result
      })
    },
  }
}
