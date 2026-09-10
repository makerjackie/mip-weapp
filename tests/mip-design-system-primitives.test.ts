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
  'mip-primary-button',
  'mip-pill-button',
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

    const primary = read('src/components/mip-primary-button/index.wxml')
    expect(primary).toContain('disabled="{{disabled || loading}}"')
    expect(read('src/components/mip-primary-button/index.wxss')).toContain('opacity: 0.4')
  })

  it('renders components instead of repeated page-owned primitive markup', () => {
    const privacy = read('src/packages/member/privacy/index.wxml')
    expect(privacy).toContain('<mip-section-header title="账号与安全" />')
    expect(privacy).toContain('<mip-detail-row-group')
    expect(privacy).toContain('<mip-detail-row label="绑定手机" />')

    const hearts = read('src/packages/member/mip-hearts/index.wxml')
    expect(hearts).toContain('<mip-search-bar')
  })

  it('passes the Layer 2 audit and meets the migration coverage gate', () => {
    const report = runContractAudit({ jsonPath: '', quiet: true })
    expect(report.pass).toBe(true)
    expect(report.coverage.implemented).toBeGreaterThanOrEqual(13)
    expect(report.coverage.coveragePercent).toBeGreaterThanOrEqual(70)
  })
})
