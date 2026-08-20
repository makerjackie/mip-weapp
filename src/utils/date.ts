function twoDigits(value: number) {
  return String(value).padStart(2, '0')
}

function validDate(value: string | Date) {
  const result = value instanceof Date ? value : new Date(value)
  return Number.isNaN(result.getTime()) ? null : result
}

export function formatLocalDate(value: string | Date) {
  const date = validDate(value)
  return date
    ? `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`
    : ''
}

export function formatLocalTime(value: string | Date) {
  const date = validDate(value)
  return date ? `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}` : ''
}

export function formatLocalDateTime(value: string | Date) {
  const date = validDate(value)
  return date ? `${formatLocalDate(date)} ${formatLocalTime(date)}` : ''
}

export function formatLocalMonthDayTime(value: string | Date) {
  const date = validDate(value)
  return date
    ? `${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())} ${formatLocalTime(date)}`
    : ''
}
