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
  'admin.getSession',
  'admin.listRankings',
  'admin.listSeasons',
  'admin.listTeams',
  'admin.listAssignableMembers',
  'admin.listMatches',
  'admin.listBlindBoxCatalogs',
  'admin.listBlindBoxCards',
])

export function isRetryableGameAction(action: MipGameAction) {
  return retryableGameActions.has(action)
}
