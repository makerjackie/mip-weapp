import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { runContractAudit } from '../scripts/ui-fidelity/audit-contracts.mjs'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')

function read(relativePath: string) {
  return readFileSync(path.join(root, relativePath), 'utf8')
}

const primitives = [
  'mip-detail-row',
  'mip-detail-row-group',
  'mip-form-field-row',
  'mip-section-header',
  'mip-tag-chip',
  'mip-search-bar',
  'sticky-actions',
  'mip-pill-button',
  'mip-nav-bar',
  'mip-order-card',
  'mip-attend-pill',
  'mip-stat-header',
  'mip-dialog',
]

describe('MIP Design System native primitives', () => {
  it('ships the foundational components with shared page styles', () => {
    for (const name of primitives) {
      const config = JSON.parse(read(`src/components/${name}/index.json`))
      expect(config.component, name).toBe(true)
      expect(config.styleIsolation, name).toBe('apply-shared')
      expect(read(`src/components/${name}/index.wxml`), name).toBeTruthy()
    }
  })

  it('implements DetailRow and grouped-row contracts', () => {
    const row = read('src/components/mip-detail-row/index.wxml')
    const styles = read('src/components/mip-detail-row/index.wxss')
    expect(row).toContain('mip-detail-row__label')
    expect(row).toContain('name="chevron-down-1-6"')
    expect(styles).toContain('min-height: 92rpx')
    expect(styles).toContain('background: var(--mip-bg-surface)')

    const group = read('src/components/mip-detail-row-group/index.wxml')
    const groupStyles = read('src/components/mip-detail-row-group/index.wxss')
    expect(group).toContain('<slot />')
    expect(groupStyles).toContain('overflow: hidden')
    expect(groupStyles).toContain('border-radius: 16rpx')
  })

  it('implements TagChip, SearchBar and button state contracts', () => {
    const chip = read('src/components/mip-tag-chip/index.wxml')
    expect(chip).toContain('mip-tag-chip--active')
    expect(read('src/components/mip-tag-chip/index.wxss')).toContain('border: 1rpx solid #080808')

    const search = read('src/components/mip-search-bar/index.ts')
    expect(search).toContain('triggerEvent(\'change\', { value })')

    const pill = read('src/components/mip-pill-button/index.wxml')
    expect(pill).toContain('aria-disabled="{{disabled || loading}}"')
    expect(read('src/components/mip-pill-button/index.wxss')).toContain('opacity: 0.4')
    expect(read('src/components/sticky-actions/index.wxml')).toContain('<slot name="actions" />')
  })

  it('implements business primitives with reference geometry', () => {
    expect(read('src/components/mip-nav-bar/index.wxml')).toContain('mip-nav-bar__title')
    expect(read('src/components/mip-order-card/index.wxml')).toContain('mip-order-card__payment-value')
    expect(read('src/components/mip-attend-pill/index.wxss')).toContain('width: 232rpx;')
    expect(read('src/components/mip-stat-header/index.wxml')).toContain('bind:tap="handleSelect"')
    expect(read('src/components/mip-dialog/index.wxml')).toContain('aria-role="dialog"')
  })

  it('delegates repeated fixture structures to shared business components', () => {
    const orders = read('src/packages/member/orders/index.wxml')
    expect(orders).toContain('<mip-order-card')
    expect(orders).not.toContain('mip-order-card__payment-value')

    const mine = read('src/packages/member/mip-events/mine/index.wxml')
    expect(mine).toContain('<mip-dialog')
    expect(mine).toContain('frame-only="{{true}}"')

    const profile = read('src/pages/profile/index.wxml')
    expect(profile).toContain('<mip-stat-header')
  })

  it('renders components instead of repeated page-owned primitive markup', () => {
    const privacy = read('src/packages/member/privacy/index.wxml')
    expect(privacy).toContain('<mip-section-header title="账号与安全" />')
    // Spacing belongs to the native wrapper; the shared header still renders the title.
    expect(privacy).toMatch(/<view class="mt-\[48rpx\]">\s*<mip-section-header title="协议" \/>/)
    expect(privacy).toContain('<mip-detail-row-group')
    expect(privacy).toContain('<mip-detail-row label="绑定手机" actionable="{{true}}" bind:tap="openBindPhone" />')
    expect(privacy).toContain('<mip-detail-row label="隐私设置" actionable="{{true}}" bind:tap="openPrivacySettings" />')

    const hearts = read('src/packages/member/mip-hearts/index.wxml')
    expect(hearts).toContain('<mip-search-bar')
  })

  it('passes the Layer 2 audit and meets the migration coverage gate', () => {
    const report = runContractAudit({ jsonPath: '', quiet: true })
    expect(report.pass).toBe(true)
    expect(report.coverage.implemented).toBe(18)
    expect(report.coverage.coveragePercent).toBe(100)
  })
})
