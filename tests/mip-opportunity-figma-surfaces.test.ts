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

  it('keeps the discovery hierarchy and all committed filters above the custom TabBar', () => {
    expect(discovery).toContain('id="opportunities-status-bar"')
    expect(discovery).toContain('id="opportunities-custom-navigation"')
    expect(discovery).toContain('<app-top-safe-area id="opportunities-status-bar" />')
    expect(discovery).toContain('id="opportunities-filter-actions"')
    expect(discovery).toContain('bottom-[calc(env(safe-area-inset-bottom)+112rpx)]')
    expect(discovery).toContain('pb-[280rpx]')
    expect(discoveryStyles).toContain('padding-bottom: calc(280rpx + env(safe-area-inset-bottom) + 112rpx);')

    for (const binding of [
      'bindconfirm="onSearchConfirm"',
      'bind:change="changeCity"',
      'bind:tap="chooseRole"',
      'bind:change="changeIndustry"',
      'bind:tap="toggleTag"',
      'bind:tap="resetFilters"',
      'bind:tap="applyFilters"',
    ]) {
      expect(discovery).toContain(binding)
    }
  })

  it('keeps existing discovery content during onShow refresh and reserves fixed-filter space', () => {
    expect(discoveryScript).toContain('preserveContent: this.data.state === \'ready\'')
    expect(discovery).toContain('class="opportunities-filter-panel')
    expect(discovery).toContain('mb-[112rpx]')
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
