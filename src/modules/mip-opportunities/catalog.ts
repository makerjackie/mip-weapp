import type { CatalogSelectorGroup } from '../../shared/catalog-selector'
import type { OpportunityStatus, OpportunityTypeKey } from './types'

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

/** journey-review QZ1：机会类型三件套（终审拍板，取值集固定不再扩展）。 */
export const opportunityTypeOptions: Array<{ key: OpportunityTypeKey, label: string }> = [
  { key: 'COMPANY', label: '找企业' },
  { key: 'RESOURCE', label: '找资源' },
  { key: 'PARTNER', label: '找伙伴' },
]

const opportunityTypeLabels = new Map(opportunityTypeOptions.map(item => [item.key, item.label]))

export function opportunityTypeLabel(key: OpportunityTypeKey) {
  return opportunityTypeLabels.get(key) || key
}

export function isOpportunityTypeKey(value: unknown): value is OpportunityTypeKey {
  return typeof value === 'string' && opportunityTypeLabels.has(value as OpportunityTypeKey)
}

/**
 * journey-review QZ2 项目状态三态（招募中/结束项目/下架项目）对应的编辑页选择值。
 * 服务端当前以 PUBLISHED / ENDED 承载「招募中 / 结束项目」；
 * 「下架项目」在服务端补 UNPUBLISHED 前映射为 DRAFT（仅自己可见）。
 */
export type OpportunityProjectStatus = 'RECRUITING' | 'ENDED' | 'UNPUBLISHED'

export const opportunityProjectStatusOptions: Array<{
  key: OpportunityProjectStatus
  label: string
  description: string
}> = [
  { key: 'RECRUITING', label: '招募中', description: '想合作的人将通知你' },
  { key: 'ENDED', label: '结束项目', description: '不再招募' },
  { key: 'UNPUBLISHED', label: '下架项目', description: '仅自己可见' },
]

export function opportunityProjectStatusLabel(key: OpportunityProjectStatus) {
  return opportunityProjectStatusOptions.find(item => item.key === key)?.label || key
}

/**
 * 旅程口径的列表状态：DRAFT 且带 publishedAt 视为「已下架」
 * （此前公开发布过、现仅自己可见），未发布过的 DRAFT 仍是「草稿」。
 */
export function journeyStatusOf(item: { status: OpportunityStatus, publishedAt?: string }): OpportunityStatus {
  if (item.status === 'DRAFT' && item.publishedAt) {
    return 'UNPUBLISHED'
  }
  return item.status
}

export function opportunityStatusLabel(item: { status: OpportunityStatus, publishedAt?: string }) {
  const status = journeyStatusOf(item)
  if (status === 'PUBLISHED') {
    return '招募中'
  }
  if (status === 'ENDED') {
    return '已结束'
  }
  if (status === 'UNPUBLISHED') {
    return '已下架'
  }
  return '草稿'
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
