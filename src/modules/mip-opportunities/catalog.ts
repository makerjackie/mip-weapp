import type { CatalogSelectorGroup } from '../../components/catalog-selector/model'

interface BranchCatalogItem {
  id: string
  name: string
  cityName: string
}

interface CityCatalogItem {
  label: string
  popular?: boolean
}

export function groupedCityBranches(
  branches: readonly BranchCatalogItem[],
  cityTags: readonly CityCatalogItem[],
): CatalogSelectorGroup[] {
  const popularCities = new Set(
    cityTags
      .filter(city => city.popular)
      .map(city => city.label.trim()),
  )
  return [{
    id: 'city-branches',
    label: '城市分会',
    options: branches.map(branch => ({
      id: branch.id,
      label: branch.name === branch.cityName
        ? branch.cityName
        : `${branch.cityName} · ${branch.name}`,
      popular: popularCities.has(branch.cityName.trim()),
    })),
  }]
}
