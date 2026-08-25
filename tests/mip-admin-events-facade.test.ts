import type { MipEventsAdmin } from '../src/modules/mip-admin/events-admin'
import type {
  AdminEventAlbumPhoto,
  AdminEventDetail,
  AdminRosterAllItem,
  AdminRosterItem,
  MipAdminGateway,
} from '../src/modules/mip-admin/types'
import fs from 'node:fs'
import path from 'node:path'
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

const rosterAllItem: AdminRosterAllItem = {
  ...rosterItem,
  eventId,
  eventTitle: eventDetail.title,
  branchId: eventDetail.branchId,
  branchName: '深圳分会',
}

const albumPhoto: AdminEventAlbumPhoto = {
  id: 'photo-a',
  caption: '活动现场',
  imageUrl: 'cloud://env/event-album/photo-a.jpg',
  nickname: '林然',
  avatarUrl: '',
  status: 'PENDING',
  moderationReason: '',
  version: 1,
  createdAt: '2026-08-25T00:00:00.000Z',
  reviewedAt: null,
  publishedAt: null,
}

const emptyOrderPage = {
  items: [],
  nextCursor: null,
  summary: {
    currency: 'CNY' as const,
    orderCount: 0,
    paidOrderCount: 0,
    eventGrossAmountCents: 0,
    membershipGrossAmountCents: 0,
    grossAmountCents: 0,
    refundedAmountCents: 0,
    netAmountCents: 0,
  },
}

