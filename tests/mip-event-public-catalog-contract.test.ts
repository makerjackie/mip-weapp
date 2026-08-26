import type { EventVideoRecap, MipEventDetail, MipEventListItem, MipEventsGateway } from '../src/modules/mip-events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMipEventsModule } from '../src/modules/mip-events'
import {
  cloudbaseMipEventsGateway,
} from '../src/modules/mip-events/cloudbase-gateway'
import {
  parseEventFeedResult,
  parseMipEventDetail,
  parseMipEventListItem,
} from '../src/modules/mip-events/dto'
import { requireCloudClient } from '../src/modules/platform/cloudbase'

vi.mock('../src/modules/platform/cloudbase', () => ({ requireCloudClient: vi.fn() }))
vi.mock('../src/config/runtime', () => ({
  runtimeConfig: { cloudbase: { eventsFunctionName: 'mip-events-api' } },
}))

const eventId = '11111111-1111-4111-8111-111111111111'
const recap: EventVideoRecap = {
  id: '22222222-2222-4222-8222-222222222222',
  title: '活动回顾',
  summary: '查看本次活动视频',
  destination: {
    provider: 'WECHAT_CHANNELS',
    type: 'ACTIVITY',
    finderUserName: 'sphMIP2026',
    feedId: 'feed-token-1',
  },
}

function eventListItem(): MipEventListItem {
  return {
    id: eventId as never,
    scopeType: 'PLATFORM',
    title: '公开活动',
    summary: '活动摘要',
    eventTypeLabel: '社区活动',
    tags: ['创业', '线下'],
    videoRecaps: [recap],
    mode: 'OFFLINE',
    accessType: 'FREE',
    startsAt: '2030-08-25T00:00:00.000Z',
    endsAt: '2030-08-25T02:00:00.000Z',
    cityName: '深圳',
    venueName: 'MIP 空间',
    status: 'PUBLISHED',
    capacity: 20,
    registrationCount: 5,
    participantPreview: [],
    albumEnabled: false,
  }
}

function eventDetail(): MipEventDetail {
  return {
    ...eventListItem(),
    description: '活动介绍',
    contentMedia: [],
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
    albumSubmissionPolicy: 'REVIEW',
  }
}

describe('MIP public event catalog and recap client contract', () => {
  const callFunction = vi.fn()

  beforeEach(() => {
    callFunction.mockReset()
    vi.mocked(requireCloudClient).mockResolvedValue({ callFunction } as never)
  })

  it('strictly parses the public list and detail DTOs', () => {
    expect(parseMipEventListItem(eventListItem())).toEqual(eventListItem())
    expect(parseEventFeedResult({ items: [eventListItem()], cities: ['深圳'] })).toEqual({
      items: [eventListItem()],
      cities: ['深圳'],
    })
    expect(parseMipEventDetail(eventDetail())).toEqual(eventDetail())
  })

  it('preserves registered DRAFT and UNPUBLISHED activity states while bounding feeds to 30 items', () => {
    for (const status of ['DRAFT', 'UNPUBLISHED'] as const) {
      expect(parseMipEventListItem({ ...eventListItem(), status }).status).toBe(status)
      expect(parseMipEventDetail({ ...eventDetail(), status }).status).toBe(status)
    }
    expect(() => parseEventFeedResult({
      items: Array.from({ length: 31 }, () => eventListItem()),
    })).toThrowError(expect.objectContaining({ code: 'INVALID_RESPONSE' }))
  })

  it('routes list and detail through the strict parsers', async () => {
    callFunction
      .mockResolvedValueOnce({ result: { ok: true, data: { items: [eventListItem()] } } })
      .mockResolvedValueOnce({ result: { ok: true, data: eventDetail() } })

    await expect(cloudbaseMipEventsGateway.listEvents({
      view: 'UPCOMING',
      dateFilter: 'RECENT',
    })).resolves.toEqual({ items: [eventListItem()] })
    await expect(cloudbaseMipEventsGateway.getEvent(eventId as never)).resolves.toEqual(eventDetail())

    expect(callFunction).toHaveBeenNthCalledWith(1, {
      name: 'mip-events-api',
      data: {
        action: 'mip.events.list',
        query: { view: 'UPCOMING', dateFilter: 'RECENT' },
      },
    })
    expect(callFunction).toHaveBeenNthCalledWith(2, {
      name: 'mip-events-api',
      data: { action: 'mip.events.detail', eventId },
    })
  })

  it('keeps catalog and recap facts through the event facade and cache', async () => {
    const gateway = {
      listEvents: vi.fn(async () => ({ items: [eventListItem()] })),
      getEvent: vi.fn(async () => eventDetail()),
    } as unknown as MipEventsGateway
    const module = createMipEventsModule(gateway)

    await expect(module.listEvents({ view: 'UPCOMING', dateFilter: 'RECENT' }))
      .resolves
      .toMatchObject({ items: [{ eventTypeLabel: '社区活动', tags: ['创业', '线下'] }] })
    await expect(module.getEvent(eventId as never))
      .resolves
      .toMatchObject({ videoRecaps: [recap] })
    expect(module.peekEvent(eventId as never)?.videoRecaps).toEqual([recap])
  })

  it('rejects admin fields, inactive metadata, malformed targets, and unknown root fields', async () => {
    const leakedRecap = { ...recap, status: 'ACTIVE', version: 2 }
    expect(() => parseMipEventListItem({
      ...eventListItem(),
      videoRecaps: [leakedRecap],
    })).toThrowError(expect.objectContaining({ code: 'INVALID_RESPONSE' }))
    expect(() => parseMipEventListItem({
      ...eventListItem(),
      videoRecaps: [{
        ...recap,
        destination: { ...recap.destination, type: 'PROFILE', feedId: 'feed-token-1' },
      }],
    })).toThrowError(expect.objectContaining({ code: 'INVALID_RESPONSE' }))
    expect(() => parseMipEventDetail({
      ...eventDetail(),
      archivedAt: '2030-08-25T00:00:00.000Z',
    })).toThrowError(expect.objectContaining({ code: 'INVALID_RESPONSE' }))

    callFunction.mockResolvedValueOnce({
      result: {
        ok: true,
        data: { items: [{ ...eventListItem(), internalTypeKey: 'community' }] },
      },
    })
    await expect(cloudbaseMipEventsGateway.listEvents({
      view: 'UPCOMING',
      dateFilter: 'RECENT',
    })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })
})
