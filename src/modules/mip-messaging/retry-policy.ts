import type { MipMessagingAction } from './types'

export function isRetryableMessagingAction(action: MipMessagingAction) {
  return action === 'listInbox'
}
