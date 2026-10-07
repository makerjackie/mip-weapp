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
    expect(componentTemplate).toContain('item.primaryPositioning')
    expect(componentTemplate).toContain('item.primaryTargetSummary')
    expect(componentTemplate).toContain('wx:key="talentKey"')
    expect(componentTemplate).toContain('data-profile-ref="{{item.profileRef}}"')
    expect(componentTemplate).toContain('state === \'loading\'')
    expect(componentTemplate).toContain('state === \'error\'')
    expect(componentTemplate).toContain('没有找到人才')
    expect(componentTemplate).toContain('确认筛选')
    expect(componentTemplate).toContain('<mip-talent-card')
    expect(componentTemplate).toContain('role-names="{{item.roleNames}}"')
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
