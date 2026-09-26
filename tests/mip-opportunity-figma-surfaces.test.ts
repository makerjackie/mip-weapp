import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')
}

describe('MIP opportunity Figma surfaces', () => {
  const discovery = source('src/pages/opportunities/index.wxml')
  const detail = source('src/packages/member/mip-opportunities/detail/index.wxml')
  const detailScript = source('src/packages/member/mip-opportunities/detail/index.ts')
  const editor = source('src/packages/member/mip-opportunities/editor/index.wxml')
  const editorScript = source('src/packages/member/mip-opportunities/editor/index.ts')
  const editorConfig = source('src/packages/member/mip-opportunities/editor/index.json')
  const opportunityCard = source('src/components/mip-opportunity-card/index.wxml')
  const opportunityCardStyles = source('src/components/mip-opportunity-card/index.wxss')
  const discoveryScript = source('src/pages/opportunities/index.ts')
  const discoveryStyles = source('src/pages/opportunities/index.wxss')

  it('keeps the discovery hierarchy and presents filters as a dedicated full-screen state', () => {
    expect(discovery).toContain('id="opportunities-status-bar"')
    expect(discovery).toContain('id="opportunities-custom-navigation"')
    expect(discovery).toContain('<app-top-safe-area id="opportunities-status-bar" />')
    expect(discovery).toContain('id="opportunities-filter-actions"')
    expect(discovery).toContain('id="opportunities-filter-page"')
    expect(discovery).toContain('bottom-[calc(env(safe-area-inset-bottom)+112rpx)]')
    expect(discovery).toContain('pb-[280rpx]')
    expect(discoveryStyles).toContain('padding-bottom: calc(280rpx + env(safe-area-inset-bottom) + 112rpx);')
    expect(discovery.indexOf('id="opportunities-filter-page"')).toBeLessThan(discovery.indexOf('id="opportunities-search-input"'))

    const filterSurface = discovery.slice(
      discovery.indexOf('id="opportunities-filter-page"'),
      discovery.indexOf('id="opportunities-filter-actions"'),
    )
    expect(filterSurface).not.toContain('bind:tap="openPeople"')
    expect(filterSurface).not.toContain('bind:tap="openMatching"')
    expect(filterSurface).not.toContain('bind:tap="openMine"')

    for (const binding of [
      'bindconfirm="onSearchConfirm"',
      'bind:change="changeCity"',
      'bind:tap="chooseLocationPreset"',
      'bind:tap="chooseRole"',
      'bind:tap="toggleIndustryPicker"',
      'bind:tap="toggleIndustryGroup"',
      'bind:tap="toggleTag"',
      'bind:tap="toggleMoreFilters"',
      'bind:tap="resetFilters"',
      'bind:tap="applyFilters"',
    ]) {
      expect(discovery).toContain(binding)
    }
  })

  it('keeps existing discovery content during refresh and stops list pagination behind filters', () => {
    expect(discoveryScript).toContain('preserveContent: this.data.state === \'ready\'')
    expect(discovery).toContain('class="opportunities-filter-panel')
    expect(discoveryScript).toContain('if (!this.data.filterOpen && this.data.nextCursor && !this.data.loadingMore)')
    expect(discovery).toContain('<block wx:elif="{{filterOpen}}">')
    expect(discovery).toContain('<block wx:else>')
  })

  it('uses one location concept and progressive disclosure for lower-frequency filters', () => {
    expect(discovery).toContain('合作地点')
    expect(discovery).not.toContain('合作范围')
    expect(discovery).toContain('data-preset="ALL"')
    expect(discovery).toContain('data-preset="REMOTE"')
    expect(discovery).toContain('data-preset="NATIONAL"')
    expect(discovery).toContain('data-preset="CITY"')
    expect(discovery).toContain('clear-label="全部城市"')
    expect(discovery).toContain('wx:if="{{industryPickerOpen}}"')
    expect(discovery).toContain('wx:if="{{expandedIndustryGroupId === group.id}}"')
    expect(discovery).toContain('wx:if="{{moreFiltersOpen}}"')
    expect(discoveryScript).toContain('selectedLocation === \'NATIONAL\' ? \'全国\' : \'不限\'')
    expect(discoveryScript).toContain('locationFilterLabel: \'不限\'')
    expect(discoveryScript).toContain('this.data.mode === \'cooperation\' ? \'全国\' : \'不限\'')
  })

  it('maps the location preset to one backend scope and keeps search independent from filter reset', () => {
    const chooseLocation = discoveryScript.slice(
      discoveryScript.indexOf('  chooseLocationPreset('),
      discoveryScript.indexOf('  toggleIndustryPicker('),
    )
    const reset = discoveryScript.slice(
      discoveryScript.indexOf('  resetFilters('),
      discoveryScript.indexOf('  applyFilters('),
    )
    const apply = discoveryScript.slice(
      discoveryScript.indexOf('  applyFilters('),
      discoveryScript.indexOf('  clearAppliedFilters('),
    )

    expect(chooseLocation).toContain('draftLocationTypes: locationTypesForPreset(preset)')
    expect(chooseLocation).toContain('const cityId = keepsCity ? this.data.draftOpportunityCityTagId : \'\'')
    expect(reset).not.toContain('keywordInput:')
    expect(apply).toContain('this.data.draftLocationPreset === \'CITY\' ? this.data.draftOpportunityCityTagId : \'\'')
    expect(apply).toContain('locationTypesForPreset(this.data.draftLocationPreset)')
    expect(apply.match(/loadContent\(true\)/g)).toHaveLength(1)
  })

  it('matches the 351 by 176 opportunity-card silhouette with the AttendPill referral contract', () => {
    expect(discovery).toContain('<mip-opportunity-card')
    // 运行时验收（2026-09-22）：卡片 avatars 绑 presenter 保底数组 avatarViews，不再透传服务端原值。
    expect(discovery).toContain('avatars="{{item.avatarViews}}"')
    expect(opportunityCardStyles).toContain('height: 352rpx;')
    expect(opportunityCardStyles).toContain('width: 240rpx;')
    expect(opportunityCardStyles).toContain('height: 320rpx;')
    // AttendPill (skill contract business.jsx): the opportunity card delegates the
    // fixed 116x28 yellow pill to the shared design-system component. journey-review
    // D-05 renames the aggregate to 想合作 via the optional pillLabel prop.
    expect(opportunityCard).toContain('<mip-attend-pill')
    expect(opportunityCard).toContain('label="{{pillLabel}}"')
    expect(source('src/components/mip-opportunity-card/index.ts')).toContain(`pillLabel: { type: String, value: '想合作' }`)
    expect(discovery).toContain('pill-label="想合作"')
    expect(source('src/components/mip-attend-pill/index.wxss')).toContain('width: 232rpx;')
    expect(source('src/components/mip-attend-pill/index.wxss')).toContain('height: 56rpx;')
  })

  it('shows stable discovery loading, empty, error, pagination and real-content states', () => {
    expect(discovery).toContain('state === \'loading\'')
    expect(discovery).toContain('state === \'error\'')
    expect(discovery).toContain('没有找到相关机会')
    expect(discovery).toContain('没有找到人才')
    expect(discovery).toContain('loadingMore')
    expect(discovery).toContain('wx:for="{{opportunities}}"')
    expect(discovery).toContain('wx:for="{{cooperationTalents}}"')
    expect(discovery).toContain('<mip-talent-card')
    expect(discovery).toContain('role-names="{{item.roleNames}}"')
    expect(discovery).toContain('data-profile-ref="{{item.profileRef}}"')
  })

  it('keeps four detail facts and publication time without duplicating the cooperation pill', () => {
    const detailCard = detail.match(/<mip-opportunity-card\b[^>]*\/>/)?.[0]
    expect(detailCard).toContain('variant="detail"')
    expect(detailCard).toContain('city-text="{{item.city.label || \'\'}}"')
    expect(detailCard).toContain('region-text="{{item.regionText || \'\'}}"')
    expect(detailCard).toContain('published-text="{{publishedText}}"')
    expect(detailCard).not.toContain('referral-count=')
    expect(discovery).not.toContain('variant="detail"')
    expect(opportunityCard).toMatch(/<mip-attend-pill\s+wx:if="\{\{variant !== 'detail'\}\}"/)
    // Unlike a fixed-height list row, a detail can wrap multiple type tags
    // and a complete publication date without cropping its bottom line.
    expect(opportunityCardStyles).toMatch(/\.mip-opportunity-card--detail\s*\{[^}]*height: auto;[^}]*min-height: 352rpx;/)
    expect(opportunityCardStyles).toMatch(/\.mip-opportunity-card--detail \.mip-opportunity-card__footer\s*\{[^}]*flex-wrap: wrap;/)
  })

  it('keeps one cooperation action and a separate read-only participant list', () => {
    expect(detail).toContain('bind:tap="cooperationIntent"')
    expect(detail).toContain('id="opportunity-cooperation-actions"')
    expect(detail).toContain('id="opportunity-owner-actions"')
    expect(detail).toContain('取消合作意向')
    expect(detail).toContain('bind:tap="openCooperators"')
    expect(detail).toContain('aria-pressed="{{item.cooperationActive}}"')
  })

  it('keeps detail content readable and every secondary state recoverable', () => {
    expect(detail).toContain('id="opportunity-detail-loading"')
    expect(detail).toContain('暂未填写项目介绍')
    expect(detail).toContain('暂无评论与评价')
    expect(detail).toContain('bind:tap="retryComments"')
    expect(detail).toContain('bind:tap="startComment"')
    expect(detailScript).toContain('retryComments()')
    expect(detailScript).toContain('commentsState: reset || !this.data.comments.length ? \'error\' : \'ready\'')
    expect(detail).toContain('<app-page-exit label="返回机会" />')
  })

  it('keeps the editor sequence and uses one standard primary bottom action', () => {
    expect(editor).toContain('准确的描述可以更容易帮你找到合作机会')
    expect(editor.indexOf('未选择时为全国')).toBe(-1)
    expect(editor.indexOf('请选择主营城市')).toBeGreaterThan(0)
    expect(editor.indexOf('主营地区（选填）')).toBeGreaterThan(0)
    expect(editor.indexOf('项目封面（选填）')).toBeLessThan(editor.indexOf('更多设置'))
    expect(editor).toContain('wx:if="{{advancedOpen}}"')
    expect(editor).toContain('id="opportunity-editor-fixed-actions"')
    expect(editor).toContain('bottom-[calc(env(safe-area-inset-bottom)+16rpx)]')
    // journey-review J4-04 ③：液态玻璃底部条 + 黄芯胶囊主按钮。
    expect(editor).toContain('mip-liquid-glass')
    expect(editor).toContain(`bind:tap="publish">{{editorMode === 'PUBLISHED' ? '保存修改' : '确认发布'}}</view>`)
    expect(editor).toContain('bind:tap="saveDraft"')
    expect(editor).toContain('bind:tap="publish"')
    expect(editor).toContain('bind:tap="readClipboardIntoPaste"')
    expect(editor).toContain('bind:tap="openTeamPicker"')
  })

  it('distinguishes create, draft edit and published edit behavior', () => {
    expect(editorConfig).toContain('"navigationBarTitleText": "发布机会"')
    expect(editorScript).toContain(`type OpportunityEditorMode = 'CREATE' | 'DRAFT' | 'PUBLISHED'`)
    expect(editorScript).toContain(`editorMode === 'CREATE' ? '发布机会' : editorMode === 'DRAFT' ? '编辑草稿' : '编辑机会'`)
    expect(editor).toContain(`editorMode !== 'PUBLISHED'`)
    expect(editor).toContain(`editorMode === 'PUBLISHED' ? '保存修改' : '确认发布'`)
  })

  it('uses AI recognition with a bounded local fallback and inline confirmation', () => {
    expect(editorScript).toContain('purpose: \'OPPORTUNITY\'')
    expect(editorScript).toContain('mipAiModule.createTextDraft')
    expect(editorScript).toContain('loadAiEditorDraft(this.data.aiDraftId, \'OPPORTUNITY\')')
    expect(editorScript).toContain('confirmedAiDraftId: aiSource.confirmation.draftId')
    expect(editorScript).toContain('parseOpportunityAiDraft')
    expect(editorScript).toContain('parseOpportunityText(source, this.data.cityOptions)')
    expect(editorScript).toContain('aiConfirmation: {')
    expect(editorScript).toContain('已使用智能识别，请核对结果。')
    expect(editorScript).toContain('智能识别暂时不可用，已使用基础识别，请重点核对。')
    // journey-review J4-04 ④：确认为输入区内嵌按钮，识别后就地填入不跳页、不再弹预览层。
    expect(editor).toContain('pasteRecognizing ? \'正在智能识别\' : \'粘贴整段文字，自动识别\'')
    expect(editor).toContain('bindinput="updatePasteText"')
    expect(editor).toContain('bind:tap="recognizePastedText">确认')
    expect(editorScript).toContain('applyPastedDraft(parsed.draft)')
    expect(editor).not.toContain('确认识别结果')
  })

  it('keeps media errors with the optional cover and save errors above the actions', () => {
    expect(editor).toContain('wx:if="{{coverMessage}}"')
    expect(editor).toContain('{{coverMessage}}')
    expect(editorScript).toContain('封面为选填，可以稍后补充。')
    expect(editor.indexOf('wx:if="{{coverMessage}}"')).toBeLessThan(editor.indexOf('更多设置'))
    expect(editor.indexOf('bind:tap="saveDraft"')).toBeLessThan(editor.indexOf('wx:if="{{message}}"'))
    expect(editor.indexOf('wx:if="{{message}}"')).toBeLessThan(editor.indexOf('id="opportunity-editor-fixed-actions"'))
  })

  it('opens new saves on detail and refreshes detail after returning from an edit', () => {
    expect(editorScript).toContain('wx.redirectTo({')
    expect(editorScript).toContain('/packages/member/mip-opportunities/detail/index?id=')
    // journey-review J4-04 + QZ2 复审：确认发布回机会列表（navigateBack 优先）；
    // 已发布机会可通过保存改为下架，服务端保留其版本与审核保护。
    expect(editorScript).toContain('项目已下架')
    expect(editorScript).toMatch(/if \(pages\.length > 1\) \{\n {10}wx\.navigateBack\(\)/)
    expect(detailScript).toContain('if (this.data.item) {\n      void this.load()')
  })

  it('uses design tokens instead of page-local colour literals', () => {
    for (const view of [discovery, detail, editor]) {
      expect(view).not.toMatch(/#[\da-f]{3,8}|rgba\(/i)
      expect(view).toContain('bg-canvas')
    }
  })
})
