export type AdminRowOperationAction
  = | 'mip.admin.events.registrations.review'
    | 'mip.admin.events.checkIn'
    | 'mip.admin.events.undoCheckIn'
    | 'mip.admin.events.album.review'
    | 'mip.admin.events.policy.save'
    | 'mip.admin.events.catalog.save'
    | 'mip.admin.events.catalog.changeStatus'
    | 'mip.admin.events.catalog.archive'
    | 'mip.admin.rolePolicies.update'
    | 'mip.admin.branches.update'
    | 'mip.admin.branches.changeStatus'
    | 'mip.admin.messageCampaigns.cancelSchedule'
    | 'mip.admin.announcements.publish'
    | 'mip.admin.announcements.withdraw'
    | 'mip.admin.announcements.pin'
    | 'mip.admin.messageTemplates.activate'
    | 'mip.admin.messageTemplates.archive'
    | 'mip.admin.communityReports.claim'
    | 'mip.admin.communityReports.close'
    | 'mip.admin.banners.changeStatus'
    | 'mip.admin.banners.move'
    | 'mip.admin.banners.delete'
    | 'mip.admin.game.seasons.save'
    | 'mip.admin.game.seasons.changeStatus'
    | 'mip.admin.game.teams.save'
    | 'mip.admin.game.teams.changeStatus'
    | 'mip.admin.game.teams.members.replace'
    | 'mip.admin.game.matches.save'
    | 'mip.admin.game.matches.finalize'
    | 'mip.admin.game.rankings.generate'
    | 'mip.admin.game.blindBoxes.catalogs.save'
    | 'mip.admin.game.blindBoxes.catalogs.changeStatus'
    | 'mip.admin.game.blindBoxes.cards.save'
    | 'mip.admin.game.blindBoxes.cards.changeStatus'

export interface AdminRowOperation {
  action: AdminRowOperationAction
  label: string
  targetId?: string
  values?: Record<string, unknown>
  expectedVersion?: number
  allowedCapabilities?: string[]
}

export type AdminOperationLaunchContext = Pick<
  AdminRowOperation,
  'values' | 'expectedVersion' | 'allowedCapabilities'
>

export type AdminOperationRow = Record<string, unknown> & {
  rowActions?: readonly AdminRowOperation[]
}

export function eventRegistrationRowActions(
  eventIdValue: unknown,
  registration: Record<string, unknown>,
): AdminRowOperation[] {
  const eventId = identifier(eventIdValue)
  const registrationId = identifier(registration.id || registration.registrationId)
  const expectedVersion = positiveVersion(registration.version)
  const status = String(registration.status || '')
  if (!eventId || !registrationId || expectedVersion === null) return []
  const values = { eventId, registrationId, expectedVersion }
  if (status === 'PENDING_REVIEW') {
    return [{ action: 'mip.admin.events.registrations.review', label: '审核', targetId: eventId, values }]
  }
  if (status === 'REGISTERED') {
    return [{ action: 'mip.admin.events.checkIn', label: '签到', targetId: eventId, values }]
  }
  if (status === 'ATTENDED') {
    return [{ action: 'mip.admin.events.undoCheckIn', label: '撤销签到', targetId: eventId, values }]
  }
  return []
}

export function eventAlbumRowActions(
  eventIdValue: unknown,
  photo: Record<string, unknown>,
): AdminRowOperation[] {
  const eventId = identifier(eventIdValue)
  const photoId = identifier(photo.id || photo.photoId)
  const expectedVersion = positiveVersion(photo.version)
  if (!eventId || !photoId || expectedVersion === null || photo.status !== 'PENDING') return []
  return [{
    action: 'mip.admin.events.album.review',
    label: '审核',
    targetId: eventId,
    values: { eventId, photoId, expectedVersion },
  }]
}

export function eventPolicyRowActions(policy: Record<string, unknown>): AdminRowOperation[] {
  const expectedVersion = nonNegativeVersion(policy.version)
  const cancellationHoursBeforeStart = boundedInteger(policy.cancellationHoursBeforeStart, 0, 720)
  if (expectedVersion === null || cancellationHoursBeforeStart === null) return []
  return [{
    action: 'mip.admin.events.policy.save',
    label: '编辑政策',
    values: { expectedVersion, cancellationHoursBeforeStart },
  }]
}

export function eventCatalogRowActions(catalog: Record<string, unknown>): AdminRowOperation[] {
  const catalogId = identifier(catalog.id || catalog.catalogId)
  const expectedVersion = positiveVersion(catalog.version)
  const kind = String(catalog.kind || '')
  const status = String(catalog.status || '')
  const sortOrder = nonNegativeVersion(catalog.sortOrder)
  if (!catalogId
    || expectedVersion === null
    || !['TYPE', 'TAG'].includes(kind)
    || !['ACTIVE', 'INACTIVE', 'ARCHIVED'].includes(status)
    || sortOrder === null) return []
  if (status === 'ARCHIVED') return []
  return [
    {
      action: 'mip.admin.events.catalog.save',
      label: '编辑',
      targetId: catalogId,
      values: {
        kind,
        catalogId,
        expectedVersion,
        name: String(catalog.name || ''),
        description: String(catalog.description || ''),
        sortOrder,
      },
    },
    {
      action: 'mip.admin.events.catalog.changeStatus',
      label: status === 'ACTIVE' ? '停用' : '启用',
      targetId: catalogId,
      values: {
        kind,
        catalogId,
        expectedVersion,
        status: status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
      },
    },
    {
      action: 'mip.admin.events.catalog.archive',
      label: '归档',
      targetId: catalogId,
      values: { kind, catalogId, expectedVersion, reason: '' },
    },
  ]
}

