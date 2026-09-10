import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  cooperationCardVariants,
  cooperationNameRuns,
  cooperationRoleCardView,
  variantByRoleKey,
} from '../src/components/mip-cooperation-card/model'
import { cooperationRoles } from '../src/config/mip-catalogs'

const figmaRawSourceNodes = {
  connector: '2004:3165',
  business_builder: '2004:3223',
  capital_operator: '2004:2990',
  strategist: '2004:2867',
  visual_designer: '2004:3100',
  delivery_lead: '2004:3283',
} as const

/** 烘焙卡合约（references/wechat-component-contracts.md）：六变种的底色/浅色/名称/底图。 */
const bakedVariants = {
  'dogplaner': { bg: '#7b00ff', light: '#f2e5ff', name: '狗策划 DOGPLANER' },
  'upstart': { bg: '#7a2900', light: '#fadab3', name: '暴发户 UPSTART' },
  'design-slave': { bg: '#04a44f', light: '#e5fff1', name: '死美工 Design Slave' },
  'pimp': { bg: '#df07a9', light: '#ffe5f9', name: '皮条客 pimp' },
  'business-man': { bg: '#ff5500', light: '#ffeee5', name: '生意佬 business man' },
  'old-nanny': { bg: '#1a71ff', light: '#e5efff', name: '老保姆 old nanny' },
} as const

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('MIP cooperation role visual component', () => {
  it('maps every stable role key to the confirmed Figma palette and baked art', () => {
    expect(Object.keys(figmaRawSourceNodes)).toEqual(cooperationRoles.map(role => role.key))
    expect(Object.keys(cooperationCardVariants).sort()).toEqual(Object.keys(bakedVariants).sort())
    for (const [variantKey, expected] of Object.entries(bakedVariants)) {
      expect(cooperationCardVariants[variantKey]).toMatchObject(expected)
      expect(cooperationCardVariants[variantKey].image).toBe(`/assets/mip/coop-card-${variantKey}@3x.png`)
    }
    expect(Object.values(variantByRoleKey).sort()).toEqual(Object.keys(bakedVariants).sort())

    for (const role of cooperationRoles) {
      const view = cooperationRoleCardView({ roleKey: role.key })
      const variantKey = variantByRoleKey[role.key]
      expect(view).toMatchObject({
        roleKey: role.key,
        variant: variantKey,
        name: bakedVariants[variantKey].name,
        image: `/assets/mip/coop-card-${variantKey}@3x.png`,
        bg: bakedVariants[variantKey].bg,
        light: bakedVariants[variantKey].light,
        goal: role.targetDirection,
        referral: role.positioning,
      })

      const assetPath = `src${view.image}`
      expect(existsSync(new URL(`../${assetPath}`, import.meta.url))).toBe(true)
      const bytes = readFileSync(new URL(`../${assetPath}`, import.meta.url))
      expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG')
    }
  })

  it('splits card names into CJK and Latin runs for the two design typefaces', () => {
    expect(cooperationNameRuns('狗策划 DOGPLANER')).toEqual([
      { text: '狗策划 ', latin: false },
      { text: 'DOGPLANER', latin: true },
    ])
    expect(cooperationNameRuns('老保姆 old nanny')).toEqual([
      { text: '老保姆 ', latin: false },
      { text: 'old nanny', latin: true },
    ])
  })

  it('keeps retired Figma source images outside the production source tree', () => {
    const archivedAssets = [
      {
        productionPath: 'src/assets/figma/profile/role-strategist.png',
        archivePath: 'docs/mip/source-assets/figma/profile/role-strategist.png',
      },
      {
        productionPath: 'src/assets/figma/opportunities/opportunity-cover-2.png',
        archivePath: 'docs/mip/source-assets/figma/opportunities/opportunity-cover-2.png',
      },
    ]

    for (const asset of archivedAssets) {
      expect(existsSync(new URL(`../${asset.productionPath}`, import.meta.url))).toBe(false)
      expect(existsSync(new URL(`../${asset.archivePath}`, import.meta.url))).toBe(true)
    }
  })

  it('uses card content when provided and degrades unknown roles without invented art', () => {
    expect(cooperationRoleCardView({
      roleKey: 'strategist',
      positioning: '  需要认识更多地产开发商  ',
      targetSummary: '  26年接3个非标商业项目  ',
    })).toMatchObject({
      referral: '需要认识更多地产开发商',
      goal: '26年接3个非标商业项目',
    })
    expect(cooperationRoleCardView({ roleKey: 'unknown' })).toMatchObject({
      roleKey: '',
      variant: '',
      name: '合作角色',
      image: '',
      bg: '#333333',
    })
  })

  it('keeps one neutral component structure instead of six repeated templates', () => {
    const config = JSON.parse(source('src/components/mip-cooperation-card/index.json'))
    const component = source('src/components/mip-cooperation-card/index.wxml')
    expect(config).toEqual({
      component: true,
      styleIsolation: 'apply-shared',
      usingComponents: { 'mip-icon': '../mip-icon/index' },
    })
    expect(component).toContain('style="background-color: {{view.bg}}"')
    expect(component).toContain('src="{{view.image}}"')
    expect(component).toContain('mode="scaleToFill"')
    expect(component).toContain('mip-cooperation-card__name-run--latin')
    expect(component).toContain('<mip-icon name="target"')
    expect(component).toContain('<mip-icon name="cup"')
    expect(component).not.toContain('avatarUrl')
    expect(component).not.toContain('roleKey ===')
  })

  it('integrates the shared role card without changing page click contracts', () => {
    const pages = [
      {
        config: 'src/packages/member/mip-cooperation/list/index.json',
        template: 'src/packages/member/mip-cooperation/list/index.wxml',
        click: 'data-id="{{item.id}}" bind:tap="openCard"',
      },
      {
        config: 'src/pages/profile/index.json',
        template: 'src/pages/profile/index.wxml',
        click: 'data-id="{{item.id}}" bind:tap="openCooperation"',
      },
      {
        config: 'src/packages/member/mip-public-profile/index.json',
        template: 'src/packages/member/mip-public-profile/index.wxml',
        click: 'data-id="{{item.id}}" bind:tap="openCooperationCard"',
      },
    ]

    for (const page of pages) {
      expect(JSON.parse(source(page.config)).usingComponents['mip-cooperation-card'])
        .toBe('/components/mip-cooperation-card/index')
      const template = source(page.template)
      expect(template).toContain('<mip-cooperation-card')
      expect(template).toContain('role-key="{{item.roleKey}}"')
      expect(template).toContain('positioning="{{item.positioning}}"')
      expect(template).toContain('target-summary="{{item.targetSummary}}"')
      expect(template).toContain(page.click)
    }

    const list = source('src/packages/member/mip-cooperation/list/index.wxml')
    const profile = source('src/pages/profile/index.wxml')
    expect(list).not.toContain('item.roleKey ===')
    expect(list).toContain('item.author.avatarUrl')
    expect(profile).not.toContain('/assets/figma/profile/role-strategist.png')
  })
})
