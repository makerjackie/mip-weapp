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
    const page = read('src/packages/member/mip-cooperation/list/index.ts')
    expect(method(page, '  chooseRole(', '  toggleIndustry(')).not.toContain('this.load(')
    expect(method(page, '  toggleIndustry(', '  resetFilterDraft(')).not.toContain('this.load(')
    expect(method(page, '  resetFilterDraft(', '  applyFilters(')).not.toContain('this.load(')
    expect(method(page, '  applyFilters(', '  clearAppliedFilters(')).toContain('this.load(true)')

    const rootPage = read('src/pages/opportunities/index.ts')
    expect(method(rootPage, '  chooseRole(', '  toggleTag(')).not.toContain('loadContent(')
    expect(method(rootPage, '  toggleTag(', '  resetFilters(')).not.toContain('loadContent(')
    expect(method(rootPage, '  resetFilters(', '  applyFilters(')).not.toContain('loadContent(')
    expect(method(rootPage, '  applyFilters(', '  clearAppliedFilters(')).toContain('loadContent(true)')
  })

  it('renders one talent per row with aggregated role cards and explicit states', () => {
    const legacyTemplate = read('src/packages/member/mip-cooperation/list/index.wxml')
    const componentTemplate = read('src/pages/opportunities/index.wxml')
    for (const template of [legacyTemplate, componentTemplate]) {
      expect(template).toContain('item.author.nickname')
      expect(template).toContain('item.primaryPositioning')
      expect(template).toContain('item.primaryTargetSummary')
      expect(template).toContain('wx:key="talentKey"')
      expect(template).toContain('data-profile-ref="{{item.profileRef}}"')
      expect(template).toContain('state === \'loading\'')
      expect(template).toContain('state === \'error\'')
      expect(template).toContain('没有找到人才')
      expect(template).toContain('确认筛选')
    }
    expect(legacyTemplate).toContain('wx:for="{{item.cards}}"')
    expect(componentTemplate).toContain('<mip-talent-card')
    expect(componentTemplate).toContain('role-names="{{item.roleNames}}"')
  })

  it('sends all applied cooperation filters and a stable cursor through the module', () => {
    const module = read('src/modules/mip-cooperation/client.ts')
    const transport = read('src/modules/mip-opportunities/transport.ts')
    const server = read('cloudfunctions/mip-opportunities-api/index.js')
    const page = read('src/packages/member/mip-cooperation/list/index.ts')
    expect(module).toContain('normalizeCooperationCardFilter(filter)')
    expect(module).toContain('callOpportunityApi<CooperationCardPage>(\'listCooperationCards\'')
    expect(module).toContain('callOpportunityApi<CooperationTalentPage>(\'listCooperationTalents\'')
    expect(module).toContain('parseCooperationTalentPage(page)')
    expect(transport).toContain('\'listCooperationTalents\'')
    expect(server).toContain('case \'listCooperationTalents\': return listCooperationTalents')
    expect(page).toContain('cooperationModule.listTalents({')
    expect(page).toContain('mergeCooperationTalents(this.data.talents, talents)')
    expect(page).toContain('keyword: this.data.appliedKeyword')
    expect(page).toContain('branchId: this.data.selectedBranchId || undefined')
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
