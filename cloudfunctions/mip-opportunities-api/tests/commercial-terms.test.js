'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { locationMatches, normalizeCommercialTerms, termsDto } = require('../domain/commercial-terms')

const CITY_A = '10000000-0000-4000-8000-000000000001'

describe('opportunity commercial terms', () => {
  it('normalizes CNY cents and rejects invalid ranges or locations', () => {
    assert.deepEqual(normalizeCommercialTerms({
      minAmountCents: 660000,
      maxAmountCents: 1880000,
      locations: [{ type: 'CITY', cityTagId: CITY_A }, { type: 'REMOTE' }],
    }), {
      currency: 'CNY', amountUnit: 'CNY_CENTS', minAmountCents: 660000, maxAmountCents: 1880000,
      locations: [{ type: 'CITY', cityTagId: CITY_A }, { type: 'REMOTE' }],
    })
    assert.throws(() => normalizeCommercialTerms({ minAmountCents: 2, maxAmountCents: 1, locations: [] }), /VALIDATION_FAILED/)
    assert.throws(() => normalizeCommercialTerms({ locations: [{ type: 'CITY', cityTagId: CITY_A }, { type: 'CITY', cityTagId: CITY_A }] }), /VALIDATION_FAILED/)
  })

  it('renders server-owned amount and location display and matches national scope', () => {
    const dto = termsDto({ min_amount_cents: 660000, max_amount_cents: 1880000 }, [
      { location_type: 'CITY', city_tag_id: CITY_A, city_key: 'WH', city_label: '武汉' },
      { location_type: 'NATIONAL', city_tag_id: null },
    ])
    assert.equal(dto.amountDisplay, '¥6,600.00 - ¥18,800.00')
    assert.equal(dto.locationDisplay, '武汉、全国')
    assert.equal(locationMatches([{ location_type: 'NATIONAL' }], [{ location_type: 'CITY', city_tag_id: CITY_A }]), true)
  })
})
