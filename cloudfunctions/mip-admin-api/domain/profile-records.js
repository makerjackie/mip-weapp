'use strict'
const { CAPABILITIES, authorize, capabilitiesForBinding, coversScope } = require('./capabilities')
const { decodeCursor } = require('./pagination')
const { AdminError, requiredId, limit } = require('./validation')

function createProfileRecords({ access, repository }) {
  const pageInput = input => ({ limit: limit(input.limit, 100), cursor: decodeCursor(input.cursor, ['createdAt', 'id']) })
  const visiblePerson = (context, row) => {
    const { primaryBranchId, eventBranchId, userId, ...safe } = row
    const canRead = context.bindings.some(binding => capabilitiesForBinding(binding).includes(CAPABILITIES.USERS_READ)
      && coversScope(binding, { scopeType: primaryBranchId ? 'BRANCH' : 'PLATFORM', scopeId: primaryBranchId || null }))
    const eventDetailAllowed = Boolean(row.eventId && context.bindings.some(binding => capabilitiesForBinding(binding).includes(CAPABILITIES.EVENTS_READ)
      && coversScope(binding, { scopeType: 'EVENT', scopeId: row.eventId, branchId: eventBranchId || null })))
    return { ...safe, eventDetailAllowed, ...(canRead && userId ? { userId } : {}) }
  }
  async function userContext(caller, input) {
    const context = await access.session(caller)
    const userId = requiredId(input.userId, '用户')
    const authorization = await access.userAuthorization(context, userId, CAPABILITIES.USERS_READ)
    return { context, userId, ...authorization }
  }
  async function recordRead(context, scope, grant, resourceType, resourceId, action, count) {
    await repository.recordAudit(access.audit(context, grant, {
      ...scope, resourceType, resourceId, action, metadata: { count },
    }))
  }
  async function listInvitedGuests(caller, input = {}) {
    const { context, userId, scope, grant } = await userContext(caller, input)
    if (input.source && !['EVENT', 'MEMBERSHIP'].includes(input.source)) throw new AdminError('VALIDATION_FAILED', '邀请来源无效')
    const page = await repository.listInvitedGuests(context.caller.appId, userId, { ...pageInput(input), ...relationFilters(input), source: input.source || '' })
    await recordRead(context, scope, grant, 'USER', userId, 'admin.users.invitations.view', page.items.length)
    return { ...page, items: page.items.map(row => visiblePerson(context, row)) }
  }
  async function listLikeRelations(caller, input = {}) {
    const { context, userId, scope, grant } = await userContext(caller, input)
    const direction = input.direction || 'ALL'
    const status = input.status || ''
    if (!['ALL', 'INCOMING', 'OUTGOING', 'MUTUAL'].includes(direction)
      || !['', 'ACTIVE', 'CANCELLED', 'INVALID'].includes(status)) throw new AdminError('VALIDATION_FAILED', '心动筛选无效')
    const page = await repository.listLikeRelations(context.caller.appId, userId, {
      ...pageInput(input), ...relationFilters(input), direction, status,
    })
    await recordRead(context, scope, grant, 'USER', userId, 'admin.users.hearts.view', page.items.length)
    return { ...page, items: page.items.map(row => visiblePerson(context, row)) }
  }
  async function listUserOperationLogs(caller, input = {}) {
    const { context, userId, scope, grant } = await userContext(caller, input)
    const page = await repository.listResourceOperationLogs(context.caller.appId, 'USER', userId, pageInput(input))
    await recordRead(context, scope, grant, 'USER', userId, 'admin.users.operations.view', page.items.length)
    return page
  }
  async function opportunityContext(caller, input) {
    const context = await access.session(caller)
    const opportunityId = requiredId(input.opportunityId, '机会')
    const scope = await repository.getOpportunityScope(context.caller.appId, opportunityId)
    if (!scope) throw new AdminError('NOT_FOUND', '机会不存在')
    const grant = authorize(context.bindings, CAPABILITIES.OPPORTUNITIES_MODERATE, scope)
    return { context, opportunityId, scope, grant }
  }
  async function listOpportunityOperationLogs(caller, input = {}) {
    const { context, opportunityId } = await opportunityContext(caller, input)
    return repository.listResourceOperationLogs(context.caller.appId, 'OPPORTUNITY', opportunityId, pageInput(input))
  }
  async function listOpportunityReferrals(caller, input = {}) {
    const { context, opportunityId, scope, grant } = await opportunityContext(caller, input)
    const page = await repository.listOpportunityReferrals(context.caller.appId, opportunityId, pageInput(input))
    await recordRead(context, scope, grant, 'OPPORTUNITY', opportunityId, 'admin.opportunities.referrals.view', page.items.length)
    return page
  }
  return { listInvitedGuests, listLikeRelations, listUserOperationLogs, listOpportunityOperationLogs, listOpportunityReferrals }
}
function relationFilters(input) {
  const date = (value, label) => {
    if (!value) return null
    const parsed = new Date(value)
    if (typeof value !== 'string' || !Number.isFinite(parsed.getTime())) throw new AdminError('VALIDATION_FAILED', `${label}无效`)
    return parsed
  }
  const sinceTime = date(input.sinceTime, '开始时间'), untilTime = date(input.untilTime, '结束时间')
  if (sinceTime && untilTime && sinceTime > untilTime) throw new AdminError('VALIDATION_FAILED', '开始时间不能晚于结束时间')
  if (input.query !== undefined && (typeof input.query !== 'string' || input.query.length > 80)) throw new AdminError('VALIDATION_FAILED', '搜索关键词无效')
  return { sinceTime, untilTime, query: (input.query || '').trim(), eventId: input.eventId ? requiredId(input.eventId, '活动') : '' }
}
module.exports = { createProfileRecords }
