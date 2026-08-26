import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { cooperationRoleCardView, cooperationRoleVisuals } from '../src/components/cooperation-role-card/model'
import { cooperationRoles } from '../src/config/mip-catalogs'

const figmaRawSourceNodes = {
  connector: '2004:3165',
  business_builder: '2004:3223',
  capital_operator: '2004:2990',
  strategist: '2004:2867',
  visual_designer: '2004:3100',
  delivery_lead: '2004:3283',
} as const

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function losslessWebpMetadata(path: string) {
  const url = new URL(`../${path}`, import.meta.url)
  const bytes = readFileSync(url)
  expect(bytes.subarray(0, 4).toString('ascii')).toBe('RIFF')
  expect(bytes.subarray(8, 12).toString('ascii')).toBe('WEBP')
  expect(bytes.subarray(12, 16).toString('ascii')).toBe('VP8L')
  expect(bytes[20]).toBe(0x2F)
  const dimensions = bytes.readUInt32LE(21)
  return {
    width: (dimensions & 0x3FFF) + 1,
    height: ((dimensions >>> 14) & 0x3FFF) + 1,
    hasAlpha: Boolean((dimensions >>> 28) & 1),
  }
}

describe('MIP cooperation role visual component', () => {
  it('maps every stable role key to the confirmed Figma palette and official art', () => {
    expect(Object.keys(figmaRawSourceNodes)).toEqual(cooperationRoles.map(role => role.key))
    expect(cooperationRoleVisuals).toEqual({
      connector: {
        backgroundColor: '#DF07A9',
        softColor: '#FFE5F9',
        foregroundColor: '#FFFFFF',
        artPath: '/assets/figma/cooperation/connector.webp',
      },
      business_builder: {
        backgroundColor: '#FF5500',
        softColor: '#FFE5F9',
        foregroundColor: '#FFFFFF',
        artPath: '/assets/figma/cooperation/business-builder.webp',
      },
      capital_operator: {
        backgroundColor: '#7A2900',
        softColor: '#FADAB3',
        foregroundColor: '#FFFFFF',
        artPath: '/assets/figma/cooperation/capital-operator.webp',
      },
      strategist: {
        backgroundColor: '#7B00FF',
        softColor: '#DAB8FF',
        foregroundColor: '#FFFFFF',
        artPath: '/assets/figma/cooperation/strategist.webp',
      },
      visual_designer: {
        backgroundColor: '#04A44F',
        softColor: '#AFFDD4',
        foregroundColor: '#FFFFFF',
        artPath: '/assets/figma/cooperation/visual-designer.webp',
      },
      delivery_lead: {
        backgroundColor: '#1A71FF',
        softColor: '#E5EFFF',
        foregroundColor: '#FFFFFF',
        artPath: '/assets/figma/cooperation/delivery-lead.webp',
      },
    })

    for (const role of cooperationRoles) {
      const view = cooperationRoleCardView({ roleKey: role.key })
      expect(view).toMatchObject({
        roleKey: role.key,
        roleName: role.name,
        positioning: role.positioning,
        targetSummary: role.targetDirection,
        brandMark: 'MIP',
        artPath: cooperationRoleVisuals[role.key].artPath,
      })
      expect(view.heroStyle).toContain(cooperationRoleVisuals[role.key].backgroundColor)
      expect(view.softStyle).toContain(cooperationRoleVisuals[role.key].softColor)

      const assetPath = `src${cooperationRoleVisuals[role.key].artPath}`
      expect(existsSync(new URL(`../${assetPath}`, import.meta.url))).toBe(true)
      expect(assetPath.endsWith('.webp')).toBe(true)
      expect(existsSync(new URL(`../${assetPath.replace(/\.webp$/, '.png')}`, import.meta.url))).toBe(false)
      expect(losslessWebpMetadata(assetPath)).toEqual({
        width: 339,
        height: 360,
        hasAlpha: true,
      })
    }
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
      positioning: '  品牌与产品策划  ',
      targetSummary: '  完成三个合作项目  ',
    })).toMatchObject({
      positioning: '品牌与产品策划',
      targetSummary: '完成三个合作项目',
    })
    expect(cooperationRoleCardView({ roleKey: 'unknown' })).toMatchObject({
      roleKey: '',
      roleName: '合作角色',
      artPath: '',
    })
  })

  it('keeps one neutral component structure instead of six repeated templates', () => {
    const config = JSON.parse(source('src/components/cooperation-role-card/index.json'))
    const component = source('src/components/cooperation-role-card/index.wxml')
    expect(config).toEqual({ component: true, styleIsolation: 'apply-shared' })
    expect(component).toContain('{{view.brandMark}}')
    expect(component).toContain('{{view.roleName}}')
    expect(component).toContain('{{view.positioning}}')
    expect(component).toContain('src="{{view.artPath}}"')
    expect(component).toContain('mode="aspectFill"')
    expect(component).toContain('/assets/figma/profile/target.svg')
    expect(component).toContain('/assets/figma/profile/referral.svg')
    expect(component).not.toContain('avatarUrl')
    expect(component).not.toContain('roleKey ===')
  })

  it('integrates the shared role card without changing page click contracts', () => {
    const pages = [
      {
        config: 'src/packages/member/mip-cooperation/list/index.json',
        template: 'src/packages/member/mip-cooperation/list/index.wxml',
        click: 'data-id="{{item.id}}" bind:tap="open"',
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
      expect(JSON.parse(source(page.config)).usingComponents['cooperation-role-card'])
        .toBe('/components/cooperation-role-card/index')
      const template = source(page.template)
      expect(template).toContain('<cooperation-role-card')
      expect(template).toContain('role-key="{{item.roleKey}}"')
      expect(template).toContain('positioning="{{item.positioning}}"')
      expect(template).toContain('target-summary="{{item.targetSummary}}"')
      expect(template).toContain(page.click)
    }

    const list = source('src/packages/member/mip-cooperation/list/index.wxml')
    const profile = source('src/pages/profile/index.wxml')
    expect(list).not.toContain('item.roleKey ===')
    expect(list).not.toContain('item.author.avatarUrl')
    expect(profile).not.toContain('/assets/figma/profile/role-strategist.png')
  })
})
