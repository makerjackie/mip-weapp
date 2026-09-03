import type { AdminRosterListInput, MipAdminGateway } from './types'

export type EventsAdminGateway = Pick<
  MipAdminGateway,
  'listEvents' | 'getEvent' | 'listRoster' | 'checkIn' | 'undoCheckIn'
>

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
  listRoster: (
    input: AdminRosterListInput,
    force?: boolean,
  ) => ReturnType<MipAdminGateway['listRoster']>
  checkIn: MipAdminGateway['checkIn']
  undoCheckIn: MipAdminGateway['undoCheckIn']
}

const cacheKeys = {
  lists: 'mip-admin:events',
  detail: 'mip-admin:event',
  roster: 'mip-admin:roster',
} as const

function inputId(input: Record<string, unknown>, key: string) {
  return typeof input[key] === 'string' ? input[key] : ''
}

export function createMipEventsAdmin(
  gateway: EventsAdminGateway,
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
  }
  const invalidateParticipation = (eventId: string) => {
    invalidateEvent(eventId)
    invalidateRoster(eventId)
  }
  const mutate = async <T>(work: () => Promise<T>, invalidate: () => void) => {
    const result = await work()
    invalidate()
    return result
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
    listRoster: (input, force = false) => input.includePhone === true
      ? gateway.listRoster(input)
      : cache.query(
          `${cacheKeys.roster}:${input.eventId}:${JSON.stringify(input)}`,
          () => gateway.listRoster(input),
          { force },
        ),
    checkIn: input => mutate(
      () => gateway.checkIn(input),
      () => invalidateParticipation(inputId(input, 'eventId')),
    ),
    undoCheckIn: input => mutate(
      () => gateway.undoCheckIn(input),
      () => invalidateParticipation(inputId(input, 'eventId')),
    ),
  }
}