function createHarness() {
  const spies = {
    getSession: vi.fn<MipAdminGateway['getSession']>(async () => ({
      enabled: true,
      capabilities: [],
      roles: [],
    })),
    listEvents: vi.fn<MipAdminGateway['listEvents']>(async () => ({ items: [], nextCursor: null })),
    getEvent: vi.fn<MipAdminGateway['getEvent']>(async id => ({ ...eventDetail, id })),
    getEventPolicy: vi.fn<MipAdminGateway['getEventPolicy']>(async () => ({
      cancellationHoursBeforeStart: 24,
      version: 1,
    })),
    listRoster: vi.fn<MipAdminGateway['listRoster']>(async input => ({
      items: [{ ...rosterItem, phoneNumber: input.includePhone === true ? '18800000000' : null }],
      nextCursor: null,
    })),
    listRosterAll: vi.fn<MipAdminGateway['listRosterAll']>(async input => ({
      items: [{ ...rosterAllItem, phoneNumber: input.includePhone === true ? '18800000000' : null }],
      nextCursor: null,
    })),
    listEventAlbumPhotos: vi.fn<MipAdminGateway['listEventAlbumPhotos']>(async () => ({
      items: [albumPhoto],
      nextCursor: null,
    })),
    listOrders: vi.fn<MipAdminGateway['listOrders']>(async () => emptyOrderPage),
    saveEvent: vi.fn<MipAdminGateway['saveEvent']>(async () => ({ id: eventId, version: 2, status: 'DRAFT' })),
    changeEventStatus: vi.fn<MipAdminGateway['changeEventStatus']>(async input => ({
      id: eventId,
      version: 2,
      status: String(input.status),
    })),
    archiveEvent: vi.fn<MipAdminGateway['archiveEvent']>(async () => ({
      id: eventId,
      version: 2,
      status: 'ARCHIVED',
    })),
    cloneEvent: vi.fn<MipAdminGateway['cloneEvent']>(async () => ({
      id: 'event-clone',
      status: 'DRAFT',
      version: 1,
      startsAt: '2030-09-01T10:00:00.000Z',
      idempotent: false,
    })),
    saveEventPolicy: vi.fn<MipAdminGateway['saveEventPolicy']>(async input => ({
      ...input,
      version: input.version + 1,
    })),
    publishEventReminder: vi.fn<MipAdminGateway['publishEventReminder']>(async () => ({
      publicationId: 'publication-a',
      recipientCount: 1,
      sendWechatReminder: false,
      wechatDelivery: 'NOT_REQUESTED',
      idempotent: false,
    })),
    reviewRegistration: vi.fn<MipAdminGateway['reviewRegistration']>(async () => ({
      id: rosterItem.id,
      status: 'REGISTERED',
      version: 2,
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
    reviewEventAlbumPhoto: vi.fn<MipAdminGateway['reviewEventAlbumPhoto']>(async () => ({
      ...albumPhoto,
      status: 'PUBLISHED',
      version: 2,
    })),
  }
  const gateway = spies as unknown as MipAdminGateway
  return { module: createMipAdminModule(gateway), spies }
}

const eventListInput = {
  filters: { query: '交流', status: 'PUBLISHED', branchId: 'branch-a' },
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
const rosterAllInput = {
  includePhone: false,
  filters: {
    query: '林',
    status: 'REGISTERED' as const,
    eventId,
    branchId: 'branch-a',
    createdFrom: '2026-08-01T00:00:00.000Z',
    createdTo: '2026-08-31T23:59:59.999Z',
  },
  cursor: 'roster-all-cursor-a',
  limit: 25,
}
const orderListInput = { filters: { eventId }, cursor: 'order-cursor-a', limit: 25 }

const saveInput = { eventId, expectedVersion: 1, draft: { title: '更新后的活动' } }
const statusInput = { eventId, expectedVersion: 1, status: 'PUBLISHED' }
const archiveInput = { eventId, expectedVersion: 1, reason: '草稿不再使用' }
const cloneInput = { sourceEventId: eventId, expectedVersion: 1, idempotencyKey: 'clone-event-a' }
const policyInput = { cancellationHoursBeforeStart: 48, version: 1 }
const reminderInput = {
  eventId,
  expectedVersion: 1,
  idempotencyKey: 'reminder-event-a',
  sendWechatReminder: false,
}
const reviewInput = { eventId, registrationId: rosterItem.id, expectedVersion: 1, decision: 'APPROVE' }
const checkInInput = { eventId, registrationId: rosterItem.id, expectedVersion: 1 }
const undoInput = { ...checkInInput, reason: '现场记录修正' }
const albumInput = {
  eventId,
  photoId: albumPhoto.id,
  decision: 'APPROVE' as const,
  reason: '内容符合要求',
  expectedVersion: 1,
}

type QuerySpyName
  = | 'listEvents'
    | 'getEvent'
    | 'getEventPolicy'
    | 'listRoster'
    | 'listRosterAll'
    | 'listEventAlbumPhotos'
    | 'listOrders'
    | 'getSession'

const querySpies: QuerySpyName[] = [
  'listEvents',
  'getEvent',
  'getEventPolicy',
  'listRoster',
  'listRosterAll',
  'listEventAlbumPhotos',
  'listOrders',
  'getSession',
]

interface MutationCase {
  name: string
  execute: (events: MipEventsAdmin) => Promise<unknown>
  spy: Exclude<keyof ReturnType<typeof createHarness>['spies'], QuerySpyName>
  input: unknown
  invalidated: QuerySpyName[]
}

function mutationCases(): MutationCase[] {
  return [
    {
      name: 'save',
      execute: events => events.save(saveInput),
      spy: 'saveEvent',
      input: saveInput,
      invalidated: ['listEvents', 'getEvent', 'listRosterAll'],
    },
    {
      name: 'changeStatus',
      execute: events => events.changeStatus(statusInput),
      spy: 'changeEventStatus',
      input: statusInput,
      invalidated: ['listEvents', 'getEvent'],
    },
    {
      name: 'archive',
      execute: events => events.archive(archiveInput),
      spy: 'archiveEvent',
      input: archiveInput,
      invalidated: ['listEvents', 'getEvent'],
    },
    {
      name: 'clone',
      execute: events => events.clone(cloneInput),
      spy: 'cloneEvent',
      input: cloneInput,
      invalidated: ['listEvents'],
    },
    {
      name: 'savePolicy',
      execute: events => events.savePolicy(policyInput),
      spy: 'saveEventPolicy',
      input: policyInput,
      invalidated: ['getEventPolicy'],
    },
    {
      name: 'publishReminder',
      execute: events => events.publishReminder(reminderInput),
      spy: 'publishEventReminder',
      input: reminderInput,
      invalidated: [],
    },
    {
      name: 'reviewRegistration',
      execute: events => events.reviewRegistration(reviewInput),
      spy: 'reviewRegistration',
      input: reviewInput,
      invalidated: ['listEvents', 'getEvent', 'listRoster', 'listRosterAll'],
    },
    {
      name: 'checkIn',
      execute: events => events.checkIn(checkInInput),
      spy: 'checkIn',
      input: checkInInput,
      invalidated: ['listEvents', 'getEvent', 'listRoster', 'listRosterAll'],
    },
    {
      name: 'undoCheckIn',
      execute: events => events.undoCheckIn(undoInput),
      spy: 'undoCheckIn',
      input: undoInput,
      invalidated: ['listEvents', 'getEvent', 'listRoster', 'listRosterAll'],
    },
    {
      name: 'reviewAlbumPhoto',
      execute: events => events.reviewAlbumPhoto(albumInput),
      spy: 'reviewEventAlbumPhoto',
      input: albumInput,
      invalidated: ['listEventAlbumPhotos'],
    },
  ]
}

async function warmQueries(module: ReturnType<typeof createHarness>['module']) {
  await Promise.all([
    module.events.list(eventListInput),
    module.events.get(eventId),
    module.events.getPolicy(),
    module.events.listRoster(rosterInput),
    module.events.listRosterAll(rosterAllInput),
    module.events.listAlbumPhotos(eventId, 'PENDING'),
    module.orders.list(orderListInput),
    module.getSession(),
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

    await module.events.listRosterAll(rosterAllInput)
    await module.events.listRosterAll(rosterAllInput)
    await module.events.listRosterAll({ ...rosterAllInput, cursor: 'roster-all-cursor-b' })
    await module.events.listRosterAll({ ...rosterAllInput, limit: 50 })
    await module.events.listRosterAll({
      ...rosterAllInput,
      filters: { ...rosterAllInput.filters, branchId: 'branch-b' },
    })

    expect(spies.listEvents).toHaveBeenCalledTimes(4)
    expect(spies.listRoster).toHaveBeenCalledTimes(4)
    expect(spies.listRosterAll).toHaveBeenCalledTimes(4)
    expect(spies.listEvents.mock.calls[0]?.[0]).toBe(eventListInput)
    expect(spies.listRoster.mock.calls[0]?.[0]).toBe(rosterInput)
    expect(spies.listRosterAll.mock.calls[0]?.[0]).toBe(rosterAllInput)
  })

  it('never caches phone-bearing roster or cross-event roster responses', async () => {
    const { module, spies } = createHarness()
    const sensitiveRoster = { ...rosterInput, includePhone: true }
    const sensitiveRosterAll = { ...rosterAllInput, includePhone: true }

    await expect(module.events.listRoster(sensitiveRoster)).resolves.toMatchObject({
      items: [{ phoneNumber: '18800000000' }],
    })
    await module.events.listRoster(sensitiveRoster)
    await expect(module.events.listRosterAll(sensitiveRosterAll)).resolves.toMatchObject({
      items: [{ phoneNumber: '18800000000' }],
    })
    await module.events.listRosterAll(sensitiveRosterAll)
    await expect(module.events.listRoster(rosterInput)).resolves.toMatchObject({ items: [{ phoneNumber: null }] })
    await module.events.listRoster(rosterInput)
    await expect(module.events.listRosterAll(rosterAllInput)).resolves.toMatchObject({ items: [{ phoneNumber: null }] })
    await module.events.listRosterAll(rosterAllInput)

    expect(spies.listRoster).toHaveBeenCalledTimes(3)
    expect(spies.listRosterAll).toHaveBeenCalledTimes(3)
    expect(spies.listRoster.mock.calls[0]?.[0]).toBe(sensitiveRoster)
    expect(spies.listRosterAll.mock.calls[0]?.[0]).toBe(sensitiveRosterAll)
  })

  it('keeps every legacy query alias on the facade cache', async () => {
    const { module, spies } = createHarness()

    await module.listEvents(eventListInput)
    await module.events.list(eventListInput)
    await module.getEvent(eventId)
    await module.events.get(eventId)
    await module.getEventPolicy()
    await module.events.getPolicy()
    await module.listRoster(rosterInput)
    await module.events.listRoster(rosterInput)
    await module.listRosterAll(rosterAllInput)
    await module.events.listRosterAll(rosterAllInput)
    await module.listEventAlbumPhotos(eventId, 'PENDING')
    await module.events.listAlbumPhotos(eventId, 'PENDING')

    expect(spies.listEvents).toHaveBeenCalledTimes(1)
    expect(spies.getEvent).toHaveBeenCalledTimes(1)
    expect(spies.getEventPolicy).toHaveBeenCalledTimes(1)
    expect(spies.listRoster).toHaveBeenCalledTimes(1)
    expect(spies.listRosterAll).toHaveBeenCalledTimes(1)
    expect(spies.listEventAlbumPhotos).toHaveBeenCalledTimes(1)
  })

  it('passes every event mutation input to the neutral gateway unchanged', async () => {
    const { module, spies } = createHarness()

    for (const mutation of mutationCases()) {
      await mutation.execute(module.events)
      expect(spies[mutation.spy].mock.calls[0]?.[0]).toBe(mutation.input)
    }
  })

  for (const mutation of mutationCases()) {
    it(`invalidates only real query dependencies after ${mutation.name}`, async () => {
      const { module, spies } = createHarness()
      await warmQueries(module)
      await warmQueries(module)

      await mutation.execute(module.events)
      await warmQueries(module)

      for (const query of querySpies) {
        expect(spies[query]).toHaveBeenCalledTimes(mutation.invalidated.includes(query) ? 2 : 1)
      }
    })
  }

  it('invalidates roster and orders only when a status change cancels the event', async () => {
    const { module, spies } = createHarness()
    const cancelInput = { eventId, expectedVersion: 1, status: 'CANCELLED', reason: '活动安排变化' }
    await warmQueries(module)
    await warmQueries(module)

    await module.events.changeStatus(cancelInput)
    await warmQueries(module)

    for (const query of querySpies) {
      const invalidated = ['listEvents', 'getEvent', 'listRoster', 'listRosterAll', 'listOrders'].includes(query)
      expect(spies[query]).toHaveBeenCalledTimes(invalidated ? 2 : 1)
    }
    expect(spies.changeEventStatus.mock.calls[0]?.[0]).toBe(cancelInput)
  })

  it.each([
    ['saveEvent', new MipAdminError('CONFLICT', '活动已被其他管理员更新')],
    ['reviewEventAlbumPhoto', new MipAdminError('FORBIDDEN', '当前账号不能审核相册')],
  ] as const)('keeps cached reads and the original %s failure', async (name, failure) => {
    const { module, spies } = createHarness()
    spies[name].mockRejectedValueOnce(failure)
    await warmQueries(module)

    const work = name === 'saveEvent'
      ? module.events.save(saveInput)
      : module.events.reviewAlbumPhoto(albumInput)
    await expect(work).rejects.toBe(failure)
    await warmQueries(module)

    for (const query of querySpies) {
      expect(spies[query]).toHaveBeenCalledTimes(1)
    }
  })

  it('keeps all event administration pages behind typed module boundaries', () => {
    const root = path.resolve(import.meta.dirname, '..')
    const pages = [
      'src/packages/admin/events/index.ts',
      'src/packages/admin/managed-events/index.ts',
      'src/packages/admin/event-console/index.ts',
      'src/packages/admin/event-registrations/index.ts',
      'src/packages/admin/event-participants/index.ts',
      'src/packages/admin/event-album/index.ts',
      'src/packages/admin/event-feedback/index.ts',
      'src/packages/admin/event-managers/index.ts',
    ]
    const sources: string[] = []
    for (const page of pages) {
      const source = fs.readFileSync(path.join(root, page), 'utf8')
      sources.push(source)
      expect(source).toContain('mipAdminModule.events.')
      expect(source).not.toContain('mipAdminModule.gateway')
      expect(source).not.toContain('mipAdminModule.mutate')
    }
    const calls = new Set([...sources.join('\n').matchAll(
      /mipAdminModule\.events\.(save|changeStatus|archive|clone|savePolicy|publishReminder|reviewRegistration|checkIn|undoCheckIn|reviewAlbumPhoto)\(/g,
    )].map(match => match[1]))
    expect([...calls].sort()).toEqual([
      'archive',
      'changeStatus',
      'checkIn',
      'clone',
      'publishReminder',
      'reviewAlbumPhoto',
      'reviewRegistration',
      'save',
      'savePolicy',
      'undoCheckIn',
    ].sort())
    expect(sources.join('\n')).toContain('mipAdminModule.governance.setRole(')
    expect(sources.join('\n')).toContain('mipAdminModule.exportAndOpen(')
  })
})
