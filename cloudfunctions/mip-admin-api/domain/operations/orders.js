'use strict'

const { defineManifest, serviceOperation } = require('./manifest')

module.exports = defineManifest('ORDERS', [
  serviceOperation('mip.admin.orders.list', 'QUERY', 'listOrders'),
  serviceOperation('mip.admin.orders.get', 'QUERY', 'getOrder'),
  serviceOperation('mip.admin.paymentAttempts.list', 'QUERY', 'listPaymentAttempts'),
  serviceOperation('mip.admin.refunds.submit', 'MUTATION', 'submitRefund', { wakesOutbox: true }),
  serviceOperation('mip.admin.refunds.retry', 'MUTATION', 'retryRefund'),
])
