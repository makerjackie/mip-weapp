import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  normalizePeopleFilter,
  parsePeoplePage,
  parsePublicProfileAggregate,
} from '../src/modules/mip-opportunities/validation'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

const profileRef = `p1.${'a'.repeat(16)}.${'b'.repeat(48)}.${'c'.repeat(22)}`

function person() {
  return {
    profileRef,
    isSelf: false,
    userKind: 'PLAYER',
    joinedAt: '2026-08-24T08:00:00.000Z',
    nickname: '林野',
    headline: '品牌与产品负责人',
    primaryIndustry: {
      id: '10000000-0000-4000-8000-000000000001',
      key: 'brand_consulting',
      label: '品牌咨询',
    },
    primaryBranch: {
      id: '20000000-0000-4000-8000-000000000001',
      name: '深圳分会',
      cityName: '深圳',
    },
    abilities: [{
      id: '30000000-0000-4000-8000-000000000001',
      key: 'delivery_management',
      label: '项目管理',
    }],
    userId: 'private-user-id',
    openid: 'private-openid',
    phoneNumber: '13800000000',
  }
}

describe('MIP people discovery client contract', () => {
  it('normalizes all supported filters and keeps them bounded', () => {
    expect(normalizePeopleFilter({
      kind: 'PLAYER',
      keyword: '  品牌  ',
      branchId: '20000000-0000-4000-8000-000000000001',
      industryTagIds: ['industry-1', 'industry-1'],
      abilityTagIds: ['ability-1', 'ability-1'],
      limit: 100,
    })).toEqual({
      scope: 'PLAYER',
      keyword: '品牌',
      branchId: '20000000-0000-4000-8000-000000000001',
      industryTagIds: ['industry-1'],
      abilityTagIds: ['ability-1'],
      cursor: undefined,
      limit: 30,
    })
    expect(normalizePeopleFilter({ scope: 'GLOBAL' })).toMatchObject({
      scope: 'GLOBAL',
      industryTagIds: [],
      abilityTagIds: [],
    })
  })

  it('whitelists people and aggregate fields instead of forwarding identity internals', () => {
    const page = parsePeoplePage({ items: [person()], nextCursor: 'opaque-cursor' })
    expect(page.items[0]).toMatchObject({
      profileRef,
      userKind: 'PLAYER',
      nickname: '林野',
      joinedAt: '2026-08-24T08:00:00.000Z',
    })
    expect(page.items[0]).not.toHaveProperty('userId')
    expect(page.items[0]).not.toHaveProperty('openid')
    expect(page.items[0]).not.toHaveProperty('phoneNumber')

    const aggregate = parsePublicProfileAggregate({
      profile: person(),
      cooperationCards: [{
        id: '40000000-0000-4000-8000-000000000001',
        roleKey: 'strategist',
        positioning: '品牌和产品策划',
        targetSummary: '完成三个合作项目',
        abilityScores: { strategy_planning: 5, unsafe: 99 },
        status: 'PUBLISHED',
        publishedAt: '2026-08-24T07:00:00.000Z',
      }],
      superCases: [{
        id: '50000000-0000-4000-8000-000000000001',
        projectName: '品牌升级',
        summary: '完成品牌定位和视觉升级',
        responsibility: '负责策略和统筹',
        status: 'PUBLISHED',
        publishedAt: '2026-08-24T06:00:00.000Z',
      }],
      opportunities: [{
        id: '60000000-0000-4000-8000-000000000001',
        title: '城市品牌合作',
        valueSummary: '提供品牌和渠道资源',
        targetSummary: '寻找策划伙伴',
        referralCount: 2,
        status: 'PUBLISHED',
        publishedAt: '2026-08-24T05:00:00.000Z',
      }],
      interestActive: true,
      userId: 'private-user-id',
    })
    expect(aggregate.interestActive).toBe(true)
    expect(aggregate.cooperationCards[0].abilityScores).toEqual({ strategy_planning: 5 })
    expect(aggregate).not.toHaveProperty('userId')
    expect(JSON.stringify(aggregate)).not.toContain('private-user-id')
  })

  it('registers and links the discovery route in all runtime contracts', () => {
    const app = JSON.parse(source('src/app.json'))
    const project = JSON.parse(source('config/project.json'))
    const runtime = JSON.parse(source('config/runtime-pages.json'))
    const route = 'packages/member/mip-people/index'
    const appRoutes = app.subPackages.flatMap((pkg: { root: string, pages: string[] }) => (
      pkg.pages.map(page => `${pkg.root}/${page}`)
    ))
    expect(appRoutes).toContain(route)
    expect(project.routes.map((item: { pathName: string }) => item.pathName)).toContain(route)
    expect(runtime.routes.map((item: { path: string }) => item.path)).toContain(route)
    expect(runtime.routeCount).toBe(runtime.routes.length)
    expect(source('src/pages/opportunities/index.ts')).toContain('\'/packages/member/mip-people/index\'')
    expect(source('src/pages/opportunities/index.wxml')).toContain('bind:tap="openPeople"')
  })

  it('keeps both pages on MIP module and platform boundaries with complete public sections', () => {
    const discovery = source('src/packages/member/mip-people/index.ts')
    const profile = source('src/packages/member/mip-public-profile/index.ts')
    const profileView = source('src/packages/member/mip-public-profile/index.wxml')
    expect(discovery).toContain('opportunityModule.listPeople')
    expect(discovery).toContain('searchScope: \'GLOBAL\'')
    expect(discovery).toContain('abilityTagIds: this.data.selectedAbilityTagIds')
    expect(source('src/packages/member/mip-people/index.wxml')).toContain('bind:tap="toggleAbility"')
    expect(source('src/packages/member/mip-people/index.wxml')).toContain('data-scope="PLAYER"')
    expect(profile).toContain('opportunityModule.getPublicProfile')
    expect(profile).toContain('opportunityModule.setProfileInterest')
    expect(`${discovery}\n${profile}`).not.toMatch(/membershipModule|wx\.cloud/)
    expect(profile).not.toContain('mipIdentityModule.getPublicProfile')
    for (const heading of ['合作卡', '超级案例', '招募中的机会', '感兴趣']) {
      expect(profileView).toContain(heading)
    }
  })

  it('locks the PROFILE interest source and discovery index in migration 017', () => {
    const migration = source('database/mysql/mip/017_profile_interest_source.sql')
    const rollback = source('database/mysql/mip/rollback/017_profile_interest_source.sql')
    const lock = JSON.parse(source('database/mysql/mip/migrations.lock.json'))
    const entry = lock.migrations.find((item: { name: string }) => item.name === 'mip_profile_interest_source')
    expect(migration).toContain('\'SUPER_CASE\', \'PROFILE\'')
    expect(migration).toContain('mip_users_discovery_idx (app_id, status, created_at DESC, id)')
    expect(rollback).toContain('DROP INDEX mip_users_discovery_idx')
    expect(entry?.altersTables).toEqual(['mip_profile_interests', 'mip_users'])
  })
})
