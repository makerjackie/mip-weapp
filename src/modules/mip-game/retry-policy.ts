import type { MipGameAction } from './types'

const retryableGameActions = new Set<MipGameAction>([
  'listBlindBoxes',
  'getBlindBox',
  'getBlindBoxInventory',
  'listBlindBoxCoinEntries',
  'getOverview',
  'getRules',
  'getTeam',
  'listHistory',
  'listRankings',
])

export function isRetryableGameAction(action: MipGameAction) {
  return retryableGameActions.has(action)
}
