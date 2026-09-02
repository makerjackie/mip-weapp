import type { EventFeedResult, MipEventsGateway } from '../src/modules/mip-events'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMipEventsModule, parseEventDiscoveryFilters } from '../src/modules/mip-events'
import { cloudbaseMipEventsGateway } from '../src/modules/mip-events/cloudbase-gateway'
import { requireCloudClient } from '../src/platform/cloudbase/client'

vi.mock('../src/platform/cloudbase/client', () => ({ requireCloudClient: vi.fn() }))
vi.mock('../src/config/runtime', () => ({
  runtimeConfig: { cloudbase: { eventsFunctionName: 'mip-events-api' } },
}))

describe('MIP event discovery filter client', () => {
  const callFunction = vi.fn()

  beforeEach(() => {
    callFunction.mockReset()
    vi.mocked(requireCloudClient).mockResolvedValue({ callFunction } as never)
  })

  it('strictly parses public type and tag options without accepting admin metadata', () => {
    const filters = {
      eventTypes: [{ key: 'community', name: '社区活动' }],
      tags: [{ key: 'ai', name: '人工智能' }, { key: 'networking', name: '资源链接' }],
    }
    expect(parseEventDiscoveryFilters(filters)).toEqual(filters)
    expect(() => parseEventDiscoveryFilters({
      ...filters,
      eventTypes: [{ key: 'community', name: '社区活动', version: 2 }],
    })).toThrowError(expect.objectContaining({ code: 'INVALID_RESPONSE' }))
    expect(() => parseEventDiscoveryFilters({
      ...filters,
      tags: [{ key: 'INVALID KEY', name: '无效' }],
    })).toThrowError(expect.objectContaining({ code: 'INVALID_RESPONSE' }))
    expect(() => parseEventDiscoveryFilters({
      ...filters,
      tags: [{ key: 'ai', name: '人工智能' }, { key: 'ai', name: '重复' }],
    })).toThrowError(expect.objectContaining({ code: 'INVALID_RESPONSE' }))
  })

  it('uses a dedicated public action and strict response parser', async () => {
    const filters = {
      eventTypes: [{ key: 'workshop', name: '共创工作坊' }],
      tags: [{ key: 'ai', name: '人工智能' }],
    }
    callFunction.mockResolvedValueOnce({ result: { ok: true, data: filters } })
    await expect(cloudbaseMipEventsGateway.getDiscoveryFilters!()).resolves.toEqual(filters)
    expect(callFunction).toHaveBeenCalledWith({
      name: 'mip-events-api',
      data: { action: 'mip.events.discoveryFilters' },
    })

    callFunction.mockResolvedValueOnce({
      result: { ok: true, data: { ...filters, internalIds: ['must-not-leak'] } },
    })
    await expect(cloudbaseMipEventsGateway.getDiscoveryFilters!())
      .rejects
      .toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('normalizes every filter before transport and caches the public catalog', async () => {
    const feed: EventFeedResult = { items: [] }
    const gateway = {
      listEvents: vi.fn(async () => feed),
      getDiscoveryFilters: vi.fn(async () => ({
        eventTypes: [{ key: 'community', name: '社区活动' }],
        tags: [{ key: 'ai', name: '人工智能' }],
      })),
    } as unknown as MipEventsGateway
    const module = createMipEventsModule(gateway)

    await module.listEvents({
      view: 'UPCOMING',
      dateFilter: 'RECENT',
      eventTypeKey: ' community ',
      tagKeys: ['networking', 'ai', 'ai'],
      accessType: 'MEMBER_INCLUDED',
      sortDirection: 'DESC',
    })
    expect(gateway.listEvents).toHaveBeenCalledWith(expect.objectContaining({
      eventTypeKey: 'community',
      tagKeys: ['ai', 'networking'],
      accessType: 'MEMBER_INCLUDED',
      sortDirection: 'DESC',
    }))
    await module.getDiscoveryFilters()
    await module.getDiscoveryFilters()
    expect(gateway.getDiscoveryFilters).toHaveBeenCalledTimes(1)
    expect(module.peekDiscoveryFilters()).toEqual({
      eventTypes: [{ key: 'community', name: '社区活动' }],
      tags: [{ key: 'ai', name: '人工智能' }],
    })

    await expect(module.listEvents({
      view: 'UPCOMING',
      dateFilter: 'RECENT',
      eventTypeKey: 'INVALID TYPE',
    })).rejects.toThrow('活动类型筛选参数无效')
    await expect(module.listEvents({
      view: 'UPCOMING',
      dateFilter: 'RECENT',
      sortDirection: 'SIDEWAYS' as never,
    })).rejects.toThrow('活动排序参数无效')
  })

  it('renders catalog filters, real event tags, and a rolling calendar that reaches long-lived demo events', () => {
    const page = readFileSync(new URL('../src/pages/events/index.ts', import.meta.url), 'utf8')
    const view = readFileSync(new URL('../src/pages/events/index.wxml', import.meta.url), 'utf8')
    const card = readFileSync(new URL('../src/components/event-card/index.wxml', import.meta.url), 'utf8')
    expect(page).toContain('calendarMaxDate: rollingCalendarBoundary(10)')
    expect(page).toContain('eventTypeKey: this.data.selectedEventTypeKey')
    expect(page).toContain('tagKeys: this.data.selectedTagKeys.length')
    expect(page).toContain('sortDirection: this.data.selectedSortDirection')
    expect(view).toContain('活动类型')
    expect(view).toContain('活动标签')
    expect(view).toContain('开始时间排序')
    expect(view).toContain('<event-card')
    expect(card).not.toContain('event.displayTags')
    expect(card).toContain('event.accessLabel')
    expect(card).toContain('event.eventTypeLabel')
    expect(view).not.toContain('item.selected ?')
  })
})
