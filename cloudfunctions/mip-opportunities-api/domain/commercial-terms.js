'use strict'

const { uuid } = require('./common')

const LOCATION_TYPES = new Set(['CITY', 'NATIONAL', 'REMOTE'])

function amount(value) {
  if (value === undefined || value === null || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('VALIDATION_FAILED')
  return parsed
}

function normalizeCommercialTerms(value) {
  if (value === undefined) return undefined
  if (value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('VALIDATION_FAILED')
  if (value.currency !== undefined && value.currency !== 'CNY') throw new Error('VALIDATION_FAILED')
  if (value.amountUnit !== undefined && value.amountUnit !== 'CNY_CENTS') throw new Error('VALIDATION_FAILED')
  const minAmountCents = amount(value.minAmountCents)
  const maxAmountCents = amount(value.maxAmountCents)
  if (minAmountCents !== null && maxAmountCents !== null && minAmountCents > maxAmountCents) {
    throw new Error('VALIDATION_FAILED')
  }
  if (!Array.isArray(value.locations) || value.locations.length > 16) throw new Error('VALIDATION_FAILED')
  const seen = new Set()
  const locations = value.locations.map((location) => {
    if (!location || typeof location !== 'object' || !LOCATION_TYPES.has(location.type)) {
      throw new Error('VALIDATION_FAILED')
    }
    const cityTagId = location.type === 'CITY' ? String(location.cityTagId || '') : null
    if (location.type === 'CITY' && !uuid(cityTagId)) throw new Error('VALIDATION_FAILED')
    const key = location.type === 'CITY' ? `CITY:${cityTagId}` : location.type
    if (seen.has(key)) throw new Error('VALIDATION_FAILED')
    seen.add(key)
    return { type: location.type, ...(cityTagId ? { cityTagId } : {}) }
  })
  return { currency: 'CNY', amountUnit: 'CNY_CENTS', minAmountCents, maxAmountCents, locations }
}

function money(cents) {
  return `¥${(Number(cents) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function amountDisplay(terms) {
  if (terms.minAmountCents === null && terms.maxAmountCents === null) return ''
  if (terms.minAmountCents === terms.maxAmountCents) return money(terms.minAmountCents)
  if (terms.minAmountCents === null) return `至 ${money(terms.maxAmountCents)}`
  if (terms.maxAmountCents === null) return `起 ${money(terms.minAmountCents)}`
  return `${money(terms.minAmountCents)} - ${money(terms.maxAmountCents)}`
}

function termsDto(row, locations) {
  const locationDto = locations.map(location => location.location_type === 'CITY'
    ? { type: 'CITY', city: { id: location.city_tag_id, key: location.city_key, label: location.city_label } }
    : { type: location.location_type })
  const terms = {
    currency: row?.currency || 'CNY',
    amountUnit: row?.amount_unit || 'CNY_CENTS',
    minAmountCents: row?.min_amount_cents == null ? undefined : Number(row.min_amount_cents),
    maxAmountCents: row?.max_amount_cents == null ? undefined : Number(row.max_amount_cents),
    amountDisplay: row ? amountDisplay({
      minAmountCents: row.min_amount_cents == null ? null : Number(row.min_amount_cents),
      maxAmountCents: row.max_amount_cents == null ? null : Number(row.max_amount_cents),
    }) : '',
    locations: locationDto,
    locationDisplay: locationDto.map(location => location.type === 'CITY' ? (location.city?.label || '') : location.type === 'NATIONAL' ? '全国' : '远程').filter(Boolean).join('、'),
  }
  return terms
}

function legacyTerms(row) {
  if (!row.city_tag_id) return undefined
  return termsDto(null, [{
    location_type: 'CITY', city_tag_id: row.city_tag_id, city_key: row.city_key, city_label: row.city_label,
  }])
}

function locationMatches(sourceLocations = [], candidateLocations = []) {
  const source = sourceLocations.map(item => ({ type: item.type || item.location_type, cityTagId: item.cityTagId || item.city_tag_id }))
  const candidate = candidateLocations.map(item => ({ type: item.type || item.location_type, cityTagId: item.cityTagId || item.city_tag_id }))
  if (source.some(item => item.type === 'NATIONAL') || candidate.some(item => item.type === 'NATIONAL')) return true
  if (source.some(item => item.type === 'REMOTE') && candidate.some(item => item.type === 'REMOTE')) return true
  const cities = new Set(source.filter(item => item.type === 'CITY').map(item => item.cityTagId))
  return candidate.some(item => item.type === 'CITY' && cities.has(item.cityTagId))
}

async function loadCommercialTerms(database, appId, ids) {
  if (!ids.length) return new Map()
  const placeholders = ids.map(() => '?').join(', ')
  const [termRows, locationRows] = await Promise.all([
    optionalQuery(database,
      `SELECT app_id, opportunity_id, currency, amount_unit, min_amount_cents, max_amount_cents
       FROM mip_opportunity_commercial_terms
       WHERE app_id = ? AND opportunity_id IN (${placeholders})`,
      [appId, ...ids],
    ),
    optionalQuery(database,
      `SELECT location.opportunity_id, location.location_type, location.city_tag_id,
              city.tag_key AS city_key, city.label AS city_label
       FROM mip_opportunity_locations location
       LEFT JOIN mip_tags city
         ON city.app_id = location.app_id AND city.id = location.city_tag_id
       WHERE location.app_id = ? AND location.opportunity_id IN (${placeholders})
       ORDER BY location.opportunity_id, location.sort_order, location.location_key`,
      [appId, ...ids],
    ),
  ])
  const termsById = new Map(termRows.map(row => [row.opportunity_id, row]))
  const locationsById = new Map()
  for (const row of locationRows) {
    const list = locationsById.get(row.opportunity_id) || []
    list.push(row)
    locationsById.set(row.opportunity_id, list)
  }
  const result = new Map()
  for (const id of ids) {
    const locations = locationsById.get(id) || []
    const row = termsById.get(id)
    if (row || locations.length) result.set(id, termsDto(row, locations))
  }
  return result
}

async function optionalQuery(database, sql, params) {
  try {
    return await database.query(sql, params)
  }
  catch (error) {
    if (/unexpected query|unknown table|doesn't exist/i.test(String(error?.message || error))) return []
    throw error
  }
}

async function syncCommercialTerms(tx, appId, opportunityId, terms, version) {
  if (terms === undefined) return
  await tx.query('DELETE FROM mip_opportunity_locations WHERE app_id = ? AND opportunity_id = ?', [appId, opportunityId])
  await tx.query('DELETE FROM mip_opportunity_commercial_terms WHERE app_id = ? AND opportunity_id = ?', [appId, opportunityId])
  if (terms === null) return
  await tx.query(
    `INSERT INTO mip_opportunity_commercial_terms (
       app_id, opportunity_id, currency, amount_unit, min_amount_cents, max_amount_cents, version
     ) VALUES (?, ?, 'CNY', 'CNY_CENTS', ?, ?, ?)`,
    [appId, opportunityId, terms.minAmountCents, terms.maxAmountCents, version],
  )
  for (const [sortOrder, location] of terms.locations.entries()) {
    const cityTagId = location.cityTagId || null
    const locationKey = location.type === 'CITY' ? `CITY:${cityTagId}` : location.type
    await tx.query(
      `INSERT INTO mip_opportunity_locations (
         app_id, opportunity_id, location_key, location_type, city_tag_id, sort_order
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      [appId, opportunityId, locationKey, location.type, cityTagId, sortOrder],
    )
  }
}

async function assertCommercialTerms(tx, appId, terms) {
  if (!terms || !terms.locations.length) return
  const cityIds = terms.locations.filter(item => item.type === 'CITY').map(item => item.cityTagId)
  if (!cityIds.length) return
  const rows = await tx.query(
    `SELECT id FROM mip_tags WHERE app_id = ? AND kind = 'CITY' AND enabled = 1
       AND id IN (${cityIds.map(() => '?').join(', ')})`,
    [appId, ...cityIds],
  )
  if (new Set(rows.map(row => row.id)).size !== cityIds.length) throw new Error('VALIDATION_FAILED')
}

module.exports = {
  LOCATION_TYPES,
  assertCommercialTerms,
  legacyTerms,
  loadCommercialTerms,
  locationMatches,
  normalizeCommercialTerms,
  syncCommercialTerms,
  termsDto,
}
