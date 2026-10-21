import { describe, expect, it } from 'vitest'
import { assertGrowthCatalogReadiness } from '../scripts/lib/growth-catalog-readiness.mjs'

describe('live growth configuration readiness', () => {
  it('rejects the empty catalog that caused the test player page to fail', () => {
    expect(() => assertGrowthCatalogReadiness({ data: { rows: [{ activeLevelCount: 0, minimumExperience: null }] } })).toThrow('GROWTH_LEVEL_BASE_REQUIRED')
  })
  it('rejects configured levels that have no zero-experience starting level', () => {
    expect(() => assertGrowthCatalogReadiness({ data: { rows: [{ activeLevelCount: 4, minimumExperience: 100 }] } })).toThrow('GROWTH_LEVEL_BASE_REQUIRED')
  })
  it('accepts actual MySQL count strings without requiring a fixed number of levels', () => {
    expect(assertGrowthCatalogReadiness({ data: { rows: [{ activeLevelCount: '12', minimumExperience: '0' }] } })).toEqual({ activeLevelCount: 12, minimumExperience: 0 })
  })
  it('does not turn a malformed tool response into a configured catalog', () => {
    expect(() => assertGrowthCatalogReadiness({ success: false })).toThrow('GROWTH_LEVEL_BASE_REQUIRED')
  })
})
