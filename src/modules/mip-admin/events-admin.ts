import type { AdminRosterAllListInput, AdminRosterListInput, MipAdminGateway } from './types'

interface EventsAdminCache {
  query: <T>(key: string, loader: () => Promise<T>, options?: { force?: boolean }) => Promise<T>
  invalidate: (prefix?: string) => void
}

type EventListInput = NonNullable<Parameters<MipAdminGateway['listEvents']>[0]>

export interface MipEventsAdmin {
  list: (
    input?: EventListInput,
    force?: boolean,
  ) => ReturnType<MipAdminGateway['listEvents']>
  get: (
    eventId: Parameters<MipAdminGateway['getEvent']>[0],
    force?: boolean,
  ) => ReturnType<MipAdminGateway['getEvent']>
  getPolicy: (force?: boolean) => ReturnType<MipAdminGateway['getEventPolicy']>
  listRoster: (
    input: AdminRosterListInput,
    force?: boolean,
  ) => ReturnType<MipAdminGateway['listRoster']>
  listRosterAll: (
    input?: AdminRosterAllListInput,
    force?: boolean,
  ) => ReturnType<MipAdminGateway['listRosterAll']>
  listAlbumPhotos: (
    eventId: Parameters<MipAdminGateway['listEventAlbumPhotos']>[0],
    status: Parameters<MipAdminGateway['listEventAlbumPhotos']>[1],
    force?: boolean,
  ) => ReturnType<MipAdminGateway['listEventAlbumPhotos']>
  save: MipAdminGateway['saveEvent']
  changeStatus: MipAdminGateway['changeEventStatus']
  archive: MipAdminGateway['archiveEvent']
  clone: MipAdminGateway['cloneEvent']
  savePolicy: MipAdminGateway['saveEventPolicy']
  publishReminder: MipAdminGateway['publishEventReminder']
  reviewRegistration: MipAdminGateway['reviewRegistration']
  checkIn: MipAdminGateway['checkIn']
  undoCheckIn: MipAdminGateway['undoCheckIn']
  reviewAlbumPhoto: MipAdminGateway['reviewEventAlbumPhoto']
}

const cacheKeys = {
  lists: 'mip-admin:events',
  detail: 'mip-admin:event',
  policy: 'mip-admin:event-policy',
  roster: 'mip-admin:roster',
  rosterAll: 'mip-admin:roster-all',
  album: 'mip-admin:event-album',
  orders: 'mip-admin:orders',
} as const

function inputId(input: Record<string, unknown>, key: string) {
  return typeof input[key] === 'string' ? input[key] : ''
}

export function createMipEventsAdmin(
  gateway: MipAdminGateway,
  cache: EventsAdminCache,
): MipEventsAdmin {
  const invalidateEvent = (eventId: string) => {
    cache.invalidate(cacheKeys.lists)
    if (eventId) {
      cache.invalidate(`${cacheKeys.detail}:${eventId}`)
    }
  }
  const invalidateRoster = (eventId: string) => {
    if (eventId) {
      cache.invalidate(`${cacheKeys.roster}:${eventId}`)
    }
    else {
      cache.invalidate(cacheKeys.roster)
    }
    cache.invalidate(cacheKeys.rosterAll)
  }
  const mutate = async <T>(work: () => Promise<T>, invalidate: () => void) => {
    const result = await work()
    invalidate()
    return result
  }
  const invalidateParticipation = (eventId: string) => {
    invalidateEvent(eventId)
    invalidateRoster(eventId)
  }

  return {
    list: (input: EventListInput = {}, force = false) => cache.query(
      `${cacheKeys.lists}:${JSON.stringify(input)}`,
      () => gateway.listEvents(input),
      { force },
    ),
    get: (eventId, force = false) => cache.query(
      `${cacheKeys.detail}:${eventId}`,
      () => gateway.getEvent(eventId),
      { force },
    ),
    getPolicy: (force = false) => cache.query(cacheKeys.policy, gateway.getEventPolicy, { force }),
    listRoster: (input, force = false) => input.includePhone === true
      ? gateway.listRoster(input)
      : cache.query(
          `${cacheKeys.roster}:${input.eventId}:${JSON.stringify(input)}`,
          () => gateway.listRoster(input),
          { force },
        ),
    listRosterAll: (input: AdminRosterAllListInput = {}, force = false) => input.includePhone === true
      ? gateway.listRosterAll(input)
      : cache.query(
          `${cacheKeys.rosterAll}:${JSON.stringify(input)}`,
          () => gateway.listRosterAll(input),
          { force },
        ),
    listAlbumPhotos: (eventId, status, force = false) => cache.query(
      `${cacheKeys.album}:${eventId}:${status}`,
      () => gateway.listEventAlbumPhotos(eventId, status),
      { force },
    ),
    save: input => mutate(
      () => gateway.saveEvent(input),
      () => {
        const eventId = inputId(input, 'eventId')
        invalidateEvent(eventId)
        if (eventId) {
          cache.invalidate(cacheKeys.rosterAll)
        }
      },
    ),
    changeStatus: input => mutate(
      () => gateway.changeEventStatus(input),
      () => {
        const eventId = inputId(input, 'eventId')
        invalidateEvent(eventId)
        if (input.status === 'CANCELLED') {
          invalidateRoster(eventId)
          cache.invalidate(cacheKeys.orders)
        }
      },
    ),
    archive: input => mutate(
      () => gateway.archiveEvent(input),
      () => invalidateEvent(input.eventId),
    ),
    clone: input => mutate(
      () => gateway.cloneEvent(input),
      () => cache.invalidate(cacheKeys.lists),
    ),
    savePolicy: input => mutate(
      () => gateway.saveEventPolicy(input),
      () => cache.invalidate(cacheKeys.policy),
    ),
    publishReminder: input => gateway.publishEventReminder(input),
    reviewRegistration: input => mutate(
      () => gateway.reviewRegistration(input),
      () => invalidateParticipation(inputId(input, 'eventId')),
    ),
    checkIn: input => mutate(
      () => gateway.checkIn(input),
      () => invalidateParticipation(inputId(input, 'eventId')),
    ),
    undoCheckIn: input => mutate(
      () => gateway.undoCheckIn(input),
      () => invalidateParticipation(inputId(input, 'eventId')),
    ),
    reviewAlbumPhoto: input => mutate(
      () => gateway.reviewEventAlbumPhoto(input),
      () => cache.invalidate(`${cacheKeys.album}:${input.eventId}`),
    ),
  }
}
