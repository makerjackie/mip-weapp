import type { MipAdminGateway } from './types'

interface MessagingAdminCache {
  query: <T>(key: string, loader: () => Promise<T>, options?: { force?: boolean }) => Promise<T>
  invalidate: (prefix?: string) => void
}

type AnnouncementListInput = NonNullable<Parameters<MipAdminGateway['listAnnouncements']>[0]>
type CampaignListInput = NonNullable<Parameters<MipAdminGateway['listMessageCampaigns']>[0]>
type RecipientSearchInput = NonNullable<Parameters<MipAdminGateway['searchMessageRecipients']>[0]>
type TemplateListInput = NonNullable<Parameters<MipAdminGateway['listMessageTemplates']>[0]>
type DeliveryReviewListInput = NonNullable<Parameters<MipAdminGateway['listMessageDeliveryReviews']>[0]>

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
  scheduleCampaign: MipAdminGateway['scheduleMessageCampaign']
  cancelCampaignSchedule: MipAdminGateway['cancelMessageCampaignSchedule']
  withdrawCampaign: MipAdminGateway['withdrawMessageCampaign']
  listTemplates: (
    input?: TemplateListInput,
    force?: boolean,
  ) => ReturnType<MipAdminGateway['listMessageTemplates']>
  getTemplate: (
    templateId: Parameters<MipAdminGateway['getMessageTemplate']>[0],
    force?: boolean,
  ) => ReturnType<MipAdminGateway['getMessageTemplate']>
  saveTemplate: MipAdminGateway['saveMessageTemplate']
  activateTemplate: MipAdminGateway['activateMessageTemplate']
  archiveTemplate: MipAdminGateway['archiveMessageTemplate']
  listDeliveryReviews: (
    input?: DeliveryReviewListInput,
    force?: boolean,
  ) => ReturnType<MipAdminGateway['listMessageDeliveryReviews']>
  getDeliveryReview: (
    resourceRef: Parameters<MipAdminGateway['getMessageDeliveryReview']>[0],
    force?: boolean,
  ) => ReturnType<MipAdminGateway['getMessageDeliveryReview']>
  claimDeliveryReview: MipAdminGateway['claimMessageDeliveryReview']
  reconcileDeliveryReview: MipAdminGateway['reconcileMessageDeliveryReview']
  resolveDeliveryReview: MipAdminGateway['resolveMessageDeliveryReview']
}

const cacheKeys = {
  announcementScopes: 'mip-admin:announcement-scopes',
  announcements: 'mip-admin:announcements',
  announcement: 'mip-admin:announcement',
  campaignScopes: 'mip-admin:message-campaign-scopes',
  campaigns: 'mip-admin:message-campaigns',
  campaign: 'mip-admin:message-campaign',
  recipients: 'mip-admin:message-recipients',
  templates: 'mip-admin:message-templates',
  template: 'mip-admin:message-template',
  deliveryReviews: 'mip-admin:message-delivery-reviews',
  deliveryReview: 'mip-admin:message-delivery-review',
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
  const invalidateTemplates = [cacheKeys.templates, cacheKeys.template]
  const invalidateDeliveryReviews = [cacheKeys.deliveryReviews, cacheKeys.deliveryReview]

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
    scheduleCampaign: input => mutate(
      invalidateCampaigns,
      () => gateway.scheduleMessageCampaign(input),
    ),
    cancelCampaignSchedule: input => mutate(
      invalidateCampaigns,
      () => gateway.cancelMessageCampaignSchedule(input),
    ),
    withdrawCampaign: (campaignId, expectedVersion, reason) => mutate(
      invalidateCampaigns,
      () => gateway.withdrawMessageCampaign(campaignId, expectedVersion, reason),
    ),
    listTemplates: (input: TemplateListInput = {}, force = false) => cache.query(
      inputCacheKey(cacheKeys.templates, input),
      () => gateway.listMessageTemplates(input),
      { force },
    ),
    getTemplate: (templateId, force = false) => cache.query(
      `${cacheKeys.template}:${templateId}`,
      () => gateway.getMessageTemplate(templateId),
      { force },
    ),
    saveTemplate: input => mutate(invalidateTemplates, () => gateway.saveMessageTemplate(input)),
    activateTemplate: (templateId, expectedVersion) => mutate(
      invalidateTemplates,
      () => gateway.activateMessageTemplate(templateId, expectedVersion),
    ),
    archiveTemplate: (templateId, expectedVersion) => mutate(
      invalidateTemplates,
      () => gateway.archiveMessageTemplate(templateId, expectedVersion),
    ),
    listDeliveryReviews: (input: DeliveryReviewListInput = {}, force = false) => cache.query(
      inputCacheKey(cacheKeys.deliveryReviews, input),
      () => gateway.listMessageDeliveryReviews(input),
      { force },
    ),
    getDeliveryReview: (resourceRef, force = false) => cache.query(
      inputCacheKey(cacheKeys.deliveryReview, resourceRef),
      () => gateway.getMessageDeliveryReview(resourceRef),
      { force },
    ),
    claimDeliveryReview: input => mutate(
      invalidateDeliveryReviews,
      () => gateway.claimMessageDeliveryReview(input),
    ),
    reconcileDeliveryReview: input => mutate(
      invalidateDeliveryReviews,
      () => gateway.reconcileMessageDeliveryReview(input),
    ),
    resolveDeliveryReview: input => mutate(
      invalidateDeliveryReviews,
      () => gateway.resolveMessageDeliveryReview(input),
    ),
  }
}
