import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { createMipIdentityGateway } from '../src/modules/mip-identity'

const require = createRequire(import.meta.url)

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('MIP public profiles', () => {
  it('uses the same AppID-bound profile reference contract across MIP functions', () => {
    const identityRefs = require('../cloudfunctions/mip-identity-api/lib/profile-ref') as {
      readProfileRef: (profileRef: string, appId: string, pepper: string) => string
    }
    const issuers = [
      require('../cloudfunctions/mip-events-api/lib/profile-ref'),
      require('../cloudfunctions/mip-opportunities-api/lib/profile-ref'),
    ] as Array<{ createProfileRef: (identity: { appId: string, userId: string }, pepper: string) => string }>
    const appId = 'wx-public-profile-test'
    const userId = '10000000-0000-4000-8000-000000000001'
    const pepper = 'cross-function-profile-ref-pepper-more-than-32-characters'
    for (const issuer of issuers) {
      const profileRef = issuer.createProfileRef({ appId, userId }, pepper)
      expect(identityRefs.readProfileRef(profileRef, appId, pepper)).toBe(userId)
      expect(() => identityRefs.readProfileRef(profileRef, 'another-app', pepper)).toThrow('PUBLIC_PROFILE_NOT_FOUND')
    }
  })

  it('sanitizes the public profile transport instead of forwarding extra identity fields', async () => {
    const profileRef = `p1.${'a'.repeat(16)}.${'b'.repeat(48)}.${'c'.repeat(22)}`
    const gateway = createMipIdentityGateway({
      async invoke() {
        return {
          ok: true,
          data: {
            profileRef,
            isSelf: false,
            nickname: '公开用户',
            userKind: 'PLAYER',
            abilities: [{ label: '项目管理' }],
            userId: 'private-user-id',
            openid: 'private-openid',
            phoneNumber: 'private-phone',
          },
        }
      },
    })
    const result = await gateway.getPublicProfile(profileRef)
    expect(result).toEqual({
      profileRef,
      isSelf: false,
      nickname: '公开用户',
      userKind: 'PLAYER',
      abilities: [{ label: '项目管理' }],
    })
    expect(result).not.toHaveProperty('userId')
    expect(result).not.toHaveProperty('openid')
    expect(result).not.toHaveProperty('phoneNumber')
  })

  it('registers public profile and event participant pages in all route contracts', () => {
    const app = JSON.parse(source('src/app.json'))
    const project = JSON.parse(source('config/project.json'))
    const runtime = JSON.parse(source('config/runtime-pages.json'))
    const expected = [
      'packages/member/mip-public-profile/index',
      'packages/member/mip-events/participants/index',
    ]
    const appRoutes = new Set(app.subPackages.flatMap((pkg: { root: string, pages: string[] }) => (
      pkg.pages.map(page => `${pkg.root}/${page}`)
    )))
    const projectRoutes = new Set(project.routes.map((route: { pathName: string }) => route.pathName))
    const runtimeRoutes = new Set(runtime.routes.map((route: { path: string }) => route.path))
    for (const route of expected) {
      expect(appRoutes.has(route)).toBe(true)
      expect(projectRoutes.has(route)).toBe(true)
      expect(runtimeRoutes.has(route)).toBe(true)
    }
    expect(runtime.routeCount).toBe(runtime.routes.length)
  })

  it('uses MIP modules and protects detail interactions before mutations', () => {
    const participantPage = source('src/packages/member/mip-events/participants/index.ts')
    const profilePage = source('src/packages/member/mip-public-profile/index.ts')
    expect(participantPage).toContain('mipEventsModule.listPublicParticipants')
    expect(profilePage).toContain('opportunityModule.getPublicProfile')
    expect(profilePage).toContain('mipIdentityModule.resolveProfileCardScene')
    expect(profilePage).toContain('profileInterestMutations.mutate')
    expect(`${participantPage}\n${profilePage}`).not.toMatch(/membershipModule|wx\.cloud/)

    // 机会详情的「我想合作」是唯一保留 INTERACT 门禁的详情互动。
    const opportunityDetail = source('src/packages/member/mip-opportunities/detail/index.ts')
    expect(opportunityDetail).toContain('action: \'INTERACT\'')
    expect(opportunityDetail).toContain('consumePendingResume')
    // G1：详情页「+N想合作」跳独立名单页，公开档案入口随名单卡迁移到该页
    // （详情 → 想跟TA合作 → 公开档案）。
    for (const detail of [
      'src/packages/member/mip-opportunity-cooperators/index.ts',
    ]) {
      expect(source(detail)).toContain('/packages/member/mip-public-profile/index?profileRef=')
    }
    // MIW-48：合作卡详情访客视角同样展示作者头（2026-10-07 拍板：与本人的差异仅在
    // 本人态吸底「编辑」）；作者上下文跳转与「感兴趣」仍收敛在玩家档案页。
    // 超级案例 / 合作卡详情（访客视角）没有互动 bar 和发布人模块，不再承载 INTERACT 门禁；
    // 合作卡的感兴趣统一收敛在玩家档案页（figma 2058_12247）。
    for (const detail of [
      'src/packages/member/mip-cases/detail/index.ts',
      'src/packages/member/mip-cooperation/detail/index.ts',
    ]) {
      const code = source(detail)
      expect(code).not.toContain('action: \'INTERACT\'')
      expect(code).not.toContain('profileInterestMutations')
      expect(code).not.toContain('consumePendingResume')
    }
    // 作者头不做本人/访客视角门禁（门禁只在吸底操作与长按删除）
    const coopDetail = source('src/packages/member/mip-cooperation/detail/index.wxml')
    expect(coopDetail).toContain('wx:if="{{item.author}}"')
    expect(coopDetail).not.toContain('wx:if="{{item.mine}}" class="flex items-center"')
  })

  it('keeps the compact summary with the level pill and drops the details module (MIW-29)', () => {
    const view = source('src/packages/member/mip-public-profile/index.wxml')
    const production = view.slice(view.indexOf('<block wx:elif="{{profile}}">'))
    const summary = production.slice(0, production.indexOf('data-category="GUEST"'))
    // 头部徽标按 figma 1769_38198 显示等级（Lv.N），不再渲染玩家/嘉宾称号。
    expect(summary).toContain('{{profile.levelText}}')
    expect(summary).not.toContain('kindLabel')
    expect(summary).toContain('bind:tap="openProfileMore"')
    // MIW-29：合作卡/超级案例/相关机会三个 tab 下方不再有「个人资料」模块。
    expect(production).not.toContain('id="public-profile-details"')
    expect(production).not.toContain('个人资料')
    for (const field of ['identityDetailText', 'primaryCompanyLine', 'introduction', 'abilities', 'companies', 'organizations']) {
      expect(production).not.toContain(`{{profile.${field}}}`)
      expect(production).not.toContain(`wx:for="{{profile.${field}}}"`)
    }
    // 头像下四统计的第三项是心动值：收到的活动红心票（S9 口径），与「我的」页心动值卡同源，
    // 不再是档案「感兴趣」关系数；本人点击进心动值页（列表纯查看）。
    const page = source('src/packages/member/mip-public-profile/index.ts')
    expect(production).toContain('data-category="HEART" bind:tap="openOwnInfluence"')
    expect(production).toContain('心动值</text>')
    expect(production).toContain('influence ? influence.heartCount : \'—\'')
    expect(production).not.toContain('influence.interestCount')
    expect(page).toContain('category === \'HEART\'')
    expect(page).toContain('\'/packages/member/mip-hearts/index\'')
    expect(production).toContain('bind:tap="openOwnInfluence"')
    expect(production).toContain('bind:tap="openInterestList"')
  })

  it('keeps the two-part interest bar: attend pill only after opting in', () => {
    const view = source('src/packages/member/mip-public-profile/index.wxml')
    const production = view.slice(view.indexOf('<block wx:elif="{{profile}}">'))
    const stickyBar = production.slice(production.indexOf('<mip-sticky-actions'))
    const config = JSON.parse(source('src/packages/member/mip-public-profile/index.json'))
    // figma 1769_38198 底部两段式：左 mip-attend-pill（本人头像 + N感兴趣）只在已表态时渲染，
    // 右侧黄色「我感兴趣」常驻；胶囊点击走心动名单入口（J4-02b）。
    expect(config.usingComponents['mip-attend-pill']).toBe('/components/mip-attend-pill/index')
    expect(stickyBar).toContain('<mip-attend-pill count="{{interestPillCount}}" label="感兴趣" avatars="{{viewerAvatars}}" variant="dark" />')
    expect(stickyBar).toContain('wx:if="{{interestActive}}"')
    expect(stickyBar).toContain('bind:tap="openInterestList"')
    expect(stickyBar).toContain('{{interestActive ? \'已感兴趣\' : \'我感兴趣\'}}')
    expect(stickyBar).not.toContain('influence.interestCount + \'感兴趣\'')
  })

  it('switches the opportunities tab between published and referred lists (G4)', () => {
    const view = source('src/packages/member/mip-public-profile/index.wxml')
    const production = view.slice(view.indexOf('<block wx:elif="{{profile}}">'))
    const opportunities = production.slice(production.indexOf('activeSection === \'opportunities\''))
    // figma 3359:5705：两个带计数的子 chips，激活黄底（同档案 chip 风格），默认发布。
    expect(opportunities).toContain('发布机会 {{opportunities.length}}')
    expect(opportunities).toContain('引荐机会 {{referrals.length}}')
    expect(opportunities.match(/data-tab="(published|referral)" bind:tap="changeOpportunityTab"/g) ?? []).toHaveLength(2)
    expect(opportunities).toContain(`opportunityTab === 'published' ? 'bg-brand text-on-brand' : 'bg-panel text-ink'`)
    // 两条列表同口径 mip-opportunity-card；空态文案区分；长按删除仅发布列表（引荐非本人所有）。
    expect(opportunities.match(/<mip-opportunity-card/g) ?? []).toHaveLength(2)
    expect(opportunities).toContain('bind:tap="openOpportunity" bind:longpress="deleteOwnOpportunity"')
    const referralBlock = opportunities.slice(opportunities.indexOf('<block wx:else>'))
    expect(referralBlock).toContain('bind:tap="openOpportunity"')
    expect(referralBlock).not.toContain('bind:longpress')
    expect(opportunities).toContain('暂无招募中的机会')
    expect(opportunities).toContain('暂无引荐机会')
    const page = source('src/packages/member/mip-public-profile/index.ts')
    expect(page).toContain('referrals: aggregate.referrals.map(presentProfileOpportunity)')
    expect(page).toContain(`opportunityTab: 'published'`)
    expect(page).toContain(`opportunityTab: tab`)
  })
})
