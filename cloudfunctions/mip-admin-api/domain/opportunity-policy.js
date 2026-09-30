'use strict'

const EDITABLE_OPPORTUNITY_STATUSES = Object.freeze(['DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ENDED'])
const PUBLISHABLE_OPPORTUNITY_STATUSES = Object.freeze(['DRAFT', 'UNPUBLISHED', 'ENDED'])
function opportunityOperationPolicy(item, can, now = new Date()) {
  if (item.deleted || item.status === 'ARCHIVED') return { availableActions: [] }
  const actions = []
  if (can('opportunities.moderate')) {
    if (EDITABLE_OPPORTUNITY_STATUSES.includes(item.status)) actions.push('mip.admin.opportunities.save')
    if (PUBLISHABLE_OPPORTUNITY_STATUSES.includes(item.status) && item.contentSafetyStatus === 'APPROVED'
      && (!item.deadlineAt || new Date(item.deadlineAt) > now)) actions.push('mip.admin.opportunities.publish')
    if (item.status === 'PUBLISHED') actions.push('mip.admin.opportunities.end', 'mip.admin.opportunities.unpublish')
  }
  if (can('opportunities.archive', { scopeType: 'PLATFORM', scopeId: null })) {
    if (item.status === 'DRAFT' && Number(item.referralCount || 0) === 0) actions.push('mip.admin.opportunities.archive')
    actions.push('mip.admin.opportunities.delete')
  }
  return { availableActions: actions }
}
module.exports = { EDITABLE_OPPORTUNITY_STATUSES, PUBLISHABLE_OPPORTUNITY_STATUSES, opportunityOperationPolicy }
