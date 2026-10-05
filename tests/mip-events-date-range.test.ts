import type { EventId } from '../src/modules/mip'
import type { EventCalendarDates, EventFeedResult, MipEventDetail, MipEventsGateway } from '../src/modules/mip-events'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { buildEventCalendarMonth, createMipEventsModule } from '../src/modules/mip-events'

const eventId = 'event-1' as EventId
const event: MipEventDetail = {
  id: eventId,
  scopeType: 'PLATFORM',
  title: '活动',
  summary: '摘要',
  description: '介绍',
  eventTypeLabel: '交流活动',
  tags: [],
  videoRecaps: [],
  mode: 'OFFLINE',
  accessType: 'FREE',
  startsAt: '2026-08-25T00:00:00.000Z',
  endsAt: '2026-08-25T02:00:00.000Z',
  status: 'PUBLISHED',
  registrationCount: 0,
  participantPreview: [],
  onlineAccessAvailable: false,
  registrationPolicy: 'AUTO',
  priceCents: 0,
  currency: 'CNY',
  formVersion: 1,
  registrationSchema: [],
  changes: [],
  canRegister: true,
  canCancel: false,
  canRetryRefund: false,
  canCheckIn: false,
  canInteract: false,
}

function gateway() {
  const feed: EventFeedResult = { items: [event] }
  return {
    listEvents: vi.fn(async () => feed),
    getEvent: vi.fn(async () => event),
  } as unknown as MipEventsGateway
}

