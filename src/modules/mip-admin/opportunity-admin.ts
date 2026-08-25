import type { MipAdminGateway } from './types'

interface OpportunityAdminCache {
  query: <T>(key: string, loader: () => Promise<T>, options?: { force?: boolean }) => Promise<T>
  invalidate: (prefix?: string) => void
}

type OpportunityListInput = NonNullable<Parameters<MipAdminGateway['listOpportunities']>[0]>

export interface MipOpportunityAdmin {
  list: (
    input?: OpportunityListInput,
    force?: boolean,
  ) => ReturnType<MipAdminGateway['listOpportunities']>
  get: (
    opportunityId: Parameters<MipAdminGateway['getOpportunity']>[0],
    force?: boolean,
  ) => ReturnType<MipAdminGateway['getOpportunity']>
  getEditorOptions: (force?: boolean) => ReturnType<MipAdminGateway['getOpportunityEditorOptions']>
  getCommentState: (
    opportunityId: Parameters<MipAdminGateway['getOpportunityCommentAdminState']>[0],
    force?: boolean,
  ) => ReturnType<MipAdminGateway['getOpportunityCommentAdminState']>
  getMatchingState: (
    branchId?: Parameters<MipAdminGateway['getMatchingAdminState']>[0],
    force?: boolean,
  ) => ReturnType<MipAdminGateway['getMatchingAdminState']>
  save: MipAdminGateway['saveOpportunity']
  publish: MipAdminGateway['publishOpportunity']
  end: MipAdminGateway['endOpportunity']
  unpublish: MipAdminGateway['unpublishOpportunity']
  archive: MipAdminGateway['archiveOpportunity']
  saveCommentSettings: MipAdminGateway['saveOpportunityCommentSettings']
  moderateComment: MipAdminGateway['moderateOpportunityComment']
  closeCommentReport: MipAdminGateway['closeOpportunityCommentReport']
  saveMatchingSettings: MipAdminGateway['saveMatchingSettings']
  recalculateMatching: MipAdminGateway['recalculateOpportunityMatching']
}

const opportunityCachePrefixes = [
  'mip-admin:opportunities',
  'mip-admin:opportunity',
  'mip-admin:opportunity-comments',
  'mip-admin:matching',
] as const

export function createMipOpportunityAdmin(
  gateway: MipAdminGateway,
  cache: OpportunityAdminCache,
): MipOpportunityAdmin {
  const invalidateQueries = () => {
    for (const prefix of opportunityCachePrefixes) {
      cache.invalidate(prefix)
    }
  }
  const mutate = async <T>(work: () => Promise<T>) => {
    const result = await work()
    invalidateQueries()
    return result
  }

  return {
    list: (input: OpportunityListInput = {}, force = false) => cache.query(
      `mip-admin:opportunities:${JSON.stringify(input)}`,
      () => gateway.listOpportunities(input),
      { force },
    ),
    get: (opportunityId, force = false) => cache.query(
      `mip-admin:opportunity:${opportunityId}`,
      () => gateway.getOpportunity(opportunityId),
      { force },
    ),
    getEditorOptions: (force = false) => cache.query(
      'mip-admin:opportunity-options',
      gateway.getOpportunityEditorOptions,
      { force },
    ),
    getCommentState: (opportunityId, force = false) => cache.query(
      `mip-admin:opportunity-comments:${opportunityId}`,
      () => gateway.getOpportunityCommentAdminState(opportunityId),
      { force },
    ),
    getMatchingState: (branchId, force = false) => cache.query(
      `mip-admin:matching:${branchId || 'PLATFORM'}`,
      () => gateway.getMatchingAdminState(branchId),
      { force },
    ),
    save: input => mutate(() => gateway.saveOpportunity(input)),
    publish: input => mutate(() => gateway.publishOpportunity(input)),
    end: input => mutate(() => gateway.endOpportunity(input)),
    unpublish: input => mutate(() => gateway.unpublishOpportunity(input)),
    archive: input => mutate(() => gateway.archiveOpportunity(input)),
    saveCommentSettings: input => mutate(() => gateway.saveOpportunityCommentSettings(input)),
    moderateComment: input => mutate(() => gateway.moderateOpportunityComment(input)),
    closeCommentReport: input => mutate(() => gateway.closeOpportunityCommentReport(input)),
    saveMatchingSettings: input => mutate(() => gateway.saveMatchingSettings(input)),
    recalculateMatching: input => mutate(() => gateway.recalculateOpportunityMatching(input)),
  }
}
