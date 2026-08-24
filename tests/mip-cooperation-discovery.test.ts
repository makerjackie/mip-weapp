import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

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

  it('renders cooperation cards from card and author fields with explicit states', () => {
    for (const template of [
      read('src/packages/member/mip-cooperation/list/index.wxml'),
      read('src/pages/opportunities/index.wxml'),
    ]) {
      expect(template).toContain('item.author.nickname')
      expect(template).toContain('item.positioning')
      expect(template).toContain('item.targetSummary')
      expect(template).toContain('state === \'loading\'')
      expect(template).toContain('state === \'error\'')
      expect(template).toContain('没有找到合作卡')
      expect(template).toContain('确认筛选')
    }
  })

  it('sends all applied cooperation filters and a stable cursor through the module', () => {
    const module = read('src/modules/mip-cooperation/client.ts')
    const page = read('src/packages/member/mip-cooperation/list/index.ts')
    expect(module).toContain('normalizeCooperationCardFilter(filter)')
    expect(page).toContain('keyword: this.data.appliedKeyword')
    expect(page).toContain('branchId: this.data.selectedBranchId || undefined')
    expect(page).toContain('roleKey: this.data.selectedRoleKey || undefined')
    expect(page).toContain('industryTagIds: this.data.selectedIndustryTagIds')
    expect(page).toContain('cursor: reset ? undefined : this.data.nextCursor || undefined')
  })
})
