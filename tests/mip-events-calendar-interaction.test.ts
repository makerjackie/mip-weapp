import { beforeAll, expect, it, vi } from 'vitest'

vi.mock('../src/modules/mip-events/client', () => ({ mipEventsModule: {} }))
vi.mock('../src/modules/mip-identity/client', () => ({ mipIdentityModule: {}, mipBranchesModule: {} }))
vi.mock('../src/modules/mip-banners', () => ({ mipBannerModule: {} }))
vi.mock('../src/platform/navigation/client', () => ({ caseNavigateTo: vi.fn(), syncCaseNavigation: vi.fn() }))
vi.mock('../src/platform/storage/component-media', () => ({ clearPageMedia: vi.fn(), updatePageMedia: vi.fn() }))
let definition: any
beforeAll(async () => {
  vi.stubGlobal('Page', (value: unknown) => {
    definition = value
  })
  vi.stubGlobal('wx', { showToast: vi.fn() })
  await import('../src/pages/events/index')
})
function page() {
  const instance = Object.create(definition)
  instance.data = structuredClone(definition.data)
  instance.setData = (patch: unknown) => Object.assign(instance.data, patch)
  instance.rebuildCalendar = vi.fn()
  instance.loadCalendarDates = vi.fn()
  instance.loadEvents = vi.fn()
  return instance
}
it('keeps draft date changes out of the feed until confirmation and resets on reopening', () => {
  const p = page()
  p.data.selectedDate = '2028-12-12'
  p.data.customDateLabel = '12月12日'
  p.data.dateFilter = 'CUSTOM'
  p.showCalendar()
  p.pickCalendarDay({ currentTarget: { dataset: { date: '2028-12-19' } } })
  expect(p.currentQuery().date).toBe('2028-12-12')
  p.closeCalendar()
  expect(p.loadEvents).not.toHaveBeenCalled()
  p.showCalendar()
  expect(p.data.calendarSelected).toBe('2028-12-12')
  p.pickCalendarDay({ currentTarget: { dataset: { date: '2028-12-19' } } })
  p.confirmCalendar()
  expect(p.currentQuery()).toMatchObject({ dateFilter: 'CUSTOM', date: '2028-12-19' })
  expect(p.data.customDateLabel).toBe('12月19日')
  expect(p.loadEvents).toHaveBeenCalledOnce()
})
it('ignores disabled days and rejects invalid calendar input without loading the feed', () => {
  const p = page()
  p.data.calendarSelected = '2028-12-12'
  p.pickCalendarDay({ currentTarget: { dataset: { date: '2020-01-01', disabled: true } } })
  expect(p.data.calendarSelected).toBe('2028-12-12')
  p.data.calendarSelected = 'invalid'
  p.confirmCalendar()
  expect(p.loadEvents).not.toHaveBeenCalled()
  expect(p.data.dateFilter).toBe('RECENT')
})

it('toggles the selected day off, applies clearing only on confirmation, and restores recent events', () => {
  const p = page()
  Object.assign(p.data, { selectedDate: '2028-12-12', customDateLabel: '12月12日', dateFilter: 'CUSTOM' })
  p.showCalendar()
  p.pickCalendarDay({ currentTarget: { dataset: { date: '2028-12-12' } } })
  expect(p.data.calendarSelected).toBe('')
  expect(p.currentQuery().date).toBe('2028-12-12')
  p.closeCalendar()
  p.showCalendar()
  expect(p.data.calendarSelected).toBe('2028-12-12')
  p.pickCalendarDay({ currentTarget: { dataset: { date: '2028-12-12' } } })
  p.confirmCalendar()
  expect(p.data).toMatchObject({ dateFilter: 'RECENT', selectedDate: '', customDateLabel: '', calendarVisible: false })
  expect(p.currentQuery().date).toBeUndefined()
  expect(p.loadEvents).toHaveBeenCalledOnce()
})
