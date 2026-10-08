import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  mergeCooperationTalents,
  parseCooperationTalentPage,
} from '../src/modules/mip-cooperation/validation'

const talentKey = `mctk1.${'A'.repeat(43)}`
const profileRef = `p1.${'A'.repeat(16)}.${'B'.repeat(48)}.${'C'.repeat(22)}`
const secondProfileRef = `p1.${'D'.repeat(16)}.${'E'.repeat(48)}.${'F'.repeat(22)}`

function talent(overrides: Record<string, unknown> = {}) {
  return {
    talentKey,
    profileRef,
    author: { nickname: '成员甲', cityName: '深圳' },
    joinedAt: '2026-06-24T08:00:00.000Z',
    cards: [{
      id: '30000000-0000-4000-8000-000000000002',
      roleKey: 'strategist',
      positioning: '品牌策划与产品方向',
      targetSummary: '完成三个合作项目',
      abilityScores: { strategy_planning: 5 },
      publishedAt: '2026-08-24T08:00:00.000Z',
    }],
    ...overrides,
  }
}

function read(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function method(source: string, start: string, end: string) {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from + start.length)
  expect(from).toBeGreaterThanOrEqual(0)
  expect(to).toBeGreaterThan(from)
  return source.slice(from, to)
}

describe('MIP cooperation discovery experience', () => {
  it('keeps filter choices as drafts until the user confirms', () => {
    // 2026-10-07：人才名录独立页删除后，草稿式筛选口径全部落在机会页的人才合作 Tab。
    const rootPage = read('src/pages/opportunities/index.ts')
    expect(method(rootPage, '  chooseRole(', '  toggleTag(')).not.toContain('loadContent(')
    expect(method(rootPage, '  toggleTag(', '  resetFilters(')).not.toContain('loadContent(')
    expect(method(rootPage, '  resetFilters(', '  applyFilters(')).not.toContain('loadContent(')
    expect(method(rootPage, '  applyFilters(', '  clearAppliedFilters(')).toContain('loadContent(true)')
  })

  it('renders one talent per row with aggregated role cards and explicit states', () => {
    const componentTemplate = read('src/pages/opportunities/index.wxml')
    expect(componentTemplate).toContain('item.author.nickname')
    // MIW-58 横版人才卡：三标签行 + 一句话介绍 + 角色/邀请人 footer（figma 1768_37534）。
    expect(componentTemplate).toContain('level-text="{{item.levelText}}"')
    expect(componentTemplate).toContain('tags="{{item.profileTags}}"')
    expect(componentTemplate).toContain('supporting-text="{{item.author.headline || \'\'}}"')
    expect(componentTemplate).toContain('medals="{{item.medals}}"')
    expect(componentTemplate).toContain('inviter-kind="{{item.inviterKind}}"')
    expect(componentTemplate).toContain('wx:key="talentKey"')
    expect(componentTemplate).toContain('data-profile-ref="{{item.profileRef}}"')
    expect(componentTemplate).toContain('state === \'loading\'')
    expect(componentTemplate).toContain('state === \'error\'')
    expect(componentTemplate).toContain('没有找到人才')
    expect(componentTemplate).toContain('确认筛选')
    expect(componentTemplate).toContain('<mip-talent-card')
    expect(componentTemplate).toContain('role-names="{{item.roleNames}}"')
  })

  // MIW-58 最新稿对齐（figma 2917_4875 面板 / 2917_4785 行业二级页 / 1768_37534 按钮）：
  // 筛选按钮关灰开黄、行业全量手风琴进页内全屏二级页、面板留已选行+热门快选、计数 n/8。
  it('aligns the cooperation filter shell with the latest figma frames', () => {
    const componentTemplate = read('src/pages/opportunities/index.wxml')
    const page = read('src/pages/opportunities/index.ts')
    expect(componentTemplate).toContain('placeholder="搜索"')
    expect(componentTemplate).toContain(`color="{{filterOpen ? 'var(--color-brand)' : 'var(--color-muted)'}}"`)
    expect(componentTemplate).toContain(`{{filterOpen ? 'text-brand' : 'text-muted'}}`)
    expect(componentTemplate).not.toContain('{{appliedFilterCount}}')
    expect(componentTemplate).toContain('bind:tap="openIndustryPage"')
    expect(componentTemplate).toContain('已选 {{draftIndustryTagIds.length}}/8')
    expect(componentTemplate).toContain('class="opportunities-industry-page"')
    expect(componentTemplate).toContain('show-popular="{{false}}"')
    expect(componentTemplate).toContain('bind:tap="toggleDraftIndustry"')
    expect(componentTemplate).toContain('bind:tap="clearDraftIndustries"')
    expect(componentTemplate).toContain('catch:tap="removeDraftIndustry"')
    expect(page).toContain('const INDUSTRY_MAX_COUNT = 8')
    expect(page).toContain('industryPageOpen: false')
    expect(read('src/pages/opportunities/index.wxss')).toMatch(/\.opportunities-industry-page\s*\{[^}]*z-index: 10000;/)
  })

  it('sends all applied cooperation filters and a stable cursor through the module', () => {
    const module = read('src/modules/mip-cooperation/client.ts')
    const transport = read('src/modules/mip-opportunities/transport.ts')
    const server = read('cloudfunctions/mip-opportunities-api/index.js')
    const page = read('src/pages/opportunities/index.ts')
    expect(module).toContain('normalizeCooperationCardFilter(filter)')
    expect(module).toContain('callOpportunityApi<CooperationCardPage>(\'listCooperationCards\'')
    expect(module).toContain('callOpportunityApi<CooperationTalentPage>(\'listCooperationTalents\'')
    expect(module).toContain('parseCooperationTalentPage(page)')
    expect(transport).toContain('\'listCooperationTalents\'')
    expect(server).toContain('case \'listCooperationTalents\': return await canBrowseTalents(database, caller)')
    expect(server).toContain('? listCooperationTalents(database, caller, event.filter) : { items: [] }')
    expect(page).toContain('cooperationModule.listTalents(')
    expect(page).toContain('mergeCooperationTalents(this.data.cooperationTalents, talents)')
    expect(page).toContain('keyword: this.data.keyword')
    expect(page).toContain('branchId: this.data.selectedCooperationBranchId || undefined')
    expect(page).toContain('roleKey: this.data.selectedRoleKey || undefined')
    expect(page).toContain('industryTagIds: this.data.selectedIndustryTagIds')
    expect(page).toContain('cursor: reset ? undefined : this.data.nextCursor || undefined')
    expect(page).toContain('/packages/member/mip-public-profile/index?profileRef=')
  })

  it('accepts a strict talent DTO and normalizes its timestamps', () => {
    expect(parseCooperationTalentPage({
      items: [talent()],
      nextCursor: `mct1.${'A'.repeat(16)}.${'B'.repeat(120)}.${'C'.repeat(22)}`,
    })).toMatchObject({
      items: [{ talentKey, profileRef, joinedAt: '2026-06-24T08:00:00.000Z' }],
    })
  })

  // MIW-58 横版人才卡：身份状态/等级/佩戴勋章/邀请人随 author 下发，缺省省略不造值。
  it('keeps the talent-card public details attached to the author', () => {
    const [item] = parseCooperationTalentPage({
      items: [talent({
        author: {
          nickname: '成员甲',
          cityName: '深圳',
          identityStatus: '公司在职',
          level: { number: 2, name: 'Lv2' },
          badges: [
            { id: '50000000-0000-4000-8000-000000000001', name: '城主', imageUrl: 'badge-1.png' },
            { id: '50000000-0000-4000-8000-000000000002', name: '公会长' },
          ],
          inviter: { sourceType: 'PLATFORM', displayName: 'MIP 平台' },
        },
      })],
    }).items
    expect(item.author).toMatchObject({
      identityStatus: '公司在职',
      level: { number: 2, name: 'Lv2' },
      badges: [
        { id: '50000000-0000-4000-8000-000000000001', name: '城主', imageUrl: 'badge-1.png' },
        { id: '50000000-0000-4000-8000-000000000002', name: '公会长' },
      ],
      inviter: { sourceType: 'PLATFORM', displayName: 'MIP 平台' },
    })
  })

  it.each([
    { author: { nickname: '成员甲', level: { number: 0, name: 'Lv0' } } },
    { author: { nickname: '成员甲', level: { number: 2 } } },
    { author: { nickname: '成员甲', badges: [{ id: '50000000-0000-4000-8000-000000000001' }] } },
    { author: { nickname: '成员甲', badges: [{ id: '50000000-0000-4000-8000-000000000001', name: '城主' }, { id: '50000000-0000-4000-8000-000000000001', name: '城主' }] } },
    { author: { nickname: '成员甲', inviter: { sourceType: 'GUEST', displayName: 'x' } } },
    { author: { nickname: '成员甲', inviter: { sourceType: 'USER' } } },
  ])('rejects malformed public-detail fields without partial items', (override) => {
    expect(() => parseCooperationTalentPage({ items: [talent(override)] })).toThrow('人才服务返回了无效响应')
  })

  it.each([
    { items: [{ ...talent(), userId: '40000000-0000-4000-8000-000000000002' }] },
    { items: [talent({ talentKey: '40000000-0000-4000-8000-000000000002' })] },
    { items: [talent({ profileRef: 'public-user-id' })] },
    { items: [talent({ cards: [] })] },
    { items: [talent({ cards: [{ ...talent().cards[0], roleKey: 'owner' }] })] },
    { items: [talent({ cards: [{ ...talent().cards[0], abilityScores: { unknown: 5 } }] })] },
    { items: [talent(), talent()] },
    { items: [talent(), talent({ talentKey: `mctk1.${'D'.repeat(43)}` })] },
    { items: [talent()], nextCursor: 'legacy-cursor' },
  ])('rejects a malformed talent page without returning partial items', (value) => {
    expect(() => parseCooperationTalentPage(value)).toThrow('人才服务返回了无效响应')
  })

  it('deduplicates a talent repeated by a later page and rejects profile collisions', () => {
    const first = parseCooperationTalentPage({ items: [talent()] }).items
    const repeated = parseCooperationTalentPage({
      items: [talent({ profileRef: secondProfileRef })],
    }).items
    expect(mergeCooperationTalents(first, repeated)).toEqual(first)

    const collision = parseCooperationTalentPage({
      items: [talent({ talentKey: `mctk1.${'D'.repeat(43)}` })],
    }).items
    expect(() => mergeCooperationTalents(first, collision)).toThrow('人才服务返回了无效响应')
  })
})
