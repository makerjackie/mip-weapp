import type { CatalogSelectorGroup } from '../../shared/catalog-selector'

interface BranchCatalogItem {
  id: string
  name: string
  cityName: string
}

interface CityCatalogItem {
  label: string
  popular?: boolean
}

interface GroupedCityBranchOptions {
  separatePopular?: boolean
}

export function groupedCityBranches(
  branches: readonly BranchCatalogItem[],
  cityTags: readonly CityCatalogItem[],
  settings: GroupedCityBranchOptions = {},
): CatalogSelectorGroup[] {
  const popularCities = new Set(
    cityTags
      .filter(city => city.popular)
      .map(city => city.label.trim()),
  )
  const options = branches.map(branch => ({
    id: branch.id,
    label: branch.name === branch.cityName
      ? branch.cityName
      : `${branch.cityName} · ${branch.name}`,
    popular: popularCities.has(branch.cityName.trim()),
  }))
  if (!settings.separatePopular) {
    return [{
      id: 'city-branches',
      label: '城市分会',
      options,
    }]
  }
  const popularOptions = options
    .filter(option => option.popular)
    .map(option => ({ ...option, popular: false }))
  const regularOptions = options
    .filter(option => !option.popular)
  return [{
    id: 'popular-city-branches',
    label: '热门',
    options: popularOptions,
  }, {
    id: 'city-branches',
    label: '城市分会',
    options: regularOptions,
  }].filter(group => group.options.length)
}
