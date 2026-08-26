export type DateTimeRangeField = 'startDate' | 'startTime' | 'endDate' | 'endTime'

export interface DateTimeRangeValue {
  startDate: string
  startTime: string
  endDate: string
  endTime: string
}

export interface DateTimeRangeIsoValue {
  startAt: string
  endAt: string
}

export interface DateTimeRangeValidation extends DateTimeRangeIsoValue {
  valid: boolean
  message: string
}

export interface DateTimeParts {
  date: string
  time: string
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}

export function dateTimeParts(value: string | Date): DateTimeParts {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) {
    return { date: '', time: '' }
  }
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  }
}

/**
 * Picker values are device-local wall-clock values. The API contract is UTC ISO.
 */
export function localDateTimeIso(date: string, time: string) {
  const value = new Date(`${date}T${time}:00`)
  return Number.isFinite(value.getTime()) ? value.toISOString() : ''
}

export function validateDateTimeRange(value: DateTimeRangeValue, endEnabled = true): DateTimeRangeValidation {
  const startAt = localDateTimeIso(value.startDate, value.startTime)
  const endAt = endEnabled ? localDateTimeIso(value.endDate, value.endTime) : ''
  if (!startAt || (endEnabled && !endAt)) {
    return { valid: false, startAt, endAt, message: '请检查日期和时间。' }
  }
  if (endEnabled && new Date(endAt).getTime() < new Date(startAt).getTime()) {
    return { valid: false, startAt, endAt, message: '结束时间不能早于开始时间。' }
  }
  return { valid: true, startAt, endAt, message: '' }
}
