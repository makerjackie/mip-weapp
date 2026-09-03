function twoDigits(value: number) {
  return String(value).padStart(2, '0')
}

function validDate(value: string | number | Date) {
  const result = value instanceof Date ? value : new Date(value)
  return Number.isNaN(result.getTime()) ? null : result
}

export function formatLocalDate(value: string | number | Date) {
  const date = validDate(value)
  return date
    ? `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`
    : ''
}

export function formatLocalTime(value: string | number | Date) {
  const date = validDate(value)
  return date ? `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}` : ''
}

export function formatLocalDateTime(value: string | number | Date) {
  const date = validDate(value)
  return date ? `${formatLocalDate(date)} ${formatLocalTime(date)}` : ''
}

export function formatLocalMonthDayTime(value: string | number | Date) {
  const date = validDate(value)
  return date
    ? `${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())} ${formatLocalTime(date)}`
    : ''
}

export function formatChineseDate(value: string | number | Date) {
  const date = validDate(value)
  return date
    ? `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
    : ''
}

export function formatChineseDateTime(value: string | number | Date) {
  const date = validDate(value)
  return date ? `${formatChineseDate(date)} ${formatLocalTime(date)}` : ''
}

export function formatChineseMonthDay(value: string | number | Date) {
  const date = validDate(value)
  return date ? `${date.getMonth() + 1}月${date.getDate()}日` : ''
}

export function formatChineseMonthDayTime(value: string | number | Date) {
  const date = validDate(value)
  return date ? `${formatChineseMonthDay(date)} ${formatLocalTime(date)}` : ''
}
