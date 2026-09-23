'use strict'
const { CAPABILITIES, authorize, capabilitiesForBinding, coversScope } = require('./capabilities')
const { decodeCursor } = require('./pagination')
const { AdminError, requiredId, limit } = require('./validation')

function createProfileRecords({ access, repository }) {
  const pageInput = input => ({ limit: limit(input.limit, 100), cursor: decodeCursor(input.cursor, ['createdAt', 'id']) })
  const visiblePerson = (context, row) => {
    const { primaryBranchId, userId, ...safe } = row
    const canRead = context.bindings.some(binding => capabilitiesForBinding(binding).includes(CAPABILITIES.USERS_READ)
      && coversScope(binding, { scopeType: primaryBranchId ? 'BRANCH' : 'PLATFORM', scopeId: primaryBranchId || null }))
    return { ...safe, ...(canRead && userId ? { userId } : {}) }
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
    const page = await repository.listInvitedGuests(context.caller.appId, userId, pageInput(input))
    await recordRead(context, scope, grant, 'USER', userId, 'admin.users.invitations.view', page.items.length)
    return { ...page, items: page.items.map(row => visiblePerson(context, row)) }
  }
  async function listLikeRelations(caller, input = {}) {
    const { context, userId, scope, grant } = await userContext(caller, input)
    const direction = input.direction || 'ALL'
    const status = input.status || ''
    if (!['ALL', 'INCOMING', 'OUTGOING', 'MUTUAL'].includes(direction)
      || !['', 'ACTIVE', 'CANCELLED', 'INVALID'].includes(status)) throw new AdminError('VALIDATION_FAILED', '心动筛选无效')
    const sinceTime = input.sinceTime ? new Date(input.sinceTime) : null
    if (sinceTime && !Number.isFinite(sinceTime.getTime())) throw new AdminError('VALIDATION_FAILED', '开始时间无效')
    const page = await repository.listLikeRelations(context.caller.appId, userId, {
      ...pageInput(input), direction, status, eventId: input.eventId ? requiredId(input.eventId, '活动') : '', sinceTime,
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
module.exports = { createProfileRecords }
