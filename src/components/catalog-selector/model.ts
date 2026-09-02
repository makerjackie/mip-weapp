export interface CatalogSelectorOption {
  id: string
  label: string
  popular?: boolean
}

export interface CatalogSelectorGroup {
  id: string
  label: string
  options: CatalogSelectorOption[]
}

export interface CatalogSelectorViewOption extends CatalogSelectorOption {
  selected: boolean
}

export interface CatalogSelectorViewGroup extends Omit<CatalogSelectorGroup, 'options'> {
  options: CatalogSelectorViewOption[]
}

export function selectedCatalogIds(
  groups: readonly CatalogSelectorGroup[],
  selectedIds: readonly string[],
  multiple: boolean,
  maxSelections: number,
) {
  const selectableIds = new Set(groups.flatMap(group => group.options.map(option => option.id)))
  const limit = multiple ? Math.max(1, Math.floor(maxSelections || 1)) : 1
  return [...new Set(selectedIds)]
    .filter(id => selectableIds.has(id))
    .slice(0, limit)
}

export function catalogSelectorView(
  groups: readonly CatalogSelectorGroup[],
  selectedIds: readonly string[],
) {
  const selected = new Set(selectedIds)
  const projectOption = (option: CatalogSelectorOption): CatalogSelectorViewOption => ({
    ...option,
    selected: selected.has(option.id),
  })
  const popularOptions = groups
    .flatMap(group => group.options)
    .filter(option => option.popular)
    .map(projectOption)
  const viewGroups: CatalogSelectorViewGroup[] = groups
    .map(group => ({
      ...group,
      options: group.options
        .filter(option => !option.popular)
        .map(projectOption),
    }))
    .filter(group => group.options.length > 0)
  return { viewGroups, popularOptions }
}

export function toggleCatalogSelection(
  selectedIds: readonly string[],
  id: string,
  multiple: boolean,
  maxSelections: number,
) {
  if (!id) {
    return { selectedIds: [...selectedIds], limited: false }
  }
  if (!multiple) {
    return {
      selectedIds: selectedIds.includes(id) ? [] : [id],
      limited: false,
    }
  }
  if (selectedIds.includes(id)) {
    return { selectedIds: selectedIds.filter(item => item !== id), limited: false }
  }
  const limit = Math.max(1, Math.floor(maxSelections || 1))
  if (selectedIds.length >= limit) {
    return { selectedIds: [...selectedIds], limited: true }
  }
  return { selectedIds: [...selectedIds, id], limited: false }
}
