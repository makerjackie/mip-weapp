import type { MipAdminGateway } from './types'

interface EventCatalogAdminCache {
  query: <T>(key: string, loader: () => Promise<T>, options?: { force?: boolean }) => Promise<T>
  invalidate: (prefix?: string) => void
}

type CatalogListInput = Parameters<MipAdminGateway['listEventCatalogs']>[0]
type RecapListInput = NonNullable<Parameters<MipAdminGateway['listEventVideoRecaps']>[0]>

export interface MipEventCatalogAdmin {
  listCatalogs: (
    input: CatalogListInput,
    force?: boolean,
  ) => ReturnType<MipAdminGateway['listEventCatalogs']>
  saveCatalog: MipAdminGateway['saveEventCatalog']
  changeCatalogStatus: MipAdminGateway['changeEventCatalogStatus']
  archiveCatalog: MipAdminGateway['archiveEventCatalog']
  getTagAssignments: (
    eventId: Parameters<MipAdminGateway['getEventTagAssignments']>[0],
    force?: boolean,
  ) => ReturnType<MipAdminGateway['getEventTagAssignments']>
  replaceTagAssignments: MipAdminGateway['replaceEventTagAssignments']
  listRecaps: (
    input?: RecapListInput,
    force?: boolean,
  ) => ReturnType<MipAdminGateway['listEventVideoRecaps']>
  getRecap: (
    recapId: Parameters<MipAdminGateway['getEventVideoRecap']>[0],
    force?: boolean,
  ) => ReturnType<MipAdminGateway['getEventVideoRecap']>
  saveRecap: MipAdminGateway['saveEventVideoRecap']
  changeRecapStatus: MipAdminGateway['changeEventVideoRecapStatus']
  archiveRecap: MipAdminGateway['archiveEventVideoRecap']
}

const catalogKey = 'mip-admin:event-catalogs'
const recapListKey = 'mip-admin:event-video-recaps'
const recapKey = 'mip-admin:event-video-recap'
const tagAssignmentsKey = 'mip-admin:event-tag-assignments'

export function createMipEventCatalogAdmin(
  gateway: MipAdminGateway,
  cache: EventCatalogAdminCache,
): MipEventCatalogAdmin {
  const mutate = async <T>(prefixes: readonly string[], work: () => Promise<T>) => {
    const result = await work()
    for (const prefix of prefixes) {
      cache.invalidate(prefix)
    }
    return result
  }
  const invalidateCatalogs = [catalogKey]
  const invalidateRecaps = [recapListKey, recapKey]

  return {
    listCatalogs: (input, force = false) => cache.query(
      `${catalogKey}:${JSON.stringify(input)}`,
      () => gateway.listEventCatalogs(input),
      { force },
    ),
    saveCatalog: input => mutate(invalidateCatalogs, () => gateway.saveEventCatalog(input)),
    changeCatalogStatus: input => mutate(
      invalidateCatalogs,
      () => gateway.changeEventCatalogStatus(input),
    ),
    archiveCatalog: input => mutate(
      invalidateCatalogs,
      () => gateway.archiveEventCatalog(input),
    ),
    getTagAssignments: (eventId, force = false) => cache.query(
      `${tagAssignmentsKey}:${eventId}`,
      () => gateway.getEventTagAssignments(eventId),
      { force },
    ),
    replaceTagAssignments: input => mutate(
      [tagAssignmentsKey, catalogKey, 'mip-admin:event', 'mip-admin:events'],
      () => gateway.replaceEventTagAssignments(input),
    ),
    listRecaps: (input: RecapListInput = {}, force = false) => cache.query(
      `${recapListKey}:${JSON.stringify(input)}`,
      () => gateway.listEventVideoRecaps(input),
      { force },
    ),
    getRecap: (recapId, force = false) => cache.query(
      `${recapKey}:${recapId}`,
      () => gateway.getEventVideoRecap(recapId),
      { force },
    ),
    saveRecap: input => mutate(invalidateRecaps, () => gateway.saveEventVideoRecap(input)),
    changeRecapStatus: input => mutate(
      invalidateRecaps,
      () => gateway.changeEventVideoRecapStatus(input),
    ),
    archiveRecap: input => mutate(
      invalidateRecaps,
      () => gateway.archiveEventVideoRecap(input),
    ),
  }
}
