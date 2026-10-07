import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

const componentScript = read('src/components/mip-industry-selector/index.ts')
const componentTemplate = read('src/components/mip-industry-selector/index.wxml')
const componentConfig = JSON.parse(read('src/components/mip-industry-selector/index.json'))

describe('mip-industry-selector 业务组件', () => {
  it('复用 catalog-selector 纯函数与 mip-tag-chip 设计系统组件', () => {
    expect(componentScript).toContain('import { catalogSelectorView, toggleCatalogSelection } from \'../catalog-selector/model\'')
    expect(componentConfig.usingComponents['mip-tag-chip']).toBe('/components/mip-tag-chip/index')
    expect(componentTemplate).toContain('<mip-tag-chip label="{{item.label}}" active="{{item.selected}}" />')
  })

  it('以 change 事件回传 selectedIds,页面不再维护行业视图管道', () => {
    expect(componentScript).toContain('triggerEvent(\'change\', { selectedIds, limited })')
    const chipTap = componentScript.slice(
      componentScript.indexOf('    onChipTap('),
      componentScript.indexOf('    emitChange('),
    )
    expect(chipTap).toContain('toggleCatalogSelection(')
    expect(chipTap).toContain('this.data.maxCount')
  })

  it('三种形态:单选(填写信息)、多选(人才筛选)、手风琴(机会筛选)', () => {
    expect(componentScript).toContain('multiple: { type: Boolean, value: false }')
    expect(componentTemplate).toContain('aria-role="{{multiple ? \'checkbox\' : \'radio\'}}"')
    expect(componentTemplate).toContain('wx:if="{{expandedGroupId === group.id}}"')
    expect(componentTemplate).toContain('bind:tap="onGroupToggle"')
    expect(componentTemplate).toContain('wx:if="{{clearLabel}}"')
    expect(componentTemplate).toContain('wx:if="{{showPopular && popularOptions.length}}"')
  })

  it('chip 用包装 view 绑原生 tap,避免 mip-tag-chip 自定义事件与冒泡双触发', () => {
    expect(componentTemplate.match(/<mip-tag-chip[^>]*bind:tap/g) ?? []).toEqual([])
    expect(componentTemplate.match(/<view[^>]*bind:tap="onChipTap"/g)).toHaveLength(3)
  })

  it('填写信息页以单选接入', () => {
    const profileTemplate = read('src/packages/member/mip-profile/index.wxml')
    const profileConfig = JSON.parse(read('src/packages/member/mip-profile/index.json'))
    expect(profileConfig.usingComponents['mip-industry-selector']).toBe('/components/mip-industry-selector/index')
    expect(profileTemplate).toContain('<mip-industry-selector groups="{{industryGroups}}" selected-ids="{{selectedIndustryIds}}" multiple="{{false}}"')
    expect(profileTemplate).toContain('bind:change="changeIndustry"')
  })

  it('机会筛选页以多选(上限 8)手风琴接入行业选择器', () => {
    const discoveryTemplate = read('src/pages/opportunities/index.wxml')
    const discoveryConfig = JSON.parse(read('src/pages/opportunities/index.json'))
    expect(discoveryConfig.usingComponents['mip-industry-selector']).toBe('/components/mip-industry-selector/index')
    expect(discoveryTemplate).toContain('<mip-industry-selector groups="{{catalog.industryGroups}}" selected-ids="{{draftIndustryTagIds}}" multiple="{{true}}" max-count="{{8}}" accordion="{{true}}"')
  })
})
