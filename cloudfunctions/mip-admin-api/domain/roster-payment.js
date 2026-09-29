'use strict'

function rosterPaymentFields(row) {
  return {
    orderId: row.order_id || null,
    paymentStatus: row.order_id ? row.payment_status : row.access_type === 'PAID' ? 'UNPAID' : 'NOT_REQUIRED',
    paidAmountCents: row.paid_at ? Number(row.order_amount_cents || 0) : 0,
    refundedAmountCents: Number(row.refunded_amount_cents || 0),
    currency: row.currency || 'CNY',
    paidAt: row.paid_at ? new Date(row.paid_at).toISOString() : null,
  }
}
module.exports = { rosterPaymentFields }
