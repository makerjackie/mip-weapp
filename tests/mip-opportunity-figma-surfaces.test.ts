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
  const opportunityCard = source('src/components/opportunity-card/index.wxml')
  const opportunityCardStyles = source('src/components/opportunity-card/index.wxss')
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
    expect(discovery).toContain('<block wx:if="{{filterOpen}}">')
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

  it('matches the 351 by 176 opportunity-card silhouette without inventing referral avatars', () => {
    expect(discovery).toContain('<mip-opportunity-card')
    expect(opportunityCardStyles).toContain('height: 352rpx;')
    expect(opportunityCardStyles).toContain('width: 240rpx;')
    expect(opportunityCardStyles).toContain('height: 320rpx;')
    expect(opportunityCard).toContain('+{{referralCount}}引荐')
    expect(discovery).not.toContain('item.referralAvatars')
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

  it('keeps one Figma-aligned primary referral action and a separate interest state', () => {
    expect(detail.match(/bind:tap="toggleReferral"/g)).toHaveLength(1)
    expect(detail).toContain('id="opportunity-referral-actions"')
    expect(detail).toContain('id="opportunity-owner-actions"')
    expect(detail).toContain('bind:tap="changeReferralTarget"')
    expect(detail).toContain('bind:tap="cancelReferral"')
    expect(detail).toContain('bind:tap="toggleInterest"')
    expect(detail).toContain('aria-pressed="{{item.interestActive}}"')
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
    expect(editor.indexOf('未选择时为全国')).toBeLessThan(editor.indexOf('cityGridOptions'))
    expect(editor.indexOf('机会封面')).toBeLessThan(editor.indexOf('更多设置'))
    expect(editor).toContain('wx:if="{{advancedOpen}}"')
    expect(editor).toContain('id="opportunity-editor-fixed-actions"')
    expect(editor).toContain('bottom-[calc(env(safe-area-inset-bottom)+16rpx)]')
    expect(editor).toContain('<t-button block size="large" theme="primary" loading="{{saving}}" disabled="{{saving || coverUploading}}" bind:tap="publish">')
    expect(editor).not.toContain('id="opportunity-editor-fixed-actions" class="mip-member-fixed-inset fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+16rpx)] z-20 flex h-[112rpx] items-center rounded-full border border-brand bg-brand-soft p-2"')
    expect(editor).toContain('bind:tap="saveDraft"')
    expect(editor).toContain('bind:tap="publish"')
    expect(editor).toContain('bind:tap="pasteAndRecognize"')
    expect(editor).toContain('bind:tap="openTeamPicker"')
  })

  it('distinguishes create, draft edit and published edit behavior', () => {
    expect(editorConfig).toContain('"navigationBarTitleText": "发布机会"')
    expect(editorScript).toContain(`type OpportunityEditorMode = 'CREATE' | 'DRAFT' | 'PUBLISHED'`)
    expect(editorScript).toContain(`editorMode === 'CREATE' ? '发布机会' : editorMode === 'DRAFT' ? '编辑草稿' : '编辑机会'`)
    expect(editor).toContain(`editorMode !== 'PUBLISHED'`)
    expect(editor).toContain(`editorMode === 'PUBLISHED' ? '保存修改' : '发布机会'`)
  })

  it('uses AI recognition with a bounded local fallback and explicit confirmation', () => {
    expect(editorScript).toContain('purpose: \'OPPORTUNITY\'')
    expect(editorScript).toContain('mipAiModule.createTextDraft')
    expect(editorScript).toContain('loadAiEditorDraft(this.data.aiDraftId, \'OPPORTUNITY\')')
    expect(editorScript).toContain('confirmedAiDraftId: aiSource.confirmation.draftId')
    expect(editorScript).toContain('parseOpportunityAiDraft')
    expect(editorScript).toContain('parseOpportunityText(source, this.data.cityOptions)')
    expect(editorScript).toContain('aiConfirmation: {')
    expect(editorScript).toContain('confirmedAiDraftId: this.data.pasteAiDraftId')
    expect(editor).toContain('pasteRecognizing ? \'正在智能识别\' : \'粘贴整段文字，自动识别\'')
    expect(editorScript).toContain('已使用智能识别，请核对结果。')
    expect(editorScript).toContain('智能识别暂时不可用，已使用基础识别，请重点核对。')
    expect(editor).toContain('bind:tap="confirmPasteDraft"')
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
    expect(editorScript).toContain(`const wasExisting = Boolean(this.data.id)`)
    expect(editorScript).toContain(`previousPage?.route === detailRoute`)
    expect(editorScript).toContain('wx.redirectTo({')
    expect(editorScript).toContain('/packages/member/mip-opportunities/detail/index?id=')
    expect(detailScript).toContain('if (this.data.item) {\n      void this.load()')
  })

  it('uses design tokens instead of page-local colour literals', () => {
    for (const view of [discovery, detail, editor]) {
      expect(view).not.toMatch(/#[\da-f]{3,8}|rgba\(/i)
      expect(view).toContain('bg-canvas')
    }
  })
})
