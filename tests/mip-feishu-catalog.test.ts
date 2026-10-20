import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { assertIndustryCatalogImportSafe, buildFeishuCatalog } from '../scripts/lib/mip-feishu-catalog.mjs'

const source = (name: string) => JSON.parse(fs.readFileSync(`docs/mip/sources/feishu/20260926/${name}.json`, 'utf8'))
const input = { appId: 'fixture-app', industries: source('industries'), cities: source('cities'), badges: source('badges'), existingTags: [], existingBadges: [] }

describe('Feishu catalog reconciliation', () => {
  it('stops an apply before overwriting renamed, disabled or custom owner industries', () => {
    expect(() => assertIndustryCatalogImportSafe([{ kind: 'INDUSTRY', version: 1, tag_key: 'feishu_original' }])).not.toThrow()
    for (const changed of [{ kind: 'INDUSTRY', version: 2 }, { kind: 'INDUSTRY', version: 1, tag_key: 'custom_owner_tag' }]) {
      expect(() => assertIndustryCatalogImportSafe([changed])).toThrow('超级管理员自定义配置')
    }
    expect(() => assertIndustryCatalogImportSafe([{ kind: 'CITY', version: 2 }])).not.toThrow()
  })
  it('imports complete source groups without treating the clear filter as an industry', () => {
    const plan = buildFeishuCatalog(input)
    expect(plan.tags.filter(row => row.kind === 'INDUSTRY' && !row.selectable)).toHaveLength(11)
    expect(plan.tags.filter(row => row.kind === 'INDUSTRY' && row.selectable)).toHaveLength(121)
    expect(plan.tags.filter(row => row.kind === 'CITY')).toHaveLength(374)
    expect(plan.tags.some(row => row.label === '-' || row.label === '全国')).toBe(false)
    expect(plan.tags.filter(row => row.kind === 'INDUSTRY' && row.popular)).toHaveLength(13)
    expect(plan.badges).toHaveLength(11)
    expect(new Set(plan.tags.map(row => row.id)).size).toBe(plan.tags.length)
    expect(buildFeishuCatalog(input)).toEqual(plan)
    expect(buildFeishuCatalog({ ...input, appId: 'other-app' }).tags[0].id).not.toBe(plan.tags[0].id)
  })

  it('retains exact-match IDs and refuses ambiguous names instead of guessing', () => {
    const old = { id: 'existing-city', kind: 'CITY', label: '深圳', tag_key: 'shenzhen', selectable: 1 }
    const plan = buildFeishuCatalog({ ...input, existingTags: [old] })
    expect(plan.tags.find(row => row.label === '深圳')).toMatchObject({ id: old.id, key: old.tag_key })
    expect(() => buildFeishuCatalog({ ...input, existingTags: [old, { ...old, id: 'duplicate' }] })).toThrow('Ambiguous')
  })
})
