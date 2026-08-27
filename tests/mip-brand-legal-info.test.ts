import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { brand } from '../src/config/brand'

describe('MIP public legal information', () => {
  it('keeps public filing facts in brand config and private identifiers out of the about page', () => {
    const page = readFileSync('src/packages/member/about/index.wxml', 'utf8')

    expect(brand.operatorName).toBe('深圳市奇点聚合科技有限公司')
    expect(brand.websiteDomain).toBe('mip.cool')
    expect(brand.icpFilingNumber).toBe('粤ICP备2026005262号-2')
    expect(page).toContain('{{operatorName}}')
    expect(page).toContain('{{websiteDomain}}')
    expect(page).toContain('{{icpFilingNumber}}')
    expect(page).not.toMatch(/wx[0-9a-f]{16}|cloud1-[a-z0-9]+|商户号/i)
  })
})