describe('MIP event date range client contract', () => {
  it('keeps an explicit active-filter label for a selected date', () => {
    const page = readFileSync(new URL('../src/pages/events/index.ts', import.meta.url), 'utf8')
    const view = readFileSync(new URL('../src/pages/events/index.wxml', import.meta.url), 'utf8')
    const confirmCalendar = page.slice(
      page.indexOf('  confirmCalendar('),
      page.indexOf('  openBanner('),
    )
    const currentQuery = page.slice(
      page.indexOf('  currentQuery('),
      page.indexOf('  async loadPage('),
    )
    // MIW-11: the start/end range entry was removed from the feed query; only the single-day
    // calendar remains on the tab. MIW-39 reuses dateFrom/dateTo for the calendar dot lookup,
    // so the ban is scoped to the feed query that the tab submits.
    expect(currentQuery).not.toContain('dateFrom')
    expect(currentQuery).not.toContain('dateTo')
    // MIW-37 figma 1819_17793: 「今天」only labels today; other dates show M月D日.
    expect(confirmCalendar).toContain('? \'今天\' : formatChineseMonthDay(value)')
    expect(confirmCalendar).not.toContain('view: \'UPCOMING\'')
    // MIW-39: the default state shows only the calendar icon; the label appears after confirm.
    expect(view).not.toContain('data-filter="TODAY"')
    expect(view).not.toContain('>今天<')
    // The picked date replaces the 今天 shortcut instead of stacking next to it.
    expect(view).toContain('wx:if="{{customDateLabel}}"')
    expect(view).not.toContain('{{customDateLabel || \'自定义日期\'}}')
    // figma 1819_18218: the status radios track the date filter, not the tab view.
    expect(view).toContain('aria-checked="{{dateFilter !== \'ENDED\'}}"')
    expect(view).toContain('aria-checked="{{dateFilter === \'ENDED\'}}"')
  })

  it('draws activity dots from the server calendar dates per visible month', () => {
    const page = readFileSync(new URL('../src/pages/events/index.ts', import.meta.url), 'utf8')
    const view = readFileSync(new URL('../src/pages/events/index.wxml', import.meta.url), 'utf8')
    // figma 1819_17793: dates with activities carry a brand dot; empty days stay clean.
    expect(view).toContain('wx:if="{{cell.dot}}"')
    expect(page).toContain('eventDates: this.calendarEventDates')
    // Dots load with the sheet and follow month paging, scoped to the visible month.
    expect(page).toContain('void this.loadCalendarDates()')
    expect(page).toContain('dateFrom: formatLocalDate(new Date(year, month - 1, 1))')
    // Dot lookup fails soft: no dates, but picking a date still works.
    expect(page).toContain('this.calendarEventDates = new Set()')
  })

  it('renders the figma 1819_17793 calendar sheet instead of t-calendar', () => {
    const page = readFileSync(new URL('../src/pages/events/index.ts', import.meta.url), 'utf8')
    const view = readFileSync(new URL('../src/pages/events/index.wxml', import.meta.url), 'utf8')
    const json = readFileSync(new URL('../src/pages/events/index.json', import.meta.url), 'utf8')
    // The TDesign sheet is white and cannot match the dark design; the page draws its own.
    expect(json).not.toContain('t-calendar')
    // figma 1819_17793: days before today are #4c4c4c and unselectable.
    expect(page).toContain('minDate: Math.max(calendarMinDate, startOfToday())')
    expect(view).toContain('请选择活动日期')
    expect(view).toContain('bind:tap="shiftCalendarYear"')
    expect(view).toContain('bind:tap="shiftCalendarMonth"')
    expect(view).toContain('bind:tap="pickCalendarDay"')
    expect(view).toContain('aria-label="确认所选日期"')
  })

  it('builds whole sunday-first weeks with panel cells and a brand selected day', () => {
    const weeks = buildEventCalendarMonth({
      year: 2026,
      month: 1,
      selectedDate: '2026-01-30',
      minDate: new Date(2021, 0, 1).getTime(),
      maxDate: new Date(2036, 11, 31).getTime(),
      eventDates: new Set(['2026-01-26', '2026-01-30']),
    })
    expect(weeks).toHaveLength(5)
    expect(weeks[0].cells.filter(cell => cell.day === 0)).toHaveLength(4)
    expect(weeks.map(week => week.cells).flat().filter(cell => cell.day)).toHaveLength(31)
    const selected = weeks.flatMap(week => week.cells).find(cell => cell.key === '2026-01-30')
    expect(selected).toMatchObject({ cellClass: 'bg-brand text-canvas', disabled: false, dot: true })
    expect(weeks[0].cells[0]).toMatchObject({ day: 0, disabled: true })
  })

  it('greys days outside the rolling window and marks event days', () => {
    const weeks = buildEventCalendarMonth({
      year: 2026,
      month: 1,
      minDate: new Date(2026, 0, 10).getTime(),
      maxDate: new Date(2026, 0, 20).getTime(),
      eventDates: new Set(['2026-01-11']),
    })
    const cells = weeks.flatMap(week => week.cells).filter(cell => cell.day)
    expect(cells.find(cell => cell.day === 9)).toMatchObject({ cellClass: 'bg-panel text-[#4c4c4c]', disabled: true })
    expect(cells.find(cell => cell.day === 15)).toMatchObject({ cellClass: 'bg-panel text-ink', disabled: false })
    expect(cells.find(cell => cell.day === 11)).toMatchObject({ dot: true, disabled: false })
    expect(cells.find(cell => cell.day === 21)).toMatchObject({ disabled: true })
  })

  it('passes valid inclusive endpoints and keeps single-day date compatibility', async () => {
    const eventGateway = gateway()
    const module = createMipEventsModule(eventGateway)
    await module.listEvents({
      view: 'UPCOMING',
      dateFilter: 'CUSTOM',
      dateFrom: '2026-08-24',
      dateTo: '2026-08-25',
    })
    expect(eventGateway.listEvents).toHaveBeenCalledWith(expect.objectContaining({
      dateFrom: '2026-08-24',
      dateTo: '2026-08-25',
    }))

    await module.listEvents({ view: 'PAST', dateFilter: 'CUSTOM', date: '2026-08-24' })
    expect(eventGateway.listEvents).toHaveBeenLastCalledWith(expect.objectContaining({
      view: 'PAST',
      dateFilter: 'CUSTOM',
      date: '2026-08-24',
      dateFrom: undefined,
      dateTo: undefined,
    }))
  })

  it('rejects a reversed range before transport and drops malformed endpoints', async () => {
    const eventGateway = gateway()
    const module = createMipEventsModule(eventGateway)
    await expect(module.listEvents({
      view: 'UPCOMING',
      dateFilter: 'CUSTOM',
      dateFrom: '2026-08-25',
      dateTo: '2026-08-24',
    })).rejects.toThrow('开始日期不能晚于结束日期')
    expect(eventGateway.listEvents).not.toHaveBeenCalled()

    await module.listEvents({
      view: 'UPCOMING',
      dateFilter: 'CUSTOM',
      dateFrom: '2026-02-30',
      dateTo: '2026-03-01',
    })
    expect(eventGateway.listEvents).toHaveBeenLastCalledWith(expect.objectContaining({
      dateFrom: undefined,
      dateTo: '2026-03-01',
    }))
  })
})

