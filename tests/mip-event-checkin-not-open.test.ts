import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MipEventsError } from '../src/modules/mip-events'

const checkInStore = vi.hoisted(() => ({ peek: vi.fn(), save: vi.fn(), clear: vi.fn() }))
const eventsModule = vi.hoisted(() => ({
  resolveCheckInScene: vi.fn(),
  checkIn: vi.fn(),
}))
const identityModule = vi.hoisted(() => ({
  beginProtectedAction: vi.fn(),
  consumePendingResume: vi.fn(() => null),
}))
const navigateTo = vi.hoisted(() => vi.fn())
const scanCode = vi.hoisted(() => vi.fn())

vi.mock('../src/modules/mip-events/client', () => ({
  mipCheckInResumeStore: checkInStore,
  mipEventsModule: eventsModule,
}))
vi.mock('../src/modules/mip-identity/client', () => ({ mipIdentityModule: identityModule }))
vi.mock('../src/platform/navigation/client', () => ({ caseNavigateTo: navigateTo }))

type PageDefinition = Record<string, unknown> & {
  data: Record<string, unknown>
  setData: (patch: Record<string, unknown>) => void
}

let definition: PageDefinition

const EVENT_ID = '60000000-0000-4000-8000-000000000001'
const SCAN_SCENE = 's1.aaaaaaaaaaa.bbbbbbbbbbb'
const RESUME_TOKEN = `${'r'.repeat(40)}.${'s'.repeat(43)}`
const SCAN_INTENT = {
  eventId: EVENT_ID,
  resumeToken: RESUME_TOKEN,
  validUntil: '2026-12-12T12:30:00+08:00',
}

function createPage(overrides: Record<string, unknown> = {}) {
  const page = Object.create(definition) as PageDefinition
  page.data = { ...structuredClone(definition.data), ...structuredClone(overrides) }
  page.setData = patch => Object.assign(page.data, patch)
  return page
}

function callPage(page: PageDefinition, method: string, ...args: unknown[]) {
  const handler = page[method] as (...rest: unknown[]) => unknown
  if (typeof handler !== 'function') {
    throw new TypeError(`Missing page method: ${method}`)
  }
  return Reflect.apply(handler, page, args) as Promise<unknown>
}

async function flushAsync() {
  for (let index = 0; index < 12; index += 1) {
    await Promise.resolve()
  }
}

const root = path.resolve(import.meta.dirname, '..')

beforeAll(async () => {
  vi.stubGlobal('wx', { scanCode })
  vi.stubGlobal('Page', (input: PageDefinition) => {
    definition = input
  })
  await import('../src/packages/member/mip-events/check-in/index')
})

beforeEach(() => {
  for (const mock of Object.values(checkInStore)) {
    mock.mockReset()
  }
  for (const mock of Object.values(eventsModule)) {
    mock.mockReset()
  }
  for (const mock of Object.values(identityModule)) {
    mock.mockReset()
  }
  navigateTo.mockReset()
  scanCode.mockReset()
  checkInStore.save.mockReturnValue(SCAN_INTENT)
})

describe('MIP event check-in page not-open guidance (MIW-103)', () => {
  it('renders a friendly not-open state with the opening time when the scan is too early', async () => {
    const page = createPage()
    page.scanToken = SCAN_SCENE
    eventsModule.resolveCheckInScene.mockResolvedValueOnce({
      eventId: EVENT_ID,
      resumeToken: RESUME_TOKEN,
      validFrom: '2026-12-12T09:30:00+08:00',
      validUntil: SCAN_INTENT.validUntil,
      checkinOpensAt: '2026-12-12T09:30:00+08:00',
    })
    eventsModule.checkIn.mockRejectedValueOnce(new MipEventsError(
      'CHECKIN_NOT_OPEN',
      '活动未开始，签到尚未开放',
      false,
      { opensAt: '2026-12-12T09:30:00+08:00', startsAt: '2026-12-12T10:00:00+08:00' },
    ))

    await callPage(page, 'confirmCheckIn')
    await flushAsync()

    expect(page.data.state).toBe('not-open')
    expect(page.data.message).toContain('活动未开始')
    expect(page.data.message).toContain('12月12日 09:30')
    expect(page.data.eventId).toBe(EVENT_ID)
    // 签到意图保留：开放后回本页「确认签到」即可补签。
    expect(checkInStore.save).toHaveBeenCalled()
    expect(checkInStore.clear).not.toHaveBeenCalled()
  })

  it('falls back to a generic not-open message when the server omits the opening time', async () => {
    const page = createPage()
    page.scanToken = SCAN_SCENE
    eventsModule.resolveCheckInScene.mockResolvedValueOnce({
      eventId: EVENT_ID,
      resumeToken: RESUME_TOKEN,
      validFrom: '2026-12-12T09:30:00+08:00',
      validUntil: SCAN_INTENT.validUntil,
    })
    eventsModule.checkIn.mockRejectedValueOnce(new MipEventsError('CHECKIN_NOT_OPEN', '活动未开始，签到尚未开放'))

    await callPage(page, 'confirmCheckIn')
    await flushAsync()

    expect(page.data.state).toBe('not-open')
    expect(page.data.message).toContain('开始前 6 小时')
  })

  it('clears the stale credential and asks the staff for a fresh code on CHECKIN_EXPIRED', async () => {
    const page = createPage()
    page.scanToken = SCAN_SCENE
    eventsModule.resolveCheckInScene.mockResolvedValueOnce({
      eventId: EVENT_ID,
      resumeToken: RESUME_TOKEN,
      validFrom: '2026-12-12T09:30:00+08:00',
      validUntil: SCAN_INTENT.validUntil,
    })
    eventsModule.checkIn.mockRejectedValueOnce(new MipEventsError('CHECKIN_EXPIRED', '现场活动码已过期，请向工作人员获取最新活动码'))

    await callPage(page, 'confirmCheckIn')
    await flushAsync()

    expect(page.data.state).toBe('error')
    expect(page.data.message).toContain('已过期')
    expect(page.data.hasScanToken).toBe(false)
    expect(checkInStore.clear).toHaveBeenCalled()
  })

  it('guides the user to the event detail page from the not-open state', async () => {
    const page = createPage({ state: 'not-open', eventId: EVENT_ID })

    callPage(page, 'openEventDetail')

    expect(navigateTo).toHaveBeenCalledWith({
      url: `/packages/member/mip-events/detail/index?eventId=${EVENT_ID}`,
    })
  })

  it('keeps the not-open and expired branches explicit in the view instead of the danger error branch', () => {
    const view = readFileSync(path.join(root, 'src/packages/member/mip-events/check-in/index.wxml'), 'utf8')
    expect(view).toContain('state === \'not-open\'')
    expect(view).toContain('openEventDetail')
    expect(view).toContain('scanAnother')
    const source = readFileSync(path.join(root, 'src/packages/member/mip-events/detail/index.wxml'), 'utf8')
    expect(source).toContain('checkinNotice')
  })
})
