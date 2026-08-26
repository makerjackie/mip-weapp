'use strict'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TYPES = new Set(['CITY', 'NATIONAL', 'REMOTE'])

function normalizeCommercialTerms(value) {
  if (value === undefined) return undefined
  if (value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw validationError()
  if (value.currency !== undefined && value.currency !== 'CNY') throw validationError()
  if (value.amountUnit !== undefined && value.amountUnit !== 'CNY_CENTS') throw validationError()
  const parseAmount = (amount) => {
    if (amount === undefined || amount === null || amount === '') return null
    const result = Number(amount)
    if (!Number.isSafeInteger(result) || result < 0) throw validationError()
    return result
  }
  const minAmountCents = parseAmount(value.minAmountCents)
  const maxAmountCents = parseAmount(value.maxAmountCents)
  if (minAmountCents !== null && maxAmountCents !== null && minAmountCents > maxAmountCents) throw validationError()
  if (!Array.isArray(value.locations) || value.locations.length > 16) throw validationError()
  const seen = new Set()
  const locations = value.locations.map(location => {
    if (!location || typeof location !== 'object' || !TYPES.has(location.type)) throw validationError()
    const cityTagId = location.type === 'CITY' ? String(location.cityTagId || '') : null
    if (location.type === 'CITY' && !UUID.test(cityTagId)) throw validationError()
    const key = cityTagId ? `CITY:${cityTagId}` : location.type
    if (seen.has(key)) throw validationError()
    seen.add(key)
    return { type: location.type, ...(cityTagId ? { cityTagId } : {}) }
  })
  return { currency: 'CNY', amountUnit: 'CNY_CENTS', minAmountCents, maxAmountCents, locations }
}

function validationError() {
  const error = new Error('VALIDATION_FAILED')
  error.code = 'VALIDATION_FAILED'
  return error
}

function display(min, max) {
  const money = value => `¥${(Number(value) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  if (min == null && max == null) return ''
  if (min === max) return money(min)
  if (min == null) return `至 ${money(max)}`
  if (max == null) return `起 ${money(min)}`
  return `${money(min)} - ${money(max)}`
}

function dto(term, locations) {
  const locationDto = locations.map(location => location.location_type === 'CITY'
    ? { type: 'CITY', cityTagId: location.city_tag_id, cityName: location.city_name || '' }
    : { type: location.location_type })
  return {
    currency: term?.currency || 'CNY',
    amountUnit: term?.amount_unit || 'CNY_CENTS',
    minAmountCents: term?.min_amount_cents == null ? undefined : Number(term.min_amount_cents),
    maxAmountCents: term?.max_amount_cents == null ? undefined : Number(term.max_amount_cents),
    amountDisplay: display(term?.min_amount_cents, term?.max_amount_cents),
    locations: locationDto,
    locationDisplay: locationDto.map(location => location.type === 'CITY' ? location.cityName : location.type === 'NATIONAL' ? '全国' : '远程').filter(Boolean).join('、'),
  }
}

async function load(database, appId, opportunityId) {
  const [term, locations] = await Promise.all([
    database.one(
      `SELECT currency, amount_unit, min_amount_cents, max_amount_cents
       FROM mip_opportunity_commercial_terms
       WHERE app_id = ? AND opportunity_id = ? AND status = 'ACTIVE'`,
      [appId, opportunityId],
    ),
    database.query(
      `SELECT location.location_type, location.city_tag_id, city.label AS city_name
       FROM mip_opportunity_locations location
       LEFT JOIN mip_tags city ON city.app_id = location.app_id AND city.id = location.city_tag_id
       WHERE location.app_id = ? AND location.opportunity_id = ?
       ORDER BY location.sort_order, location.location_key`,
      [appId, opportunityId],
    ),
  ])
  return term || locations.length ? dto(term, locations) : undefined
}

async function sync(tx, appId, opportunityId, terms, version) {
  if (terms === undefined) return
  await tx.query('DELETE FROM mip_opportunity_locations WHERE app_id = ? AND opportunity_id = ?', [appId, opportunityId])
  if (terms === null) {
    await tx.query(
      `UPDATE mip_opportunity_commercial_terms
       SET min_amount_cents = NULL, max_amount_cents = NULL, status = 'INACTIVE', version = ?
       WHERE app_id = ? AND opportunity_id = ?`,
      [version, appId, opportunityId],
    )
    return
  }
  await tx.query(
    `INSERT INTO mip_opportunity_commercial_terms
       (app_id, opportunity_id, currency, amount_unit, min_amount_cents, max_amount_cents, status, version)
     VALUES (?, ?, 'CNY', 'CNY_CENTS', ?, ?, 'ACTIVE', ?)
     ON DUPLICATE KEY UPDATE
       min_amount_cents = VALUES(min_amount_cents),
       max_amount_cents = VALUES(max_amount_cents),
       status = 'ACTIVE',
       version = VALUES(version)`,
    [appId, opportunityId, terms.minAmountCents, terms.maxAmountCents, version],
  )
  for (const [sortOrder, location] of terms.locations.entries()) {
    const cityTagId = location.cityTagId || null
    await tx.query(
      `INSERT INTO mip_opportunity_locations
         (app_id, opportunity_id, location_key, location_type, city_tag_id, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [appId, opportunityId, location.cityTagId ? `CITY:${location.cityTagId}` : location.type, location.type, cityTagId, sortOrder],
    )
  }
}

module.exports = { load, normalizeCommercialTerms, sync }
