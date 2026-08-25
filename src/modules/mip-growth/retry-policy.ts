import type { RetryOptions } from '@weapp/shared/retry'
import { COLD_START_READ_RETRY } from '@weapp/shared/retry'

const singleAttempt: RetryOptions = { attempts: 1 }

const retryableReadActions = new Set([
  'getSnapshot',
  'listEntries',
  'listBadgeCollection',
])

export function resolveMipGrowthRetryOptions(action: string): RetryOptions {
  return retryableReadActions.has(action) ? COLD_START_READ_RETRY : singleAttempt
}
