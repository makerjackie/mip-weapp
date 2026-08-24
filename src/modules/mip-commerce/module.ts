import type { OrderId } from '../mip'
import type {
  CatalogStage,
  CheckoutIntent,
  CommerceGateway,
  PaymentAdapter,
  RefundId,
  RefundIntent,
} from './types'
import { interpretClientPayment } from './domain'

export function createMipCommerceModule(
  gateway: CommerceGateway,
  payment: PaymentAdapter,
  options: { paymentMode: 'disabled' | 'test' | 'live', catalogStage: CatalogStage },
) {
  return {
    async listPlans() {
      const plans = await gateway.listPlans()
      return plans.filter(plan => plan.catalogStage === options.catalogStage && plan.status === 'ACTIVE')
    },

    getMembershipBenefits() {
      return gateway.getMembershipBenefits()
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
    },

    async payOrder(orderId: OrderId) {
      if (options.paymentMode === 'disabled') {
        throw new Error('PAYMENT_UNAVAILABLE')
      }
      const order = await gateway.getOrder(orderId)
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
    },

    async reconcile(orderId: OrderId) {
      return gateway.reconcileOrder(orderId)
    },

    requestRefund(intent: RefundIntent) {
      if (options.paymentMode === 'disabled') {
        throw new Error('PAYMENT_UNAVAILABLE')
      }
      return gateway.requestRefund(intent)
    },

    submitRefund(refundId: RefundId) {
      if (options.paymentMode === 'disabled') {
        throw new Error('PAYMENT_UNAVAILABLE')
      }
      return gateway.submitRefund(refundId)
    },
  }
}
