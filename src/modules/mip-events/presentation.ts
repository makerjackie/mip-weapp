import { formatLocalDate } from '../../utils/date'

const publicEventTypeLabels: Record<string, string> = {
  community: '社区活动',
  mip_morning_meeting: 'MIP 早会',
}

const technicalKeyPattern = /^[a-z][a-z0-9]*(?:[_.:-][a-z0-9]+)+$/

/** Keep catalog keys out of user-facing event surfaces when legacy rows lack a label. */
export function publicEventTypeLabel(value: string, key = value) {
  const mapped = publicEventTypeLabels[key] || publicEventTypeLabels[value]
  if (mapped) {
    return mapped
  }
  const label = value.trim()
  return technicalKeyPattern.test(label) ? '活动' : label
}

export interface EventCalendarCell {
  /** Local `YYYY-MM-DD` key; empty for the leading/trailing blanks of adjacent months. */
  key: string
  day: number
  /** Background/text classes per figma 1819_17793: panel cell, brand selected, grey disabled. */
  cellClass: string
  disabled: boolean
  dot: boolean
}

export interface EventCalendarWeek {
  key: string
  cells: EventCalendarCell[]
}

export interface EventCalendarMonthOptions {
  year: number
  /** 1–12. */
  month: number
  selectedDate?: string
  minDate?: number
  maxDate?: number
  /** Local date keys that carry an event, drawn as a brand dot under the day number. */
  eventDates?: ReadonlySet<string>
}

const emptyCell: EventCalendarCell = { key: '', day: 0, cellClass: '', disabled: true, dot: false }

/**
 * Sunday-first month grid for the events date picker (figma 1819_17793):
 * 46px rounded panel cells, brand fill on the selected day, grey numbers outside
 * [minDate, maxDate]. Rows always cover whole weeks so the grid never reflows.
 */
export function buildEventCalendarMonth(options: EventCalendarMonthOptions): EventCalendarWeek[] {
  const { year, month, selectedDate = '', minDate, maxDate, eventDates } = options
  const leading = new Date(year, month - 1, 1).getDay()
  const dayCount = new Date(year, month, 0).getDate()
  const weeks: EventCalendarWeek[] = []
  let week: EventCalendarCell[] = []
  const flush = () => {
    if (!week.length) {
      return
    }
    while (week.length < 7) {
      week.push(emptyCell)
    }
    weeks.push({ key: week.find(cell => cell.key)?.key || `row-${weeks.length}`, cells: week })
    week = []
  }
  for (let offset = 0; offset < leading; offset += 1) {
    week.push(emptyCell)
  }
  for (let day = 1; day <= dayCount; day += 1) {
    const date = new Date(year, month - 1, day)
    const key = formatLocalDate(date)
    const time = date.getTime()
    const disabled = (minDate !== undefined && time < minDate) || (maxDate !== undefined && time > maxDate)
    week.push({
      key,
      day,
      cellClass: key === selectedDate
        ? 'bg-brand text-canvas'
        : disabled
          ? 'bg-panel text-[#4c4c4c]'
          : 'bg-panel text-ink',
      disabled,
      dot: eventDates?.has(key) ?? false,
    })
    if (week.length === 7) {
      flush()
    }
  }
  flush()
  return weeks
}
