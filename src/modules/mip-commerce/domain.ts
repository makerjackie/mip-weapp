import type {
  ClientPaymentOutcome,
  CommerceOrder,
} from './types'

export function interpretClientPayment(
  requestResult: 'ACCEPTED' | 'CANCELLED',
  order: CommerceOrder,
): ClientPaymentOutcome {
  if (requestResult === 'CANCELLED') {
    return { kind: 'CANCELLED' }
  }
  return order.status === 'PAID'
    ? { kind: 'CONFIRMED', order }
    : { kind: 'PENDING', order }
}
