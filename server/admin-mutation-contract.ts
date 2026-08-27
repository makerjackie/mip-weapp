export interface ReviewedAdminMutation {
  action: string
  required: readonly string[]
  optional: readonly string[]
}

const mutation = (
  action: string,
  required: readonly string[],
  optional: readonly string[] = [],
): ReviewedAdminMutation => Object.freeze({ action, required, optional })

export const REVIEWED_ADMIN_MUTATIONS = Object.freeze([
  mutation('mip.admin.memberships.grant', ['durationMonths', 'expectedChainVersion', 'reason', 'userId']),
  mutation('mip.admin.events.clone', ['expectedVersion', 'sourceEventId']),
  mutation('mip.admin.events.changeStatus', ['eventId', 'expectedVersion', 'status']),
  mutation('mip.admin.events.archive', ['eventId', 'expectedVersion', 'reason']),
  mutation('mip.admin.communications.publishEventReminder', ['eventId', 'expectedVersion', 'sendWechatReminder']),
  mutation('mip.admin.refunds.submit', ['orderId', 'reason']),

  mutation('mip.admin.users.update', ['userId', 'expectedVersion', 'fields']),
  mutation('mip.admin.users.changePrimaryBranch', ['userId', 'targetBranchId', 'expectedVersion', 'reason']),
  mutation('mip.admin.users.setControl', ['userId', 'controlType', 'active', 'reason']),
  mutation('mip.admin.roles.set', ['userId', 'roleKey', 'active'], ['scopeId', 'branchId']),
  mutation('mip.admin.rolePolicies.update', ['roleKey', 'expectedVersion'], ['capabilities', 'reset']),
  mutation('mip.admin.branches.create', ['branchKey', 'name', 'cityName', 'summary']),
  mutation('mip.admin.branches.update', ['branchId', 'expectedVersion', 'name', 'cityName', 'summary']),
  mutation('mip.admin.branches.changeStatus', ['branchId', 'expectedVersion', 'status']),

  mutation('mip.admin.events.save', ['draft'], ['eventId', 'expectedVersion']),
  mutation('mip.admin.events.registrations.review', ['eventId', 'registrationId', 'expectedVersion', 'decision']),
  mutation('mip.admin.events.checkIn', ['eventId', 'registrationId', 'expectedVersion']),
  mutation('mip.admin.events.undoCheckIn', ['eventId', 'registrationId', 'expectedVersion', 'reason']),
  mutation('mip.admin.events.album.review', ['eventId', 'photoId', 'expectedVersion', 'decision', 'reason']),
  mutation('mip.admin.events.policy.save', ['expectedVersion', 'cancellationHoursBeforeStart']),
  mutation('mip.admin.events.tags.replace', ['eventId', 'expectedVersion', 'tagIds']),
  mutation('mip.admin.events.catalog.save', ['kind', 'name', 'description', 'sortOrder'], ['key', 'catalogId', 'expectedVersion']),
  mutation('mip.admin.events.catalog.changeStatus', ['kind', 'catalogId', 'expectedVersion', 'status']),
  mutation('mip.admin.events.catalog.archive', ['kind', 'catalogId', 'expectedVersion', 'reason']),

  mutation('mip.admin.announcements.save', ['scopeType', 'title', 'summary', 'body', 'visibleFrom'], ['announcementId', 'expectedVersion', 'branchId', 'targetType', 'targetId', 'visibleUntil']),
  mutation('mip.admin.announcements.publish', ['announcementId', 'expectedVersion']),
  mutation('mip.admin.announcements.withdraw', ['announcementId', 'expectedVersion', 'reason']),
  mutation('mip.admin.announcements.pin', ['announcementId', 'expectedVersion', 'pinned']),
  mutation('mip.admin.messageCampaigns.save', ['scopeType', 'audienceType', 'recipientRefs', 'name', 'title', 'body'], ['campaignId', 'expectedVersion', 'branchId']),
  mutation('mip.admin.messageCampaigns.snapshot', ['campaignId', 'expectedVersion']),
  mutation('mip.admin.messageCampaigns.schedule', ['campaignId', 'expectedVersion', 'scheduledFor'], ['expectedDispatchVersion']),
  mutation('mip.admin.messageCampaigns.cancelSchedule', ['campaignId', 'expectedVersion', 'expectedDispatchVersion', 'reason']),
  mutation('mip.admin.messageCampaigns.publish', ['campaignId', 'expectedVersion']),
  mutation('mip.admin.messageCampaigns.withdraw', ['campaignId', 'expectedVersion', 'reason']),
  mutation('mip.admin.messageTemplates.save', ['scopeType', 'name', 'title', 'body'], ['templateId', 'expectedVersion', 'branchId']),
  mutation('mip.admin.messageTemplates.activate', ['templateId', 'expectedVersion']),
  mutation('mip.admin.messageTemplates.archive', ['templateId', 'expectedVersion']),
  mutation('mip.admin.communityReports.claim', ['reportId', 'expectedVersion', 'reason']),
  mutation('mip.admin.communityReports.close', ['reportId', 'expectedVersion', 'outcome', 'reason']),
  mutation('mip.admin.opportunities.save', ['draft'], ['opportunityId', 'expectedVersion']),
  mutation('mip.admin.opportunities.publish', ['opportunityId', 'expectedVersion']),
  mutation('mip.admin.opportunities.end', ['opportunityId', 'expectedVersion']),
  mutation('mip.admin.opportunities.unpublish', ['opportunityId', 'expectedVersion', 'reason']),
  mutation('mip.admin.opportunities.archive', ['opportunityId', 'expectedVersion', 'reason']),
  mutation('mip.admin.userContent.save', ['kind', 'ownerUserId', 'draft'], ['contentId', 'expectedVersion']),
  mutation('mip.admin.userContent.unpublish', ['kind', 'contentId', 'expectedVersion', 'reason']),
  mutation('mip.admin.userContent.archive', ['kind', 'contentId', 'expectedVersion', 'reason']),
  mutation('mip.admin.knowledge.contents.save', ['categoryId', 'contentType', 'title', 'summary', 'accessType', 'commentsEnabled', 'moderationMode'], ['contentId', 'expectedVersion', 'sourceId', 'bodyText', 'externalUrl', 'channelFinderUserName', 'channelFeedId', 'coverAssetId', 'authorName']),
  mutation('mip.admin.knowledge.contents.review', ['contentId', 'expectedVersion', 'decision'], ['reason']),
  mutation('mip.admin.knowledge.schedules.save', ['sourceId', 'categoryId', 'dailyTime', 'timeZone'], ['scheduleId', 'expectedVersion', 'status']),
  mutation('mip.admin.badges.grant', ['userId', 'badgeId', 'reason']),
  mutation('mip.admin.badges.revoke', ['awardId', 'expectedVersion', 'reason']),
  mutation('mip.admin.growth.adjust', ['userId', 'metric', 'deltaValue', 'reason']),

  mutation('mip.admin.tasks.save', ['task'], ['taskId', 'expectedVersion']),
  mutation('mip.admin.tasks.publish', ['taskId', 'expectedVersion']),
  mutation('mip.admin.tasks.unpublish', ['taskId', 'expectedVersion']),
  mutation('mip.admin.tasks.delete', ['taskId', 'expectedVersion']),
  mutation('mip.admin.tasks.assignMembers', ['taskId', 'memberRefs', 'expectedVersion']),
  mutation('mip.admin.tasks.revokeMembers', ['taskId', 'memberRefs', 'expectedVersion']),
])

export const REVIEWED_ADMIN_MUTATION_ACTIONS = new Set(REVIEWED_ADMIN_MUTATIONS.map(item => item.action))
export const REVIEWED_ADMIN_MUTATION_SCHEMAS = new Map(REVIEWED_ADMIN_MUTATIONS.map(item => [
  item.action,
  { required: new Set(item.required), optional: new Set(item.optional) },
]))
