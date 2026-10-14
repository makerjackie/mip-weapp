// Direction B (2026-10-15, MIW-111): the existing mip-* function suite IS
// production and is baked into the released mini-program. These client-side
// fallbacks intentionally point at the NOT-YET-DEPLOYED test suite (mip-t-*),
// so an unconfigured build fails loudly against missing test functions instead
// of silently calling production. Every tracked target (envs/prod, envs/test)
// sets all names explicitly and never relies on these fallbacks.
export const defaults = {
  appNamespace: 'mip',
  touristAppId: 'touristappid',
  identityFunctionName: 'mip-t-identity-api',
  mediaFunctionName: 'mip-t-media-api',
  eventsFunctionName: 'mip-t-events-api',
  opportunitiesFunctionName: 'mip-t-opportunities-api',
  communityFunctionName: 'mip-t-community-api',
  commerceFunctionName: 'mip-t-commerce-api',
  adminFunctionName: 'mip-t-admin-api',
  growthFunctionName: 'mip-t-growth-api',
  gameFunctionName: 'mip-t-game-api',
  tasksFunctionName: 'mip-t-tasks-api',
  bannersFunctionName: 'mip-t-banners-api',
  aiFunctionName: 'mip-t-ai-api',
  notificationsFunctionName: 'mip-t-notifications-api',
  paymentFunctionName: 'mip-t-cloudpay',
  paymentCallbackFunctionName: 'mip-t-cloudpay-callback',
  ledgerFunctionName: 'mip-t-payment-ledger',
  paymentMode: 'disabled',
  catalogStage: 'TEST',
} as const
