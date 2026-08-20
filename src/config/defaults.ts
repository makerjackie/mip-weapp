export const defaults = {
  appNamespace: 'membership',
  touristAppId: 'touristappid',
  membershipFunctionName: 'membership-api',
  adminFunctionName: 'membership-admin-api',
  paymentFunctionName: 'membership-cloudpay',
  paymentCallbackFunctionName: 'membership-cloudpay-callback',
  ledgerFunctionName: 'membership-payment-ledger',
  paymentMode: 'disabled',
} as const
