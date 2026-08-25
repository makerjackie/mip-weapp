'use strict'

const { AdminError } = require('./validation')

const CONTRACT_VERSION = 1
const TIME_ZONE = 'Asia/Shanghai'
const SHANGHAI_OFFSET = '+08:00'
const DAY_MS = 86_400_000
const INPUT_KEYS = Object.freeze(['period', 'scope'])
const PERIOD_KEYS = Object.freeze(['endDate', 'granularity', 'preset', 'startDate'])
const SCOPE_KEYS = Object.freeze(['id', 'type'])
const PRESETS = Object.freeze(['TODAY', 'THIS_WEEK', 'THIS_MONTH', 'LAST_30_DAYS', 'CUSTOM'])
const GRANULARITIES = Object.freeze(['DAY', 'WEEK', 'MONTH'])
const SCOPE_TYPES = Object.freeze(['AUTHORIZED', 'PLATFORM', 'BRANCH', 'EVENT'])

function createDashboardOverview({ access, repository, clock = () => new Date() }) {
  if (!access || typeof access.session !== 'function') {
    throw new TypeError('DASHBOARD_OVERVIEW_ACCESS_REQUIRED')
  }
  if (!repository || typeof repository.readOverviewSnapshot !== 'function') {
    throw new TypeError('DASHBOARD_OVERVIEW_REPOSITORY_REQUIRED')
  }
  if (typeof clock !== 'function') {
    throw new TypeError('DASHBOARD_OVERVIEW_CLOCK_REQUIRED')
  }

  async function getOverview(caller, value = {}) {
    const context = await access.session(caller)
    const trusted = trustedCaller(context?.caller)
    const request = overviewRequest(value)
    const asOf = validDate(clock(), 'DASHBOARD_OVERVIEW_CLOCK_INVALID')
    const period = overviewPeriod(request.period, asOf)
    const snapshot = await repository.readOverviewSnapshot({
      appId: trusted.appId,
      actorUserId: trusted.actorUserId,
      scope: request.scope,
      period,
      asOf,
    })
    assertSnapshot(snapshot)
    return {
      schemaVersion: CONTRACT_VERSION,
      asOf: asOf.toISOString(),
      timeZone: TIME_ZONE,
      scope: snapshot.scope,
      period: publicPeriod(period),
      people: snapshot.people,
      membership: snapshot.membership,
      events: snapshot.events,
      opportunities: snapshot.opportunities,
      tasks: snapshot.tasks,
      operations: snapshot.operations,
    }
  }

  return { getOverview }
}

function trustedCaller(value) {
  const caller = record(
    value,
    '调用身份无效',
    'DASHBOARD_OVERVIEW_INVALID_STATE',
  )
  return {
    appId: trustedIdentifier(caller.appId, 64),
    actorUserId: trustedIdentifier(caller.actorUserId || caller.userId, 36),
  }
}

function trustedIdentifier(value, maximum) {
  if (typeof value !== 'string'
    || !value
    || value.length > maximum
    || !/^[\w-]+$/.test(value)) {
    throw codeError('DASHBOARD_OVERVIEW_INVALID_STATE')
  }
  return value
}

function overviewRequest(value) {
  const input = record(value, '数据概览参数无效')
  exactKeys(input, INPUT_KEYS, '数据概览参数无效')
  return {
    scope: overviewScope(input.scope),
    period: overviewPeriodInput(input.period),
  }
}

function overviewScope(value) {
  if (value === undefined) {
    return { type: 'AUTHORIZED', id: null }
  }
  const input = record(value, '查看范围无效')
  exactKeys(input, SCOPE_KEYS, '查看范围无效')
  const type = enumValue(input.type, SCOPE_TYPES, '查看范围无效')
  if (type === 'BRANCH' || type === 'EVENT') {
    return { type, id: uuid(input.id, '查看范围无效') }
  }
  if (Object.hasOwn(input, 'id')) {
    throw validationError('查看范围无效')
  }
  return { type, id: null }
}

function overviewPeriodInput(value) {
  if (value === undefined) {
    return { preset: 'THIS_MONTH', startDate: null, endDate: null, granularity: null }
  }
  const input = record(value, '时间范围无效')
  exactKeys(input, PERIOD_KEYS, '时间范围无效')
  const preset = enumValue(input.preset, PRESETS, '时间范围无效')
  const granularity = input.granularity === undefined
    ? null
    : enumValue(input.granularity, GRANULARITIES, '时间粒度无效')
  if (preset === 'CUSTOM') {
    return {
      preset,
      startDate: calendarDate(input.startDate, '开始日期无效'),
      endDate: calendarDate(input.endDate, '结束日期无效'),
      granularity,
    }
  }
  if (Object.hasOwn(input, 'startDate') || Object.hasOwn(input, 'endDate')) {
    throw validationError('预设时间范围不能包含自定义日期')
  }
  return { preset, startDate: null, endDate: null, granularity }
}

