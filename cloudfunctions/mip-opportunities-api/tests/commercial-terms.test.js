'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  locationMatches,
  normalizeCommercialTerms,
  syncCommercialTerms,
  termsDto,
} = require('../domain/commercial-terms')

const CITY_A = '10000000-0000-4000-8000-000000000001'

describe('opportunity commercial terms', () => {
  it('normalizes CNY cents and rejects invalid ranges or locations', () => {
    assert.deepEqual(normalizeCommercialTerms({
      minAmountCents: 660000,
      maxAmountCents: 1880000,
      locations: [{ type: 'CITY', cityTagId: CITY_A }, { type: 'REMOTE' }],
    }), {
      currency: 'CNY', amountUnit: 'CNY_CENTS', valueMode: 'RANGE',
      minAmountCents: 660000, maxAmountCents: 1880000,
      locations: [{ type: 'CITY', cityTagId: CITY_A }, { type: 'REMOTE' }],
    })
    assert.throws(() => normalizeCommercialTerms({ minAmountCents: 2, maxAmountCents: 1, locations: [] }), /VALIDATION_FAILED/)
    assert.throws(() => normalizeCommercialTerms({ locations: [{ type: 'CITY', cityTagId: CITY_A }, { type: 'CITY', cityTagId: CITY_A }] }), /VALIDATION_FAILED/)
  })

  it('keeps legacy range semantics when valueMode is absent or explicit RANGE', () => {
    const terms = { minAmountCents: 100, maxAmountCents: 900, locations: [] }
    assert.equal(normalizeCommercialTerms({ ...terms }).valueMode, 'RANGE')
    assert.equal(normalizeCommercialTerms({ ...terms, valueMode: 'RANGE' }).valueMode, 'RANGE')
    assert.throws(() => normalizeCommercialTerms({ ...terms, valueMode: 'QIAN' }), /VALIDATION_FAILED/)
  })

  it('accepts SINGLE qian mode only with equal non-null amounts', () => {
    assert.deepEqual(normalizeCommercialTerms({
      valueMode: 'SINGLE', minAmountCents: 500000, maxAmountCents: 500000, locations: [],
    }), {
      currency: 'CNY', amountUnit: 'CNY_CENTS', valueMode: 'SINGLE',
      minAmountCents: 500000, maxAmountCents: 500000, locations: [],
    })
    assert.throws(() => normalizeCommercialTerms({ valueMode: 'SINGLE', minAmountCents: 500000, maxAmountCents: 600000, locations: [] }), /VALIDATION_FAILED/)
    assert.throws(() => normalizeCommercialTerms({ valueMode: 'SINGLE', locations: [] }), /VALIDATION_FAILED/)
    assert.throws(() => normalizeCommercialTerms({ valueMode: 'SINGLE', minAmountCents: 500000, locations: [] }), /VALIDATION_FAILED/)
  })

  it('accepts NEGOTIATION only with empty amounts and keeps an ACTIVE row', () => {
    assert.deepEqual(normalizeCommercialTerms({ valueMode: 'NEGOTIATION', locations: [] }), {
      currency: 'CNY', amountUnit: 'CNY_CENTS', valueMode: 'NEGOTIATION',
      minAmountCents: null, maxAmountCents: null, locations: [],
    })
    assert.throws(() => normalizeCommercialTerms({ valueMode: 'NEGOTIATION', minAmountCents: 100, locations: [] }), /VALIDATION_FAILED/)
    assert.throws(() => normalizeCommercialTerms({ valueMode: 'NEGOTIATION', maxAmountCents: 100, locations: [] }), /VALIDATION_FAILED/)
  })

  it('renders server-owned amount and location display and matches national scope', () => {
    const dto = termsDto({ min_amount_cents: 660000, max_amount_cents: 1880000 }, [
      { location_type: 'CITY', city_tag_id: CITY_A, city_key: 'WH', city_label: '武汉' },
      { location_type: 'NATIONAL', city_tag_id: null },
    ])
    assert.equal(dto.amountDisplay, '¥6,600.00 - ¥18,800.00')
    assert.equal(dto.valueMode, 'RANGE')
    assert.equal(dto.locationDisplay, '武汉、全国')
    assert.equal(locationMatches([{ location_type: 'NATIONAL' }], [{ location_type: 'CITY', city_tag_id: CITY_A }]), true)
  })

  it('renders legacy displays unchanged for rows without value_mode', () => {
    for (const [row, expected] of [
      [{ min_amount_cents: 660000, max_amount_cents: 660000 }, '¥6,600.00'],
      [{ min_amount_cents: null, max_amount_cents: 660000 }, '至 ¥6,600.00'],
      [{ min_amount_cents: 660000, max_amount_cents: null }, '起 ¥6,600.00'],
      [{ min_amount_cents: null, max_amount_cents: null }, ''],
    ]) {
      const dto = termsDto(row, [])
      assert.equal(dto.amountDisplay, expected)
      assert.equal(dto.valueMode, 'RANGE')
    }
  })

  it('renders qian and negotiation displays from value_mode', () => {
    const negotiation = termsDto({ value_mode: 'NEGOTIATION', min_amount_cents: null, max_amount_cents: null }, [])
    assert.equal(negotiation.valueMode, 'NEGOTIATION')
    assert.equal(negotiation.amountDisplay, '面谈')
    assert.equal(termsDto({ value_mode: 'SINGLE', min_amount_cents: 500000, max_amount_cents: 500000 }, []).amountDisplay, '5 千')
    assert.equal(termsDto({ value_mode: 'SINGLE', min_amount_cents: 550000, max_amount_cents: 550000 }, []).amountDisplay, '5.5 千')
    // RANGE 行即使 min=max 也保持 ¥ 展示（与 SINGLE 显式区分）
    assert.equal(termsDto({ value_mode: 'RANGE', min_amount_cents: 660000, max_amount_cents: 660000 }, []).amountDisplay, '¥6,600.00')
  })

  it('soft-disables cleared terms without deleting durable commercial facts', async () => {
    const writes = []
    const tx = {
      async query(sql, params) {
        writes.push({ sql, params })
        return []
      },
    }
    await syncCommercialTerms(tx, 'app-a', 'opportunity-a', null, 4)
    assert.equal(writes.some(call => call.sql.includes('DELETE FROM mip_opportunity_commercial_terms')), false)
    assert.equal(writes.some(call => call.sql.includes("status = 'INACTIVE'")), true)
    assert.ok(writes.at(-1).sql.includes("value_mode = 'RANGE'"))
    assert.deepEqual(writes.at(-1).params, [4, 'app-a', 'opportunity-a'])
  })

  it('persists value_mode and keeps NEGOTIATION rows ACTIVE without amounts', async () => {
    const writes = []
    const tx = {
      async query(sql, params) {
        writes.push({ sql, params })
        return []
      },
    }
    await syncCommercialTerms(tx, 'app-a', 'opportunity-a', {
      currency: 'CNY', amountUnit: 'CNY_CENTS', valueMode: 'NEGOTIATION',
      minAmountCents: null, maxAmountCents: null, locations: [],
    }, 2)
    const upsert = writes.find(call => call.sql.includes('INSERT INTO mip_opportunity_commercial_terms'))
    assert.ok(upsert, 'expected commercial terms upsert')
    assert.ok(upsert.sql.includes('value_mode'))
    assert.ok(upsert.sql.includes("'ACTIVE'"))
    assert.ok(upsert.params.includes('NEGOTIATION'))
  })
})
