import type {
  AdminEventDetail,
  AdminEventListInput,
  AdminRosterItem,
  MipAdminGateway,
} from '../src/modules/mip-admin/types'
import { describe, expect, it, vi } from 'vitest'
import { createMipAdminModule } from '../src/modules/mip-admin/client'
import { MipAdminError } from '../src/modules/mip-admin/types'

const eventId = 'event-a'

const eventDetail: AdminEventDetail = {
  id: eventId,
  scopeType: 'BRANCH',
  branchId: 'branch-a',
  title: '八月交流活动',
  summary: '活动摘要',
  description: '活动介绍',
  contentMedia: [],
  notices: '准时参加',
  coverAssetId: null,
  coverUrl: '',
  eventTypeKey: 'networking',
  eventMode: 'OFFLINE',
  accessType: 'FREE',
  registrationPolicy: 'APPROVAL',
  albumEnabled: true,
  albumSubmissionPolicy: 'REVIEW',
  startsAt: '2030-08-25T10:00:00.000Z',
  endsAt: '2030-08-25T12:00:00.000Z',
  registrationDeadline: '2030-08-24T10:00:00.000Z',
  cancellationDeadline: '2030-08-24T10:00:00.000Z',
  venueName: '活动中心',
  address: '深圳市南山区',
  cityName: '深圳',
  latitude: null,
  longitude: null,
  onlineUrl: '',
  capacity: 30,
  waitlistEnabled: true,
  priceCents: 0,
  registrationSchema: [],
  status: 'PUBLISHED',
  contentSafetyStatus: 'PASSED',
  version: 1,
}

const rosterItem: AdminRosterItem = {
  id: 'registration-a',
  nickname: '林然',
  cityName: '深圳',
  status: 'REGISTERED',
  answers: {},
  answerItems: [],
  phoneBound: true,
  phoneNumber: null,
  submittedAt: '2026-08-20T00:00:00.000Z',
  registeredAt: '2026-08-21T00:00:00.000Z',
  checkedInAt: null,
  version: 1,
}

function createHarness() {
  const spies = {
    getSession: vi.fn<MipAdminGateway['getSession']>(async () => ({
      enabled: true,
      capabilities: [],
      roles: [],
    })),
    confirmWebLogin: vi.fn<MipAdminGateway['confirmWebLogin']>(),
    listEvents: vi.fn<MipAdminGateway['listEvents']>(async () => ({ items: [], nextCursor: null })),
    getEvent: vi.fn<MipAdminGateway['getEvent']>(async id => ({ ...eventDetail, id })),
    listRoster: vi.fn<MipAdminGateway['listRoster']>(async input => ({
      items: [{ ...rosterItem, phoneNumber: input.includePhone === true ? '18800000000' : null }],
      nextCursor: null,
    })),
    checkIn: vi.fn<MipAdminGateway['checkIn']>(async () => ({
      id: rosterItem.id,
      status: 'ATTENDED',
      version: 2,
      idempotent: false,
    })),
    undoCheckIn: vi.fn<MipAdminGateway['undoCheckIn']>(async () => ({
      id: rosterItem.id,
      status: 'REGISTERED',
      version: 2,
    })),
  }
  const gateway = spies as unknown as MipAdminGateway
  return { module: createMipAdminModule(gateway), spies }
}

const eventListInput: AdminEventListInput = {
  filters: {
    query: '交流',
    status: 'PUBLISHED',
    startsFrom: '2030-08-01T00:00:00.000Z',
    startsTo: '2030-08-31T23:59:59.999Z',
    cityOrBranch: '深圳分会',
    branchId: 'branch-a',
    eventTypeKey: 'networking',
    accessType: 'FREE',
    priceMinCents: 0,
    priceMaxCents: 5000,
  },
  sort: { field: 'startsAt', direction: 'ASC' },
  cursor: 'event-cursor-a',
  limit: 25,
}
const rosterInput = {
  eventId,
  includePhone: false,
  filters: { query: '林', status: 'REGISTERED' as const },
  cursor: 'roster-cursor-a',
  limit: 25,
}

const checkInInput = { eventId, registrationId: rosterItem.id, expectedVersion: 1 }
const undoInput = { ...checkInInput, reason: '现场记录修正' }

type QuerySpyName = 'listEvents' | 'getEvent' | 'listRoster' | 'getSession'

const querySpies: QuerySpyName[] = [
  'listEvents',
  'getEvent',
  'listRoster',
  'getSession',
]

