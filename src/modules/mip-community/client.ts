import type { ReportCategory } from './types'
import { createMipCommunityGateway } from './gateway'
import { createCommunityRequestId } from './report-intent'
import { callCommunityApi } from './transport'

const gateway = createMipCommunityGateway({ invoke: callCommunityApi })

export const mipCommunityModule = {
  relationship(profileRef: string) {
    return gateway.relationship(profileRef.trim())
  },

  block(profileRef: string) {
    return gateway.block(profileRef.trim())
  },

  unblock(profileRef: string) {
    return gateway.unblock(profileRef.trim())
  },

  listBlocked(cursor?: string) {
    return gateway.listBlocked(cursor)
  },

  report(
    profileRef: string,
    category: ReportCategory,
    description = '',
    stableRequestId = createCommunityRequestId(),
  ) {
    return gateway.report({
      profileRef: profileRef.trim(),
      category,
      description: description.trim(),
      requestId: stableRequestId,
    })
  },
}
