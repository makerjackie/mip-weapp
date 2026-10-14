'use strict'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TYPES = new Set(['CITY', 'NATIONAL', 'REMOTE'])
// MIW-89（2026-10-13 产品对齐）：与 mip-opportunities-api 同口径的价值模式。
//   RANGE        既有万元区间（默认，存量行）；
//   SINGLE       小程序千单位单值（min = max = 千 × 100,000 分）；
//   NEGOTIATION  面谈（金额必空，行保持 ACTIVE，展示「面谈」）。
const VALUE_MODES = new Set(['RANGE', 'SINGLE', 'NEGOTIATION'])
const QIAN_CENTS = 100000

function normalizeValueMode(value) {
  const valueMode = value === undefined || value === null || value === '' ? 'RANGE' : value
  if (!VALUE_MODES.has(valueMode)) throw validationError()
  return valueMode
}

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
  const valueMode = normalizeValueMode(value.valueMode)
  const minAmountCents = parseAmount(value.minAmountCents)
  const maxAmountCents = parseAmount(value.maxAmountCents)
  if (minAmountCents !== null && maxAmountCents !== null && minAmountCents > maxAmountCents) throw validationError()
  if (valueMode === 'SINGLE' && (minAmountCents === null || minAmountCents !== maxAmountCents)) throw validationError()
  if (valueMode === 'NEGOTIATION' && (minAmountCents !== null || maxAmountCents !== null)) throw validationError()
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
  return { currency: 'CNY', amountUnit: 'CNY_CENTS', valueMode, minAmountCents, maxAmountCents, locations }
}

function validationError() {
  const error = new Error('VALIDATION_FAILED')
  error.code = 'VALIDATION_FAILED'
  return error
}

function display(min, max, valueMode = 'RANGE') {
  const money = value => `¥${(Number(value) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  if (valueMode === 'NEGOTIATION') return '面谈'
  if (valueMode === 'SINGLE') return `${Number(min) / QIAN_CENTS} 千`
  if (min == null && max == null) return ''
  if (min === max) return money(min)
  if (min == null) return `至 ${money(max)}`
  if (max == null) return `起 ${money(min)}`
  return `${money(min)} - ${money(max)}`
}

// MIW-94（DEF-11）：导出「价值模式 / 价值展示」两列与 admin-web 列表同口径——
// SINGLE/NEGOTIATION 复用上方 display（「X 千」/「面谈」），RANGE 沿用列表的万元区间口径（≤/≥/～）。
const VALUE_MODE_LABELS = new Map([['RANGE', '区间'], ['SINGLE', '单值（千）'], ['NEGOTIATION', '面谈']])

function valueModeLabel(valueMode) {
  return VALUE_MODE_LABELS.get(normalizeValueMode(valueMode))
}

function valueDisplay(minAmountCents, maxAmountCents, valueMode = 'RANGE') {
  const mode = normalizeValueMode(valueMode)
  if (mode !== 'RANGE') return display(minAmountCents, maxAmountCents, mode)
  const wan = value => Number.isSafeInteger(Number(value))
    ? (Number(value) / 1000000).toLocaleString('zh-CN', { maximumFractionDigits: 6 })
    : '不限'
  const min = minAmountCents == null ? null : Number(minAmountCents)
  const max = maxAmountCents == null ? null : Number(maxAmountCents)
  if (min === null && max === null) return '—'
  if (min === null) return `≤ ${wan(max)}`
  if (max === null) return `≥ ${wan(min)}`
  if (min === max) return wan(min)
  return `${wan(min)} ～ ${wan(max)}`
}

function dto(term, locations) {
  const locationDto = locations.map(location => location.location_type === 'CITY'
    ? { type: 'CITY', cityTagId: location.city_tag_id, cityName: location.city_name || '' }
    : { type: location.location_type })
  const valueMode = normalizeValueMode(term?.value_mode)
  return {
    currency: term?.currency || 'CNY',
    amountUnit: term?.amount_unit || 'CNY_CENTS',
    valueMode,
    minAmountCents: term?.min_amount_cents == null ? undefined : Number(term.min_amount_cents),
    maxAmountCents: term?.max_amount_cents == null ? undefined : Number(term.max_amount_cents),
    amountDisplay: display(term?.min_amount_cents, term?.max_amount_cents, valueMode),
    locations: locationDto,
    locationDisplay: locationDto.map(location => location.type === 'CITY' ? location.cityName : location.type === 'NATIONAL' ? '全国' : '远程').filter(Boolean).join('、'),
  }
}

async function load(database, appId, opportunityId) {
  const [term, locations] = await Promise.all([
    database.one(
      `SELECT currency, amount_unit, value_mode, min_amount_cents, max_amount_cents
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

async function loadMany(database, appId, opportunityIds) {
  const ids = [...new Set(opportunityIds)]
  if (!ids.length) return new Map()
  const placeholders = ids.map(() => '?').join(', ')
  const [terms, locations] = await Promise.all([
    database.query(
      `SELECT opportunity_id, currency, amount_unit, value_mode, min_amount_cents, max_amount_cents
       FROM mip_opportunity_commercial_terms
       WHERE app_id = ? AND status = 'ACTIVE' AND opportunity_id IN (${placeholders})`,
      [appId, ...ids],
    ),
    database.query(
      `SELECT location.opportunity_id, location.location_type, location.city_tag_id, city.label AS city_name
       FROM mip_opportunity_locations location
       LEFT JOIN mip_tags city ON city.app_id = location.app_id AND city.id = location.city_tag_id
       WHERE location.app_id = ? AND location.opportunity_id IN (${placeholders})
       ORDER BY location.opportunity_id, location.sort_order, location.location_key`,
      [appId, ...ids],
    ),
  ])
  const termsById = new Map(terms.map(term => [term.opportunity_id, term]))
  const locationsById = new Map()
  for (const location of locations) {
    const list = locationsById.get(location.opportunity_id) || []
    list.push(location)
    locationsById.set(location.opportunity_id, list)
  }
  return new Map(ids.flatMap(id => {
    const term = termsById.get(id), places = locationsById.get(id) || []
    return term || places.length ? [[id, dto(term, places)]] : []
  }))
}

async function sync(tx, appId, opportunityId, terms, version) {
  if (terms === undefined) return
  await tx.query('DELETE FROM mip_opportunity_locations WHERE app_id = ? AND opportunity_id = ?', [appId, opportunityId])
  if (terms === null) {
    await tx.query(
      `UPDATE mip_opportunity_commercial_terms
       SET min_amount_cents = NULL, max_amount_cents = NULL, value_mode = 'RANGE', status = 'INACTIVE', version = ?
       WHERE app_id = ? AND opportunity_id = ?`,
      [version, appId, opportunityId],
    )
    return
  }
  const valueMode = normalizeValueMode(terms.valueMode)
  await tx.query(
    `INSERT INTO mip_opportunity_commercial_terms
       (app_id, opportunity_id, currency, amount_unit, value_mode, min_amount_cents, max_amount_cents, status, version)
     VALUES (?, ?, 'CNY', 'CNY_CENTS', ?, ?, ?, 'ACTIVE', ?)
     ON DUPLICATE KEY UPDATE
       value_mode = VALUES(value_mode),
       min_amount_cents = VALUES(min_amount_cents),
       max_amount_cents = VALUES(max_amount_cents),
       status = 'ACTIVE',
       version = VALUES(version)`,
    [appId, opportunityId, valueMode, terms.minAmountCents, terms.maxAmountCents, version],
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

module.exports = { dto, load, loadMany, normalizeCommercialTerms, sync, valueDisplay, valueModeLabel }
