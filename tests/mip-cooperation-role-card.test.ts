import type { Buffer } from 'node:buffer'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { cooperationRoleCardView, cooperationRoleVisuals } from '../src/components/cooperation-role-card/model'
import { cooperationRoles } from '../src/config/mip-catalogs'

interface DecodedPng {
  width: number
  height: number
  data: Uint8Array
}

const requireModule = createRequire(import.meta.url)
const { PNG } = requireModule('pngjs') as {
  PNG: { sync: { read: (input: Buffer) => DecodedPng } }
}

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

function pngMetadata(path: string) {
  const url = new URL(`../${path}`, import.meta.url)
  const bytes = readFileSync(url)
  const header = bytes.subarray(0, 24)
  expect(header.subarray(1, 4).toString('ascii')).toBe('PNG')
  const image = PNG.sync.read(bytes)
  let alphaMin = 255
  let alphaMax = 0
  for (let offset = 3; offset < image.data.length; offset += 4) {
    alphaMin = Math.min(alphaMin, image.data[offset])
    alphaMax = Math.max(alphaMax, image.data[offset])
  }
  return {
    width: image.width,
    height: image.height,
    alphaMin,
    alphaMax,
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
        artPath: '/assets/figma/cooperation/connector.png',
      },
      business_builder: {
        backgroundColor: '#FF5500',
        softColor: '#FFE5F9',
        foregroundColor: '#FFFFFF',
        artPath: '/assets/figma/cooperation/business-builder.png',
      },
      capital_operator: {
        backgroundColor: '#7A2900',
        softColor: '#FADAB3',
        foregroundColor: '#FFFFFF',
        artPath: '/assets/figma/cooperation/capital-operator.png',
      },
      strategist: {
        backgroundColor: '#7B00FF',
        softColor: '#DAB8FF',
        foregroundColor: '#FFFFFF',
        artPath: '/assets/figma/cooperation/strategist.png',
      },
      visual_designer: {
        backgroundColor: '#04A44F',
        softColor: '#AFFDD4',
        foregroundColor: '#FFFFFF',
        artPath: '/assets/figma/cooperation/visual-designer.png',
      },
      delivery_lead: {
        backgroundColor: '#1A71FF',
        softColor: '#E5EFFF',
        foregroundColor: '#FFFFFF',
        artPath: '/assets/figma/cooperation/delivery-lead.png',
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
      expect(pngMetadata(assetPath)).toEqual({
        width: 339,
        height: 360,
        alphaMin: 0,
        alphaMax: 255,
      })
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
