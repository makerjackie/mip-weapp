'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { dto, normalizeCommercialTerms, sync } = require('../domain/opportunity-commercial-terms')

describe('admin opportunity commercial terms value modes', () => {
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

  it('accepts NEGOTIATION only with empty amounts', () => {
    assert.deepEqual(normalizeCommercialTerms({ valueMode: 'NEGOTIATION', locations: [] }), {
      currency: 'CNY', amountUnit: 'CNY_CENTS', valueMode: 'NEGOTIATION',
      minAmountCents: null, maxAmountCents: null, locations: [],
    })
    assert.throws(() => normalizeCommercialTerms({ valueMode: 'NEGOTIATION', minAmountCents: 100, locations: [] }), /VALIDATION_FAILED/)
    assert.throws(() => normalizeCommercialTerms({ valueMode: 'NEGOTIATION', maxAmountCents: 100, locations: [] }), /VALIDATION_FAILED/)
  })

  it('renders qian and negotiation displays from value_mode and keeps legacy rows on yuan', () => {
    const negotiation = dto({ value_mode: 'NEGOTIATION', min_amount_cents: null, max_amount_cents: null }, [])
    assert.equal(negotiation.valueMode, 'NEGOTIATION')
    assert.equal(negotiation.amountDisplay, '面谈')
    assert.equal(dto({ value_mode: 'SINGLE', min_amount_cents: 500000, max_amount_cents: 500000 }, []).amountDisplay, '5 千')
    assert.equal(dto({ value_mode: 'SINGLE', min_amount_cents: 550000, max_amount_cents: 550000 }, []).amountDisplay, '5.5 千')
    // RANGE 行即使 min=max 也保持 ¥ 展示（与 SINGLE 显式区分）
    assert.equal(dto({ value_mode: 'RANGE', min_amount_cents: 660000, max_amount_cents: 660000 }, []).amountDisplay, '¥6,600.00')
    // 无 value_mode 的存量行按 RANGE 读取，展示不变
    const legacy = dto({ min_amount_cents: 660000, max_amount_cents: 1880000 }, [])
    assert.equal(legacy.valueMode, 'RANGE')
    assert.equal(legacy.amountDisplay, '¥6,600.00 - ¥18,800.00')
  })

  it('soft-disables cleared terms and resets value_mode to RANGE', async () => {
    const writes = []
    const tx = {
      async query(sql, params) {
        writes.push({ sql, params })
        return []
      },
    }
    await sync(tx, 'app-a', 'opportunity-a', null, 4)
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
    await sync(tx, 'app-a', 'opportunity-a', {
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
