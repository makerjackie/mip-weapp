import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CITY_DIRECTORY,
  cityIndexOfLabel,
  EDITOR_HOT_CITY_COUNT,
  filterCityDirectory,
  groupCityDirectory,
  HOT_CITY_LABELS,
} from '../src/packages/member/mip-cases/city-selector/city-directory'

function source(path: string) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('MIP super case city directory', () => {
  it('keeps unique nationwide cities with sortable pinyin initials', () => {
    const labels = CITY_DIRECTORY.map(entry => entry.label)
    expect(new Set(labels).size).toBe(labels.length)
    expect(CITY_DIRECTORY.length).toBeGreaterThan(200)
    for (const entry of CITY_DIRECTORY) {
      expect(entry.label).toBeTruthy()
      expect(entry.pinyin).toMatch(/^[a-z]+(?:'[a-z]+)?$/)
      expect(entry.pinyin[0]).toMatch(/[a-z]/)
    }
    // 全国主要城市至少覆盖这些基准点（含曾漏掉的宝鸡/大庆/莆田等）。
    for (const label of ['北京', '上海', '广州', '深圳', '成都', '武汉', '西安', '哈尔滨', '乌鲁木齐', '宝鸡', '大庆', '莆田', '台北']) {
      expect(cityIndexOfLabel(label)).toBeGreaterThan(-1)
    }
  })

  it('groups cities by pinyin letter with # last and supports label/pinyin search', () => {
    const groups = groupCityDirectory()
    expect(groups[0].letter).toBe('A')
    expect(groups[groups.length - 1].letter).toBe('Z')
    const letters = groups.map(group => group.letter)
    expect([...letters]).toEqual([...letters].sort())
    for (const group of groups) {
      const sorted = [...group.cities].sort((a, b) => a.pinyin.localeCompare(b.pinyin))
      expect(group.cities).toEqual(sorted)
    }
    // 非 a-z 开头的条目兜底进 # 且排在最后。
    const withPound = groupCityDirectory([{ label: '示例', pinyin: '123' }, ...CITY_DIRECTORY])
    expect(withPound[withPound.length - 1].letter).toBe('#')

    expect(filterCityDirectory('深圳').map(entry => entry.label)).toContain('深圳')
    expect(filterCityDirectory('beijing').map(entry => entry.label)).toContain('北京')
    expect(filterCityDirectory('北京').map(entry => entry.label)).toContain('北京')
    expect(filterCityDirectory('  ')).toHaveLength(CITY_DIRECTORY.length)
  })

  it('feeds the editor eight hot cities from the shared directory', () => {
    expect(EDITOR_HOT_CITY_COUNT).toBe(8)
    expect(HOT_CITY_LABELS.length).toBeGreaterThanOrEqual(EDITOR_HOT_CITY_COUNT)
    for (const label of HOT_CITY_LABELS.slice(0, EDITOR_HOT_CITY_COUNT)) {
      expect(cityIndexOfLabel(label)).toBeGreaterThan(-1)
    }
  })
})

describe('MIP city selector page contract', () => {
  const template = source('src/packages/member/mip-cases/city-selector/index.wxml')
  const page = source('src/packages/member/mip-cases/city-selector/index.ts')
  const config = JSON.parse(source('src/packages/member/mip-cases/city-selector/index.json')) as {
    navigationBarTitleText: string
    usingComponents: Record<string, string>
  }

  it('reproduces the figma 2215_4618 layout blocks', () => {
    expect(config.navigationBarTitleText).toBe('选择城市')
    expect(template).toContain('id="mip-city-selector-page"')
    expect(template).toContain('mip-member-page')
    expect(template).toContain('搜索城市名/拼音')
    expect(template).toContain('热门城市')
    expect(template).toContain('city-selector-chip--active')
    expect(template).toContain('scroll-into-view="{{scrollAnchor}}"')
    expect(template).toContain('city-selector-index__letter')
    expect(template).toContain('<app-page-exit')
  })

  it('returns the picked city through the opener EventChannel and exposes error retry', () => {
    expect(page).toContain('citySelected')
    expect(page).toContain('wx.navigateBack()')
    expect(page).toContain('state: \'loading\'')
    expect(page).toContain('filterCityDirectory(term)')
    expect(template).toContain('bind:tap="onPickCity"')
    expect(template).toContain('bind:action="retry"')
    expect(page).toContain('tagId: this.cityTagIds[label]')
  })

  it('is registered consistently across the route contracts', () => {
    const app = JSON.parse(source('src/app.json')) as { subPackages: Array<{ root: string, pages: string[] }> }
    const project = JSON.parse(source('config/project.json')) as { routes: Array<{ pathName: string }> }
    const runtime = JSON.parse(source('config/runtime-pages.json')) as { routeCount: number, routes: Array<{ id: string, path: string, selector: string }> }

    const member = app.subPackages.find(item => item.root === 'packages/member')
    expect(member?.pages).toContain('mip-cases/city-selector/index')
    expect(project.routes.map(route => route.pathName)).toContain('packages/member/mip-cases/city-selector/index')
    const route = runtime.routes.find(item => item.path === 'packages/member/mip-cases/city-selector/index')
    expect(route?.selector).toBe('#mip-city-selector-page')
    expect(runtime.routeCount).toBe(runtime.routes.length)
  })
})