export function announcementRowActions(announcement: Record<string, unknown>): AdminRowOperation[] {
  const announcementId = identifier(announcement.id || announcement.announcementId)
  const expectedVersion = positiveVersion(announcement.version)
  const status = String(announcement.status || '')
  if (!announcementId || expectedVersion === null) return []
  const values = { announcementId, expectedVersion }
  if (['DRAFT', 'WITHDRAWN'].includes(status)) {
    return [{
      action: 'mip.admin.announcements.publish',
      label: '发布',
      targetId: announcementId,
      values,
    }]
  }
  if (status !== 'PUBLISHED') return []
  const pinned = announcement.isPinned === true
  return [
    {
      action: 'mip.admin.announcements.withdraw',
      label: '撤回',
      targetId: announcementId,
      values: { ...values, reason: '' },
    },
    {
      action: 'mip.admin.announcements.pin',
      label: pinned ? '取消置顶' : '置顶',
      targetId: announcementId,
      values: { ...values, pinned: !pinned },
    },
  ]
}

export function messageTemplateRowActions(template: Record<string, unknown>): AdminRowOperation[] {
  const templateId = identifier(template.id || template.templateId)
  const expectedVersion = positiveVersion(template.version)
  const status = String(template.status || '')
  if (!templateId || expectedVersion === null || !['DRAFT', 'ACTIVE'].includes(status)) return []
  const values = { templateId, expectedVersion }
  const actions: AdminRowOperation[] = []
  if (status === 'DRAFT') actions.push({
    action: 'mip.admin.messageTemplates.activate',
    label: '启用',
    targetId: templateId,
    values,
  })
  actions.push({
    action: 'mip.admin.messageTemplates.archive',
    label: '归档',
    targetId: templateId,
    values,
  })
  return actions
}

export function communityReportRowActions(report: Record<string, unknown>): AdminRowOperation[] {
  const reportId = identifier(report.id || report.reportId)
  const expectedVersion = positiveVersion(report.version)
  const status = String(report.status || '')
  if (!reportId || expectedVersion === null) return []
  if (status === 'PENDING') return [{
    action: 'mip.admin.communityReports.claim',
    label: '认领',
    targetId: reportId,
    values: { reportId, expectedVersion, reason: '' },
  }]
  if (status === 'REVIEWING') return [{
    action: 'mip.admin.communityReports.close',
    label: '结案',
    targetId: reportId,
    values: { reportId, expectedVersion, outcome: 'RESOLVED', reason: '' },
  }]
  return []
}

export function rolePolicyRowActions(policy: Record<string, unknown>): AdminRowOperation[] {
  const roleKey = identifier(policy.roleKey)
  const expectedVersion = nonNegativeVersion(policy.version)
  if (!roleKey || expectedVersion === null) return []
  return [{
    action: 'mip.admin.rolePolicies.update',
    label: '更新策略',
    values: {
      roleKey,
      capabilities: stringList(policy.capabilities),
      reset: false,
    },
    expectedVersion,
    allowedCapabilities: stringList(policy.allowedCapabilities),
  }]
}

export function branchRowActions(branch: Record<string, unknown>): AdminRowOperation[] {
  const branchId = identifier(branch.id || branch.branchId)
  const expectedVersion = positiveVersion(branch.version)
  const status = String(branch.status || '')
  if (!branchId || expectedVersion === null || !['ACTIVE', 'INACTIVE'].includes(status)) return []
  return [
    {
      action: 'mip.admin.branches.update',
      label: '编辑',
      targetId: branchId,
      values: {
        name: String(branch.name || ''),
        cityName: String(branch.cityName || ''),
        summary: String(branch.summary || ''),
      },
      expectedVersion,
    },
    {
      action: 'mip.admin.branches.changeStatus',
      label: status === 'ACTIVE' ? '停用' : '启用',
      targetId: branchId,
      values: { status: status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' },
      expectedVersion,
    },
  ]
}

export function messageScheduleCancelAction(
  campaign: Record<string, unknown>,
  dispatch: Record<string, unknown>,
): AdminRowOperation | null {
  const campaignId = identifier(campaign.id || campaign.campaignId)
  const expectedVersion = positiveVersion(campaign.version)
  const expectedDispatchVersion = positiveVersion(dispatch.version)
  const needsManualReview = dispatch.lastOutcome === 'UNKNOWN'
    || dispatch.retryDisposition === 'MANUAL_REVIEW'
  if (!campaignId
    || expectedVersion === null
    || expectedDispatchVersion === null
    || campaign.status !== 'READY'
    || !['SCHEDULED', 'FAILED'].includes(String(dispatch.status || ''))
    || needsManualReview) return null
  return {
    action: 'mip.admin.messageCampaigns.cancelSchedule',
    label: '取消发送计划',
    targetId: campaignId,
    values: { campaignId, expectedVersion, expectedDispatchVersion, reason: '' },
  }
}

function identifier(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : ''
  return text && text.length <= 128 && /^[A-Za-z0-9_.:-]+$/.test(text) ? text : ''
}

function positiveVersion(value: unknown) {
  const version = Number(value)
  return Number.isSafeInteger(version) && version >= 1 ? version : null
}

function nonNegativeVersion(value: unknown) {
  const version = Number(value)
  return Number.isSafeInteger(version) && version >= 0 ? version : null
}

function boundedInteger(value: unknown, minimum: number, maximum: number) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= minimum && number <= maximum ? number : null
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.filter(item => typeof item === 'string' && item.trim()).map(String))]
    : []
}
