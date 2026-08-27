import type { MipIdentityAction } from './contracts'

const retryableIdentityActions = new Set<MipIdentityAction>([
  'getAccessSnapshot',
  'getMyProfileCardCode',
  'getProfile',
  'getPublicProfile',
  'listBranches',
  'listProfileTags',
  'resolveProfileCardScene',
])

export function isRetryableIdentityAction(action: MipIdentityAction) {
  return retryableIdentityActions.has(action)
}