describe('MIP event calendar dates client contract', () => {
  function calendarGateway() {
    const dates: EventCalendarDates = { dates: ['2026-01-26', '2026-01-30'] }
    return {
      dates,
      getCalendarDates: vi.fn(async () => dates),
    } as unknown as MipEventsGateway & {
      getCalendarDates: ReturnType<typeof vi.fn>
    }
  }

  it('fetches a visible month once and serves repeats and paging from cache', async () => {
    const eventGateway = calendarGateway()
    const module = createMipEventsModule(eventGateway)
    const month = { dateFrom: '2026-01-01', dateTo: '2026-01-31', cityName: '深圳' }

    const first = await module.getCalendarDates(month)
    const second = await module.getCalendarDates({ ...month })
    expect(first).toEqual({ dates: ['2026-01-26', '2026-01-30'] })
    expect(second).toEqual(first)
    expect(eventGateway.getCalendarDates).toHaveBeenCalledTimes(1)
    expect(eventGateway.getCalendarDates).toHaveBeenCalledWith({
      dateFrom: '2026-01-01',
      dateTo: '2026-01-31',
      cityName: '深圳',
    })

    // 翻月各自取数，翻回来仍读缓存；force 才回源。
    await module.getCalendarDates({ dateFrom: '2026-02-01', dateTo: '2026-02-28' })
    await module.getCalendarDates(month)
    expect(eventGateway.getCalendarDates).toHaveBeenCalledTimes(2)
    await module.getCalendarDates(month, { force: true })
    expect(eventGateway.getCalendarDates).toHaveBeenCalledTimes(3)
  })

  it('merges concurrent lookups of the same range into one transport call', async () => {
    let release: (value: EventCalendarDates) => void = () => {}
    const eventGateway = {
      getCalendarDates: vi.fn(() => new Promise<EventCalendarDates>((resolve) => {
        release = resolve
      })),
    } as unknown as MipEventsGateway
    const module = createMipEventsModule(eventGateway)
    const month = { dateFrom: '2026-03-01', dateTo: '2026-03-31' }

    const pending = Promise.all([module.getCalendarDates(month), module.getCalendarDates(month)])
    release({ dates: ['2026-03-08'] })
    await expect(pending).resolves.toEqual([{ dates: ['2026-03-08'] }, { dates: ['2026-03-08'] }])
    expect((eventGateway.getCalendarDates as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1)
  })

  it('validates the range before transport and tolerates a gateway without dots', async () => {
    const eventGateway = calendarGateway()
    const module = createMipEventsModule(eventGateway)
    await expect(module.getCalendarDates({ dateFrom: '2026-08-25', dateTo: '2026-08-24' }))
      .rejects
      .toThrow('开始日期不能晚于结束日期')
    await expect(module.getCalendarDates({ dateFrom: '2026-08-25', dateTo: '' }))
      .rejects
      .toThrow('活动日历日期范围无效')
    await expect(module.getCalendarDates({ dateFrom: '2026-01-01', dateTo: '2026-12-31' }))
      .rejects
      .toThrow('活动日历日期范围过大')
    expect(eventGateway.getCalendarDates).not.toHaveBeenCalled()

    // 网关未实现（旧部署）时黄点整体降级为无点。
    const bare = createMipEventsModule({} as MipEventsGateway)
    await expect(bare.getCalendarDates({ dateFrom: '2026-01-01', dateTo: '2026-01-31' }))
      .resolves
      .toEqual({ dates: [] })

    // 登录态切换使缓存失效，下次重新取数。
    await module.getCalendarDates({ dateFrom: '2026-01-01', dateTo: '2026-01-31' })
    module.invalidate()
    await module.getCalendarDates({ dateFrom: '2026-01-01', dateTo: '2026-01-31' })
    expect(eventGateway.getCalendarDates).toHaveBeenCalledTimes(2)
  })
})
