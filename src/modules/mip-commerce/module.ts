import type { OrderId } from '../mip'
import type { MembershipPlanCache } from './plan-cache'
import type {
  CatalogStage,
  CheckoutIntent,
  CommerceGateway,
  MembershipBenefitsSnapshot,
  PaymentAdapter,
  RefundId,
  RefundIntent,
} from './types'
import { interpretClientPayment } from './domain'
import { createMembershipPlanCache } from './plan-cache'

interface CommerceReadOptions {
  force?: boolean
}

interface MipCommerceModuleOptions {
  paymentMode: 'disabled' | 'test' | 'live'
  catalogStage: CatalogStage
  planCache?: MembershipPlanCache
}

export function createMipCommerceModule(
  gateway: CommerceGateway,
  payment: PaymentAdapter,
  options: MipCommerceModuleOptions,
) {
  const planCache = options.planCache || createMembershipPlanCache({ catalogStage: options.catalogStage })
  let planRequest: Promise<Awaited<ReturnType<CommerceGateway['listPlans']>>> | null = null
  let membershipBenefits: MembershipBenefitsSnapshot | undefined
  let membershipBenefitsRequest: Promise<MembershipBenefitsSnapshot> | null = null
  let membershipBenefitsGeneration = 0

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

    async listPlans(readOptions: CommerceReadOptions = {}) {
      const cached = planCache.peek()
      if (!readOptions.force && cached !== undefined) {
        return cached
      }
      if (planRequest) {
        return planRequest
      }
      const request = gateway.listPlans().then((plans) => {
        const activePlans = plans.filter(
          plan => plan.catalogStage === options.catalogStage && plan.status === 'ACTIVE',
        )
        return planCache.prime(activePlans)
      })
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

    listOrders() {
      return gateway.listOrders()
    },

    createMembershipInvitation() {
      return gateway.createMembershipInvitation()
    },

    createMembershipInvitationCode() {
      return gateway.createMembershipInvitationCode()
    },

    resolveMembershipInvitationScene(scene: string) {
      return gateway.resolveMembershipInvitationScene(scene)
    },

    async purchase(intent: CheckoutIntent) {
      if (options.paymentMode === 'disabled') {
        throw new Error('PAYMENT_UNAVAILABLE')
      }
      const order = await gateway.createCheckout(intent)
      const result = await requestPayment(order)
      clearUserCache()
      return result
    },

    async payOrder(orderId: OrderId) {
      if (options.paymentMode === 'disabled') {
        throw new Error('PAYMENT_UNAVAILABLE')
      }
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
      if (options.paymentMode === 'disabled') {
        throw new Error('PAYMENT_UNAVAILABLE')
      }
      return gateway.requestRefund(intent).then((result) => {
        clearUserCache()
        return result
      })
    },

    submitRefund(refundId: RefundId) {
      if (options.paymentMode === 'disabled') {
        throw new Error('PAYMENT_UNAVAILABLE')
      }
      return gateway.submitRefund(refundId).then((result) => {
        clearUserCache()
        return result
      })
    },
  }
}
