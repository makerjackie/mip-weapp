import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')
}

/**
 * MIW-120 活动与机会左上角地区切换。
 * 契约：三个入口统一系统原生 picker（全国 + ACTIVE 分会城市，来源 = 管理后台分会），
 * 选中即过滤；项目机会按分会归属过滤且平台机会全国可见；人才合作按主分会严格过滤；
 * 默认地区 = 用户主分会；清除筛选回到全国；不再使用 wx.showActionSheet（上限 6 项）。
 */
describe('MIW-120 region switcher on events and opportunities', () => {
  const events = source('src/pages/events/index.wxml')
  const eventsScript = source('src/pages/events/index.ts')
  const discovery = source('src/pages/opportunities/index.wxml')
  const discoveryScript = source('src/pages/opportunities/index.ts')
  const listService = source('cloudfunctions/mip-opportunities-api/domain/opportunities.js')

  it('events top-left uses the native scroll picker fed by feed cities', () => {
    expect(events).toContain('<picker id="events-city-select"')
    expect(events).toContain('mode="selector" range="{{cityOptions}}" value="{{cityIndex}}"')
    expect(events).toContain('bindchange="onCityPicked"')
    expect(events).toContain('{{selectedCity || \'全国\'}}')
    expect(eventsScript).not.toContain('wx.showActionSheet')
    expect(eventsScript).not.toContain('全部城市')
    expect(eventsScript).toContain('cityOptions: [\'全国\', ...cities]')
  })

  it('events picker selection applies the city filter immediately', () => {
    expect(eventsScript).toContain('cityName: this.data.selectedCity || undefined')
    expect(eventsScript).toContain('const selectedCity = index === 0 ? \'\' : this.data.cityOptions[index]')
    expect(eventsScript).toContain('this.cityManuallySelected = true')
    expect(eventsScript).toContain('void this.loadEvents()')
  })

  it('events default region still resolves from the primary branch', () => {
    expect(eventsScript).toContain('resolvePrimaryBranchCity(snapshot.primaryBranchId, branchSnapshot.branches)')
  })

  it('opportunities top-left is a region picker in both tabs', () => {
    expect(discovery).toContain('<picker wx:else id="opportunities-location-filter" mode="selector" range="{{regionViews}}" range-key="label"')
    expect(discovery).toContain('bindchange="onRegionPicked"')
    expect(discoveryScript).toContain('regionViews: [{ id: \'\', label: \'全国\' }]')
    // 筛选入口迁移：项目机会在状态行，人才合作保留搜索行「筛选」。
    expect(discovery).toContain('id="opportunities-filter-entry"')
    expect(discovery).toContain('id="opportunities-filter-toggle"')
    // 已废弃的死草稿链路不再出现。
    expect(discoveryScript).not.toContain('draftCooperationBranchId')
  })

  it('region pick applies per-mode branch filters immediately', () => {
    expect(discoveryScript).toContain('? { regionIndex: index, selectedCooperationBranchId: branchId }')
    expect(discoveryScript).toContain(': { regionIndex: index, selectedRegionBranchId: branchId }')
    expect(discoveryScript).toContain('branchId: this.data.selectedRegionBranchId || undefined')
    expect(discoveryScript).toContain('branchId: this.data.selectedCooperationBranchId || undefined')
  })

  it('region options derive from the admin-managed branch catalog', () => {
    expect(discoveryScript).toContain('function regionViewsFor(catalog: OpportunityCatalog)')
    expect(discoveryScript).toContain('catalog.branches.map(branch => ({')
    expect(discoveryScript).toContain('`')
  })

  it('default region falls back to nationwide when the primary branch is inactive', () => {
    expect(discoveryScript).toContain('snapshot?.primaryBranchId')
    expect(discoveryScript).toContain('catalog.branches.some(branch => branch.id === primaryBranchId)')
    expect(discoveryScript).toContain('regionDefaultApplied')
  })

  it('clearing applied filters resets the region to nationwide', () => {
    expect(discoveryScript).toContain('selectedRegionBranchId: \'\',')
    expect(discoveryScript).toContain('regionIndex: 0')
    expect(discoveryScript).toContain('locationFilterLabel: \'全国\'')
  })

  it('server keeps platform-owned opportunities visible in every region', () => {
    expect(listService).toContain('(o.branch_id = ? OR o.branch_id IS NULL)')
  })
})