async function warmQueries(module: ReturnType<typeof createHarness>['module']) {
  await Promise.all([
    module.events.list(eventListInput),
    module.events.get(eventId),
    module.events.listRoster(rosterInput),
    module.session.get(),
  ])
}

describe('MIP admin events facade', () => {
  it('uses complete filters, cursors, and limits for ordinary cached reads', async () => {
    const { module, spies } = createHarness()

    await module.events.list(eventListInput)
    await module.events.list(eventListInput)
    await module.events.list({ ...eventListInput, cursor: 'event-cursor-b' })
    await module.events.list({ ...eventListInput, limit: 50 })
    await module.events.list({ ...eventListInput, filters: { ...eventListInput.filters, status: 'ENDED' } })

    await module.events.listRoster(rosterInput)
    await module.events.listRoster(rosterInput)
    await module.events.listRoster({ ...rosterInput, cursor: 'roster-cursor-b' })
    await module.events.listRoster({ ...rosterInput, limit: 50 })
    await module.events.listRoster({ ...rosterInput, filters: { ...rosterInput.filters, status: 'ATTENDED' } })

    expect(spies.listEvents).toHaveBeenCalledTimes(4)
    expect(spies.listRoster).toHaveBeenCalledTimes(4)
    expect(spies.listEvents.mock.calls[0]?.[0]).toBe(eventListInput)
    expect(spies.listRoster.mock.calls[0]?.[0]).toBe(rosterInput)
  })

  it('never caches phone-bearing roster responses', async () => {
    const { module, spies } = createHarness()
    const sensitiveRoster = { ...rosterInput, includePhone: true }

    await expect(module.events.listRoster(sensitiveRoster)).resolves.toMatchObject({
      items: [{ phoneNumber: '18800000000' }],
    })
    await module.events.listRoster(sensitiveRoster)
    await expect(module.events.listRoster(rosterInput)).resolves.toMatchObject({ items: [{ phoneNumber: null }] })
    await module.events.listRoster(rosterInput)

    expect(spies.listRoster).toHaveBeenCalledTimes(3)
    expect(spies.listRoster.mock.calls[0]?.[0]).toBe(sensitiveRoster)
  })

  it('keeps every query on the facade cache', async () => {
    const { module, spies } = createHarness()

    await module.events.list(eventListInput)
    await module.events.list(eventListInput)
    await module.events.get(eventId)
    await module.events.get(eventId)
    await module.events.listRoster(rosterInput)
    await module.events.listRoster(rosterInput)

    expect(spies.listEvents).toHaveBeenCalledTimes(1)
    expect(spies.getEvent).toHaveBeenCalledTimes(1)
    expect(spies.listRoster).toHaveBeenCalledTimes(1)
  })

  it('passes every event mutation input to the neutral gateway unchanged', async () => {
    const { module, spies } = createHarness()

    await module.events.checkIn(checkInInput)
    expect(spies.checkIn.mock.calls[0]?.[0]).toBe(checkInInput)

    await module.events.undoCheckIn(undoInput)
    expect(spies.undoCheckIn.mock.calls[0]?.[0]).toBe(undoInput)
  })

  it('invalidates only real query dependencies after a check-in mutation', async () => {
    const { module, spies } = createHarness()
    await warmQueries(module)
    await warmQueries(module)

    await module.events.checkIn(checkInInput)
    await warmQueries(module)

    for (const query of querySpies) {
      const invalidated = query !== 'getSession'
      expect(spies[query]).toHaveBeenCalledTimes(invalidated ? 2 : 1)
    }
  })

  it('invalidates only real query dependencies after an undo mutation', async () => {
    const { module, spies } = createHarness()
    await warmQueries(module)
    await warmQueries(module)

    await module.events.undoCheckIn(undoInput)
    await warmQueries(module)

    for (const query of querySpies) {
      const invalidated = query !== 'getSession'
      expect(spies[query]).toHaveBeenCalledTimes(invalidated ? 2 : 1)
    }
  })

  it('keeps cached reads and the original checkIn failure', async () => {
    const { module, spies } = createHarness()
    const failure = new MipAdminError('CONFLICT', '签到状态已变化')
    spies.checkIn.mockRejectedValueOnce(failure)
    await warmQueries(module)

    await expect(module.events.checkIn(checkInInput)).rejects.toBe(failure)
    expect(spies.checkIn).toHaveBeenCalledTimes(1)
    await warmQueries(module)

    for (const query of querySpies) {
      expect(spies[query]).toHaveBeenCalledTimes(1)
    }
  })
})
