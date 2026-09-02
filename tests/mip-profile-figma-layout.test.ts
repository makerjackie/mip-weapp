import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')

function source(file: string) {
  return fs.readFileSync(path.join(root, file), 'utf8')
}

describe('MIP profile Figma structure', () => {
  it('keeps basic profile controls in compact left-label right-control rows', () => {
    const page = source('src/packages/member/mip-profile/index.ts')
    const view = source('src/packages/member/mip-profile/index.wxml')
    const config = JSON.parse(source('src/packages/member/mip-profile/index.json'))

    expect(config.navigationBarTitleText).toBe('填写信息')
    expect(view).toContain('data-profile-basic-group="true"')
    for (const row of ['avatar', 'nickname', 'realName', 'gender']) {
      expect(view).toContain(`data-profile-basic-row="${row}"`)
    }
    expect(view).toMatch(/data-profile-basic-row="nickname"[^>]+min-h-\[92rpx\][^>]*>[\s\S]*?<input[^>]+text-right[^>]+placeholder="请输入您的昵称"/)
    expect(view).not.toContain('名片内容随下方资料实时更新')
    expect(view).toContain('wx:if="{{branchCatalogExpanded}}"')
    expect(view).toContain('wx:if="{{industryCatalogExpanded}}"')
    expect(view).toContain('data-profile-more-toggle="true"')
    expect(view).toContain('wx:if="{{moreExpanded}}"')
    expect(page).toContain('branchCatalogExpanded: false')
    expect(page).toContain('industryCatalogExpanded: false')
    expect(page).toContain('toggleCatalog(event')
    expect(page).toContain('toggleMore()')
    expect(view).not.toContain('公开范围')
    expect(view).not.toContain('bind:tap="addExperience"')
  })

  it('uses the same compact row contract in the card editor', () => {
    const view = source('src/packages/member/mip-card-edit/index.wxml')
    const config = JSON.parse(source('src/packages/member/mip-card-edit/index.json'))

    expect(config.navigationBarTitleText).toBe('编辑名片')
    for (const group of ['identity', 'company', 'contact', 'organization']) {
      expect(view).toContain(`data-card-field-group="${group}"`)
    }
    for (const row of ['realName', 'phone', 'wechat', 'email', 'address']) {
      expect(view).toMatch(new RegExp(`data-card-field-row="${row}"[^>]+min-h-\\[92rpx\\]`))
    }
    for (const row of ['company', 'role', 'organization', 'organizationRole']) {
      expect(view).toMatch(new RegExp(`data-card-field-row="${row}"[^>]+h-\\[88rpx\\]`))
    }
    expect(view).not.toContain('rounded-[14rpx] bg-panel-raised px-4 text-[length:25rpx]')
    expect(view).not.toContain('公开范围')
  })
})
