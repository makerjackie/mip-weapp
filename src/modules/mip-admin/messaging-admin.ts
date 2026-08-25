import type { MipAdminGateway } from './types'

interface MessagingAdminCache {
  query: <T>(key: string, loader: () => Promise<T>, options?: { force?: boolean }) => Promise<T>
  invalidate: (prefix?: string) => void
}

type AnnouncementListInput = NonNullable<Parameters<MipAdminGateway['listAnnouncements']>[0]>
type CampaignListInput = NonNullable<Parameters<MipAdminGateway['listMessageCampaigns']>[0]>
type RecipientSearchInput = NonNullable<Parameters<MipAdminGateway['searchMessageRecipients']>[0]>

export interface MipMessagingAdmin {
  getAnnouncementScopes: (force?: boolean) => ReturnType<MipAdminGateway['getAnnouncementScopes']>
  listAnnouncements: (
    input?: AnnouncementListInput,
    force?: boolean,
  ) => ReturnType<MipAdminGateway['listAnnouncements']>
  getAnnouncement: (
    announcementId: Parameters<MipAdminGateway['getAnnouncement']>[0],
    force?: boolean,
  ) => ReturnType<MipAdminGateway['getAnnouncement']>
  saveAnnouncement: MipAdminGateway['saveAnnouncement']
  publishAnnouncement: MipAdminGateway['publishAnnouncement']
  withdrawAnnouncement: MipAdminGateway['withdrawAnnouncement']
  setAnnouncementPinned: MipAdminGateway['setAnnouncementPinned']
  getCampaignScopes: (force?: boolean) => ReturnType<MipAdminGateway['getMessageCampaignScopes']>
  listCampaigns: (
    input?: CampaignListInput,
    force?: boolean,
  ) => ReturnType<MipAdminGateway['listMessageCampaigns']>
  getCampaign: (
    campaignId: Parameters<MipAdminGateway['getMessageCampaign']>[0],
    force?: boolean,
  ) => ReturnType<MipAdminGateway['getMessageCampaign']>
  searchRecipients: (
    input?: RecipientSearchInput,
    force?: boolean,
  ) => ReturnType<MipAdminGateway['searchMessageRecipients']>
  saveCampaign: MipAdminGateway['saveMessageCampaign']
  snapshotCampaign: MipAdminGateway['snapshotMessageCampaign']
  publishCampaign: MipAdminGateway['publishMessageCampaign']
  withdrawCampaign: MipAdminGateway['withdrawMessageCampaign']
}

const cacheKeys = {
  announcementScopes: 'mip-admin:announcement-scopes',
  announcements: 'mip-admin:announcements',
  announcement: 'mip-admin:announcement',
  campaignScopes: 'mip-admin:message-campaign-scopes',
  campaigns: 'mip-admin:message-campaigns',
  campaign: 'mip-admin:message-campaign',
  recipients: 'mip-admin:message-recipients',
} as const

function inputCacheKey(prefix: string, input: object) {
  return `${prefix}:${JSON.stringify(input)}`
}

export function createMipMessagingAdmin(
  gateway: MipAdminGateway,
  cache: MessagingAdminCache,
): MipMessagingAdmin {
  const mutate = async <T>(prefixes: readonly string[], work: () => Promise<T>) => {
    const result = await work()
    for (const prefix of prefixes) {
      cache.invalidate(prefix)
    }
    return result
  }
  const invalidateAnnouncements = [cacheKeys.announcements, cacheKeys.announcement]
  const invalidateCampaigns = [cacheKeys.campaigns, cacheKeys.campaign]

  return {
    getAnnouncementScopes: (force = false) => cache.query(
      cacheKeys.announcementScopes,
      gateway.getAnnouncementScopes,
      { force },
    ),
    listAnnouncements: (input: AnnouncementListInput = {}, force = false) => cache.query(
      inputCacheKey(cacheKeys.announcements, input),
      () => gateway.listAnnouncements(input),
      { force },
    ),
    getAnnouncement: (announcementId, force = false) => cache.query(
      `${cacheKeys.announcement}:${announcementId}`,
      () => gateway.getAnnouncement(announcementId),
      { force },
    ),
    saveAnnouncement: input => mutate(
      invalidateAnnouncements,
      () => gateway.saveAnnouncement(input),
    ),
    publishAnnouncement: (announcementId, expectedVersion) => mutate(
      invalidateAnnouncements,
      () => gateway.publishAnnouncement(announcementId, expectedVersion),
    ),
    withdrawAnnouncement: (announcementId, expectedVersion, reason) => mutate(
      invalidateAnnouncements,
      () => gateway.withdrawAnnouncement(announcementId, expectedVersion, reason),
    ),
    setAnnouncementPinned: (announcementId, pinned, expectedVersion) => mutate(
      invalidateAnnouncements,
      () => gateway.setAnnouncementPinned(announcementId, pinned, expectedVersion),
    ),
    getCampaignScopes: (force = false) => cache.query(
      cacheKeys.campaignScopes,
      gateway.getMessageCampaignScopes,
      { force },
    ),
    listCampaigns: (input: CampaignListInput = {}, force = false) => cache.query(
      inputCacheKey(cacheKeys.campaigns, input),
      () => gateway.listMessageCampaigns(input),
      { force },
    ),
    getCampaign: (campaignId, force = false) => cache.query(
      `${cacheKeys.campaign}:${campaignId}`,
      () => gateway.getMessageCampaign(campaignId),
      { force },
    ),
    searchRecipients: (input: RecipientSearchInput = {}, force = false) => cache.query(
      inputCacheKey(cacheKeys.recipients, input),
      () => gateway.searchMessageRecipients(input),
      { force },
    ),
    saveCampaign: input => mutate(invalidateCampaigns, () => gateway.saveMessageCampaign(input)),
    snapshotCampaign: (campaignId, expectedVersion) => mutate(
      invalidateCampaigns,
      () => gateway.snapshotMessageCampaign(campaignId, expectedVersion),
    ),
    publishCampaign: (campaignId, expectedVersion, idempotencyKey) => mutate(
      invalidateCampaigns,
      () => gateway.publishMessageCampaign(campaignId, expectedVersion, idempotencyKey),
    ),
    withdrawCampaign: (campaignId, expectedVersion, reason) => mutate(
      invalidateCampaigns,
      () => gateway.withdrawMessageCampaign(campaignId, expectedVersion, reason),
    ),
  }
}
