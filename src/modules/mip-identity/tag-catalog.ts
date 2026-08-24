import type { ProfileTagOption } from './contracts'

export interface ProfileIndustryOption {
  id: string
  key: string
  label: string
  groupId: string
  groupKey: string
  groupLabel: string
  displayLabel: string
}

export interface ProfileIndustryGroup {
  id: string
  key: string
  label: string
  options: ProfileIndustryOption[]
}

export function groupProfileIndustries(tags: ProfileTagOption[]): ProfileIndustryGroup[] {
  const children = tags.filter(tag => tag.kind === 'INDUSTRY' && tag.selectable && tag.parentId)
  return tags
    .filter(tag => tag.kind === 'INDUSTRY' && !tag.selectable && !tag.parentId)
    .map(group => ({
      id: group.id,
      key: group.key,
      label: group.label,
      options: children
        .filter(tag => tag.parentId === group.id)
        .map(tag => ({
          id: tag.id,
          key: tag.key,
          label: tag.label,
          groupId: group.id,
          groupKey: group.key,
          groupLabel: group.label,
          displayLabel: `${group.label} · ${tag.label}`,
        })),
    }))
    .filter(group => group.options.length)
}

export function flattenProfileIndustries(tags: ProfileTagOption[]): ProfileIndustryOption[] {
  return groupProfileIndustries(tags).flatMap(group => group.options)
}