function overviewPeriod(input, asOf) {
  const today = shanghaiDate(asOf)
  let startDate
  let endAt = asOf
  if (input.preset === 'CUSTOM') {
    if (input.startDate > input.endDate || input.endDate > today) {
      throw validationError('自定义时间范围无效')
    }
    if (calendarDays(input.startDate, input.endDate) + 1 > 366) {
      throw validationError('自定义时间范围不能超过 366 天')
    }
    startDate = input.startDate
    const requestedEnd = shanghaiMidnight(addCalendarDays(input.endDate, 1))
    endAt = requestedEnd.getTime() < asOf.getTime() ? requestedEnd : asOf
  }
  else {
    startDate = presetStartDate(input.preset, today)
  }
  const startAt = shanghaiMidnight(startDate)
  if (startAt.getTime() >= endAt.getTime()) {
    throw validationError('时间范围内尚无可查询时段')
  }
  const durationMs = endAt.getTime() - startAt.getTime()
  const granularity = input.granularity || defaultGranularity(durationMs)
  validateGranularity(granularity, durationMs)
  const comparisonEndAt = new Date(startAt)
  const comparisonStartAt = new Date(startAt.getTime() - durationMs)
  return {
    preset: input.preset,
    startAt,
    endAt,
    comparisonStartAt,
    comparisonEndAt,
    granularity,
    bucketStartDates: bucketStartDates(startAt, endAt, granularity),
  }
}

function presetStartDate(preset, today) {
  if (preset === 'TODAY') {
    return today
  }
  if (preset === 'LAST_30_DAYS') {
    return addCalendarDays(today, -29)
  }
  if (preset === 'THIS_MONTH') {
    return `${today.slice(0, 8)}01`
  }
  if (preset === 'THIS_WEEK') {
    const weekday = new Date(`${today}T00:00:00.000Z`).getUTCDay()
    return addCalendarDays(today, -(weekday === 0 ? 6 : weekday - 1))
  }
  throw validationError('时间范围无效')
}

function defaultGranularity(durationMs) {
  const days = Math.ceil(durationMs / DAY_MS)
  if (days <= 62) {
    return 'DAY'
  }
  if (days <= 180) {
    return 'WEEK'
  }
  return 'MONTH'
}

function validateGranularity(granularity, durationMs) {
  const days = Math.ceil(durationMs / DAY_MS)
  if (granularity === 'DAY' && days > 62) {
    throw validationError('日粒度最多支持 62 天')
  }
  if (granularity === 'WEEK' && days > 180) {
    throw validationError('周粒度最多支持 180 天')
  }
}

function bucketStartDates(startAt, endAt, granularity) {
  const firstDate = alignedBucketDate(shanghaiDate(startAt), granularity)
  const buckets = []
  for (let current = firstDate; shanghaiMidnight(current).getTime() < endAt.getTime();) {
    buckets.push(current)
    current = nextBucketDate(current, granularity)
  }
  return buckets
}

function alignedBucketDate(date, granularity) {
  if (granularity === 'DAY') {
    return date
  }
  if (granularity === 'MONTH') {
    return `${date.slice(0, 8)}01`
  }
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay()
  return addCalendarDays(date, -(weekday === 0 ? 6 : weekday - 1))
}

function nextBucketDate(date, granularity) {
  if (granularity === 'DAY') {
    return addCalendarDays(date, 1)
  }
  if (granularity === 'WEEK') {
    return addCalendarDays(date, 7)
  }
  const [year, month] = date.split('-').map(Number)
  const next = new Date(Date.UTC(year, month, 1))
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-01`
}

function publicPeriod(period) {
  return {
    preset: period.preset,
    startAt: period.startAt.toISOString(),
    endAt: period.endAt.toISOString(),
    comparisonStartAt: period.comparisonStartAt.toISOString(),
    comparisonEndAt: period.comparisonEndAt.toISOString(),
    granularity: period.granularity,
  }
}

function assertSnapshot(value) {
  const snapshot = record(value, '数据概览状态无效', 'DASHBOARD_OVERVIEW_INVALID_STATE')
  for (const key of ['scope', 'people', 'membership', 'events', 'opportunities', 'tasks', 'operations']) {
    if (!Object.hasOwn(snapshot, key) || !snapshot[key] || typeof snapshot[key] !== 'object') {
      throw codeError('DASHBOARD_OVERVIEW_INVALID_STATE')
    }
  }
}

function shanghaiDate(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function shanghaiMidnight(date) {
  return new Date(`${date}T00:00:00.000${SHANGHAI_OFFSET}`)
}

function calendarDate(value, message) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw validationError(message)
  }
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day) {
    throw validationError(message)
  }
  return value
}

function addCalendarDays(value, amount) {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + amount))
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

function calendarDays(startDate, endDate) {
  return (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / DAY_MS
}

function exactKeys(value, allowed, message) {
  const allowedKeys = new Set(allowed)
  if (Object.keys(value).some(key => !allowedKeys.has(key))) {
    throw validationError(message)
  }
}

function record(value, message, code = 'VALIDATION_FAILED') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw code === 'VALIDATION_FAILED' ? validationError(message) : codeError(code)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw code === 'VALIDATION_FAILED' ? validationError(message) : codeError(code)
  }
  return value
}

function enumValue(value, allowed, message) {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw validationError(message)
  }
  return value
}

function uuid(value, message) {
  if (typeof value !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw validationError(message)
  }
  return value.toLowerCase()
}

function validDate(value, code) {
  const date = value instanceof Date ? new Date(value) : new Date(value)
  if (!Number.isFinite(date.getTime())) {
    throw codeError(code)
  }
  return date
}

function validationError(message) {
  return new AdminError('VALIDATION_FAILED', message)
}

function codeError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

function pad(value) {
  return String(value).padStart(2, '0')
}

module.exports = { createDashboardOverview }
