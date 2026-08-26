'use strict'

const formatterCache = new Map()

function nextDailyRunAt(input = {}) {
  const after = validDate(input.after)
  const dailyTime = dailyTimeValue(input.dailyTime)
  const timeZone = timeZoneValue(input.timeZone)
  const [hour, minute] = dailyTime.split(':').map(Number)
  const local = zonedParts(after, timeZone)
  for (let dayOffset = 0; dayOffset < 8; dayOffset += 1) {
    const nextDate = new Date(Date.UTC(local.year, local.month - 1, local.day + dayOffset))
    const target = {
      year: nextDate.getUTCFullYear(),
      month: nextDate.getUTCMonth() + 1,
      day: nextDate.getUTCDate(),
      hour,
      minute,
    }
    let instant
    try {
      instant = localInstant(target, timeZone)
    }
    catch (error) {
      if (error?.code === 'KNOWLEDGE_SCHEDULE_LOCAL_TIME_UNAVAILABLE') continue
      throw error
    }
    if (instant.getTime() > after.getTime()) return instant
  }
  throw codeError('KNOWLEDGE_SCHEDULE_LOCAL_TIME_UNAVAILABLE')
}

function localInstant(target, timeZone) {
  const desired = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute)
  let candidate = desired
  for (let pass = 0; pass < 4; pass += 1) {
    const actual = zonedParts(new Date(candidate), timeZone)
    const actualClock = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute)
    const correction = desired - actualClock
    if (correction === 0) break
    candidate += correction
  }
  const result = new Date(candidate)
  const verified = zonedParts(result, timeZone)
  if (verified.year !== target.year
    || verified.month !== target.month
    || verified.day !== target.day
    || verified.hour !== target.hour
    || verified.minute !== target.minute) {
    throw codeError('KNOWLEDGE_SCHEDULE_LOCAL_TIME_UNAVAILABLE')
  }
  result.setUTCSeconds(0, 0)
  return result
}

function zonedParts(value, timeZone) {
  let formatter = formatterCache.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
      minute: '2-digit',
      month: '2-digit',
      timeZone,
      year: 'numeric',
    })
    formatterCache.set(timeZone, formatter)
  }
  const values = Object.fromEntries(
    formatter.formatToParts(value)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, Number(part.value)]),
  )
  if (![values.year, values.month, values.day, values.hour, values.minute]
    .every(Number.isInteger)) {
    throw codeError('KNOWLEDGE_SCHEDULE_TIMEZONE_INVALID')
  }
  return values
}

function dailyTimeValue(value) {
  const result = String(value || '').trim()
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(result)) {
    throw codeError('VALIDATION_FAILED')
  }
  return result
}

function timeZoneValue(value) {
  const result = String(value || 'Asia/Shanghai').trim()
  if (!/^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)*$/.test(result) || result.length > 64) {
    throw codeError('VALIDATION_FAILED')
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone: result }).format(new Date(0))
  }
  catch {
    throw codeError('VALIDATION_FAILED')
  }
  return result
}

function validDate(value) {
  const result = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (!Number.isFinite(result.getTime())) throw codeError('VALIDATION_FAILED')
  return result
}

function codeError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

module.exports = {
  dailyTimeValue,
  nextDailyRunAt,
  timeZoneValue,
  zonedParts,
}
