/** Activity APIs define calendar dates in UTC+08:00, independent of device timezone. */
const offsetMilliseconds = 8 * 60 * 60 * 1000
function shifted(value: string | number | Date) {
  return new Date(new Date(value).getTime() + offsetMilliseconds)
}
function twoDigits(value: number) {
  return String(value).padStart(2, '0')
}
/** Local calendar carrier for date-only picker arithmetic; never an event timestamp. */
export function businessCalendarDate(value: string | number | Date = new Date()) {
  const date = shifted(value)
  return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}
export function formatBusinessDate(value: string | number | Date) {
  const date = shifted(value)
  return Number.isNaN(date.getTime()) ? '' : `${date.getUTCFullYear()}-${twoDigits(date.getUTCMonth() + 1)}-${twoDigits(date.getUTCDate())}`
}
export function formatBusinessTime(value: string | number | Date) {
  const date = shifted(value)
  return Number.isNaN(date.getTime()) ? '' : `${twoDigits(date.getUTCHours())}:${twoDigits(date.getUTCMinutes())}`
}
export function formatBusinessMonthDay(value: string | number | Date) {
  const date = shifted(value)
  return Number.isNaN(date.getTime()) ? '' : `${date.getUTCMonth() + 1}月${date.getUTCDate()}日`
}
export function formatBusinessMonthDayTime(value: string | number | Date) {
  return formatBusinessDate(value) ? `${formatBusinessMonthDay(value)} ${formatBusinessTime(value)}` : ''
}
export function formatBusinessDateTime(value: string | number | Date) {
  const date = shifted(value)
  return Number.isNaN(date.getTime()) ? '' : `${date.getUTCFullYear()}年${formatBusinessMonthDayTime(value)}`
}
