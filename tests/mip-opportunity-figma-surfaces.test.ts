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

    // MIW-31:合作地点/合作角色/能力预设不再手写品牌底 pill,统一走 DS chip。
    expect(filterSurface).toContain('<mip-tag-chip label="不限" active="{{draftLocationPreset === \'ALL\'}}" />')
    expect(filterSurface).toContain('<mip-tag-chip label="{{item.name}}" active="{{draftRoleKey === item.key}}" />')
    expect(filterSurface).toContain('<mip-tag-chip label="{{item.label}}" active="{{item.selected}}" />')
    expect(filterSurface).not.toContain('bg-brand px-4 py-2')

    for (const binding of [
      'bindconfirm="onSearchConfirm"',
      'bind:change="changeCity"',
      'bind:tap="chooseLocationPreset"',
      'bind:tap="chooseRole"',
      'bind:tap="toggleIndustryPicker"',
      'bind:change="changeIndustry"',
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
    // MIW-31：整页筛选态仅归项目机会；人才合作面板内联在搜索行下方。
    expect(discovery).toContain('<block wx:elif="{{filterOpen && mode === \'opportunities\'}}">')
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
    expect(discoveryScript).not.toContain('expandedIndustryGroupId')
    expect(discovery).toContain('<mip-industry-selector groups="{{catalog.industryGroups}}"')
    expect(discovery).toContain('accordion="{{true}}"')
    expect(discovery).toContain('clear-label="不限"')
    expect(discovery).toContain('wx:if="{{moreFiltersOpen}}"')
    expect(discoveryScript).toContain('selectedLocation === \'NATIONAL\' ? \'全国\' : \'不限\'')
    expect(discoveryScript).toContain('locationFilterLabel: \'不限\'')
    expect(discoveryScript).toContain('this.data.mode === \'cooperation\' ? \'全国\' : \'不限\'')
  })

  // MIW-31（figma 2917_4875 机会-人才合作筛选）：面板落在 tab+搜索行下方而非整页替换，
  // 能力/行业 chips 与底部液态玻璃确认条全部走 DS 组件，已选计数为能力+行业之和。
  it('presents the cooperation filter below the search row with DS chips and a selected count', () => {
    const panelStart = discovery.indexOf('id="opportunities-cooperation-filter"')
    expect(panelStart).toBeGreaterThan(discovery.indexOf('id="opportunities-search-input"'))
    expect(panelStart).toBeGreaterThan(discovery.indexOf('id="opportunities-talent-tab"'))
    const panel = discovery.slice(panelStart, discovery.indexOf('id="opportunities-cooperation-filter-actions"'))

    expect(discovery).toContain('mode === \'cooperation\' && filterOpen')
    expect(panel).toContain('能力选择')
    expect(panel).toContain('行业选择')
    expect(panel).toContain('<mip-tag-chip label="不限" active="{{!draftAbilityTagIds.length}}" />')
    expect(panel).toContain('data-type="ability"')
    expect(panel).toContain('bind:tap="toggleTag"')
    expect(panel).toContain('<mip-industry-selector groups="{{catalog.industryGroups}}"')
    expect(panel).toContain('show-popular="{{true}}"')
    expect(panel).toContain('accordion="{{true}}"')
    expect(panel).toContain('clear-label="不限"')
    expect(panel).toContain('bind:tap="removeDraftIndustry"')
    expect(panel).toContain('已选 {{draftAbilityTagIds.length + draftIndustryTagIds.length}}')
    expect(panel).not.toContain('合作角色')
    expect(panel).not.toContain('城市分会')

    const actions = discovery.slice(discovery.indexOf('id="opportunities-cooperation-filter-actions"'))
    expect(actions).toContain('mip-liquid-glass')
    expect(actions).toContain('<mip-pill-button class="min-w-0 flex-1" variant="secondary" label="清除" bind:tap="resetFilters" />')
    expect(actions).toContain('<mip-pill-button class="min-w-0 flex-1" label="确定" bind:tap="applyFilters" />')
    // 面板打开时结果区让位，确认后回到列表。
    expect(discovery).toContain('<block wx:if="{{!filterOpen}}">')

    expect(discoveryScript).toContain('abilityTagIds: this.data.selectedAbilityTagIds')
    expect(discoveryScript).toContain('draftIndustryViewsOf(this.data.catalog, ids)')
    expect(source('src/modules/mip-cooperation/validation.ts')).toContain('abilityTagIds: uniqueIds(value.abilityTagIds, 8, \'能力标签\')')
    expect(source('src/modules/mip-cooperation/types.ts')).toContain('abilityTagIds?: string[]')
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
    // mip-pill-button 不透传 aria-pressed，合作态由文案切换（我想合作/取消合作意向）+ loading 表达。
    expect(detail).toContain('loading="{{acting}}"')
  })

  it('keeps detail content readable and every secondary state recoverable', () => {
    expect(detail).toContain('id="opportunity-detail-loading"')
    expect(detail).toContain('暂未填写项目介绍')
    // figma 1768_37369 访客视角：详情页只有顶部卡 + 项目介绍 + 底部 bar，
    // 团队成员 / 想合作入口行 / 评论与评价模块不再渲染。
    expect(detail).not.toContain('团队成员')
    expect(detail).not.toContain('评论与评价')
    expect(detail).not.toContain('人想合作')
    expect(detailScript).not.toContain('loadComments')
    expect(detail).toContain('<app-page-exit label="返回机会" />')
  })

  it('keeps the editor sequence and uses one standard primary bottom action', () => {
    expect(editor).toContain('准确的描述可以更容易帮你找到合作机会')
    expect(editor.indexOf('未选择时为全国')).toBe(-1)
    // figma 3359:6086：主营城市收起行文案与字段顺序对齐最新帧。
    expect(editor.indexOf('哪些城市有这个机会')).toBeGreaterThan(0)
    expect(editor.indexOf('机会类型')).toBeGreaterThan(0)
    expect(editor.indexOf('id="opportunity-field-types"')).toBeLessThan(editor.indexOf('id="opportunity-field-title"'))
    expect(editor.indexOf('id="opportunity-field-status"')).toBeLessThan(editor.indexOf('id="opportunity-field-visibility"'))
    expect(editor.indexOf('主营地区（选填）')).toBeGreaterThan(0)
    // 2026-10-07：「更多设置」折叠区删除后，封面即基础区最后一个字段。
    expect(editor.indexOf('项目封面（选填）')).toBeGreaterThan(editor.indexOf('id="opportunity-field-visibility"'))
    expect(editor).not.toContain('wx:if="{{advancedOpen}}"')
    expect(editor).toContain('id="opportunity-editor-fixed-actions"')
    // journey-review J4-04 ③：液态玻璃底部条（mip-sticky-actions 壳）+ 黄芯胶囊主按钮（mip-pill-button）。
    expect(editor).toContain('<mip-sticky-actions id="opportunity-editor-fixed-actions">')
    expect(editor).toContain(`label="{{editorMode === 'PUBLISHED' ? '保存修改' : '确认发布'}}"`)
    // MIW-50 客户确认（2026-10-07）：「保存草稿」按钮删除，表单只以发布收口。
    expect(editor).not.toContain('bind:tap="saveDraft"')
    expect(editor).not.toContain('<t-button')
    expect(editor).toContain('bind:tap="publish"')
    expect(editor).toContain('bind:tap="pasteAndRecognize"')
    expect(editor).not.toContain('openTeamPicker')
  })

  it('distinguishes create, draft edit and published edit behavior', () => {
    expect(editorConfig).toContain('"navigationBarTitleText": "发布机会"')
    expect(editorScript).toContain(`type OpportunityEditorMode = 'CREATE' | 'DRAFT' | 'PUBLISHED'`)
    expect(editorScript).toContain(`editorMode === 'CREATE' ? '发布机会' : editorMode === 'DRAFT' ? '编辑草稿' : '编辑机会'`)
    // MIW-50：草稿态专用操作条（editorMode !== 'PUBLISHED'）随「保存草稿」一起删除，
    // 草稿态与已发布态共用同一发布收口，仅按钮文案不同。
    expect(editor).not.toContain(`editorMode !== 'PUBLISHED'`)
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
    // journey-review J4-04 ④（figma 3359:6086）：「粘贴并识别」一键读剪贴板，
    // 识别后就地填入不跳页、不再弹预览层，也没有独立输入区。
    expect(editor).toContain('pasteRecognizing ? \'正在识别\' : \'粘贴并识别\'')
    expect(editor).toContain('bind:tap="pasteAndRecognize"')
    expect(editor).not.toContain('updatePasteText')
    expect(editorScript).toContain('applyPastedDraft(parsed.draft)')
    expect(editor).not.toContain('确认识别结果')
  })

  it('keeps media errors with the optional cover and save errors above the actions', () => {
    expect(editor).toContain('wx:if="{{coverMessage}}"')
    expect(editor).toContain('{{coverMessage}}')
    expect(editorScript).toContain('封面为选填，可以稍后补充。')
    expect(editor.indexOf('wx:if="{{coverMessage}}"')).toBeGreaterThan(editor.indexOf('项目封面（选填）'))
    expect(editor.indexOf('wx:if="{{message}}"')).toBeGreaterThan(editor.indexOf('项目封面（选填）'))
    expect(editor.indexOf('wx:if="{{message}}"')).toBeLessThan(editor.indexOf('id="opportunity-editor-fixed-actions"'))
  })

  it('returns edit saves to the opportunity detail; create keeps the J4-04 landing', () => {
    expect(editorScript).toContain('wx.redirectTo({')
    expect(editorScript).toContain('/packages/member/mip-opportunities/detail/index?id=')
    // MIW-50：编辑存量机会保存后必须落回该机会的详情页——栈里能找到本机会
    // 的详情就按 delta 返回（顺带清掉栈中夹层的旧编辑页），否则 redirectTo 兜底。
    expect(editorScript).toContain('wx.navigateBack({ delta: currentIndex - index })')
    expect(editorScript).toMatch(/const detailRoute = 'packages\/member\/mip-opportunities\/detail\/index'/)
    expect(editorScript).toMatch(/page\.route === detailRoute && page\.options\?\.id === result\.id/)
    // journey-review J4-04 + QZ2 复审：新建确认发布回上级页面（navigateBack 优先）；
    // 已发布机会可通过保存改为下架，服务端保留其版本与审核保护。
    expect(editorScript).toContain('项目已下架')
    expect(editorScript).toMatch(/if \(getCurrentPages\(\)\.length > 1\) \{\n {10}wx\.navigateBack\(\)/)
    expect(detailScript).toContain('if (this.data.item) {\n      void this.load()')
  })

  it('uses design tokens instead of page-local colour literals', () => {
    for (const view of [discovery, detail, editor]) {
      expect(view).not.toMatch(/#[\da-f]{3,8}|rgba\(/i)
      expect(view).toContain('bg-canvas')
    }
  })
})
