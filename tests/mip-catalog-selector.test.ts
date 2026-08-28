import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  catalogSelectorView,
  selectedCatalogIds,
  toggleCatalogSelection,
} from '../src/components/catalog-selector/model'
import { groupedCityBranches } from '../src/modules/mip-opportunities/catalog'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

const groups = [
  {
    id: 'industry-a',
    label: '行业一',
    options: [
      { id: 'child-a', label: '子行业一', popular: true },
      { id: 'child-b', label: '子行业二' },
    ],
  },
]

describe('shared catalog selector', () => {
  it('keeps parent groups non-selectable and projects popular child options', () => {
    const view = catalogSelectorView(groups, ['child-a'])
    expect(view.popularOptions).toEqual([{ id: 'child-a', label: '子行业一', popular: true, selected: true }])
    expect(view.viewGroups[0].options[0].selected).toBe(true)
  })

  it('removes unknown values and enforces single selection', () => {
    expect(selectedCatalogIds(groups, ['industry-a', 'child-a', 'child-b'], false, 8)).toEqual(['child-a'])
    expect(toggleCatalogSelection(['child-a'], 'child-b', false, 8)).toEqual({
      selectedIds: ['child-b'],
      limited: false,
    })
  })

  it('reports a multi-select limit without changing the selection', () => {
    expect(toggleCatalogSelection(['child-a'], 'child-b', true, 1)).toEqual({
      selectedIds: ['child-a'],
      limited: true,
    })
  })

  it('projects popular cities onto the reused branch selector', () => {
    expect(groupedCityBranches(
      [
        { id: 'shenzhen-branch', name: '深圳分会', cityName: '深圳' },
        { id: 'huizhou-branch', name: '惠州分会', cityName: '惠州' },
      ],
      [
        { label: '深圳', popular: true },
        { label: '惠州' },
      ],
    )).toEqual([{
      id: 'city-branches',
      label: '城市分会',
      options: [
        { id: 'shenzhen-branch', label: '深圳 · 深圳分会', popular: true },
        { id: 'huizhou-branch', label: '惠州 · 惠州分会', popular: false },
      ],
    }])
  })

  it('partitions profile branch choices so popular options are not rendered twice', () => {
    expect(groupedCityBranches(
      [
        { id: 'shenzhen-branch', name: '深圳分会', cityName: '深圳' },
        { id: 'huizhou-branch', name: '惠州分会', cityName: '惠州' },
      ],
      [
        { label: '深圳', popular: true },
        { label: '惠州' },
      ],
      { separatePopular: true },
    )).toEqual([{
      id: 'popular-city-branches',
      label: '热门',
      options: [{ id: 'shenzhen-branch', label: '深圳 · 深圳分会', popular: false }],
    }, {
      id: 'city-branches',
      label: '城市分会',
      options: [{ id: 'huizhou-branch', label: '惠州 · 惠州分会', popular: false }],
    }])
  })

  it('reuses the grouped selector for profile, people, and opportunity filters', () => {
    const pages = [
      'src/packages/member/mip-profile',
      'src/packages/member/mip-people',
      'src/pages/opportunities',
    ]
    for (const page of pages) {
      expect(JSON.parse(read(`${page}/index.json`)).usingComponents['mip-catalog-selector'])
        .toBe('/components/catalog-selector/index')
      expect(read(`${page}/index.wxml`)).toContain('<mip-catalog-selector')
    }
  })

  it('exposes stable runtime selectors for user discovery and profile tabs', () => {
    const opportunities = read('src/pages/opportunities/index.wxml')
    const people = read('src/packages/member/mip-people/index.wxml')
    const profile = read('src/pages/profile/index.wxml')
    expect(opportunities).toContain('id="opportunities-search-input"')
    expect(opportunities).toContain('id="opportunities-filter-toggle"')
    expect(people).toContain('id="people-search-input"')
    expect(people).toContain('id="people-filter-toggle"')
    expect(people).not.toContain('text-subtle')
    for (const id of ['cooperation', 'cases', 'opportunities']) {
      expect(profile.match(new RegExp(`id="profile-tab-${id}"`, 'g'))).toHaveLength(2)
    }
  })

  it('keeps catalog choices readable, stateful, and at least 88rpx high', () => {
    const view = read('src/components/catalog-selector/index.wxml')
    expect(view).not.toContain('min-h-[64rpx]')
    expect(view).toContain('min-h-[88rpx]')
    expect(view).toContain('aria-checked="true"')
    expect(view).toContain('aria-checked="false"')
    expect(view).toContain('aria-pressed="true"')
    expect(view).toContain('已选')
  })
})
