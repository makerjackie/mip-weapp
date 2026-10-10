import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('MIP cooperation card editor per the 2571:34139 mockup', () => {
  const source = read('src/packages/member/mip-cooperation/editor/index.ts')
  const view = read('src/packages/member/mip-cooperation/editor/index.wxml')

  it('taps stars to set each trait score from one to five', () => {
    expect(source).toMatch(/const score = Number\(event\.currentTarget\.dataset\.score\)/)
    expect(source).toMatch(/score < 1 \|\| score > MAX_ABILITY_SCORE/)
    expect(view).toContain('data-score="{{star}}"')
    expect(view).toContain('aria-checked="{{star <= item.score}}"')
    expect(view).toContain('star-favorite-3')
    expect(view).toContain('icon-star-line.png')
  })

  it('adds and removes structured circle and quirk groups with one group floor', () => {
    expect(source).toMatch(/addCircle\(\) \{/)
    expect(source).toContain('group <= 0 || this.data.circles.length <= 1')
    expect(source).toMatch(/addQuirk\(\) \{/)
    expect(source).toContain('group <= 0 || this.data.quirks.length <= 1')
    expect(view).toContain('bind:tap="addCircle"')
    expect(view).toContain('bind:tap="removeCircle"')
    expect(view).toContain('bind:tap="addQuirk"')
    expect(view).toContain('bind:tap="removeQuirk"')
    expect(view).toContain('wx:for-index="groupIndex"')
  })

  it('carries legacy role fields through save without rendering them', () => {
    expect(source).toContain('...this.data.legacyFields')
    expect(source).toMatch(/for \(const key of definition\.legacyFieldKeys\)/)
    expect(view).not.toContain('legacyFields')
    expect(read('src/config/mip-catalogs.ts')).toMatch(/legacyFieldKeys: \['resources', 'target'\]/)
  })

  it('shows per-role trait labels and locks role selection for existing cards', () => {
    expect(source).toMatch(/label: definition\.abilityLabels\[index\] \|\| dimension\.label/)
    expect(source).toMatch(/roleLocked: Boolean\(detail\)/)
    expect(view).toContain('wx:if="{{!roleLocked}}"')
    expect(view).toContain('bind:tap="changeRole"')
  })

  it('keeps the single save capsule and publishes drafts from the detail page instead', () => {
    expect(view).toMatch(/保存[\s\S]*?bind:tap="saveCard"/)
    expect(view).toContain('mip-sticky-actions')
    expect(view).toContain('mip-pill-button')
    expect(view).not.toContain('bind:tap="preview"')
    // 按钮区整块黄色：全宽单元格撑起胶囊（2026-10-07 拍板），内容区不再有页内返回
    expect(view).toContain('grid w-full grid-cols-1 items-center')
    expect(view).toContain('min-w-0')
    expect((view.match(/<app-page-exit/g) || []).length).toBe(1)
    const detailView = read('src/packages/member/mip-cooperation/detail/index.wxml')
    expect(detailView).toContain('bind:tap="publish"')
    expect(detailView).toContain('发布')
    expect(read('src/packages/member/mip-cooperation/detail/index.ts')).toMatch(/publish: true/)
  })

  it('renders the 2571:34139 section anatomy (square menu rows, star metrics, glass save bar)', () => {
    // 分组标题：16px 图标 + fs16 标题
    expect(view).toContain('size="{{16}}"')
    // 菜单/臭毛病行为直角行 + 1px 拼缝
    expect(view).not.toMatch(/mt-\[22rpx\]/)
    expect((view.match(/mt-\[2rpx\]/g) || []).length).toBeGreaterThanOrEqual(6)
    // 星标 20x20，列距 11px
    expect(view).toContain('size="{{20}}"')
    expect(view).toContain('gap-[8rpx]')
    expect(view).toContain('gap-[22rpx]')
    // AI 助手卡不带描边
    expect(view).not.toContain('border-brand')
  })

  it('warns on back navigation with unsaved edits and auto-drafts on confirm', () => {
    expect(source).toContain('wx.enableAlertBeforeUnload')
    expect(source).toContain('wx.disableAlertBeforeUnload')
    expect(source).toMatch(/touch\(\)/)
    expect(source).toMatch(/saveDraftOnExit/)
    expect(source).toMatch(/publish: false/)
  })

  it('pins a persistent save-error banner above the save capsule until fields change (MIP-3)', () => {
    // 保存失败横幅固定在吸底保存按钮上方：border-danger 样式、修改字段即清除
    const bannerIndex = view.indexOf('save-error-banner')
    const actionsIndex = view.indexOf('<mip-sticky-actions')
    expect(view).toContain('border border-danger')
    expect(bannerIndex).toBeGreaterThan(-1)
    expect(bannerIndex).toBeLessThan(actionsIndex)
    expect(read('src/packages/member/mip-cooperation/editor/index.wxss')).toMatch(
      /\.save-error-banner \{[\s\S]*?position: fixed;[\s\S]*?bottom: calc\(env\(safe-area-inset-bottom\) \+ 136rpx\)/,
    )
    // touch() 是所有字段改动的统一入口，横幅在此清除
    expect(source).toMatch(/touch\(\) \{[\s\S]*?this\.setData\(\{ message: '' \}\)[\s\S]*?this\.dirty = true/)
  })
})
