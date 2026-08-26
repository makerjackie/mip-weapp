export const MIP_FUNCTION_DEFAULTS = Object.freeze({
  identity: 'mip-identity-api',
  media: 'mip-media-api',
  events: 'mip-events-api',
  opportunities: 'mip-opportunities-api',
  community: 'mip-community-api',
  commerce: 'mip-commerce-api',
  admin: 'mip-admin-api',
  growth: 'mip-growth-api',
  game: 'mip-game-api',
  tasks: 'mip-tasks-api',
  banners: 'mip-banners-api',
  ai: 'mip-ai-api',
  notifications: 'mip-notifications-api',
  ledger: 'mip-payment-ledger',
  notification: 'mip-notification-worker',
  outbox: 'mip-outbox-worker',
  scheduler: 'mip-message-scheduler',
  knowledgeScheduler: 'mip-knowledge-scheduler',
  pay: 'mip-cloudpay',
  callback: 'mip-cloudpay-callback',
  refund: 'mip-refund-worker',
})

export const MIP_FUNCTION_SOURCES = Object.freeze({
  identity: 'mip-identity-api',
  media: 'mip-media-api',
  events: 'mip-events-api',
  opportunities: 'mip-opportunities-api',
  community: 'mip-community-api',
  commerce: 'mip-commerce-api',
  admin: 'mip-admin-api',
  growth: 'mip-growth-api',
  game: 'mip-game-api',
  tasks: 'mip-tasks-api',
  banners: 'mip-banners-api',
  ai: 'mip-ai-api',
  notifications: 'mip-notifications-api',
  ledger: 'mip-payment-ledger',
  notification: 'mip-notification-worker',
  outbox: 'mip-outbox-worker',
  scheduler: 'mip-message-scheduler',
  knowledgeScheduler: 'mip-knowledge-scheduler',
  pay: 'mip-cloudpay',
  callback: 'mip-cloudpay-callback',
  refund: 'mip-refund-worker',
})

const ENV_KEYS = Object.freeze({
  identity: 'MIP_IDENTITY_FUNCTION_NAME',
  media: 'MIP_MEDIA_FUNCTION_NAME',
  events: 'MIP_EVENTS_FUNCTION_NAME',
  opportunities: 'MIP_OPPORTUNITIES_FUNCTION_NAME',
  community: 'MIP_COMMUNITY_FUNCTION_NAME',
  commerce: 'MIP_COMMERCE_FUNCTION_NAME',
  admin: 'MIP_ADMIN_FUNCTION_NAME',
  growth: 'MIP_GROWTH_FUNCTION_NAME',
  game: 'MIP_GAME_FUNCTION_NAME',
  tasks: 'MIP_TASKS_FUNCTION_NAME',
  banners: 'MIP_BANNERS_FUNCTION_NAME',
  ai: 'MIP_AI_FUNCTION_NAME',
  notifications: 'MIP_NOTIFICATIONS_FUNCTION_NAME',
  ledger: 'MIP_LEDGER_FUNCTION_NAME',
  notification: 'MIP_NOTIFICATION_FUNCTION_NAME',
  outbox: 'MIP_OUTBOX_FUNCTION_NAME',
  scheduler: 'MIP_MESSAGE_SCHEDULER_FUNCTION_NAME',
  knowledgeScheduler: 'MIP_KNOWLEDGE_SCHEDULER_FUNCTION_NAME',
  pay: 'MIP_PAY_FUNCTION_NAME',
  callback: 'MIP_PAY_CALLBACK_FUNCTION',
  refund: 'MIP_REFUND_FUNCTION_NAME',
})

export function resolveMipFunctionNames(env = {}) {
  const names = Object.fromEntries(Object.entries(ENV_KEYS).map(([role, envKey]) => [
    role,
    String(env[envKey] || MIP_FUNCTION_DEFAULTS[role]).trim(),
  ]))
  for (const [role, name] of Object.entries(names)) {
    if (!/^mip-[a-z0-9][a-z0-9-]{0,55}$/.test(name)) {
      throw new Error(`${ENV_KEYS[role]} must be a lowercase mip-* Cloud Function name`)
    }
  }
  if (new Set(Object.values(names)).size !== Object.keys(names).length) {
    throw new Error('MIP Cloud Function names must be unique')
  }
  return Object.freeze(names)
}
