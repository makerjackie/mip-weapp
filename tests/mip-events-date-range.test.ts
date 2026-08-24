import type { EventId } from '../src/modules/mip'
import type { EventFeedResult, MipEventDetail, MipEventsGateway } from '../src/modules/mip-events'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createMipEventsModule } from '../src/modules/mip-events'

const eventId = 'event-1' as EventId
const event: MipEventDetail = {
  id: eventId,
  scopeType: 'PLATFORM',
  title: '活动',
  summary: '摘要',
  description: '介绍',
  eventTypeLabel: '交流活动',
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
  canCheckIn: false,
  canInteract: false,
  albumEnabled: false,
  albumSubmissionPolicy: 'REVIEW',
}

function gateway() {
  const feed: EventFeedResult = { items: [event] }
  return {
    listEvents: vi.fn(async () => feed),
    getEvent: vi.fn(async () => event),
  } as unknown as MipEventsGateway
}

describe('MIP event date range client contract', () => {
  it('keeps an explicit active-filter label for a selected range', () => {
    const page = readFileSync(new URL('../src/pages/events/index.ts', import.meta.url), 'utf8')
    const view = readFileSync(new URL('../src/pages/events/index.wxml', import.meta.url), 'utf8')
    expect(page).toContain('customDateLabel: this.data.dateToLabel')
    expect(page).toContain('customDateLabel: this.data.dateFromLabel')
    expect(view).toContain('{{customDateLabel || \'自定义日期\'}}')
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

    await module.listEvents({ view: 'UPCOMING', dateFilter: 'CUSTOM', date: '2026-08-24' })
    expect(eventGateway.listEvents).toHaveBeenLastCalledWith(expect.objectContaining({
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
