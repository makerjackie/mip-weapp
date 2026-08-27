import type { BadgeCollectionItem } from '../../../modules/mip-growth'
import { badgeArtFallback } from '../../../config/mip-badge-art'
import { formatLocalDate } from '../../../utils/date'

export interface BadgeView extends BadgeCollectionItem {
  selected: boolean
  locked: boolean
  artFallbackUrl: string
  awardedText: string
}

export function presentBadges(items: BadgeCollectionItem[], selectedIds: string[]): BadgeView[] {
  const selected = new Set(selectedIds)
  return items.map(item => ({
    ...item,
    selected: selected.has(item.id),
    locked: !item.earned || item.status !== 'ACTIVE',
    artFallbackUrl: badgeArtFallback(item.key, item.name),
    awardedText: item.awardedAt ? formatLocalDate(item.awardedAt) : '',
  }))
}

export function orderedEquippedIds(items: BadgeCollectionItem[]) {
  return items
    .filter(item => item.equippedSlot !== undefined)
    .sort((left, right) => Number(left.equippedSlot) - Number(right.equippedSlot))
    .map(item => item.id)
}
