import { MIP_FUNCTION_SOURCES } from './mip-function-names.mjs'

export const MIP_CORE_FUNCTION_ROLES = Object.freeze([
  'identity',
  'media',
  'events',
  'opportunities',
  'community',
  'commerce',
  'admin',
  'growth',
  'game',
  'tasks',
  'banners',
  'ai',
  'notifications',
  'ledger',
  'notification',
  'outbox',
])

const TIMEOUTS = Object.freeze({
  identity: 20,
  media: 30,
  events: 30,
  opportunities: 30,
  community: 20,
  commerce: 20,
  admin: 60,
  growth: 20,
  game: 30,
  tasks: 30,
  banners: 30,
  ai: 60,
  notifications: 20,
  ledger: 20,
  notification: 60,
  outbox: 60,
})

export function createMipCoreFunctionManifest(functionNames) {
  return MIP_CORE_FUNCTION_ROLES.map(role => Object.freeze({
    role,
    name: functionNames[role],
    source: MIP_FUNCTION_SOURCES[role],
    timeout: TIMEOUTS[role],
    clientInvokable: !['ledger', 'notification', 'outbox'].includes(role),
  }))
}
