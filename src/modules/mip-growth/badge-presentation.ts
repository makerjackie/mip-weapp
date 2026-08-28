import type { BadgeCollectionItem } from './types'
import { badgeArtFallback } from '../../config/mip-badge-art'
import { formatLocalDate } from '../../utils/date'

export interface BadgeView extends BadgeCollectionItem {
  selected: boolean
  locked: boolean
  artFallbackUrl: string
  awardedText: string
}

export type BadgeCollectionFilter = 'ALL' | 'EQUIPPED' | 'EQUIPPABLE'

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

export function filterBadgeItems(
  items: BadgeView[],
  category: BadgeView['category'],
  filter: BadgeCollectionFilter,
) {
  return items.filter((item) => {
    if (item.category !== category) {
      return false
    }
    if (filter === 'EQUIPPED') {
      return item.selected
    }
    if (filter === 'EQUIPPABLE') {
      return item.earned && item.status === 'ACTIVE'
    }
    return true
  })
}

export function orderedEquippedBadges(items: BadgeView[], selectedIds: string[]) {
  const byId = new Map(items.map(item => [item.id, item]))
  return selectedIds.map(id => byId.get(id)).filter((item): item is BadgeView => Boolean(item))
}

export function moveEquippedId(selectedIds: string[], badgeId: string, direction: 'UP' | 'DOWN') {
  const index = selectedIds.indexOf(badgeId)
  const target = direction === 'UP' ? index - 1 : index + 1
  if (index < 0 || target < 0 || target >= selectedIds.length) {
    return selectedIds
  }
  const next = [...selectedIds]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

export function sameIdOrder(left: string[], right: string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

export function canApplyBadgeLoad(
  requestSequence: number,
  currentSequence: number,
  dirty: boolean,
  discardDraft = false,
) {
  return requestSequence === currentSequence && (!dirty || discardDraft)
}
