import type { MipIdentityAction } from './contracts'

const retryableIdentityActions = new Set<MipIdentityAction>([
  'getAccessSnapshot',
  'getProfile',
  'getPublicProfile',
  'listBranches',
  'listProfileTags',
])

export function isRetryableIdentityAction(action: MipIdentityAction) {
  return retryableIdentityActions.has(action)
}
