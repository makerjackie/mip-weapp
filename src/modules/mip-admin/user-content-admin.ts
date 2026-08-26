import type { MipAdminGateway } from './types'
import type {
  AdminUserContentArchiveInput,
  AdminUserContentKind,
  AdminUserContentListInput,
  AdminUserContentSaveInput,
  AdminUserContentUnpublishInput,
} from './user-content'

interface UserContentAdminCache {
  query: <T>(key: string, loader: () => Promise<T>, options?: { force?: boolean }) => Promise<T>
  invalidate: (prefix?: string) => void
}

export function createMipUserContentAdmin(gateway: MipAdminGateway, cache: UserContentAdminCache) {
  const invalidate = () => {
    cache.invalidate('mip-admin:user-content')
    cache.invalidate('mip-admin:audit')
    cache.invalidate('mip-admin:users')
  }
  return {
    list: (input: AdminUserContentListInput = {}, force = false) => cache.query(
      `mip-admin:user-content:list:${JSON.stringify(input)}`,
      () => gateway.listUserContent(input),
      { force },
    ),
    get: (kind: AdminUserContentKind, contentId: string, force = false) => cache.query(
      `mip-admin:user-content:detail:${kind}:${contentId}`,
      () => gateway.getUserContent(kind, contentId),
      { force },
    ),
    unpublish: async (input: AdminUserContentUnpublishInput) => {
      const result = await gateway.unpublishUserContent(input)
      invalidate()
      return result
    },
    save: async (input: AdminUserContentSaveInput) => {
      const result = await gateway.saveUserContent(input)
      invalidate()
      return result
    },
    archive: async (input: AdminUserContentArchiveInput) => {
      const result = await gateway.archiveUserContent(input)
      invalidate()
      return result
    },
  }
}
