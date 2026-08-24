import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  catalogSelectorView,
  selectedCatalogIds,
  toggleCatalogSelection,
} from '../src/components/catalog-selector/model'

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
})
