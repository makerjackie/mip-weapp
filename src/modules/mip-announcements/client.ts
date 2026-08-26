import type { AnnouncementListQuery } from './types'
import { createQueryCache } from '@weapp/shared/cache'
import { callCommunityApi } from '../mip-community/transport'
import { registerMipLocalUserCache } from '../mip-identity/local-session'
import { createAnnouncementGateway } from './gateway'

const gateway = createAnnouncementGateway({ invoke: callCommunityApi })
const cache = createQueryCache(20_000)

function listKey(input: AnnouncementListQuery) {
  return `announcements:${input.branchId || 'platform'}:${input.cursor || 'first'}:${input.limit || 20}`
}

export const mipAnnouncementsModule = {
  list(input: AnnouncementListQuery = {}, force = false) {
    return cache.query(listKey(input), () => gateway.list(input), { force })
  },
  peekList(input: AnnouncementListQuery = {}) {
    return cache.peek<Awaited<ReturnType<typeof gateway.list>>>(listKey(input))
  },
  get(announcementId: string, force = false) {
    return cache.query(`announcement:${announcementId}`, () => gateway.get(announcementId), { force })
  },
  peek(announcementId: string) {
    return cache.peek<Awaited<ReturnType<typeof gateway.get>>>(`announcement:${announcementId}`)
  },
  invalidate() {
    cache.invalidate()
  },
}

registerMipLocalUserCache(() => mipAnnouncementsModule.invalidate())
